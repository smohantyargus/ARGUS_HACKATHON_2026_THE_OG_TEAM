"""Add token_usage_log table for per-LLM-call tracking.

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-05-10 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "m7n8o9p0q1r2"
down_revision: Union[str, Sequence[str], None] = "l6m7n8o9p0q1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return table in inspector.get_table_names()


def upgrade() -> None:
    if _table_exists("token_usage_log"):
        return

    op.create_table(
        "token_usage_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_name", sa.String(100), nullable=True),
        sa.Column("service_name", sa.String(100), nullable=True),
        sa.Column("model_name", sa.String(150), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_token_usage_log_job_id", "token_usage_log", ["job_id"])
    op.create_index("ix_token_usage_log_pipeline_id", "token_usage_log", ["pipeline_id"])
    op.create_index("ix_token_usage_log_agent_name", "token_usage_log", ["agent_name"])
    op.create_index("ix_token_usage_log_request_id", "token_usage_log", ["request_id"])
    op.create_index("ix_token_usage_log_created_at", "token_usage_log", ["created_at"])
    op.create_index(
        "idx_token_usage_pipeline_agent",
        "token_usage_log",
        ["pipeline_id", "agent_name"],
    )
    op.create_index(
        "idx_token_usage_job_agent",
        "token_usage_log",
        ["job_id", "agent_name"],
    )


def downgrade() -> None:
    if not _table_exists("token_usage_log"):
        return
    for idx in (
        "idx_token_usage_job_agent",
        "idx_token_usage_pipeline_agent",
        "ix_token_usage_log_created_at",
        "ix_token_usage_log_request_id",
        "ix_token_usage_log_agent_name",
        "ix_token_usage_log_pipeline_id",
        "ix_token_usage_log_job_id",
    ):
        op.drop_index(idx, table_name="token_usage_log")
    op.drop_table("token_usage_log")
