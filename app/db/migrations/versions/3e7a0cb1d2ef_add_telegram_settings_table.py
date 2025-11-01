"""add telegram settings table

Revision ID: 3e7a0cb1d2ef
Revises: 2d3f4b5a6c71
Create Date: 2025-11-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "3e7a0cb1d2ef"
down_revision = "2d3f4b5a6c71"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    boolean_false = sa.text("false")
    if dialect in {"sqlite", "mysql"}:
        boolean_false = sa.text("0")

    timestamp_default = sa.text("CURRENT_TIMESTAMP")

    if dialect == "postgresql":
        json_default = sa.text("'{}'::jsonb")
    elif dialect == "mysql":
        json_default = None
    else:
        json_default = sa.text("'{}'")

    op.create_table(
        "telegram_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("api_token", sa.String(length=512), nullable=True),
        sa.Column("proxy_url", sa.String(length=512), nullable=True),
        sa.Column("admin_chat_ids", sa.JSON(), nullable=True),
        sa.Column("logs_chat_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "logs_chat_is_forum",
            sa.Boolean(),
            nullable=False,
            server_default=boolean_false,
        ),
        sa.Column("default_vless_flow", sa.String(length=255), nullable=True),
        sa.Column("forum_topics", sa.JSON(), nullable=True),
        sa.Column(
            "event_toggles",
            sa.JSON(),
            nullable=True,
            server_default=json_default,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=timestamp_default,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=timestamp_default,
        ),
    )


def downgrade() -> None:
    op.drop_table("telegram_settings")
