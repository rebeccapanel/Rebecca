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
    op.create_table(
        "panel_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("use_nobetci", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.add_column(
        "telegram_settings",
        sa.Column("use_telegram", sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )


def downgrade() -> None:
    op.drop_column("telegram_settings", "use_telegram")
    op.drop_table("panel_settings")
