"""add lifetime_usage column to admins

Revision ID: 6b82cec33861
Revises: cbc81a0e2298
Create Date: 2025-10-23 13:46:58.201626

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6b82cec33861'
down_revision = 'cbc81a0e2298'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('admins', sa.Column('lifetime_usage', sa.BigInteger(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('admins', 'lifetime_usage')