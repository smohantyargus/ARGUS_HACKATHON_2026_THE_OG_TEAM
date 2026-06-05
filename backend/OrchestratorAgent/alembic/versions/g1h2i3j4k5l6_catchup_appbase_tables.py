"""Catch-up: create AppBase tables that were previously managed by create_all.

Tables: jobs, job_steps, webhooks, webhook_deliveries, tenants,
        access_keys, audit_log, usage_log, roles.

All ops guarded with inspector checks so this migration is safe to run
against a DB that already has the tables (i.e. existing deployments).

Revision ID: g1h2i3j4k5l6
Revises: f1e2d3c4b5a6
Create Date: 2026-04-22 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, Sequence[str], None] = "f1e2d3c4b5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return set(inspector.get_table_names())


def upgrade() -> None:
    existing = _existing_tables()

    if "tenants" not in existing:
        op.create_table(
            "tenants",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False, unique=True),
            sa.Column("slug", sa.String(100), nullable=False, unique=True),
            sa.Column("config_overrides", postgresql.JSONB(), nullable=False, server_default="{}"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "access_keys" not in existing:
        op.create_table(
            "access_keys",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("key_prefix", sa.String(16), nullable=False),
            sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("pipeline_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
            sa.Column("rate_limit_rpm", sa.Integer(), nullable=False, server_default="60"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_by", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "roles" not in existing:
        op.create_table(
            "roles",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("is_registerable", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "jobs" not in existing:
        op.create_table(
            "jobs",
            sa.Column("job_id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
            sa.Column("pipeline", postgresql.JSONB(), nullable=False),
            sa.Column("pipeline_definition_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("access_key_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("current_step", sa.String(100), nullable=True),
            sa.Column("input_meta", postgresql.JSONB(), nullable=True),
            sa.Column("result", postgresql.JSONB(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("timeout_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "job_steps" not in existing:
        op.create_table(
            "job_steps",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.job_id"), nullable=False, index=True),
            sa.Column("step_name", sa.String(100), nullable=False),
            sa.Column("agent_name", sa.String(100), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("input", postgresql.JSONB(), nullable=True),
            sa.Column("output", postgresql.JSONB(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        )

    if "webhooks" not in existing:
        op.create_table(
            "webhooks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("url", sa.Text(), nullable=False),
            sa.Column("secret", sa.Text(), nullable=True),
            sa.Column("events", postgresql.JSONB(), nullable=False),
            sa.Column("active", sa.Boolean(), server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "webhook_deliveries" not in existing:
        op.create_table(
            "webhook_deliveries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("webhook_id", sa.Integer(), sa.ForeignKey("webhooks.id"), nullable=False, index=True),
            sa.Column("job_id", sa.String(), nullable=True, index=True),
            sa.Column("event", sa.String(64), nullable=False),
            sa.Column("attempt", sa.Integer(), server_default="1"),
            sa.Column("status", sa.String(16), server_default="pending"),
            sa.Column("response_status", sa.Integer(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("payload", postgresql.JSONB(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "audit_log" not in existing:
        op.create_table(
            "audit_log",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("user_id", sa.String(255), nullable=True),
            sa.Column("actor_type", sa.String(20), nullable=False),
            sa.Column("action", sa.String(100), nullable=False, index=True),
            sa.Column("resource", sa.String(200), nullable=True),
            sa.Column("ip_address", postgresql.INET(), nullable=True),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        )

    if "usage_log" not in existing:
        op.create_table(
            "usage_log",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("access_key_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("llm_instance_name", sa.String(100), nullable=True),
            sa.Column("tokens_in", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tokens_out", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("compute_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        )


def downgrade() -> None:
    op.drop_table("usage_log")
    op.drop_table("audit_log")
    op.drop_table("webhook_deliveries")
    op.drop_table("webhooks")
    op.drop_table("job_steps")
    op.drop_table("jobs")
    op.drop_table("roles")
    op.drop_table("access_keys")
    op.drop_table("tenants")
