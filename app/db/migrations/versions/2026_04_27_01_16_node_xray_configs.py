"""add node xray configs and scoped outbound traffic

Revision ID: 16_node_xray_configs
Revises: 15_add_user_subadress
Create Date: 2026-04-27 20:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "16_node_xray_configs"
down_revision = "15_add_user_subadress"
branch_labels = None
depends_on = None


xray_config_mode_enum = sa.Enum("default", "custom", name="xrayconfigmode")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _columns(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {item["name"] for item in _inspector().get_columns(table)}


def _has_column(table: str, column: str) -> bool:
    return column in _columns(table)


def _indexes(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {item["name"] for item in _inspector().get_indexes(table)}


def _unique_constraints(table: str) -> list[dict]:
    if not _has_table(table):
        return []
    try:
        return _inspector().get_unique_constraints(table)
    except Exception:
        return []


def _drop_outbound_id_uniques() -> None:
    if not _has_table("outbound_traffic"):
        return

    indexes = _indexes("outbound_traffic")
    for index_name in ("ix_outbound_traffic_outbound_id", "outbound_id"):
        if index_name in indexes:
            op.drop_index(index_name, table_name="outbound_traffic")

    for constraint in _unique_constraints("outbound_traffic"):
        name = constraint.get("name")
        columns = constraint.get("column_names") or []
        if name and columns == ["outbound_id"]:
            with op.batch_alter_table("outbound_traffic") as batch:
                batch.drop_constraint(name, type_="unique")


def _create_index_once(table: str, name: str, columns: list[str], unique: bool = False) -> None:
    if name not in _indexes(table):
        op.create_index(name, table, columns, unique=unique)


def _rebuild_sqlite_outbound_traffic() -> None:
    op.create_table(
        "_outbound_traffic_scoped",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("outbound_id", sa.String(length=256), nullable=False),
        sa.Column("tag", sa.String(length=256), nullable=True),
        sa.Column("protocol", sa.String(length=64), nullable=True),
        sa.Column("address", sa.String(length=256), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("uplink", sa.BigInteger(), nullable=True, server_default="0"),
        sa.Column("downlink", sa.BigInteger(), nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("target_id", sa.String(length=64), nullable=False, server_default=sa.text("'master'")),
        sa.Column("node_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target_id", "outbound_id", name="uq_outbound_traffic_target_outbound"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO _outbound_traffic_scoped (
                id, outbound_id, tag, protocol, address, port, uplink, downlink,
                created_at, updated_at, target_id, node_id
            )
            SELECT
                id, outbound_id, tag, protocol, address, port, uplink, downlink,
                created_at, updated_at, COALESCE(target_id, 'master'), node_id
            FROM outbound_traffic
            """
        )
    )
    op.drop_table("outbound_traffic")
    op.rename_table("_outbound_traffic_scoped", "outbound_traffic")


def upgrade() -> None:
    bind = op.get_bind()
    xray_config_mode_enum.create(bind, checkfirst=True)

    if _has_table("nodes"):
        node_columns = _columns("nodes")
        with op.batch_alter_table("nodes") as batch:
            if "xray_config_mode" not in node_columns:
                batch.add_column(
                    sa.Column(
                        "xray_config_mode",
                        xray_config_mode_enum,
                        nullable=False,
                        server_default="default",
                    )
                )
            if "xray_config" not in node_columns:
                batch.add_column(sa.Column("xray_config", sa.JSON(), nullable=True))

    if _has_table("outbound_traffic"):
        outbound_columns = _columns("outbound_traffic")
        with op.batch_alter_table("outbound_traffic") as batch:
            if "target_id" not in outbound_columns:
                batch.add_column(
                    sa.Column(
                        "target_id",
                        sa.String(length=64),
                        nullable=False,
                        server_default=sa.text("'master'"),
                    )
                )
            if "node_id" not in outbound_columns:
                batch.add_column(sa.Column("node_id", sa.Integer(), nullable=True))

        if bind.dialect.name == "sqlite":
            _rebuild_sqlite_outbound_traffic()
        else:
            _drop_outbound_id_uniques()
            existing_unique_columns = {
                tuple(constraint.get("column_names") or []) for constraint in _unique_constraints("outbound_traffic")
            }
            if ("target_id", "outbound_id") not in existing_unique_columns:
                with op.batch_alter_table("outbound_traffic") as batch:
                    batch.create_unique_constraint(
                        "uq_outbound_traffic_target_outbound",
                        ["target_id", "outbound_id"],
                    )

        _create_index_once("outbound_traffic", "ix_outbound_traffic_outbound_id", ["outbound_id"])
        _create_index_once("outbound_traffic", "ix_outbound_traffic_target_id", ["target_id"])
        _create_index_once("outbound_traffic", "ix_outbound_traffic_node_id", ["node_id"])


def downgrade() -> None:
    if _has_table("outbound_traffic"):
        constraints = _unique_constraints("outbound_traffic")
        if any(item.get("name") == "uq_outbound_traffic_target_outbound" for item in constraints):
            with op.batch_alter_table("outbound_traffic") as batch:
                batch.drop_constraint("uq_outbound_traffic_target_outbound", type_="unique")

        for index_name in ("ix_outbound_traffic_node_id", "ix_outbound_traffic_target_id"):
            if index_name in _indexes("outbound_traffic"):
                op.drop_index(index_name, table_name="outbound_traffic")

        outbound_columns = _columns("outbound_traffic")
        with op.batch_alter_table("outbound_traffic") as batch:
            if "node_id" in outbound_columns:
                batch.drop_column("node_id")
            if "target_id" in outbound_columns:
                batch.drop_column("target_id")

        if "ix_outbound_traffic_outbound_id" not in _indexes("outbound_traffic"):
            op.create_index("ix_outbound_traffic_outbound_id", "outbound_traffic", ["outbound_id"], unique=True)

    if _has_table("nodes"):
        node_columns = _columns("nodes")
        with op.batch_alter_table("nodes") as batch:
            if "xray_config" in node_columns:
                batch.drop_column("xray_config")
            if "xray_config_mode" in node_columns:
                batch.drop_column("xray_config_mode")

    xray_config_mode_enum.drop(op.get_bind(), checkfirst=True)
