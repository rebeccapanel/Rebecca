import asyncio
import time
import json
import contextlib

from fastapi import APIRouter, Depends, HTTPException, WebSocket, Body, BackgroundTasks
from starlette.websockets import WebSocketDisconnect

from app.runtime import xray
from app.services import access_insights
from app.db import Session, get_db, crud, GetDB
from app.db.models import OutboundTraffic
from app.models.admin import Admin, AdminRole
from app.models.core import CoreStats, ServerIPs
from app.models.warp import (
    WarpAccountResponse,
    WarpConfigResponse,
    WarpLicenseUpdate,
    WarpRegisterRequest,
    WarpRegisterResponse,
)
from app.services.warp import WarpAccountNotFound, WarpService, WarpServiceError
from app.utils import responses
from app.utils.system import get_public_ip, get_public_ipv6
from app.utils.outbound import extract_outbound_metadata, generate_outbound_id
from app.utils.xray_config import apply_config_and_restart
from app.reb_node import XRayConfig

import os
import shutil
import tempfile
from pathlib import Path
import requests
import platform
import zipfile
import io
import stat

router = APIRouter(tags=["Core"], prefix="/api", responses={401: responses._401})

GITHUB_RELEASES = "https://api.github.com/repos/XTLS/Xray-core/releases"
GEO_TEMPLATES_INDEX_DEFAULT = "https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json"


def _resolve_template_files(template_index_url: str, template_name: str) -> list[dict]:
    """
    Fetch template index and return file list. If template_name is empty, pick the first template.
    """
    try:
        r = requests.get(template_index_url, timeout=60)
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


def _detect_asset_name() -> str:
    sys_name = platform.system().lower()
    arch = platform.machine().lower()
    if sys_name.startswith("linux"):
        if arch in ("x86_64", "amd64"):
            return "Xray-linux-64.zip"
        if arch in ("aarch64", "arm64"):
            return "Xray-linux-arm64-v8a.zip"
        if arch in ("armv7l", "armv7"):
            return "Xray-linux-arm32-v7a.zip"
        if arch in ("armv6l",):
            return "Xray-linux-arm32-v6.zip"
        if arch in ("riscv64",):
            return "Xray-linux-riscv64.zip"
    raise HTTPException(status_code=400, detail="Unsupported platform for Xray update")


def _install_xray_zip(zip_bytes: bytes, target_dir: Path) -> Path:
    """Extract Xray archive safely and return the executable path."""
    target_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            archive.extractall(tmp_path)

        candidates = [
            tmp_path / "xray",
            tmp_path / "Xray",
            tmp_path / "xray.exe",
            tmp_path / "Xray.exe",
        ]
        exe_tmp = next((path for path in candidates if path.exists()), None)
        if exe_tmp is None:
            raise HTTPException(status_code=500, detail="xray binary not found in archive")

        # Copy other assets first (README, LICENSE, geo files if shipped)
        for item in tmp_path.iterdir():
            if item.name.lower().startswith("xray"):
                continue
            dest = target_dir / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)

        # Atomically swap the executable to avoid ETXTBSY while the old binary is in use.
        dest_exe = target_dir / exe_tmp.name
        temp_exe = dest_exe.with_name(dest_exe.name + ".new")
        shutil.copy2(exe_tmp, temp_exe)
        os.replace(temp_exe, dest_exe)

    try:
        dest_exe.chmod(dest_exe.stat().st_mode | stat.S_IEXEC)
    except Exception:
        pass

    return dest_exe


def _download_geo_files(dest: Path, files: list[dict]) -> list[dict]:
    """Download geo files into dest and return saved metadata."""
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for item in files:
        name = (item.get("name") or "").strip()
        url = (item.get("url") or "").strip()
        if not name or not url:
            raise HTTPException(status_code=422, detail="Each file must include name and url.")
        try:
            r = requests.get(url, timeout=120)
            r.raise_for_status()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to download {name}: {exc}")
        try:
            path = dest / name
            path.write_bytes(r.content)
            saved.append({"name": name, "path": str(path)})
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to save {name}: {exc}")
    return saved


