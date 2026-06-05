from logging.config import fileConfig
import os

from sqlalchemy import engine_from_config, pool
from dotenv import load_dotenv
from alembic import context

load_dotenv()

# ── DB URL ─────────────────────────────────────────────────────────────────────
# Compose sets APP_DATABASE_URL; local dev may use URL_DATABASE.
APP_DATABASE_URL = os.getenv("APP_DATABASE_URL") or os.getenv("URL_DATABASE")

# ── Import ALL models so both metadata objects see all tables ──────────────────
from app.models.base import Base
from app.core.app_database import AppBase

# Side-effect imports register tables on their respective metadata objects.
from app.models import (  # noqa: F401
    user_model, feedback,
    job, webhook, tenant, access_key, audit_log, usage_log, role,
    token_usage_log,
)

target_metadata = [Base.metadata, AppBase.metadata]

# ── Alembic boilerplate ────────────────────────────────────────────────────────
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def run_migrations_offline() -> None:
    context.configure(
        url=APP_DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        {"sqlalchemy.url": APP_DATABASE_URL},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
