#!/usr/bin/env bash
set -e

APP_NAME_FROM_ARG=0
INSTALL_DIR="/opt"
NODE_DISCOVERY_BASE="/opt"
SKIP_SERVICE_UPDATE=0
INSTALL_MODE_REQUESTED=""
NODE_VERSION_REQUESTED=""
NODE_VERSION_SET=0

SCRIPT_NAME=$(basename "$0")
SCRIPT_BASENAME="${SCRIPT_NAME%.*}"

declare -a DISCOVERED_NODE_PATHS=()
declare -a DISCOVERED_NODE_NAMES=()

ensure_valid_app_name() {
    local candidate="${APP_NAME:-$SCRIPT_BASENAME}"
    if ! [[ "$candidate" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
        candidate="rebecca-node"
        echo "Invalid app name detected. Falling back to default: $candidate"
    fi
    APP_NAME="$candidate"
}

set_app_context() {
    if [ -z "$APP_NAME" ]; then
        APP_NAME="$SCRIPT_BASENAME"
    fi
    ensure_valid_app_name

    if [ -z "${APP_DIR:-}" ] || [ ! -d "$APP_DIR" ]; then
        if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
            APP_DIR="$INSTALL_DIR/$APP_NAME"
        elif [ -d "$INSTALL_DIR/Rebecca-node" ]; then
            APP_DIR="$INSTALL_DIR/Rebecca-node"
        else
            APP_DIR="$INSTALL_DIR/$APP_NAME"
        fi
    fi

    DATA_DIR="/var/lib/$APP_NAME"
    DATA_MAIN_DIR="/var/lib/$APP_NAME"
    COMPOSE_FILE="$APP_DIR/docker-compose.yml"
    BRANCH_FILE="$APP_DIR/.branch"
    INSTALL_MODE_FILE="$APP_DIR/.install-mode"
    CERT_FILE="$DATA_DIR/cert.pem"
    ENV_FILE="$APP_DIR/.env"

    BINARY_BIN_DIR="$APP_DIR/bin"
    BINARY_NODE="$BINARY_BIN_DIR/rebecca-node"
    BINARY_NODE_SERVICE="$BINARY_BIN_DIR/rebecca-node-service"
    BINARY_METADATA_FILE="$APP_DIR/.binary-release.json"
    BINARY_SERVICE_UNIT="/etc/systemd/system/${APP_NAME}.service"

    NODE_SERVICE_DIR="/usr/local/share/${APP_NAME}-maintenance"
    NODE_SERVICE_FILE="$NODE_SERVICE_DIR/main.py"
    NODE_SERVICE_REQUIREMENTS="$NODE_SERVICE_DIR/requirements.txt"
    NODE_SERVICE_UNIT="/etc/systemd/system/${APP_NAME}-maint.service"
    NODE_SERVICE_UNIT_NAME="${APP_NAME}-maint.service"
}

NODE_SERVICE_DIR_CREATED="0"

while [[ $# -gt 0 ]]; do
    key="$1"
    
    case $key in
        install|update|uninstall|up|down|restart|status|logs|core-update|install-script|update-script|uninstall-script|install-service|uninstall-service|service-status|service-logs|edit|service-install|service-update|service-uninstall|script-install|script-update|script-uninstall|help)
            COMMAND="$1"
            shift # past argument
        ;;
        --skip-service-update)
            SKIP_SERVICE_UPDATE=1
            shift
        ;;
        --mode)
            if [ -z "${2:-}" ]; then
                echo "Error: --mode requires docker or binary."
                exit 1
            fi
            INSTALL_MODE_REQUESTED="${2:-}"
            shift 2
        ;;
        --binary)
            INSTALL_MODE_REQUESTED="binary"
            shift
        ;;
        --docker|--dockerized)
            INSTALL_MODE_REQUESTED="docker"
            shift
        ;;
        --dev)
            if [ "$NODE_VERSION_SET" -eq 1 ] && [ "$NODE_VERSION_REQUESTED" != "dev" ]; then
                echo "Error: Cannot use --dev and --version options simultaneously."
                exit 1
            fi
            NODE_VERSION_REQUESTED="dev"
            NODE_VERSION_SET=1
            shift
        ;;
        --version)
            if [ "$NODE_VERSION_SET" -eq 1 ]; then
                echo "Error: Cannot use --dev and --version options simultaneously."
                exit 1
            fi
            if [ -z "${2:-}" ]; then
                echo "Error: --version requires a value."
                exit 1
            fi
            NODE_VERSION_REQUESTED="${2:-}"
            NODE_VERSION_SET=1
            shift 2
        ;;
        --name)
            if [[ "$COMMAND" == "install" || "$COMMAND" == "install-script" || "$COMMAND" == "install-service" || "$COMMAND" == "service-install" || "$COMMAND" == "script-install" ]]; then
                APP_NAME="$2"
                APP_NAME_FROM_ARG=1
                shift # past argument
            else
                echo "Error: --name parameter is only allowed with 'install', 'install-script', or 'install-service' commands."
                exit 1
            fi
            shift # past value
        ;;
        *)
            shift # past unknown argument
        ;;
    esac
done

# Fetch IP address from ipinfo.io API
NODE_IP=$(curl -s -4 ifconfig.io)

# If the IPv4 retrieval is empty, attempt to retrieve the IPv6 address
if [ -z "$NODE_IP" ]; then
    NODE_IP=$(curl -s -6 ifconfig.io)
fi

if [[ "$COMMAND" == "install" || "$COMMAND" == "install-script" || "$COMMAND" == "install-service" ]] && [ -z "$APP_NAME" ]; then
    APP_NAME="$SCRIPT_BASENAME"
fi
# Set script name if APP_NAME is not set
if [ -z "$APP_NAME" ]; then
    APP_NAME="$SCRIPT_BASENAME"
fi
ensure_valid_app_name

LAST_XRAY_CORES=5

REBECCA_REPO="${REBECCA_REPO:-rebeccapanel/Rebecca}"
REBECCA_REF="${REBECCA_REF:-master}"
REBECCA_SCRIPT_BASE_URL="${REBECCA_SCRIPT_BASE_URL:-https://raw.githubusercontent.com/${REBECCA_REPO}/${REBECCA_REF}/scripts/rebecca}"
REBECCA_NODE_RELEASE_REPO="${REBECCA_NODE_RELEASE_REPO:-rebeccapanel/Rebecca-node}"
REBECCA_NODE_BINARY_DEV_BRANCH="${REBECCA_NODE_BINARY_DEV_BRANCH:-dev}"
REBECCA_NODE_BINARY_WORKFLOW_NAME="${REBECCA_NODE_BINARY_WORKFLOW_NAME:-binary-build}"
REBECCA_NODE_BINARY_ARTIFACT_PREFIX="${REBECCA_NODE_BINARY_ARTIFACT_PREFIX:-rebecca-node-binaries}"

# Default branch values (master)
BRANCH="master"
NODE_SERVICE_SOURCE_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/master/node_service.py"
NODE_SERVICE_REQUIREMENTS_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/master/requirements.txt"
SCRIPT_URL="$REBECCA_SCRIPT_BASE_URL/rebecca-node.sh"

# Set port if missing
if [ -z "${REBECCA_NODE_SCRIPT_PORT:-}" ]; then
    REBECCA_NODE_SCRIPT_PORT="3100"
fi

colorized_echo() {
    local color=$1
    local text=$2
    local style=${3:-0}  # Default style is normal

    case $color in
        "red")
            printf "\e[${style};91m${text}\e[0m\n"
        ;;
        "green")
            printf "\e[${style};92m${text}\e[0m\n"
        ;;
        "yellow")
            printf "\e[${style};93m${text}\e[0m\n"
        ;;
        "blue")
            printf "\e[${style};94m${text}\e[0m\n"
        ;;
        "magenta")
            printf "\e[${style};95m${text}\e[0m\n"
        ;;
        "cyan")
            printf "\e[${style};96m${text}\e[0m\n"
        ;;
        *)
            echo "${text}"
        ;;
    esac
}

ensure_env_file() {
    mkdir -p "$(dirname "$ENV_FILE")"
    touch "$ENV_FILE"
}

set_env_value() {
    local key="$1"
    local value="$2"
    value=$(echo "$value" | sed 's/^"//;s/"$//')
    ensure_env_file
    if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^[[:space:]]*${key}[[:space:]]*=.*|${key} = \"${value}\"|" "$ENV_FILE"
    else
        echo "${key} = \"${value}\"" >> "$ENV_FILE"
    fi
}

get_env_value() {
    local key="$1"
    if [ ! -f "$ENV_FILE" ]; then
        return
    fi

    grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null \
        | tail -n 1 \
        | sed -E 's/^[^=]+=//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^"//; s/"$//'
}

persist_rebecca_node_service_env() {
    local saved_host
    local saved_port
    local host
    local port

    saved_host=$(get_env_value "REBECCA_NODE_SCRIPT_HOST")
    saved_port=$(get_env_value "REBECCA_NODE_SCRIPT_PORT")
    host="${REBECCA_NODE_SCRIPT_HOST:-${saved_host:-127.0.0.1}}"
    port="${REBECCA_NODE_SCRIPT_PORT:-}"
    if [ -n "$saved_port" ] && { [ -z "$port" ] || [ "$port" = "3100" ]; }; then
        port="$saved_port"
    fi
    port="${port:-3100}"
    REBECCA_NODE_SCRIPT_PORT="$port"

    set_env_value "REBECCA_NODE_SCRIPT_HOST" "$host"
    set_env_value "REBECCA_NODE_SCRIPT_PORT" "$port"
}

extract_container_name() {
    local compose_file="$1"
    if [ ! -f "$compose_file" ]; then
        return
    fi
    local match
    match=$(grep -m1 "container_name" "$compose_file" 2>/dev/null | awk -F: '{gsub(/["[:space:]]/, "", $2); print $2}')
    if [ -n "$match" ]; then
        echo "$match"
    fi
}

add_discovered_node_instance() {
    local dir="$1"
    local name="$2"
    local existing

    for existing in "${DISCOVERED_NODE_PATHS[@]}"; do
        if [ "$existing" = "$dir" ]; then
            return
        fi
    done

    if [ -z "$name" ]; then
        name=$(basename "$dir")
    fi
    DISCOVERED_NODE_PATHS+=("$dir")
    DISCOVERED_NODE_NAMES+=("$name")
}

discover_node_instances() {
    DISCOVERED_NODE_PATHS=()
    DISCOVERED_NODE_NAMES=()
    while IFS= read -r -d '' compose; do
        if ! grep -qi "rebeccapanel/rebecca-node" "$compose"; then
            continue
        fi
        local dir name
        dir=$(dirname "$compose")
        name=$(extract_container_name "$compose")
        if [ -z "$name" ]; then
            name=$(basename "$dir")
        fi
        add_discovered_node_instance "$dir" "$name"
    done < <(find "$NODE_DISCOVERY_BASE" -mindepth 1 -maxdepth 2 -type f -name "docker-compose.yml" -print0 2>/dev/null || true)

    while IFS= read -r -d '' mode_file; do
        local dir
        dir=$(dirname "$mode_file")
        add_discovered_node_instance "$dir" "$(basename "$dir")"
    done < <(find "$NODE_DISCOVERY_BASE" -mindepth 1 -maxdepth 2 -type f -name ".install-mode" -print0 2>/dev/null || true)

    while IFS= read -r -d '' binary_file; do
        local dir
        dir=$(dirname "$(dirname "$binary_file")")
        add_discovered_node_instance "$dir" "$(basename "$dir")"
    done < <(find "$NODE_DISCOVERY_BASE" -mindepth 2 -maxdepth 3 -type f -path "*/bin/rebecca-node" -print0 2>/dev/null || true)
}

