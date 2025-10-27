"""add sort column to hosts

Revision ID: b9e52f5491a6
Revises: a9584d547b24
Create Date: 2025-10-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b9e52f5491a6"
down_revision = "a9584d547b24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hosts",
        sa.Column(
            "sort",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.execute("UPDATE hosts SET sort = id")


def downgrade() -> None:
    op.drop_column("hosts", "sort")

