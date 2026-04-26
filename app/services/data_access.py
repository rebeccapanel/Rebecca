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
    del db, force_refresh
    from app.runtime import xray

    return xray.config.inbounds_by_tag
