"""user_auto_delete_in_days

Revision ID: ccbf9d322ae3
Revises: 4f045f53bef8
Create Date: 2024-04-22 12:37:35.439501

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ccbf9d322ae3'
down_revision = '4f045f53bef8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    if "auto_delete_in_days" not in user_columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(
                sa.Column("auto_delete_in_days", sa.Integer(), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    if "auto_delete_in_days" in user_columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("auto_delete_in_days")
