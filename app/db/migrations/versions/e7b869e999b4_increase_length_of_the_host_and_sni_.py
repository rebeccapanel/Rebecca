"""increase length of the host and sni columns

Revision ID: e7b869e999b4
Revises: be0c5f840473
Create Date: 2024-12-12 15:41:55.487859

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'e7b869e999b4'
down_revision = 'be0c5f840473'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column['name']: column for column in inspector.get_columns('hosts')}

    def get_length(column_name: str):
        column = columns.get(column_name)
        if column is None:
            return None
        return getattr(column.get('type'), 'length', None)

    def needs_resize(column_name: str, target: int) -> bool:
        length = get_length(column_name)
        column = columns.get(column_name)
        if column is None:
            return False
        return length is None or length < target

    resize_host = needs_resize('host', 1000)
    resize_sni = needs_resize('sni', 1000)

    if resize_host or resize_sni:
        with op.batch_alter_table('hosts') as batch_op:
            if resize_host:
                batch_op.alter_column(
                    'host',
                    existing_type=sa.String(length=get_length('host') or 256),
                    type_=sa.String(length=1000),
                    nullable=True,
                )
            if resize_sni:
                batch_op.alter_column(
                    'sni',
                    existing_type=sa.String(length=get_length('sni') or 256),
                    type_=sa.String(length=1000),
                    nullable=True,
                )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column['name']: column for column in inspector.get_columns('hosts')}

    def get_length(column_name: str):
        column = columns.get(column_name)
        if column is None:
            return None
        return getattr(column.get('type'), 'length', None)

    def needs_shrink(column_name: str, target: int) -> bool:
        length = get_length(column_name)
        return length is not None and length > target

    shrink_host = needs_shrink('host', 256)
    shrink_sni = needs_shrink('sni', 256)

    if shrink_host or shrink_sni:
        with op.batch_alter_table('hosts') as batch_op:
            if shrink_host:
                batch_op.alter_column(
                    'host',
                    existing_type=sa.String(length=get_length('host') or 1000),
                    type_=sa.String(length=256),
                    nullable=True,
                )
            if shrink_sni:
                batch_op.alter_column(
                    'sni',
                    existing_type=sa.String(length=get_length('sni') or 1000),
                    type_=sa.String(length=256),
                    nullable=True,
                )
