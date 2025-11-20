"""Fix users ID auto-increment when missing.

Revision ID: 3f4g5h6i7j8k
Revises: 4d5e6f7g8h9i
Create Date: 2025-11-14 23:31:00.000000
"""
from __future__ import annotations

from alembic import op

revision = "3f4g5h6i7j8k"
down_revision = "4d5e6f7g8h9i"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Legacy placeholder revision: no schema changes required."""
    pass


def downgrade() -> None:
    """No-op downgrade to keep history consistent."""
    pass
