import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.services.kafka_service import start
import os as _os
from haidoc_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_http
_CONFIG_URL = _os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")

configure_logging(service="reasoning_validator")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(start())
    yield
    task.cancel()
    try:
        await asyncio.gather(task, return_exceptions=True)
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({"config_service": check_http(f"{_CONFIG_URL}/health/live")}))


