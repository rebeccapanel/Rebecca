"""Ensure admins use the disabled status and have a role column.

Revision ID: a1b2c3d4e5f6
Revises: 123456789abc
Create Date: 2025-11-17 16:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "123456789abc"
branch_labels = None
depends_on = None


ADMIN_STATUS_OLD = sa.Enum("active", "deleted", name="adminstatus")
ADMIN_STATUS_NEW = sa.Enum("active", "deleted", "disabled", name="adminstatus")
ADMIN_ROLE = sa.Enum("standard", "sudo", "full_access", name="adminrole")
PERMISSIONS_TYPE = sa.JSON().with_variant(sa.Text(), "sqlite")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("admins")}

    if dialect == "mysql":
        op.execute(
            "ALTER TABLE admins MODIFY COLUMN status "
            "ENUM('active','deleted','disabled') "
            "NOT NULL DEFAULT 'active'"
        )
    elif dialect == "postgresql":
        op.execute("ALTER TYPE adminstatus ADD VALUE IF NOT EXISTS 'disabled'")
    else:
        with op.batch_alter_table("admins") as batch:
            batch.alter_column(
                "status",
                existing_type=ADMIN_STATUS_OLD,
                type_=ADMIN_STATUS_NEW,
                existing_nullable=False,
            )

    role_type = ADMIN_ROLE
    if dialect == "sqlite":
        role_type = sa.String(length=32)

    if "role" not in columns:
        if dialect == "postgresql":
            ADMIN_ROLE.create(bind, checkfirst=True)
        with op.batch_alter_table("admins") as batch:
            batch.add_column(
                sa.Column(
                    "role",
                    role_type,
                    nullable=False,
                    server_default="standard",
                )
            )
        op.execute("UPDATE admins SET role = COALESCE(role, 'standard')")
        op.alter_column("admins", "role", server_default=None)

    if "is_sudo" in columns:
        op.execute("UPDATE admins SET role = 'sudo' WHERE is_sudo")
        with op.batch_alter_table("admins") as batch:
            batch.drop_column("is_sudo")

    if "permissions" not in columns:
        with op.batch_alter_table("admins") as batch:
            batch.add_column(
                sa.Column("permissions", PERMISSIONS_TYPE, nullable=True)
            )
        op.execute("UPDATE admins SET permissions = COALESCE(permissions, '{}')")


def downgrade() -> None:
    pass
