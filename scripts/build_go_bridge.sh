#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_DIR="$ROOT_DIR/go"

if [ "${REBECCA_SKIP_GO_BRIDGE:-0}" = "1" ]; then
    echo "Skipping Rebecca Go bridge build."
    exit 0
fi

if [[ "${OS:-}" == "Windows_NT" ]]; then
    echo "Skipping Rebecca Go bridge build on Windows."
    exit 0
fi

if ! command -v go >/dev/null 2>&1; then
    echo "Go toolchain is required to build the Rebecca Go bridge." >&2
    exit 1
fi

mkdir -p "$GO_DIR/build"

case "$(uname -s)" in
    Darwin)
        output="$GO_DIR/build/librebecca_bridge.dylib"
        ;;
    *)
        output="$GO_DIR/build/librebecca_bridge.so"
        ;;
esac

(
    cd "$GO_DIR"
    CGO_ENABLED=1 go build -trimpath -buildmode=c-shared -o "$output" ./cmd/rebecca_bridge
)

echo "Rebecca Go bridge built at $output"
