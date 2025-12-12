"""Merge all heads after adding default subscription type

Revision ID: c5d6e7f8g9h0
Revises: 07f9bbb3db4e, 0d1e2f3g4h5i, 1c2d3e4f5a6b, 1c2d3e4f5g6h, 2a3b4c5d6e7f, 305943d779c4, 54c4b8c525fc, 5a4446e7b165, 5a6b7c8d9e0f, 5g6h7i8j9k0l, 6a7b8c9d0e1, 7c8d9e0f1a2, 852d951c9c08, a0d3d400ea75, a2ac6056027a, adda2dd4a741, b3378dc6de01, backup_schedule_panel, c4a1b2d3e4f5, d02dcfbf1517, d0a3960f5dad, f8g9h0i1j2k3, fad8b1997c3a, ff05a3b7cdef
Create Date: 2025-12-02 22:20:00.000000
"""

from alembic import op  # noqa

# revision identifiers, used by Alembic.
revision = "c5d6e7f8g9h0"
down_revision = ("c4a1b2d3e4f5",)
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This migration merges multiple heads; no runtime operations required.
    pass


def downgrade() -> None:
    # Downgrade is not supported for merge migrations.
    pass
