"""
Shared GenericValidator consumer loop.

On startup: fetches all active agent definitions from ConfigService.
Subscribes to all their output_topics.
Validates each message against the agent's validation_rules.
Produces to output_topic.validated (pass) or validation.failed (fail).
"""
from __future__ import annotations

import asyncio
import logging
import time

from app.utils.config_client import fetch_agent_definitions
from app.utils.kafka import get_consumer, get_producer
from app.services.validator import validate
from civis_obs import (
    set_job_context, clear_job_context,
    agent_messages_consumed_total, agent_processing_duration_seconds,
    agent_errors_total, validation_failures_total,
)

logger = logging.getLogger(__name__)

FAILURE_TOPIC = "validation.failed"
_AGENT = "generic_validator"


async def consume_loop():
    while True:
        consumer = None
        producer = None
        try:
            await asyncio.sleep(5)

            definitions = fetch_agent_definitions()
            if not definitions:
                logger.warning("GenericValidator: no active agent definitions found — retrying in 30s")
                await asyncio.sleep(25)
                continue

            # Map output_topic → validation_rules for fast lookup
            topic_rules: dict[str, dict | None] = {
                d["output_topic"]: d.get("validation_rules")
                for d in definitions
            }
            topics = list(topic_rules.keys())
            logger.info("GenericValidator subscribing to: %s", topics)

            consumer = await get_consumer(topics, "generic-validator-group")
            producer = await get_producer()

            async for msg in consumer:
                started = time.monotonic()
                data: dict = msg.value
                job_id = data.get("job_id", "unknown")
                source_topic: str = msg.topic
                validated_topic = f"{source_topic}.validated"
                rules = topic_rules.get(source_topic)
                set_job_context(job_id=job_id)
                outcome = "success"

                try:
                    raw_output = data.get("output")
                    is_valid, rule_violated, error_detail = validate(raw_output, rules)

                    if is_valid:
                        await producer.send_and_wait(validated_topic, {
                            **data,
                            "step_name": data.get("step_name", source_topic),
                        })
                        logger.info("GenericValidator: job %s ✓ → %s", job_id, validated_topic)
                    else:
                        await producer.send_and_wait(FAILURE_TOPIC, {
                            "job_id": job_id,
                            "step_name": data.get("step_name", source_topic),
                            "rule_violated": rule_violated,
                            "error_detail": error_detail,
                            "original_output": raw_output,
                            "original_message": data,
                        })
                        validation_failures_total.labels(_AGENT, rule_violated or "unknown").inc()
                        outcome = "validation_failed"
                        logger.warning("GenericValidator: job %s ✗ [%s] %s", job_id, rule_violated, error_detail)
                except Exception as exc:
                    outcome = "error"
                    agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                    logger.exception("GenericValidator: error for job %s", job_id)
                finally:
                    agent_messages_consumed_total.labels(_AGENT, source_topic, outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("GenericValidator: consumer error — reconnecting in 10s")
            await asyncio.sleep(10)
        finally:
            if consumer:
                await consumer.stop()
            if producer:
                await producer.stop()
