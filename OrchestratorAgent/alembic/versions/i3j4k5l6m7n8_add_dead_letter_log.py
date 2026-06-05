"""Add dead_letter_log table (I7 — DLQ).

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-04-23 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

revision: str = "i3j4k5l6m7n8"
down_revision: Union[str, Sequence[str], None] = "h2i3j4k5l6m7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return set(inspector.get_table_names())


def upgrade() -> None:
    if "dead_letter_log" not in _existing_tables():
        op.create_table(
            "dead_letter_log",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.String(255), nullable=False, index=True),
            sa.Column("step_name", sa.String(100), nullable=True),
            sa.Column("topic", sa.String(200), nullable=True),
            sa.Column("error", sa.Text, nullable=True),
            sa.Column("original_message", postgresql.JSONB, nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                index=True,
            ),
        )


def downgrade() -> None:
    op.drop_table("dead_letter_log")
