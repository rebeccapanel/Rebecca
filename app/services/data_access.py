from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.redis import get_redis  # reserved for future caching
from app.db import crud
from app.reb_node import state as xray_state

# NOTE: These helpers are a centralized abstraction layer for Xray/service data.
# For now they simply delegate to the existing DB/state helpers.
# In the future, Redis-backed caching can be added here without touching callers.


def get_xray_config_cached(db: Session) -> dict:
    """
    Return the current Xray config.
    Currently delegates to crud.get_xray_config; Redis caching may be added later.
    """
    _ = get_redis()  # placeholder for future use
    return crud.get_xray_config(db)


def get_service_allowed_inbounds_cached(db: Session, service) -> Dict[str, Any]:
    """
    Return allowed inbounds/hosts for a service.
    Currently delegates to crud.get_service_allowed_inbounds.
    """
    _ = get_redis()  # placeholder for future use
    return crud.get_service_allowed_inbounds(service)


def get_service_host_map_cached(service_id: Optional[int]) -> Dict[str, Any]:
    """
    Return host map for a given service_id.
    Currently delegates to in-memory xray_state.get_service_host_map.
    """
    _ = get_redis()  # placeholder for future use
    return xray_state.get_service_host_map(service_id)
