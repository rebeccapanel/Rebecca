"""add admin expire time limit

Revision ID: 13_add_admin_expire
Revises: 12_subscription_path_ports
Create Date: 2026-02-25 10:58:55.367623
"""

from alembic import op
import sqlalchemy as sa


revision = "13_add_admin_expire"
down_revision = "12_subscription_path_ports"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return inspector.has_table(table)


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(table):
        return False
    cols = [col["name"] for col in inspector.get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _has_table("admins") or _has_column("admins", "expire"):
        return

    with op.batch_alter_table("admins") as batch:
        batch.add_column(sa.Column("expire", sa.Integer(), nullable=True))


def downgrade() -> None:
    if not _has_table("admins") or not _has_column("admins", "expire"):
        return

    with op.batch_alter_table("admins") as batch:
        batch.drop_column("expire")