prompt_node_selection() {
    discover_node_instances
    local count=${#DISCOVERED_NODE_PATHS[@]}
    if [ "$count" -eq 0 ]; then
        colorized_echo red "No Rebecca-node installations detected under $NODE_DISCOVERY_BASE."
        colorized_echo yellow "Specify the node with --name <node-name> or install the node first."
        exit 1
    fi
    if [ "$count" -eq 1 ]; then
        APP_NAME="${DISCOVERED_NODE_NAMES[0]}"
        APP_DIR="${DISCOVERED_NODE_PATHS[0]}"
        return
    fi

    colorized_echo cyan "Select the Rebecca-node instance:"
    local idx=0
    for dir in "${DISCOVERED_NODE_PATHS[@]}"; do
        local display="${DISCOVERED_NODE_NAMES[$idx]}"
        printf "  %d) %s (%s)\n" $((idx + 1)) "$display" "$dir"
        idx=$((idx + 1))
    done
    local selection
    while true; do
        read -rp "Choice [1-$count]: " selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "$count" ]; then
            local chosen=$((selection - 1))
            APP_NAME="${DISCOVERED_NODE_NAMES[$chosen]}"
            APP_DIR="${DISCOVERED_NODE_PATHS[$chosen]}"
            break
        fi
        echo "Invalid choice."
    done
}

resolve_node_service_unit_name() {
    if [ -f "$NODE_SERVICE_UNIT" ]; then
        echo "$NODE_SERVICE_UNIT_NAME"
        return
    fi
    if [ -f "/etc/systemd/system/rebecca-node-maint.service" ]; then
        echo "rebecca-node-maint.service"
        return
    fi
    echo "$NODE_SERVICE_UNIT_NAME"
}

if [[ "$COMMAND" == "install-service" && "$APP_NAME_FROM_ARG" -eq 0 ]]; then
    if [ "$APP_NAME" = "rebecca-node" ]; then
        prompt_node_selection
    else
        if [ -z "${APP_DIR:-}" ] || [ ! -d "$APP_DIR" ]; then
            APP_DIR="$INSTALL_DIR/$APP_NAME"
        fi
    fi
fi

set_app_context

set_branch_variables() {
    local selected_branch="${1:-master}"
    case "$selected_branch" in
        dev|development)
            BRANCH="dev"
            IMAGE_TAG="dev"
            DOCKER_IMAGE="rebeccapanel/rebecca-node:dev"
            NODE_SERVICE_SOURCE_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/dev/node_service.py"
            NODE_SERVICE_REQUIREMENTS_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/dev/requirements.txt"
        ;;
        *)
            BRANCH="master"
            IMAGE_TAG="latest"
            DOCKER_IMAGE="rebeccapanel/rebecca-node:latest"
            NODE_SERVICE_SOURCE_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/master/node_service.py"
            NODE_SERVICE_REQUIREMENTS_URL="https://raw.githubusercontent.com/rebeccapanel/Rebecca-node/master/requirements.txt"
        ;;
    esac
    SCRIPT_BRANCH="$BRANCH"
    REBECCA_REF="$BRANCH"
    REBECCA_SCRIPT_BASE_URL="https://raw.githubusercontent.com/${REBECCA_REPO}/${REBECCA_REF}/scripts/rebecca"
    SCRIPT_URL="https://raw.githubusercontent.com/${REBECCA_REPO}/${BRANCH}/scripts/rebecca/rebecca-node.sh"
}

prompt_branch_selection() {
    local question
    if [[ "$BRANCH" == "dev" ]]; then
        question="Keep using the dev branch? (Y/n): "
    else
        question="Do you want to install Rebecca-node using the dev branch? (y/N): "
    fi
    read -p "$question" -r branch_answer
    if [[ "$BRANCH" == "dev" ]]; then
        if [[ -z "$branch_answer" || "$branch_answer" =~ ^[Yy]$ ]]; then
            set_branch_variables dev
        else
            set_branch_variables master
        fi
    else
        if [[ "$branch_answer" =~ ^[Yy]$ ]]; then
            set_branch_variables dev
        else
            set_branch_variables master
        fi
    fi
    colorized_echo blue "Selected branch: $BRANCH (image tag: $IMAGE_TAG)"
}

normalize_install_mode() {
    local mode
    mode=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
    case "$mode" in
        docker|dockerized|compose)
            echo "docker"
        ;;
        binary|bin|native)
            echo "binary"
        ;;
        "")
            echo ""
        ;;
        *)
            colorized_echo red "Invalid install mode: $1" >&2
            colorized_echo yellow "Valid modes are: docker, binary" >&2
            exit 1
        ;;
    esac
}

get_install_mode() {
    if [ -f "$INSTALL_MODE_FILE" ]; then
        normalize_install_mode "$(tr -d '[:space:]' < "$INSTALL_MODE_FILE")"
        return
    fi
    if [ -x "$BINARY_NODE" ] || [ -f "$BINARY_SERVICE_UNIT" ]; then
        echo "binary"
        return
    fi
    echo "docker"
}

is_binary_install() {
    [ "$(get_install_mode)" = "binary" ]
}

select_install_mode() {
    local requested_mode
    requested_mode=$(normalize_install_mode "${1:-${REBECCA_NODE_INSTALL_MODE:-}}")

    if [ -n "$requested_mode" ]; then
        echo "$requested_mode"
        return
    fi

    if [ ! -t 0 ]; then
        echo "docker"
        return
    fi

    colorized_echo cyan "Select Rebecca-node installation mode:" >&2
    colorized_echo yellow "  1) Dockerized" >&2
    colorized_echo yellow "  2) Binary (native systemd service, no Docker)" >&2
    read -r -p "Install mode [1]: " install_mode_answer

    case "$install_mode_answer" in
        2|binary|Binary|bin|native)
            echo "binary"
        ;;
        ""|1|docker|Docker|dockerized|compose)
            echo "docker"
        ;;
        *)
            colorized_echo red "Invalid install mode selection."
            exit 1
        ;;
    esac
}

select_node_version() {
    local requested_version="${1:-}"
    local install_mode="${2:-docker}"

    if [ -n "$requested_version" ]; then
        echo "$requested_version"
        return
    fi

    if [ ! -t 0 ]; then
        echo "latest"
        return
    fi

    colorized_echo cyan "Select Rebecca-node release channel for ${install_mode} mode:" >&2
    colorized_echo yellow "  1) latest" >&2
    if [ "$install_mode" = "binary" ]; then
        colorized_echo yellow "  2) dev (latest successful binary build from ${REBECCA_NODE_BINARY_DEV_BRANCH})" >&2
    else
        colorized_echo yellow "  2) dev (Docker image tag dev)" >&2
    fi
    read -r -p "Release channel [1]: " node_version_answer

    case "$node_version_answer" in
        2|dev|Dev)
            echo "dev"
        ;;
        ""|1|latest|Latest|stable|Stable)
            echo "latest"
        ;;
        *)
            colorized_echo red "Invalid release channel selection."
            exit 1
        ;;
    esac
}

BRANCH="master"
IMAGE_TAG="latest"
SCRIPT_BRANCH="master"
DOCKER_IMAGE="rebeccapanel/rebecca-node:latest"
SCRIPT_URL="$REBECCA_SCRIPT_BASE_URL/rebecca-node.sh"
if [ -f "$BRANCH_FILE" ]; then
    saved_branch=$(tr -d '[:space:]' < "$BRANCH_FILE")
    if [[ -n "$saved_branch" ]]; then
        set_branch_variables "$saved_branch"
    else
        set_branch_variables "$BRANCH"
    fi
else
    set_branch_variables "$BRANCH"
fi


check_running_as_root() {
    if [ "$(id -u)" != "0" ]; then
        colorized_echo red "This command must be run as root."
        exit 1
    fi
}

detect_os() {
    # Detect the operating system
    if [ -f /etc/lsb-release ]; then
        OS=$(lsb_release -si)
        elif [ -f /etc/os-release ]; then
        OS=$(awk -F= '/^NAME/{print $2}' /etc/os-release | tr -d '"')
        elif [ -f /etc/redhat-release ]; then
        OS=$(cat /etc/redhat-release | awk '{print $1}')
        elif [ -f /etc/arch-release ]; then
        OS="Arch"
    else
        colorized_echo red "Unsupported operating system"
        exit 1
    fi
}

detect_and_update_package_manager() {
    colorized_echo blue "Updating package manager"
    if [[ "$OS" == "Ubuntu"* ]] || [[ "$OS" == "Debian"* ]]; then
        PKG_MANAGER="apt-get"
        DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a $PKG_MANAGER update -qq >/dev/null 2>&1
    elif [[ "$OS" == "CentOS"* ]] || [[ "$OS" == "AlmaLinux"* ]]; then
        PKG_MANAGER="yum"
        $PKG_MANAGER update -y -q >/dev/null 2>&1
        $PKG_MANAGER install -y -q epel-release >/dev/null 2>&1
    elif [[ "$OS" == "Fedora"* ]]; then
        PKG_MANAGER="dnf"
        $PKG_MANAGER update -q -y >/dev/null 2>&1
    elif [[ "$OS" == "Arch"* ]]; then
        PKG_MANAGER="pacman"
        $PKG_MANAGER -Sy --noconfirm --quiet >/dev/null 2>&1
    elif [[ "$OS" == "openSUSE"* ]]; then
        PKG_MANAGER="zypper"
        $PKG_MANAGER refresh --quiet >/dev/null 2>&1
    else
        colorized_echo red "Unsupported operating system"
        exit 1
    fi
}


detect_compose() {
    # Check if docker compose command exists
    if docker compose >/dev/null 2>&1; then
        COMPOSE='docker compose'
        elif docker-compose >/dev/null 2>&1; then
        COMPOSE='docker-compose'
    else
        colorized_echo red "docker compose not found"
        exit 1
    fi
}

