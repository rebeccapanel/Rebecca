"""add subadress compatibility field to users

Revision ID: 15_add_user_subadress
Revises: 14_add_admin_created_traffic
Create Date: 2026-04-25 12:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "15_add_user_subadress"
down_revision = "14_add_admin_created_traffic"
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


def _has_index(table: str, index_name: str) -> bool:
    if not _has_table(table):
        return False
    return index_name in {item["name"] for item in _inspector().get_indexes(table)}


def upgrade() -> None:
    if not _has_table("users"):
        return

    if not _has_column("users", "subadress"):
        with op.batch_alter_table("users") as batch:
            batch.add_column(
                sa.Column("subadress", sa.String(length=255), nullable=False, server_default=sa.text("''"))
            )

    if not _has_index("users", "ix_users_subadress"):
        op.create_index("ix_users_subadress", "users", ["subadress"], unique=False)


def downgrade() -> None:
    if not _has_table("users"):
        return

    if _has_index("users", "ix_users_subadress"):
        op.drop_index("ix_users_subadress", table_name="users")

    if _has_column("users", "subadress"):
        with op.batch_alter_table("users") as batch:
            batch.drop_column("subadress")
