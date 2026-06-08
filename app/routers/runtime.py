import asyncio
import time
import json
import contextlib
import ipaddress
import socket
import threading

from fastapi import APIRouter, Depends, HTTPException, WebSocket, Body, BackgroundTasks, Request
from starlette.websockets import WebSocketDisconnect

from app.services import access_insights, node_operations
from app.db import Session, get_db, crud, GetDB
from app.db.models import OutboundTraffic
from app.models.admin import Admin, AdminRole
from app.models.runtime import RuntimeStats, ServerIPs
from app.utils.xray_logs import sort_log_lines
from app.models.warp import (
    WarpAccountResponse,
    WarpConfigResponse,
    WarpLicenseUpdate,
    WarpRegisterRequest,
    WarpRegisterResponse,
)
from app.services.warp import WarpAccountNotFound, WarpService, WarpServiceError
from app.services import go_master_api
from app.utils import responses
from app.utils.system import get_public_ip, get_public_ipv6
from app.utils.outbound import extract_outbound_metadata, generate_outbound_id
from app.utils.xray_targets import (
    MASTER_TARGET_ID,
    node_target_id,
    parse_target_id,
    get_node_effective_raw_config,
)
import os
import requests
from urllib.parse import urlparse

router = APIRouter(tags=["Runtime"], prefix="/api", responses={401: responses._401})

GITHUB_RELEASES = "https://api.github.com/repos/XTLS/Xray-core/releases"
GEO_TEMPLATES_INDEX_DEFAULT = "https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json"
OUTBOUND_TEST_DEFAULT_URL = "https://www.google.com/generate_204"
_OUTBOUND_TEST_LOCK = threading.Lock()
_ALLOWED_GEO_FILENAMES = {"geoip.dat", "geosite.dat"}
NATIVE_NODE_API_REQUIRED_DETAIL = "Native Go Master API is required for this node operation."


class _RuntimeXrayProxy:
    """Live compatibility target for legacy runtime log-source tests."""

    def __getattr__(self, name):
        from app import runtime as runtime_state

        target = runtime_state.xray
        if target is None:
            raise AttributeError(name)
        return getattr(target, name)


xray = _RuntimeXrayProxy()


def _authorization_from_token(token: str) -> str:
    return token if token.lower().startswith("bearer ") else f"Bearer {token}"


def _go_master_json_from_token(token: str, method: str, path: str, **kwargs):
    try:
        return go_master_api.request_json(method, path, authorization=_authorization_from_token(token), **kwargs)
    except go_master_api.GoMasterAPIUnavailable as exc:
        raise ValueError(NATIVE_NODE_API_REQUIRED_DETAIL) from exc


def _connected_node_id_from_token(token: str) -> int:
    nodes = _go_master_json_from_token(token, "GET", "/api/nodes")
    for node in nodes or []:
        if str(node.get("status", "")).lower() == "connected":
            return int(node["id"])
    raise ValueError("No connected node is available for logs")


def _select_legacy_runtime_log_source(node_id_raw: str | None = None):
    nodes = getattr(xray, "nodes", {}) or {}
    node_id_raw = (node_id_raw or "").strip()
    if node_id_raw:
        try:
            node_id = int(node_id_raw)
        except ValueError as exc:
            raise ValueError("Invalid node_id") from exc
        node = nodes.get(node_id)
        if node is None:
            raise ValueError("Node not found")
        if not getattr(node, "connected", False):
            raise ValueError("Node is not connected")
        return node
    for node in nodes.values():
        if getattr(node, "connected", False):
            return node
    raise ValueError("No connected node is available for logs")


def _select_runtime_log_source(token: str | None = None, node_id_raw: str | None = None):
    if token is None:
        return _select_legacy_runtime_log_source(node_id_raw)
    if node_id_raw is None and str(token).strip().isdigit():
        return _select_legacy_runtime_log_source(str(token))
    node_id_raw = (node_id_raw or "").strip()
    if node_id_raw:
        try:
            return int(node_id_raw)
        except ValueError as exc:
            raise ValueError("Invalid node_id") from exc
    return _connected_node_id_from_token(token)


