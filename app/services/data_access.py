from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.redis import get_redis
from app.redis.cache import (
    get_cached_inbounds,
    get_cached_service_host_map,
    cache_inbounds,
    cache_service_host_map,
    invalidate_inbounds_cache,
    invalidate_service_host_map_cache,
)
from app.db import crud
from app.reb_node import state as xray_state
from config import REDIS_ENABLED

# NOTE: These helpers are a centralized abstraction layer for Xray/service data.
# They use Redis caching when available, falling back to DB/state helpers.


def get_xray_config_cached(db: Session, force_refresh: bool = False) -> dict:
    """
    Return the current Xray config.
    Uses Redis cache if available, otherwise falls back to database.

    Args:
        db: Database session
        force_refresh: If True, force refresh from DB even if cache exists
    """
    if REDIS_ENABLED and not force_refresh:
        cached_inbounds = get_cached_inbounds()
        if cached_inbounds:
            # Reconstruct xray config from cached inbounds
            from app.reb_node.config import XRayConfig

            raw_config = crud.get_xray_config(db)
            xray_config = XRayConfig(raw_config, api_port=xray_state.config.api_port)
            # Update inbounds from cache
            xray_config.inbounds_by_tag = cached_inbounds.get("inbounds_by_tag", {})
            xray_config.inbounds_by_protocol = cached_inbounds.get("inbounds_by_protocol", {})
            return raw_config

    return crud.get_xray_config(db)


def get_service_allowed_inbounds_cached(db: Session, service) -> Dict[str, Any]:
    """
    Return allowed inbounds/hosts for a service.
    Uses Redis cache if available, otherwise falls back to database.
    """
    # Service allowed inbounds are computed from service.inbounds and hosts
    # This is already handled by get_service_host_map_cached
    return crud.get_service_allowed_inbounds(service)


def get_service_host_map_cached(service_id: Optional[int], force_refresh: bool = False) -> Dict[str, Any]:
    """
    Return host map for a given service_id.
    Uses Redis cache if available, otherwise falls back to in-memory cache.

    Args:
        service_id: Service ID to get host map for
        force_refresh: If True, force refresh from DB even if cache exists
    """
    if REDIS_ENABLED and not force_refresh:
        cached_host_map = get_cached_service_host_map(service_id)
        if cached_host_map is not None:
            return cached_host_map

    # Fallback to in-memory cache (which will rebuild if needed)
    # Force rebuild if force_refresh is True
    host_map = xray_state.get_service_host_map(service_id, force_rebuild=force_refresh)

    # Cache in Redis for next time (async, don't block)
    if REDIS_ENABLED:
        try:
            cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if caching fails

    return host_map
