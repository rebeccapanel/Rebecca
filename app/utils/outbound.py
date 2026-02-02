from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any, Dict, Optional


def normalize_outbound_config(outbound_config: Optional[dict]) -> dict:
    """
    Return a sanitized copy of an outbound config suitable for ID generation.
    The outbound tag is intentionally removed so renaming does not change the ID.
    """
    if not isinstance(outbound_config, dict):
        return {}
    normalized = deepcopy(outbound_config)
    normalized.pop("tag", None)
    return normalized


def outbound_signature(outbound_config: Optional[dict]) -> str:
    """
    Build a deterministic JSON string for the outbound config.
    This keeps array order intact and sorts object keys to match Python + JS.
    """
    normalized = normalize_outbound_config(outbound_config)
    try:
        return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except TypeError:
        # Fallback for values that are not JSON serializable by default
        return json.dumps(normalized, sort_keys=True, default=str, separators=(",", ":"), ensure_ascii=False)


def generate_outbound_id(outbound_config: Optional[dict]) -> str:
    """Generate a stable ID for an outbound based on its config (excluding tag)."""
    signature = outbound_signature(outbound_config)
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:16]


def extract_outbound_metadata(outbound_config: Optional[dict]) -> Dict[str, Optional[Any]]:
    """Extract metadata useful for displaying outbound rows."""
    if not isinstance(outbound_config, dict):
        return {"tag": None, "protocol": None, "address": None, "port": None}

    tag = outbound_config.get("tag")
    protocol = outbound_config.get("protocol")
    address = None
    port = None

    settings = outbound_config.get("settings") or {}
    if protocol in {"vmess", "vless"}:
        vnext = settings.get("vnext") or []
        if vnext:
            address = vnext[0].get("address")
            port = vnext[0].get("port")
    elif protocol in {"trojan", "shadowsocks", "socks", "http"}:
        servers = settings.get("servers") or []
        if servers:
            address = servers[0].get("address")
            port = servers[0].get("port")

    return {
        "tag": tag,
        "protocol": protocol,
        "address": address,
        "port": port,
    }
