"""add role to users

Revision ID: c3f1a2b4d5e6
Revises: 53a8dce61da9
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f1a2b4d5e6'
down_revision: Union[str, Sequence[str], None] = '53a8dce61da9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add role column with server default 'user' so existing rows are valid immediately
    op.add_column(
        'users',
        sa.Column('role', sa.String(20), nullable=False, server_default='user'),
    )
    # Backfill: all users registered before RBAC are trusted admins
    op.execute("UPDATE users SET role = 'admin'")


def downgrade() -> None:
    op.drop_column('users', 'role')
