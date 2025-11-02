"""Add admin status for soft delete and relax username uniqueness

Revision ID: 1b2c3d4e5f60
Revises: f6a9bbd5c117
Create Date: 2025-11-04 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1b2c3d4e5f60"
down_revision = "f6a9bbd5c117"
branch_labels = None
depends_on = None


ADMIN_STATUS_ENUM = sa.Enum("active", "deleted", name="adminstatus")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    ADMIN_STATUS_ENUM.create(bind, checkfirst=True)

    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("admins")}

    needs_status_column = "status" not in existing_columns

    if dialect == "sqlite":
        with op.batch_alter_table("admins", recreate="always") as batch_op:
            if needs_status_column:
                batch_op.add_column(
                    sa.Column("status", ADMIN_STATUS_ENUM, nullable=False, server_default="active")
                )
            batch_op.alter_column(
                "username",
                existing_type=sa.String(length=34),
                nullable=False,
                existing_unique=True,
                unique=False,
            )
            batch_op.create_index("ix_admins_username", ["username"], unique=False)
            batch_op.create_index("ix_admins_status", ["status"], unique=False)
    else:
        inspector = sa.inspect(bind)
        for constraint in inspector.get_unique_constraints("admins"):
            if constraint.get("column_names") == ["username"]:
                op.drop_constraint(constraint["name"], "admins", type_="unique")
                break

        with op.batch_alter_table("admins") as batch_op:
            batch_op.add_column(
                sa.Column("status", ADMIN_STATUS_ENUM, nullable=False, server_default="active")
            )

        existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("admins")}
        # Drop any index that enforces uniqueness on username so we can recreate it non-unique
        index_to_drop = None
        for name, metadata in existing_indexes.items():
            if metadata.get("column_names") == ["username"]:
                index_to_drop = name
                break
        if index_to_drop:
            op.drop_index(index_to_drop, table_name="admins")
        # Refresh inspector state if we dropped an index
        existing_indexes = {idx["name"]: idx for idx in sa.inspect(bind).get_indexes("admins")}

        if "ix_admins_username" not in existing_indexes:
            op.create_index("ix_admins_username", "admins", ["username"], unique=False)
        if "ix_admins_status" not in existing_indexes:
            op.create_index("ix_admins_status", "admins", ["status"], unique=False)

    if needs_status_column:
        op.execute("UPDATE admins SET status = 'active' WHERE status IS NULL")

        with op.batch_alter_table("admins") as batch_op:
            batch_op.alter_column("status", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        with op.batch_alter_table("admins", recreate="always") as batch_op:
            batch_op.drop_column("status")
            batch_op.alter_column(
                "username",
                existing_type=sa.String(length=34),
                nullable=False,
                unique=True,
                existing_unique=False,
            )
            batch_op.create_index("ix_admins_username", ["username"], unique=True)
    else:
        inspector = sa.inspect(bind)
        existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("admins")}
        if "ix_admins_status" in existing_indexes:
            op.drop_index("ix_admins_status", table_name="admins")
        if "ix_admins_username" in existing_indexes:
            op.drop_index("ix_admins_username", table_name="admins")
        with op.batch_alter_table("admins") as batch_op:
            batch_op.drop_column("status")
        # Recreate a unique username index if it does not already exist
        inspector = sa.inspect(bind)
        existing_indexes = {idx["name"]: idx for idx in inspector.get_indexes("admins")}
        if not any(
            idx.get("column_names") == ["username"] and idx.get("unique")
            for idx in existing_indexes.values()
        ):
            op.create_index("ix_admins_username", "admins", ["username"], unique=True)

    ADMIN_STATUS_ENUM.drop(bind, checkfirst=True)