install_package () {
    if [ -z "$PKG_MANAGER" ]; then
        detect_and_update_package_manager
    fi

    PACKAGE=$1
    colorized_echo blue "Installing $PACKAGE"
    if [[ "$OS" == "Ubuntu"* ]] || [[ "$OS" == "Debian"* ]]; then
        DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a $PKG_MANAGER -y -qq install "$PACKAGE" \
            -o Dpkg::Options::="--force-confdef" \
            -o Dpkg::Options::="--force-confold" >/dev/null 2>&1
    elif [[ "$OS" == "CentOS"* ]] || [[ "$OS" == "AlmaLinux"* ]]; then
        $PKG_MANAGER install -y -q "$PACKAGE" >/dev/null 2>&1
    elif [[ "$OS" == "Fedora"* ]]; then
        $PKG_MANAGER install -y -q "$PACKAGE" >/dev/null 2>&1
    elif [[ "$OS" == "Arch"* ]]; then
        $PKG_MANAGER -S --noconfirm --quiet "$PACKAGE" >/dev/null 2>&1
    elif [[ "$OS" == "openSUSE"* ]]; then
        PKG_MANAGER="zypper"
        $PKG_MANAGER --quiet install -y "$PACKAGE" >/dev/null 2>&1
    else
        colorized_echo red "Unsupported operating system"
        exit 1
    fi
}

ensure_python3_venv() {
    detect_os
    if [[ "$OS" == "Ubuntu"* ]] || [[ "$OS" == "Debian"* ]]; then
        PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "3")
        install_package "python${PY_VER}-venv" || install_package python3-venv
    else
        install_package python3-venv
    fi
}

install_docker() {
    # Install Docker and Docker Compose using the official installation script
    colorized_echo blue "Installing Docker"
    curl -fsSL https://get.docker.com | sh
    colorized_echo green "Docker installed successfully"
}

detect_node_binary_arch() {
    case "$(uname -m)" in
        amd64|x86_64)
            echo "amd64"
        ;;
        *)
            colorized_echo red "Rebecca-node binary install currently supports linux/amd64 only." >&2
            colorized_echo yellow "Use Dockerized install on this architecture." >&2
            exit 1
        ;;
    esac
}

