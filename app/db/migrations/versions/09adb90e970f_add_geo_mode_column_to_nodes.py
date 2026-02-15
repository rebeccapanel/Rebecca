"""add geo_mode column to nodes

Revision ID: 09adb90e970f
Revises: 6b82cec33861
Create Date: 2025-10-23 19:29:15.693989

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '09adb90e970f'
down_revision = '6b82cec33861'
branch_labels = None
depends_on = None


geo_mode_enum = sa.Enum('default', 'custom', name='geomode')


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(col["name"] == column_name for col in columns)


def upgrade() -> None:
    bind = op.get_bind()
    geo_mode_enum.create(bind, checkfirst=True)
    existing_geo_modes = {}
    valid_geo_modes = {"default", "custom"}

    if _column_exists(bind, "nodes", "geo_mode"):
        rows = bind.execute(
            sa.text("SELECT id, geo_mode FROM nodes")
        ).fetchall()
        for row in rows:
            geo_mode = row.geo_mode
            if geo_mode is None:
                continue
            if geo_mode not in valid_geo_modes:
                geo_mode = "default"
            existing_geo_modes[row.id] = geo_mode
        with op.batch_alter_table("nodes") as batch_op:
            batch_op.drop_column("geo_mode")

    with op.batch_alter_table("nodes") as batch_op:
        batch_op.add_column(
            sa.Column(
                "geo_mode",
                geo_mode_enum,
                nullable=False,
                server_default="default",
            )
        )

    op.execute("UPDATE nodes SET geo_mode='default' WHERE geo_mode IS NULL")
    if existing_geo_modes:
        update_stmt = sa.text(
            "UPDATE nodes SET geo_mode = :geo_mode WHERE id = :id"
        )
        for node_id, geo_mode in existing_geo_modes.items():
            bind.execute(update_stmt, {"geo_mode": geo_mode, "id": node_id})


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, "nodes", "geo_mode"):
        with op.batch_alter_table("nodes") as batch_op:
            batch_op.drop_column("geo_mode")

    geo_mode_enum.drop(bind, checkfirst=True)
