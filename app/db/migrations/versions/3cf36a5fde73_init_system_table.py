"""init system table

Revision ID: 3cf36a5fde73
Revises: 94a5cc12c0d6
Create Date: 2022-11-22 04:48:55.227490

"""
from alembic import op
import sqlalchemy as sa

from app.db.migrations.safe_ops import (
    index_exists,
    load_table,
    row_exists,
    table_exists,
)


# revision identifiers, used by Alembic.
revision = '3cf36a5fde73'
down_revision = '94a5cc12c0d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not table_exists("system"):
        table = op.create_table(
            "system",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("uplink", sa.BigInteger(), nullable=True),
            sa.Column("downlink", sa.BigInteger(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        table = load_table("system")

    if not index_exists("system", "ix_system_id"):
        op.create_index(op.f("ix_system_id"), "system", ["id"], unique=False)

    if not row_exists("system", {"id": 1}):
        op.bulk_insert(table, [{"id": 1, "uplink": 0, "downlink": 0}])


def downgrade() -> None:
    if index_exists("system", "ix_system_id"):
        op.drop_index(op.f("ix_system_id"), table_name="system")
    if table_exists("system"):
        op.drop_table("system")
