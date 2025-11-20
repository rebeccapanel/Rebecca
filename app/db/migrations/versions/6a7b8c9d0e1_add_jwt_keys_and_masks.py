"""Add dedicated subscription and admin JWT secrets along with UUID masks.

Revision ID: 6a7b8c9d0e1
Revises: 4d5e6f7g8h9i
Create Date: 2025-11-15 20:30:00.000000

"""
from __future__ import annotations

import os

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "6a7b8c9d0e1"
down_revision = "4d5e6f7g8h9i"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    _add_column_if_missing(
        connection,
        "jwt",
        sa.Column("subscription_secret_key", sa.String(length=64), nullable=True),
    )
    _add_column_if_missing(
        connection,
        "jwt",
        sa.Column("admin_secret_key", sa.String(length=64), nullable=True),
    )
    _add_column_if_missing(
        connection,
        "jwt",
        sa.Column("vmess_mask", sa.String(length=32), nullable=True),
    )
    _add_column_if_missing(
        connection,
        "jwt",
        sa.Column("vless_mask", sa.String(length=32), nullable=True),
    )

    _populate_jwt_secrets(connection)
    _populate_jwt_secrets(connection)

    with op.batch_alter_table("jwt") as batch_op:
        batch_op.alter_column(
            "subscription_secret_key",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.alter_column(
            "admin_secret_key",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.alter_column(
            "vmess_mask",
            existing_type=sa.String(length=32),
            nullable=False,
        )
        batch_op.alter_column(
            "vless_mask",
            existing_type=sa.String(length=32),
            nullable=False,
        )


def downgrade() -> None:
    op.drop_column("jwt", "vless_mask")
    op.drop_column("jwt", "vmess_mask")
    op.drop_column("jwt", "admin_secret_key")
    op.drop_column("jwt", "subscription_secret_key")


def _add_column_if_missing(
    connection: sa.engine.Connection, table_name: str, column: sa.Column
) -> None:
    if _column_exists(connection, table_name, column.name):
        return
    op.add_column(table_name, column)


def _column_exists(
    connection: sa.engine.Connection, table_name: str, column_name: str
) -> bool:
    inspector = sa.inspect(connection)
    return column_name in {col["name"] for col in inspector.get_columns(table_name)}


def _populate_jwt_secrets(connection: sa.engine.Connection) -> None:
    metadata = sa.MetaData()
    jwt_table = sa.Table("jwt", metadata, autoload_with=connection)
    records = connection.execute(sa.select(jwt_table)).mappings().all()

    if not records:
        base_secret = os.urandom(32).hex()
        connection.execute(
            jwt_table.insert().values(
                secret_key=base_secret,
                subscription_secret_key=base_secret,
                admin_secret_key=os.urandom(32).hex(),
                vmess_mask=os.urandom(16).hex(),
                vless_mask=os.urandom(16).hex(),
            )
        )
        return

    for record in records:
        base_secret = record.get("secret_key") or os.urandom(32).hex()
        connection.execute(
            jwt_table.update()
            .where(jwt_table.c.id == record["id"])
            .values(
                secret_key=base_secret,
                admin_secret_key=os.urandom(32).hex(),
                subscription_secret_key=base_secret,
                vmess_mask=os.urandom(16).hex(),
                vless_mask=os.urandom(16).hex(),
            )
        )
