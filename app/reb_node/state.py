import logging
from random import randint
import threading
import time
from typing import TYPE_CHECKING, Dict, Optional, Sequence

from app.db import GetDB, crud
from app.db import models as db_models
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import joinedload
from app.models.proxy import ProxyHostSecurity
from app.utils.store import DictStorage
from app.utils.system import check_port
from app.reb_node.config import XRayConfig
from app.reb_node.core import XRayCore
from app.reb_node.node import XRayNode
from config import XRAY_ASSETS_PATH, XRAY_EXECUTABLE_PATH
from xray_api import XRay as XRayAPI
from xray_api import exceptions, types
from xray_api import exceptions as exc  # noqa: F401

core = XRayCore(XRAY_EXECUTABLE_PATH, XRAY_ASSETS_PATH)

api_port = 8080  # Default port
try:
    for port in range(randint(10000, 60000), 65536):
        if not check_port(port):
            api_port = port
            break
except Exception:
    api_port = 8080

try:
    with GetDB() as db:
        raw_config = crud.get_xray_config(db)
    config = XRayConfig(raw_config, api_port=api_port)
except Exception as e:
    import logging

    logger = logging.getLogger("uvicorn.error")
    logger.warning(f"Failed to load Xray config from database: {e}")
    config = XRayConfig({}, api_port=api_port)

api = XRayAPI(config.api_host, config.api_port)

nodes: Dict[int, XRayNode] = {}
service_hosts_cache: Dict[Optional[int], Dict[str, list]] = {}
service_hosts_cache_ts: Optional[float] = None

HOSTS_CACHE_TTL = 900  # 15 minutes
_hosts_cache_lock = threading.RLock()


def _empty_host_map() -> Dict[str, list]:
    return {tag: [] for tag in config.inbounds_by_tag.keys()}


def _is_retryable_db_error(err: Exception) -> bool:
    if isinstance(err, OperationalError):
        orig_error = err.orig if hasattr(err, "orig") else None
        if orig_error and getattr(orig_error, "args", None):
            error_code = orig_error.args[0]
            return error_code in (1205, 1213)
    elif isinstance(err, PyMySQLOperationalError):
        if err.args and err.args[0] in (1205, 1213):
            return True
    return False


def _host_to_dict(host: "ProxyHost", service_ids: Optional[Sequence[int]] = None) -> dict:
    return {
        "remark": host.remark,
        "address": [i.strip() for i in host.address.split(",")] if host.address else [],
        "port": host.port,
        "path": host.path if host.path else None,
        "sni": [i.strip() for i in host.sni.split(",")] if host.sni else [],
        "host": [i.strip() for i in host.host.split(",")] if host.host else [],
        "alpn": host.alpn.value,
        "fingerprint": host.fingerprint.value,
        # None means the tls is not specified by host itself and
        # complies with its inbound's settings.
        "tls": None if host.security == ProxyHostSecurity.inbound_default else host.security.value,
        "allowinsecure": host.allowinsecure,
        "mux_enable": host.mux_enable,
        "fragment_setting": host.fragment_setting,
        "noise_setting": host.noise_setting,
        "random_user_agent": host.random_user_agent,
        "use_sni_as_host": host.use_sni_as_host,
        "sort": host.sort if host.sort is not None else 0,
        "id": host.id,
        "service_ids": list(service_ids) if service_ids else [],
        "is_disabled": host.is_disabled,
        "inbound_tag": host.inbound_tag,
    }


