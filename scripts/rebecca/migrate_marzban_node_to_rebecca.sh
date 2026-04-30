#!/usr/bin/env bash
set -euo pipefail

NODE_SEARCH_BASE="/opt"
NODE_IMAGE_REPO="rebeccapanel/rebecca-node"
DEFAULT_IMAGE_TAG="latest"
NODE_SCRIPT_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node.sh"

declare -a NODE_PATHS=()
declare -a NODE_NAMES=()

SELECTED_NAME=""
SELECTED_DIR=""
COMPOSE_FILE=""
ENV_FILE=""
DESIRED_NODE_NAME=""
PYTHON_BIN=""

log() {
    echo -e "\e[96m[rebecca-node-migrate]\e[0m $1"
}

warn() {
    echo -e "\e[93m[rebecca-node-migrate]\e[0m $1"
}

error_exit() {
    echo -e "\e[91m[rebecca-node-migrate]\e[0m $1"
    exit 1
}

usage() {
    cat <<EOF
Usage: $0 [--name <existing-node-name>]

Options:
  -n, --name <value>   Name of the Marzban node to migrate (container/docker-cli name)
  -h, --help           Show this help text
EOF
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        error_exit "This script must be executed as root."
    fi
}

compose_binary() {
    if command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
        return
    fi
    if command -v docker >/dev/null 2>&1; then
        echo "docker compose"
        return
    fi
    error_exit "Docker compose was not found. Please install Docker before migrating."
}

detect_python() {
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="python3"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_BIN="python"
    else
        error_exit "python3 is required for rewriting configuration files."
    fi
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n|--name)
                if [ $# -lt 2 ]; then
                    error_exit "Missing value for $1"
                fi
                DESIRED_NODE_NAME="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error_exit "Unknown argument: $1"
                ;;
        esac
    done
}

