import json
import uuid
from typing import Any, Optional

from app.db.models import Proxy
from app.models.proxy import ProxyTypes
from app.utils.credentials import UUID_PROTOCOLS, key_to_uuid


def _ensure_settings_dict(settings: Any) -> dict:
    if isinstance(settings, dict):
        return dict(settings)
    if isinstance(settings, str):
        try:
            return json.loads(settings)
        except Exception:
            return {}
    return {}


def _is_valid_uuid(value: Any) -> bool:
    if value is None:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except Exception:
        return False


def get_or_create_proxy_uuid(db, proxy: Proxy, proxy_type: ProxyTypes, credential_key: Optional[str]) -> str:
    """
    Return the canonical UUID for a proxy, persisting it to the DB if missing/invalid.

    Priority:
    1 proxy.settings["id"] (primary) if present and valid (non-empty, not "null").
    2 Derived from credential_key for UUID protocols.
    3 Fresh random UUID.

    The chosen UUID is written back to proxy.settings["id"] (and mirrored to "uuid" for compatibility).
    """
    settings = _ensure_settings_dict(getattr(proxy, "settings", {}))

    existing = settings.get("id")
    if isinstance(existing, str) and existing.strip().lower() in {"", "null"}:
        existing = None
    if not _is_valid_uuid(existing):
        existing = None

    uuid_value: str
    if existing:
        uuid_value = str(existing)
    elif credential_key and proxy_type in UUID_PROTOCOLS:
        uuid_value = str(key_to_uuid(credential_key, proxy_type))
    else:
        uuid_value = str(uuid.uuid4())

    settings["id"] = uuid_value
    proxy.settings = settings
    try:
        db.add(proxy)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return uuid_value


def ensure_user_proxy_uuids(db, user_response) -> None:
    """
    Ensure all proxies for a user have canonical UUIDs and reflect them on the UserResponse.
    Mutates the provided user_response.proxies in-place.
    """
    from app.db.models import Proxy as DBProxy

    user_id = getattr(user_response, "id", None)
    if user_id is None:
        return

    proxies = db.query(DBProxy).filter(DBProxy.user_id == user_id).all()
    type_to_uuid: dict[str, str] = {}
    for proxy in proxies:
        try:
            proxy_type = proxy.type if isinstance(proxy.type, ProxyTypes) else ProxyTypes(proxy.type)
        except Exception:
            continue
        uuid_value = get_or_create_proxy_uuid(db, proxy, proxy_type, getattr(user_response, "credential_key", None))
        type_to_uuid[proxy_type.value] = uuid_value

    # Reflect the canonical UUIDs back onto the response object
    prox_map = getattr(user_response, "proxies", None)
    if not prox_map:
        return

    if hasattr(prox_map, "items"):
        for key, settings in list(prox_map.items()):
            try:
                ptype_value = key.value if hasattr(key, "value") else ProxyTypes(key).value  # type: ignore[arg-type]
            except Exception:
                ptype_value = str(key)
            uuid_value = type_to_uuid.get(ptype_value)
            if not uuid_value:
                continue
            if isinstance(settings, dict):
                settings["id"] = uuid_value
            else:
                try:
                    setattr(settings, "id", uuid_value)
                except Exception:
                    pass
    else:
        # If proxies is a list/InstrumentedList of Proxy models, update their settings
        for proxy in prox_map:
            try:
                ptype = proxy.type if isinstance(proxy.type, ProxyTypes) else ProxyTypes(proxy.type)
            except Exception:
                continue
            uuid_value = type_to_uuid.get(ptype.value)
            if not uuid_value:
                continue
            settings = _ensure_settings_dict(getattr(proxy, "settings", {}))
            settings["id"] = uuid_value
            proxy.settings = settings
