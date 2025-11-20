"""Create master node state table

Revision ID: 74f5f3f0a8c9
Revises: 3e7a0cb1d2ef
Create Date: 2025-11-03 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "74f5f3f0a8c9"
down_revision = "3e7a0cb1d2ef"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "master_node_state" not in tables:
        op.create_table(
            "master_node_state",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("uplink", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("downlink", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("data_limit", sa.BigInteger(), nullable=True),
            sa.Column(
                "status",
                sa.Enum(
                    "connected",
                    "connecting",
                    "error",
                    "disabled",
                    "limited",
                    name="nodestatus",
                    create_type=False,
                ),
                nullable=False,
                server_default="connected",
            ),
            sa.Column("message", sa.String(length=1024), nullable=True),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    existing_row = bind.execute(
        sa.text("SELECT id FROM master_node_state WHERE id = 1")
    ).first()

    if existing_row:
        return

    result = bind.execute(
        sa.text(
            """
            SELECT
                COALESCE(SUM(uplink), 0) AS total_up,
                COALESCE(SUM(downlink), 0) AS total_down
            FROM node_usages
            WHERE node_id IS NULL
            """
        )
    ).first()

    total_up = result.total_up if result else 0
    total_down = result.total_down if result else 0

    bind.execute(
        sa.text(
            """
            INSERT INTO master_node_state (id, uplink, downlink, data_limit, status, message)
            VALUES (:id, :uplink, :downlink, NULL, :status, NULL)
            """
        ),
        {"id": 1, "uplink": total_up, "downlink": total_down, "status": "connected"},
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "master_node_state" in set(inspector.get_table_names()):
        op.drop_table("master_node_state")
