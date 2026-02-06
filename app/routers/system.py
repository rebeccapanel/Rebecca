import base64
import binascii
import logging
import os
import re
import secrets
import subprocess
import time
from collections import deque
from copy import deepcopy
from typing import Dict, List, Union

import commentjson
import psutil
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func

from app import __version__
from app.runtime import xray
from app.db import Session, crud, get_db
from app.db.models import Admin as AdminModel, System as SystemModel, ProxyHost as DbProxyHost
from app.models.admin import Admin, AdminRole, AdminStatus
from app.models.proxy import ProxyHost, ProxyInbound, ProxyTypes
from app.models.system import (
    AdminOverviewStats,
    PersonalUsageStats,
    RedisStats,
    SystemStats,
    UsageStats,
)
from app.models.user import UserStatus
from app.utils import responses
from app.utils.system import cpu_usage, realtime_bandwidth
from app.utils.xray_config import apply_config, restart_xray_and_invalidate_cache
from app.utils.maintenance import maintenance_request
from config import XRAY_EXECUTABLE_PATH, XRAY_EXCLUDE_INBOUND_TAGS, XRAY_FALLBACKS_INBOUND_TAG, REDIS_ENABLED
from app.redis.client import get_redis

router = APIRouter(tags=["System"], prefix="/api", responses={401: responses._401})
logger = logging.getLogger(__name__)

_EXCLUDED_TAGS = {tag for tag in XRAY_EXCLUDE_INBOUND_TAGS if isinstance(tag, str) and tag.strip()}
if XRAY_FALLBACKS_INBOUND_TAG:
    _EXCLUDED_TAGS.add(XRAY_FALLBACKS_INBOUND_TAG)

_MANAGEABLE_PROTOCOLS = set(ProxyTypes._value2member_map_.keys())

HISTORY_MAX_ENTRIES = 6000
_system_history = {
    "cpu": deque(maxlen=HISTORY_MAX_ENTRIES),
    "memory": deque(maxlen=HISTORY_MAX_ENTRIES),
    "network": deque(maxlen=HISTORY_MAX_ENTRIES),
}

_panel_history = {
    "cpu": deque(maxlen=HISTORY_MAX_ENTRIES),
    "memory": deque(maxlen=HISTORY_MAX_ENTRIES),
}

_PANEL_PROCESS = psutil.Process(os.getpid())
_PANEL_PROCESS.cpu_percent(interval=None)


def _try_maintenance_json(path: str) -> dict | None:
    try:
        resp = maintenance_request("GET", path, timeout=20)
    except HTTPException as exc:
        if exc.status_code in (404, 502, 503):
            return None
        raise
    try:
        return resp.json()
    except Exception:
        return None


def _queue_xray_restart(bg: BackgroundTasks) -> None:
    def _restart() -> None:
        try:
            restart_xray_and_invalidate_cache()
        except Exception as exc:  # pragma: no cover - best effort background task
            logger.error("Failed to restart Xray after inbound change: %s", exc)

    bg.add_task(_restart)


