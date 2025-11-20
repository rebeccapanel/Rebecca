"""node_user_usages

Revision ID: e4a86bc8ec7b
Revises: 37692c1c9715
Create Date: 2023-05-03 14:45:25.800476

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e4a86bc8ec7b'
down_revision = '37692c1c9715'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'node_user_usages' not in tables:
        op.create_table(
            'node_user_usages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_username', sa.String(34), nullable=True),
            sa.Column('node_id', sa.Integer(), nullable=True),
            sa.Column('used_traffic', sa.BigInteger(), nullable=True),
            sa.ForeignKeyConstraint(['node_id'], ['nodes.id']),
            sa.ForeignKeyConstraint(['user_username'], ['users.username']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_username', 'node_id'),
        )
        inspector = sa.inspect(bind)

    if 'node_user_usages' in set(inspector.get_table_names()):
        existing_indexes = {
            index['name'] for index in inspector.get_indexes('node_user_usages')
        }
        index_name = op.f('ix_node_user_usages_id')
        if index_name not in existing_indexes:
            op.create_index(index_name, 'node_user_usages', ['id'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'node_user_usages' in tables:
        existing_indexes = {
            index['name'] for index in inspector.get_indexes('node_user_usages')
        }
        index_name = op.f('ix_node_user_usages_id')
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name='node_user_usages')
        op.drop_table('node_user_usages')
