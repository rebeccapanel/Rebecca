"""add subscription path and ports

Revision ID: b24c8d2f9012
Revises: a24b7a1e9f01
Create Date: 2026-02-24 14:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b24c8d2f9012"
down_revision = "a24b7a1e9f01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ""

    op.add_column(
        "subscription_settings",
        sa.Column("subscription_path", sa.String(length=128), nullable=False, server_default="sub"),
    )

    if dialect == "mysql":
        op.add_column("subscription_settings", sa.Column("subscription_ports", sa.Text(), nullable=True))
        op.execute("UPDATE subscription_settings SET subscription_ports='[]' WHERE subscription_ports IS NULL")
        op.alter_column("subscription_settings", "subscription_ports", existing_type=sa.Text(), nullable=False)
    else:
        op.add_column(
            "subscription_settings",
            sa.Column("subscription_ports", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        )


def downgrade() -> None:
    op.drop_column("subscription_settings", "subscription_ports")
    op.drop_column("subscription_settings", "subscription_path")
