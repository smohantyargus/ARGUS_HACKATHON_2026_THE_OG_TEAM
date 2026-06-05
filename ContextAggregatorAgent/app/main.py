import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from haidoc_obs import configure_logging, mount_metrics_endpoint, make_health_router

configure_logging(service="context-aggregator")
logger = logging.getLogger(__name__)

AGGREGATOR_NAME = os.getenv("AGGREGATOR_NAME", "aggregator")
_consumer_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _consumer_task
    from app.services.kafka_service import consume_loop
    _consumer_task = asyncio.create_task(consume_loop())
    logger.info("ContextAggregatorAgent[%s] started", AGGREGATOR_NAME)
    yield
    if _consumer_task:
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title=f"ContextAggregatorAgent[{AGGREGATOR_NAME}]", lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({}))
