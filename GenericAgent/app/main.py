import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.services.kafka_service import consume_loop
from civis_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_http

_CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")

configure_logging(service="generic_agent")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("GenericAgent starting — will load all active agent definitions")
    task = asyncio.create_task(consume_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="GenericAgent", lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({"config_service": check_http(f"{_CONFIG_URL}/health/live")}))
