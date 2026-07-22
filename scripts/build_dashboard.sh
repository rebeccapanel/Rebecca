#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT_DIR/scripts/build_tutorials.sh"
cd "$ROOT_DIR/dashboard"
export MSYS_NO_PATHCONV=1
VITE_BASE_API=/api/ npm run build
cp ./build/index.html ./build/404.html
