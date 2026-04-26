#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "dashboard/build/index.html" ]; then
    echo "dashboard/build is missing. Build the dashboard before creating binaries." >&2
    exit 1
fi

if ! python -c "import PyInstaller" >/dev/null 2>&1; then
    if python -m pip --version >/dev/null 2>&1; then
        python -m pip install --disable-pip-version-check pyinstaller
    else
        echo "PyInstaller is missing from the active environment." >&2
        echo "Sync the locked build dependencies first (for example: uv sync --group build)." >&2
        exit 1
    fi
fi

if [[ "${OS:-}" == "Windows_NT" ]]; then
    PYINSTALLER_DATA_SEP=";"
else
    PYINSTALLER_DATA_SEP=":"
fi

pyinstaller_add_data() {
    printf "%s%s%s" "$1" "$PYINSTALLER_DATA_SEP" "$2"
}

COMMON_PYINSTALLER_ARGS=(
    --clean
    --noconfirm
    --onefile
    --add-data "$(pyinstaller_add_data "alembic.ini" ".")"
    --add-data "$(pyinstaller_add_data "app/templates" "app/templates")"
    --add-data "$(pyinstaller_add_data "app/db/migrations" "app/db/migrations")"
    --collect-submodules app
    --collect-submodules alembic
    --collect-submodules cli
    --collect-all alembic
    --collect-all apscheduler
    --collect-all fastapi
    --collect-all jinja2
    --collect-all bcrypt
    --collect-all passlib
    --collect-all pydantic
    --collect-all sqlalchemy
    --collect-all starlette
    --collect-all uvicorn
    --hidden-import dashboard
    --hidden-import main
    --hidden-import passlib.handlers.bcrypt
    --hidden-import pymysql
)

env REBECCA_SKIP_RUNTIME_INIT=1 DEBUG=false DOCS=false python -m PyInstaller \
    "${COMMON_PYINSTALLER_ARGS[@]}" \
    --name rebecca-server \
    --add-data "$(pyinstaller_add_data "dashboard/build" "dashboard/build")" \
    packaging/binary_launcher.py

env REBECCA_SKIP_RUNTIME_INIT=1 DEBUG=false DOCS=false python -m PyInstaller \
    "${COMMON_PYINSTALLER_ARGS[@]}" \
    --name rebecca-cli \
    rebecca-cli.py
