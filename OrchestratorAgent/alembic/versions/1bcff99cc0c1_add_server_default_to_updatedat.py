"""add server default to updatedAt

Revision ID: 1bcff99cc0c1
Revises: e7510b367775
Create Date: 2026-01-05 10:48:56.180669

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1bcff99cc0c1'
down_revision: Union[str, Sequence[str], None] = 'e7510b367775'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'users',
        'updatedAt',
        server_default=sa.func.now()
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'users',
        'updatedAt',
        server_default=None
    )
