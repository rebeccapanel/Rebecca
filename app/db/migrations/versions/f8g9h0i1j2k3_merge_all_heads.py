"""Merge the remaining heads into a single tip

Revision ID: f8g9h0i1j2k3
Revises: 1c2d3e4f5g6h, 2a3b4c5d6e7f, 5g6h7i8j9k0l, a2ac6056027a
Create Date: 2025-11-19 12:00:00.000000

"""
from __future__ import annotations

from alembic import op  # noqa


# revision identifiers, used by Alembic.
revision = "f8g9h0i1j2k3"
down_revision = (
    "1c2d3e4f5g6h",
    "2a3b4c5d6e7f",
    "5g6h7i8j9k0l",
    "a2ac6056027a",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
