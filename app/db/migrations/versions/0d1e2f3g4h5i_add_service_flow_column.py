"""Add flow column to services and reseller role to admins.

Revision ID: 0d1e2f3g4h5i
Revises: 1ca5b0ca7ef0
Create Date: 2025-11-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0d1e2f3g4h5i"
down_revision = "1ca5b0ca7ef0"
branch_labels = None
depends_on = None


NEW_ROLE_ENUM = sa.Enum("standard", "reseller", "sudo", "full_access", name="adminrole")
OLD_ROLE_ENUM = sa.Enum("standard", "sudo", "full_access", name="adminrole")


def _column_exists(inspector, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)

    if not _column_exists(inspector, "services", "flow"):
        op.add_column("services", sa.Column("flow", sa.String(length=255), nullable=True))

    if dialect == "postgresql":
        op.execute("ALTER TYPE adminrole ADD VALUE IF NOT EXISTS 'reseller'")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE admins MODIFY COLUMN role "
            "ENUM('standard','reseller','sudo','full_access') "
            "NOT NULL DEFAULT 'standard'"
        )
    else:
        with op.batch_alter_table("admins", recreate="always") as batch:
            batch.alter_column(
                "role",
                existing_type=OLD_ROLE_ENUM if dialect != "sqlite" else sa.String(length=32),
                type_=NEW_ROLE_ENUM if dialect != "sqlite" else sa.String(length=32),
                existing_nullable=False,
                server_default="standard",
            )
        op.execute("UPDATE admins SET role = COALESCE(role, 'standard')")
        # SQLite does not support ALTER TABLE ... ALTER COLUMN
        # Use a batch_alter_table which recreates the table and is supported
        # There are different SQL dialects which handle removing defaults differently
        if dialect == "sqlite":
            with op.batch_alter_table("admins") as batch:
                batch.alter_column(
                    "role",
                    existing_type=NEW_ROLE_ENUM if dialect != "sqlite" else sa.String(length=32),
                    existing_nullable=False,
                    server_default=None,
                )
        else:
            op.alter_column("admins", "role", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)

    if _column_exists(inspector, "services", "flow"):
        op.drop_column("services", "flow")

    # Can't safely remove enum value; skip
