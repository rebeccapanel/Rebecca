"""merge backup schedule heads

Revision ID: 1ca5b0ca7ef0
Revises: backup_schedule_panel, f8g9h0i1j2k3
Create Date: 2025-11-20 08:46:38.867388

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1ca5b0ca7ef0'
down_revision = ('backup_schedule_panel', 'f8g9h0i1j2k3')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
