"""add credential key column to users

Revision ID: 0a1b2c3d4e5f
Revises: f123456789ab
Create Date: 2025-11-10 10:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0a1b2c3d4e5f"
down_revision = "f123456789ab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("credential_key", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "credential_key")
