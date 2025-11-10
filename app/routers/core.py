import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, Body
from starlette.websockets import WebSocketDisconnect

from app.runtime import xray
from app.db import Session, get_db, crud
from app.models.admin import Admin
from app.models.core import CoreStats
from app.models.warp import (
    WarpAccountResponse,
    WarpConfigResponse,
    WarpLicenseUpdate,
    WarpRegisterRequest,
    WarpRegisterResponse,
)
from app.services.warp import WarpAccountNotFound, WarpService, WarpServiceError
from app.utils import responses
from app.utils.xray_config import apply_config_and_restart
from app.reb_node import XRayConfig

import os, platform, shutil, stat, zipfile, io, requests
from pathlib import Path

from app.db import crud

router = APIRouter(tags=["Core"], prefix="/api", responses={401: responses._401})

GITHUB_RELEASES = "https://api.github.com/repos/XTLS/Xray-core/releases"
GEO_TEMPLATES_INDEX_DEFAULT = "https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json"


@router.websocket("/core/logs")
async def core_logs(websocket: WebSocket, db: Session = Depends(get_db)):
    token = websocket.query_params.get("token") or websocket.headers.get(
        "Authorization", ""
    ).removeprefix("Bearer ")
    admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if not admin.is_sudo:
        return await websocket.close(reason="You're not allowed", code=4403)

    interval = websocket.query_params.get("interval")
    if interval:
        try:
            interval = float(interval)
        except ValueError:
            return await websocket.close(reason="Invalid interval value", code=4400)
        if interval > 10:
            return await websocket.close(
                reason="Interval must be more than 0 and at most 10 seconds", code=4400
            )

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


@router.get("/core", response_model=CoreStats)
def get_core_stats(admin: Admin = Depends(Admin.get_current)):
    """Retrieve core statistics such as version and uptime."""
    return CoreStats(
        version=xray.core.version,
        started=xray.core.started,
        logs_websocket=router.url_path_for("core_logs"),
    )


