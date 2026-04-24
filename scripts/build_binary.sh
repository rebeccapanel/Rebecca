#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "dashboard/build/index.html" ]; then
    echo "dashboard/build is missing. Build the dashboard before creating binaries." >&2
    exit 1
fi

if ! python -c "import PyInstaller" >/dev/null 2>&1; then
    python -m pip install --disable-pip-version-check pyinstaller
fi

COMMON_PYINSTALLER_ARGS=(
    --clean
    --noconfirm
    --onefile
    --add-data "alembic.ini:."
    --add-data "app/templates:app/templates"
    --add-data "app/db/migrations:app/db/migrations"
    --collect-submodules app
    --collect-submodules alembic
    --collect-submodules cli
    --collect-all alembic
    --collect-all apscheduler
    --collect-all fastapi
    --collect-all jinja2
    --collect-all pydantic
    --collect-all sqlalchemy
    --collect-all starlette
    --collect-all uvicorn
    --hidden-import pymysql
)

python -m PyInstaller \
    "${COMMON_PYINSTALLER_ARGS[@]}" \
    --name rebecca-server \
    --add-data "dashboard/build:dashboard/build" \
    packaging/binary_launcher.py

python -m PyInstaller \
    "${COMMON_PYINSTALLER_ARGS[@]}" \
    --name rebecca-cli \
    rebecca-cli.py