get_node_binary_release_asset_metadata() {
    local node_version="$1"
    local binary_arch="$2"
    local release_api
    local release_payload
    local resolved_tag
    local node_asset_name
    local service_asset_name
    local node_asset_url
    local service_asset_url

    if [ "$node_version" = "latest" ]; then
        release_api="https://api.github.com/repos/${REBECCA_NODE_RELEASE_REPO}/releases/latest"
    else
        release_api="https://api.github.com/repos/${REBECCA_NODE_RELEASE_REPO}/releases/tags/${node_version}"
    fi

    release_payload=$(curl -fsSL "$release_api") || {
        colorized_echo red "Unable to read Rebecca-node release metadata: $release_api" >&2
        exit 1
    }

    resolved_tag=$(echo "$release_payload" | jq -r '.tag_name // empty')
    node_asset_name="rebecca-node-${resolved_tag}-linux-${binary_arch}"
    service_asset_name="rebecca-node-service-${resolved_tag}-linux-${binary_arch}"

    node_asset_url=$(echo "$release_payload" | jq -r --arg name "$node_asset_name" '
        .assets[]?
        | select(.name == $name)
        | .browser_download_url
    ' | head -n 1)

    service_asset_url=$(echo "$release_payload" | jq -r --arg name "$service_asset_name" '
        .assets[]?
        | select(.name == $name)
        | .browser_download_url
    ' | head -n 1)

    if [ -z "$node_asset_url" ] || [ "$node_asset_url" = "null" ] || [ -z "$service_asset_url" ] || [ "$service_asset_url" = "null" ]; then
        colorized_echo red "No Rebecca-node binary release assets found for linux-${binary_arch}." >&2
        colorized_echo yellow "Use --dev after the dev binary workflow succeeds, or use Dockerized install." >&2
        exit 1
    fi

    printf '%s|%s|%s\n' "${resolved_tag:-$node_version}" "$node_asset_url" "$service_asset_url"
}

get_node_binary_dev_artifact_metadata() {
    local binary_arch="$1"
    local workflow_runs_api
    local workflow_runs_payload
    local latest_run_json
    local run_id
    local head_sha
    local artifacts_api
    local artifacts_payload
    local artifact_name
    local artifact_url

    workflow_runs_api="https://api.github.com/repos/${REBECCA_NODE_RELEASE_REPO}/actions/workflows/${REBECCA_NODE_BINARY_WORKFLOW_NAME}.yml/runs?branch=${REBECCA_NODE_BINARY_DEV_BRANCH}&status=success&event=push&per_page=20"
    workflow_runs_payload=$(curl -fsSL "$workflow_runs_api") || {
        colorized_echo red "Unable to read Rebecca-node binary workflow metadata: $workflow_runs_api" >&2
        exit 1
    }

    latest_run_json=$(echo "$workflow_runs_payload" | jq -c '
        .workflow_runs[]?
        | select(.head_branch == "'"${REBECCA_NODE_BINARY_DEV_BRANCH}"'" and .conclusion == "success")
    ' | head -n 1)

    if [ -z "$latest_run_json" ]; then
        colorized_echo red "No successful Rebecca-node binary workflow run was found on branch ${REBECCA_NODE_BINARY_DEV_BRANCH}." >&2
        exit 1
    fi

    run_id=$(echo "$latest_run_json" | jq -r '.id // empty')
    head_sha=$(echo "$latest_run_json" | jq -r '.head_sha // empty')
    artifacts_api="https://api.github.com/repos/${REBECCA_NODE_RELEASE_REPO}/actions/runs/${run_id}/artifacts"
    artifacts_payload=$(curl -fsSL "$artifacts_api") || {
        colorized_echo red "Unable to read Rebecca-node binary workflow artifacts: $artifacts_api" >&2
        exit 1
    }

    artifact_name=$(echo "$artifacts_payload" | jq -r --arg preferred "${REBECCA_NODE_BINARY_ARTIFACT_PREFIX}-linux-${binary_arch}" --arg arch "linux-${binary_arch}" '
        [
            .artifacts[]?
            | select((.expired | not) and (.name == $preferred or ((.name | startswith("rebecca-node")) and (.name | contains($arch)))))
        ]
        | sort_by(if .name == $preferred then 0 else 1 end, .created_at)
        | .[0].name // empty
    ')

    if [ -z "$artifact_name" ]; then
        colorized_echo red "No usable Rebecca-node binary dev artifact was found for workflow run ${run_id}." >&2
        exit 1
    fi

    artifact_url="https://nightly.link/${REBECCA_NODE_RELEASE_REPO}/workflows/${REBECCA_NODE_BINARY_WORKFLOW_NAME}/${REBECCA_NODE_BINARY_DEV_BRANCH}/${artifact_name}.zip"
    printf '%s|%s\n' "dev-${head_sha:0:7}" "$artifact_url"
}

write_node_binary_release_metadata() {
    local resolved_version="$1"
    local binary_arch="$2"
    local asset_url="$3"

    jq -n \
        --arg image "rebecca-node (binary)" \
        --arg tag "$resolved_version" \
        --arg asset_url "$asset_url" \
        --arg arch "linux-${binary_arch}" \
        --arg node_binary "$BINARY_NODE" \
        --arg service_binary "$BINARY_NODE_SERVICE" \
        --arg installed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{
            install_mode: "binary",
            image: $image,
            tag: $tag,
            asset_url: $asset_url,
            arch: $arch,
            node_binary: $node_binary,
            service_binary: $service_binary,
            installed_at: $installed_at
        }' > "$BINARY_METADATA_FILE"
}

create_binary_rebecca_node_service() {
    cat > "$BINARY_SERVICE_UNIT" <<EOF
[Unit]
Description=Rebecca-node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=REBECCA_NODE_APP_NAME=$APP_NAME
Environment=REBECCA_NODE_APP_DIR=$APP_DIR
Environment=REBECCA_NODE_DATA_DIR=$DATA_DIR
Environment=REBECCA_DATA_DIR=$DATA_DIR
Environment=REBECCA_NODE_INSTALL_MODE=binary
Environment=REBECCA_NODE_BINARY_METADATA_FILE=$BINARY_METADATA_FILE
ExecStart=$BINARY_NODE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
}

install_latest_xray_for_binary_node() {
    mkdir -p "$APP_DIR/scripts" "$DATA_DIR/xray-core"
    colorized_echo blue "Installing Xray core for binary node"
    curl -fsSL "$REBECCA_SCRIPT_BASE_URL/install_latest_xray.sh" -o "$APP_DIR/scripts/install_latest_xray.sh"
    chmod +x "$APP_DIR/scripts/install_latest_xray.sh"
    REBECCA_DATA_DIR="$DATA_DIR" XRAY_INSTALL_DIR="$DATA_DIR/xray-core" XRAY_ASSETS_DIR="$DATA_DIR/xray-core" bash "$APP_DIR/scripts/install_latest_xray.sh"
}

configure_binary_node_env() {
    mkdir -p "$DATA_DIR" "$APP_DIR"
    echo "$BRANCH" > "$BRANCH_FILE"

    if [ ! -s "$CERT_FILE" ]; then
        : > "$CERT_FILE"
        echo -e "Please paste the content of the Client Certificate, press ENTER on a new line when finished: "
        while IFS= read -r line; do
            if [[ -z $line ]]; then
                break
            fi
            echo "$line" >>"$CERT_FILE"
        done
        colorized_echo green "Certificate saved to $CERT_FILE"
    fi

    get_occupied_ports

    if ! grep -qE '^[[:space:]]*SERVICE_PORT[[:space:]]*=' "$ENV_FILE" 2>/dev/null; then
        while true; do
            read -p "Enter the SERVICE_PORT (default 62050): " -r SERVICE_PORT
            if [[ -z "$SERVICE_PORT" ]]; then
                SERVICE_PORT=62050
            fi
            if [[ "$SERVICE_PORT" -ge 1 && "$SERVICE_PORT" -le 65535 ]]; then
                if is_port_occupied "$SERVICE_PORT"; then
                    colorized_echo red "Port $SERVICE_PORT is already in use. Please enter another port."
                else
                    break
                fi
            else
                colorized_echo red "Invalid port. Please enter a port between 1 and 65535."
            fi
        done
        set_env_value "SERVICE_PORT" "$SERVICE_PORT"
    fi
    SERVICE_PORT="${SERVICE_PORT:-$(get_env_value "SERVICE_PORT")}"
    SERVICE_PORT="${SERVICE_PORT:-62050}"
    set_env_value "SERVICE_PORT" "$SERVICE_PORT"

    if ! grep -qE '^[[:space:]]*XRAY_API_PORT[[:space:]]*=' "$ENV_FILE" 2>/dev/null; then
        while true; do
            read -p "Enter the XRAY_API_PORT (default 62051): " -r XRAY_API_PORT
            if [[ -z "$XRAY_API_PORT" ]]; then
                XRAY_API_PORT=62051
            fi
            if [[ "$XRAY_API_PORT" -ge 1 && "$XRAY_API_PORT" -le 65535 ]]; then
                if is_port_occupied "$XRAY_API_PORT"; then
                    colorized_echo red "Port $XRAY_API_PORT is already in use. Please enter another port."
                elif [[ "$XRAY_API_PORT" -eq "$SERVICE_PORT" ]]; then
                    colorized_echo red "Port $XRAY_API_PORT cannot be the same as SERVICE_PORT. Please enter another port."
                else
                    break
                fi
            else
                colorized_echo red "Invalid port. Please enter a port between 1 and 65535."
            fi
        done
        set_env_value "XRAY_API_PORT" "$XRAY_API_PORT"
    fi
    XRAY_API_PORT="${XRAY_API_PORT:-$(get_env_value "XRAY_API_PORT")}"
    XRAY_API_PORT="${XRAY_API_PORT:-62051}"
    set_env_value "XRAY_API_PORT" "$XRAY_API_PORT"

    set_env_value "REBECCA_DATA_DIR" "$DATA_DIR"
    set_env_value "SSL_CLIENT_CERT_FILE" "$CERT_FILE"
    set_env_value "SSL_CERT_FILE" "$DATA_DIR/ssl_cert.pem"
    set_env_value "SSL_KEY_FILE" "$DATA_DIR/ssl_key.pem"
    set_env_value "XRAY_EXECUTABLE_PATH" "$DATA_DIR/xray-core/xray"
    set_env_value "XRAY_ASSETS_PATH" "$DATA_DIR/xray-core"
    set_env_value "SERVICE_PROTOCOL" "rest"
    persist_rebecca_node_service_env
}

install_binary_rebecca_node() {
    local node_version="$1"
    local configure="${2:-1}"
    local binary_arch
    local resolved_version
    local node_asset_url
    local service_asset_url
    local artifact_url
    local tmp_dir
    local package_path

    detect_os
    for package in curl jq unzip; do
        if ! command -v "$package" >/dev/null 2>&1; then
            install_package "$package"
        fi
    done

    binary_arch=$(detect_node_binary_arch)
    tmp_dir=$(mktemp -d)

    if [ "$node_version" = "dev" ]; then
        IFS='|' read -r resolved_version artifact_url < <(get_node_binary_dev_artifact_metadata "$binary_arch")
        package_path="$tmp_dir/rebecca-node-binaries.zip"
        colorized_echo blue "Downloading Rebecca-node binary dev artifact"
        curl -fL "$artifact_url" -o "$package_path"
        unzip -j -o "$package_path" -d "$tmp_dir" >/dev/null
    else
        IFS='|' read -r resolved_version node_asset_url service_asset_url < <(get_node_binary_release_asset_metadata "$node_version" "$binary_arch")
        colorized_echo blue "Downloading Rebecca-node binary release assets"
        curl -fL "$node_asset_url" -o "$tmp_dir/rebecca-node"
        curl -fL "$service_asset_url" -o "$tmp_dir/rebecca-node-service"
    fi

    if [ ! -f "$tmp_dir/rebecca-node" ] || [ ! -f "$tmp_dir/rebecca-node-service" ]; then
        colorized_echo red "Downloaded binary package is incomplete; rebecca-node or rebecca-node-service is missing." >&2
        rm -rf "$tmp_dir"
        exit 1
    fi

    mkdir -p "$BINARY_BIN_DIR" "$DATA_DIR" "$APP_DIR"
    install -m 755 "$tmp_dir/rebecca-node" "$BINARY_NODE"
    install -m 755 "$tmp_dir/rebecca-node-service" "$BINARY_NODE_SERVICE"

    if [ "$configure" = "1" ]; then
        configure_binary_node_env
        install_latest_xray_for_binary_node
    elif [ ! -x "$DATA_DIR/xray-core/xray" ]; then
        install_latest_xray_for_binary_node
    fi

    write_node_binary_release_metadata "${resolved_version:-$node_version}" "$binary_arch" "${artifact_url:-${node_asset_url:-}}"
    echo "binary" > "$INSTALL_MODE_FILE"
    create_binary_rebecca_node_service
    rm -rf "$tmp_dir"
    colorized_echo green "Rebecca-node binary files installed successfully"
}

cleanup_node_service_on_failure() {
    local exit_code=$?
    colorized_echo yellow "Maintenance service installation failed, continuing without service..."

    local unit_file="$NODE_SERVICE_UNIT"
    local legacy_file="/etc/systemd/system/rebecca-node-maint.service"
    local target_unit=""
    local target_file=""

    if [ -f "$unit_file" ]; then
        target_unit="$NODE_SERVICE_UNIT_NAME"
        target_file="$unit_file"
    elif [ -f "$legacy_file" ]; then
        target_unit="rebecca-node-maint.service"
        target_file="$legacy_file"
    fi

    if [ -n "$target_unit" ]; then
        systemctl disable --now "$target_unit" >/dev/null 2>&1 || true
        rm -f "$target_file"
        systemctl daemon-reload >/dev/null 2>&1 || true
    fi

    if [ "$NODE_SERVICE_DIR_CREATED" = "1" ]; then
        rm -rf "$NODE_SERVICE_DIR"
    fi

    # Don't exit, just return with error code
    return "$exit_code"
}

install_rebecca_node_service() {
    check_running_as_root

    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node '$APP_NAME' not installed at $APP_DIR"
        exit 1
    fi

    if is_binary_install; then
        install_rebecca_node_service_binary
        return
    fi

    colorized_echo blue "Installing Rebecca-node maintenance service for $APP_NAME"

    detect_os
    if ! command -v curl >/dev/null 2>&1; then
        install_package curl
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        install_package python3
    fi
    if ! command -v pip3 >/dev/null 2>&1 && ! command -v pip >/dev/null 2>&1; then
        install_package python3-pip || true
    fi

    if [ -d "$NODE_SERVICE_DIR" ]; then
        NODE_SERVICE_DIR_CREATED="0"
    else
        NODE_SERVICE_DIR_CREATED="1"
    fi
    mkdir -p "$NODE_SERVICE_DIR"

    local legacy_service="/etc/systemd/system/rebecca-node-maint.service"
    if [ -f "$legacy_service" ] && [ "$NODE_SERVICE_UNIT_NAME" != "rebecca-node-maint.service" ]; then
        systemctl disable --now rebecca-node-maint.service >/dev/null 2>&1 || true
        rm -f "$legacy_service"
    fi

    colorized_echo blue "Downloading node maintenance service from $NODE_SERVICE_SOURCE_URL"
    if ! curl -sSL "$NODE_SERVICE_SOURCE_URL" -o "$NODE_SERVICE_FILE"; then
        colorized_echo red "Failed to download service file from $NODE_SERVICE_SOURCE_URL"
        cleanup_node_service_on_failure
        return 1
    fi
    if head -n 1 "$NODE_SERVICE_FILE" | grep -qi "<!DOCTYPE\|<html"; then
        colorized_echo red "Downloaded service file is not valid Python"
        rm -f "$NODE_SERVICE_FILE"
        cleanup_node_service_on_failure
        return 1
    fi

    PYTHON3_BIN=$(command -v python3)
    if [ -z "$PYTHON3_BIN" ]; then
        colorized_echo red "python3 is required but was not found."
        cleanup_node_service_on_failure
        return 1
    fi

    local VENV_DIR="$NODE_SERVICE_DIR/venv"
    if [ -d "$VENV_DIR" ]; then
        rm -rf "$VENV_DIR"
    fi

    colorized_echo blue "Creating virtualenv at $VENV_DIR"
    if ! "$PYTHON3_BIN" -m venv "$VENV_DIR"; then
        colorized_echo yellow "venv creation failed, installing python-venv package..."
        ensure_python3_venv
        "$PYTHON3_BIN" -m venv "$VENV_DIR"
    fi

    PYTHON_BIN="$VENV_DIR/bin/python"

    trap 'cleanup_node_service_on_failure' ERR

    colorized_echo blue "Downloading requirements from $NODE_SERVICE_REQUIREMENTS_URL"
    if curl -sSL "$NODE_SERVICE_REQUIREMENTS_URL" -o "$NODE_SERVICE_REQUIREMENTS"; then
        if head -n 1 "$NODE_SERVICE_REQUIREMENTS" | grep -qi "<!DOCTYPE\\|<html"; then
            colorized_echo yellow "requirements.txt is HTML, using fallback packages"
            rm -f "$NODE_SERVICE_REQUIREMENTS"
        else
            colorized_echo green "Requirements file downloaded successfully"
        fi
    else
        colorized_echo yellow "Failed to download requirements.txt, using fallback packages"
        rm -f "$NODE_SERVICE_REQUIREMENTS"
    fi

    colorized_echo blue "Installing Python dependencies inside venv..."
    "$PYTHON_BIN" -m pip install --upgrade pip >/dev/null 2>&1 || true

    install_fallback_packages() {
        "$PYTHON_BIN" -m pip install --force-reinstall --no-cache-dir \
            'typing-extensions==4.12.2' \
            'pydantic-core==2.27.2' \
            'pydantic==2.10.5' \
            'fastapi==0.115.2' \
            'uvicorn[standard]==0.27.0.post1' \
            'PyYAML==6.0.2' \
            'python-multipart==0.0.9' \
            'email-validator==2.2.0'
    }

    if [ -f "$NODE_SERVICE_REQUIREMENTS" ]; then
        if ! "$PYTHON_BIN" -m pip install -r "$NODE_SERVICE_REQUIREMENTS" --force-reinstall --no-cache-dir; then
            colorized_echo yellow "Failed to install from requirements.txt, using fallback pinned packages"
            if ! install_fallback_packages; then
                colorized_echo red "Failed to install maintenance dependencies"
                cleanup_node_service_on_failure
                return 1
            fi
        fi
    else
        if ! install_fallback_packages; then
            colorized_echo red "Failed to install maintenance dependencies"
            cleanup_node_service_on_failure
            return 1
        fi
    fi

    ensure_node_script_port

    cat > "$NODE_SERVICE_UNIT" <<EOF
[Unit]
Description=Rebecca-node Maintenance API for $APP_NAME
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$NODE_SERVICE_DIR
Environment=REBECCA_NODE_APP_NAME=$APP_NAME
Environment=REBECCA_NODE_APP_DIR=$APP_DIR
Environment=REBECCA_NODE_DATA_DIR=$DATA_DIR
Environment=REBECCA_NODE_SCRIPT_PORT=$REBECCA_NODE_SCRIPT_PORT
Environment=REBECCA_NODE_SCRIPT_BIN=/usr/local/bin/$APP_NAME
ExecStart=$PYTHON_BIN $NODE_SERVICE_FILE
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    if ! systemctl enable --now "$NODE_SERVICE_UNIT_NAME" 2>/dev/null; then
        colorized_echo red "Failed to enable/start maintenance service"
        trap - ERR
        cleanup_node_service_on_failure
        return 1
    fi
    persist_rebecca_node_service_env
    trap - ERR
    colorized_echo green "Rebecca-node maintenance service installed and started for $APP_NAME"
    echo
    colorized_echo cyan "Service Information:"
    colorized_echo magenta "  Service name: $NODE_SERVICE_UNIT_NAME"
    colorized_echo magenta "  Service port: $REBECCA_NODE_SCRIPT_PORT"
    colorized_echo magenta "  Check status: systemctl status $NODE_SERVICE_UNIT_NAME"
    colorized_echo magenta "  View logs: journalctl -u $NODE_SERVICE_UNIT_NAME -f"
}

install_rebecca_node_service_binary() {
    if [ ! -x "$BINARY_NODE_SERVICE" ]; then
        colorized_echo red "Rebecca-node maintenance binary not found at $BINARY_NODE_SERVICE"
        colorized_echo yellow "Run '$APP_NAME install --binary' or '$APP_NAME update' first."
        exit 1
    fi

    ensure_node_script_port
    mkdir -p "$NODE_SERVICE_DIR"

    local legacy_service="/etc/systemd/system/rebecca-node-maint.service"
    if [ -f "$legacy_service" ] && [ "$NODE_SERVICE_UNIT_NAME" != "rebecca-node-maint.service" ]; then
        systemctl disable --now rebecca-node-maint.service >/dev/null 2>&1 || true
        rm -f "$legacy_service"
    fi

    cat > "$NODE_SERVICE_UNIT" <<EOF
[Unit]
Description=Rebecca-node Maintenance API for $APP_NAME
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=REBECCA_NODE_SCRIPT_HOST=127.0.0.1
Environment=REBECCA_NODE_SCRIPT_PORT=$REBECCA_NODE_SCRIPT_PORT
Environment=REBECCA_NODE_SCRIPT_BIN=/usr/local/bin/$APP_NAME
ExecStart=$BINARY_NODE_SERVICE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    if ! systemctl enable --now "$NODE_SERVICE_UNIT_NAME" 2>/dev/null; then
        colorized_echo red "Failed to enable/start maintenance service"
        return 1
    fi
    persist_rebecca_node_service_env
    colorized_echo green "Rebecca-node maintenance service installed and started for $APP_NAME"
}

update_rebecca_node_service() {
    check_running_as_root

    if is_binary_install; then
        install_rebecca_node_service_binary
        systemctl restart "$NODE_SERVICE_UNIT_NAME"
        colorized_echo green "Rebecca-node maintenance service updated for $APP_NAME"
        return
    fi

    if [ ! -d "$NODE_SERVICE_DIR" ]; then
        colorized_echo red "Maintenance service is not installed for $APP_NAME"
        exit 1
    fi

    detect_os
    if ! command -v curl >/dev/null 2>&1; then
        install_package curl
    fi

    colorized_echo blue "Updating node maintenance service for $APP_NAME"

    if ! curl -sSL "$NODE_SERVICE_SOURCE_URL" -o "$NODE_SERVICE_FILE"; then
        colorized_echo red "Failed to download service file from $NODE_SERVICE_SOURCE_URL"
        exit 1
    fi
    if head -n 1 "$NODE_SERVICE_FILE" | grep -qi "<!DOCTYPE\|<html"; then
        colorized_echo red "Downloaded service file is not valid Python"
        rm -f "$NODE_SERVICE_FILE"
        exit 1
    fi

    if curl -sSL "$NODE_SERVICE_REQUIREMENTS_URL" -o "$NODE_SERVICE_REQUIREMENTS"; then
        if head -n 1 "$NODE_SERVICE_REQUIREMENTS" | grep -qi "<!DOCTYPE\|<html"; then
            colorized_echo yellow "requirements.txt is HTML, keeping existing deps"
            rm -f "$NODE_SERVICE_REQUIREMENTS"
        fi
    else
        rm -f "$NODE_SERVICE_REQUIREMENTS"
    fi

    local VENV_DIR="$NODE_SERVICE_DIR/venv"
    PYTHON_BIN="$VENV_DIR/bin/python"
    PIP_BIN="$VENV_DIR/bin/pip"

    if [ ! -x "$PYTHON_BIN" ]; then
        colorized_echo yellow "Virtualenv missing, reinstalling maintenance service..."
        install_rebecca_node_service
        return
    fi

    "$PIP_BIN" install --upgrade pip >/dev/null 2>&1 || true

    if [ -f "$NODE_SERVICE_REQUIREMENTS" ]; then
        "$PIP_BIN" install -r "$NODE_SERVICE_REQUIREMENTS" --force-reinstall --no-cache-dir || true
    fi

    systemctl restart "$NODE_SERVICE_UNIT_NAME"
    colorized_echo green "Rebecca-node maintenance service updated for $APP_NAME"
}

uninstall_rebecca_node_service() {
    local target_unit=""
    local target_file=""
    if [ -f "$NODE_SERVICE_UNIT" ]; then
        target_unit="$NODE_SERVICE_UNIT_NAME"
        target_file="$NODE_SERVICE_UNIT"
    elif [ -f "/etc/systemd/system/rebecca-node-maint.service" ]; then
        target_unit="rebecca-node-maint.service"
        target_file="/etc/systemd/system/rebecca-node-maint.service"
    fi

    if [ -n "$target_unit" ]; then
        systemctl disable --now "$target_unit" >/dev/null 2>&1 || true
        rm -f "$target_file"
        systemctl daemon-reload
    fi
    if [ -d "$NODE_SERVICE_DIR" ]; then
        rm -rf "$NODE_SERVICE_DIR"
    fi
}

install_rebecca_node_script() {
    colorized_echo blue "Installing $APP_NAME script from $SCRIPT_URL"
    TARGET_PATH="/usr/local/bin/$APP_NAME"
    TEMP_SCRIPT=$(mktemp)
    if ! curl -fsSL "$SCRIPT_URL" -o "$TEMP_SCRIPT"; then
        colorized_echo red "Failed to download script from $SCRIPT_URL"
        rm -f "$TEMP_SCRIPT"
        exit 1
    fi
    if head -n 1 "$TEMP_SCRIPT" | grep -qi "<!DOCTYPE"; then
        colorized_echo red "Unexpected HTML response while downloading script"
        rm -f "$TEMP_SCRIPT"
        exit 1
    fi
    install -m 755 "$TEMP_SCRIPT" "$TARGET_PATH"
    rm -f "$TEMP_SCRIPT"
    colorized_echo green "$APP_NAME script installed at $TARGET_PATH"
}

# Get a list of occupied ports
get_occupied_ports() {
    if command -v ss &>/dev/null; then
        OCCUPIED_PORTS=$(ss -tuln | awk '{print $5}' | grep -Eo '[0-9]+$' | sort | uniq)
    elif command -v netstat &>/dev/null; then
        OCCUPIED_PORTS=$(netstat -tuln | awk '{print $4}' | grep -Eo '[0-9]+$' | sort | uniq)
    else
        colorized_echo yellow "Neither ss nor netstat found. Attempting to install net-tools."
        detect_os
        install_package net-tools
        if command -v netstat &>/dev/null; then
            OCCUPIED_PORTS=$(netstat -tuln | awk '{print $4}' | grep -Eo '[0-9]+$' | sort | uniq)
        else
            colorized_echo red "Failed to install net-tools. Please install it manually."
            exit 1
        fi
    fi
}

# Function to check if a port is occupied
is_port_occupied() {
    if echo "$OCCUPIED_PORTS" | grep -q -w "$1"; then
        return 0
    else
        return 1
    fi
}

ensure_node_script_port() {
    local saved_port
    local start_port

    saved_port=$(get_env_value "REBECCA_NODE_SCRIPT_PORT")
    if [ -n "$saved_port" ] && { [ -z "${REBECCA_NODE_SCRIPT_PORT:-}" ] || [ "$REBECCA_NODE_SCRIPT_PORT" = "3100" ]; }; then
        REBECCA_NODE_SCRIPT_PORT="$saved_port"
    fi
    start_port="${REBECCA_NODE_SCRIPT_PORT:-3100}"

    if [ -f "$NODE_SERVICE_UNIT" ] && systemctl is-active --quiet "$NODE_SERVICE_UNIT_NAME" 2>/dev/null; then
        REBECCA_NODE_SCRIPT_PORT="$start_port"
        return
    fi

    get_occupied_ports

    local candidate_port="$start_port"
    while is_port_occupied "$candidate_port"; do
        candidate_port=$((candidate_port + 1))
    done

    if [ "$candidate_port" != "$start_port" ]; then
        colorized_echo yellow "Port $start_port is in use; using $candidate_port for maintenance API"
    fi

    REBECCA_NODE_SCRIPT_PORT="$candidate_port"
}

install_rebecca_node() {
    # Fetch releases
    mkdir -p "$DATA_DIR"
    mkdir -p "$APP_DIR"
    mkdir -p "$DATA_MAIN_DIR"
    echo "$BRANCH" > "$BRANCH_FILE"
    
    # Проверка на существование файла перед его очисткой
    if [ -f "$CERT_FILE" ]; then
        >"$CERT_FILE"
    fi
    
    # Function to print information to the user
    print_info() {
        echo -e "\033[1;34m$1\033[0m"
    }
    
    # Prompt the user to input the certificate
    echo -e "Please paste the content of the Client Certificate, press ENTER on a new line when finished: "
    
    while IFS= read -r line; do
        if [[ -z $line ]]; then
            break
        fi
        echo "$line" >>"$CERT_FILE"
    done

    print_info "Certificate saved to $CERT_FILE"

    SERVICE_PROTOCOL_VALUE="rest"
    echo
    colorized_echo blue "Service protocol set to REST (auto-selected)"

    get_occupied_ports

    # Prompt the user to enter ports with occupation check
    while true; do
        read -p "Enter the SERVICE_PORT (default 62050): " -r SERVICE_PORT
        if [[ -z "$SERVICE_PORT" ]]; then
            SERVICE_PORT=62050
        fi
        if [[ "$SERVICE_PORT" -ge 1 && "$SERVICE_PORT" -le 65535 ]]; then
            if is_port_occupied "$SERVICE_PORT"; then
                colorized_echo red "Port $SERVICE_PORT is already in use. Please enter another port."
            else
                break
            fi
        else
            colorized_echo red "Invalid port. Please enter a port between 1 and 65535."
        fi
    done
    
    while true; do
        read -p "Enter the XRAY_API_PORT (default 62051): " -r XRAY_API_PORT
        if [[ -z "$XRAY_API_PORT" ]]; then
            XRAY_API_PORT=62051
        fi
        if [[ "$XRAY_API_PORT" -ge 1 && "$XRAY_API_PORT" -le 65535 ]]; then
            if is_port_occupied "$XRAY_API_PORT"; then
                colorized_echo red "Port $XRAY_API_PORT is already in use. Please enter another port."
            elif [[ "$XRAY_API_PORT" -eq "$SERVICE_PORT" ]]; then
                colorized_echo red "Port $XRAY_API_PORT cannot be the same as SERVICE_PORT. Please enter another port."
            else
                break
            fi
        else
            colorized_echo red "Invalid port. Please enter a port between 1 and 65535."
        fi
    done
    
    colorized_echo blue "Generating compose file"
    
    # Write content to the file
    cat > "$COMPOSE_FILE" <<EOL
services:
  rebecca-node:
    container_name: $APP_NAME
    image: $DOCKER_IMAGE
    restart: always
    network_mode: host
    environment:
      REBECCA_DATA_DIR: "/var/lib/rebecca-node"
      SSL_CLIENT_CERT_FILE: "/var/lib/rebecca-node/cert.pem"
      SERVICE_PORT: "$SERVICE_PORT"
      XRAY_API_PORT: "$XRAY_API_PORT"
      SERVICE_PROTOCOL: "$SERVICE_PROTOCOL_VALUE"

    volumes:
      - $DATA_DIR:/var/lib/marzban-node
      - $DATA_DIR:/var/lib/rebecca-node
EOL
    colorized_echo green "File saved in $APP_DIR/docker-compose.yml"
}


uninstall_rebecca_node_script() {
    if [ -f "/usr/local/bin/$APP_NAME" ]; then
        colorized_echo yellow "Removing rebecca-node script"
        rm "/usr/local/bin/$APP_NAME"
    fi
}

uninstall_rebecca_node() {
    if [ -f "$BINARY_SERVICE_UNIT" ]; then
        systemctl disable --now "$APP_NAME.service" >/dev/null 2>&1 || true
        rm -f "$BINARY_SERVICE_UNIT"
        systemctl daemon-reload
    fi
    if [ -d "$APP_DIR" ]; then
        colorized_echo yellow "Removing directory: $APP_DIR"
        rm -r "$APP_DIR"
    fi
}

uninstall_rebecca_node_docker_images() {
    images=$(docker images | grep rebecca-node | awk '{print $3}')
    
    if [ -n "$images" ]; then
        colorized_echo yellow "Removing Docker images of Rebecca-node"
        for image in $images; do
            if docker rmi "$image" >/dev/null 2>&1; then
                colorized_echo yellow "Image $image removed"
            fi
        done
    fi
}

uninstall_rebecca_node_data_files() {
    if [ -d "$DATA_DIR" ]; then
        colorized_echo yellow "Removing directory: $DATA_DIR"
        rm -r "$DATA_DIR"
    fi
}

up_rebecca_node() {
    if is_binary_install; then
        systemctl enable --now "$APP_NAME.service"
        return
    fi
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" up -d --remove-orphans
}

down_rebecca_node() {
    if is_binary_install; then
        systemctl stop "$APP_NAME.service"
        return
    fi
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" down
}

show_rebecca_node_logs() {
    if is_binary_install; then
        journalctl -u "$APP_NAME.service" --no-pager
        return
    fi
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" logs
}

follow_rebecca_node_logs() {
    if is_binary_install; then
        journalctl -u "$APP_NAME.service" -f
        return
    fi
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" logs -f
}

update_rebecca_node_script() {
    colorized_echo blue "Updating $APP_NAME script from $SCRIPT_URL"
    install_rebecca_node_script
}

update_rebecca_node() {
    local requested_version="${1:-}"
    if is_binary_install; then
        local node_version="${requested_version:-latest}"
        if [ -z "$requested_version" ] && [ "$BRANCH" = "dev" ]; then
            node_version="dev"
        fi
        install_binary_rebecca_node "$node_version" "0"
        return
    fi

    if [ -n "$requested_version" ]; then
        case "$requested_version" in
            dev)
                set_branch_variables dev
            ;;
            latest|"")
                set_branch_variables master
            ;;
            *)
                set_branch_variables master
                DOCKER_IMAGE="rebeccapanel/rebecca-node:${requested_version}"
            ;;
        esac
        echo "$BRANCH" > "$BRANCH_FILE"
        if [ -f "$COMPOSE_FILE" ]; then
            sed -i "s|^[[:space:]]*image:.*rebeccapanel/rebecca-node.*|    image: $DOCKER_IMAGE|" "$COMPOSE_FILE"
        fi
    fi
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" pull
}

is_rebecca_node_installed() {
    if [ -d "$APP_DIR" ]; then
        return 0
    else
        return 1
    fi
}

is_rebecca_node_up() {
    if is_binary_install; then
        systemctl is-active --quiet "$APP_NAME.service"
        return
    fi
    if [ -z "$($COMPOSE -f $COMPOSE_FILE ps -q -a)" ]; then
        return 1
    else
        return 0
    fi
}

install_command() {
    check_running_as_root
    local install_mode
    local node_version

    # Check if rebecca is already installed
    if is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node is already installed at $APP_DIR"
        read -p "Do you want to override the previous installation? (y/n) "
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            colorized_echo red "Aborted installation"
            exit 1
        fi
    fi
    install_mode=$(select_install_mode "$INSTALL_MODE_REQUESTED")
    if [ "$NODE_VERSION_SET" -eq 1 ]; then
        node_version="$NODE_VERSION_REQUESTED"
    else
        node_version=$(select_node_version "" "$install_mode")
    fi
    case "$node_version" in
        dev)
            set_branch_variables dev
        ;;
        latest|"")
            set_branch_variables master
            node_version="latest"
        ;;
        *)
            set_branch_variables master
        ;;
    esac
    colorized_echo blue "Selected install mode: $install_mode"
    colorized_echo blue "Selected release channel: $node_version"

    detect_os
    if ! command -v jq >/dev/null 2>&1; then
        install_package jq
    fi
    if ! command -v curl >/dev/null 2>&1; then
        install_package curl
    fi
    if [ "$install_mode" = "docker" ]; then
        if ! command -v docker >/dev/null 2>&1; then
            install_docker
        fi
        detect_compose
    fi
    install_rebecca_node_script
    if [ "$install_mode" = "binary" ]; then
        install_binary_rebecca_node "$node_version" "1"
    else
        install_rebecca_node
        echo "docker" > "$INSTALL_MODE_FILE"
    fi
    set +e
    install_rebecca_node_service
    service_status=$?
    set -e
    if [ "$service_status" -ne 0 ]; then
        colorized_echo yellow "Warning: Maintenance service installation failed, but node installation will continue."
        colorized_echo yellow "You can install the service later with: $APP_NAME install-service"
    fi
    up_rebecca_node
    follow_rebecca_node_logs
    SERVICE_PORT="${SERVICE_PORT:-$(get_env_value "SERVICE_PORT")}"
    XRAY_API_PORT="${XRAY_API_PORT:-$(get_env_value "XRAY_API_PORT")}"
    echo "Use your IP: $NODE_IP and defaults ports: $SERVICE_PORT and $XRAY_API_PORT to setup your Rebecca Main Panel"
}

