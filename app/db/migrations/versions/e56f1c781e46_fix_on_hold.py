"""Fix on hold

Revision ID: e56f1c781e46
Revises: 714f227201a7
Create Date: 2023-11-03 20:47:52.601783
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e56f1c781e46'
down_revision = '714f227201a7'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column['name'] for column in inspector.get_columns('users')}

    needs_timeout_drop = 'timeout' in user_columns
    needs_on_hold_timeout = 'on_hold_timeout' not in user_columns
    needs_on_hold_duration = 'on_hold_expire_duration' not in user_columns

    if needs_on_hold_timeout or needs_on_hold_duration:
        with op.batch_alter_table('users') as batch_op:
            if needs_on_hold_timeout:
                batch_op.add_column(sa.Column('on_hold_timeout', sa.DateTime))
            if needs_on_hold_duration:
                batch_op.add_column(
                    sa.Column('on_hold_expire_duration', sa.BigInteger(), nullable=True)
                )

    if needs_timeout_drop:
        with op.batch_alter_table('users') as batch_op:
            batch_op.drop_column('timeout')


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column['name'] for column in inspector.get_columns('users')}

    needs_timeout_add = 'timeout' not in user_columns
    needs_on_hold_timeout_drop = 'on_hold_timeout' in user_columns
    needs_on_hold_duration_drop = 'on_hold_expire_duration' in user_columns

    if needs_timeout_add:
        with op.batch_alter_table('users') as batch_op:
            batch_op.add_column(sa.Column('timeout', sa.Integer))

    if needs_on_hold_timeout_drop or needs_on_hold_duration_drop:
        with op.batch_alter_table('users') as batch_op:
            if needs_on_hold_timeout_drop:
                batch_op.drop_column('on_hold_timeout')
            if needs_on_hold_duration_drop:
                batch_op.drop_column('on_hold_expire_duration')
