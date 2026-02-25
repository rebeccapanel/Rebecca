import atexit
import os
import subprocess
from pathlib import Path

from app import app
from config import DEBUG, VITE_BASE_API, DASHBOARD_PATH
from fastapi.staticfiles import StaticFiles

base_dir = Path(__file__).parent
build_dir = base_dir / "build"
statics_dir = build_dir / "statics"


def build():
    proc = subprocess.Popen(
        ["npm", "run", "build", "--", "--outDir", build_dir, "--assetsDir", "statics"],
        env={**os.environ, "VITE_BASE_API": VITE_BASE_API},
        cwd=base_dir,
    )
    proc.wait()
    with open(build_dir / "index.html", "r") as file:
        html = file.read()
    with open(build_dir / "404.html", "w") as file:
        file.write(html)


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
            os.path.join(DASHBOARD_PATH, ""),
        ],
        env={**os.environ, "VITE_BASE_API": VITE_BASE_API},
        cwd=base_dir,
    )

    atexit.register(proc.terminate)


def run_build():
    if not build_dir.is_dir() or not (build_dir / "index.html").exists():
        build()
    app.mount(DASHBOARD_PATH, StaticFiles(directory=build_dir, html=True), name="dashboard")
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
