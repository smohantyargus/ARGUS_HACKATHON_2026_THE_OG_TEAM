"""add password_hash and auth_type to users

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-05-19 00:00:00

Fills schema drift exposed at orchestrator startup: the User model
already declared `password_hash`, but no migration created the column,
so seed-admin failed with `psycopg2.errors.UndefinedColumn`.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n8o9p0q1r2s3"
down_revision: Union[str, Sequence[str], None] = "m7n8o9p0q1r2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return any(col["name"] == column for col in insp.get_columns(table))


def upgrade() -> None:
    if not _has_column("users", "password_hash"):
        op.add_column(
            "users",
            sa.Column("password_hash", sa.String(length=255), nullable=True),
        )

    if not _has_column("users", "auth_type"):
        op.add_column(
            "users",
            sa.Column(
                "auth_type",
                sa.String(length=32),
                nullable=False,
                server_default="jwt",
            ),
        )


def downgrade() -> None:
    if _has_column("users", "auth_type"):
        op.drop_column("users", "auth_type")
    if _has_column("users", "password_hash"):
        op.drop_column("users", "password_hash")
