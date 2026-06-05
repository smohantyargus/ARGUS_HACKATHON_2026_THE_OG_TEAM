"""change uniqueId type

Revision ID: 70df69bfb26f
Revises: 1bcff99cc0c1
Create Date: 2026-01-05 11:33:52.665820

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '70df69bfb26f'
down_revision: Union[str, Sequence[str], None] = '1bcff99cc0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'users',
        'uniqueId',
        existing_type=sa.Integer(),
        type_=sa.String(),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'users',
        'uniqueId',
        existing_type=sa.String(),
        type_=sa.Integer(),
        existing_nullable=True,
    )
