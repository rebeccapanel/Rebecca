"""add sort column to hosts

Revision ID: b9e52f5491a6
Revises: a9584d547b24
Create Date: 2025-10-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "b9e52f5491a6"
down_revision = "a9584d547b24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_columns = {
        column["name"] for column in inspector.get_columns("hosts")
    }
    existing_sort_values = {}

    if "sort" in existing_columns:
        rows = bind.execute(
            sa.text("SELECT id, sort FROM hosts")
        ).fetchall()
        existing_sort_values = {row.id: row.sort for row in rows}
        with op.batch_alter_table("hosts") as batch_op:
            batch_op.drop_column("sort")

    with op.batch_alter_table("hosts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "sort",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )

    if existing_sort_values:
        update_stmt = sa.text("UPDATE hosts SET sort = :sort WHERE id = :id")
        for host_id, sort_value in existing_sort_values.items():
            sort_value = sort_value if sort_value is not None else host_id
            bind.execute(update_stmt, {"sort": sort_value, "id": host_id})
    else:
        op.execute("UPDATE hosts SET sort = id")


def downgrade() -> None:
    op.drop_column("hosts", "sort")

