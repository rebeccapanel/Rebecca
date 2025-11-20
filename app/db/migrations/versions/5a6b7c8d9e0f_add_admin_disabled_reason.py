"""Add disabled_reason column to admins.

Revision ID: 5a6b7c8d9e0f
Revises: 0f1b2c3d4e5f
Create Date: 2025-11-16 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "5a6b7c8d9e0f"
down_revision = "0f1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [column["name"] for column in inspector.get_columns("admins")]
    if "disabled_reason" in columns:
        op.drop_column("admins", "disabled_reason")
    # ensure we can re-create the column without duplicate errors
    op.add_column(
        "admins",
        sa.Column("disabled_reason", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admins", "disabled_reason")
