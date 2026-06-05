"""Phase A: add pipeline_definition_id + access_key_id to jobs table.

Idempotent — skips column add if column already exists (safe for DBs
that already ran the raw phase_a_alter.sql script).

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-04-22 00:01:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "h2i3j4k5l6m7"
down_revision: Union[str, Sequence[str], None] = "g1h2i3j4k5l6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return any(c["name"] == column for c in inspector.get_columns(table))


def _index_exists(index: str) -> bool:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    # pg_indexes check across all tables
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :n"),
        {"n": index},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    # jobs table may already have these columns if phase_a_alter.sql was run manually.
    if not _column_exists("jobs", "pipeline_definition_id"):
        op.add_column(
            "jobs",
            sa.Column("pipeline_definition_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    if not _index_exists("idx_jobs_pipeline_definition_id"):
        op.create_index("idx_jobs_pipeline_definition_id", "jobs", ["pipeline_definition_id"])

    if not _column_exists("jobs", "access_key_id"):
        op.add_column(
            "jobs",
            sa.Column("access_key_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    if not _index_exists("idx_jobs_access_key_id"):
        op.create_index("idx_jobs_access_key_id", "jobs", ["access_key_id"])


def downgrade() -> None:
    op.drop_index("idx_jobs_access_key_id", table_name="jobs")
    op.drop_column("jobs", "access_key_id")
    op.drop_index("idx_jobs_pipeline_definition_id", table_name="jobs")
    op.drop_column("jobs", "pipeline_definition_id")
