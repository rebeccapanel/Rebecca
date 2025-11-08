import subprocess
from copy import deepcopy
from typing import Dict, List, Union

import commentjson
from fastapi import APIRouter, Depends, HTTPException

from app import __version__
from app.runtime import xray
from app.db import Session, crud, get_db
from app.models.admin import Admin
from app.models.proxy import ProxyHost, ProxyInbound, ProxyTypes
from app.models.system import SystemStats
from app.models.user import UserStatus
from app.utils import responses
from app.utils.system import cpu_usage, realtime_bandwidth
from app.utils.xray_config import apply_config_and_restart
from config import (
    XRAY_EXECUTABLE_PATH,
    XRAY_JSON,
    XRAY_EXCLUDE_INBOUND_TAGS,
    XRAY_FALLBACKS_INBOUND_TAG,
)

router = APIRouter(tags=["System"], prefix="/api", responses={401: responses._401})

_EXCLUDED_TAGS = {
    tag for tag in XRAY_EXCLUDE_INBOUND_TAGS if isinstance(tag, str) and tag.strip()
}
if XRAY_FALLBACKS_INBOUND_TAG:
    _EXCLUDED_TAGS.add(XRAY_FALLBACKS_INBOUND_TAG)

_MANAGEABLE_PROTOCOLS = set(ProxyTypes._value2member_map_.keys())


@router.get("/system", response_model=SystemStats)
def get_system_stats(
    db: Session = Depends(get_db), admin: Admin = Depends(Admin.get_current)
):
    """Fetch system stats including CPU and user metrics."""
    cpu = cpu_usage()
    system = crud.get_system_usage(db)
    dbadmin: Union[Admin, None] = crud.get_admin(db, admin.username)

    total_user = crud.get_users_count(db, admin=dbadmin if not admin.is_sudo else None)
    users_active = crud.get_users_count(
        db, status=UserStatus.active, admin=dbadmin if not admin.is_sudo else None
    )
    users_disabled = crud.get_users_count(
        db, status=UserStatus.disabled, admin=dbadmin if not admin.is_sudo else None
    )
    users_on_hold = crud.get_users_count(
        db, status=UserStatus.on_hold, admin=dbadmin if not admin.is_sudo else None
    )
    users_expired = crud.get_users_count(
        db, status=UserStatus.expired, admin=dbadmin if not admin.is_sudo else None
    )
    users_limited = crud.get_users_count(
        db, status=UserStatus.limited, admin=dbadmin if not admin.is_sudo else None
    )
    online_users = crud.count_online_users(db, 24)
    realtime_bandwidth_stats = realtime_bandwidth()

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
        incoming_bandwidth_speed=realtime_bandwidth_stats.incoming_bytes,
        outgoing_bandwidth_speed=realtime_bandwidth_stats.outgoing_bytes,
    )


@router.get("/inbounds", response_model=Dict[ProxyTypes, List[ProxyInbound]])
def get_inbounds(admin: Admin = Depends(Admin.get_current)):
    """Retrieve inbound configurations grouped by protocol."""
    return xray.config.inbounds_by_protocol


