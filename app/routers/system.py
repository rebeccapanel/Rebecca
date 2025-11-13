import logging
import subprocess
import time
from copy import deepcopy
from typing import Dict, List, Union

import commentjson
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

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
from app.utils.maintenance import maintenance_request
from config import XRAY_EXECUTABLE_PATH, XRAY_EXCLUDE_INBOUND_TAGS, XRAY_FALLBACKS_INBOUND_TAG

router = APIRouter(tags=["System"], prefix="/api", responses={401: responses._401})
logger = logging.getLogger(__name__)

_EXCLUDED_TAGS = {
    tag for tag in XRAY_EXCLUDE_INBOUND_TAGS if isinstance(tag, str) and tag.strip()
}
if XRAY_FALLBACKS_INBOUND_TAG:
    _EXCLUDED_TAGS.add(XRAY_FALLBACKS_INBOUND_TAG)

_MANAGEABLE_PROTOCOLS = set(ProxyTypes._value2member_map_.keys())


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


def _extract_filename(disposition: str | None, default: str) -> str:
    if not disposition:
        return default
    parts = disposition.split(";")
    for part in parts:
        if "filename=" in part:
            filename = part.split("=", 1)[1].strip().strip('"')
            return filename or default
    return default


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


@router.get("/maintenance/info", responses={403: responses._403})
def get_maintenance_info(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Return maintenance service insights (panel/node images)."""
    panel_info = _try_maintenance_json("/version/panel")
    node_info = _try_maintenance_json("/version/node")
    return {"panel": panel_info, "node": node_info}


@router.get("/maintenance/backup/export", responses={403: responses._403})
def download_backup(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Stream maintenance backup archive through the API."""
    resp = maintenance_request("POST", "/backup/export", timeout=1800, stream=True)
    filename = _extract_filename(
        resp.headers.get("content-disposition"), f"rebecca-backup-{int(time.time())}.zip"
    )
    media_type = resp.headers.get("content-type", "application/zip")
    return StreamingResponse(
        resp.iter_content(chunk_size=8192),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/maintenance/backup/import", responses={403: responses._403})
async def upload_backup(
    admin: Admin = Depends(Admin.check_sudo_admin),
    file: UploadFile = File(...),
):
    """Proxy backup import to the maintenance service."""
    data = await file.read()
    files = {"file": (file.filename, data, file.content_type or "application/octet-stream")}
    resp = maintenance_request("POST", "/backup/import", files=files, timeout=1800)
    return resp.json()


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

    raw_output = process.stdout.strip()
    auths = _parse_vlessenc_output(raw_output)

    if not auths:
        logger.warning("Unable to parse vlessenc output: %s", raw_output or "<empty>")
        raise HTTPException(status_code=500, detail="Unable to parse vlessenc output")

    return {"auths": auths}


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
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    inbound = _prepare_inbound_payload(payload)
    tag = inbound["tag"]
    config = _load_config(db)

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
    config = _load_config(db)
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
    config = _load_config(db)
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

    users_to_refresh: Dict[int, object] = {}
    for inbound_tag, hosts in modified_hosts.items():
        _, refreshed_users = crud.update_hosts(db, inbound_tag, hosts)
        for user in refreshed_users:
            if user.id is not None:
                users_to_refresh[user.id] = user

    xray.hosts.update()

    for user in users_to_refresh.values():
        xray.operations.update_user(dbuser=user)

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

        label = (
            entry.get("label")
            or entry.get("Authentication")
            or entry.get("authentication")
        )
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