@router.post("/core/restart", responses={403: responses._403})
def restart_core(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Restart the core and all connected nodes."""
    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)

    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    return {}


@router.get("/core/config", responses={403: responses._403})
def get_core_config(
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Get the current core configuration."""
    return crud.get_xray_config(db)


@router.put("/core/config", responses={403: responses._403})
def modify_core_config(
    payload: dict, admin: Admin = Depends(Admin.check_sudo_admin)
) -> dict:
    """Modify the core configuration and restart the core."""
    apply_config_and_restart(payload)
    return payload


def _detect_asset_name() -> str:
    sys = platform.system().lower()
    arch = platform.machine().lower()

    if sys.startswith("linux"):
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
    if sys.startswith("darwin"):
        if arch in ("x86_64", "amd64"):
            return "Xray-macos-64.zip"
        if arch in ("arm64", "aarch64"):
            return "Xray-macos-arm64-v8a.zip"
    if sys.startswith("windows"):
        if arch in ("x86_64", "amd64"):
            return "Xray-windows-64.zip"
        if arch in ("arm64", "aarch64"):
            return "Xray-windows-arm64-v8a.zip"

    raise HTTPException(400, detail=f"Unsupported platform {sys}/{arch}")


def _download_asset(tag: str, asset_name: str) -> bytes:
    url = f"https://github.com/XTLS/Xray-core/releases/download/{tag}/{asset_name}"
    r = requests.get(url, timeout=90)
    if r.status_code != 200:
        raise HTTPException(404, detail=f"Cannot download asset: {asset_name} for {tag}")
    return r.content


def _install_xray_zip(zip_bytes: bytes, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        z.extractall(target_dir)
    exe = (target_dir / "xray")
    if platform.system().lower().startswith("windows"):
        exe = target_dir / "xray.exe"
    if not exe.exists():
        alt = target_dir / "Xray"
        alt_win = target_dir / "Xray.exe"
        exe = alt if alt.exists() else (alt_win if alt_win.exists() else exe)
    if not exe.exists():
        raise HTTPException(500, detail="xray binary not found in archive")
    if not platform.system().lower().startswith("windows"):
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return exe


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
        r = requests.get(f"{GITHUB_RELEASES}?per_page={max(1,min(limit,50))}", timeout=30)
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(502, detail=f"Failed to fetch releases: {e}")
    data = r.json()
    tags = [it.get("tag_name") for it in data if it.get("tag_name")]
    return {"tags": tags}


@router.post("/core/xray/update", responses={403: responses._403})
def update_core_version(
    payload: dict = Body(..., example={"version": "v1.8.11", "persist_env": True}),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Update Xray core binary and restart."""
    tag = payload.get("version")
    if not tag or not isinstance(tag, str):
        raise HTTPException(422, detail="version is required (e.g. v1.8.11)")
    persist = bool(payload.get("persist_env", False))

    asset = _detect_asset_name()
    zip_bytes = _download_asset(tag, asset)
    base_dir = Path("/var/lib/marzban/xray-core")
    base_dir.mkdir(parents=True, exist_ok=True)
    if xray.core.started:
        try:
            xray.core.stop()
        except RuntimeError:
            pass
    extracted_exe = _install_xray_zip(zip_bytes, base_dir)
    final_exe = base_dir / "xray"
    try:
        if extracted_exe != final_exe:
            if final_exe.exists():
                final_exe.unlink()
            extracted_exe.rename(final_exe)
    except Exception:
        shutil.copyfile(extracted_exe, final_exe)
        if not platform.system().lower().startswith("windows"):
            final_exe.chmod(final_exe.stat().st_mode | stat.S_IEXEC)
    exe_path = final_exe

    xray.core.executable_path = str(exe_path)
    xray.core.version = xray.core.get_version()

    if persist:
        env_path = Path(".env")
        old_path = _update_env_envfile(env_path, "XRAY_EXECUTABLE_PATH", str(exe_path))
        exe_path = Path(old_path or exe_path)

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)

    results = {"master": {"executable": str(exe_path), "version": xray.core.version}, "nodes": {}}
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            try:
                node.update_core(version=tag)
                xray.operations.restart_node(node_id, startup_config)
                results["nodes"][str(node_id)] = {"status": "ok"}
            except Exception as e:
                results["nodes"][str(node_id)] = {"status": "error", "detail": str(e)}

    return {
        "detail": f"Core switched to {tag}",
        "executable": str(exe_path),
        "version": xray.core.version,
        "persisted": persist,
        "nodes": results["nodes"]
    }


def _resolve_assets_path_master(persist_env: bool) -> Path:
    """Resolve and persist assets directory for master."""
    target = Path("/var/lib/marzban/assets").resolve()
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


def _download_files_to(path: Path, files: list[dict]) -> list[dict]:
    """Download list of files to path."""
    saved = []
    for item in files:
        name = (item.get("name") or "").strip()
        url = (item.get("url") or "").strip()
        if not name or not url:
            raise HTTPException(422, detail="Each file must include non-empty 'name' and 'url'.")
        try:
            r = requests.get(url, timeout=120)
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(502, detail=f"Failed to download {name}: {e}")
        dst = path / name
        try:
            with open(dst, "wb") as f:
                f.write(r.content)
        except Exception as e:
            raise HTTPException(500, detail=f"Failed to save {name}: {e}")
        saved.append({"name": name, "path": str(dst)})
    return saved


@router.get("/core/geo/templates", responses={403: responses._403})
def list_geo_templates(
    index_url: str = "",
    admin: Admin = Depends(Admin.check_sudo_admin)
):
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
    payload: dict = Body(..., example={
        "mode": "default",
        "files": [{"name": "geosite.dat", "url": "https://.../geosite.dat"},
                  {"name": "geoip.dat", "url": "https://.../geoip.dat"}],
        "persist_env": True,
        "apply_to_nodes": True,
        "skip_node_ids": []
    }),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db)
):
    """Download and apply geo assets."""
    mode = (payload.get("mode") or "default").strip().lower()
    files = payload.get("files") or []

    template_index_url = (payload.get("template_index_url") or GEO_TEMPLATES_INDEX_DEFAULT).strip()
    template_name = (payload.get("template_name") or "").strip()
    if not files and template_name:
        try:
            r = requests.get(template_index_url, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            raise HTTPException(502, detail=f"Failed to fetch template index: {e}")
        candidates = data.get("templates", data if isinstance(data, list) else [])
        found = None
        for t in candidates:
            if t.get("name") == template_name:
                found = t
                break
        if not found:
            raise HTTPException(404, detail="Template not found in index.")
        links = found.get("links") or {}
        files = found.get("files") or [{"name": k, "url": v} for k, v in links.items()]

    if not files or not isinstance(files, list):
        raise HTTPException(422, detail="'files' must be a non-empty list of {name,url}.")

    persist_env = bool(payload.get("persist_env", True))
    apply_to_nodes = bool(payload.get("apply_to_nodes", False))
    skip_node_ids = set(payload.get("skip_node_ids") or [])

    master_assets_dir = _resolve_assets_path_master(persist_env=persist_env)
    master_saved = _download_files_to(master_assets_dir, files)

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)

    results = {"master": {"assets_path": str(master_assets_dir), "saved": master_saved}, "nodes": {}}
    if mode == "default" and apply_to_nodes:
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


def _warp_service(db: Session) -> WarpService:
    return WarpService(db)


def _serialize_warp_account(service: WarpService, account):
    return service.serialize_account(account) if account else None


@router.get("/core/warp", response_model=WarpAccountResponse, responses={403: responses._403})
def get_warp_account(
    admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)
):
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
        account, config = service.register(
            payload.private_key.strip(), payload.public_key.strip()
        )
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
def get_warp_config(
    admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)
):
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
def delete_warp_account(
    admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)
):
    """Remove the locally stored WARP credentials."""
    service = _warp_service(db)
    service.delete()
    return {"account": None}
