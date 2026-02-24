"""add subscription aliases settings

Revision ID: a24b7a1e9f01
Revises: ff05a3b7cdef
Create Date: 2026-02-24 07:40:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a24b7a1e9f01"
down_revision = "10_ensure_subscription_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ""

    if dialect == "mysql":
        op.add_column(
            "subscription_settings",
            sa.Column("subscription_aliases", sa.Text(), nullable=True),
        )
        op.execute("UPDATE subscription_settings SET subscription_aliases='[]' WHERE subscription_aliases IS NULL")
        op.alter_column("subscription_settings", "subscription_aliases", existing_type=sa.Text(), nullable=False)
    else:
        op.add_column(
            "subscription_settings",
            sa.Column(
                "subscription_aliases",
                sa.Text(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )


def downgrade() -> None:
    op.drop_column("subscription_settings", "subscription_aliases")