@router.websocket("/core/logs")
async def core_logs(websocket: WebSocket):
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

    await websocket.accept()

    cache = ""
    last_sent_ts = 0
    with xray.core.get_logs() as logs:
        while True:
            if interval and time.time() - last_sent_ts >= interval and cache:
                try:
                    await websocket.send_text(cache)
                except (WebSocketDisconnect, RuntimeError):
                    break
                cache = ""
                last_sent_ts = time.time()

            if not logs:
                try:
                    await asyncio.wait_for(websocket.receive(), timeout=0.2)
                    continue
                except asyncio.TimeoutError:
                    continue
                except (WebSocketDisconnect, RuntimeError):
                    break

            log = logs.popleft()

            if interval:
                cache += f"{log}\n"
                continue

            try:
                await websocket.send_text(log)
            except (WebSocketDisconnect, RuntimeError):
                break


@router.get("/core/access/insights", responses={403: responses._403})
def get_access_insights(
    limit: int = 200,
    lookback: int = 2000,
    search: str = "",
    window_seconds: int = 120,
    admin: Admin = Depends(Admin.get_current),
):
    """
    Return recent access log entries enriched with geosite/geoip labels.
    LEGACY: Use /core/access/insights/multi-node for better performance and node support.
    """
    try:
        payload = access_insights.build_access_insights(
            limit=limit, lookback_lines=lookback, search=search, window_seconds=window_seconds
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Graceful return when log is missing
    if payload.get("error") == "access_log_missing":
        return payload
    return payload


@router.get("/core/access/insights/multi-node", responses={403: responses._403})
def get_multi_node_access_insights(
    limit: int = 200,
    lookback: int = 1000,
    search: str = "",
    window_seconds: int = 120,
    node_ids: str = "",
    mode: str = "full",
    admin: Admin = Depends(Admin.get_current),
):
    """
    Return access insights from all nodes (master + connected nodes).
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
                if not any(nid is None for nid in node_id_list):
                    node_id_list.append(None)  # Include master
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid node_ids format")

        if mode in {"raw", "frontend"}:
            sources = access_insights.get_all_log_sources()
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
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return payload


@router.get("/core/access/logs/raw", responses={403: responses._403})
def get_raw_access_logs(
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
        ):
            await websocket.send_text(json.dumps(chunk))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await websocket.send_text(json.dumps({"error": str(exc)}))
    finally:
        with contextlib.suppress(Exception):
            await websocket.close()


@router.get("/core", response_model=CoreStats)
def get_core_stats(admin: Admin = Depends(Admin.get_current)):
    """Retrieve core statistics such as version and uptime."""
    return CoreStats(
        version=xray.core.version,
        started=xray.core.started,
        logs_websocket=router.url_path_for("core_logs"),
    )


@router.get("/core/ips", response_model=ServerIPs)
def get_server_ips(admin: Admin = Depends(Admin.get_current)):
    """Retrieve server's public IPv4 and IPv6 addresses."""
    return ServerIPs(
        ipv4=get_public_ip(),
        ipv6=get_public_ipv6(),
    )


@router.post("/core/restart", responses={403: responses._403})
def restart_core(bg: BackgroundTasks, admin: Admin = Depends(Admin.check_sudo_admin)):
    """Restart the core and all connected nodes."""
    from app.utils.xray_config import restart_xray_and_invalidate_cache

    def _restart():
        # Perform heavy restart work in background so API returns quickly
        restart_xray_and_invalidate_cache()
        startup_config = xray.config.include_db_users()

        for node_id, node in list(xray.nodes.items()):
            if node.connected:
                xray.operations.restart_node(node_id, startup_config)

    bg.add_task(_restart)

    return {"detail": "Core restart queued"}


@router.get("/core/config", responses={403: responses._403})
def get_core_config(
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Get the current core configuration."""
    return crud.get_xray_config(db)


@router.put("/core/config", responses={403: responses._403})
def modify_core_config(payload: dict, admin: Admin = Depends(Admin.check_sudo_admin)) -> dict:
    """Modify the core configuration and restart the core."""
    apply_config_and_restart(payload)
    return payload


def _update_env_envfile(env_path: Path, key: str, value: str) -> str:
    """Update .env key=value if active, skip if commented, return effective value."""
    env_path.touch(exist_ok=True)
    lines = env_path.read_text(encoding="utf-8").splitlines()
    found = False
    current_value = None

    for i, ln in enumerate(lines):
        stripped = ln.strip()
        # commented key
        if stripped.startswith(f"#{key}="):
            parts = stripped.split("=", 1)
            if len(parts) == 2:
                current_value = parts[1].strip().strip('"').strip("'")
            found = True
            break

        # active key
        if stripped.startswith(f"{key}="):
            lines[i] = f'{key}="{value}"'
            found = True
            current_value = value
            break

    if not found:
        lines.append(f'{key}="{value}"')
        current_value = value

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return current_value


@router.get("/core/xray/releases", responses={403: responses._403})
def list_xray_releases(limit: int = 10, admin: Admin = Depends(Admin.check_sudo_admin)):
    """List latest Xray-core tags"""
    try:
        r = requests.get(f"{GITHUB_RELEASES}?per_page={max(1, min(limit, 50))}", timeout=30)
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(502, detail=f"Failed to fetch releases: {e}")
    data = r.json()
    tags = [it.get("tag_name") for it in data if it.get("tag_name")]
    return {"tags": tags}


@router.post("/core/xray/update", responses={403: responses._403})
def update_core_version(
    payload: dict = Body(..., examples={"default": {"version": "v1.8.11", "persist_env": True}}),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Update Xray core binary via maintenance service."""
    tag = payload.get("version")
    if not tag or not isinstance(tag, str):
        raise HTTPException(422, detail="version is required (e.g. v1.8.11)")

    persist_env = bool(payload.get("persist_env", True))

    asset_name = _detect_asset_name()
    url = f"https://github.com/XTLS/Xray-core/releases/download/{tag}/{asset_name}"
    try:
        resp = requests.get(url, timeout=180)
        resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, detail=f"Failed to download Xray release: {exc}")

    base_dir = Path("/var/lib/rebecca/xray-core")
    base_dir.mkdir(parents=True, exist_ok=True)

    if xray.core.started:
        try:
            xray.core.stop()
        except Exception:
            pass

    exe_path = _install_xray_zip(resp.content, base_dir)

    if persist_env:
        _update_env_envfile(Path(".env"), "XRAY_EXECUTABLE_PATH", str(exe_path))

    xray.core.executable_path = str(exe_path)
    try:
        xray.core.version = xray.core.get_version()
    except Exception:
        pass

    return {
        "detail": f"Core assets updated to {tag}. Restart Rebecca to apply the new binary.",
        "version": xray.core.version,
    }


def _resolve_assets_path_master(persist_env: bool) -> Path:
    """Resolve and persist assets directory for master."""
    target = Path("/var/lib/rebecca/assets").resolve()
    env_path = Path(".env")

    old_path = _update_env_envfile(env_path, "XRAY_ASSETS_PATH", str(target)) if persist_env else None
    if old_path:
        target = Path(old_path).resolve()

    target.mkdir(parents=True, exist_ok=True)

    system_default = Path("/usr/local/share/xray")
    try:
        if system_default.exists() or system_default.is_symlink():
            if system_default.resolve() != target:
                if system_default.is_symlink() or system_default.is_file():
                    system_default.unlink()
                elif system_default.is_dir():
                    pass
        if not system_default.exists():
            system_default.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(str(target), str(system_default))
    except Exception:
        pass

    return target


@router.get("/core/geo/templates", responses={403: responses._403})
def list_geo_templates(index_url: str = "", admin: Admin = Depends(Admin.check_sudo_admin)):
    """Fetch and list geo templates."""
    url = index_url.strip() or os.getenv("GEO_TEMPLATES_INDEX_URL", "").strip()
    if not url:
        raise HTTPException(422, detail="index_url is required (or set GEO_TEMPLATES_INDEX_URL).")
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

    persist_env = bool(payload.get("persist_env", payload.get("persistEnv", True)))
    apply_to_nodes = bool(payload.get("apply_to_nodes", payload.get("applyToNodes", False)))
    skip_node_ids = set(payload.get("skip_node_ids") or payload.get("skipNodeIds") or [])

    master_assets_dir = _resolve_assets_path_master(persist_env=persist_env)
    saved = _download_geo_files(master_assets_dir, files)
    xray.core.assets_path = str(master_assets_dir)

    startup_config = xray.config.include_db_users()

    results = {
        "master": {"assets_path": str(master_assets_dir), "files": len(saved)},
        "nodes": {},
    }
    if apply_to_nodes:
        for node_id, node in list(xray.nodes.items()):
            if node_id in skip_node_ids:
                continue
            if not node.connected:
                continue
            db_node = crud.get_node_by_id(db, node_id)
            if db_node is None:
                results["nodes"][str(node_id)] = {"status": "error", "detail": "Node not found in database"}
                continue
            if db_node.geo_mode != "default":
                continue
            try:
                node.update_geo(files=files)
                xray.operations.restart_node(node_id, startup_config)
                results["nodes"][str(node_id)] = {"status": "ok"}
            except Exception as e:
                results["nodes"][str(node_id)] = {"status": "error", "detail": str(e)}

    return results


@router.post("/core/geo/update", responses={403: responses._403})
def update_geo_assets(
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "mode": "template",
                "templateIndexUrl": GEO_TEMPLATES_INDEX_DEFAULT,
                "templateName": "standard",
                "files": [],
                "persistEnv": True,
                "applyToNodes": False,
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
        "apply_to_nodes": payload.get("apply_to_nodes", payload.get("applyToNodes", False)),
        "skip_node_ids": payload.get("skip_node_ids") or payload.get("skipNodeIds") or [],
    }
    return apply_geo_assets(normalized_payload, admin, db)


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


def _sync_outbound_records(db: Session) -> None:
    """
    Ensure we have OutboundTraffic rows for every outbound in the current Xray config.
    This lets us persist traffic per outbound ID (config-based) instead of mutable tags.
    """
    try:
        outbounds_config = (xray.config or {}).get("outbounds", [])
    except Exception:
        outbounds_config = []
    if not outbounds_config:
        return

    existing_rows = db.query(OutboundTraffic).all()
    existing_by_id = {row.outbound_id: row for row in existing_rows}
    existing_by_tag = {row.tag: row for row in existing_rows if row.tag}
    updated = False

    for outbound in outbounds_config:
        if not isinstance(outbound, dict):
            continue

        outbound_id = generate_outbound_id(outbound)
        metadata = extract_outbound_metadata(outbound)
        record = existing_by_id.get(outbound_id) or (metadata.get("tag") and existing_by_tag.get(metadata["tag"]))

        if record:
            if record.outbound_id != outbound_id:
                record.outbound_id = outbound_id
                existing_by_id[outbound_id] = record
                updated = True
            if metadata.get("tag") is not None and record.tag != metadata["tag"]:
                old_tag = record.tag
                record.tag = metadata["tag"]
                if old_tag:
                    existing_by_tag.pop(old_tag, None)
                if record.tag:
                    existing_by_tag[record.tag] = record
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
                outbound_id=outbound_id,
                tag=metadata.get("tag"),
                protocol=metadata.get("protocol"),
                address=metadata.get("address"),
                port=metadata.get("port"),
                uplink=0,
                downlink=0,
            )
            db.add(record)
            existing_by_id[outbound_id] = record
            if record.tag:
                existing_by_tag[record.tag] = record
            updated = True

    if updated:
        db.commit()


@router.get("/panel/xray/getOutboundsTraffic", responses={403: responses._403})
def get_outbounds_traffic(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Get outbound traffic statistics from database."""
    _sync_outbound_records(db)
    outbounds = db.query(OutboundTraffic).all()
    # Return as array for frontend compatibility
    result = []
    for outbound in outbounds:
        result.append(
            {
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

    if outbound_id == "-all-" or tag == "-alltags-":
        # Reset all outbounds
        db.query(OutboundTraffic).update({"uplink": 0, "downlink": 0})
    elif outbound_id:
        # Reset specific outbound by outbound_id
        db.query(OutboundTraffic).filter(OutboundTraffic.outbound_id == outbound_id).update(
            {"uplink": 0, "downlink": 0}
        )
    elif tag:
        # Fallback: reset by tag for backward compatibility
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == tag).update({"uplink": 0, "downlink": 0})
    else:
        raise HTTPException(status_code=400, detail="outbound_id or tag is required")
    db.commit()
    return {"success": True}