uninstall_command() {
    check_running_as_root
    local install_mode
    install_mode=$(get_install_mode)
    local node_exists=0
    if is_rebecca_node_installed; then
        node_exists=1
    fi

    local service_exists=0
    if [ -f "$NODE_SERVICE_UNIT" ] || [ -f "$BINARY_SERVICE_UNIT" ] || [ -f "/etc/systemd/system/rebecca-node-maint.service" ]; then
        service_exists=1
    fi

    if [ "$node_exists" -eq 0 ] && [ "$service_exists" -eq 0 ]; then
        colorized_echo red "Rebecca-node not installed!"
        exit 1
    fi

    read -p "Do you really want to uninstall Rebecca-node? (y/n) "
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        colorized_echo red "Aborted"
        exit 1
    fi

    if [ "$node_exists" -eq 1 ]; then
        if [ "$install_mode" != "binary" ]; then
            detect_compose
        fi
        if is_rebecca_node_up; then
            down_rebecca_node
        fi
    fi

    uninstall_rebecca_node_service
    uninstall_rebecca_node_script

    if [ "$node_exists" -eq 1 ]; then
        uninstall_rebecca_node
        if [ "$install_mode" != "binary" ]; then
            uninstall_rebecca_node_docker_images
        fi

        read -p "Do you want to remove Rebecca-node data files too ($DATA_DIR)? (y/n) "
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            colorized_echo green "Rebecca-node uninstalled successfully"
        else
            uninstall_rebecca_node_data_files
            colorized_echo green "Rebecca-node uninstalled successfully"
        fi
    else
        colorized_echo green "Rebecca-node service/scripts removed"
    fi
}

