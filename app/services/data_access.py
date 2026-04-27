from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.db import crud
from app.reb_node import state as xray_state


def get_xray_config_cached(db: Session, force_refresh: bool = False) -> dict:
    del force_refresh
    return crud.get_xray_config(db)


def get_service_allowed_inbounds_cached(db: Session, service) -> Dict[str, Any]:
    return crud.get_service_allowed_inbounds(service)


def get_service_host_map_cached(service_id: Optional[int], force_refresh: bool = False) -> Dict[str, Any]:
    return xray_state.get_service_host_map(service_id, force_rebuild=force_refresh)


def get_inbounds_by_tag_cached(db: Session, force_refresh: bool = False) -> Dict[str, Any]:
    del force_refresh
    from app.runtime import xray
    from app.reb_node.config import XRayConfig
    from app.utils.xray_targets import iter_stored_raw_configs

    inbounds: Dict[str, Any] = {}
    for _target_id, raw_config in iter_stored_raw_configs(db):
        try:
            config = XRayConfig(raw_config, api_port=xray.config.api_port)
        except Exception:
            continue
        for tag, inbound in config.inbounds_by_tag.items():
            inbounds.setdefault(tag, inbound)
    for tag, inbound in getattr(xray.config, "inbounds_by_tag", {}).items():
        inbounds.setdefault(tag, inbound)
    for protocol, protocol_inbounds in getattr(xray.config, "inbounds_by_protocol", {}).items():
        protocol_value = protocol.value if hasattr(protocol, "value") else str(protocol)
        for inbound in protocol_inbounds or []:
            tag = inbound.get("tag") if isinstance(inbound, dict) else None
            if not tag:
                continue
            current = dict(inbounds.get(tag) or {})
            current.update(inbound)
            current.setdefault("protocol", protocol_value)
            inbounds[tag] = current
    return inbounds
