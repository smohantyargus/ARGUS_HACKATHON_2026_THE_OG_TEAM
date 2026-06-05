import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.services.kafka_service import start
from civis_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_postgres

_QUERY_DB_URL = os.getenv("QUERY_DB_URL")

configure_logging(service="data_query_agent")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DataQueryAgent starting — serving named read-only queries over data.request")
    task = asyncio.create_task(start())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="DataQueryAgent", lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({"app_db": check_postgres(_QUERY_DB_URL)}))