@router.get(
    "/inbounds/full",
    responses={403: responses._403},
)
def get_inbounds_full(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Return detailed inbound definitions for manageable protocols."""
    config = _load_config()
    return [_sanitize_inbound(inbound) for inbound in _managed_inbounds(config)]


@router.get(
    "/xray/vlessenc",
    responses={403: responses._403},
)
def generate_vless_encryption_keys(
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Run `xray vlessenc` to generate authentication/encryption suggestions."""

    try:
        process = subprocess.run(
            [XRAY_EXECUTABLE_PATH, "vlessenc"],
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:  # pragma: no cover - depends on host setup
        raise HTTPException(status_code=500, detail="Xray binary not found") from exc
    except subprocess.CalledProcessError as exc:  # pragma: no cover - defensive
        detail = exc.stderr.strip() or exc.stdout.strip() or "Failed to run vlessenc"
        raise HTTPException(status_code=500, detail=detail) from exc

    auths: List[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw_line in process.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("Authentication:"):
            if current:
                auths.append(current)
            current = {
                "label": line.split("Authentication:", 1)[1].strip(),
            }
            continue

        if (
            current
            and (line.startswith('"decryption"') or line.startswith('"encryption"'))
            and ":" in line
        ):
            key, value = line.split(":", 1)
            current[key.strip().strip('"')] = value.strip().strip('"')

    if current:
        auths.append(current)

    if not auths:
        raise HTTPException(status_code=500, detail="Unable to parse vlessenc output")

    return {"auths": auths}


@router.get(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def get_inbound_detail(
    tag: str,
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    config = _load_config()
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
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    inbound = _prepare_inbound_payload(payload)
    tag = inbound["tag"]
    config = _load_config()

    if any(existing.get("tag") == tag for existing in config.get("inbounds", [])):
        raise HTTPException(status_code=400, detail=f"Inbound {tag} already exists")

    config.setdefault("inbounds", []).append(inbound)
    apply_config_and_restart(config)

    crud.get_or_create_inbound(db, tag)
    return _sanitize_inbound(inbound)


@router.put(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def update_inbound(
    tag: str,
    payload: dict,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    config = _load_config()
    index = _find_inbound_index(config, tag)
    if index is None:
        raise HTTPException(status_code=404, detail="Inbound not found")

    inbound = _prepare_inbound_payload(payload, enforce_tag=tag)
    config["inbounds"][index] = inbound
    apply_config_and_restart(config)

    crud.get_or_create_inbound(db, tag)
    return _sanitize_inbound(inbound)


@router.delete(
    "/inbounds/{tag}",
    responses={403: responses._403, 404: responses._404},
)
def delete_inbound(
    tag: str,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    config = _load_config()
    index = _find_inbound_index(config, tag)
    if index is None:
        raise HTTPException(status_code=404, detail="Inbound not found")

    inbound = config["inbounds"][index]
    if not _is_manageable_inbound(inbound):
        raise HTTPException(status_code=400, detail="This inbound cannot be managed via the dashboard")

    affected_services = crud.disable_hosts_for_inbound(db, tag)

    del config["inbounds"][index]
    apply_config_and_restart(config)

    try:
        crud.delete_inbound(db, tag)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    users_to_refresh: Dict[int, object] = {}
    for service in affected_services:
        allowed = crud.get_service_allowed_inbounds(service)
        refreshed = crud.refresh_service_users(db, service, allowed)
        for user in refreshed:
            if user.id is not None:
                users_to_refresh[user.id] = user

    db.commit()
    xray.hosts.update()

    for user in users_to_refresh.values():
        xray.operations.update_user(dbuser=user)

    return {"detail": "Inbound removed"}


@router.get(
    "/hosts", response_model=Dict[str, List[ProxyHost]], responses={403: responses._403}
)
def get_hosts(
    db: Session = Depends(get_db), admin: Admin = Depends(Admin.check_sudo_admin)
):
    """Get a list of proxy hosts grouped by inbound tag."""
    hosts = {tag: crud.get_hosts(db, tag) for tag in xray.config.inbounds_by_tag}
    return hosts


@router.put(
    "/hosts", response_model=Dict[str, List[ProxyHost]], responses={403: responses._403}
)
def modify_hosts(
    modified_hosts: Dict[str, List[ProxyHost]],
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Modify proxy hosts and update the configuration."""
    for inbound_tag in modified_hosts:
        if inbound_tag not in xray.config.inbounds_by_tag:
            raise HTTPException(
                status_code=400, detail=f"Inbound {inbound_tag} doesn't exist"
            )

    for inbound_tag, hosts in modified_hosts.items():
        crud.update_hosts(db, inbound_tag, hosts)

    xray.hosts.update()

    return {tag: crud.get_hosts(db, tag) for tag in xray.config.inbounds_by_tag}


def _load_config() -> dict:
    with open(XRAY_JSON, "r", encoding="utf-8") as file:
        return commentjson.loads(file.read())


def _is_manageable_inbound(inbound: dict) -> bool:
    tag = inbound.get("tag")
    protocol = inbound.get("protocol")
    if not isinstance(tag, str) or not isinstance(protocol, str):
        return False
    if protocol not in _MANAGEABLE_PROTOCOLS:
        return False
    return tag not in _EXCLUDED_TAGS


def _managed_inbounds(config: dict) -> List[dict]:
    return [
        inbound
        for inbound in config.get("inbounds", [])
        if _is_manageable_inbound(inbound)
    ]


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

    inbound["tag"] = tag
    inbound["protocol"] = protocol
    inbound["settings"] = settings

    return inbound
