"""add UserUsageResetLogs Model and data_limit_strategy field to user

Revision ID: d02dcfbf1517
Revises: 671621870b02
Create Date: 2023-02-01 21:10:49.830928

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd02dcfbf1517'
down_revision = '671621870b02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    userdatalimitresetstrategy = sa.Enum(
        'no_reset', 'day', 'week', 'month', 'year', name='userdatalimitresetstrategy'
    )
    userdatalimitresetstrategy.create(bind, checkfirst=True)

    tables = set(inspector.get_table_names())
    if 'user_usage_logs' not in tables:
        op.create_table(
            'user_usage_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('used_traffic_at_reset', sa.BigInteger(), nullable=False),
            sa.Column('reset_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
        inspector = sa.inspect(bind)

    if 'user_usage_logs' in set(inspector.get_table_names()):
        existing_indexes = {
            index['name'] for index in inspector.get_indexes('user_usage_logs')
        }
        index_name = op.f('ix_user_usage_logs_id')
        if index_name not in existing_indexes:
            op.create_index(index_name, 'user_usage_logs', ['id'], unique=False)

    user_columns = {column['name'] for column in inspector.get_columns('users')}
    if 'data_limit_reset_strategy' not in user_columns:
        with op.batch_alter_table('users') as batch_op:
            batch_op.add_column(
                sa.Column(
                    'data_limit_reset_strategy',
                    sa.Enum(
                        "no_reset",
                        "day",
                        "week",
                        "month",
                        "year",
                        name="userdatalimitresetstrategy",
                    ),
                    nullable=False,
                    server_default="no_reset",
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    user_columns = {column['name'] for column in inspector.get_columns('users')}
    if 'data_limit_reset_strategy' in user_columns:
        with op.batch_alter_table('users') as batch_op:
            batch_op.drop_column('data_limit_reset_strategy')

    tables = set(inspector.get_table_names())
    if 'user_usage_logs' in tables:
        existing_indexes = {
            index['name'] for index in inspector.get_indexes('user_usage_logs')
        }
        index_name = op.f('ix_user_usage_logs_id')
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name='user_usage_logs')
        op.drop_table('user_usage_logs')

    userdatalimitresetstrategy = sa.Enum(
        'no_reset', 'day', 'week', 'month', 'year', name='userdatalimitresetstrategy'
    )
    userdatalimitresetstrategy.drop(bind, checkfirst=True)
