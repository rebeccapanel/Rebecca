#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "dashboard/build/index.html" ] && [ ! -f "dashboard/dist/index.html" ]; then
    echo "Dashboard build is missing. Build dashboard/build or dashboard/dist before creating binaries." >&2
    exit 1
fi

prepare_go_dashboard_embed() {
    local source_dir="dashboard/build"
    local target_dir="internal/gateway/static/dashboard/build"
    if [[ ! -f "$source_dir/index.html" && -f "dashboard/dist/index.html" ]]; then
        source_dir="dashboard/dist"
    fi
    if [[ ! -f "$source_dir/index.html" ]]; then
        echo "Dashboard build is missing. Expected dashboard/build/index.html or dashboard/dist/index.html." >&2
        exit 1
    fi
    rm -rf "$target_dir"
    mkdir -p "$target_dir"
    cp -R "$source_dir"/. "$target_dir/"
    touch "$target_dir/.gitkeep"
}

gateway_output="$ROOT_DIR/dist/rebecca-server"
mkdir -p "$ROOT_DIR/dist"
rm -rf "$ROOT_DIR/dist/templates"
if [[ -d "$ROOT_DIR/templates" ]]; then
    cp -R "$ROOT_DIR/templates" "$ROOT_DIR/dist/templates"
fi
if [[ "${OS:-}" == "Windows_NT" ]]; then
    gateway_output="$ROOT_DIR/dist/rebecca-server.exe"
fi

(
    prepare_go_dashboard_embed
    cd "$ROOT_DIR"
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -o "$gateway_output" ./cmd/rebecca_gateway
)

echo "Rebecca Go gateway built at $gateway_output"

bash scripts/build_go_cli.sh
