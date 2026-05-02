import atexit
import json
import os
import subprocess
from pathlib import Path

from app import app
from config import DEBUG, VITE_BASE_API, DASHBOARD_PATH
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

base_dir = Path(__file__).parent
build_dir = base_dir / "build"
statics_dir = build_dir / "statics"
build_meta_path = build_dir / ".rebecca-build-meta.json"


def _normalize_dashboard_root(path: str) -> str:
    normalized = str(path or "").strip().strip("/")
    if not normalized:
        return "/dashboard"
    return f"/{normalized}"


dashboard_root = _normalize_dashboard_root(DASHBOARD_PATH)
dashboard_login = f"{dashboard_root}/login"
dashboard_base = f"{dashboard_root}/"


def _build_meta_payload() -> dict[str, str]:
    return {
        "dashboard_root": dashboard_root,
        "dashboard_base": dashboard_base,
        "vite_base_api": VITE_BASE_API,
    }


def _read_build_meta() -> dict[str, str] | None:
    if not build_meta_path.is_file():
        return None
    try:
        with open(build_meta_path, "r", encoding="utf-8") as file:
            data = json.load(file)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except (OSError, ValueError, TypeError):
        return None
    return None


def _write_build_meta():
    build_meta_path.parent.mkdir(parents=True, exist_ok=True)
    with open(build_meta_path, "w", encoding="utf-8") as file:
        json.dump(_build_meta_payload(), file, ensure_ascii=True, indent=2)


def _build_is_current() -> bool:
    if not build_dir.is_dir() or not (build_dir / "index.html").exists():
        return False
    return _read_build_meta() == _build_meta_payload()


def _redirect_to_dashboard_login():
    return RedirectResponse(url=dashboard_login, status_code=307)


def _serve_dashboard_entrypoint():
    return FileResponse(build_dir / "index.html")


def register_dashboard_login_redirects():
    if app is None or getattr(app.state, "dashboard_login_redirect_registered", False):
        return

    app.state.dashboard_login_redirect_registered = True
    app.add_api_route(
        dashboard_root,
        _redirect_to_dashboard_login,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        f"{dashboard_root}/",
        _redirect_to_dashboard_login,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        dashboard_login,
        _serve_dashboard_entrypoint,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        f"{dashboard_login}/",
        _serve_dashboard_entrypoint,
        methods=["GET"],
        include_in_schema=False,
    )


def build():
    subprocess.run(
        [
            "npm",
            "run",
            "build",
            "--",
            "--outDir",
            str(build_dir),
            "--assetsDir",
            "statics",
            "--base",
            dashboard_base,
        ],
        env={**os.environ, "VITE_BASE_API": VITE_BASE_API},
        cwd=base_dir,
        check=True,
    )
    with open(build_dir / "index.html", "r", encoding="utf-8") as file:
        html = file.read()
    with open(build_dir / "404.html", "w", encoding="utf-8") as file:
        file.write(html)
    _write_build_meta()


def run_dev():
    proc = subprocess.Popen(
        [
            "npm",
            "run",
            "dev",
            "--",
            "--host",
            "0.0.0.0",
            "--clearScreen",
            "false",
            "--base",
            dashboard_base,
        ],
        env={**os.environ, "VITE_BASE_API": VITE_BASE_API},
        cwd=base_dir,
    )

    atexit.register(proc.terminate)


def run_build():
    if not _build_is_current():
        build()
    register_dashboard_login_redirects()
    app.mount(dashboard_root, StaticFiles(directory=build_dir, html=True), name="dashboard")
    if statics_dir.is_dir():
        app.mount("/statics/", StaticFiles(directory=statics_dir, html=True), name="statics")


def startup():
    if DEBUG:
        run_dev()
    else:
        run_build()


if app is not None:
    if DEBUG:
        app.add_event_handler("startup", startup)
    else:
        # Mount dashboard immediately in production mode so route is always available.
        run_build()
