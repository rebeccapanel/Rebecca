"""Merge ff05a3b7cdef and 7c8d9e0f1a2 heads.

Revision ID: 123456789abc
Revises: ff05a3b7cdef, 7c8d9e0f1a2
Create Date: 2025-11-17 12:00:00.000000

"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "123456789abc"
down_revision = ("ff05a3b7cdef", "7c8d9e0f1a2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
