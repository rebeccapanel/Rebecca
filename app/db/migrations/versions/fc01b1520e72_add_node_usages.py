"""add node usages

Revision ID: fc01b1520e72
Revises: c106bb40c861
Create Date: 2023-05-07 12:08:23.331402

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fc01b1520e72'
down_revision = 'c106bb40c861'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'node_usages' not in tables:
        op.create_table(
            'node_usages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('node_id', sa.Integer(), nullable=True),
            sa.Column('uplink', sa.BigInteger(), nullable=True),
            sa.Column('downlink', sa.BigInteger(), nullable=True),
            sa.ForeignKeyConstraint(['node_id'], ['nodes.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('created_at', 'node_id'),
        )
        inspector = sa.inspect(bind)

    if 'node_usages' in set(inspector.get_table_names()):
        indexes = {index['name'] for index in inspector.get_indexes('node_usages')}
        index_name = op.f('ix_node_usages_id')
        if index_name not in indexes:
            op.create_index(index_name, 'node_usages', ['id'], unique=False)

    if 'node_user_usages' in tables:
        op.drop_table('node_user_usages')

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if 'node_user_usages' not in tables:
        op.create_table(
            'node_user_usages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('node_id', sa.Integer(), nullable=True),
            sa.Column('used_traffic', sa.BigInteger(), nullable=True),
            sa.ForeignKeyConstraint(['node_id'], ['nodes.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('created_at', 'user_id', 'node_id'),
        )
        inspector = sa.inspect(bind)

    if 'node_user_usages' in set(inspector.get_table_names()):
        indexes = {index['name'] for index in inspector.get_indexes('node_user_usages')}
        index_name = op.f('ix_node_user_usages_id')
        if index_name not in indexes:
            op.create_index(index_name, 'node_user_usages', ['id'], unique=False)



def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'node_usages' in tables:
        indexes = {index['name'] for index in inspector.get_indexes('node_usages')}
        index_name = op.f('ix_node_usages_id')
        if index_name in indexes:
            op.drop_index(index_name, table_name='node_usages')
        op.drop_table('node_usages')

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if 'node_user_usages' in tables:
        op.drop_table('node_user_usages')

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
        indexes = {index['name'] for index in inspector.get_indexes('node_user_usages')}
        index_name = op.f('ix_node_user_usages_id')
        if index_name not in indexes:
            op.create_index(index_name, 'node_user_usages', ['id'], unique=False)