def rebuild_service_hosts_cache() -> None:
    """
    Populate service_hosts_cache for all service_ids with deterministic ordering.
    Also updates Redis cache.
    """
    global service_hosts_cache_ts, config
    with _hosts_cache_lock:
        inbound_tags = set(config.inbounds_by_tag.keys())
        if not inbound_tags:
            try:
                with GetDB() as db:
                    raw_config = crud.get_xray_config(db)
                refreshed_config = XRayConfig(raw_config, api_port=config.api_port)
                config = refreshed_config
                inbound_tags = set(config.inbounds_by_tag.keys())
            except Exception:
                pass

        max_retries = 3
        attempt = 0
        while True:
            base_map = _empty_host_map()
            cache: Dict[Optional[int], Dict[str, list]] = {None: {k: [] for k in base_map}}

            host_dicts = []
            try:
                with GetDB() as db:
                    hosts = (
                        db.query(db_models.ProxyHost)
                        .options(
                            joinedload(db_models.ProxyHost.service_links).joinedload(db_models.ServiceHostLink.service)
                        )
                        .filter(db_models.ProxyHost.inbound_tag.in_(inbound_tags))
                        .all()
                    )
                    for host in hosts:
                        if host.is_disabled:
                            continue
                        if host.inbound_tag not in inbound_tags:
                            continue

                        service_ids = [
                            link.service_id
                            for link in getattr(host, "service_links", [])
                            if link.service_id is not None
                        ]
                        host_dict = _host_to_dict(host, service_ids)
                        host_dicts.append(host_dict)
                        # Always include global (None) plus any linked services so "No service"
                        # users still see all active hosts.
                        target_service_ids = (service_ids or []) + [None]

                        for service_id in target_service_ids:
                            host_map = cache.setdefault(service_id, {k: [] for k in base_map})
                            host_map.setdefault(host.inbound_tag, []).append(host_dict)
                break
            except (OperationalError, PyMySQLOperationalError) as err:
                if _is_retryable_db_error(err) and attempt < max_retries - 1:
                    attempt += 1
                    logger = logging.getLogger("uvicorn.error")
                    logger.warning(
                        "Deadlock/lock wait detected while rebuilding service hosts cache; "
                        f"retrying ({attempt}/{max_retries})..."
                    )
                    time.sleep(0.1 * attempt)
                    continue
                raise

        for host_map in cache.values():
            for tag in config.inbounds_by_tag.keys():
                host_map.setdefault(tag, [])
                host_map[tag].sort(key=lambda h: (h.get("sort", 0), h.get("id") or 0))

        service_hosts_cache.clear()
        service_hosts_cache.update(cache)
        service_hosts_cache_ts = time.time()

        # Update Redis cache
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import cache_service_host_map

                for service_id, host_map in cache.items():
                    cache_service_host_map(service_id, host_map)
            except Exception as e:
                logger = logging.getLogger("uvicorn.error")
                logger.warning(f"Failed to update Redis cache for service hosts: {e}")


def get_service_host_map(service_id: Optional[int], force_rebuild: bool = False) -> Dict[str, list]:
    """
    Return host map for the given service_id with TTL-based refresh.

    Args:
        service_id: Service ID to get host map for
        force_rebuild: If True, force rebuild cache even if TTL hasn't expired
    """
    now = time.time()
    with _hosts_cache_lock:
        if (
            force_rebuild
            or not service_hosts_cache
            or service_hosts_cache_ts is None
            or now - service_hosts_cache_ts > HOSTS_CACHE_TTL
        ):
            rebuild_service_hosts_cache()

        host_map = service_hosts_cache.get(service_id)
        if host_map is None:
            host_map = _empty_host_map()
        else:
            for tag in config.inbounds_by_tag.keys():
                host_map.setdefault(tag, [])

        return {tag: list(host_map.get(tag, [])) for tag in config.inbounds_by_tag.keys()}


if TYPE_CHECKING:
    from app.db.models import ProxyHost


def invalidate_service_hosts_cache() -> None:
    """
    Clear cached hosts so they will be rebuilt on next access.
    Also invalidates Redis cache.
    """
    global service_hosts_cache_ts
    with _hosts_cache_lock:
        service_hosts_cache.clear()
        service_hosts_cache_ts = None

        # Invalidate Redis cache
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import invalidate_service_host_map_cache

                invalidate_service_host_map_cache()
            except Exception:
                pass  # Don't fail if Redis is unavailable


@DictStorage
def hosts(storage: dict):
    """
    Reload hosts from the database using the cached host map.
    """
    storage.clear()
    rebuild_service_hosts_cache()
    host_map = service_hosts_cache.get(None, _empty_host_map())
    # DictStorage.update() triggers the refresh hook with no args; use dict.update to populate.
    dict.update(storage, host_map)
