"""add telegram backup settings

Revision ID: 19_telegram_backup_settings
Revises: 18_admin_created_traffic_service
Create Date: 2026-05-05 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "19_telegram_backup_settings"
down_revision = "18_admin_created_traffic_service"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _has_table("telegram_settings"):
        return

    with op.batch_alter_table("telegram_settings") as batch:
        if not _has_column("telegram_settings", "backup_enabled"):
            batch.add_column(sa.Column("backup_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if not _has_column("telegram_settings", "backup_scope"):
            batch.add_column(
                sa.Column("backup_scope", sa.String(length=16), nullable=False, server_default=sa.text("'database'"))
            )
        if not _has_column("telegram_settings", "backup_interval_value"):
            batch.add_column(sa.Column("backup_interval_value", sa.Integer(), nullable=False, server_default=sa.text("24")))
        if not _has_column("telegram_settings", "backup_interval_unit"):
            batch.add_column(
                sa.Column("backup_interval_unit", sa.String(length=16), nullable=False, server_default=sa.text("'hours'"))
            )
        if not _has_column("telegram_settings", "backup_last_sent_at"):
            batch.add_column(sa.Column("backup_last_sent_at", sa.DateTime(), nullable=True))
        if not _has_column("telegram_settings", "backup_last_error"):
            batch.add_column(sa.Column("backup_last_error", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    if not _has_table("telegram_settings"):
        return

    with op.batch_alter_table("telegram_settings") as batch:
        for column_name in (
            "backup_last_error",
            "backup_last_sent_at",
            "backup_interval_unit",
            "backup_interval_value",
            "backup_scope",
            "backup_enabled",
        ):
            if _has_column("telegram_settings", column_name):
                batch.drop_column(column_name)