up_command() {
    help() {
        colorized_echo red "Usage: rebecca-node up [options]"
        echo ""
        echo "OPTIONS:"
        echo "  -h, --help        display this help message"
        echo "  -n, --no-logs     do not follow logs after starting"
    }
    
    local no_logs=false
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -n|--no-logs)
                no_logs=true
            ;;
            -h|--help)
                help
                exit 0
            ;;
            *)
                echo "Error: Invalid option: $1" >&2
                help
                exit 0
            ;;
        esac
        shift
    done
    
    # Check if rebecca-node is installed
    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if is_rebecca_node_up; then
        colorized_echo red "Rebecca-node's already up"
        exit 1
    fi
    
    up_rebecca_node
    if [ "$no_logs" = false ]; then
        follow_rebecca_node_logs
    fi
}

down_command() {
    # Check if rebecca-node is installed
    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_node_up; then
        colorized_echo red "Rebecca-node already down"
        exit 1
    fi
    
    down_rebecca_node
}

restart_command() {
    help() {
        colorized_echo red "Usage: rebecca-node restart [options]"
        echo
        echo "OPTIONS:"
        echo "  -h, --help        display this help message"
        echo "  -n, --no-logs     do not follow logs after starting"
    }
    
    local no_logs=false
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -n|--no-logs)
                no_logs=true
            ;;
            -h|--help)
                help
                exit 0
            ;;
            *)
                echo "Error: Invalid option: $1" >&2
                help
                exit 0
            ;;
        esac
        shift
    done
    
    # Check if rebecca-node is installed
    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    down_rebecca_node
    up_rebecca_node
    
}

status_command() {
    # Check if rebecca-node is installed
    if ! is_rebecca_node_installed; then
        echo -n "Status: "
        colorized_echo red "Not Installed"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_node_up; then
        echo -n "Status: "
        colorized_echo blue "Down"
        exit 1
    fi
    
    echo -n "Status: "
    colorized_echo green "Up"
    
    if is_binary_install; then
        systemctl status "$APP_NAME.service" --no-pager
        return
    fi

    json=$($COMPOSE -f $COMPOSE_FILE ps -a --format=json)
    services=$(echo "$json" | jq -r 'if type == "array" then .[] else . end | .Service')
    states=$(echo "$json" | jq -r 'if type == "array" then .[] else . end | .State')
    # Print out the service names and statuses
    for i in $(seq 0 $(expr $(echo $services | wc -w) - 1)); do
        service=$(echo $services | cut -d' ' -f $(expr $i + 1))
        state=$(echo $states | cut -d' ' -f $(expr $i + 1))
        echo -n "- $service: "
        if [ "$state" == "running" ]; then
            colorized_echo green $state
        else
            colorized_echo red $state
        fi
    done
}

logs_command() {
    help() {
        colorized_echo red "Usage: rebecca-node logs [options]"
        echo ""
        echo "OPTIONS:"
        echo "  -h, --help        display this help message"
        echo "  -n, --no-follow   do not show follow logs"
    }
    
    local no_follow=false
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -n|--no-follow)
                no_follow=true
            ;;
            -h|--help)
                help
                exit 0
            ;;
            *)
                echo "Error: Invalid option: $1" >&2
                help
                exit 0
            ;;
        esac
        shift
    done
    
    # Check if rebecca is installed
    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_node_up; then
        colorized_echo red "Rebecca-node is not up."
        exit 1
    fi
    
    if [ "$no_follow" = true ]; then
        show_rebecca_node_logs
    else
        follow_rebecca_node_logs
    fi
}

