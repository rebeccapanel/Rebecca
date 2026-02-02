"""add outbound traffic table

Revision ID: 4_add_outbound_traffic_table
Revises: 3_add_access_insights
Create Date: 2025-12-14 21:07:00.000000

"""
import hashlib
import json
from copy import deepcopy

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4_add_outbound_traffic_table'
down_revision = '3_add_access_insights'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'outbound_traffic' not in tables:
        op.create_table(
            'outbound_traffic',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('outbound_id', sa.String(256), nullable=False),
            sa.Column('tag', sa.String(256), nullable=True),
            sa.Column('protocol', sa.String(64), nullable=True),
            sa.Column('address', sa.String(256), nullable=True),
            sa.Column('port', sa.Integer(), nullable=True),
            sa.Column('uplink', sa.BigInteger(), nullable=True, server_default='0'),
            sa.Column('downlink', sa.BigInteger(), nullable=True, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('outbound_id'),
        )
        inspector = sa.inspect(bind)

    if 'outbound_traffic' in set(inspector.get_table_names()):
        indexes = {index['name'] for index in inspector.get_indexes('outbound_traffic')}
        index_name = op.f('ix_outbound_traffic_outbound_id')
        if index_name not in indexes:
            op.create_index(index_name, 'outbound_traffic', ['outbound_id'], unique=True)
        index_name = op.f('ix_outbound_traffic_tag')
        if index_name not in indexes:
            op.create_index(index_name, 'outbound_traffic', ['tag'], unique=False)
        if 'xray_config' in tables:
            _seed_outbound_traffic(bind)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'outbound_traffic' in tables:
        indexes = {index['name'] for index in inspector.get_indexes('outbound_traffic')}
        index_name = op.f('ix_outbound_traffic_tag')
        if index_name in indexes:
            op.drop_index(index_name, table_name='outbound_traffic')
        index_name = op.f('ix_outbound_traffic_outbound_id')
        if index_name in indexes:
            op.drop_index(index_name, table_name='outbound_traffic')
        op.drop_table('outbound_traffic')


def _normalize_outbound_config(outbound_config):
    if not isinstance(outbound_config, dict):
        return {}
    normalized = deepcopy(outbound_config)
    normalized.pop("tag", None)
    return normalized


def _generate_outbound_id(outbound_config) -> str:
    normalized = _normalize_outbound_config(outbound_config)
    try:
        signature = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except TypeError:
        signature = json.dumps(normalized, sort_keys=True, default=str, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:16]


def _extract_outbound_metadata(outbound_config):
    if not isinstance(outbound_config, dict):
        return {"tag": None, "protocol": None, "address": None, "port": None}

    tag = outbound_config.get("tag")
    protocol = outbound_config.get("protocol")
    address = None
    port = None

    settings = outbound_config.get("settings") or {}
    if protocol in {"vmess", "vless"}:
        vnext = settings.get("vnext") or []
        if vnext and isinstance(vnext[0], dict):
            address = vnext[0].get("address")
            port = vnext[0].get("port")
    elif protocol in {"trojan", "shadowsocks", "socks", "http"}:
        servers = settings.get("servers") or []
        if servers and isinstance(servers[0], dict):
            address = servers[0].get("address")
            port = servers[0].get("port")

    return {
        "tag": tag,
        "protocol": protocol,
        "address": address,
        "port": port,
    }


def _seed_outbound_traffic(bind):
    """Populate outbound_traffic rows from the current xray_config payload."""
    try:
        row = bind.execute(sa.text("SELECT data FROM xray_config LIMIT 1")).first()
    except Exception:
        return

    if not row:
        return

    payload = row[0]
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return

    outbounds = payload.get("outbounds") if isinstance(payload, dict) else None
    if not isinstance(outbounds, list):
        return

    try:
        existing_rows = bind.execute(sa.text("SELECT outbound_id FROM outbound_traffic")).fetchall()
        existing_ids = {r[0] for r in existing_rows}
    except Exception:
        existing_ids = set()

    rows = []
    for outbound in outbounds:
        outbound_id = _generate_outbound_id(outbound)
        if outbound_id in existing_ids:
            continue
        existing_ids.add(outbound_id)
        meta = _extract_outbound_metadata(outbound)
        rows.append(
            {
                "outbound_id": outbound_id,
                "tag": meta.get("tag"),
                "protocol": meta.get("protocol"),
                "address": meta.get("address"),
                "port": meta.get("port"),
            }
        )

    if not rows:
        return

    outbound_table = sa.table(
        "outbound_traffic",
        sa.column("outbound_id", sa.String),
        sa.column("tag", sa.String),
        sa.column("protocol", sa.String),
        sa.column("address", sa.String),
        sa.column("port", sa.Integer),
    )
    op.bulk_insert(outbound_table, rows)
