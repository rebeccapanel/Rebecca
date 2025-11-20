"""add credential key column to users

Revision ID: 0a1b2c3d4e5f
Revises: f123456789ab
Create Date: 2025-11-10 10:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0a1b2c3d4e5f"
down_revision = "f123456789ab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("users")}
    if "credential_key" in column_names:
        return

    with op.batch_alter_table("users", recreate="auto") as batch_op:
        batch_op.add_column(sa.Column("credential_key", sa.String(length=64), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("users")}
    if "credential_key" not in column_names:
        return

    with op.batch_alter_table("users", recreate="auto") as batch_op:
        batch_op.drop_column("credential_key")