@router.get("/system", response_model=SystemStats)
def get_system_stats(db: Session = Depends(get_db), admin: Admin = Depends(Admin.get_current)):
    """Fetch system stats including CPU and user metrics."""
    cpu = cpu_usage()
    system = crud.get_system_usage(db) or SystemModel(uplink=0, downlink=0)
    dbadmin: Union[Admin, None] = crud.get_admin(db, admin.username)

    scoped_admin = None if admin.role in (AdminRole.sudo, AdminRole.full_access) else dbadmin
    total_user = crud.get_users_count(db, admin=scoped_admin)
    users_active = crud.get_users_count(db, status=UserStatus.active, admin=scoped_admin)
    users_disabled = crud.get_users_count(db, status=UserStatus.disabled, admin=scoped_admin)
    users_on_hold = crud.get_users_count(db, status=UserStatus.on_hold, admin=scoped_admin)
    users_expired = crud.get_users_count(db, status=UserStatus.expired, admin=scoped_admin)
    users_limited = crud.get_users_count(db, status=UserStatus.limited, admin=scoped_admin)
    online_users = crud.count_online_users(db, None, scoped_admin)
    realtime_bandwidth_stats = realtime_bandwidth()
    now = time.time()
    system_memory = psutil.virtual_memory()
    system_swap = psutil.swap_memory()
    system_disk = psutil.disk_usage(os.path.abspath(os.sep))
    panel_total_bandwidth = int((system.uplink or 0) + (system.downlink or 0))
    load_avg: List[float] = []
    try:
        load_avg = list(psutil.getloadavg())
    except (AttributeError, OSError):
        load_avg = []

    uptime_seconds = max(0, int(now - psutil.boot_time()))
    current_process = _PANEL_PROCESS
    panel_cpu_percent = float(current_process.cpu_percent(interval=None))
    panel_memory_percent = float(current_process.memory_percent())
    panel_uptime_seconds = max(0, int(now - current_process.create_time()))
    app_memory = current_process.memory_info().rss
    app_threads = current_process.num_threads()

    xray_running = False
    xray_uptime_seconds = 0
    xray_version = None
    last_xray_error = None
    if xray and getattr(xray, "core", None):
        xray_running = bool(xray.core.started)
        xray_version = xray.core.version
        xray_proc = getattr(xray.core, "process", None)
        if xray_proc:
            try:
                xray_process = psutil.Process(xray_proc.pid)
                if xray_running:
                    xray_uptime_seconds = max(0, int(now - xray_process.create_time()))
            except (psutil.NoSuchProcess, AttributeError):
                xray_uptime_seconds = 0

        # Get last error if Xray is not running (stopped/crashed)
        if not xray_running:
            try:
                last_xray_error = xray.core.get_last_error()
            except (AttributeError, Exception):
                last_xray_error = None

    timestamp = int(now)
    _system_history["cpu"].append({"timestamp": timestamp, "value": float(cpu.percent)})
    _system_history["memory"].append({"timestamp": timestamp, "value": float(system_memory.percent)})
    _system_history["network"].append(
        {
            "timestamp": timestamp,
            "incoming": realtime_bandwidth_stats.incoming_bytes,
            "outgoing": realtime_bandwidth_stats.outgoing_bytes,
        }
    )
    _panel_history["cpu"].append({"timestamp": timestamp, "value": panel_cpu_percent})
    _panel_history["memory"].append({"timestamp": timestamp, "value": panel_memory_percent})

    personal_total_users = total_user if scoped_admin else 0
    if dbadmin and admin.role in (AdminRole.sudo, AdminRole.full_access):
        personal_total_users = crud.get_users_count(db, admin=dbadmin)

    consumed_bytes = int(getattr(dbadmin, "users_usage", 0) or 0)
    built_bytes = int(getattr(dbadmin, "lifetime_usage", 0) or 0)
    reset_bytes = max(built_bytes - consumed_bytes, 0)
    personal_usage = PersonalUsageStats(
        total_users=personal_total_users,
        consumed_bytes=consumed_bytes,
        built_bytes=built_bytes,
        reset_bytes=reset_bytes,
    )

    role_counts = {
        (role.name if isinstance(role, AdminRole) else str(role)): count
        for role, count in (
            db.query(AdminModel.role, func.count())
            .filter(AdminModel.status != AdminStatus.deleted)
            .group_by(AdminModel.role)
            .all()
        )
    }
    total_admins = int(sum(role_counts.values()))
    admin_overview = AdminOverviewStats(
        total_admins=total_admins,
        sudo_admins=int(role_counts.get(AdminRole.sudo.name, 0)),
        full_access_admins=int(role_counts.get(AdminRole.full_access.name, 0)),
        standard_admins=int(role_counts.get(AdminRole.standard.name, 0)),
        top_admin_username=None,
        top_admin_usage=0,
    )
    top_admin = (
        db.query(AdminModel)
        .filter(AdminModel.status != AdminStatus.deleted)
        .order_by(AdminModel.users_usage.desc())
        .first()
    )
    if top_admin:
        admin_overview.top_admin_username = top_admin.username
        admin_overview.top_admin_usage = int(top_admin.users_usage or 0)

    # Get Redis stats
    redis_stats = None
    if REDIS_ENABLED:
        redis_client = get_redis()
        redis_connected = False
        redis_memory_used = 0
        redis_memory_total = 0
        redis_memory_percent = 0.0
        redis_uptime_seconds = 0
        redis_version = None
        redis_keys_count = 0
        redis_keys_cached = 0
        redis_commands_processed = 0
        redis_hits = 0
        redis_misses = 0
        redis_hit_rate = 0.0

        if redis_client:
            try:
                redis_client.ping()
                redis_connected = True

                # Get Redis INFO
                info = redis_client.info()
                stats_info = redis_client.info("stats")

                # Memory stats
                redis_memory_used = int(info.get("used_memory", 0))
                redis_memory_total = int(info.get("maxmemory", 0))
                if redis_memory_total == 0:
                    redis_memory_total = redis_memory_used if redis_memory_used > 0 else 1
                    redis_memory_percent = 0.0  # No limit set, so percentage is not meaningful
                else:
                    redis_memory_percent = (redis_memory_used / redis_memory_total) * 100.0

                # Uptime
                redis_uptime_seconds = int(info.get("uptime_in_seconds", 0))

                # Version
                redis_version = info.get("redis_version")

                try:
                    redis_keys_count = redis_client.dbsize()
                except Exception:
                    db0_info = info.get("db0")
                    if isinstance(db0_info, dict):
                        redis_keys_count = int(db0_info.get("keys", 0))
                    elif isinstance(db0_info, str):
                        try:
                            for part in db0_info.split(","):
                                if part.startswith("keys="):
                                    redis_keys_count = int(part.split("=")[1])
                                    break
                        except Exception:
                            pass
                    else:
                        redis_keys_count = 0

                # Count cached subscription keys
                try:
                    from app.redis.subscription import REDIS_KEY_PREFIX_USERNAME

                    pattern = f"{REDIS_KEY_PREFIX_USERNAME}*"
                    redis_keys_cached = len(redis_client.keys(pattern))
                except Exception:
                    redis_keys_cached = 0

                redis_commands_processed = int(stats_info.get("total_commands_processed", 0))

                # Cache hits/misses (from keyspace stats)
                redis_hits = int(stats_info.get("keyspace_hits", 0))
                redis_misses = int(stats_info.get("keyspace_misses", 0))
                total_requests = redis_hits + redis_misses
                if total_requests > 0:
                    redis_hit_rate = (redis_hits / total_requests) * 100.0
                else:
                    redis_hit_rate = 0.0

            except Exception as e:
                logger.debug(f"Failed to get Redis stats: {e}")
                redis_connected = False

        redis_stats = RedisStats(
            enabled=True,
            connected=redis_connected,
            memory_used=redis_memory_used,
            memory_total=redis_memory_total,
            memory_percent=redis_memory_percent,
            uptime_seconds=redis_uptime_seconds,
            version=redis_version,
            keys_count=redis_keys_count,
            keys_cached=redis_keys_cached,
            commands_processed=redis_commands_processed,
            hits=redis_hits,
            misses=redis_misses,
            hit_rate=redis_hit_rate,
        )
    else:
        redis_stats = RedisStats(
            enabled=False,
            connected=False,
        )

    # Get last Telegram error (only for sudo/full_access admins)
    last_telegram_error = None
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        try:
            from app.telegram.handlers.report import get_last_telegram_error

            telegram_error = get_last_telegram_error()
            if telegram_error:
                error_code = telegram_error.get("error_code")
                description = telegram_error.get("description", telegram_error.get("error", ""))
                category = telegram_error.get("category", "unknown")
                target = telegram_error.get("target", "unknown")
                if error_code:
                    last_telegram_error = f"Error {error_code}: {description} (Category: {category}, Target: {target})"
                else:
                    last_telegram_error = f"{description} (Category: {category}, Target: {target})"
        except Exception:
            pass

    return SystemStats(
        version=__version__,
        cpu_cores=cpu.cores,
        cpu_usage=cpu.percent,
        total_user=total_user,
        online_users=online_users,
        users_active=users_active,
        users_disabled=users_disabled,
        users_expired=users_expired,
        users_limited=users_limited,
        users_on_hold=users_on_hold,
        incoming_bandwidth=system.uplink,
        outgoing_bandwidth=system.downlink,
        panel_total_bandwidth=panel_total_bandwidth,
        incoming_bandwidth_speed=realtime_bandwidth_stats.incoming_bytes,
        outgoing_bandwidth_speed=realtime_bandwidth_stats.outgoing_bytes,
        memory=UsageStats(
            current=system_memory.used,
            total=system_memory.total,
            percent=float(system_memory.percent),
        ),
        swap=UsageStats(
            current=system_swap.used,
            total=system_swap.total,
            percent=float(system_swap.percent),
        ),
        disk=UsageStats(
            current=system_disk.used,
            total=system_disk.total,
            percent=float(system_disk.percent),
        ),
        load_avg=load_avg,
        uptime_seconds=uptime_seconds,
        panel_uptime_seconds=panel_uptime_seconds,
        xray_uptime_seconds=xray_uptime_seconds,
        xray_running=xray_running,
        xray_version=xray_version,
        app_memory=app_memory,
        app_threads=app_threads,
        panel_cpu_percent=panel_cpu_percent,
        panel_memory_percent=panel_memory_percent,
        cpu_history=list(_system_history["cpu"]),
        memory_history=list(_system_history["memory"]),
        network_history=list(_system_history["network"]),
        panel_cpu_history=list(_panel_history["cpu"]),
        panel_memory_history=list(_panel_history["memory"]),
        personal_usage=personal_usage,
        admin_overview=admin_overview,
        last_xray_error=last_xray_error,
        last_telegram_error=last_telegram_error,
        redis_stats=redis_stats,
    )


