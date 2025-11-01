"""Add deleted user status and relax username uniqueness

Revision ID: 2d3f4b5a6c71
Revises: 1b2c3d4e5f60
Create Date: 2025-11-04 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2d3f4b5a6c71"
down_revision = "1b2c3d4e5f60"
branch_labels = None
depends_on = None


OLD_USER_STATUS = ("active", "disabled", "limited", "expired", "on_hold")
NEW_USER_STATUS = OLD_USER_STATUS + ("deleted",)

OLD_USER_STATUS_ENUM = sa.Enum(*OLD_USER_STATUS, name="userstatus")
NEW_USER_STATUS_ENUM = sa.Enum(*NEW_USER_STATUS, name="userstatus")


def _drop_username_uniqueness(bind) -> None:
    inspector = sa.inspect(bind)

    for constraint in inspector.get_unique_constraints("users"):
        if constraint.get("column_names") == ["username"]:
            op.drop_constraint(constraint["name"], "users", type_="unique")
            break

    indexes = {idx["name"]: idx for idx in inspector.get_indexes("users")}
    unique_index_name = None
    for name, metadata in indexes.items():
        if metadata.get("column_names") == ["username"] and metadata.get("unique"):
            unique_index_name = name
            break
    if unique_index_name:
        op.drop_index(unique_index_name, table_name="users")

    inspector = sa.inspect(bind)
    existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("users")}
    if "ix_users_username" not in existing_indexes:
        op.create_index("ix_users_username", "users", ["username"], unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute("ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'deleted'")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE users MODIFY COLUMN status "
            "ENUM('active','disabled','limited','expired','on_hold','deleted') NOT NULL"
        )
    elif dialect == "sqlite":
        with op.batch_alter_table("users", recreate="always") as batch_op:
            batch_op.alter_column(
                "status",
                type_=NEW_USER_STATUS_ENUM,
                existing_type=OLD_USER_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )
            batch_op.alter_column(
                "username",
                existing_type=sa.String(length=34, collation="NOCASE"),
                nullable=False,
                existing_nullable=False,
                existing_unique=True,
                unique=False,
            )
        inspector = sa.inspect(bind)
        existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("users")}
        if "ix_users_username" not in existing_indexes:
            op.create_index("ix_users_username", "users", ["username"], unique=False)
        return
    else:
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "status",
                type_=NEW_USER_STATUS_ENUM,
                existing_type=OLD_USER_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )

    _drop_username_uniqueness(bind)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Ensure deleted users are mapped back to a supported status
    op.execute("UPDATE users SET status = 'disabled' WHERE status = 'deleted'")

    if dialect == "postgresql":
        op.execute("ALTER TYPE userstatus RENAME TO userstatus_old")
        op.execute(
            "CREATE TYPE userstatus AS ENUM ('active','disabled','limited','expired','on_hold')"
        )
        op.execute(
            "ALTER TABLE users ALTER COLUMN status TYPE userstatus "
            "USING status::text::userstatus"
        )
        op.execute("DROP TYPE userstatus_old")
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE users MODIFY COLUMN status "
            "ENUM('active','disabled','limited','expired','on_hold') NOT NULL"
        )
    elif dialect == "sqlite":
        with op.batch_alter_table("users", recreate="always") as batch_op:
            batch_op.alter_column(
                "status",
                type_=OLD_USER_STATUS_ENUM,
                existing_type=NEW_USER_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )
            batch_op.alter_column(
                "username",
                existing_type=sa.String(length=34, collation="NOCASE"),
                nullable=False,
                existing_unique=False,
                unique=True,
            )
        inspector = sa.inspect(bind)
        existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("users")}
        if "ix_users_username" not in existing_indexes:
            op.create_index("ix_users_username", "users", ["username"], unique=True)
        return
    else:
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "status",
                type_=OLD_USER_STATUS_ENUM,
                existing_type=NEW_USER_STATUS_ENUM,
                nullable=False,
                existing_nullable=False,
            )

    inspector = sa.inspect(bind)
    existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("users")}
    # Drop the non-unique index if it exists
    if "ix_users_username" in existing_indexes and not existing_indexes["ix_users_username"].get(
        "unique"
    ):
        op.drop_index("ix_users_username", table_name="users")

    # Recreate a unique index to enforce uniqueness again
    op.create_index("ix_users_username", "users", ["username"], unique=True)
