"""Refactor orgs (remove key cols), add org_id to access_keys, drop pipeline_templates.

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-04-28 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "l6m7n8o9p0q1"
down_revision: Union[str, Sequence[str], None] = "k5l6m7n8o9p0"
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
    # ── jobs: drop org_id + external_ref ─────────────────────────────────────
    if _index_exists("idx_jobs_org_id"):
        op.drop_index("idx_jobs_org_id", table_name="jobs")
    if _column_exists("jobs", "org_id"):
        op.drop_column("jobs", "org_id")
    if _column_exists("jobs", "external_ref"):
        op.drop_column("jobs", "external_ref")

    # ── organisations: strip key columns, keep grouping cols ─────────────────
    if _column_exists("organisations", "key_prefix"):
        op.drop_column("organisations", "key_prefix")
    if _column_exists("organisations", "key_hash"):
        # key_hash had a unique constraint — drop it first
        bind = op.get_bind()
        result = bind.execute(
            sa.text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'organisations'::regclass AND contype = 'u'"
            )
        )
        for row in result:
            op.drop_constraint(row[0], "organisations", type_="unique")
        op.drop_column("organisations", "key_hash")
    if _column_exists("organisations", "rate_limit_rpm"):
        op.drop_column("organisations", "rate_limit_rpm")
    if _column_exists("organisations", "allowed_pipeline_ids"):
        op.drop_column("organisations", "allowed_pipeline_ids")

    # ── access_keys: add nullable org_id ─────────────────────────────────────
    if not _column_exists("access_keys", "org_id"):
        op.add_column(
            "access_keys",
            sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    if not _index_exists("idx_access_keys_org_id"):
        op.create_index("idx_access_keys_org_id", "access_keys", ["org_id"])

    # ── pipeline_templates: drop (ConfigService legacy table, no Alembic there) ──
    if _table_exists("pipeline_templates"):
        op.drop_table("pipeline_templates")


def downgrade() -> None:
    # Restore pipeline_templates
    op.create_table(
        "pipeline_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("steps", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Remove org_id from access_keys
    if _index_exists("idx_access_keys_org_id"):
        op.drop_index("idx_access_keys_org_id", table_name="access_keys")
    op.drop_column("access_keys", "org_id")

    # Restore organisations key columns
    op.add_column("organisations", sa.Column("allowed_pipeline_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"))
    op.add_column("organisations", sa.Column("rate_limit_rpm", sa.Integer(), nullable=False, server_default="120"))
    op.add_column("organisations", sa.Column("key_hash", sa.String(64), nullable=False, server_default=""))
    op.create_unique_constraint("uq_organisations_key_hash", "organisations", ["key_hash"])
    op.add_column("organisations", sa.Column("key_prefix", sa.String(16), nullable=False, server_default=""))

    # Restore jobs columns
    op.add_column("jobs", sa.Column("external_ref", sa.Text(), nullable=True))
    op.add_column("jobs", sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("idx_jobs_org_id", "jobs", ["org_id"])
