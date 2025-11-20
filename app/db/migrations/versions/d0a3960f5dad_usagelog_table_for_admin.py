"""UsageLog table for Admin

Revision ID: d0a3960f5dad
Revises: b25e7e6be241
Create Date: 2024-11-22 19:56:53.185624

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd0a3960f5dad'
down_revision = 'b25e7e6be241'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'admin_usage_logs' not in set(inspector.get_table_names()):
        op.create_table(
            'admin_usage_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('admin_id', sa.Integer(), nullable=True),
            sa.Column('used_traffic_at_reset', sa.BigInteger(), nullable=False),
            sa.Column('reset_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['admin_id'], ['admins.id']),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'admin_usage_logs' in set(inspector.get_table_names()):
        op.drop_table('admin_usage_logs')
