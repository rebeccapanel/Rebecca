#!/usr/bin/env bash
set -e

REBECCA_REPO="${REBECCA_REPO:-rebeccapanel/Rebecca}"
REBECCA_REF="${REBECCA_REF:-master}"
SCRIPT_URL="${REBECCA_SCRIPT_URL:-https://raw.githubusercontent.com/${REBECCA_REPO}/${REBECCA_REF}/scripts/rebecca/rebecca.sh}"

if [ "$(id -u)" != "0" ]; then
    echo "This script must be run as root." >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required." >&2
    exit 1
fi

tmp_script="$(mktemp)"
trap 'rm -f "$tmp_script"' EXIT

curl -fsSL "$SCRIPT_URL" -o "$tmp_script"
chmod 755 "$tmp_script"

exec "$tmp_script" migrate-binary "$@"
