"""Merge heads: dead_letter_log branch + authentik_id branch.

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8, a1b2c3d4e5f6
Create Date: 2026-04-23 00:00:01.000000
"""
from typing import Sequence, Union

revision: str = "j4k5l6m7n8o9"
down_revision: Union[str, Sequence[str], None] = ("i3j4k5l6m7n8", "a1b2c3d4e5f6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
