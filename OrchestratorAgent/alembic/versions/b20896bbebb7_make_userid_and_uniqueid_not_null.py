"""make userId and uniqueId not null

Revision ID: b20896bbebb7
Revises: 70df69bfb26f
Create Date: 2026-01-05 11:42:18.679881

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b20896bbebb7'
down_revision: Union[str, Sequence[str], None] = '70df69bfb26f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'users',
        'userId',
        existing_type=sa.Integer(),
        nullable=False
    )

    op.alter_column(
        'users',
        'uniqueId',
        existing_type=sa.String(),
        nullable=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'users',
        'userId',
        existing_type=sa.Integer(),
        nullable=True
    )

    op.alter_column(
        'users',
        'uniqueId',
        existing_type=sa.String(),
        nullable=True
    )
