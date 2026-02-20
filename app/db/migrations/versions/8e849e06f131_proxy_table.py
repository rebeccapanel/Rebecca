"""proxy table

Revision ID: 8e849e06f131
Revises: 9b60be6cd0a2
Create Date: 2022-12-26 05:47:14.745622

"""

import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import select

# revision identifiers, used by Alembic.
revision = '8e849e06f131'
down_revision = '9b60be6cd0a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())

    if "proxies" not in tables:
        proxies_table = op.create_table(
            "proxies",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("type", sa.Enum("VMess", "VLESS", "Trojan", "Shadowsocks", name="proxytypes"), nullable=False),
            sa.Column("settings", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        proxies_table = sa.Table("proxies", sa.MetaData(), autoload_with=connection)

    # Reflect the 'users' table for data migration
    metadata = sa.MetaData()
    users_table = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("proxy_type", sa.String(11)),
        sa.Column("settings", sa.JSON()),
    )

    users_columns = {column["name"] for column in inspector.get_columns("users")}
    if {"proxy_type", "settings"}.issubset(users_columns):
        results = connection.execute(
            select(users_table.c.id, users_table.c.proxy_type, users_table.c.settings)
        ).fetchall()
        rows = []
        for row in results:
            if not row.proxy_type:
                continue
            raw_settings = row.settings
            if isinstance(raw_settings, str):
                try:
                    parsed_settings = json.loads(raw_settings)
                except Exception:
                    parsed_settings = {}
            else:
                parsed_settings = raw_settings or {}
            rows.append(
                {
                    "user_id": row.id,
                    "type": row.proxy_type,
                    "settings": parsed_settings,
                }
            )
        if rows:
            op.bulk_insert(proxies_table, rows)

    # Alter 'users' table: Drop 'proxy_type' and 'settings'
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "created_at",
            existing_type=sa.DATETIME(),
            nullable=True,
            existing_server_default=sa.text("(CURRENT_TIMESTAMP)"),
        )
        batch_op.drop_column("proxy_type")
        batch_op.drop_column("settings")

    # Create an index on the 'proxies' table
    op.create_index(op.f("ix_proxies_id"), "proxies", ["id"], unique=False)


def downgrade() -> None:
    # Recreate 'proxy_type' and 'settings' columns in the 'users' table
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("settings", sa.JSON(), nullable=False))
        batch_op.add_column(sa.Column("proxy_type", sa.String(length=11), nullable=False))
        batch_op.alter_column(
            "created_at",
            existing_type=sa.DATETIME(),
            nullable=False,
            existing_server_default=sa.text("(CURRENT_TIMESTAMP)"),
        )

    # Drop the index and table 'proxies'
    op.drop_index(op.f("ix_proxies_id"), table_name="proxies")
    op.drop_table("proxies")
