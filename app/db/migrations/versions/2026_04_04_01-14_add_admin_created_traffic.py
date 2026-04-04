"""add admin created traffic fields and logs

Revision ID: 14_add_admin_created_traffic
Revises: 13_add_admin_expire
Create Date: 2026-04-04 01:00:00.000000
"""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "14_add_admin_created_traffic"
down_revision = "13_add_admin_expire"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {item["name"] for item in _inspector().get_columns(table)}


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _backfill_created_traffic() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT admins.id AS admin_id, COALESCE(SUM(CASE
                WHEN users.data_limit IS NOT NULL AND users.data_limit > 0 THEN users.data_limit
                ELSE 0
            END), 0) AS created_traffic
            FROM admins
            LEFT JOIN users ON users.admin_id = admins.id AND users.status != 'deleted'
            GROUP BY admins.id
            """
        )
    ).fetchall()

    created_log_table_exists = _has_table("admin_created_traffic_logs")
    now = _utcnow_naive()
    for row in rows:
        admin_id = row.admin_id
        created_traffic = int(row.created_traffic or 0)
        bind.execute(
            sa.text(
                """
                UPDATE admins
                SET created_traffic = :created_traffic
                WHERE id = :admin_id
                  AND COALESCE(created_traffic, 0) = 0
                """
            ),
            {"admin_id": admin_id, "created_traffic": created_traffic},
        )
        if created_log_table_exists and created_traffic > 0:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO admin_created_traffic_logs (admin_id, amount, action, created_at)
                    VALUES (:admin_id, :amount, :action, :created_at)
                    """
                ),
                {
                    "admin_id": admin_id,
                    "amount": created_traffic,
                    "action": "migration_backfill",
                    "created_at": now,
                },
            )


def upgrade() -> None:
    if not _has_table("admins"):
        return

    traffic_mode_enum = sa.Enum("used_traffic", "created_traffic", name="admintrafficlimitmode")

    with op.batch_alter_table("admins") as batch:
        if not _has_column("admins", "created_traffic"):
            batch.add_column(sa.Column("created_traffic", sa.BigInteger(), nullable=False, server_default="0"))
        if not _has_column("admins", "traffic_limit_mode"):
            batch.add_column(
                sa.Column(
                    "traffic_limit_mode",
                    traffic_mode_enum,
                    nullable=False,
                    server_default="used_traffic",
                )
            )
        if not _has_column("admins", "show_user_traffic"):
            batch.add_column(sa.Column("show_user_traffic", sa.Boolean(), nullable=False, server_default="1"))

    if _has_table("admin_usage_logs") and not _has_column("admin_usage_logs", "created_traffic_at_reset"):
        with op.batch_alter_table("admin_usage_logs") as batch:
            batch.add_column(
                sa.Column("created_traffic_at_reset", sa.BigInteger(), nullable=False, server_default="0")
            )

    if not _has_table("admin_created_traffic_logs"):
        op.create_table(
            "admin_created_traffic_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id"), nullable=False),
            sa.Column("amount", sa.BigInteger(), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False, server_default="unknown"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            op.f("ix_admin_created_traffic_logs_admin_id"),
            "admin_created_traffic_logs",
            ["admin_id"],
            unique=False,
        )

    _backfill_created_traffic()


def downgrade() -> None:
    if _has_table("admin_created_traffic_logs"):
        op.drop_index(op.f("ix_admin_created_traffic_logs_admin_id"), table_name="admin_created_traffic_logs")
        op.drop_table("admin_created_traffic_logs")

    if _has_table("admin_usage_logs") and _has_column("admin_usage_logs", "created_traffic_at_reset"):
        with op.batch_alter_table("admin_usage_logs") as batch:
            batch.drop_column("created_traffic_at_reset")

    if _has_table("admins"):
        with op.batch_alter_table("admins") as batch:
            if _has_column("admins", "show_user_traffic"):
                batch.drop_column("show_user_traffic")
            if _has_column("admins", "traffic_limit_mode"):
                batch.drop_column("traffic_limit_mode")
            if _has_column("admins", "created_traffic"):
                batch.drop_column("created_traffic")
