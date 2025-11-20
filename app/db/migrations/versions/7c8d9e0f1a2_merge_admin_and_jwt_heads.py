"""Merge admin disabled reason and JWT migrations.

Revision ID: 7c8d9e0f1a2
Revises: 5a6b7c8d9e0f, 6a7b8c9d0e1
Create Date: 2025-11-16 00:20:00.000000

"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "7c8d9e0f1a2"
down_revision = ("5a6b7c8d9e0f", "6a7b8c9d0e1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
