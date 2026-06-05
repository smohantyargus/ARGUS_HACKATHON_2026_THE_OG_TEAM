"""add output feedback table

Revision ID: f1e2d3c4b5a6
Revises: c3f1a2b4d5e6
Create Date: 2026-04-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, Sequence[str], None] = 'c3f1a2b4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'output_feedback',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('job_id', sa.String(), nullable=False),
        sa.Column('tenant_id', sa.String(), nullable=True),
        sa.Column('output_type', sa.String(100), nullable=False),
        sa.Column('field', sa.String(100), nullable=True),
        sa.Column('rating', sa.SmallInteger(), nullable=False),
        sa.Column('correction', sa.Text(), nullable=True),
        sa.Column('submitted_by', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_output_feedback_job_id', 'output_feedback', ['job_id'])


def downgrade() -> None:
    op.drop_index('ix_output_feedback_job_id', table_name='output_feedback')
    op.drop_table('output_feedback')
