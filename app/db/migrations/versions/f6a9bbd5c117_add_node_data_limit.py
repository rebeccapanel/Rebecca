"""add data_limit to nodes

Revision ID: f6a9bbd5c117
Revises: c6a48231bb3d
Create Date: 2025-11-02 12:00:00.000000

"""
from typing import Set

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "f6a9bbd5c117"
down_revision = "c6a48231bb3d"
branch_labels = None
depends_on = None


OLD_STATUS_ENUM = sa.Enum(
    "connected", "connecting", "error", "disabled", name="nodestatus"
)
NEW_STATUS_ENUM = sa.Enum(
    "connected", "connecting", "error", "disabled", "limited", name="nodestatus"
)


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    existing_columns: Set[str] = {
        column["name"] for column in inspector.get_columns("nodes")
    }
    has_data_limit = "data_limit" in existing_columns
    existing_data_limits = {}
    if has_data_limit:
        rows = bind.execute(
            sa.text("SELECT id, data_limit FROM nodes")
        ).fetchall()
        existing_data_limits = {row.id: row.data_limit for row in rows}

    if dialect == "postgresql":
        op.execute("ALTER TYPE nodestatus ADD VALUE IF NOT EXISTS 'limited'")
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
        op.add_column("nodes", sa.Column("data_limit", sa.BigInteger(), nullable=True))
    elif dialect == "mysql":
        op.execute(
            "ALTER TABLE nodes MODIFY COLUMN status "
            "ENUM('connected','connecting','error','disabled','limited') NOT NULL"
        )
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
        op.add_column("nodes", sa.Column("data_limit", sa.BigInteger(), nullable=True))
    elif dialect == "sqlite":
        with op.batch_alter_table("nodes", recreate="always") as batch_op:
            batch_op.alter_column(
                "status",
                type_=NEW_STATUS_ENUM,
                existing_type=OLD_STATUS_ENUM,
                existing_nullable=False,
            )
            if has_data_limit:
                batch_op.drop_column("data_limit")
            batch_op.add_column(sa.Column("data_limit", sa.BigInteger(), nullable=True))
    else:
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
        op.add_column("nodes", sa.Column("data_limit", sa.BigInteger(), nullable=True))

    if existing_data_limits:
        update_stmt = sa.text(
            "UPDATE nodes SET data_limit = :data_limit WHERE id = :id"
        )
        for node_id, data_limit in existing_data_limits.items():
            bind.execute(update_stmt, {"data_limit": data_limit, "id": node_id})


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("nodes")}
    has_data_limit = "data_limit" in existing_columns

    if dialect == "postgresql":
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
        # Removing enum values from PostgreSQL types is intentionally skipped.
    elif dialect == "mysql":
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
        op.execute(
            "ALTER TABLE nodes MODIFY COLUMN status "
            "ENUM('connected','connecting','error','disabled') NOT NULL"
        )
    elif dialect == "sqlite":
        if has_data_limit:
            with op.batch_alter_table("nodes", recreate="always") as batch_op:
                batch_op.alter_column(
                    "status",
                    type_=OLD_STATUS_ENUM,
                    existing_type=NEW_STATUS_ENUM,
                    existing_nullable=False,
                )
                batch_op.drop_column("data_limit")
    else:
        if has_data_limit:
            op.drop_column("nodes", "data_limit")
