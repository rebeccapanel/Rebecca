"""backfill credential keys from existing uuids

Revision ID: 1c2d3e4f5a6b
Revises: 0a1b2c3d4e5f
Create Date: 2025-11-11 09:00:00.000000

"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Dict, Iterable, Optional

from alembic import op
import sqlalchemy as sa

from app.models.proxy import ProxyTypes
from app.utils.credentials import UUID_PROTOCOLS, normalize_key, uuid_to_key


# revision identifiers, used by Alembic.
revision = "1c2d3e4f5a6b"
down_revision = "0a1b2c3d4e5f"
branch_labels = None
depends_on = None


UUID_PROTOCOL_VALUES = {proxy.value for proxy in UUID_PROTOCOLS}


def _load_settings(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    if isinstance(raw, dict):
        return raw
    return {}


def _extract_uuid(settings: Dict[str, Any]) -> Optional[str]:
    value = settings.get("id") or settings.get("uuid")
    return value if isinstance(value, str) else None


def _derive_key_from_proxies(rows: Iterable[Dict[str, Any]]) -> Optional[str]:
    candidate: Optional[str] = None
    for row in rows:
        proxy_type_value = row.get("type")
        if not proxy_type_value:
            continue
        try:
            proxy_type = ProxyTypes(proxy_type_value)
        except ValueError:
            continue
        if proxy_type not in UUID_PROTOCOLS:
            continue
        uuid_value = _extract_uuid(_load_settings(row.get("settings")))
        if not uuid_value:
            continue
        try:
            derived = uuid_to_key(uuid_value, proxy_type)
        except (ValueError, TypeError):
            continue
        if candidate and candidate != derived:
            return None
        candidate = derived
    return candidate


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    proxies = sa.Table(
        "proxies",
        metadata,
        sa.Column("user_id", sa.Integer),
        sa.Column("type", sa.String(length=32)),
        sa.Column("settings", sa.JSON),
    )
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer),
        sa.Column("credential_key", sa.String(length=64)),
    )

    rows = bind.execute(
        sa.select(
            proxies.c.user_id,
            proxies.c.type,
            proxies.c.settings,
        ).where(proxies.c.type.in_(UUID_PROTOCOL_VALUES))
    ).mappings()

    grouped: dict[int, list[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["user_id"]].append(row)

    for user_id, proxy_rows in grouped.items():
        derived_key = _derive_key_from_proxies(proxy_rows)
        if not derived_key:
            continue

        bind.execute(
            users.update()
            .where(users.c.id == user_id)
            .where(users.c.credential_key.is_(None))
            .values(credential_key=normalize_key(derived_key))
        )


def downgrade() -> None:
    pass