def _validate_download_url(url: str, *, field_name: str = "url") -> str:
    url = (url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail=f"{field_name} must be an http(s) URL")

    try:
        resolved = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} hostname cannot be resolved") from exc

    for result in resolved:
        address = result[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise HTTPException(status_code=422, detail=f"{field_name} resolves to a private or reserved address")
    return url


def _resolve_geo_template_index_url(candidate_url: str = "", *, field_name: str = "template_index_url") -> str:
    configured_url = os.getenv("GEO_TEMPLATES_INDEX_URL", "").strip()
    requested_url = (candidate_url or "").strip()

    if not requested_url:
        return _validate_download_url(configured_url, field_name=field_name) if configured_url else GEO_TEMPLATES_INDEX_DEFAULT

    if requested_url == GEO_TEMPLATES_INDEX_DEFAULT:
        return GEO_TEMPLATES_INDEX_DEFAULT

    if configured_url and requested_url == configured_url:
        return _validate_download_url(configured_url, field_name=field_name)

    raise HTTPException(
        status_code=422,
        detail=f"{field_name} must be empty, the default template index, or the configured GEO_TEMPLATES_INDEX_URL",
    )


def _safe_geo_filename(name: str) -> str:
    filename = os.path.basename((name or "").strip().replace("\\", "/"))
    if filename == "geoip.dat":
        return "geoip.dat"
    if filename == "geosite.dat":
        return "geosite.dat"
    raise HTTPException(
        status_code=422,
        detail=f"Geo file name must be one of: {', '.join(sorted(_ALLOWED_GEO_FILENAMES))}",
    )


def _resolve_template_files(template_index_url: str, template_name: str) -> list[dict]:
    """
    Fetch template index and return file list. If template_name is empty, pick the first template.
    """
    try:
        index_url = _resolve_geo_template_index_url(template_index_url, field_name="template_index_url")
        r = requests.get(index_url, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        raise HTTPException(502, detail=f"Failed to fetch template index: {e}")

    candidates = data.get("templates", data if isinstance(data, list) else [])
    if not isinstance(candidates, list) or not candidates:
        raise HTTPException(404, detail="No templates found in index.")

    target_name = template_name or candidates[0].get("name") or ""
    found = next((t for t in candidates if t.get("name") == target_name), None)
    if not found:
        raise HTTPException(404, detail="Template not found in index.")

    links = found.get("links") or {}
    files = found.get("files") or [{"name": k, "url": v} for k, v in links.items()]
    return files


def _validate_geo_files(files: list[dict]) -> list[dict]:
    """Validate geo file metadata before forwarding it to nodes."""
    validated = []
    for item in files:
        name = _safe_geo_filename(item.get("name") or "")
        url = _validate_download_url(item.get("url") or "")
        if not name or not url:
            raise HTTPException(status_code=422, detail="Each file must include name and url.")
        validated.append({"name": name, "url": url})
    return validated


@router.websocket("/core/logs")
async def runtime_logs(websocket: WebSocket):
    token = websocket.query_params.get("token") or websocket.headers.get("Authorization", "").removeprefix("Bearer ")
    with GetDB() as db:
        admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if admin.role not in (AdminRole.sudo, AdminRole.full_access):
        return await websocket.close(reason="You're not allowed", code=4403)

    interval = websocket.query_params.get("interval")
    if interval:
        try:
            interval = float(interval)
        except ValueError:
            return await websocket.close(reason="Invalid interval value", code=4400)
        if interval > 10:
            return await websocket.close(reason="Interval must be more than 0 and at most 10 seconds", code=4400)

    try:
        logs_source = _select_runtime_log_source(token, websocket.query_params.get("node_id"))
    except Exception as exc:
        reason = getattr(exc, "detail", None) or str(exc)
        return await websocket.close(reason=reason, code=4404)

    await websocket.accept()

    cache: list[str] = []
    last_sent_ts = 0

    async def _flush_cache() -> bool:
        nonlocal cache, last_sent_ts
        if not cache:
            return True
        try:
            for line in sort_log_lines(cache):
                await websocket.send_text(line)
        except (WebSocketDisconnect, RuntimeError):
            return False
        cache = []
        last_sent_ts = time.time()
        return True

    sent: set[str] = set()
    while True:
        if interval and time.time() - last_sent_ts >= interval and cache:
            if not await _flush_cache():
                break
        try:
            payload = _go_master_json_from_token(
                token,
                "GET",
                f"/api/node/{logs_source}/logs",
                params={"max_lines": 200},
            )
            lines = payload.get("logs", []) if isinstance(payload, dict) else []
        except Exception as exc:
            lines = [str(exc)]
        fresh = [line for line in sort_log_lines(lines) if line not in sent]
        sent.update(fresh)
        if interval:
            cache.extend(fresh)
        else:
            for line in fresh:
                try:
                    await websocket.send_text(line)
                except (WebSocketDisconnect, RuntimeError):
                    return
        try:
            await asyncio.wait_for(websocket.receive(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except (WebSocketDisconnect, RuntimeError):
            break


@router.get("/core/access/insights", responses={403: responses._403})
def get_access_insights(
    request: Request,
    limit: int = 200,
    lookback: int = 2000,
    search: str = "",
    window_seconds: int = 120,
    admin: Admin = Depends(Admin.get_current),
):
    """
    Return recent node access log entries enriched with geosite/geoip labels.
    Master has no local access log anymore, so this legacy route is node-only.
    """
    try:
        payload = access_insights.build_multi_node_insights(
            limit=limit,
            lookback_lines=lookback,
            search=search,
            window_seconds=window_seconds,
            authorization=request.headers.get("authorization"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return payload


@router.get("/core/access/insights/multi-node", responses={403: responses._403})
def get_multi_node_access_insights(
    request: Request,
    limit: int = 200,
    lookback: int = 1000,
    search: str = "",
    window_seconds: int = 120,
    node_ids: str = "",
    mode: str = "full",
    admin: Admin = Depends(Admin.get_current),
):
    """
    Return access insights from connected nodes.
    Optimized for lower RAM/CPU usage.

    Args:
        limit: Max number of clients to return
        lookback: Number of log lines to read per node
        search: Search filter (applied to destinations)
        window_seconds: Time window to analyze (max 600)
        node_ids: Comma-separated node IDs (empty = all nodes)
    """
    mode = (mode or "full").lower()
    try:
        node_id_list = None
        if node_ids:
            try:
                node_id_list = [int(nid.strip()) for nid in node_ids.split(",") if nid.strip()]
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid node_ids format")

        if mode in {"raw", "frontend"}:
            sources = access_insights.get_all_log_sources(authorization=request.headers.get("authorization"))
            return {
                "mode": "raw",
                "sources": [
                    {"node_id": s.node_id, "node_name": s.node_name, "is_master": s.is_master} for s in sources
                ],
                "stream": {
                    "ndjson": router.url_path_for("get_raw_access_logs"),
                    "websocket": router.url_path_for("access_logs_ws"),
                },
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

        payload = access_insights.build_multi_node_insights(
            limit=limit,
            lookback_lines=lookback,
            search=search,
            window_seconds=window_seconds,
            node_ids=node_id_list,
            authorization=request.headers.get("authorization"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return payload


@router.get("/core/access/logs/raw", responses={403: responses._403})
def get_raw_access_logs(
    request: Request,
    max_lines: int = 500,
    node_id: int = None,
    search: str = "",
    admin: Admin = Depends(Admin.get_current),
):
    """
    Stream raw access log lines for frontend processing.
    This reduces backend load by offloading parsing/analysis to the client.

    Returns NDJSON (newline-delimited JSON) stream.

    Args:
        max_lines: Maximum lines to return (max 1000)
        node_id: Specific node ID (null = all nodes)
        search: Filter lines containing this text
    """
    from fastapi.responses import StreamingResponse
    import json

    max_lines = min(max_lines, 1000)

    def generate():
        try:
            for chunk in access_insights.stream_raw_logs(
                max_lines=max_lines,
                node_id=node_id,
                search=search,
                authorization=request.headers.get("authorization"),
            ):
                yield json.dumps(chunk) + "\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.post("/core/access/operators", responses={403: responses._403})
def resolve_access_log_operators(
    ips: list[str] = Body(default_factory=list, embed=True),
    admin: Admin = Depends(Admin.get_current),
):
    """
    Resolve ISP/operator metadata for a list of source IPs.
    This endpoint is intentionally lightweight and used by frontend aggregation mode.
    """
    if not isinstance(ips, list):
        raise HTTPException(status_code=422, detail="ips should be a list")

    seen: set[str] = set()
    unique_ips: list[str] = []
    for raw in ips[:5000]:
        try:
            ip = str(raw or "").strip()
        except Exception:
            continue
        if not ip or ip in seen:
            continue
        try:
            ipaddress.ip_address(ip)
        except ValueError:
            continue
        seen.add(ip)
        unique_ips.append(ip)

    operators = []
    for ip in unique_ips:
        short_name, owner = access_insights.classify_isp(ip)
        operators.append({"ip": ip, "short_name": short_name, "owner": owner})

    return {"operators": operators}


@router.websocket("/core/access/logs/ws")
async def access_logs_ws(websocket: WebSocket):
    token = websocket.query_params.get("token") or websocket.headers.get("Authorization", "").removeprefix("Bearer ")
    with GetDB() as db:
        admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if admin.role not in (AdminRole.sudo, AdminRole.full_access):
        return await websocket.close(reason="You're not allowed", code=4403)

    max_lines_raw = websocket.query_params.get("max_lines")
    node_id_raw = websocket.query_params.get("node_id")
    search = websocket.query_params.get("search") or ""

    max_lines = 500
    try:
        if max_lines_raw:
            max_lines = min(1000, max(1, int(max_lines_raw)))
    except ValueError:
        await websocket.close(reason="Invalid max_lines", code=4400)
        return

    node_id = None
    if node_id_raw:
        try:
            node_id = int(node_id_raw)
        except ValueError:
            await websocket.close(reason="Invalid node_id", code=4400)
            return

    await websocket.accept()
    try:
        for chunk in access_insights.stream_raw_logs(
            max_lines=max_lines,
            node_id=node_id,
            search=search,
            authorization=_authorization_from_token(token),
        ):
            await websocket.send_text(json.dumps(chunk))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await websocket.send_text(json.dumps({"error": str(exc)}))
    finally:
        with contextlib.suppress(Exception):
            await websocket.close()


@router.get("/core", response_model=RuntimeStats)
def get_runtime_stats(
    admin: Admin = Depends(Admin.get_current),
    db: Session = Depends(get_db),
):
    """Retrieve aggregate node runtime status."""
    started = False
    version = None
    try:
        for node in crud.get_nodes(db):
            status_raw = getattr(node, "status", "")
            status_value = str(getattr(status_raw, "value", status_raw)).lower()
            if status_value == "connected":
                started = True
                version = (
                    getattr(node, "xray_version", None)
                    or getattr(node, "node_service_version", None)
                    or version
                )
                break
    except Exception:
        pass
    return RuntimeStats(
        version=version,
        started=started,
        logs_websocket=router.url_path_for("runtime_logs"),
    )


@router.get("/core/ips", response_model=ServerIPs)
def get_server_ips(admin: Admin = Depends(Admin.get_current)):
    """Retrieve server's public IPv4 and IPv6 addresses."""
    return ServerIPs(
        ipv4=get_public_ip(),
        ipv6=get_public_ipv6(),
    )


@router.post("/core/restart", responses={403: responses._403})
def queue_runtime_restart(
    bg: BackgroundTasks,
    target: str | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Restart the selected runtime target."""
    if target:
        kind, node_id = parse_target_id(target)
        if kind != MASTER_TARGET_ID and not crud.get_node_by_id(db, node_id):
            raise HTTPException(status_code=404, detail="Node not found")

    def _restart():
        # TODO(go-runtime-cleanup): route this endpoint directly through the Go
        # Master API. For now Python only enqueues config sync work; it no
        # longer restarts or talks to a local Xray runtime.
        if not target:
            node_operations.queue_sync_config()
            return
        kind, node_id = parse_target_id(target)
        if kind == MASTER_TARGET_ID:
            node_operations.queue_sync_config()
        elif node_id is not None:
            node_operations.queue_sync_config(node_id=node_id)

    bg.add_task(_restart)

    return {"detail": "Runtime restart queued"}


@router.get("/core/config", responses={403: responses._403})
def get_runtime_config(
    target: str = MASTER_TARGET_ID,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Get the current runtime configuration."""
    raise HTTPException(
        status_code=503,
        detail="Xray config routes are handled by the native Go Master API",
    )


@router.put("/core/config", responses={403: responses._403})
def modify_runtime_config(
    payload: dict,
    target: str = MASTER_TARGET_ID,
    admin: Admin = Depends(Admin.check_sudo_admin),
) -> dict:
    """Modify the runtime configuration and restart the target runtime."""
    raise HTTPException(
        status_code=503,
        detail="Xray config routes are handled by the native Go Master API",
    )


@router.get("/core/config/targets", responses={403: responses._403})
def get_runtime_config_targets(
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=503,
        detail="Xray config target routes are handled by the native Go Master API",
    )


@router.put("/core/config/targets/{node_id}/mode", responses={403: responses._403})
def modify_node_config_mode(
    node_id: int,
    bg: BackgroundTasks,
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=503,
        detail="Xray config target routes are handled by the native Go Master API",
    )


@router.get("/core/xray/releases", responses={403: responses._403})
def list_xray_releases(limit: int = 10, admin: Admin = Depends(Admin.check_sudo_admin)):
    """List latest Xray-core tags for node update workflows."""
    try:
        r = requests.get(f"{GITHUB_RELEASES}?per_page={max(1, min(limit, 50))}", timeout=30)
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(502, detail=f"Failed to fetch releases: {e}")
    data = r.json()
    tags = [it.get("tag_name") for it in data if it.get("tag_name")]
    return {"tags": tags}


@router.post("/core/xray/update", responses={403: responses._403})
def update_node_runtime_version(
    payload: dict = Body(..., examples={"default": {"version": "v1.8.11", "persist_env": True}}),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Deprecated: master no longer owns a local runtime."""
    raise HTTPException(status_code=410, detail="Master runtime is node-only; update nodes instead.")


@router.get("/core/geo/templates", responses={403: responses._403})
def list_geo_templates(index_url: str = "", admin: Admin = Depends(Admin.check_sudo_admin)):
    """Fetch and list geo templates."""
    url = _resolve_geo_template_index_url(index_url, field_name="index_url")
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        raise HTTPException(502, detail=f"Failed to fetch index: {e}")

    if isinstance(data, dict) and "templates" in data and isinstance(data["templates"], list):
        templates = data["templates"]
    elif isinstance(data, list):
        templates = data
    else:
        raise HTTPException(422, detail="Invalid template index structure.")

    out = []
    for t in templates:
        name = t.get("name")
        links = t.get("links", {})
        files = t.get("files", [])
        if name:
            if files and isinstance(files, list):
                out.append({"name": name, "files": files})
            elif isinstance(links, dict) and links:
                out.append({"name": name, "links": links})
    if not out:
        raise HTTPException(404, detail="No templates found in index.")
    return {"templates": out}


@router.post("/core/geo/apply", responses={403: responses._403})
def apply_geo_assets(
    request: Request,
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "mode": "default",
                "files": [
                    {"name": "geosite.dat", "url": "https://.../geosite.dat"},
                    {"name": "geoip.dat", "url": "https://.../geoip.dat"},
                ],
                "persist_env": True,
                "apply_to_nodes": True,
                "skip_node_ids": [],
            }
        },
    ),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Download and apply geo assets."""
    mode = (payload.get("mode") or "default").strip().lower()
    files = payload.get("files") or []

    template_index_url = (
        payload.get("template_index_url") or payload.get("templateIndexUrl") or GEO_TEMPLATES_INDEX_DEFAULT
    ).strip()
    template_name = (payload.get("template_name") or payload.get("templateName") or "").strip()
    if not files and (mode == "template" or template_name):
        files = _resolve_template_files(template_index_url, template_name)

    if not files or not isinstance(files, list):
        raise HTTPException(422, detail="'files' must be a non-empty list of {name,url}.")

    apply_to_nodes = bool(payload.get("apply_to_nodes", payload.get("applyToNodes", True)))
    skip_node_ids = set(payload.get("skip_node_ids") or payload.get("skipNodeIds") or [])

    if not apply_to_nodes:
        raise HTTPException(status_code=409, detail="Master has no local runtime; enable apply_to_nodes.")

    files = _validate_geo_files(files)
    results = {
        "master": {"status": "node-only"},
        "nodes": {},
    }
    if apply_to_nodes:
        for db_node in crud.get_nodes(db=db, enabled=True):
            node_id = int(db_node.id)
            if node_id in skip_node_ids:
                continue
            if db_node.geo_mode != "default":
                continue
            try:
                authorization = request.headers.get("authorization")
                go_master_api.request_json(
                    "POST",
                    f"/api/node/{node_id}/geo/update",
                    authorization=authorization,
                    json_body={"files": files},
                    timeout=300,
                )
                go_master_api.request_json(
                    "POST",
                    f"/api/node/{node_id}/sync",
                    authorization=authorization,
                    timeout=90,
                )
                results["nodes"][str(node_id)] = {"status": "ok"}
            except Exception as e:
                detail = str(e) or "Unknown node error"
                results["nodes"][str(node_id)] = {
                    "status": "error",
                    "detail": f'Node "{db_node.name}" has problem: {detail}',
                }

    return results


@router.post("/core/geo/update", responses={403: responses._403})
def update_geo_assets(
    request: Request,
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "mode": "template",
                "templateIndexUrl": GEO_TEMPLATES_INDEX_DEFAULT,
                "templateName": "standard",
                "files": [],
                "persistEnv": True,
                "applyToNodes": True,
                "skipNodeIds": [],
            }
        },
    ),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """
    Backward-compatible alias used by the dashboard to update geo files on the master (and optionally nodes).
    Accepts camelCase keys from the frontend and forwards to the main handler.
    """
    normalized_payload = {
        "mode": payload.get("mode", "default"),
        "files": payload.get("files") or [],
        "template_index_url": payload.get("template_index_url")
        or payload.get("templateIndexUrl")
        or GEO_TEMPLATES_INDEX_DEFAULT,
        "template_name": payload.get("template_name") or payload.get("templateName") or "",
        "persist_env": payload.get("persist_env", payload.get("persistEnv", True)),
        "apply_to_nodes": payload.get("apply_to_nodes", payload.get("applyToNodes", True)),
        "skip_node_ids": payload.get("skip_node_ids") or payload.get("skipNodeIds") or [],
    }
    return apply_geo_assets(request, normalized_payload, admin, db)


def _warp_service(db: Session) -> WarpService:
    return WarpService(db)


def _serialize_warp_account(service: WarpService, account):
    return service.serialize_account(account) if account else None


@router.get("/core/warp", response_model=WarpAccountResponse, responses={403: responses._403})
def get_warp_account(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Return the stored Cloudflare WARP account (if any)."""
    service = _warp_service(db)
    account = service.get_account()
    return {"account": _serialize_warp_account(service, account)}


@router.post(
    "/core/warp/register",
    response_model=WarpRegisterResponse,
    responses={403: responses._403},
)
def register_warp_account(
    payload: WarpRegisterRequest,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Register a new WARP device via Cloudflare and persist credentials."""
    service = _warp_service(db)
    try:
        account, config = service.register(payload.private_key.strip(), payload.public_key.strip())
    except WarpServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"account": service.serialize_account(account), "config": config}


@router.post(
    "/core/warp/license",
    response_model=WarpAccountResponse,
    responses={403: responses._403},
)
def update_warp_license(
    payload: WarpLicenseUpdate,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Update the stored license key on Cloudflare WARP."""
    service = _warp_service(db)
    try:
        account = service.update_license(payload.license_key.strip())
    except WarpAccountNotFound:
        raise HTTPException(status_code=404, detail="No WARP account configured")
    except WarpServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"account": service.serialize_account(account)}


@router.get(
    "/core/warp/config",
    response_model=WarpConfigResponse,
    responses={403: responses._403},
)
def get_warp_config(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Fetch the latest device+account info from Cloudflare."""
    service = _warp_service(db)
    try:
        config = service.get_remote_config()
    except WarpAccountNotFound:
        raise HTTPException(status_code=404, detail="No WARP account configured")
    except WarpServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"config": config}


@router.delete("/core/warp", response_model=WarpAccountResponse, responses={403: responses._403})
def delete_warp_account(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Remove the locally stored WARP credentials."""
    service = _warp_service(db)
    service.delete()
    return {"account": None}


def _decode_json_payload(value: object, field_name: str) -> object:
    if isinstance(value, str):
        raw_value = value.strip()
        if not raw_value:
            raise HTTPException(status_code=400, detail=f"{field_name} parameter is required")
        try:
            return json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid {field_name} JSON: {exc}") from exc
    return value


def _extract_outbound_test_payload(payload: dict) -> tuple[dict, list]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid request payload")

    outbound_raw = payload.get("outbound")
    if outbound_raw is None:
        raise HTTPException(status_code=400, detail="outbound parameter is required")

    outbound = _decode_json_payload(outbound_raw, "outbound")
    if not isinstance(outbound, dict):
        raise HTTPException(status_code=400, detail="outbound must be a JSON object")

    all_outbounds_raw = payload.get("allOutbounds")
    if all_outbounds_raw in (None, ""):
        all_outbounds = [outbound]
    else:
        all_outbounds = _decode_json_payload(all_outbounds_raw, "allOutbounds")
        if not isinstance(all_outbounds, list):
            raise HTTPException(status_code=400, detail="allOutbounds must be a JSON array")
        if not all_outbounds:
            all_outbounds = [outbound]

    outbound_tag = outbound.get("tag")
    if outbound_tag and not any(
        isinstance(candidate, dict) and candidate.get("tag") == outbound_tag for candidate in all_outbounds
    ):
        all_outbounds.append(outbound)

    return outbound, all_outbounds


def _get_outbound_test_url() -> str:
    return (os.getenv("XRAY_OUTBOUND_TEST_URL", "") or "").strip() or OUTBOUND_TEST_DEFAULT_URL


def _run_node_outbound_ping_test(outbound_tag: str, all_outbounds: list, outbound_protocol: str = "") -> dict | None:
    nodes = getattr(xray, "nodes", {}) or {}
    for node in nodes.values():
        if not getattr(node, "connected", False):
            continue
        test_outbound = getattr(node, "test_outbound", None)
        if test_outbound is None:
            continue
        return test_outbound(
            outbound_tag=outbound_tag,
            all_outbounds=all_outbounds,
            outbound_protocol=outbound_protocol,
        )
    return None


def _run_outbound_ping_test(outbound_tag: str, all_outbounds: list, outbound_protocol: str = "") -> dict:
    node_result = _run_node_outbound_ping_test(outbound_tag, all_outbounds, outbound_protocol)
    if node_result is not None:
        return node_result

    return {"success": False, "error": "No connected node is available for outbound test"}


def _public_outbound_test_result(result: dict) -> dict:
    if not isinstance(result, dict):
        return {"success": False, "error": "Outbound test failed"}
    if result.get("success"):
        return {
            "success": True,
            "delay": result.get("delay"),
            "statusCode": result.get("statusCode"),
        }

    error = result.get("error")
    if error == "No connected node is available for outbound test":
        return {"success": False, "error": "No connected node is available for outbound test"}
    return {"success": False, "error": "Outbound test failed"}


@router.post("/panel/xray/testOutbound", responses={403: responses._403})
def test_outbound(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    outbound, all_outbounds = _extract_outbound_test_payload(payload)
    outbound_tag = str(outbound.get("tag") or "").strip()
    outbound_protocol = str(outbound.get("protocol") or "").strip().lower()

    if not outbound_tag:
        return {"success": True, "obj": {"success": False, "error": "Outbound has no tag"}}
    if outbound_protocol == "blackhole" or outbound_tag.lower() == "blocked":
        return {"success": True, "obj": {"success": False, "error": "Blocked/blackhole outbound cannot be tested"}}

    if not _OUTBOUND_TEST_LOCK.acquire(blocking=False):
        return {
            "success": True,
            "obj": {"success": False, "error": "Another outbound test is already running, please wait"},
        }

    try:
        result = _run_outbound_ping_test(
            outbound_tag=outbound_tag,
            all_outbounds=all_outbounds,
            outbound_protocol=outbound_protocol,
        )
    finally:
        _OUTBOUND_TEST_LOCK.release()

    if isinstance(result, dict) and result.get("success"):
        return {
            "success": True,
            "obj": {
                "success": True,
                "delay": result.get("delay"),
                "statusCode": result.get("statusCode"),
            },
        }

    return {"success": True, "obj": _public_outbound_test_result(result)}


def _iter_outbound_config_targets(db: Session) -> list[tuple[str, int | None, str, dict]]:
    master_config = crud.get_xray_config(db)
    targets = [(MASTER_TARGET_ID, None, "Master", master_config)]
    for node in crud.get_nodes(db):
        targets.append(
            (
                node_target_id(node.id),
                node.id,
                node.name,
                get_node_effective_raw_config(node, master_config),
            )
        )
    return targets


def _sync_outbound_records(db: Session) -> None:
    """
    Ensure we have OutboundTraffic rows for every outbound in the current Xray config.
    This lets us persist traffic per outbound ID (config-based) instead of mutable tags.
    """
    existing_rows = db.query(OutboundTraffic).all()
    existing_by_id = {(row.target_id or MASTER_TARGET_ID, row.outbound_id): row for row in existing_rows}
    existing_by_tag = {(row.target_id or MASTER_TARGET_ID, row.tag): row for row in existing_rows if row.tag}
    updated = False

    for target_id, node_id, _target_name, target_config in _iter_outbound_config_targets(db):
        outbounds_config = target_config.get("outbounds", []) if isinstance(target_config, dict) else []
        for outbound in outbounds_config:
            if not isinstance(outbound, dict):
                continue

            outbound_id = generate_outbound_id(outbound)
            metadata = extract_outbound_metadata(outbound)
            record = existing_by_id.get((target_id, outbound_id)) or (
                metadata.get("tag") and existing_by_tag.get((target_id, metadata["tag"]))
            )

            if record:
                if record.target_id != target_id:
                    record.target_id = target_id
                    updated = True
                if record.node_id != node_id:
                    record.node_id = node_id
                    updated = True
                if record.outbound_id != outbound_id:
                    record.outbound_id = outbound_id
                    existing_by_id[(target_id, outbound_id)] = record
                    updated = True
                if metadata.get("tag") is not None and record.tag != metadata["tag"]:
                    old_tag = record.tag
                    record.tag = metadata["tag"]
                    if old_tag:
                        existing_by_tag.pop((target_id, old_tag), None)
                    if record.tag:
                        existing_by_tag[(target_id, record.tag)] = record
                    updated = True
                if metadata.get("protocol") is not None and record.protocol != metadata["protocol"]:
                    record.protocol = metadata["protocol"]
                    updated = True
                if metadata.get("address") is not None and record.address != metadata["address"]:
                    record.address = metadata["address"]
                    updated = True
                if metadata.get("port") is not None and record.port != metadata["port"]:
                    record.port = metadata["port"]
                    updated = True
            else:
                record = OutboundTraffic(
                    target_id=target_id,
                    node_id=node_id,
                    outbound_id=outbound_id,
                    tag=metadata.get("tag"),
                    protocol=metadata.get("protocol"),
                    address=metadata.get("address"),
                    port=metadata.get("port"),
                    uplink=0,
                    downlink=0,
                )
                db.add(record)
                existing_by_id[(target_id, outbound_id)] = record
                if record.tag:
                    existing_by_tag[(target_id, record.tag)] = record
                updated = True

    if updated:
        db.commit()


@router.get("/panel/xray/getOutboundsTraffic", responses={403: responses._403})
def get_outbounds_traffic(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Get outbound traffic statistics from database."""
    _sync_outbound_records(db)
    outbounds = db.query(OutboundTraffic).all()
    target_names = {target_id: name for target_id, _node_id, name, _config in _iter_outbound_config_targets(db)}
    # Return as array for frontend compatibility
    result = []
    for outbound in outbounds:
        target_id = outbound.target_id or MASTER_TARGET_ID
        result.append(
            {
                "target_id": target_id,
                "target_name": target_names.get(target_id, target_id),
                "node_id": outbound.node_id,
                "tag": outbound.tag,
                "protocol": outbound.protocol,
                "address": outbound.address,
                "port": outbound.port,
                "up": outbound.uplink,
                "down": outbound.downlink,
                "outbound_id": outbound.outbound_id,
            }
        )
    return {"success": True, "obj": result}


@router.post("/panel/xray/resetOutboundsTraffic", responses={403: responses._403})
def reset_outbounds_traffic(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Reset outbound traffic statistics."""
    outbound_id = payload.get("outbound_id")
    tag = payload.get("tag")
    target_id = payload.get("target_id")

    if outbound_id == "-all-" or tag == "-alltags-":
        query = db.query(OutboundTraffic)
        if target_id:
            query = query.filter(OutboundTraffic.target_id == target_id)
        query.update({"uplink": 0, "downlink": 0})
    elif outbound_id and target_id:
        db.query(OutboundTraffic).filter(
            OutboundTraffic.target_id == target_id,
            OutboundTraffic.outbound_id == outbound_id,
        ).update({"uplink": 0, "downlink": 0})
    elif outbound_id:
        # Reset specific outbound by outbound_id
        db.query(OutboundTraffic).filter(OutboundTraffic.outbound_id == outbound_id).update(
            {"uplink": 0, "downlink": 0}
        )
    elif tag and target_id:
        db.query(OutboundTraffic).filter(OutboundTraffic.target_id == target_id, OutboundTraffic.tag == tag).update(
            {"uplink": 0, "downlink": 0}
        )
    elif tag:
        # Fallback: reset by tag for backward compatibility
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == tag).update({"uplink": 0, "downlink": 0})
    else:
        raise HTTPException(status_code=400, detail="outbound_id or tag is required")
    db.commit()
    return {"success": True}
