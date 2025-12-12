"""merge heads before admin api keys

Revision ID: 2b5121ab2105
Revises: c5d6e7f8g9h0, 0d1e2f3g4h5i
Create Date: 2025-12-02 02:30:00.000000
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "2b5121ab2105"
down_revision = ("c5d6e7f8g9h0", "0d1e2f3g4h5i")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge migration only; no schema changes.
    pass


def downgrade() -> None:
    # Merge migration only; nothing to undo.
    pass
