"""inbounds table & excluded_inbounds

Revision ID: e91236993f1a
Revises: 671621870b02
Create Date: 2023-02-05 23:21:27.828558

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e91236993f1a'
down_revision = '671621870b02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'inbounds' not in tables:
        op.create_table(
            'inbounds',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('tag', sa.String(256), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
        inspector = sa.inspect(bind)
        tables = set(inspector.get_table_names())

    if 'inbounds' in tables:
        existing_indexes = {index['name'] for index in inspector.get_indexes('inbounds')}
        index_name = op.f('ix_inbounds_tag')
        if index_name not in existing_indexes:
            op.create_index(index_name, 'inbounds', ['tag'], unique=True)

    if 'exclude_inbounds_association' not in tables:
        op.create_table(
            'exclude_inbounds_association',
            sa.Column('proxy_id', sa.Integer(), nullable=True),
            sa.Column('inbound_tag', sa.String(256), nullable=True),
            sa.ForeignKeyConstraint(['inbound_tag'], ['inbounds.tag']),
            sa.ForeignKeyConstraint(['proxy_id'], ['proxies.id']),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'exclude_inbounds_association' in tables:
        op.drop_table('exclude_inbounds_association')

    if 'inbounds' in tables:
        existing_indexes = {index['name'] for index in inspector.get_indexes('inbounds')}
        index_name = op.f('ix_inbounds_tag')
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name='inbounds')
        op.drop_table('inbounds')