update_command() {
    check_running_as_root
    local node_version=""

    if ! is_rebecca_node_installed; then
        colorized_echo red "Rebecca-node not installed!"
        exit 1
    fi

    if [ "$NODE_VERSION_SET" -eq 1 ]; then
        node_version="${NODE_VERSION_REQUESTED:-latest}"
        case "$node_version" in
            dev)
                set_branch_variables dev
            ;;
            latest|"")
                set_branch_variables master
                node_version="latest"
            ;;
            *)
                set_branch_variables master
                DOCKER_IMAGE="rebeccapanel/rebecca-node:${node_version}"
            ;;
        esac
        echo "$BRANCH" > "$BRANCH_FILE"
    fi

    if ! is_binary_install; then
        detect_compose
    fi

    update_rebecca_node_script

    local skip_service_update="$SKIP_SERVICE_UPDATE"
    if [ "${REBECCA_NODE_SKIP_SERVICE_UPDATE:-0}" = "1" ]; then
        skip_service_update=1
    fi

    local unit
    unit=$(resolve_node_service_unit_name)
    if [ "$skip_service_update" -eq 1 ]; then
        colorized_echo yellow "Skipping maintenance service self-update for this run"
    elif [ -n "$unit" ] && ! is_binary_install; then
        update_rebecca_node_service
    fi

    if is_binary_install; then
        colorized_echo blue "Updating Rebecca-node binary files"
    else
        colorized_echo blue "Pulling node image $DOCKER_IMAGE"
    fi
    update_rebecca_node "$node_version"
    if is_binary_install && [ "$skip_service_update" -ne 1 ]; then
        update_rebecca_node_service
    fi

    colorized_echo blue "Restarting Rebecca-node services"
    down_rebecca_node
    up_rebecca_node

    colorized_echo blue "Rebecca-node updated successfully"
}

identify_the_operating_system_and_architecture() {
    if [[ "$(uname)" == 'Linux' ]]; then
        case "$(uname -m)" in
            'i386' | 'i686')
                ARCH='32'
            ;;
            'amd64' | 'x86_64')
                ARCH='64'
            ;;
            'armv5tel')
                ARCH='arm32-v5'
            ;;
            'armv6l')
                ARCH='arm32-v6'
                grep Features /proc/cpuinfo | grep -qw 'vfp' || ARCH='arm32-v5'
            ;;
            'armv7' | 'armv7l')
                ARCH='arm32-v7a'
                grep Features /proc/cpuinfo | grep -qw 'vfp' || ARCH='arm32-v5'
            ;;
            'armv8' | 'aarch64')
                ARCH='arm64-v8a'
            ;;
            'mips')
                ARCH='mips32'
            ;;
            'mipsle')
                ARCH='mips32le'
            ;;
            'mips64')
                ARCH='mips64'
                lscpu | grep -q "Little Endian" && ARCH='mips64le'
            ;;
            'mips64le')
                ARCH='mips64le'
            ;;
            'ppc64')
                ARCH='ppc64'
            ;;
            'ppc64le')
                ARCH='ppc64le'
            ;;
            'riscv64')
                ARCH='riscv64'
            ;;
            's390x')
                ARCH='s390x'
            ;;
            *)
                echo "error: The architecture is not supported."
                exit 1
            ;;
        esac
    else
        echo "error: This operating system is not supported."
        exit 1
    fi
}

# Function to update the Xray core
get_xray_core() {
    identify_the_operating_system_and_architecture
    clear
    
    
    validate_version() {
        local version="$1"
        
        local response=$(curl -s "https://api.github.com/repos/XTLS/Xray-core/releases/tags/$version")
        if echo "$response" | grep -q '"message": "Not Found"'; then
            echo "invalid"
        else
            echo "valid"
        fi
    }
    
    
    print_menu() {
        clear
        echo -e "\033[1;32m==============================\033[0m"
        echo -e "\033[1;32m      Xray-core Installer     \033[0m"
        echo -e "\033[1;32m==============================\033[0m"
       current_version=$(get_current_xray_core_version)
        echo -e "\033[1;33m>>>> Current Xray-core version: \033[1;1m$current_version\033[0m"
        echo -e "\033[1;32m==============================\033[0m"
        echo -e "\033[1;33mAvailable Xray-core versions:\033[0m"
        for ((i=0; i<${#versions[@]}; i++)); do
            echo -e "\033[1;34m$((i + 1)):\033[0m ${versions[i]}"
        done
        echo -e "\033[1;32m==============================\033[0m"
        echo -e "\033[1;35mM:\033[0m Enter a version manually"
        echo -e "\033[1;31mQ:\033[0m Quit"
        echo -e "\033[1;32m==============================\033[0m"
    }
    
    
    latest_releases=$(curl -s "https://api.github.com/repos/XTLS/Xray-core/releases?per_page=$LAST_XRAY_CORES")
    
    
    versions=($(echo "$latest_releases" | grep -oP '"tag_name": "\K(.*?)(?=")'))
    
    while true; do
        print_menu
        read -p "Choose a version to install (1-${#versions[@]}), or press M to enter manually, Q to quit: " choice
        
        if [[ "$choice" =~ ^[1-9][0-9]*$ ]] && [ "$choice" -le "${#versions[@]}" ]; then
            
            choice=$((choice - 1))
            
            selected_version=${versions[choice]}
            break
            elif [ "$choice" == "M" ] || [ "$choice" == "m" ]; then
            while true; do
                read -p "Enter the version manually (e.g., v1.2.3): " custom_version
                if [ "$(validate_version "$custom_version")" == "valid" ]; then
                    selected_version="$custom_version"
                    break 2
                else
                    echo -e "\033[1;31mInvalid version or version does not exist. Please try again.\033[0m"
                fi
            done
            elif [ "$choice" == "Q" ] || [ "$choice" == "q" ]; then
            echo -e "\033[1;31mExiting.\033[0m"
            exit 0
        else
            echo -e "\033[1;31mInvalid choice. Please try again.\033[0m"
            sleep 2
        fi
    done
    
    echo -e "\033[1;32mSelected version $selected_version for installation.\033[0m"
    
    
if ! dpkg -s unzip >/dev/null 2>&1; then
    echo -e "\033[1;33mInstalling required packages...\033[0m"
    detect_os
    install_package unzip
fi

    
    
    mkdir -p $DATA_MAIN_DIR/xray-core
    cd $DATA_MAIN_DIR/xray-core
    
    
    
    xray_filename="Xray-linux-$ARCH.zip"
    xray_download_url="https://github.com/XTLS/Xray-core/releases/download/${selected_version}/${xray_filename}"
    
    echo -e "\033[1;33mDownloading Xray-core version ${selected_version} in the background...\033[0m"
    wget "${xray_download_url}" -q &
    wait
    
    
    echo -e "\033[1;33mExtracting Xray-core in the background...\033[0m"
    unzip -o "${xray_filename}" >/dev/null 2>&1 &
    wait
    rm "${xray_filename}"
}
get_current_xray_core_version() {
    XRAY_BINARY="$DATA_MAIN_DIR/xray-core/xray"
    if [ -f "$XRAY_BINARY" ]; then
        version_output=$("$XRAY_BINARY" -version 2>/dev/null)
        if [ $? -eq 0 ]; then
            version=$(echo "$version_output" | head -n1 | awk '{print $2}')
            echo "$version"
            return
        fi
    fi

    # If local binary is not found or failed, check in the Docker container
    CONTAINER_NAME="$APP_NAME"
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
        version_output=$(docker exec "$CONTAINER_NAME" xray -version 2>/dev/null)
        if [ $? -eq 0 ]; then
            # Extract the version number from the first line
            version=$(echo "$version_output" | head -n1 | awk '{print $2}')
            echo "$version (in container)"
            return
        fi
    fi

    echo "Not installed"
}

install_yq() {
    if command -v yq &>/dev/null; then
        colorized_echo green "yq is already installed."
        return
    fi

    identify_the_operating_system_and_architecture

    local base_url="https://github.com/mikefarah/yq/releases/latest/download"
    local yq_binary=""

    case "$ARCH" in
        '64' | 'x86_64')
            yq_binary="yq_linux_amd64"
            ;;
        'arm32-v7a' | 'arm32-v6' | 'arm32-v5' | 'armv7l')
            yq_binary="yq_linux_arm"
            ;;
        'arm64-v8a' | 'aarch64')
            yq_binary="yq_linux_arm64"
            ;;
        '32' | 'i386' | 'i686')
            yq_binary="yq_linux_386"
            ;;
        *)
            colorized_echo red "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    local yq_url="${base_url}/${yq_binary}"
    colorized_echo blue "Downloading yq from ${yq_url}..."

    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        colorized_echo yellow "Neither curl nor wget is installed. Attempting to install curl."
        install_package curl || {
            colorized_echo red "Failed to install curl. Please install curl or wget manually."
            exit 1
        }
    fi


    if command -v curl &>/dev/null; then
        if curl -L "$yq_url" -o /usr/local/bin/yq; then
            chmod +x /usr/local/bin/yq
            colorized_echo green "yq installed successfully!"
        else
            colorized_echo red "Failed to download yq using curl. Please check your internet connection."
            exit 1
        fi
    elif command -v wget &>/dev/null; then
        if wget -O /usr/local/bin/yq "$yq_url"; then
            chmod +x /usr/local/bin/yq
            colorized_echo green "yq installed successfully!"
        else
            colorized_echo red "Failed to download yq using wget. Please check your internet connection."
            exit 1
        fi
    fi


    if ! echo "$PATH" | grep -q "/usr/local/bin"; then
        export PATH="/usr/local/bin:$PATH"
    fi


    hash -r

    if command -v yq &>/dev/null; then
        colorized_echo green "yq is ready to use."
    elif [ -x "/usr/local/bin/yq" ]; then

        colorized_echo yellow "yq is installed at /usr/local/bin/yq but not found in PATH."
        colorized_echo yellow "You can add /usr/local/bin to your PATH environment variable."
    else
        colorized_echo red "yq installation failed. Please try again or install manually."
        exit 1
    fi
}



update_core_command() {
    check_running_as_root
    get_xray_core

    if is_binary_install; then
        set_env_value "XRAY_EXECUTABLE_PATH" "$DATA_MAIN_DIR/xray-core/xray"
        set_env_value "XRAY_ASSETS_PATH" "$DATA_MAIN_DIR/xray-core"
        colorized_echo red "Restarting Rebecca-node..."
        systemctl restart "$APP_NAME.service"
        colorized_echo blue "Installation of XRAY-CORE version $selected_version completed."
        return
    fi

    if ! command -v yq &>/dev/null; then
        echo "yq is not installed. Installing yq..."
        install_yq
    fi

    if ! grep -q 'XRAY_EXECUTABLE_PATH: "/var/lib/rebecca-node/xray-core/xray"' "$COMPOSE_FILE"; then
        yq eval '.services."rebecca-node".environment.XRAY_EXECUTABLE_PATH = "/var/lib/rebecca-node/xray-core/xray"' -i "$COMPOSE_FILE"
    fi

    if ! yq eval ".services.\"rebecca-node\".volumes[] | select(. == \"${DATA_MAIN_DIR}:/var/lib/rebecca-node\")" "$COMPOSE_FILE" &>/dev/null; then
        yq eval ".services.\"rebecca-node\".volumes += \"${DATA_MAIN_DIR}:/var/lib/rebecca-node\"" -i "$COMPOSE_FILE"
    fi
    
    # Restart Rebecca-node
    colorized_echo red "Restarting Rebecca-node..."
    $APP_NAME restart -n
    colorized_echo blue "Installation of XRAY-CORE version $selected_version completed."
}