@router.get("/maintenance/info", responses={403: responses._403})
def get_maintenance_info(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Return maintenance service insights (panel/node images)."""
    panel_info = _try_maintenance_json("/version/panel")
    node_info = _try_maintenance_json("/version/node")
    return {"panel": panel_info, "node": node_info}


@router.post("/maintenance/update", responses={403: responses._403})
def update_panel_from_maintenance(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Trigger the maintenance service to pull the latest panel/node images."""
    maintenance_request("POST", "/update")
    return {"status": "ok"}


@router.post("/maintenance/restart", responses={403: responses._403})
def restart_panel_from_maintenance(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Ask the maintenance service to restart the Rebecca stack."""
    maintenance_request("POST", "/restart")
    return {"status": "ok"}


@router.post("/maintenance/soft-reload", responses={403: responses._403})
def soft_reload_panel_from_maintenance(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Soft reload the panel without restarting Xray core or nodes.

    This reloads configuration from database and invalidates caches,
    but keeps all connections active. Use this when you want to refresh
    the panel state without interrupting active connections.
    """
    from app.utils.xray_config import soft_reload_panel

    soft_reload_panel()
    return {"status": "ok", "message": "Panel soft reloaded successfully"}


@router.get("/inbounds", response_model=Dict[ProxyTypes, List[ProxyInbound]])
def get_inbounds(admin: Admin = Depends(Admin.get_current)):
    """Retrieve inbound configurations grouped by protocol."""
    return xray.config.inbounds_by_protocol


@router.get(
    "/inbounds/full",
    responses={403: responses._403},
)
def get_inbounds_full(
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Return detailed inbound definitions for manageable protocols."""
    config = _load_config(db)
    return [_sanitize_inbound(inbound) for inbound in _managed_inbounds(config)]


@router.get(
    "/xray/vlessenc",
    responses={403: responses._403},
)
def generate_vless_encryption_keys(
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Run `xray vlessenc` to generate authentication/encryption suggestions."""

    def _fallback_auths() -> dict:
        # Minimal fallback so UI remains usable even if xray binary is missing or output can't be parsed.
        return {
            "auths": [
                {"label": "none", "encryption": "none", "decryption": "none"},
            ]
        }

    try:
        process = subprocess.run(
            [XRAY_EXECUTABLE_PATH, "vlessenc"],
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError:  # pragma: no cover - depends on host setup
        return _fallback_auths()
    except subprocess.CalledProcessError as exc:  # pragma: no cover - defensive
        detail = exc.stderr.strip() or exc.stdout.strip() or ""
        logger.warning("vlessenc failed: %s", detail or exc)
        return _fallback_auths()

    raw_output = process.stdout.strip()
    auths = _parse_vlessenc_output(raw_output)

    if not auths:
        logger.warning("Unable to parse vlessenc output: %s", raw_output or "<empty>")
        return _fallback_auths()

    return {"auths": auths}


@router.get(
    "/xray/reality-keypair",
    responses={403: responses._403},
)
def generate_reality_keypair(
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Generate a REALITY key pair using Xray's x25519 command."""
    try:
        result = xray.core.get_x25519()
        if not result:
            raise HTTPException(status_code=500, detail="Failed to generate key pair")

        priv_hex = result.get("private_key")
        pub_hex = result.get("public_key")
        if not priv_hex or not pub_hex:
            raise HTTPException(status_code=500, detail="Failed to generate key pair")

        try:
            priv_bytes = bytes.fromhex(priv_hex.strip())
            pub_bytes = bytes.fromhex(pub_hex.strip())
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to parse generated key pair") from exc

        if len(priv_bytes) != 32 or len(pub_bytes) != 32:
            raise HTTPException(status_code=500, detail="Generated key pair is invalid")

        priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode("utf-8")
        pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("utf-8")

        return {"privateKey": priv_b64, "publicKey": pub_b64}
    except FileNotFoundError as exc:  # pragma: no cover - depends on host setup
        raise HTTPException(status_code=500, detail="Xray binary not found") from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to generate REALITY key pair: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to generate key pair: {str(exc)}") from exc


@router.get("/system/redis-status")
def redis_status(admin: Admin = Depends(Admin.check_sudo_admin)):
    enabled = bool(REDIS_ENABLED)
    connected = False
    client = get_redis() if enabled else None
    if client:
        try:
            connected = bool(client.ping())
        except Exception:
            connected = False
    return {"enabled": enabled, "connected": connected}


@router.get(
    "/xray/reality-shortid",
    responses={403: responses._403},
)
def generate_reality_shortid(
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Generate a REALITY short ID (8 hex characters)."""
    short_id_bytes = secrets.token_bytes(4)
    short_id = short_id_bytes.hex()
    return {"shortId": short_id}


@router.get(
    "/xray/mldsa65",
    responses={403: responses._403},
)
def generate_mldsa65(
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Generate an ML-DSA-65 keypair using Xray's mldsa65 command."""
    try:
        result = xray.core.get_mldsa65()
        if not result:
            raise HTTPException(status_code=500, detail="Failed to generate ML-DSA-65 keypair")
        seed = result.get("seed")
        verify = result.get("verify")
        if not seed or not verify:
            raise HTTPException(status_code=500, detail="Failed to parse ML-DSA-65 keypair")
        return {"seed": seed, "verify": verify}
    except FileNotFoundError as exc:  # pragma: no cover - depends on host setup
        raise HTTPException(status_code=500, detail="Xray binary not found") from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to generate ML-DSA-65 keypair: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to generate ML-DSA-65 keypair: {str(exc)}") from exc


@router.get(
    "/xray/ech",
    responses={403: responses._403},
)
def generate_ech_cert(
    sni: str,
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Generate an ECH certificate using Xray's tls ech command."""
    if not sni or not sni.strip():
        raise HTTPException(status_code=400, detail="SNI is required to generate ECH certificate")
    try:
        result = xray.core.get_ech_cert(sni)
        if not result:
            raise HTTPException(status_code=500, detail="Failed to generate ECH certificate")
        ech_server_keys = result.get("echServerKeys")
        ech_config_list = result.get("echConfigList")
        if not ech_server_keys or not ech_config_list:
            raise HTTPException(status_code=500, detail="Failed to parse ECH certificate")
        return {"echServerKeys": ech_server_keys, "echConfigList": ech_config_list}
    except FileNotFoundError as exc:  # pragma: no cover - depends on host setup
        raise HTTPException(status_code=500, detail="Xray binary not found") from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to generate ECH certificate: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to generate ECH certificate: {str(exc)}") from exc


@router.get(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def get_inbound_detail(
    tag: str,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    config = _load_config(db)
    inbound = _get_inbound_by_tag(config, tag)
    if inbound is None:
        raise HTTPException(status_code=404, detail="Inbound not found")
    return _sanitize_inbound(inbound)


@router.post(
    "/inbounds",
    responses={403: responses._403},
)
def create_inbound(
    payload: dict,
    bg: BackgroundTasks,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    inbound = _prepare_inbound_payload(payload)
    tag = inbound["tag"]
    config = _load_config(db)

    if any(existing.get("tag") == tag for existing in config.get("inbounds", [])):
        raise HTTPException(status_code=400, detail=f"Inbound {tag} already exists")

    config.setdefault("inbounds", []).append(inbound)
    apply_config(config)
    _queue_xray_restart(bg)

    crud.get_or_create_inbound(db, tag)
    # Ensure hosts cache is updated after inbound is created
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
            from app.reb_node.config import XRayConfig

            raw_config = crud.get_xray_config(db)
            xray_config = XRayConfig(raw_config, api_port=xray.config.api_port)
            inbounds_dict = {
                "inbounds_by_tag": {tag: inbound for tag, inbound in xray_config.inbounds_by_tag.items()},
                "inbounds_by_protocol": {proto: tags for proto, tags in xray_config.inbounds_by_protocol.items()},
            }
            cache_inbounds(inbounds_dict)
            invalidate_service_host_map_cache()
        except Exception:
            pass  # Don't fail if Redis is unavailable

    return _sanitize_inbound(inbound)


@router.put(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def update_inbound(
    tag: str,
    payload: dict,
    bg: BackgroundTasks,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    config = _load_config(db)
    index = _find_inbound_index(config, tag)
    if index is None:
        raise HTTPException(status_code=404, detail="Inbound not found")

    inbound = _prepare_inbound_payload(payload, enforce_tag=tag)
    config["inbounds"][index] = inbound
    apply_config(config)
    _queue_xray_restart(bg)

    crud.get_or_create_inbound(db, tag)
    # Ensure hosts cache is updated after inbound is updated
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
            from app.reb_node.config import XRayConfig

            raw_config = crud.get_xray_config(db)
            xray_config = XRayConfig(raw_config, api_port=xray.config.api_port)
            inbounds_dict = {
                "inbounds_by_tag": {tag: inbound for tag, inbound in xray_config.inbounds_by_tag.items()},
                "inbounds_by_protocol": {proto: tags for proto, tags in xray_config.inbounds_by_protocol.items()},
            }
            cache_inbounds(inbounds_dict)
            invalidate_service_host_map_cache()
        except Exception:
            pass  # Don't fail if Redis is unavailable

    return _sanitize_inbound(inbound)


@router.delete(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def delete_inbound(
    tag: str,
    bg: BackgroundTasks,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    config = _load_config(db)
    index = _find_inbound_index(config, tag)
    if index is None:
        raise HTTPException(status_code=404, detail="Inbound not found")

    inbound = config["inbounds"][index]
    if not _is_manageable_inbound(inbound):
        raise HTTPException(status_code=400, detail="This inbound cannot be managed via the dashboard")

    affected_services = crud.remove_hosts_for_inbound(db, tag)
    del config["inbounds"][index]
    apply_config(config)
    _queue_xray_restart(bg)

    try:
        crud.delete_inbound(db, tag)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    users_to_refresh: Dict[int, object] = {}
    for service in affected_services:
        from app.services.data_access import get_service_allowed_inbounds_cached

        allowed = get_service_allowed_inbounds_cached(db, service)
        refreshed = crud.refresh_service_users(db, service, allowed)
        for user in refreshed:
            if user.id is not None:
                users_to_refresh[user.id] = user

    db.commit()
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
            from app.reb_node.config import XRayConfig

            raw_config = crud.get_xray_config(db)
            xray_config = XRayConfig(raw_config, api_port=xray.config.api_port)
            inbounds_dict = {
                "inbounds_by_tag": {tag: inbound for tag, inbound in xray_config.inbounds_by_tag.items()},
                "inbounds_by_protocol": {proto: tags for proto, tags in xray_config.inbounds_by_protocol.items()},
            }
            cache_inbounds(inbounds_dict)
            invalidate_service_host_map_cache()
            from app.reb_node.state import rebuild_service_hosts_cache
            from app.redis.cache import cache_service_host_map
            from app.reb_node import state as xray_state

            rebuild_service_hosts_cache()
            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map:
                    cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if Redis is unavailable

    for user in users_to_refresh.values():
        xray.operations.update_user(dbuser=user)

    return {"detail": "Inbound removed"}


def _ensure_hosts_permission(admin: Admin) -> None:
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return
    if getattr(admin.permissions.sections, "hosts", False):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")


class HostStatusPayload(BaseModel):
    is_disabled: bool


@router.get("/hosts", response_model=Dict[str, List[ProxyHost]], responses={403: responses._403})
def get_hosts(db: Session = Depends(get_db), admin: Admin = Depends(Admin.require_active)):
    """Get a list of proxy hosts grouped by inbound tag."""
    _ensure_hosts_permission(admin)
    from app.services.data_access import get_inbounds_by_tag_cached

    inbound_map = get_inbounds_by_tag_cached(db)
    if not inbound_map:
        inbound_map = xray.config.inbounds_by_tag

    hosts_dict = {}
    for tag in inbound_map:
        try:
            db_hosts = crud.get_hosts(db, tag)
            hosts_dict[tag] = [ProxyHost.model_validate(host) for host in db_hosts]
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(f"Failed to get hosts for tag {tag}: {e}", exc_info=True)
            hosts_dict[tag] = []

    return hosts_dict


@router.put(
    "/hosts/{host_id}/status",
    response_model=ProxyHost,
    responses={403: responses._403, 404: responses._404},
)
def update_host_status(
    host_id: int,
    payload: HostStatusPayload,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.require_active),
):
    """Quickly enable/disable a host without full host refresh."""
    _ensure_hosts_permission(admin)
    host = db.query(DbProxyHost).filter(DbProxyHost.id == host_id).first()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    host.is_disabled = bool(payload.is_disabled)
    db.commit()
    db.refresh(host)

    # Update host cache asynchronously to keep subscriptions up to date.
    bg.add_task(xray.hosts.update)

    return ProxyHost.model_validate(host)


@router.put("/hosts", response_model=Dict[str, List[ProxyHost]], responses={403: responses._403})
def modify_hosts(
    modified_hosts: Dict[str, List[ProxyHost]],
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.require_active),
):
    """Modify proxy hosts and update the configuration."""
    _ensure_hosts_permission(admin)
    for inbound_tag in modified_hosts:
        if inbound_tag not in xray.config.inbounds_by_tag:
            raise HTTPException(status_code=400, detail=f"Inbound {inbound_tag} doesn't exist")

    # Collect all host IDs that are present in the payload to prevent deletion
    # when moving hosts between inbounds.
    all_kept_ids = set()
    for hosts in modified_hosts.values():
        for host in hosts:
            if host.id is not None:
                all_kept_ids.add(host.id)

    users_to_refresh: Dict[int, object] = {}
    for inbound_tag, hosts in modified_hosts.items():
        _, refreshed_users = crud.update_hosts(db, inbound_tag, hosts, kept_ids=all_kept_ids)
        for user in refreshed_users:
            if user.id is not None:
                users_to_refresh[user.id] = user

    # Schedule slower side-effects in background to reduce response latency
    bg.add_task(xray.hosts.update)

    from config import REDIS_ENABLED

    if REDIS_ENABLED:

        def _refresh_redis_caches():
            try:
                from app.redis.cache import invalidate_service_host_map_cache, invalidate_inbounds_cache
                from app.reb_node.state import rebuild_service_hosts_cache
                from app.redis.cache import cache_service_host_map
                from app.reb_node import state as xray_state

                invalidate_service_host_map_cache()
                invalidate_inbounds_cache()
                rebuild_service_hosts_cache()
                for service_id, host_map in xray_state.service_hosts_cache.items():
                    if host_map:
                        cache_service_host_map(service_id, host_map)
            except Exception:
                pass

        bg.add_task(_refresh_redis_caches)

    for user in users_to_refresh.values():
        bg.add_task(xray.operations.update_user, dbuser=user)

    return {tag: crud.get_hosts(db, tag) for tag in xray.config.inbounds_by_tag}


def _load_config(db: Session) -> dict:
    return deepcopy(crud.get_xray_config(db))


def _is_manageable_inbound(inbound: dict) -> bool:
    tag = inbound.get("tag")
    protocol = inbound.get("protocol")
    if not isinstance(tag, str) or not isinstance(protocol, str):
        return False
    if protocol not in _MANAGEABLE_PROTOCOLS:
        return False
    return tag not in _EXCLUDED_TAGS


def _managed_inbounds(config: dict) -> List[dict]:
    return [inbound for inbound in config.get("inbounds", []) if _is_manageable_inbound(inbound)]


def _get_inbound_by_tag(config: dict, tag: str) -> dict | None:
    for inbound in _managed_inbounds(config):
        if inbound.get("tag") == tag:
            return inbound
    return None


def _find_inbound_index(config: dict, tag: str) -> int | None:
    for idx, inbound in enumerate(config.get("inbounds", [])):
        if inbound.get("tag") == tag:
            return idx
    return None


def _sanitize_inbound(inbound: dict) -> dict:
    sanitized = deepcopy(inbound)
    settings = sanitized.get("settings")
    if isinstance(settings, dict):
        settings["clients"] = []
    else:
        sanitized["settings"] = {"clients": []}
    return sanitized


def _normalize_reality_private_key(private_key: str) -> str:
    """
    Normalize a REALITY private key to the format expected by Xray.
    Xray expects base64url-encoded keys without padding.
    """
    if not private_key:
        return ""

    # Remove all whitespace
    normalized = "".join(private_key.split())

    if re.fullmatch(r"[0-9a-fA-F]{64}", normalized):
        decoded = bytes.fromhex(normalized)
        return base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("utf-8")

    # Try base64url first (Xray's preferred format)
    try:
        # Add padding for decode if needed
        padding_needed = (4 - len(normalized) % 4) % 4
        decoded = base64.urlsafe_b64decode(normalized + "=" * padding_needed)
        if len(decoded) != 32:
            raise ValueError("Private key must be 32 bytes")
        # Re-encode without padding (Xray format)
        return base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("utf-8")
    except (binascii.Error, ValueError):
        pass

    # Try standard base64
    try:
        padding = "=" * ((4 - len(normalized) % 4) % 4)
        decoded = base64.b64decode(normalized + padding)
        if len(decoded) != 32:
            raise ValueError("Private key must be 32 bytes")
        # Convert to base64url without padding
        return base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("utf-8")
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid REALITY private key format: {str(e)}") from e


def _normalize_reality_short_id(short_id: str) -> str:
    """
    Normalize a REALITY short ID by removing whitespace only.
    No validation or restrictions - accepts any value entered by user.
    """
    if not short_id:
        return ""

    # Only remove whitespace, preserve everything else as entered
    normalized = "".join(short_id.split())

    return normalized


def _prepare_inbound_payload(payload: dict, enforce_tag: str | None = None) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")

    inbound = deepcopy(payload)
    tag = inbound.get("tag") or enforce_tag
    if not isinstance(tag, str) or not tag.strip():
        raise HTTPException(status_code=400, detail="Inbound tag is required")
    tag = tag.strip()
    if enforce_tag and tag != enforce_tag:
        raise HTTPException(status_code=400, detail="Inbound tag cannot be changed")
    if tag in _EXCLUDED_TAGS:
        raise HTTPException(status_code=400, detail=f"Inbound {tag} is reserved")

    protocol = inbound.get("protocol")
    if protocol not in _MANAGEABLE_PROTOCOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Protocol must be one of: {', '.join(sorted(_MANAGEABLE_PROTOCOLS))}",
        )

    settings = inbound.get("settings")
    if settings is None:
        settings = {}
    if not isinstance(settings, dict):
        raise HTTPException(status_code=400, detail="'settings' must be an object")
    settings["clients"] = []

    # Normalize REALITY settings if present
    stream_settings = inbound.get("streamSettings", {})
    if isinstance(stream_settings, dict):
        reality_settings = stream_settings.get("realitySettings")
        if isinstance(reality_settings, dict):
            # Normalize privateKey
            if "privateKey" in reality_settings and reality_settings["privateKey"]:
                try:
                    reality_settings["privateKey"] = _normalize_reality_private_key(reality_settings["privateKey"])
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Invalid REALITY privateKey: {str(e)}") from e

            # Normalize shortIds
            if "shortIds" in reality_settings:
                short_ids = reality_settings["shortIds"]
                if isinstance(short_ids, str):
                    # Split by comma, newline, or space
                    short_ids = re.split(r"[,\s\n]+", short_ids)
                if isinstance(short_ids, list):
                    normalized_ids = []
                    for sid in short_ids:
                        if isinstance(sid, str) and sid.strip():
                            normalized = _normalize_reality_short_id(sid)
                            if normalized:
                                normalized_ids.append(normalized)
                    reality_settings["shortIds"] = normalized_ids if normalized_ids else []
                else:
                    reality_settings["shortIds"] = []

    inbound["tag"] = tag
    inbound["protocol"] = protocol
    inbound["settings"] = settings

    return inbound


def _parse_vlessenc_output(raw_output: str) -> List[dict[str, str]]:
    """
    Parse the stdout generated by `xray vlessenc`.

    vlessenc output format changed between versions; it may emit JSON,
    key/value lines, or lightly formatted text. This helper tries to
    support all observed variants gracefully.
    """

    if not raw_output:
        return []

    parsed = _parse_vlessenc_json(raw_output)
    if parsed:
        return parsed

    def extract_value(segment: str) -> str:
        for separator in (":", "="):
            if separator in segment:
                value = segment.split(separator, 1)[1]
                break
        else:
            parts = segment.split(maxsplit=1)
            value = parts[1] if len(parts) == 2 else ""
        return value.strip().strip('"').strip("'").strip(",")

    auths: List[dict[str, str]] = []
    current: dict[str, str] | None = None

    for raw_line in raw_output.splitlines():
        line = raw_line.strip()
        if not line or line in {"{", "}", "[", "]"}:
            continue

        normalized = line.lower().lstrip("{[").rstrip("]},")

        if "authentication" in normalized:
            if current and current.get("label"):
                auths.append(current)
            label = extract_value(line)
            current = {"label": label or "Authentication"}
            continue

        if current and "decryption" in normalized:
            value = extract_value(line)
            if value:
                current["decryption"] = value
            continue

        if current and "encryption" in normalized:
            value = extract_value(line)
            if value:
                current["encryption"] = value
            continue

    if current and current.get("label"):
        auths.append(current)

    return auths


def _parse_vlessenc_json(raw_output: str) -> List[dict[str, str]]:
    try:
        data = commentjson.loads(raw_output)
    except Exception:
        return []

    def normalize_entry(entry: dict) -> dict | None:
        if not isinstance(entry, dict):
            return None

        label = entry.get("label") or entry.get("Authentication") or entry.get("authentication")
        if not label:
            return None

        result = {"label": str(label).strip()}
        if "decryption" in entry and entry["decryption"]:
            result["decryption"] = str(entry["decryption"]).strip()
        if "encryption" in entry and entry["encryption"]:
            result["encryption"] = str(entry["encryption"]).strip()
        return result

    records: List[dict] = []
    if isinstance(data, dict):
        possible = None
        for key in ("auths", "Authentications", "authentication"):
            if key in data:
                possible = data[key]
                break
        if possible is None:
            possible = [data]
        if isinstance(possible, list):
            records = possible
    elif isinstance(data, list):
        records = data

    auths: List[dict[str, str]] = []
    for item in records:
        normalized = normalize_entry(item)
        if normalized:
            auths.append(normalized)

    return auths
