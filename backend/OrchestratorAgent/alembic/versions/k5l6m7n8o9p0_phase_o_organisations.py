"""Phase O: organisations table + org_id / external_ref on jobs.

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-04-28 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "k5l6m7n8o9p0"
down_revision: Union[str, Sequence[str], None] = "j4k5l6m7n8o9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return table in inspector.get_table_names()


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return any(c["name"] == column for c in inspector.get_columns(table))


def _index_exists(index: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :n"),
        {"n": index},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    if not _table_exists("organisations"):
        op.create_table(
            "organisations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("key_prefix", sa.String(16), nullable=False),
            sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("rate_limit_rpm", sa.Integer(), nullable=False, server_default="120"),
            sa.Column("allowed_pipeline_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_by", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not _column_exists("jobs", "org_id"):
        op.add_column("jobs", sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True))
    if not _index_exists("idx_jobs_org_id"):
        op.create_index("idx_jobs_org_id", "jobs", ["org_id"])

    if not _column_exists("jobs", "external_ref"):
        op.add_column("jobs", sa.Column("external_ref", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "external_ref")
    op.drop_index("idx_jobs_org_id", table_name="jobs")
    op.drop_column("jobs", "org_id")
    op.drop_table("organisations")
