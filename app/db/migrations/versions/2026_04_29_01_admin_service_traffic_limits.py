"""add admin service traffic limits

Revision ID: 17_admin_service_traffic_limits
Revises: 16_node_xray_configs
Create Date: 2026-04-29 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "17_admin_service_traffic_limits"
down_revision = "16_node_xray_configs"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    traffic_mode_enum = sa.Enum("used_traffic", "created_traffic", name="admintrafficlimitmode")

    with op.batch_alter_table("admins") as batch:
        if not _has_column("admins", "deleted_users_usage"):
            batch.add_column(sa.Column("deleted_users_usage", sa.BigInteger(), nullable=False, server_default="0"))
        if not _has_column("admins", "use_service_traffic_limits"):
            batch.add_column(
                sa.Column("use_service_traffic_limits", sa.Boolean(), nullable=False, server_default=sa.text("0"))
            )
        if not _has_column("admins", "delete_user_usage_limit_enabled"):
            batch.add_column(
                sa.Column("delete_user_usage_limit_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0"))
            )
        if not _has_column("admins", "delete_user_usage_limit"):
            batch.add_column(sa.Column("delete_user_usage_limit", sa.BigInteger(), nullable=True))

    with op.batch_alter_table("admins_services") as batch:
        if not _has_column("admins_services", "created_traffic"):
            batch.add_column(sa.Column("created_traffic", sa.BigInteger(), nullable=False, server_default="0"))
        if not _has_column("admins_services", "deleted_users_usage"):
            batch.add_column(sa.Column("deleted_users_usage", sa.BigInteger(), nullable=False, server_default="0"))
        if not _has_column("admins_services", "data_limit"):
            batch.add_column(sa.Column("data_limit", sa.BigInteger(), nullable=True))
        if not _has_column("admins_services", "traffic_limit_mode"):
            batch.add_column(
                sa.Column(
                    "traffic_limit_mode",
                    traffic_mode_enum,
                    nullable=False,
                    server_default="used_traffic",
                )
            )
        if not _has_column("admins_services", "show_user_traffic"):
            batch.add_column(sa.Column("show_user_traffic", sa.Boolean(), nullable=False, server_default=sa.text("1")))
        if not _has_column("admins_services", "users_limit"):
            batch.add_column(sa.Column("users_limit", sa.Integer(), nullable=True))
        if not _has_column("admins_services", "delete_user_usage_limit_enabled"):
            batch.add_column(
                sa.Column(
                    "delete_user_usage_limit_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )
        if not _has_column("admins_services", "delete_user_usage_limit"):
            batch.add_column(sa.Column("delete_user_usage_limit", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("admins_services") as batch:
        for column_name in (
            "delete_user_usage_limit",
            "delete_user_usage_limit_enabled",
            "users_limit",
            "show_user_traffic",
            "traffic_limit_mode",
            "data_limit",
            "deleted_users_usage",
            "created_traffic",
        ):
            if _has_column("admins_services", column_name):
                batch.drop_column(column_name)

    with op.batch_alter_table("admins") as batch:
        for column_name in (
            "delete_user_usage_limit",
            "delete_user_usage_limit_enabled",
            "use_service_traffic_limits",
            "deleted_users_usage",
        ):
            if _has_column("admins", column_name):
                batch.drop_column(column_name)
