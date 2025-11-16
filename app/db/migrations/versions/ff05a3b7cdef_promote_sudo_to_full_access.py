"""promote sudo admins to full access

Revision ID: ff05a3b7cdef
Revises: fe7796f840a4
Create Date: 2025-11-17 00:00:00.000000
"""
from alembic import op

revision = "ff05a3b7cdef"
down_revision = "fe7796f840a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE admins SET role = 'full_access' WHERE role = 'sudo'")


def downgrade() -> None:
    pass
