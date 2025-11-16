"""Add panel settings table and Telegram enable toggle

Revision ID: e7b4d8f0a1c2
Revises: d4b5c6d7e8f9
Create Date: 2025-11-09 07:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e7b4d8f0a1c2"
down_revision = "d4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "panel_settings" not in tables:
        op.create_table(
            "panel_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "use_nobetci", sa.Boolean(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column(
                "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
            ),
            sa.Column(
                "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
            ),
        )

    if "telegram_settings" in tables:
        telegram_columns = {
            column["name"] for column in inspector.get_columns("telegram_settings")
        }
        if "use_telegram" not in telegram_columns:
            with op.batch_alter_table("telegram_settings") as batch_op:
                batch_op.add_column(
                    sa.Column(
                        "use_telegram", sa.Boolean(), nullable=False, server_default=sa.text("1")
                    )
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "telegram_settings" in tables:
        telegram_columns = {
            column["name"] for column in inspector.get_columns("telegram_settings")
        }
        if "use_telegram" in telegram_columns:
            with op.batch_alter_table("telegram_settings") as batch_op:
                batch_op.drop_column("use_telegram")

    if "panel_settings" in tables:
        op.drop_table("panel_settings")
