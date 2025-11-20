"""remove certficiate from nodes

Revision ID: fe7796f840a4
Revises: 7a0dbb8a2f65
Create Date: 2023-10-25 15:38:32.121840

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = 'fe7796f840a4'
down_revision = '7a0dbb8a2f65'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    node_columns = {column['name'] for column in inspector.get_columns('nodes')}
    if 'certificate' in node_columns:
        with op.batch_alter_table('nodes') as batch_op:
            batch_op.drop_column('certificate')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    node_columns = {column['name'] for column in inspector.get_columns('nodes')}
    if 'certificate' not in node_columns:
        with op.batch_alter_table('nodes') as batch_op:
            batch_op.add_column(sa.Column(
                'certificate', mysql.VARCHAR(length=2048),
                nullable=False, server_default=''))
