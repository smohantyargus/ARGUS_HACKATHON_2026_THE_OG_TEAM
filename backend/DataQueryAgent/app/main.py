import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.services.kafka_service import start
from app.api.routes.dictionary_routes import router as dictionary_router
from app.api.routes.record_routes import router as record_router
from civis_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_postgres

_QUERY_DB_URL = os.getenv("QUERY_DB_URL")

configure_logging(service="data_query_agent")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DataQueryAgent starting — multi-domain data platform + Kafka query bus")
    task = asyncio.create_task(start())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="DataQueryAgent — Multi-Domain Data Platform", lifespan=lifespan)

mount_metrics_endpoint(app)
app.include_router(make_health_router({"app_db": check_postgres(_QUERY_DB_URL)}))

# Dictionary CRUD (domains / entities / fields / queries / members / onboard / import)
app.include_router(dictionary_router)

# Records CRUD (generic JSONB store, dictionary-validated)
app.include_router(record_router)
