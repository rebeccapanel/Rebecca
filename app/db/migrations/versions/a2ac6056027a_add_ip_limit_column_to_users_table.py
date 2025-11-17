"""Add ip_limit column to users table

Revision ID: a2ac6056027a
Revises: a1b2c3d4e5f6
Create Date: 2025-11-17 23:42:33.364788

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a2ac6056027a"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    if "ip_limit" not in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(
                sa.Column(
                    "ip_limit",
                    sa.Integer(),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "ip_limit" in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("ip_limit")
