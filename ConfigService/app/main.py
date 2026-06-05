import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy import text
from app.core.database import Base, engine
from app.api.routes.config_routes import router as config_router
from app.api.routes.prompt_routes import router as prompt_router
from app.api.routes.agent_routes import router as agent_router
from app.api.routes.validation_routes import router as validation_router
from app.api.routes.feature_routes import router as feature_router
from app.api.routes.pipeline_graph_routes import router as pipeline_graph_router
from app.api.routes.llm_routes import router as llm_router
from app.api.routes.agent_definition_routes import router as agent_definition_router
from app.api.routes.response_merger_routes import router as response_merger_router
from app.api.routes.agent_runtime_config_routes import router as agent_runtime_config_router
from app.api.routes.aggregator_routes import router as aggregator_router

# Import models so Base.metadata knows about them
from app.models import config_entry, prompt_template, agent_registry, validation_rule, feature_flag  # noqa: F401
from app.models import pipeline_definition, llm_instance  # noqa: F401 — Phase A models
from app.models import agent_definition  # noqa: F401 — Generic agent definitions
from app.models import response_merger  # noqa: F401 — ResponseMerger definitions
from app.models import agent_runtime_config  # noqa: F401 — AS-2
from app.models import aggregator_definition  # noqa: F401 — AG-1
from app.models import navigation_model  

from app.api.routes.navigation_routes import router as navigation_router

from haidoc_obs import configure_logging, mount_metrics_endpoint, make_health_router, check_postgres
configure_logging(service="config-service")
logger = logging.getLogger(__name__)


def _run_migrations(conn):
    """Inline schema migrations — idempotent, run on every startup."""
    # Drop kafka_topic from pipeline_edges (column removed from model; routing uses agent registry)
    conn.execute(text(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='pipeline_edges' AND column_name='kafka_topic'
            ) THEN
                ALTER TABLE pipeline_edges DROP COLUMN kafka_topic;
            END IF;
        END$$;
        """
    ))
    conn.execute(text(
        """
        ALTER TABLE agent_definitions
            ADD COLUMN IF NOT EXISTS validation_rules JSONB;
        """
    ))
    # AG-1: aggregator_id on pipeline_nodes (added after initial schema creation)
    conn.execute(text(
        """
        ALTER TABLE pipeline_nodes
            ADD COLUMN IF NOT EXISTS aggregator_id UUID
            REFERENCES aggregator_definitions(id) ON DELETE RESTRICT;
        """
    ))
    # Prompt template structured fields
    conn.execute(text(
        """
        ALTER TABLE prompt_templates
            ADD COLUMN IF NOT EXISTS input_variables TEXT DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS output_schema   TEXT DEFAULT NULL;
        """
    ))
    # Nav item external link support
    conn.execute(text(
        """
        ALTER TABLE nav_items
            ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE;
        """
    ))
    # Sync sequences after seed inserts rows with explicit IDs (guard if seqs don't exist yet)
    conn.execute(text(
        """
        DO $$
        BEGIN
            IF to_regclass('public.nav_items_id_seq') IS NOT NULL THEN
                PERFORM setval('nav_items_id_seq',
                    GREATEST((SELECT COALESCE(MAX(id), 0) FROM nav_items), 1));
            END IF;
            IF to_regclass('public.nav_categories_id_seq') IS NOT NULL THEN
                PERFORM setval('nav_categories_id_seq',
                    GREATEST((SELECT COALESCE(MAX(id), 0) FROM nav_categories), 1));
            END IF;
        END$$;
        """
    ))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Creating database tables if they don't exist")
    Base.metadata.create_all(bind=engine)
    # Each migration runs in its own transaction so one failure doesn't poison the rest
    with engine.begin() as conn:
        _run_migrations(conn)
    yield


app = FastAPI(title="ConfigService", lifespan=lifespan)
mount_metrics_endpoint(app)
app.include_router(make_health_router({"postgres": check_postgres()}))

app.include_router(config_router)
app.include_router(prompt_router)
app.include_router(agent_router)
app.include_router(validation_router)
app.include_router(feature_router)
app.include_router(pipeline_graph_router)
app.include_router(llm_router)
app.include_router(agent_definition_router)
app.include_router(response_merger_router)
app.include_router(agent_runtime_config_router)
app.include_router(aggregator_router)
app.include_router(navigation_router)


