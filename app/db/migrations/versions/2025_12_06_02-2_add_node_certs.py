"""add node certificates

Revision ID: 1_add_user_flow
Revises: 2_add_node_certs
Create Date: 2025-12-06 02:09:03.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '2_add_node_certs'
down_revision = '1_add_user_flow'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    node_columns = {column['name'] for column in inspector.get_columns('nodes')}
    
    if 'certificate' not in node_columns:
        op.add_column('nodes', sa.Column('certificate', sa.Text(), nullable=True))
    
    if 'certificate_key' not in node_columns:
        op.add_column('nodes', sa.Column('certificate_key', sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    node_columns = {column['name'] for column in inspector.get_columns('nodes')}
    
    if 'certificate' in node_columns:
        op.drop_column('nodes', 'certificate')
    
    if 'certificate_key' in node_columns:
        op.drop_column('nodes', 'certificate_key')