extract_container_name() {
    local file="$1"
    awk -F: '
        $1 ~ /^[[:space:]]*container_name$/ {
            gsub(/["'\''[:space:]]/, "", $2);
            print $2;
            exit;
        }
    ' "$file"
}

discover_nodes() {
    while IFS= read -r -d '' compose; do
        if ! grep -qi "marzban-node" "$compose"; then
            continue
        fi
        local dir name base
        dir=$(dirname "$compose")
        base=$(basename "$dir")
        name=$(extract_container_name "$compose")
        if [ -z "$name" ]; then
            name="$base"
        fi
        NODE_PATHS+=("$dir")
        NODE_NAMES+=("$name")
    done < <(find "$NODE_SEARCH_BASE" -mindepth 1 -maxdepth 2 -type f -name "docker-compose.yml" -print0 2>/dev/null || true)
}

print_node_choices() {
    log "Detected Marzban nodes:"
    local idx=0
    for dir in "${NODE_PATHS[@]}"; do
        local name="${NODE_NAMES[$idx]}"
        printf "  %d) %s (%s)\n" $((idx + 1)) "$name" "$dir"
        idx=$((idx + 1))
    done
}

match_node_by_name() {
    local needle="$1"
    local idx=0
    for dir in "${NODE_PATHS[@]}"; do
        local name="${NODE_NAMES[$idx]}"
        local base
        base=$(basename "$dir")
        if [[ "$name" == "$needle" || "$base" == "$needle" ]]; then
            SELECTED_DIR="$dir"
            SELECTED_NAME="$name"
            return 0
        fi
        idx=$((idx + 1))
    done
    return 1
}

select_node() {
    local count=${#NODE_PATHS[@]}
    if [ "$count" -eq 0 ]; then
        error_exit "No Marzban-node installations were found under $NODE_SEARCH_BASE."
    fi

    if [ -n "$DESIRED_NODE_NAME" ]; then
        if match_node_by_name "$DESIRED_NODE_NAME"; then
            return
        fi
        error_exit "Unable to find a node named '$DESIRED_NODE_NAME'."
    fi

    if [ "$count" -eq 1 ]; then
        SELECTED_DIR="${NODE_PATHS[0]}"
        SELECTED_NAME="${NODE_NAMES[0]}"
        return
    fi

    print_node_choices
    local choice
    while true; do
        read -rp "Select the node to migrate [1-$count]: " choice || true
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then
            local idx=$((choice - 1))
            SELECTED_DIR="${NODE_PATHS[$idx]}"
            SELECTED_NAME="${NODE_NAMES[$idx]}"
            break
        fi
        echo "Invalid choice."
    done
}

choose_image_tag() {
    log "Default image tag is 'latest' for $NODE_IMAGE_REPO."
    read -rp "Do you want to use the 'dev' tag instead (rebeccapanel/rebecca-node:dev)? [y/N]: " answer || answer=""
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        DEFAULT_IMAGE_TAG="dev"
        log "Using image tag 'dev' (rebeccapanel/rebecca-node:dev)."
    else
        DEFAULT_IMAGE_TAG="latest"
        log "Using image tag 'latest' (rebeccapanel/rebecca-node:latest)."
    fi
}

rewrite_compose_file() {
    local file="$COMPOSE_FILE"
    if [ ! -f "$file" ]; then
        warn "docker-compose.yml not found at $file"
        return
    fi

    "$PYTHON_BIN" - "$file" "$NODE_IMAGE_REPO" "$DEFAULT_IMAGE_TAG" <<'PYCODE'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
repo = sys.argv[2]
default_tag = sys.argv[3]
text = path.read_text()

def replace_paths(value: str) -> str:
    value = re.sub(r'(:\s*["\']?)/var/lib/marzban-node', r'\1/var/lib/rebecca-node', value)
    value = re.sub(r'(:\s*["\']?)/var/lib/marzban', r'\1/var/lib/rebecca', value)
    return value

def replace_image(value: str, default_tag: str) -> str:
    pattern = re.compile(
        r'(image:\s*["\']?)(?:ghcr\.io/)?gozargah/marzban-node(?::[\w\.-]+)?',
        re.IGNORECASE,
    )
    def _repl(match: re.Match):
        return f"{match.group(1)}{repo}:{default_tag}"
    return pattern.sub(_repl, value)

updated = replace_image(replace_paths(text), default_tag)
if updated != text:
    path.write_text(updated)
PYCODE

    sed -i '/SERVICE_PROTOCOL/d' "$file"
    log "Updated references inside $file"
}


rewrite_env_file() {
    local file="$ENV_FILE"
    if [ ! -f "$file" ]; then
        warn ".env not found at $file"
        return
    fi

"$PYTHON_BIN" - "$file" <<'PYCODE'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
original_text = path.read_text()
lines = original_text.splitlines()
replacements = [
    (re.compile(r'(=\s*["\']?)/var/lib/marzban-node'), r"\1/var/lib/rebecca-node"),
    (re.compile(r'(=\s*["\']?)/var/lib/marzban'), r"\1/var/lib/rebecca"),
]
skip_keywords = ("DATABASE",)

updated_lines = []
changed = False
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        updated_lines.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if any(keyword in key.upper() for keyword in skip_keywords):
        updated_lines.append(line)
        continue
    new_line = line
    for pattern, repl in replacements:
        replaced = pattern.sub(repl, new_line)
        if replaced != new_line:
            changed = True
            new_line = replaced
    updated_lines.append(new_line)

result_text = "\n".join(updated_lines)
if original_text.endswith("\n"):
    result_text = f"{result_text}\n"

if changed:
    path.write_text(result_text)
PYCODE

    sed -i '/SERVICE_PROTOCOL/d' "$file" 2>/dev/null || true
    log "Updated references inside $file"
}

stop_old_stack() {
    local compose_bin="$1"
    if [ -f "$COMPOSE_FILE" ]; then
        log "Stopping existing Marzban-node stack for '$SELECTED_NAME'"
        if ! $compose_bin -f "$COMPOSE_FILE" down >/dev/null 2>&1; then
            warn "Unable to stop docker stack via compose. Please ensure containers are stopped manually."
        fi
    fi
}

disable_legacy_service() {
    if systemctl list-units --full -all | grep -q "marzban-node.service"; then
        systemctl disable --now marzban-node.service >/dev/null 2>&1 || true
        log "Disabled legacy marzban-node.service"
    fi
}

install_node_cli() {
    if ! command -v curl >/dev/null 2>&1; then
        error_exit "curl is required to install the Rebecca-node CLI."
    fi

    local target="/usr/local/bin/$SELECTED_NAME"
    curl -sSL "$NODE_SCRIPT_URL" -o "$target"
    sed -i "s/^APP_NAME=.*/APP_NAME=\"$SELECTED_NAME\"/" "$target"
    chmod 755 "$target"
    log "Installed $SELECTED_NAME CLI at $target"
}

main() {
    require_root
    parse_arguments "$@"
    detect_python
    discover_nodes
    select_node

    COMPOSE_FILE="$SELECTED_DIR/docker-compose.yml"
    ENV_FILE="$SELECTED_DIR/.env"

    local compose_bin
    compose_bin=$(compose_binary)

    choose_image_tag

    log "Migrating node '$SELECTED_NAME' located at $SELECTED_DIR"
    stop_old_stack "$compose_bin"
    rewrite_compose_file
    rewrite_env_file
    disable_legacy_service
    install_node_cli

    log "Migration complete. Manage this node using '${SELECTED_NAME} up/down/...'."
    
    log "Starting node after migration..."
    $SELECTED_NAME up
}

main "$@"
