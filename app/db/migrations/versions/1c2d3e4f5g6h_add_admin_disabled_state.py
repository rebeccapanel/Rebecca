"""Add disabled state and reason to admins

Revision ID: 1c2d3e4f5g6h
Revises: 0a1b2c3d4e5f
Create Date: 2025-11-15 12:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1c2d3e4f5g6h"
down_revision = "0a1b2c3d4e5f"
branch_labels = None
depends_on = None


OLD_ADMIN_STATUS = ("active", "deleted")
NEW_ADMIN_STATUS = OLD_ADMIN_STATUS + ("disabled",)

OLD_ADMIN_STATUS_ENUM = sa.Enum(*OLD_ADMIN_STATUS, name="adminstatus")
NEW_ADMIN_STATUS_ENUM = sa.Enum(*NEW_ADMIN_STATUS, name="adminstatus")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("admins")}
    needs_reason_column = "disabled_reason" not in column_names

    if dialect == "postgresql":
        op.execute("ALTER TYPE adminstatus ADD VALUE IF NOT EXISTS 'disabled'")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE admins MODIFY COLUMN status "
            "ENUM('active','disabled','deleted') NOT NULL"
        )
    elif dialect == "sqlite":
        with op.batch_alter_table("admins", recreate="always") as batch_op:
            batch_op.alter_column(
                "status",
                type_=NEW_ADMIN_STATUS_ENUM,
                existing_type=OLD_ADMIN_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )
            if needs_reason_column:
                batch_op.add_column(sa.Column("disabled_reason", sa.String(length=512), nullable=True))
        return
    else:
        with op.batch_alter_table("admins") as batch_op:
            batch_op.alter_column(
                "status",
                type_=NEW_ADMIN_STATUS_ENUM,
                existing_type=OLD_ADMIN_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )

    if needs_reason_column:
        with op.batch_alter_table("admins") as batch_op:
            batch_op.add_column(sa.Column("disabled_reason", sa.String(length=512), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("admins")}
    has_reason_column = "disabled_reason" in column_names

    op.execute("UPDATE admins SET status = 'active' WHERE status = 'disabled'")

    if dialect == "postgresql":
        op.execute("ALTER TYPE adminstatus RENAME TO adminstatus_old")
        op.execute("CREATE TYPE adminstatus AS ENUM ('active','deleted')")
        op.execute(
            "ALTER TABLE admins ALTER COLUMN status TYPE adminstatus "
            "USING status::text::adminstatus"
        )
        op.execute("DROP TYPE adminstatus_old")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE admins MODIFY COLUMN status "
            "ENUM('active','deleted') NOT NULL"
        )
    elif dialect == "sqlite":
        with op.batch_alter_table("admins", recreate="always") as batch_op:
            batch_op.alter_column(
                "status",
                type_=OLD_ADMIN_STATUS_ENUM,
                existing_type=NEW_ADMIN_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )
            if has_reason_column:
                batch_op.drop_column("disabled_reason")
        return
    else:
        with op.batch_alter_table("admins") as batch_op:
            batch_op.alter_column(
                "status",
                type_=OLD_ADMIN_STATUS_ENUM,
                existing_type=NEW_ADMIN_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )

    if has_reason_column:
        with op.batch_alter_table("admins") as batch_op:
            batch_op.drop_column("disabled_reason")