check_editor() {
    if [ -z "$EDITOR" ]; then
        if command -v nano >/dev/null 2>&1; then
            EDITOR="nano"
            elif command -v vi >/dev/null 2>&1; then
            EDITOR="vi"
        else
            detect_os
            install_package nano
            EDITOR="nano"
        fi
    fi
}


edit_command() {
    detect_os
    check_editor
    if is_binary_install; then
        ensure_env_file
        $EDITOR "$ENV_FILE"
        return
    fi
    if [ -f "$COMPOSE_FILE" ]; then
        $EDITOR "$COMPOSE_FILE"
    else
        colorized_echo red "Compose file not found at $COMPOSE_FILE"
        exit 1
    fi
}

service_status_command() {
    local unit_file="$NODE_SERVICE_UNIT"
    local fallback_file="/etc/systemd/system/rebecca-node-maint.service"
    local target_unit
    target_unit=$(resolve_node_service_unit_name)

    if [ "$target_unit" = "$NODE_SERVICE_UNIT_NAME" ] && [ ! -f "$unit_file" ]; then
        target_unit=""
    fi
    if [ -z "$target_unit" ] && [ -f "$fallback_file" ]; then
        target_unit="rebecca-node-maint.service"
    fi

    if [ -z "$target_unit" ]; then
        colorized_echo red "Rebecca-node maintenance service is not installed"
        colorized_echo yellow "Install it with: $APP_NAME service-install"
        exit 1
    fi

    colorized_echo blue "================================"
    colorized_echo cyan "Rebecca-node Maintenance Service Status"
    colorized_echo blue "================================"
    systemctl status "$target_unit" --no-pager
}

service_logs_command() {
    local unit
    unit=$(resolve_node_service_unit_name)
    local unit_file="$NODE_SERVICE_UNIT"
    local fallback_file="/etc/systemd/system/rebecca-node-maint.service"
    if [ "$unit" = "$NODE_SERVICE_UNIT_NAME" ] && [ ! -f "$unit_file" ]; then
        unit=""
    fi
    if [ -z "$unit" ] && [ -f "$fallback_file" ]; then
        unit="rebecca-node-maint.service"
    fi

    if [ -z "$unit" ]; then
        colorized_echo red "Rebecca-node maintenance service is not installed"
        colorized_echo yellow "Install it with: $APP_NAME service-install"
        exit 1
    fi

    colorized_echo blue "Showing Rebecca-node maintenance service logs (Ctrl+C to exit)..."
    journalctl -u "$unit" -f
}


usage() {
    colorized_echo blue "================================"
    colorized_echo magenta "       $APP_NAME Node CLI Help"
    colorized_echo blue "================================"
    colorized_echo cyan "Usage:"
    echo "  $APP_NAME [command]"
    echo

    colorized_echo cyan "Commands:"
    colorized_echo yellow "  up              $(tput sgr0)– Start services"
    colorized_echo yellow "  down            $(tput sgr0)– Stop services"
    colorized_echo yellow "  restart         $(tput sgr0)– Restart services"
    colorized_echo yellow "  status          $(tput sgr0)– Show status"
    colorized_echo yellow "  logs            $(tput sgr0)– Show logs"
    colorized_echo yellow "  install         $(tput sgr0)- Install/reinstall Rebecca-node"
    colorized_echo green "  service-install $(tput sgr0)- Install maintenance service"
    colorized_echo green "  service-update  $(tput sgr0)- Update maintenance service"
    colorized_echo green "  service-status  $(tput sgr0)- Show maintenance service status"
    colorized_echo green "  service-logs    $(tput sgr0)- Show maintenance service logs"
    colorized_echo green "  service-uninstall $(tput sgr0)- Uninstall maintenance service"
    colorized_echo yellow "  update          $(tput sgr0)- Update to latest/dev or a specific version"
    colorized_echo yellow "  uninstall       $(tput sgr0)- Uninstall Rebecca-node"
    colorized_echo blue "  script-install  $(tput sgr0)- Install Rebecca-node script"
    colorized_echo blue "  script-update   $(tput sgr0)- Update Rebecca-node CLI script"
    colorized_echo blue "  script-uninstall  $(tput sgr0)- Uninstall Rebecca-node script"
    colorized_echo yellow "  edit            $(tput sgr0)- Edit docker-compose.yml or binary .env (via nano or vi)"
    colorized_echo yellow "  core-update     $(tput sgr0)– Update/Change Xray core"
    
    echo
    colorized_echo cyan "Node Information:"
    colorized_echo magenta "  Cert file path: $CERT_FILE"
    colorized_echo magenta "  Node IP: $NODE_IP"
    echo
    colorized_echo cyan "Install/update options:"
    colorized_echo magenta "  --mode docker|binary, --binary, --docker"
    colorized_echo magenta "  --dev or --version vX.Y.Z"
    echo
    current_version=$(get_current_xray_core_version)
    colorized_echo cyan "Current Xray-core version: " 1  # 1 for bold
    colorized_echo magenta "$current_version" 1
    echo
    DEFAULT_SERVICE_PORT="62050"
    DEFAULT_XRAY_API_PORT="62051"
    
    if [ -f "$COMPOSE_FILE" ]; then
        SERVICE_PORT=$(awk -F': ' '/SERVICE_PORT:/ {gsub(/"/, "", $2); print $2}' "$COMPOSE_FILE")
        XRAY_API_PORT=$(awk -F': ' '/XRAY_API_PORT:/ {gsub(/"/, "", $2); print $2}' "$COMPOSE_FILE")
    elif [ -f "$ENV_FILE" ]; then
        SERVICE_PORT=$(get_env_value "SERVICE_PORT")
        XRAY_API_PORT=$(get_env_value "XRAY_API_PORT")
    fi
    
    SERVICE_PORT=${SERVICE_PORT:-$DEFAULT_SERVICE_PORT}
    XRAY_API_PORT=${XRAY_API_PORT:-$DEFAULT_XRAY_API_PORT}

    colorized_echo cyan "Ports:"
    colorized_echo magenta "  Service port: $SERVICE_PORT"
    colorized_echo magenta "  API port: $XRAY_API_PORT"
    
    # Check maintenance service status
    local summary_unit=""
    if [ -f "$NODE_SERVICE_UNIT" ]; then
        summary_unit="$NODE_SERVICE_UNIT_NAME"
    elif [ -f "/etc/systemd/system/rebecca-node-maint.service" ]; then
        summary_unit="rebecca-node-maint.service"
    fi

    if [ -n "$summary_unit" ]; then
        echo
        colorized_echo cyan "Maintenance Service:"
        if systemctl is-active --quiet "$summary_unit"; then
            colorized_echo green "  Status: Active (running)"
        else
            colorized_echo red "  Status: Inactive"
        fi
        colorized_echo magenta "  Service: $summary_unit"
        colorized_echo magenta "  Port: $REBECCA_NODE_SCRIPT_PORT"
        colorized_echo magenta "  Check status: $APP_NAME service-status"
        colorized_echo magenta "  View logs: $APP_NAME service-logs"
    fi
    
    colorized_echo blue "================================="
    echo
}

print_menu() {
    colorized_echo blue "================================"
    colorized_echo magenta "       $APP_NAME Node Menu"
    colorized_echo blue "================================"
    local entries=(
        "up:Start services"
        "down:Stop services"
        "restart:Restart services"
        "status:Show status"
        "logs:Show logs"
        "install:Install/reinstall Rebecca-node"
        "service-install:Install maintenance service"
        "service-update:Update maintenance service"
        "service-status:Show maintenance service status"
        "service-logs:Show maintenance service logs"
        "service-uninstall:Uninstall maintenance service"
        "update:Update to latest version"
        "uninstall:Uninstall Rebecca-node"
        "script-install:Install Rebecca-node script"
        "script-update:Update Rebecca-node CLI script"
        "script-uninstall:Uninstall Rebecca-node script"
        "core-update:Update/Change Xray core"
        "edit:Edit docker-compose.yml or binary .env"
        "help:Show this help message"
    )
    local idx=1
    for entry in "${entries[@]}"; do
        local cmd="${entry%%:*}"
        local desc="${entry#*:}"
        local color="yellow"
        if [[ "$cmd" == service-* ]]; then
            color="green"
        elif [[ "$cmd" == script-* ]]; then
            color="blue"
        fi
        colorized_echo "$color" "$(printf " %2d) %-18s - %s" "$idx" "$cmd" "$desc")"
        idx=$((idx + 1))
    done
    echo
}

map_choice_to_command() {
    case "$1" in
        1) echo "up" ;;
        2) echo "down" ;;
        3) echo "restart" ;;
        4) echo "status" ;;
        5) echo "logs" ;;
        6) echo "install" ;;
        7) echo "service-install" ;;
        8) echo "service-update" ;;
        9) echo "service-status" ;;
        10) echo "service-logs" ;;
        11) echo "service-uninstall" ;;
        12) echo "update" ;;
        13) echo "uninstall" ;;
        14) echo "script-install" ;;
        15) echo "script-update" ;;
        16) echo "script-uninstall" ;;
        17) echo "core-update" ;;
        18) echo "edit" ;;
        19) echo "help" ;;
        *) echo "$1" ;;
    esac
}

dispatch_command() {
    local cmd="$1"
    shift || true
    case "$cmd" in
        install) install_command ;;
        update) update_command ;;
        uninstall) uninstall_command ;;
        up) up_command ;;
        down) down_command ;;
        restart) restart_command ;;
        status) status_command ;;
        logs) logs_command ;;
        core-update) update_core_command ;;
        install-script|script-install) install_rebecca_node_script ;;
        update-script|script-update) install_rebecca_node_script ;;
        uninstall-script|script-uninstall) uninstall_rebecca_node_script ;;
        install-service|service-install) install_rebecca_node_service ;;
        uninstall-service|service-uninstall)
            uninstall_rebecca_node_service
            colorized_echo green "Rebecca-node maintenance service uninstalled successfully"
        ;;
        service-status) service_status_command ;;
        service-logs) service_logs_command ;;
        edit) edit_command ;;
        update-service|service-update) update_rebecca_node_service ;;
        help) usage ;;
        *) usage ;;
    esac
}

if [ -z "${COMMAND:-}" ]; then
    print_menu
    read -rp "Select option (number or command): " user_choice
    if [ -z "$user_choice" ]; then
        exit 0
    fi
    COMMAND=$(map_choice_to_command "$user_choice")
fi

dispatch_command "$COMMAND"
