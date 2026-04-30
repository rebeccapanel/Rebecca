"""add service scope to admin created traffic logs

Revision ID: 18_admin_created_traffic_service
Revises: 17_admin_service_traffic_limits
Create Date: 2026-04-30 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "18_admin_created_traffic_service"
down_revision = "17_admin_service_traffic_limits"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    with op.batch_alter_table("admin_created_traffic_logs") as batch:
        if not _has_column("admin_created_traffic_logs", "service_id"):
            batch.add_column(sa.Column("service_id", sa.Integer(), nullable=True))

    if not _has_index("admin_created_traffic_logs", "ix_admin_created_traffic_logs_service_id"):
        op.create_index(
            op.f("ix_admin_created_traffic_logs_service_id"),
            "admin_created_traffic_logs",
            ["service_id"],
            unique=False,
        )


def downgrade() -> None:
    if _has_index("admin_created_traffic_logs", "ix_admin_created_traffic_logs_service_id"):
        op.drop_index(op.f("ix_admin_created_traffic_logs_service_id"), table_name="admin_created_traffic_logs")

    with op.batch_alter_table("admin_created_traffic_logs") as batch:
        if _has_column("admin_created_traffic_logs", "service_id"):
            batch.drop_column("service_id")
