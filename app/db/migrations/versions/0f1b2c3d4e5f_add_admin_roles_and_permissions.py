"""Add admin roles and per-admin permission settings.

Revision ID: 0f1b2c3d4e5f
Revises: 3f4g5h6i7j8k
Create Date: 2025-11-15 09:30:00.000000

This migration is intentionally defensive so it can be re-applied safely in
development or container environments. If the new columns already exist we
back up the data, drop them, and recreate the structure from scratch.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0f1b2c3d4e5f"
down_revision = "3f4g5h6i7j8k"
branch_labels = None
depends_on = None


BACKUP_TABLE = "__alembic_admin_role_backup"
ROLE_FLAG_COLUMN = "__old_is_sudo"


def _role_type(dialect_name: str) -> sa.types.TypeEngine:
    if dialect_name == "sqlite":
        return sa.String(length=32)
    return sa.Enum("standard", "sudo", "full_access", name="adminrole")


def _permissions_type() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(sa.Text(), "sqlite")


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("admins")}

    role_type = _role_type(dialect_name)
    permissions_type = _permissions_type()

    backup_created = False
    if "role" in existing_columns:
        op.execute(sa.text(f"DROP TABLE IF EXISTS {BACKUP_TABLE}"))
        op.create_table(
            BACKUP_TABLE,
            sa.Column("admin_id", sa.Integer(), primary_key=True),
            sa.Column("role", sa.String(length=32)),
            sa.Column("permissions", sa.Text()),
        )
        op.execute(
            sa.text(
                f"""
                INSERT INTO {BACKUP_TABLE} (admin_id, role, permissions)
                SELECT id, role, permissions FROM admins
                """
            )
        )
        backup_created = True
        with op.batch_alter_table("admins") as batch:
            if "permissions" in existing_columns:
                batch.drop_column("permissions")
            batch.drop_column("role")
        existing_columns.discard("permissions")
        existing_columns.discard("role")

    if isinstance(role_type, sa.Enum):
        role_type.create(bind, checkfirst=True)

    role_flag_column: str | None = None
    if "is_sudo" in existing_columns:
        role_flag_column = ROLE_FLAG_COLUMN
        with op.batch_alter_table("admins") as batch:
            batch.alter_column(
                "is_sudo",
                new_column_name=role_flag_column,
                existing_type=sa.Boolean(),
                existing_nullable=False,
                existing_server_default=sa.text("0"),
            )

    with op.batch_alter_table("admins") as batch:
        batch.add_column(
            sa.Column(
                "role",
                role_type,
                nullable=False,
                server_default="standard",
            )
        )
    with op.batch_alter_table("admins") as batch:
        batch.add_column(sa.Column("permissions", permissions_type, nullable=True))

    if backup_created:
        op.execute(
            sa.text(
                f"""
                UPDATE admins
                SET role = (
                        SELECT role FROM {BACKUP_TABLE} b
                        WHERE b.admin_id = admins.id
                    ),
                    permissions = (
                        SELECT permissions FROM {BACKUP_TABLE} b
                        WHERE b.admin_id = admins.id
                    )
                WHERE EXISTS (
                    SELECT 1 FROM {BACKUP_TABLE} b
                    WHERE b.admin_id = admins.id
                )
                """
            )
        )
        op.execute(sa.text(f"DROP TABLE IF EXISTS {BACKUP_TABLE}"))
    elif role_flag_column:
        op.execute(
            sa.text(
                f"""
                UPDATE admins
                SET role = CASE
                    WHEN {role_flag_column} IS NOT NULL AND {role_flag_column} != 0
                        THEN 'sudo'
                    ELSE 'standard'
                END
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE admins
                SET role = COALESCE(role, 'standard')
                """
            )
        )

    op.execute(
        sa.text(
            """
            UPDATE admins
            SET permissions = COALESCE(permissions, '{}')
            """
        )
    )
    op.alter_column("admins", "role", server_default=None)

    if role_flag_column:
        with op.batch_alter_table("admins") as batch:
            batch.drop_column(role_flag_column)


def downgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    role_type = _role_type(dialect_name)

    with op.batch_alter_table("admins") as batch:
        batch.add_column(
            sa.Column(
                "is_sudo",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )

    op.execute(
        sa.text(
            """
            UPDATE admins
            SET is_sudo = CASE
                WHEN role IN ('sudo', 'full_access') THEN 1
                ELSE 0
            END
            """
        )
    )

    with op.batch_alter_table("admins") as batch:
        batch.drop_column("permissions")
        batch.drop_column("role")

    if isinstance(role_type, sa.Enum):
        role_type.drop(bind, checkfirst=True)
