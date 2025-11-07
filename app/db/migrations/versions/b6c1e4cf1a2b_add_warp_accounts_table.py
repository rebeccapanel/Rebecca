"""Add warp accounts table

Revision ID: b6c1e4cf1a2b
Revises: 74f5f3f0a8c9
Create Date: 2025-11-07 04:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b6c1e4cf1a2b"
down_revision = "74f5f3f0a8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "admins" in inspector.get_table_names():
        admin_columns = {col["name"] for col in inspector.get_columns("admins")}
        if "discord_webhook" in admin_columns:
            op.drop_column("admins", "discord_webhook")

    if "notification_reminders" in inspector.get_table_names():
        op.drop_table("notification_reminders")

    op.create_table(
        "warp_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("access_token", sa.String(length=255), nullable=False),
        sa.Column("license_key", sa.String(length=64), nullable=True),
        sa.Column("private_key", sa.String(length=128), nullable=False),
        sa.Column("public_key", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("device_id", name="uq_warp_accounts_device_id"),
    )
    op.create_index(
        "ix_warp_accounts_device_id",
        "warp_accounts",
        ["device_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_warp_accounts_device_id", table_name="warp_accounts")
    op.drop_table("warp_accounts")

    op.add_column(
        "admins",
        sa.Column("discord_webhook", sa.String(length=1024), nullable=True, default=None),
    )

    op.create_table(
        "notification_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column(
            "type",
            sa.Enum("expiration_date", "data_usage", name="remindertype"),
            nullable=False,
        ),
        sa.Column("threshold", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_notification_reminders_id",
        "notification_reminders",
        ["id"],
        unique=False,
    )
