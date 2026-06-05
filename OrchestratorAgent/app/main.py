import asyncio
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from haidoc_obs import (
    configure_logging,
    set_job_context,
    clear_job_context,
    mount_metrics_endpoint,
    make_health_router,
    check_http,
    check_redis,
    check_postgres,
    agent_messages_consumed_total,
    agent_processing_duration_seconds,
    agent_errors_total,
)

configure_logging(service="orchestrator")

from app.core.limiter import limiter
from app.api.main import api_router
from app.utils.kafka import get_consumer
from app.services.job_result_store import job_result_store
from app.utils.config_client import get_config
from app.core.app_database import AppSessionLocal

from app.services import job_service, webhook_service
from app.services.kafka_lag_service import kafka_lag_collector_loop
from app.services.pipeline_router import (
    route_step_completion, handle_validation_failure, _load_registry,
    get_all_validated_topics,
)
from app.services.auth_service import seed_admin_user, seed_superadmin_user, seed_roles, setup_role_claim_mapping
from app.models.dead_letter_log import DeadLetterLog
from app.utils.redis_client import get_redis


logger = logging.getLogger(__name__)
_AGENT = "orchestrator"


async def _consume_results():
    """Background: consume task.completed -> persist to DB, resolve futures, dispatch webhooks."""
    while True:
        consumer = None
        try:
            consumer = await get_consumer("task.completed", "orchestrator-group")
            async for msg in consumer:
                started = time.monotonic()
                data = msg.value
                job_id = data.get("job_id")
                if not job_id:
                    logger.warning("Received task.completed message without job_id")
                    agent_messages_consumed_total.labels(_AGENT, "task.completed", "dropped").inc()
                    continue

                set_job_context(job_id=job_id)
                outcome = "success"
                try:
                    # Resolve in-memory future (for legacy /upload endpoint)
                    job_result_store.resolve(job_id, data)

                    # Persist to DB
                    db = AppSessionLocal()
                    try:
                        status_code = data.get("status_code", 200)
                        existing_job = job_service.get_job(db, job_id)
                        tenant_id = existing_job.tenant_id if existing_job else None

                        if status_code != 200:
                            error_detail = data.get("error_detail", "Unknown error")
                            job_service.fail_job(db, job_id, error_detail, status_code)
                            await webhook_service.dispatch_webhooks(
                                db, "job.failed",
                                {"job_id": job_id, "error": error_detail, "status_code": status_code},
                                tenant_id=tenant_id,
                            )
                        else:
                            result_data = data.get("data")
                            # Complete the last step in the pipeline
                            if existing_job and existing_job.current_step:
                                job_service.complete_step(db, job_id, existing_job.current_step, result_data)
                            job_service.complete_job(db, job_id, result_data)
                            await webhook_service.dispatch_webhooks(
                                db, "job.completed",
                                {"job_id": job_id, "result": result_data},
                                tenant_id=tenant_id,
                            )
                    except Exception as exc:
                        outcome = "error"
                        agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                        logger.exception("Failed to persist job result for %s", job_id)
                    finally:
                        db.close()
                finally:
                    agent_messages_consumed_total.labels(_AGENT, "task.completed", outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("Result consumer error, reconnecting in 5s")
            await asyncio.sleep(5)
        finally:
            if consumer:
                await consumer.stop()


async def _route_steps():
    """
    Background: consume all *.validated topics → route to next step via Pipeline Router.
    Topic list is built from agent registry + graph pipelines after startup load.
    """
    while True:
        consumer = None
        try:
            topics = list(get_all_validated_topics())
            logger.info("Router subscribing to validated topics: %s", topics)

            consumer = await get_consumer(topics, "orchestrator-router")
            async for msg in consumer:
                started = time.monotonic()
                data = msg.value
                job_id = data.get("job_id")
                source_topic = msg.topic if hasattr(msg, "topic") else data.get("_source_topic", "")
                if not job_id:
                    agent_messages_consumed_total.labels(_AGENT, source_topic or "unknown", "dropped").inc()
                    continue

                # Inject source topic so graph router knows which node completed
                data["_source_topic"] = source_topic

                step_name = data.get("step_name", "transcribe")
                step_output = data.get("output", data.get("data", data.get("transcript", {})))

                set_job_context(job_id=job_id)
                outcome = "success"
                try:
                    await route_step_completion(job_id, step_name, step_output, data)
                except Exception as exc:
                    outcome = "error"
                    agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                    logger.exception("Pipeline routing failed for %s", job_id)
                finally:
                    agent_messages_consumed_total.labels(_AGENT, source_topic or "unknown", outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("Step router error, reconnecting in 5s")
            await asyncio.sleep(5)
        finally:
            if consumer:
                await consumer.stop()


async def _handle_validation_failures():
    """Background: consume validation.failed -> retry agent or fail job."""
    while True:
        consumer = None
        try:
            consumer = await get_consumer("validation.failed", "orchestrator-validator")
            async for msg in consumer:
                started = time.monotonic()
                data = msg.value
                job_id = data.get("job_id")
                if not job_id:
                    agent_messages_consumed_total.labels(_AGENT, "validation.failed", "dropped").inc()
                    continue

                step_name = data.get("step_name", "")
                rule_violated = data.get("rule_violated", "unknown")
                error_detail = data.get("error_detail", "")
                original_message = data.get("original_message", {})

                set_job_context(job_id=job_id)
                outcome = "success"
                try:
                    await handle_validation_failure(
                        job_id, step_name, rule_violated, error_detail, original_message,
                    )
                except Exception as exc:
                    outcome = "error"
                    agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                    logger.exception("Validation failure handling failed for %s", job_id)
                finally:
                    agent_messages_consumed_total.labels(_AGENT, "validation.failed", outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("Validation failure consumer error, reconnecting in 5s")
            await asyncio.sleep(5)
        finally:
            if consumer:
                await consumer.stop()


async def _consume_dlq():
    """Background: consume agent.deadletter → write dead_letter_log row."""
    while True:
        consumer = None
        try:
            consumer = await get_consumer("agent.deadletter", "orchestrator-dlq")
            async for msg in consumer:
                started = time.monotonic()
                data = msg.value
                job_id = data.get("job_id", "unknown")
                set_job_context(job_id=job_id)
                outcome = "success"
                try:
                    db = AppSessionLocal()
                    try:
                        record = DeadLetterLog(
                            job_id=job_id,
                            step_name=data.get("step_name"),
                            topic=data.get("topic"),
                            error=data.get("error"),
                            original_message=data.get("original_message"),
                        )
                        db.add(record)
                        db.commit()
                        logger.info("DLQ: wrote dead_letter_log for job %s step %s", job_id, data.get("step_name"))
                    except Exception as exc:
                        outcome = "error"
                        agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                        logger.exception("DLQ: failed to write dead_letter_log for job %s", job_id)
                        try:
                            db.rollback()
                        except Exception:
                            pass
                    finally:
                        db.close()
                finally:
                    agent_messages_consumed_total.labels(_AGENT, "agent.deadletter", outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("DLQ consumer error, reconnecting in 5s")
            await asyncio.sleep(5)
        finally:
            if consumer:
                await consumer.stop()


async def _consume_aggregator_partial():
    """Background: consume aggregator.partial → write to Redis stream per job_id for SSE relay."""
    import json as _json
    while True:
        consumer = None
        try:
            consumer = await get_consumer("aggregator.partial", "orchestrator-aggregator-partial")
            async for msg in consumer:
                data = msg.value
                job_id = data.get("job_id")
                if not job_id:
                    continue
                try:
                    r = await get_redis()
                    # Store in a Redis stream keyed per job — SSE tails this
                    await r.xadd(
                        f"aggregator_partial:{job_id}",
                        {"payload": _json.dumps(data)},
                        maxlen=50,
                    )
                    await r.expire(f"aggregator_partial:{job_id}", 600)
                except Exception as redis_err:
                    logger.debug("aggregator.partial Redis write failed: %s", redis_err)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("aggregator.partial consumer error — reconnecting in 10s")
            await asyncio.sleep(10)
        finally:
            if consumer:
                await consumer.stop()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tables managed by Alembic — migrations run in entrypoint.sh before uvicorn starts.
    # Seed system roles (idempotent)
    _app_db = AppSessionLocal()
    try:
        seed_roles(_app_db)
    except Exception:
        logger.warning("Could not seed roles — DB may not be ready yet")
    finally:
        _app_db.close()

    # Seed default admin + superadmin users (idempotent)
    # User model is AppBase → must use AppSessionLocal (APP_DATABASE_URL), not SessionLocal
    _seed_db = AppSessionLocal()
    try:
        seed_admin_user(_seed_db)
        seed_superadmin_user(_seed_db)
    except Exception:
        logger.warning("Could not seed admin/superadmin users — DB may not be ready yet")
    finally:
        _seed_db.close()

    # Ensure Authentik has the haidoc_role scope property mapping (idempotent)
    try:
        await asyncio.to_thread(setup_role_claim_mapping)
    except Exception:
        logger.warning("Authentik role claim mapping setup skipped — Authentik may not be ready yet")

    # Load agent registry + pipeline templates from ConfigService
    try:
        await _load_registry()
    except Exception:
        logger.warning("Could not load agent registry on startup (will retry on first use)")

    async def _periodic_cache_refresh():
        while True:
            await asyncio.sleep(60)
            try:
                await _load_registry()
                logger.info("Pipeline cache auto-refreshed")
            except Exception:
                logger.warning("Periodic cache refresh failed — will retry in 60s")

    result_task = asyncio.create_task(_consume_results())
    route_task = asyncio.create_task(_route_steps())
    validation_task = asyncio.create_task(_handle_validation_failures())
    dlq_task = asyncio.create_task(_consume_dlq())
    refresh_task = asyncio.create_task(_periodic_cache_refresh())
    partial_task = asyncio.create_task(_consume_aggregator_partial())
    lag_task = asyncio.create_task(kafka_lag_collector_loop())
    yield
    result_task.cancel()
    route_task.cancel()
    validation_task.cancel()
    dlq_task.cancel()
    refresh_task.cancel()
    partial_task.cancel()
    lag_task.cancel()
    try:
        await asyncio.gather(
            result_task,
            route_task,
            validation_task,
            dlq_task,
            refresh_task,
            partial_task,
            lag_task,
            return_exceptions=True,
        )
    except asyncio.CancelledError:
        pass


import os as _os
_CONFIG_URL = _os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
_REDIS_URL = _os.getenv("REDIS_URL", "redis://redis:6379")

app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
mount_metrics_endpoint(app)
app.include_router(make_health_router({
    "postgres": check_postgres(),
    "config_service": check_http(f"{_CONFIG_URL}/health/live"),
    "redis": check_redis(_REDIS_URL),
}))

cors_origins = get_config("cors_origins", ["http://localhost:5173"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
