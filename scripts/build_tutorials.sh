#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"${HUGO_BIN:-hugo}" \
	--source "$ROOT_DIR/tutorials" \
	--destination "$ROOT_DIR/dashboard/public/tutorial-content" \
	--cleanDestinationDir \
	--gc \
	--minify
