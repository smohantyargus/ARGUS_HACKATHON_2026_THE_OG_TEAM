import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.services.kafka_service import consume_loop
import os as _os
from haidoc_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_http, check_redis
_CONFIG_URL = _os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
_REDIS_URL = _os.getenv("REDIS_URL", "redis://redis:6379")

configure_logging(service="response_merger")
logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _task
    _task = asyncio.create_task(consume_loop())
    logger.info("ResponseMerger started")
    yield
    if _task:
        _task.cancel()


app = FastAPI(title="ResponseMerger", lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({
    "config_service": check_http(f"{_CONFIG_URL}/health/live"),
    "redis": check_redis(_REDIS_URL),
}))


