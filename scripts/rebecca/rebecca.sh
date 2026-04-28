#!/usr/bin/env bash
set -e

INSTALL_DIR="/opt"
if [ -z "$APP_NAME" ]; then
    APP_NAME="rebecca"
fi
ensure_valid_app_name() {
    local candidate="${APP_NAME:-rebecca}"
    if ! [[ "$candidate" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
        candidate="rebecca"
        echo "Invalid app name detected. Falling back to default: $candidate"
    fi
    APP_NAME="$candidate"
}
ensure_valid_app_name
APP_DIR="$INSTALL_DIR/$APP_NAME"
DATA_DIR="/var/lib/$APP_NAME"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"
LAST_XRAY_CORES=10
CERTS_BASE="/var/lib/$APP_NAME/certs"
REBECCA_REPO="${REBECCA_REPO:-rebeccapanel/Rebecca}"
REBECCA_REF="${REBECCA_REF:-dev}"
REBECCA_RAW_BASE="${REBECCA_RAW_BASE:-https://raw.githubusercontent.com/${REBECCA_REPO}/${REBECCA_REF}}"
REBECCA_SCRIPT_BASE_URL="${REBECCA_SCRIPT_BASE_URL:-${REBECCA_RAW_BASE}/scripts/rebecca}"
REBECCA_RELEASE_REPO="${REBECCA_RELEASE_REPO:-rebeccapanel/Rebecca}"
REBECCA_BINARY_DEV_BRANCH="${REBECCA_BINARY_DEV_BRANCH:-dev}"
REBECCA_BINARY_WORKFLOW_NAME="${REBECCA_BINARY_WORKFLOW_NAME:-binary-build}"
INSTALL_MODE_FILE="$APP_DIR/.install-mode"
CHANNEL_FILE="$APP_DIR/.channel"
BINARY_BIN_DIR="$APP_DIR/bin"
BINARY_SERVER="$BINARY_BIN_DIR/rebecca-server"
BINARY_CLI="$BINARY_BIN_DIR/rebecca-cli"
BINARY_CLI_LAUNCHER="/usr/local/bin/rebecca-cli"
BINARY_METADATA_FILE="$APP_DIR/.binary-release.json"
BINARY_ARTIFACT_PREFIX="${BINARY_ARTIFACT_PREFIX:-rebecca-binaries}"
BINARY_SERVICE_UNIT="/etc/systemd/system/$APP_NAME.service"
CERTBOT_VENV_DIR="$APP_DIR/certbot-venv"
CERTBOT_BIN=""
PARSED_DOMAINS=()

colorized_echo() {
    local color=$1
    local text=$2
    
    case $color in
        "red")
        printf "\e[91m${text}\e[0m\n";;
        "green")
        printf "\e[92m${text}\e[0m\n";;
        "yellow")
        printf "\e[93m${text}\e[0m\n";;
        "blue")
        printf "\e[94m${text}\e[0m\n";;
        "magenta")
        printf "\e[95m${text}\e[0m\n";;
        "cyan")
        printf "\e[96m${text}\e[0m\n";;
        *)
            echo "${text}"
        ;;
    esac
}

set_rebecca_source_ref() {
    local ref="${1:-dev}"
    REBECCA_REF="$ref"
    REBECCA_RAW_BASE="https://raw.githubusercontent.com/${REBECCA_REPO}/${REBECCA_REF}"
    REBECCA_SCRIPT_BASE_URL="${REBECCA_RAW_BASE}/scripts/rebecca"
}

set_rebecca_source_for_version() {
    case "${1:-latest}" in
        dev)
            set_rebecca_source_ref "$REBECCA_BINARY_DEV_BRANCH"
            ;;
        *)
            set_rebecca_source_ref "dev"
            ;;
    esac
}

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
        DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a $PKG_MANAGER update -qq
    elif [[ "$OS" == "CentOS"* ]] || [[ "$OS" == "AlmaLinux"* ]]; then
        PKG_MANAGER="yum"
        $PKG_MANAGER update -y
        $PKG_MANAGER install -y epel-release
    elif [ "$OS" == "Fedora"* ]; then
        PKG_MANAGER="dnf"
        $PKG_MANAGER update
    elif [ "$OS" == "Arch" ]; then
        PKG_MANAGER="pacman"
        $PKG_MANAGER -Sy
    elif [[ "$OS" == "openSUSE"* ]]; then
        PKG_MANAGER="zypper"
        $PKG_MANAGER refresh
    else
        colorized_echo red "Unsupported operating system"
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
            -o Dpkg::Options::="--force-confold"
    elif [[ "$OS" == "CentOS"* ]] || [[ "$OS" == "AlmaLinux"* ]]; then
        $PKG_MANAGER install -y "$PACKAGE"
    elif [ "$OS" == "Fedora"* ]; then
        $PKG_MANAGER install -y "$PACKAGE"
    elif [ "$OS" == "Arch" ]; then
        $PKG_MANAGER -S --noconfirm "$PACKAGE"
    else
        colorized_echo red "Unsupported operating system"
        exit 1
    fi
}

ensure_python3_venv() {
    detect_os
    if [[ "$OS" == "Ubuntu"* ]] || [[ "$OS" == "Debian"* ]]; then
        PY_VER=$(python3 -c 'import sys; print(f"%s.%s" % (sys.version_info.major, sys.version_info.minor))' 2>/dev/null || echo "3")
        install_package "python${PY_VER}-venv"
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

detect_compose() {
    if is_binary_install; then
        return 0
    fi

    # Check if docker compose command exists
    if docker compose version >/dev/null 2>&1; then
        COMPOSE='docker compose'
    elif docker-compose version >/dev/null 2>&1; then
        COMPOSE='docker-compose'
    else
        colorized_echo red "docker compose not found"
        exit 1
    fi
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
        mode=$(tr -d '[:space:]' < "$INSTALL_MODE_FILE")
        normalize_install_mode "$mode"
        return
    fi

    if [ -x "$BINARY_SERVER" ] || [ -f "$BINARY_SERVICE_UNIT" ]; then
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
    requested_mode=$(normalize_install_mode "${1:-${REBECCA_INSTALL_MODE:-}}")

    if [ -n "$requested_mode" ]; then
        echo "$requested_mode"
        return
    fi

    if [ ! -t 0 ]; then
        echo "docker"
        return
    fi

    colorized_echo cyan "Select Rebecca installation mode:" >&2
    colorized_echo yellow "  1) Dockerized (recommended for full database support)" >&2
    colorized_echo yellow "  2) Binary (native systemd service, SQLite only)" >&2
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

select_rebecca_version() {
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

    colorized_echo cyan "Select Rebecca release channel for ${install_mode} mode:" >&2
    colorized_echo yellow "  1) latest (stable release)" >&2
    if [ "$install_mode" = "binary" ]; then
        colorized_echo yellow "  2) dev (latest successful binary build from branch ${REBECCA_BINARY_DEV_BRANCH})" >&2
    else
        colorized_echo yellow "  2) dev (latest Docker image from branch ${REBECCA_BINARY_DEV_BRANCH})" >&2
    fi
    read -r -p "Release channel [1]: " rebecca_version_answer

    case "$rebecca_version_answer" in
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

write_rebecca_channel() {
    local channel="${1:-latest}"
    mkdir -p "$APP_DIR"
    echo "$channel" > "$CHANNEL_FILE"
}

get_installed_rebecca_channel() {
    local channel
    local image_tag
    local metadata_tag

    if [ -f "$CHANNEL_FILE" ]; then
        channel=$(tr -d '[:space:]' < "$CHANNEL_FILE")
        if [ -n "$channel" ]; then
            echo "$channel"
            return
        fi
    fi

    if [ -f "$BINARY_METADATA_FILE" ]; then
        metadata_tag=$(sed -nE 's/.*"tag"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$BINARY_METADATA_FILE" | head -n 1)
        if [[ "$metadata_tag" == dev-* ]]; then
            echo "dev"
            return
        elif [ -n "$metadata_tag" ] && [ "$metadata_tag" != "latest" ]; then
            echo "$metadata_tag"
            return
        fi
    fi

    if [ -f "$COMPOSE_FILE" ]; then
        image_tag=$(grep -E "image:.*rebeccapanel/rebecca:" "$COMPOSE_FILE" | head -n 1 | sed -E 's/.*rebeccapanel\/rebecca:([^"[:space:]]+).*/\1/')
        if [ -n "$image_tag" ]; then
            echo "$image_tag"
            return
        fi
    fi

    echo "latest"
}

install_rebecca_script() {
    local source_version="${1:-}"
    if [ -n "$source_version" ]; then
        set_rebecca_source_for_version "$source_version"
    elif is_rebecca_installed; then
        set_rebecca_source_for_version "$(get_installed_rebecca_channel)"
    fi
    SCRIPT_URL="$REBECCA_SCRIPT_BASE_URL/rebecca.sh"
    colorized_echo blue "Installing rebecca script"
    curl -fsSL "$SCRIPT_URL" | install -m 755 /dev/stdin /usr/local/bin/rebecca
    colorized_echo green "rebecca script installed successfully"
}

trim_string() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

validate_domain_format() {
    local domain="$1"
    if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
        colorized_echo red "Invalid domain: $domain"
        return 1
    fi
    return 0
}

is_valid_ipv4() {
    local ip="$1"
    local IFS='.'
    read -r -a octets <<< "$ip"
    if [ ${#octets[@]} -ne 4 ]; then
        return 1
    fi
    for octet in "${octets[@]}"; do
        if [[ ! "$octet" =~ ^[0-9]+$ ]]; then
            return 1
        fi
        if [ "$octet" -lt 0 ] || [ "$octet" -gt 255 ]; then
            return 1
        fi
    done
    return 0
}

is_valid_ipv6() {
    local ip="$1"
    if [[ "$ip" =~ ^[0-9a-fA-F:]+$ ]] && [[ "$ip" == *:*:* ]]; then
        return 0
    fi
    return 1
}

is_valid_ip() {
    local value="$1"
    if is_valid_ipv4 "$value" || is_valid_ipv6 "$value"; then
        return 0
    fi
    return 1
}

ssl_cert_id_for_name() {
    local value="$1"
    value=$(echo "$value" | tr ':' '_' | tr '/' '_')
    printf '%s' "$value"
}

detect_public_ip() {
    local ip=""
    local urls=(
        "https://api.ipify.org"
        "https://ifconfig.me/ip"
        "https://checkip.amazonaws.com"
    )
    for url in "${urls[@]}"; do
        ip=$(curl -fsS4 --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)
        if [ -n "$ip" ] && is_valid_ip "$ip"; then
            printf '%s' "$ip"
            return 0
        fi
    done
    return 1
}

install_ssl_dependencies() {
    detect_os
    local packages=("curl" "socat" "certbot" "openssl")
    for pkg in "${packages[@]}"; do
        if ! command -v "$pkg" >/dev/null 2>&1; then
            install_package "$pkg"
        fi
    done
}

ensure_acme_sh() {
    if [ ! -d "$HOME/.acme.sh" ]; then
        curl https://get.acme.sh | sh -s email="$1"
        if [ -f "$HOME/.bashrc" ]; then
            # shellcheck disable=SC1090
            source "$HOME/.bashrc"
        fi
    fi
}

certbot_supports_ip_certificates() {
    local certbot_bin="$1"
    "$certbot_bin" --help all 2>/dev/null | grep -q -- "--ip-address" \
        && "$certbot_bin" --help all 2>/dev/null | grep -q -- "--preferred-profile"
}

find_certbot_with_ip_support() {
    if command -v certbot >/dev/null 2>&1 && certbot_supports_ip_certificates "$(command -v certbot)"; then
        CERTBOT_BIN="$(command -v certbot)"
        return 0
    fi

    if [ -x "$CERTBOT_VENV_DIR/bin/certbot" ] && certbot_supports_ip_certificates "$CERTBOT_VENV_DIR/bin/certbot"; then
        CERTBOT_BIN="$CERTBOT_VENV_DIR/bin/certbot"
        return 0
    fi

    return 1
}

ensure_certbot_ip_support() {
    if find_certbot_with_ip_support; then
        return 0
    fi

    colorized_echo yellow "Installed certbot does not support IP certificates. Installing a modern certbot in $CERTBOT_VENV_DIR"
    detect_os
    if ! command -v python3 >/dev/null 2>&1; then
        install_package python3
    fi
    ensure_python3_venv
    python3 -m venv "$CERTBOT_VENV_DIR"
    "$CERTBOT_VENV_DIR/bin/python" -m pip install --upgrade pip >/dev/null
    "$CERTBOT_VENV_DIR/bin/python" -m pip install --upgrade "certbot>=5.4.0" >/dev/null

    if ! certbot_supports_ip_certificates "$CERTBOT_VENV_DIR/bin/certbot"; then
        colorized_echo red "The installed certbot still does not support --ip-address and --preferred-profile."
        return 1
    fi

    CERTBOT_BIN="$CERTBOT_VENV_DIR/bin/certbot"
    return 0
}

SSL_CERT_DIR=""

issue_ssl_with_acme() {
    local email="$1"
    shift
    local domains=("$@")
    ensure_acme_sh "$email"

    local args=""
    for domain in "${domains[@]}"; do
        args+=" -d $domain"
    done

    ~/.acme.sh/acme.sh --issue --standalone $args --accountemail "$email" || return 1

    local primary="${domains[0]}"
    SSL_CERT_DIR="$CERTS_BASE/$primary"
    mkdir -p "$SSL_CERT_DIR"

    ~/.acme.sh/acme.sh --install-cert -d "$primary" \
        --key-file "$SSL_CERT_DIR/privkey.pem" \
        --fullchain-file "$SSL_CERT_DIR/fullchain.pem" || return 1

    echo "provider=acme" > "$SSL_CERT_DIR/.metadata"
    echo "email=$email" >> "$SSL_CERT_DIR/.metadata"
    echo "domains=${domains[*]}" >> "$SSL_CERT_DIR/.metadata"
    echo "issued_at=$(date -u +%s)" >> "$SSL_CERT_DIR/.metadata"
    return 0
}

issue_ssl_with_certbot() {
    local email="$1"
    shift
    local domains=("$@")

    local args=""
    for domain in "${domains[@]}"; do
        args+=" -d $domain"
    done

    certbot certonly --standalone $args --non-interactive --agree-tos --email "$email" || return 1

    local primary="${domains[0]}"
    SSL_CERT_DIR="$CERTS_BASE/$primary"
    mkdir -p "$SSL_CERT_DIR"

    cat "/etc/letsencrypt/live/$primary/privkey.pem" > "$SSL_CERT_DIR/privkey.pem"
    cat "/etc/letsencrypt/live/$primary/fullchain.pem" > "$SSL_CERT_DIR/fullchain.pem"

    echo "provider=certbot" > "$SSL_CERT_DIR/.metadata"
    echo "email=$email" >> "$SSL_CERT_DIR/.metadata"
    echo "domains=${domains[*]}" >> "$SSL_CERT_DIR/.metadata"
    echo "issued_at=$(date -u +%s)" >> "$SSL_CERT_DIR/.metadata"
    return 0
}

issue_ssl_public_ip() {
    local email="$1"
    shift
    local ips=("$@")

    if [ ${#ips[@]} -eq 0 ]; then
        colorized_echo red "At least one IP address is required for Let's Encrypt IP SSL."
        return 1
    fi

    ensure_certbot_ip_support || return 1

    local primary="${ips[0]}"
    local cert_id
    cert_id=$(ssl_cert_id_for_name "$primary")
    SSL_CERT_DIR="$CERTS_BASE/$cert_id"
    mkdir -p "$SSL_CERT_DIR"

    local certbot_args=(
        certonly
        --standalone
        --non-interactive
        --agree-tos
        --email "$email"
        --preferred-profile shortlived
        --cert-name "$cert_id"
    )
    local ip
    for ip in "${ips[@]}"; do
        certbot_args+=(--ip-address "$ip")
    done

    local deploy_hook
    deploy_hook="mkdir -p '$SSL_CERT_DIR' && cp '/etc/letsencrypt/live/$cert_id/privkey.pem' '$SSL_CERT_DIR/privkey.pem' && cp '/etc/letsencrypt/live/$cert_id/fullchain.pem' '$SSL_CERT_DIR/fullchain.pem' && systemctl restart '$APP_NAME.service' >/dev/null 2>&1 || true"
    certbot_args+=(--deploy-hook "$deploy_hook")

    "$CERTBOT_BIN" "${certbot_args[@]}" || return 1

    cat "/etc/letsencrypt/live/$cert_id/privkey.pem" > "$SSL_CERT_DIR/privkey.pem"
    cat "/etc/letsencrypt/live/$cert_id/fullchain.pem" > "$SSL_CERT_DIR/fullchain.pem"

    echo "provider=letsencrypt-ip" > "$SSL_CERT_DIR/.metadata"
    echo "email=$email" >> "$SSL_CERT_DIR/.metadata"
    echo "domains=${ips[*]}" >> "$SSL_CERT_DIR/.metadata"
    echo "certbot_cert_name=$cert_id" >> "$SSL_CERT_DIR/.metadata"
    echo "validity=shortlived" >> "$SSL_CERT_DIR/.metadata"
    echo "issued_at=$(date -u +%s)" >> "$SSL_CERT_DIR/.metadata"
    return 0
}

issue_ssl_self_signed_ip() {
    local email="$1"
    shift
    local ips=("$@")

    if [ ${#ips[@]} -eq 0 ]; then
        colorized_echo red "At least one IP address is required for self-signed SSL."
        return 1
    fi

    detect_os
    if ! command -v openssl >/dev/null 2>&1; then
        install_package openssl
    fi

    local primary="${ips[0]}"
    local cert_id
    cert_id=$(ssl_cert_id_for_name "$primary")
    SSL_CERT_DIR="$CERTS_BASE/$cert_id"
    mkdir -p "$SSL_CERT_DIR"

    local openssl_conf
    openssl_conf=$(mktemp)
    {
        echo "[ req ]"
        echo "default_bits = 2048"
        echo "prompt = no"
        echo "default_md = sha256"
        echo "req_extensions = v3_req"
        echo "distinguished_name = dn"
        echo
        echo "[ dn ]"
        echo "CN = $primary"
        echo
        echo "[ v3_req ]"
        echo "subjectAltName = @alt_names"
        echo
        echo "[ alt_names ]"
        local idx=1
        for ip in "${ips[@]}"; do
            echo "IP.$idx = $ip"
            idx=$((idx + 1))
        done
    } > "$openssl_conf"

    if ! openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
        -keyout "$SSL_CERT_DIR/privkey.pem" \
        -out "$SSL_CERT_DIR/fullchain.pem" \
        -config "$openssl_conf" >/dev/null 2>&1; then
        rm -f "$openssl_conf"
        colorized_echo red "Failed to generate self-signed certificate."
        return 1
    fi
    rm -f "$openssl_conf"

    echo "provider=self-signed" > "$SSL_CERT_DIR/.metadata"
    echo "email=$email" >> "$SSL_CERT_DIR/.metadata"
    echo "domains=${ips[*]}" >> "$SSL_CERT_DIR/.metadata"
    echo "issued_at=$(date -u +%s)" >> "$SSL_CERT_DIR/.metadata"
    return 0
}

set_env_value() {
    local key="$1"
    local value="$2"
    value=$(echo "$value" | sed 's/^"//;s/"$//')
    mkdir -p "$(dirname "$ENV_FILE")"
    touch "$ENV_FILE"
    if grep -qE "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null; then
        sed -i -E "s|^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=.*|${key} = \"${value}\"|" "$ENV_FILE"
    else
        echo "${key} = \"${value}\"" >> "$ENV_FILE"
    fi
}

get_env_value() {
    local key="$1"
    if [ ! -f "$ENV_FILE" ]; then
        return
    fi
    grep -E "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null \
        | tail -n 1 \
        | sed -E 's/^[^=]+=//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^"//; s/"$//'
}

escape_dotenv_double_quoted() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//\$/\\\$}"
    printf '%s' "$value"
}

upsert_env_assignment() {
    local key="$1"
    local value="$2"
    local escaped_value
    local tmp_env

    escaped_value=$(escape_dotenv_double_quoted "$value")
    mkdir -p "$(dirname "$ENV_FILE")"
    touch "$ENV_FILE"

    tmp_env=$(mktemp)
    grep -vE "^[[:space:]]*#?[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" > "$tmp_env" || true
    mv "$tmp_env" "$ENV_FILE"

    echo "${key}=\"${escaped_value}\"" >> "$ENV_FILE"
}

urlencode_value() {
    local value="$1"

    if command -v python3 >/dev/null 2>&1; then
        python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$value"
        return
    fi

    if command -v python >/dev/null 2>&1; then
        python -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$value"
        return
    fi

    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$value" | jq -sRr @uri
        return
    fi

    printf '%s' "$value"
}

add_phpmyadmin_to_compose() {
    local compose_file="$1"

    # Check if phpMyAdmin service already exists
    if grep -q "^\s*phpmyadmin:" "$compose_file" 2>/dev/null; then
        return 0
    fi

    # Add phpMyAdmin service to docker-compose.yml
    if command -v yq >/dev/null 2>&1; then
        yq eval '.services.phpmyadmin = {
            "image": "phpmyadmin/phpmyadmin:latest",
            "restart": "always",
            "env_file": ".env",
            "network_mode": "host",
            "environment": {
                "PMA_HOST": "127.0.0.1",
                "APACHE_PORT": 8010,
                "UPLOAD_LIMIT": "1024M"
            },
            "depends_on": ["mysql"]
        }' -i "$compose_file"
    else
        cat >> "$compose_file" <<EOF

  phpmyadmin:
    image: phpmyadmin/phpmyadmin:latest
    restart: always
    env_file: .env
    network_mode: host
    environment:
      PMA_HOST: 127.0.0.1
      APACHE_PORT: 8010
      UPLOAD_LIMIT: 1024M
    depends_on:
      - mysql
EOF
    fi
}

enable_phpmyadmin() {
    check_running_as_root

    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca is not installed. Please install Rebecca first."
        exit 1
    fi

    if ! is_binary_install; then
        detect_compose
    fi

    colorized_echo blue "Adding phpMyAdmin to docker-compose.yml..."
    add_phpmyadmin_to_compose "$COMPOSE_FILE"
    colorized_echo green "phpMyAdmin service added to docker-compose.yml"

    colorized_echo blue "Restarting Rebecca services..."
    down_rebecca
    up_rebecca
    colorized_echo green "Rebecca restarted successfully."
}

sync_ssl_env_paths() {
    local cert_dir="$1"
    local ca_type="${2:-public}"
    set_env_value "UVICORN_SSL_CERTFILE" "$cert_dir/fullchain.pem"
    set_env_value "UVICORN_SSL_KEYFILE" "$cert_dir/privkey.pem"
    set_env_value "UVICORN_SSL_CA_TYPE" "$ca_type"
}

perform_ssl_issue() {
    local email="$1"
    local preferred="${2:-auto}"
    shift 2
    local domains=("$@")
    local provider_used=""
    local has_ip=0
    local has_domain=0

    if [ ${#domains[@]} -eq 0 ]; then
        colorized_echo red "At least one domain is required for SSL issuance."
        return 1
    fi

    for d in "${domains[@]}"; do
        if is_valid_ip "$d"; then
            has_ip=1
        else
            has_domain=1
        fi
    done

    if [ "$has_ip" -eq 1 ] && [ "$has_domain" -eq 1 ]; then
        colorized_echo red "Mixing IP addresses and domains is not supported in one certificate request."
        return 1
    fi

    install_ssl_dependencies
    mkdir -p "$CERTS_BASE"

    if [ "$has_ip" -eq 1 ]; then
        if [ "$has_domain" -eq 1 ]; then
            colorized_echo red "IP certificates cannot be mixed with domain names."
            return 1
        fi
        case "$preferred" in
            letsencrypt-ip|ip|public-ip|shortlived|certbot-ip)
                issue_ssl_public_ip "$email" "${domains[@]}" || return 1
                provider_used="letsencrypt-ip"
                sync_ssl_env_paths "$SSL_CERT_DIR" "public"
                colorized_echo green "Public short-lived IP SSL certificate installed at $SSL_CERT_DIR for IP(s): ${domains[*]}"
                ;;
            auto|self-signed)
                issue_ssl_self_signed_ip "$email" "${domains[@]}" || return 1
                provider_used="self-signed"
                sync_ssl_env_paths "$SSL_CERT_DIR" "self-signed"
                colorized_echo green "Self-signed SSL certificate generated at $SSL_CERT_DIR for IP(s): ${domains[*]}"
                ;;
            *)
                colorized_echo red "IP SSL requires --provider letsencrypt-ip or --provider self-signed."
                return 1
                ;;
        esac
        
        if is_rebecca_installed; then
            detect_compose
            if is_rebecca_up; then
                colorized_echo blue "Restarting Rebecca to apply SSL configuration..."
                down_rebecca
                up_rebecca
                colorized_echo green "Rebecca restarted with SSL configuration"
            fi
        fi
        
        return 0
    fi

    if [ "$preferred" = "self-signed" ] || [ "$preferred" = "letsencrypt-ip" ] || [ "$preferred" = "ip" ] || [ "$preferred" = "public-ip" ] || [ "$preferred" = "shortlived" ] || [ "$preferred" = "certbot-ip" ]; then
        colorized_echo red "Provider $preferred is only valid for IP address certificates."
        return 1
    fi

    if [ "$preferred" = "acme" ]; then
        issue_ssl_with_acme "$email" "${domains[@]}" || return 1
        provider_used="acme"
    elif [ "$preferred" = "certbot" ]; then
        issue_ssl_with_certbot "$email" "${domains[@]}" || return 1
        provider_used="certbot"
    else
        if issue_ssl_with_acme "$email" "${domains[@]}"; then
            provider_used="acme"
        else
            colorized_echo yellow "acme.sh issuance failed, falling back to certbot..."
            issue_ssl_with_certbot "$email" "${domains[@]}" || return 1
            provider_used="certbot"
        fi
    fi

    sync_ssl_env_paths "$SSL_CERT_DIR"
    colorized_echo green "SSL certificate installed at $SSL_CERT_DIR using $provider_used"
    
    # Check if Rebecca is installed and running, then restart to apply SSL changes
    if is_rebecca_installed; then
        detect_compose
        if is_rebecca_up; then
            colorized_echo blue "Restarting Rebecca to apply SSL configuration..."
            down_rebecca
            up_rebecca
            colorized_echo green "Rebecca restarted with SSL configuration"
        fi
    fi
    
    return 0
}

parse_domains_input() {
    local input="$1"
    PARSED_DOMAINS=()
    PARSED_IS_IP=0
    local has_ip=0
    local has_domain=0
    IFS=',' read -ra raw_domains <<< "$input"
    for entry in "${raw_domains[@]}"; do
        local domain
        domain=$(trim_string "$entry")
        if [ -z "$domain" ]; then
            continue
        fi
        if is_valid_ip "$domain"; then
            has_ip=1
        else
            validate_domain_format "$domain" || return 1
            has_domain=1
        fi
        PARSED_DOMAINS+=("$domain")
    done
    if [ ${#PARSED_DOMAINS[@]} -eq 0 ]; then
        colorized_echo red "No valid domains provided."
        return 1
    fi
    if [ "$has_ip" -eq 1 ] && [ "$has_domain" -eq 1 ]; then
        colorized_echo red "Cannot mix IP addresses and domains in one request."
        return 1
    fi
    if [ "$has_ip" -eq 1 ]; then
        PARSED_IS_IP=1
    fi
}

prompt_ssl_setup() {
    read -p "Do you want to configure SSL certificates now? (y/N): " ssl_answer
    if [[ ! "$ssl_answer" =~ ^[Yy]$ ]]; then
        return
    fi

    colorized_echo cyan "Select SSL certificate type:"
    echo "  1) Domain certificate (Let's Encrypt, regular public SSL)"
    echo "  2) Temporary public IP certificate (Let's Encrypt short-lived, about 6 days)"
    echo "  3) Self-signed IP certificate (browser warning, local fallback)"
    read -p "Select option [1]: " ssl_mode
    ssl_mode="${ssl_mode:-1}"

    read -p "Enter email for certificate notifications: " ssl_email

    local ssl_domains=""
    local ssl_provider="auto"
    case "$ssl_mode" in
        2)
            local detected_ip=""
            detected_ip=$(detect_public_ip || true)
            if [ -n "$detected_ip" ]; then
                read -p "Enter server public IP [$detected_ip]: " ssl_domains
                ssl_domains="${ssl_domains:-$detected_ip}"
            else
                read -p "Enter server public IP: " ssl_domains
            fi
            ssl_provider="letsencrypt-ip"
            ;;
        3)
            local detected_self_ip=""
            detected_self_ip=$(detect_public_ip || true)
            if [ -n "$detected_self_ip" ]; then
                read -p "Enter server IP [$detected_self_ip]: " ssl_domains
                ssl_domains="${ssl_domains:-$detected_self_ip}"
            else
                read -p "Enter server IP: " ssl_domains
            fi
            ssl_provider="self-signed"
            ;;
        *)
            read -p "Enter domain(s) separated by comma: " ssl_domains
            ssl_provider="auto"
            ;;
    esac

    if ! ssl_command issue --email "$ssl_email" --domains "$ssl_domains" --provider "$ssl_provider" --non-interactive; then
        colorized_echo yellow "SSL setup skipped due to input/issuance error. You can retry with: rebecca ssl issue"
    fi
}

ssl_issue() {
    local email=""
    local domains_input=""
    local ip_input=""
    local provider="auto"
    local interactive=true

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --email=*)
                email="${1#*=}"
                shift
                ;;
            --email)
                email="$2"
                shift 2
                ;;
            --domains=*)
                domains_input="${1#*=}"
                shift
                ;;
            --domains)
                domains_input="$2"
                shift 2
                ;;
            --ip-address=*|--ip=*)
                ip_input="${1#*=}"
                if [ "$provider" = "auto" ]; then
                    provider="letsencrypt-ip"
                fi
                shift
                ;;
            --ip-address|--ip)
                ip_input="$2"
                if [ "$provider" = "auto" ]; then
                    provider="letsencrypt-ip"
                fi
                shift 2
                ;;
            --provider=*)
                provider="${1#*=}"
                shift
                ;;
            --provider)
                provider="$2"
                shift 2
                ;;
            --non-interactive)
                interactive=false
                shift
                ;;
            *)
                colorized_echo red "Unknown option: $1"
                return 1
                ;;
        esac
    done

    if [ -n "$ip_input" ]; then
        domains_input="$ip_input"
    fi

    if [ "$interactive" = true ]; then
        if [ -z "$email" ]; then
            read -p "Enter email address: " email
        fi
        if [ -z "$domains_input" ]; then
            read -p "Enter domain(s) or IP address(es) separated by comma: " domains_input
        fi
    else
        if [ -z "$email" ] || [ -z "$domains_input" ]; then
            colorized_echo red "Email and domains/IP addresses are required when using non-interactive mode."
            return 1
        fi
    fi

    parse_domains_input "$domains_input" || return 1
    perform_ssl_issue "$email" "$provider" "${PARSED_DOMAINS[@]}"
}

get_domain_from_env() {
    if [ ! -f "$ENV_FILE" ]; then
        return
    fi
    local line
    line=$(grep "^UVICORN_SSL_CERTFILE" "$ENV_FILE" | tail -n 1 | cut -d'=' -f2-)
    line=$(echo "$line" | tr -d ' "')
    if [ -z "$line" ]; then
        return
    fi
    basename "$(dirname "$line")"
}

ssl_renew() {
    local target_domain=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --domain=*)
                target_domain="${1#*=}"
                shift
                ;;
            --domain)
                target_domain="$2"
                shift 2
                ;;
            *)
                colorized_echo red "Unknown option: $1"
                return 1
                ;;
        esac
    done

    if [ -z "$target_domain" ]; then
        target_domain=$(get_domain_from_env)
    fi

    if [ -z "$target_domain" ]; then
        colorized_echo red "Unable to detect domain. Please specify --domain example.com"
        return 1
    fi

    local metadata="$CERTS_BASE/$target_domain/.metadata"
    if [ ! -f "$metadata" ]; then
        colorized_echo red "Metadata not found for domain $target_domain"
        return 1
    fi

    local provider email domains_line
    provider=$(grep '^provider=' "$metadata" | cut -d'=' -f2-)
    email=$(grep '^email=' "$metadata" | cut -d'=' -f2-)
    domains_line=$(grep '^domains=' "$metadata" | cut -d'=' -f2-)

    if [ -z "$email" ] || [ -z "$domains_line" ]; then
        colorized_echo red "Metadata is incomplete for $target_domain"
        return 1
    fi

    read -ra stored_domains <<< "$domains_line"
    perform_ssl_issue "$email" "$provider" "${stored_domains[@]}" || return 1
    colorized_echo green "SSL certificate renewed for $target_domain"
    
    # Note: perform_ssl_issue already restarts Rebecca if needed
}

ssl_command() {
    local action="$1"
    shift || true

    case "$action" in
        issue)
            ssl_issue "$@"
            ;;
        renew)
            ssl_renew "$@"
            ;;
        *)
            colorized_echo blue "Usage: rebecca ssl <issue|renew> [options]"
            colorized_echo magenta "  Issue domain SSL: rebecca ssl issue --email you@example.com --domains example.com"
            colorized_echo magenta "  Issue public IP SSL: rebecca ssl issue --email you@example.com --ip-address 203.0.113.10"
            colorized_echo magenta "  Issue self-signed IP SSL: rebecca ssl issue --email you@example.com --domains 203.0.113.10 --provider self-signed"
            ;;
    esac
}

is_rebecca_installed() {
    if [ -d $APP_DIR ]; then
        return 0
    else
        return 1
    fi
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

send_backup_to_telegram() {
    if [ -f "$ENV_FILE" ]; then
        while IFS='=' read -r key value; do
            if [[ -z "$key" || "$key" =~ ^# ]]; then
                continue
            fi
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs)
            if [[ "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
                export "$key"="$value"
            else
                colorized_echo yellow "Skipping invalid line in .env: $key=$value"
            fi
        done < "$ENV_FILE"
    else
        colorized_echo red "Environment file (.env) not found."
        exit 1
    fi

    if [ "$BACKUP_SERVICE_ENABLED" != "true" ]; then
        colorized_echo yellow "Backup service is not enabled. Skipping Telegram upload."
        return
    fi

    local server_ip=$(curl -s ifconfig.me || echo "Unknown IP")
    local latest_backup=$(ls -t "$APP_DIR/backup" | head -n 1)
    local backup_path="$APP_DIR/backup/$latest_backup"

    if [ ! -f "$backup_path" ]; then
        colorized_echo red "No backups found to send."
        return
    fi

    local backup_size=$(du -m "$backup_path" | cut -f1)
    local split_dir="/tmp/rebecca_backup_split"
    local is_single_file=true

    mkdir -p "$split_dir"

    if [ "$backup_size" -gt 49 ]; then
        colorized_echo yellow "Backup is larger than 49MB. Splitting the archive..."
        split -b 49M "$backup_path" "$split_dir/part_"
        is_single_file=false
    else
        cp "$backup_path" "$split_dir/part_aa"
    fi


    local backup_time=$(date "+%Y-%m-%d %H:%M:%S %Z")


    for part in "$split_dir"/*; do
        local part_name=$(basename "$part")
        local custom_filename="backup_${part_name}.tar.gz"
        local caption="📦 *Backup Information*\n🌐 *Server IP*: \`${server_ip}\`\n📁 *Backup File*: \`${custom_filename}\`\n⏰ *Backup Time*: \`${backup_time}\`"
        curl -s -F chat_id="$BACKUP_TELEGRAM_CHAT_ID" \
            -F document=@"$part;filename=$custom_filename" \
            -F caption="$(echo -e "$caption" | sed 's/-/\\-/g;s/\./\\./g;s/_/\\_/g')" \
            -F parse_mode="MarkdownV2" \
            "https://api.telegram.org/bot$BACKUP_TELEGRAM_BOT_KEY/sendDocument" >/dev/null 2>&1 && \
        colorized_echo green "Backup part $custom_filename successfully sent to Telegram." || \
        colorized_echo red "Failed to send backup part $custom_filename to Telegram."
    done

    rm -rf "$split_dir"
}

send_backup_error_to_telegram() {
    local error_messages=$1
    local log_file=$2
    local server_ip=$(curl -s ifconfig.me || echo "Unknown IP")
    local error_time=$(date "+%Y-%m-%d %H:%M:%S %Z")
    local message="⚠️ *Backup Error Notification*\n"
    message+="🌐 *Server IP*: \`${server_ip}\`\n"
    message+="❌ *Errors*:\n\`${error_messages//_/\\_}\`\n"
    message+="⏰ *Time*: \`${error_time}\`"


    message=$(echo -e "$message" | sed 's/-/\\-/g;s/\./\\./g;s/_/\\_/g;s/(/\\(/g;s/)/\\)/g')

    local max_length=1000
    if [ ${#message} -gt $max_length ]; then
        message="${message:0:$((max_length - 50))}...\n\`[Message truncated]\`"
    fi


    curl -s -X POST "https://api.telegram.org/bot$BACKUP_TELEGRAM_BOT_KEY/sendMessage" \
        -d chat_id="$BACKUP_TELEGRAM_CHAT_ID" \
        -d parse_mode="MarkdownV2" \
        -d text="$message" >/dev/null 2>&1 && \
    colorized_echo green "Backup error notification sent to Telegram." || \
    colorized_echo red "Failed to send error notification to Telegram."


    if [ -f "$log_file" ]; then
        response=$(curl -s -w "%{http_code}" -o /tmp/tg_response.json \
            -F chat_id="$BACKUP_TELEGRAM_CHAT_ID" \
            -F document=@"$log_file;filename=backup_error.log" \
            -F caption="📜 *Backup Error Log* - ${error_time}" \
            "https://api.telegram.org/bot$BACKUP_TELEGRAM_BOT_KEY/sendDocument")

        http_code="${response:(-3)}"
        if [ "$http_code" -eq 200 ]; then
            colorized_echo green "Backup error log sent to Telegram."
        else
            colorized_echo red "Failed to send backup error log to Telegram. HTTP code: $http_code"
            cat /tmp/tg_response.json
        fi
    else
        colorized_echo red "Log file not found: $log_file"
    fi
}





backup_service() {
    local telegram_bot_key=""
    local telegram_chat_id=""
    local cron_schedule=""
    local interval_hours=""

    colorized_echo blue "====================================="
    colorized_echo blue "      Welcome to Backup Service      "
    colorized_echo blue "====================================="

    if grep -q "BACKUP_SERVICE_ENABLED=true" "$ENV_FILE"; then
        telegram_bot_key=$(awk -F'=' '/^BACKUP_TELEGRAM_BOT_KEY=/ {print $2}' "$ENV_FILE")
        telegram_chat_id=$(awk -F'=' '/^BACKUP_TELEGRAM_CHAT_ID=/ {print $2}' "$ENV_FILE")
        cron_schedule=$(awk -F'=' '/^BACKUP_CRON_SCHEDULE=/ {print $2}' "$ENV_FILE" | tr -d '"')

        if [[ "$cron_schedule" == "0 0 * * *" ]]; then
            interval_hours=24
        else
            interval_hours=$(echo "$cron_schedule" | grep -oP '(?<=\*/)[0-9]+')
        fi

        colorized_echo green "====================================="
        colorized_echo green "Current Backup Configuration:"
        colorized_echo cyan "Telegram Bot API Key: $telegram_bot_key"
        colorized_echo cyan "Telegram Chat ID: $telegram_chat_id"
        colorized_echo cyan "Backup Interval: Every $interval_hours hour(s)"
        colorized_echo green "====================================="
        echo "Choose an option:"
        echo "1. Reconfigure Backup Service"
        echo "2. Remove Backup Service"
        echo "3. Exit"
        read -p "Enter your choice (1-3): " user_choice

        case $user_choice in
            1)
                colorized_echo yellow "Starting reconfiguration..."
                remove_backup_service
                ;;
            2)
                colorized_echo yellow "Removing Backup Service..."
                remove_backup_service
                return
                ;;
            3)
                colorized_echo yellow "Exiting..."
                return
                ;;
            *)
                colorized_echo red "Invalid choice. Exiting."
                return
                ;;
        esac
    else
        colorized_echo yellow "No backup service is currently configured."
    fi

    while true; do
        printf "Enter your Telegram bot API key: "
        read telegram_bot_key
        if [[ -n "$telegram_bot_key" ]]; then
            break
        else
            colorized_echo red "API key cannot be empty. Please try again."
        fi
    done

    while true; do
        printf "Enter your Telegram chat ID: "
        read telegram_chat_id
        if [[ -n "$telegram_chat_id" ]]; then
            break
        else
            colorized_echo red "Chat ID cannot be empty. Please try again."
        fi
    done

    while true; do
        printf "Set up the backup interval in hours (1-24):\n"
        read interval_hours

        if ! [[ "$interval_hours" =~ ^[0-9]+$ ]]; then
            colorized_echo red "Invalid input. Please enter a valid number."
            continue
        fi

        if [[ "$interval_hours" -eq 24 ]]; then
            cron_schedule="0 0 * * *"
            colorized_echo green "Setting backup to run daily at midnight."
            break
        fi

        if [[ "$interval_hours" -ge 1 && "$interval_hours" -le 23 ]]; then
            cron_schedule="0 */$interval_hours * * *"
            colorized_echo green "Setting backup to run every $interval_hours hour(s)."
            break
        else
            colorized_echo red "Invalid input. Please enter a number between 1-24."
        fi
    done

    sed -i '/^BACKUP_SERVICE_ENABLED/d' "$ENV_FILE"
    sed -i '/^BACKUP_TELEGRAM_BOT_KEY/d' "$ENV_FILE"
    sed -i '/^BACKUP_TELEGRAM_CHAT_ID/d' "$ENV_FILE"
    sed -i '/^BACKUP_CRON_SCHEDULE/d' "$ENV_FILE"

    {
        echo ""
        echo "# Backup service configuration"
        echo "BACKUP_SERVICE_ENABLED=true"
        echo "BACKUP_TELEGRAM_BOT_KEY=$telegram_bot_key"
        echo "BACKUP_TELEGRAM_CHAT_ID=$telegram_chat_id"
        echo "BACKUP_CRON_SCHEDULE=\"$cron_schedule\""
    } >> "$ENV_FILE"

    colorized_echo green "Backup service configuration saved in $ENV_FILE."

    local backup_command="$(which bash) -c '$APP_NAME backup'"
    add_cron_job "$cron_schedule" "$backup_command"

    colorized_echo green "Backup service successfully configured."
    if [[ "$interval_hours" -eq 24 ]]; then
        colorized_echo cyan "Backups will be sent to Telegram daily (every 24 hours at midnight)."
    else
        colorized_echo cyan "Backups will be sent to Telegram every $interval_hours hour(s)."
    fi
    colorized_echo green "====================================="
}


add_cron_job() {
    local schedule="$1"
    local command="$2"
    local temp_cron=$(mktemp)

    crontab -l 2>/dev/null > "$temp_cron" || true
    grep -v "$command" "$temp_cron" > "${temp_cron}.tmp" && mv "${temp_cron}.tmp" "$temp_cron"
    echo "$schedule $command # rebecca-backup-service" >> "$temp_cron"
    
    if crontab "$temp_cron"; then
        colorized_echo green "Cron job successfully added."
    else
        colorized_echo red "Failed to add cron job. Please check manually."
    fi
    rm -f "$temp_cron"
}

remove_backup_service() {
    colorized_echo red "in process..."


    sed -i '/^# Backup service configuration/d' "$ENV_FILE"
    sed -i '/BACKUP_SERVICE_ENABLED/d' "$ENV_FILE"
    sed -i '/BACKUP_TELEGRAM_BOT_KEY/d' "$ENV_FILE"
    sed -i '/BACKUP_TELEGRAM_CHAT_ID/d' "$ENV_FILE"
    sed -i '/BACKUP_CRON_SCHEDULE/d' "$ENV_FILE"

    local temp_cron=$(mktemp)
    crontab -l 2>/dev/null > "$temp_cron"

    sed -i '/# rebecca-backup-service/d' "$temp_cron"

    if crontab "$temp_cron"; then
        colorized_echo green "Backup service task removed from crontab."
    else
        colorized_echo red "Failed to update crontab. Please check manually."
    fi

    rm -f "$temp_cron"

    colorized_echo green "Backup service has been removed."
}

backup_command() {
    local backup_dir="$APP_DIR/backup"
    local temp_dir="/tmp/rebecca_backup"
    local timestamp=$(date +"%Y%m%d%H%M%S")
    local backup_file="$backup_dir/backup_$timestamp.tar.gz"
    local error_messages=()
    local log_file="/var/log/rebecca_backup_error.log"
    > "$log_file"
    echo "Backup Log - $(date)" > "$log_file"

    if ! command -v rsync >/dev/null 2>&1; then
        detect_os
        install_package rsync
    fi

    rm -rf "$backup_dir"
    mkdir -p "$backup_dir"
    mkdir -p "$temp_dir"

    if [ -f "$ENV_FILE" ]; then
        while IFS='=' read -r key value; do
            if [[ -z "$key" || "$key" =~ ^# ]]; then
                continue
            fi
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs)
            if [[ "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
                export "$key"="$value"
            else
                echo "Skipping invalid line in .env: $key=$value" >> "$log_file"
            fi
        done < "$ENV_FILE"
    else
        error_messages+=("Environment file (.env) not found.")
        echo "Environment file (.env) not found." >> "$log_file"
        send_backup_error_to_telegram "${error_messages[*]}" "$log_file"
        exit 1
    fi

    local db_type=""
    local sqlite_file=""
    if grep -q "image: mariadb" "$COMPOSE_FILE"; then
        db_type="mariadb"
        container_name=$(docker compose -f "$COMPOSE_FILE" ps -q mariadb || echo "mariadb")

    elif grep -q "image: mysql" "$COMPOSE_FILE"; then
        db_type="mysql"
        container_name=$(docker compose -f "$COMPOSE_FILE" ps -q mysql || echo "mysql")

    elif grep -q "SQLALCHEMY_DATABASE_URL = .*sqlite" "$ENV_FILE"; then
        db_type="sqlite"
        sqlite_file=$(grep -Po '(?<=SQLALCHEMY_DATABASE_URL = "sqlite:////).*"' "$ENV_FILE" | tr -d '"')
        if [[ ! "$sqlite_file" =~ ^/ ]]; then
            sqlite_file="/$sqlite_file"
        fi

    fi

    if [ -n "$db_type" ]; then
        echo "Database detected: $db_type" >> "$log_file"
        case $db_type in
            mariadb)
                if ! docker exec "$container_name" mariadb-dump -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases --ignore-database=mysql --ignore-database=performance_schema --ignore-database=information_schema --ignore-database=sys --events --triggers > "$temp_dir/db_backup.sql" 2>>"$log_file"; then
                    error_messages+=("MariaDB dump failed.")
                fi
                ;;
            mysql)
                if ! docker exec "$container_name" mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" rebecca --events --triggers  > "$temp_dir/db_backup.sql" 2>>"$log_file"; then
                    error_messages+=("MySQL dump failed.")
                fi
                ;;
            sqlite)
                if [ -f "$sqlite_file" ]; then
                    if ! cp "$sqlite_file" "$temp_dir/db_backup.sqlite" 2>>"$log_file"; then
                        error_messages+=("Failed to copy SQLite database.")
                    fi
                else
                    error_messages+=("SQLite database file not found at $sqlite_file.")
                fi
                ;;
        esac
    fi

    cp "$APP_DIR/.env" "$temp_dir/" 2>>"$log_file"
    cp "$APP_DIR/docker-compose.yml" "$temp_dir/" 2>>"$log_file"
    rsync -av --exclude 'xray-core' --exclude 'mysql' "$DATA_DIR/" "$temp_dir/rebecca_data/" >>"$log_file" 2>&1

    if ! tar -czf "$backup_file" -C "$temp_dir" .; then
        error_messages+=("Failed to create backup archive.")
        echo "Failed to create backup archive." >> "$log_file"
    fi

    rm -rf "$temp_dir"

    if [ ${#error_messages[@]} -gt 0 ]; then
        send_backup_error_to_telegram "${error_messages[*]}" "$log_file"
        return
    fi
    colorized_echo green "Backup created: $backup_file"
    send_backup_to_telegram "$backup_file"
}



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

    # Check if the required packages are installed
    if ! command -v unzip >/dev/null 2>&1; then
        echo -e "\033[1;33mInstalling required packages...\033[0m"
        detect_os
        install_package unzip
    fi
    if ! command -v wget >/dev/null 2>&1; then
        echo -e "\033[1;33mInstalling required packages...\033[0m"
        detect_os
        install_package wget
    fi

    mkdir -p $DATA_DIR/xray-core
    cd $DATA_DIR/xray-core

    xray_filename="Xray-linux-$ARCH.zip"
    xray_download_url="https://github.com/XTLS/Xray-core/releases/download/${selected_version}/${xray_filename}"

    echo -e "\033[1;33mDownloading Xray-core version ${selected_version}...\033[0m"
    wget -q -O "${xray_filename}" "${xray_download_url}"

    echo -e "\033[1;33mExtracting Xray-core...\033[0m"
    unzip -o "${xray_filename}" >/dev/null 2>&1
    rm "${xray_filename}"
}

get_current_xray_core_version() {
    XRAY_BINARY="$DATA_DIR/xray-core/xray"
    if [ -f "$XRAY_BINARY" ]; then
        version_output=$("$XRAY_BINARY" -version 2>/dev/null)
        if [ $? -eq 0 ]; then
            version=$(echo "$version_output" | head -n1 | awk '{print $2}')
            echo "$version"
            return
        fi
    fi

    CONTAINER_NAME="$APP_NAME"
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
        version_output=$(docker exec "$CONTAINER_NAME" xray -version 2>/dev/null)
        if [ $? -eq 0 ]; then
            version=$(echo "$version_output" | head -n1 | awk '{print $2}')
            echo "$version (in container)"
            return
        fi
    fi

    echo "Not installed"
}

# Function to update the Rebecca Main core
update_core_command() {
    check_running_as_root
    get_xray_core
    # Change the Rebecca core
    xray_executable_path="XRAY_EXECUTABLE_PATH=\"/var/lib/rebecca/xray-core/xray\""
    
    echo "Changing the Rebecca core..."
    # Check if the XRAY_EXECUTABLE_PATH string already exists in the .env file
    if ! grep -q "^XRAY_EXECUTABLE_PATH=" "$ENV_FILE"; then
        # If the string does not exist, add it
        echo "${xray_executable_path}" >> "$ENV_FILE"
    else
        # Update the existing XRAY_EXECUTABLE_PATH line
        sed -i "s~^XRAY_EXECUTABLE_PATH=.*~${xray_executable_path}~" "$ENV_FILE"
    fi
    
    # Restart Rebecca
    colorized_echo red "Restarting Rebecca..."
    if restart_command -n >/dev/null 2>&1; then
        colorized_echo green "Rebecca successfully restarted!"
    else
        colorized_echo red "Rebecca restart failed!"
    fi
    colorized_echo blue "Installation of Xray-core version $selected_version completed."
}

install_rebecca() {
    local rebecca_version=$1
    local database_type=$2
    set_rebecca_source_for_version "$rebecca_version"
    # Fetch releases
    FILES_URL_PREFIX="$REBECCA_RAW_BASE"
    
    mkdir -p "$DATA_DIR"
    mkdir -p "$APP_DIR"
    
    colorized_echo blue "Setting up docker-compose.yml"
    docker_file_path="$APP_DIR/docker-compose.yml"
    
    if [ "$database_type" == "mariadb" ]; then
        # Ensure .env file exists before creating docker-compose.yml
        if [ ! -f "$ENV_FILE" ]; then
            colorized_echo blue "Fetching .env file"
            curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env" || {
                mkdir -p "$(dirname "$ENV_FILE")"
                touch "$ENV_FILE"
            }
        fi
        
        # Ensure .env file exists before creating docker-compose.yml
        if [ ! -f "$ENV_FILE" ]; then
            mkdir -p "$(dirname "$ENV_FILE")"
            colorized_echo blue "Fetching .env file"
            curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env" || touch "$APP_DIR/.env"
        fi
        
        # Generate docker-compose.yml with MariaDB content
        cat > "$docker_file_path" <<EOF
services:
  rebecca:
    image: rebeccapanel/rebecca:${rebecca_version}
    restart: always
    env_file: .env
    network_mode: host
    volumes:
      - /var/lib/rebecca:/var/lib/rebecca
      - /var/lib/rebecca/logs:/var/lib/rebecca-node
    depends_on:
      mariadb:
        condition: service_healthy

  mariadb:
    image: mariadb:lts
    env_file: .env
    network_mode: host
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_ROOT_HOST: '%'
      MYSQL_DATABASE: \${MYSQL_DATABASE}
      MYSQL_USER: \${MYSQL_USER}
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
    command:
      - --bind-address=127.0.0.1                  # Restricts access to localhost for increased security
      - --character_set_server=utf8mb4            # Sets UTF-8 character set for full Unicode support
      - --collation_server=utf8mb4_unicode_ci     # Defines collation for Unicode
      - --host-cache-size=0                       # Disables host cache to prevent DNS issues
      - --innodb-open-files=1024                  # Sets the limit for InnoDB open files
      - --innodb-buffer-pool-size=256M            # Allocates buffer pool size for InnoDB
      - --binlog_expire_logs_seconds=1209600      # Sets binary log expiration to 14 days (2 weeks)
      - --innodb-log-file-size=64M                # Sets InnoDB log file size to balance log retention and performance
      - --innodb-log-files-in-group=2             # Uses two log files to balance recovery and disk I/O
      - --innodb-doublewrite=0                    # Disables doublewrite buffer (reduces disk I/O; may increase data loss risk)
      - --general_log=0                           # Disables general query log to reduce disk usage
      - --slow_query_log=1                        # Enables slow query log for identifying performance issues
      - --slow_query_log_file=/var/lib/mysql/slow.log # Logs slow queries for troubleshooting
      - --long_query_time=2                       # Defines slow query threshold as 2 seconds
    volumes:
      - /var/lib/rebecca/mysql:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      start_period: 10s
      start_interval: 3s
      interval: 10s
      timeout: 5s
      retries: 3
EOF
        echo "----------------------------"
        colorized_echo red "Using MariaDB as database"
        echo "----------------------------"
        colorized_echo green "File generated at $APP_DIR/docker-compose.yml"

        # Modify .env file (if not already fetched)
        if [ ! -f "$ENV_FILE" ] || [ ! -s "$ENV_FILE" ]; then
            colorized_echo blue "Fetching .env file"
            curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env"
        fi

        # Comment out the SQLite line
        sed -i 's~^\(SQLALCHEMY_DATABASE_URL = "sqlite:////var/lib/rebecca/db.sqlite3"\)~#\1~' "$APP_DIR/.env"


        # Add the MySQL connection string
        #echo -e '\nSQLALCHEMY_DATABASE_URL = "mysql+pymysql://rebecca:password@127.0.0.1:3306/rebecca"' >> "$APP_DIR/.env"

        sed -i 's/^# \(XRAY_JSON = .*\)$/\1/' "$APP_DIR/.env"
        sed -i 's~\(XRAY_JSON = \).*~\1"/var/lib/rebecca/xray_config.json"~' "$APP_DIR/.env"


        prompt_for_rebecca_password
        MYSQL_ROOT_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
        MYSQL_PASSWORD_URL_ENCODED=$(urlencode_value "$MYSQL_PASSWORD")
        
        echo "" >> "$ENV_FILE"
        echo "" >> "$ENV_FILE"
        echo "# Database configuration" >> "$ENV_FILE"
        upsert_env_assignment "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD"
        upsert_env_assignment "MYSQL_DATABASE" "rebecca"
        upsert_env_assignment "MYSQL_USER" "rebecca"
        upsert_env_assignment "MYSQL_PASSWORD" "$MYSQL_PASSWORD"
        
        SQLALCHEMY_DATABASE_URL="mysql+pymysql://rebecca:${MYSQL_PASSWORD_URL_ENCODED}@127.0.0.1:3306/rebecca"
        
        echo "" >> "$ENV_FILE"
        echo "# SQLAlchemy Database URL" >> "$ENV_FILE"
        upsert_env_assignment "SQLALCHEMY_DATABASE_URL" "$SQLALCHEMY_DATABASE_URL"
        
        colorized_echo green "File saved in $APP_DIR/.env"

    elif [ "$database_type" == "mysql" ]; then
        # Ensure .env file exists before creating docker-compose.yml
        if [ ! -f "$ENV_FILE" ]; then
            mkdir -p "$(dirname "$ENV_FILE")"
            colorized_echo blue "Fetching .env file"
            curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env" || touch "$APP_DIR/.env"
        fi
        
        # Generate docker-compose.yml with MySQL content
        cat > "$docker_file_path" <<EOF
services:
  rebecca:
    image: rebeccapanel/rebecca:${rebecca_version}
    restart: always
    env_file: .env
    network_mode: host
    volumes:
      - /var/lib/rebecca:/var/lib/rebecca
      - /var/lib/rebecca/logs:/var/lib/rebecca-node
    depends_on:
      mysql:
        condition: service_healthy

  mysql:
    image: mysql:8.4
    env_file: .env
    network_mode: host
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_ROOT_HOST: '%'
      MYSQL_DATABASE: \${MYSQL_DATABASE}
      MYSQL_USER: \${MYSQL_USER}
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
    command:
      - --mysqlx=OFF                             # Disables MySQL X Plugin to save resources if X Protocol isn't used
      - --bind-address=127.0.0.1                  # Restricts access to localhost for increased security
      - --character_set_server=utf8mb4            # Sets UTF-8 character set for full Unicode support
      - --collation_server=utf8mb4_unicode_ci     # Defines collation for Unicode
      - --log-bin=mysql-bin                       # Enables binary logging for point-in-time recovery
      - --binlog_expire_logs_seconds=1209600      # Sets binary log expiration to 14 days
      - --host-cache-size=0                       # Disables host cache to prevent DNS issues
      - --innodb-open-files=1024                  # Sets the limit for InnoDB open files
      - --innodb-buffer-pool-size=256M            # Allocates buffer pool size for InnoDB
      - --innodb-redo-log-capacity=128M           # Sets redo log capacity to balance recovery and disk I/O
      - --general_log=0                           # Disables general query log for lower disk usage
      - --slow_query_log=1                        # Enables slow query log for performance analysis
      - --slow_query_log_file=/var/lib/mysql/slow.log # Logs slow queries for troubleshooting
      - --long_query_time=2                       # Defines slow query threshold as 2 seconds
    volumes:
      - /var/lib/rebecca/mysql:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-u", "rebecca", "--password=\${MYSQL_PASSWORD}"]
      start_period: 5s
      interval: 5s
      timeout: 5s
      retries: 55
      
EOF
        echo "----------------------------"
        colorized_echo red "Using MySQL as database"
        echo "----------------------------"
        colorized_echo green "File generated at $APP_DIR/docker-compose.yml"

        # Modify .env file (if not already fetched)
        if [ ! -f "$ENV_FILE" ] || [ ! -s "$ENV_FILE" ]; then
            colorized_echo blue "Fetching .env file"
            curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env"
        fi

        # Comment out the SQLite line
        sed -i 's~^\(SQLALCHEMY_DATABASE_URL = "sqlite:////var/lib/rebecca/db.sqlite3"\)~#\1~' "$APP_DIR/.env"


        # Add the MySQL connection string
        #echo -e '\nSQLALCHEMY_DATABASE_URL = "mysql+pymysql://rebecca:password@127.0.0.1:3306/rebecca"' >> "$APP_DIR/.env"

        sed -i 's/^# \(XRAY_JSON = .*\)$/\1/' "$APP_DIR/.env"
        sed -i 's~\(XRAY_JSON = \).*~\1"/var/lib/rebecca/xray_config.json"~' "$APP_DIR/.env"


        prompt_for_rebecca_password
        MYSQL_ROOT_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
        MYSQL_PASSWORD_URL_ENCODED=$(urlencode_value "$MYSQL_PASSWORD")
        
        echo "" >> "$ENV_FILE"
        echo "" >> "$ENV_FILE"
        echo "# Database configuration" >> "$ENV_FILE"
        upsert_env_assignment "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD"
        upsert_env_assignment "MYSQL_DATABASE" "rebecca"
        upsert_env_assignment "MYSQL_USER" "rebecca"
        upsert_env_assignment "MYSQL_PASSWORD" "$MYSQL_PASSWORD"
        
        SQLALCHEMY_DATABASE_URL="mysql+pymysql://rebecca:${MYSQL_PASSWORD_URL_ENCODED}@127.0.0.1:3306/rebecca"
        
        echo "" >> "$ENV_FILE"
        echo "# SQLAlchemy Database URL" >> "$ENV_FILE"
        upsert_env_assignment "SQLALCHEMY_DATABASE_URL" "$SQLALCHEMY_DATABASE_URL"
        
        colorized_echo green "File saved in $APP_DIR/.env"

    else
        echo "----------------------------"
        colorized_echo red "Using SQLite as database"
        echo "----------------------------"
        
        # Ensure .env file exists before fetching docker-compose.yml
        if [ ! -f "$ENV_FILE" ]; then
            mkdir -p "$(dirname "$ENV_FILE")"
            touch "$APP_DIR/.env"
        fi
        
        colorized_echo blue "Fetching compose file"
        curl -sL "$FILES_URL_PREFIX/docker-compose.yml" -o "$docker_file_path"

        # Install requested version
        if [ "$rebecca_version" == "latest" ]; then
            yq -i '.services.rebecca.image = "rebeccapanel/rebecca:latest"' "$docker_file_path"
        else
            yq -i ".services.rebecca.image = \"rebeccapanel/rebecca:${rebecca_version}\"" "$docker_file_path"
        fi
        echo "Installing $rebecca_version version"
        colorized_echo green "File saved in $APP_DIR/docker-compose.yml"


        colorized_echo blue "Fetching .env file"
        curl -sL "$FILES_URL_PREFIX/.env.example" -o "$APP_DIR/.env"

        sed -i 's/^# \(XRAY_JSON = .*\)$/\1/' "$APP_DIR/.env"
        sed -i 's/^# \(SQLALCHEMY_DATABASE_URL = .*\)$/\1/' "$APP_DIR/.env"
        sed -i 's~\(XRAY_JSON = \).*~\1"/var/lib/rebecca/xray_config.json"~' "$APP_DIR/.env"
        sed -i 's~\(SQLALCHEMY_DATABASE_URL = \).*~\1"sqlite:////var/lib/rebecca/db.sqlite3"~' "$APP_DIR/.env"







        
        colorized_echo green "File saved in $APP_DIR/.env"
    fi
    
    colorized_echo blue "Fetching xray config file"
    curl -sL "$FILES_URL_PREFIX/xray_config.json" -o "$DATA_DIR/xray_config.json"
    colorized_echo green "File saved in $DATA_DIR/xray_config.json"
    
    colorized_echo green "Rebecca's files downloaded successfully"
}

detect_binary_arch() {
    case "$(uname -m)" in
        amd64|x86_64)
            echo "amd64"
            ;;
        arm64|aarch64)
            echo "arm64"
            ;;
        i386|i486|i586|i686)
            echo "386"
            ;;
        armv5l|armv5tel|armv5tejl)
            echo "armv5"
            ;;
        armv6l|armv6)
            echo "armv6"
            ;;
        armv7l|armv7)
            echo "armv7"
            ;;
        ppc64le)
            echo "ppc64le"
            ;;
        s390x)
            echo "s390x"
            ;;
        *)
            colorized_echo red "Binary install is not available for architecture: $(uname -m)" >&2
            colorized_echo yellow "Use Dockerized install for this server." >&2
            exit 1
            ;;
    esac
}

get_binary_release_asset_metadata() {
    local rebecca_version="$1"
    local binary_arch="$2"
    local release_api
    local release_payload
    local resolved_tag
    local server_asset_url
    local cli_asset_url
    local package_asset_url
    local os_asset_url
    local legacy_asset_url
    local package_asset_name
    local server_asset_name
    local cli_asset_name

    if [ "$rebecca_version" = "latest" ]; then
        release_api="https://api.github.com/repos/${REBECCA_RELEASE_REPO}/releases/latest"
    else
        release_api="https://api.github.com/repos/${REBECCA_RELEASE_REPO}/releases/tags/${rebecca_version}"
    fi

    release_payload=$(curl -fsSL "$release_api") || {
        colorized_echo red "Unable to read Rebecca release metadata: $release_api" >&2
        exit 1
    }

    resolved_tag=$(echo "$release_payload" | jq -r '.tag_name // empty')
    package_asset_name="rebecca-linux-${binary_arch}.tar.gz"
    server_asset_name="rebecca-server-${resolved_tag}-linux-${binary_arch}"
    cli_asset_name="rebecca-cli-${resolved_tag}-linux-${binary_arch}"

    package_asset_url=$(echo "$release_payload" | jq -r --arg name "$package_asset_name" '
        .assets[]?
        | select(.name == $name)
        | .browser_download_url
    ' | head -n 1)

    if [ -n "$package_asset_url" ] && [ "$package_asset_url" != "null" ]; then
        printf 'archive|%s|%s|\n' "${resolved_tag:-$rebecca_version}" "$package_asset_url"
        return
    fi

    os_asset_url=$(echo "$release_payload" | jq -r '
        .assets[]?
        | select(.name == "rebecca-os")
        | .browser_download_url
    ' | head -n 1)

    if [ -n "$os_asset_url" ] && [ "$os_asset_url" != "null" ]; then
        printf 'archive|%s|%s|\n' "${resolved_tag:-$rebecca_version}" "$os_asset_url"
        return
    fi

    server_asset_url=$(echo "$release_payload" | jq -r --arg name "$server_asset_name" '
        .assets[]?
        | select(.name == $name)
        | .browser_download_url
    ' | head -n 1)

    cli_asset_url=$(echo "$release_payload" | jq -r --arg name "$cli_asset_name" '
        .assets[]?
        | select(.name == $name)
        | .browser_download_url
    ' | head -n 1)

    if [ -n "$server_asset_url" ] && [ "$server_asset_url" != "null" ] && [ -n "$cli_asset_url" ] && [ "$cli_asset_url" != "null" ]; then
        printf 'split|%s|%s|%s\n' "${resolved_tag:-$rebecca_version}" "$server_asset_url" "$cli_asset_url"
        return
    fi

    legacy_asset_url=$(echo "$release_payload" | jq -r --arg arch "linux-${binary_arch}" '
        .assets[]?
        | select(.name | test($arch + "\\.tar\\.gz$"))
        | .browser_download_url
    ' | head -n 1)

    if [ -z "$legacy_asset_url" ] || [ "$legacy_asset_url" = "null" ]; then
        colorized_echo red "No binary release assets found for linux-${binary_arch}." >&2
        colorized_echo yellow "Use Dockerized install or publish a binary release for this architecture." >&2
        exit 1
    fi

    printf 'archive|%s|%s|\n' "${resolved_tag:-$rebecca_version}" "$legacy_asset_url"
}

get_binary_dev_artifact_metadata() {
    local binary_arch="$1"
    local workflow_runs_api
    local workflow_runs_payload
    local latest_run_json
    local run_id
    local head_sha
    local artifact_name
    local artifacts_api
    local artifacts_payload
    local artifact_url
    local nightly_workflow
    local workflow_path

    nightly_workflow="$REBECCA_BINARY_WORKFLOW_NAME"
    case "$nightly_workflow" in
        *.yml|*.yaml) ;;
        *) nightly_workflow="${nightly_workflow}.yml" ;;
    esac
    workflow_path=".github/workflows/${nightly_workflow}"
    workflow_runs_api="https://api.github.com/repos/${REBECCA_RELEASE_REPO}/actions/runs?per_page=50"
    workflow_runs_payload=$(curl -fsSL "$workflow_runs_api") || {
        colorized_echo red "Unable to read binary dev workflow metadata: $workflow_runs_api" >&2
        exit 1
    }

    latest_run_json=$(echo "$workflow_runs_payload" | jq -c --arg branch "$REBECCA_BINARY_DEV_BRANCH" --arg workflow_path "$workflow_path" '
        .workflow_runs[]?
        | select(.head_branch == $branch and .event == "push" and .conclusion == "success" and .path == $workflow_path)
    ' | head -n 1)

    if [ -z "$latest_run_json" ]; then
        colorized_echo red "No successful binary dev workflow run was found on branch ${REBECCA_BINARY_DEV_BRANCH}." >&2
        exit 1
    fi

    run_id=$(echo "$latest_run_json" | jq -r '.id // empty')
    head_sha=$(echo "$latest_run_json" | jq -r '.head_sha // empty')
    artifacts_api="https://api.github.com/repos/${REBECCA_RELEASE_REPO}/actions/runs/${run_id}/artifacts"
    artifacts_payload=$(curl -fsSL "$artifacts_api") || {
        colorized_echo red "Unable to read binary dev workflow artifacts: $artifacts_api" >&2
        exit 1
    }

    artifact_name=$(echo "$artifacts_payload" | jq -r --arg preferred "${BINARY_ARTIFACT_PREFIX}-linux-${binary_arch}" --arg arch "linux-${binary_arch}" '
        [
            .artifacts[]?
            | select((.expired | not) and (.name == $preferred or (.name | startswith("rebecca")) and (.name | contains($arch))))
        ]
        | sort_by(if .name == $preferred then 0 else 1 end, .created_at)
        | .[0].name // empty
    ')

    if [ -z "$artifact_name" ]; then
        colorized_echo red "No usable binary dev artifact was found for workflow run ${run_id}." >&2
        exit 1
    fi

    artifact_url="https://nightly.link/${REBECCA_RELEASE_REPO}/workflows/${nightly_workflow}/${REBECCA_BINARY_DEV_BRANCH}/${artifact_name}.zip"
    printf '%s|%s\n' "dev-${head_sha:0:7}" "$artifact_url"
}

install_binary_cli_launcher() {
    cat > "$BINARY_CLI_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -e
export REBECCA_ENV_FILE="$ENV_FILE"
export REBECCA_APP_DIR="$APP_DIR"
export REBECCA_DATA_DIR="$DATA_DIR"
exec "$BINARY_CLI" "\$@"
EOF

    chmod 755 "$BINARY_CLI_LAUNCHER"
}

write_binary_release_metadata() {
    local resolved_version="$1"
    local binary_arch="$2"
    local asset_url="$3"

    jq -n \
        --arg image "rebecca-server (binary)" \
        --arg tag "$resolved_version" \
        --arg asset_url "$asset_url" \
        --arg arch "linux-${binary_arch}" \
        --arg server_binary "$BINARY_SERVER" \
        --arg cli_binary "$BINARY_CLI" \
        --arg installed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{
            install_mode: "binary",
            image: $image,
            tag: $tag,
            asset_url: $asset_url,
            arch: $arch,
            server_binary: $server_binary,
            cli_binary: $cli_binary,
            installed_at: $installed_at
        }' > "$BINARY_METADATA_FILE"
}

create_binary_service() {
    cat > "$BINARY_SERVICE_UNIT" <<EOF
[Unit]
Description=Rebecca Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=REBECCA_APP_DIR=$APP_DIR
Environment=REBECCA_ENV_FILE=$ENV_FILE
Environment=REBECCA_INSTALL_MODE=binary
Environment=REBECCA_BINARY_METADATA_FILE=$BINARY_METADATA_FILE
Environment=REBECCA_DATA_DIR=$DATA_DIR
Environment=XRAY_EXECUTABLE_PATH=$DATA_DIR/xray-core/xray
Environment=XRAY_ASSETS_PATH=$DATA_DIR/xray-core
ExecStart=$BINARY_SERVER
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
}

install_binary_rebecca() {
    local rebecca_version="$1"
    local database_type="$2"
    local configure_database="${3:-1}"
    local binary_arch
    local binary_source_type
    local resolved_version
    local server_asset_url
    local cli_asset_url
    local artifact_url
    local tmp_dir
    local package_path=""

    set_rebecca_source_for_version "$rebecca_version"

    detect_os
    for package in curl jq tar gzip unzip; do
        if ! command -v "$package" >/dev/null 2>&1; then
            install_package "$package"
        fi
    done

    binary_arch=$(detect_binary_arch)
    tmp_dir=$(mktemp -d)

    if [ "$rebecca_version" = "dev" ]; then
        IFS='|' read -r resolved_version artifact_url < <(get_binary_dev_artifact_metadata "$binary_arch")
        package_path="$tmp_dir/rebecca-binaries.zip"
        colorized_echo blue "Downloading Rebecca binary dev artifact"
        curl -fL "$artifact_url" -o "$package_path"
        unzip -j -o "$package_path" -d "$tmp_dir" >/dev/null
    else
        IFS='|' read -r binary_source_type resolved_version server_asset_url cli_asset_url < <(get_binary_release_asset_metadata "$rebecca_version" "$binary_arch")
        if [ "$binary_source_type" = "split" ]; then
            colorized_echo blue "Downloading Rebecca binary release assets"
            curl -fL "$server_asset_url" -o "$tmp_dir/rebecca-server"
            curl -fL "$cli_asset_url" -o "$tmp_dir/rebecca-cli"
        else
            package_path="$tmp_dir/rebecca-binary.tar.gz"
            colorized_echo blue "Downloading Rebecca binary release package"
            curl -fL "$server_asset_url" -o "$package_path"
            tar -xzf "$package_path" -C "$tmp_dir"
        fi
    fi

    if [ ! -f "$tmp_dir/rebecca-server" ] || [ ! -f "$tmp_dir/rebecca-cli" ]; then
        colorized_echo red "Downloaded binary package is incomplete; rebecca-server or rebecca-cli is missing." >&2
        rm -rf "$tmp_dir"
        exit 1
    fi

    mkdir -p "$BINARY_BIN_DIR" "$DATA_DIR" "$APP_DIR/scripts"
    install -m 755 "$tmp_dir/rebecca-server" "$BINARY_SERVER"
    install -m 755 "$tmp_dir/rebecca-cli" "$BINARY_CLI"
    install_binary_cli_launcher

    if [ ! -f "$ENV_FILE" ]; then
        colorized_echo blue "Fetching .env file"
        curl -fsSL "$REBECCA_RAW_BASE/.env.example" -o "$ENV_FILE"
    fi

    upsert_env_assignment "REBECCA_DATA_DIR" "$DATA_DIR"
    upsert_env_assignment "XRAY_JSON" "$DATA_DIR/xray_config.json"
    upsert_env_assignment "XRAY_EXECUTABLE_PATH" "$DATA_DIR/xray-core/xray"
    upsert_env_assignment "XRAY_ASSETS_PATH" "$DATA_DIR/xray-core"
    if [ "$configure_database" = "1" ]; then
        configure_binary_database "$database_type"
    fi

    if [ ! -f "$DATA_DIR/xray_config.json" ]; then
        colorized_echo blue "Fetching xray config file"
        curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "$REBECCA_RAW_BASE/xray_config.json" -o "$DATA_DIR/xray_config.json" || {
            rm -f "$DATA_DIR/xray_config.json"
            colorized_echo yellow "No bundled xray_config.json found; Rebecca will use its built-in default."
        }
    fi

    if curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "$REBECCA_SCRIPT_BASE_URL/install_latest_xray.sh" -o "$APP_DIR/scripts/install_latest_xray.sh"; then
        chmod +x "$APP_DIR/scripts/install_latest_xray.sh"
        if [ ! -x "$DATA_DIR/xray-core/xray" ]; then
            REBECCA_DATA_DIR="$DATA_DIR" XRAY_INSTALL_DIR="$DATA_DIR/xray-core" XRAY_ASSETS_DIR="$DATA_DIR/xray-core" bash "$APP_DIR/scripts/install_latest_xray.sh"
        fi
    else
        rm -f "$APP_DIR/scripts/install_latest_xray.sh"
        colorized_echo yellow "Could not fetch Xray installer script; Rebecca will start and Xray can be installed later with core-update."
    fi

    write_binary_release_metadata "${resolved_version:-$rebecca_version}" "$binary_arch" "${artifact_url:-${server_asset_url:-}}"
    echo "binary" > "$INSTALL_MODE_FILE"
    create_binary_service
    rm -rf "$tmp_dir"
    colorized_echo green "Rebecca binary files installed successfully"
}

up_rebecca() {
    if is_binary_install; then
        systemctl enable --now "$APP_NAME.service"
        return
    fi

    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" up -d --remove-orphans
}

follow_rebecca_logs() {
    if is_binary_install; then
        journalctl -u "$APP_NAME.service" -f
        return
    fi

    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" logs -f
}

status_command() {
    
    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        echo -n "Status: "
        colorized_echo red "Not Installed"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_up; then
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


prompt_for_rebecca_password() {
    if [ -n "${MYSQL_PASSWORD:-}" ]; then
        return
    fi
    if [ ! -t 0 ]; then
        MYSQL_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
        colorized_echo green "A secure database password has been generated automatically."
        return
    fi
    colorized_echo cyan "This password will be used to access the database and should be strong."
    colorized_echo cyan "If you do not enter a custom password, a secure 20-character password will be generated automatically."

    # Запрашиваем ввод пароля
    IFS= read -r -p "Enter the password for the rebecca user (or press Enter to generate a secure default password): " MYSQL_PASSWORD

    # Генерация 20-значного пароля, если пользователь оставил поле пустым
    if [ -z "$MYSQL_PASSWORD" ]; then
        MYSQL_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
        colorized_echo green "A secure password has been generated automatically."
    fi
    colorized_echo green "This password will be recorded in the .env file for future use."

    # Пауза 3 секунды перед продолжением
    sleep 3
}

sql_escape_literal() {
    printf "%s" "$1" | sed "s/'/''/g"
}

get_configured_database_type() {
    local flavor
    local db_url
    flavor=$(get_env_value "REBECCA_DATABASE_FLAVOR")
    case "$flavor" in
        mysql|mariadb|sqlite)
            echo "$flavor"
            return
        ;;
    esac

    db_url=$(get_env_value "SQLALCHEMY_DATABASE_URL")
    if [[ "$db_url" == sqlite* ]]; then
        echo "sqlite"
    elif [[ "$db_url" == mysql* ]]; then
        if [ -d "/var/lib/mysql" ] && command -v mariadb >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
            echo "mariadb"
        else
            echo "mysql"
        fi
    else
        echo "sqlite"
    fi
}

mysql_root_command() {
    if command -v mysql >/dev/null 2>&1; then
        mysql --protocol=socket -uroot "$@"
    elif command -v mariadb >/dev/null 2>&1; then
        mariadb --protocol=socket -uroot "$@"
    else
        return 1
    fi
}

install_host_database() {
    local database_type="$1"
    local package_name
    local service_name
    local config_file

    case "$database_type" in
        mysql)
            package_name="mysql-server"
            service_name="mysql"
            config_file="/etc/mysql/mysql.conf.d/rebecca.cnf"
        ;;
        mariadb)
            package_name="mariadb-server"
            service_name="mariadb"
            config_file="/etc/mysql/mariadb.conf.d/60-rebecca.cnf"
        ;;
        *)
            return 0
        ;;
    esac

    detect_os
    if ! command -v mysql >/dev/null 2>&1 && ! command -v mariadb >/dev/null 2>&1; then
        install_package "$package_name" || {
            if [ "$database_type" = "mysql" ]; then
                install_package default-mysql-server
            else
                return 1
            fi
        }
    fi

    systemctl enable --now "$service_name" >/dev/null 2>&1 || systemctl enable --now mysql >/dev/null 2>&1 || true

    mkdir -p "$(dirname "$config_file")"
    cat > "$config_file" <<EOF
[mysqld]
bind-address=127.0.0.1
skip-name-resolve=ON
local-infile=0
symbolic-links=0
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
max_connections=200
EOF
    systemctl restart "$service_name" >/dev/null 2>&1 || systemctl restart mysql >/dev/null 2>&1 || true

    if [ -z "${MYSQL_PASSWORD:-}" ]; then
        prompt_for_rebecca_password
    fi
    MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)}"
    MYSQL_PASSWORD="${MYSQL_PASSWORD:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)}"
    local escaped_password
    escaped_password=$(sql_escape_literal "$MYSQL_PASSWORD")

    local sql_file
    sql_file=$(mktemp)
    cat > "$sql_file" <<EOF
CREATE DATABASE IF NOT EXISTS \`rebecca\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'rebecca'@'127.0.0.1' IDENTIFIED BY '${escaped_password}';
CREATE USER IF NOT EXISTS 'rebecca'@'localhost' IDENTIFIED BY '${escaped_password}';
ALTER USER 'rebecca'@'127.0.0.1' IDENTIFIED BY '${escaped_password}';
ALTER USER 'rebecca'@'localhost' IDENTIFIED BY '${escaped_password}';
GRANT ALL PRIVILEGES ON \`rebecca\`.* TO 'rebecca'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`rebecca\`.* TO 'rebecca'@'localhost';
DELETE FROM mysql.user WHERE User='';
DROP DATABASE IF EXISTS test;
FLUSH PRIVILEGES;
EOF
    if ! mysql_root_command < "$sql_file"; then
        rm -f "$sql_file"
        colorized_echo red "Failed to configure local $database_type. Make sure root can access MySQL/MariaDB through the local socket."
        exit 1
    fi
    rm -f "$sql_file"

    local mysql_password_url_encoded
    mysql_password_url_encoded=$(urlencode_value "$MYSQL_PASSWORD")
    upsert_env_assignment "REBECCA_DATABASE_FLAVOR" "$database_type"
    upsert_env_assignment "MYSQL_DATABASE" "rebecca"
    upsert_env_assignment "MYSQL_USER" "rebecca"
    upsert_env_assignment "MYSQL_PASSWORD" "$MYSQL_PASSWORD"
    upsert_env_assignment "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD"
    upsert_env_assignment "SQLALCHEMY_DATABASE_URL" "mysql+pymysql://rebecca:${mysql_password_url_encoded}@127.0.0.1:3306/rebecca"
}

configure_binary_database() {
    local database_type="${1:-sqlite}"
    case "$database_type" in
        sqlite|"")
            upsert_env_assignment "REBECCA_DATABASE_FLAVOR" "sqlite"
            upsert_env_assignment "SQLALCHEMY_DATABASE_URL" "sqlite:///${DATA_DIR}/db.sqlite3"
        ;;
        mysql|mariadb)
            install_host_database "$database_type"
        ;;
        *)
            colorized_echo red "Unsupported database type for binary install: $database_type"
            exit 1
        ;;
    esac
}

install_command() {
    check_running_as_root

    # Default values
    database_type="sqlite"
    rebecca_version="latest"
    rebecca_version_set="false"
    install_mode=""

    # Parse options
    while [[ $# -gt 0 ]]; do
        key="$1"
        case $key in
            --database)
                database_type="$2"
                shift 2
            ;;
            --dev)
                if [[ "$rebecca_version_set" == "true" ]]; then
                    colorized_echo red "Error: Cannot use --dev and --version options simultaneously."
                    exit 1
                fi
                rebecca_version="dev"
                rebecca_version_set="true"
                shift
            ;;
            --version)
                if [[ "$rebecca_version_set" == "true" ]]; then
                    colorized_echo red "Error: Cannot use --dev and --version options simultaneously."
                    exit 1
                fi
                if [ -z "${2:-}" ]; then
                    colorized_echo red "Error: --version requires a value."
                    exit 1
                fi
                rebecca_version="$2"
                rebecca_version_set="true"
                shift 2
            ;;
            --mode)
                if [ -z "${2:-}" ]; then
                    colorized_echo red "Error: --mode requires docker or binary."
                    exit 1
                fi
                install_mode=$(normalize_install_mode "$2")
                shift 2
            ;;
            --docker|--dockerized)
                install_mode="docker"
                shift
            ;;
            --binary)
                install_mode="binary"
                shift
            ;;
            *)
                echo "Unknown option: $1"
                exit 1
            ;;
        esac
    done

    # Check if rebecca is already installed
    if is_rebecca_installed; then
        colorized_echo red "Rebecca is already installed at $APP_DIR"
        read -p "Do you want to override the previous installation? (y/n) "
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            colorized_echo red "Aborted installation"
            exit 1
        fi
    fi
    install_mode=$(select_install_mode "$install_mode")
    if [[ "$rebecca_version_set" != "true" ]]; then
        rebecca_version=$(select_rebecca_version "" "$install_mode")
    fi
    set_rebecca_source_for_version "$rebecca_version"
    detect_os
    if ! command -v jq >/dev/null 2>&1; then
        install_package jq
    fi
    if ! command -v curl >/dev/null 2>&1; then
        install_package curl
    fi
    install_rebecca_script "$rebecca_version"

    if [ "$install_mode" = "docker" ]; then
        if ! command -v docker >/dev/null 2>&1; then
            install_docker
        fi
        if ! command -v yq >/dev/null 2>&1; then
            install_yq
        fi
        detect_compose
    fi

    # Function to check if a version exists in the GitHub releases
    check_version_exists() {
        local version=$1
        repo_url="https://api.github.com/repos/${REBECCA_RELEASE_REPO}/releases"
        if [ "$version" == "latest" ] || [ "$version" == "dev" ]; then
            return 0
        fi
        
        # Fetch the release data from GitHub API
        response=$(curl -s "$repo_url")
        
        # Check if the response contains the version tag
        if echo "$response" | jq -e ".[] | select(.tag_name == \"${version}\")" > /dev/null; then
            return 0
        else
            return 1
        fi
    }
    # Check if the version is valid and exists
    if [[ "$rebecca_version" == "latest" || "$rebecca_version" == "dev" || "$rebecca_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        if check_version_exists "$rebecca_version"; then
            if [ "$install_mode" = "binary" ]; then
                install_binary_rebecca "$rebecca_version" "$database_type"
            else
                install_rebecca "$rebecca_version" "$database_type"
                echo "docker" > "$INSTALL_MODE_FILE"
            fi
            write_rebecca_channel "$rebecca_version"
            echo "Installing $rebecca_version version"
        else
            echo "Version $rebecca_version does not exist. Please enter a valid version (e.g. v0.5.2)"
            exit 1
        fi
    else
        echo "Invalid version format. Please enter a valid version (e.g. v0.5.2)"
        exit 1
    fi
    prompt_ssl_setup
    up_rebecca
    follow_rebecca_logs
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


down_rebecca() {
    if is_binary_install; then
        systemctl stop "$APP_NAME.service"
        return
    fi

    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" down
}



show_rebecca_logs() {
    if is_binary_install; then
        journalctl -u "$APP_NAME.service" --no-pager
        return
    fi

    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" logs
}

rebecca_cli() {
    if is_binary_install; then
        REBECCA_ENV_FILE="$ENV_FILE" REBECCA_APP_DIR="$APP_DIR" REBECCA_DATA_DIR="$DATA_DIR" CLI_PROG_NAME="rebecca cli" "$BINARY_CLI" "$@"
        return
    fi

    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" exec -e CLI_PROG_NAME="rebecca cli" rebecca rebecca-cli "$@"
}


is_rebecca_up() {
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

uninstall_command() {
    check_running_as_root
    local install_mode
    install_mode=$(get_install_mode)
    local app_exists=0
    if is_rebecca_installed; then
        app_exists=1
    fi

    if [ "$app_exists" -eq 0 ]; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi

    read -p "Do you really want to uninstall Rebecca? (y/n) "
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        colorized_echo red "Aborted"
        exit 1
    fi

    if [ "$app_exists" -eq 1 ]; then
        if [ "$install_mode" != "binary" ]; then
            detect_compose
        fi
        if is_rebecca_up; then
            down_rebecca
        fi
    fi
    uninstall_rebecca_script

    if [ "$app_exists" -eq 1 ]; then
        uninstall_rebecca
        if [ "$install_mode" != "binary" ]; then
            uninstall_rebecca_docker_images
        fi

        read -p "Do you want to remove Rebecca's data files too ($DATA_DIR)? (y/n) "
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            colorized_echo green "Rebecca uninstalled successfully"
        else
            uninstall_rebecca_data_files
            colorized_echo green "Rebecca uninstalled successfully"
        fi
    else
        colorized_echo green "Legacy Rebecca script removed"
    fi
}

uninstall_rebecca_script() {
    if [ -f "/usr/local/bin/rebecca" ]; then
        colorized_echo yellow "Removing rebecca script"
        rm "/usr/local/bin/rebecca"
    fi
}

uninstall_rebecca() {
    if [ -f "$BINARY_SERVICE_UNIT" ]; then
        systemctl disable --now "$APP_NAME.service" >/dev/null 2>&1 || true
        rm -f "$BINARY_SERVICE_UNIT"
        systemctl daemon-reload
    fi
    if [ -f "$BINARY_CLI_LAUNCHER" ] || [ -L "$BINARY_CLI_LAUNCHER" ]; then
        rm -f "$BINARY_CLI_LAUNCHER"
    fi
    if [ -d "$APP_DIR" ]; then
        colorized_echo yellow "Removing directory: $APP_DIR"
        rm -r "$APP_DIR"
    fi
}

uninstall_rebecca_docker_images() {
    if ! command -v docker >/dev/null 2>&1; then
        return
    fi

    images=$(docker images | grep rebecca | awk '{print $3}')
    
    if [ -n "$images" ]; then
        colorized_echo yellow "Removing Docker images of Rebecca"
        for image in $images; do
            if docker rmi "$image" >/dev/null 2>&1; then
                colorized_echo yellow "Image $image removed"
            fi
        done
    fi
}

uninstall_rebecca_data_files() {
    if [ -d "$DATA_DIR" ]; then
        colorized_echo yellow "Removing directory: $DATA_DIR"
        rm -r "$DATA_DIR"
    fi
}

restart_command() {
    help() {
        colorized_echo red "Usage: rebecca restart [options]"
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
    
    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    down_rebecca
    up_rebecca
    if [ "$no_logs" = false ]; then
        follow_rebecca_logs
    fi
    colorized_echo green "Rebecca successfully restarted!"
}
logs_command() {
    help() {
        colorized_echo red "Usage: rebecca logs [options]"
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
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_up; then
        colorized_echo red "Rebecca is not up."
        exit 1
    fi
    
    if [ "$no_follow" = true ]; then
        show_rebecca_logs
    else
        follow_rebecca_logs
    fi
}

down_command() {
    
    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_up; then
        colorized_echo red "Rebecca's already down"
        exit 1
    fi
    
    down_rebecca
}

cli_command() {
    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if ! is_rebecca_up; then
        colorized_echo red "Rebecca is not up."
        exit 1
    fi
    
    rebecca_cli "$@"
}

up_command() {
    help() {
        colorized_echo red "Usage: rebecca up [options]"
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
    
    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi
    
    if ! is_binary_install; then
        detect_compose
    fi
    
    if is_rebecca_up; then
        colorized_echo red "Rebecca's already up"
        exit 1
    fi
    
    up_rebecca
    if [ "$no_logs" = false ]; then
        follow_rebecca_logs
    fi
}

update_command() {
    check_running_as_root
    local rebecca_version=""
    local rebecca_version_set="false"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dev)
                if [[ "$rebecca_version_set" == "true" ]]; then
                    colorized_echo red "Error: Cannot use --dev and --version options simultaneously."
                    exit 1
                fi
                rebecca_version="dev"
                rebecca_version_set="true"
                shift
                ;;
            --version)
                if [[ "$rebecca_version_set" == "true" ]]; then
                    colorized_echo red "Error: Cannot use --dev and --version options simultaneously."
                    exit 1
                fi
                if [ -z "${2:-}" ]; then
                    colorized_echo red "Error: --version requires a value."
                    exit 1
                fi
                rebecca_version="$2"
                rebecca_version_set="true"
                shift 2
                ;;
            -h|--help)
                colorized_echo red "Usage: rebecca update [--dev | --version vX.Y.Z]"
                exit 0
                ;;
            *)
                colorized_echo red "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Check if rebecca is installed
    if ! is_rebecca_installed; then
        colorized_echo red "Rebecca's not installed!"
        exit 1
    fi

    if [[ "$rebecca_version_set" != "true" ]]; then
        rebecca_version=$(get_installed_rebecca_channel)
    fi
    set_rebecca_source_for_version "$rebecca_version"

    if ! is_binary_install; then
        detect_compose
    fi
    
    colorized_echo blue "Updating Rebecca CLI..."
    update_rebecca_script "$rebecca_version"

    colorized_echo blue "Updating requested version: $rebecca_version"
    update_rebecca "$rebecca_version"
    write_rebecca_channel "$rebecca_version"
    
    colorized_echo blue "Restarting Rebecca's services"
    down_rebecca
    if ! is_binary_install; then
        prune_unused_docker_images
    fi
    up_rebecca
    
    colorized_echo blue "Rebecca updated successfully"
}

update_rebecca_script() {
    local source_version="${1:-}"
    if [ -n "$source_version" ]; then
        set_rebecca_source_for_version "$source_version"
    elif is_rebecca_installed; then
        set_rebecca_source_for_version "$(get_installed_rebecca_channel)"
    fi
    SCRIPT_URL="$REBECCA_SCRIPT_BASE_URL/rebecca.sh"
    colorized_echo blue "Updating rebecca script"
    curl -fsSL "$SCRIPT_URL" | install -m 755 /dev/stdin /usr/local/bin/rebecca
    colorized_echo green "rebecca script updated successfully"
}

set_compose_rebecca_image_tag() {
    local rebecca_version="$1"

    if ! command -v yq >/dev/null 2>&1; then
        install_yq
    fi

    if [ "$rebecca_version" = "latest" ]; then
        yq -i '.services.rebecca.image = "rebeccapanel/rebecca:latest"' "$COMPOSE_FILE"
    else
        yq -i ".services.rebecca.image = \"rebeccapanel/rebecca:${rebecca_version}\"" "$COMPOSE_FILE"
    fi
}

update_rebecca() {
    local rebecca_version="${1:-latest}"

    if is_binary_install; then
        install_binary_rebecca "$rebecca_version" "$(get_configured_database_type)" "0"
        return
    fi

    set_compose_rebecca_image_tag "$rebecca_version"
    $COMPOSE -f $COMPOSE_FILE -p "$APP_NAME" pull
}

migration_sqlite_path() {
    local db_url
    db_url=$(get_env_value "SQLALCHEMY_DATABASE_URL")
    case "$db_url" in
        sqlite:////*)
            printf "/%s\n" "${db_url#sqlite:////}"
        ;;
        sqlite:///*)
            printf "%s\n" "${db_url#sqlite:///}"
        ;;
        *)
            printf "%s/db.sqlite3\n" "$DATA_DIR"
        ;;
    esac
}

detect_docker_database_type() {
    if [ -f "$COMPOSE_FILE" ] && grep -qi "image:.*mariadb" "$COMPOSE_FILE"; then
        echo "mariadb"
    elif [ -f "$COMPOSE_FILE" ] && grep -qi "image:.*mysql" "$COMPOSE_FILE"; then
        echo "mysql"
    else
        local db_url
        db_url=$(get_env_value "SQLALCHEMY_DATABASE_URL")
        if [[ "$db_url" == mysql* ]]; then
            echo "mysql"
        else
            echo "sqlite"
        fi
    fi
}

dump_docker_database() {
    local database_type="$1"
    local backup_dir="$2"
    local root_password
    local container_id

    case "$database_type" in
        mysql)
            root_password=$(get_env_value "MYSQL_ROOT_PASSWORD")
            container_id=$($COMPOSE -f "$COMPOSE_FILE" -p "$APP_NAME" ps -q mysql)
            if [ -z "$container_id" ]; then
                colorized_echo red "MySQL container not found."
                exit 1
            fi
            docker exec "$container_id" mysqldump -uroot -p"$root_password" --single-transaction --routines --events --triggers rebecca > "$backup_dir/db.sql"
        ;;
        mariadb)
            root_password=$(get_env_value "MYSQL_ROOT_PASSWORD")
            container_id=$($COMPOSE -f "$COMPOSE_FILE" -p "$APP_NAME" ps -q mariadb)
            if [ -z "$container_id" ]; then
                colorized_echo red "MariaDB container not found."
                exit 1
            fi
            docker exec "$container_id" sh -c 'command -v mariadb-dump >/dev/null 2>&1 && exec mariadb-dump "$@" || exec mysqldump "$@"' sh -uroot -p"$root_password" --single-transaction --routines --events --triggers rebecca > "$backup_dir/db.sql"
        ;;
        sqlite)
            local sqlite_path
            sqlite_path=$(migration_sqlite_path)
            if [ ! -f "$sqlite_path" ]; then
                colorized_echo red "SQLite database not found at $sqlite_path"
                exit 1
            fi
            cp "$sqlite_path" "$backup_dir/db.sqlite3"
        ;;
    esac
}

import_binary_database_backup() {
    local database_type="$1"
    local backup_dir="$2"
    case "$database_type" in
        sqlite)
            if [ -f "$backup_dir/db.sqlite3" ]; then
                mkdir -p "$DATA_DIR"
                install -m 600 "$backup_dir/db.sqlite3" "$DATA_DIR/db.sqlite3"
            fi
        ;;
        mysql|mariadb)
            if [ -f "$backup_dir/db.sql" ]; then
                mysql_root_command -e "DROP DATABASE IF EXISTS \`rebecca\`; CREATE DATABASE \`rebecca\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
                mysql_root_command rebecca < "$backup_dir/db.sql"
            fi
        ;;
    esac
}

migrate_docker_to_binary_command() {
    check_running_as_root
    local rebecca_version=""
    local rebecca_version_set="false"
    local yes="false"
    local database_type=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dev)
                rebecca_version="dev"
                rebecca_version_set="true"
                shift
            ;;
            --version)
                rebecca_version="$2"
                rebecca_version_set="true"
                shift 2
            ;;
            --database)
                database_type="$2"
                shift 2
            ;;
            -y|--yes)
                yes="true"
                shift
            ;;
            -h|--help)
                colorized_echo red "Usage: rebecca migrate-binary [--database sqlite|mysql|mariadb] [--dev | --version vX.Y.Z] [-y]"
                exit 0
            ;;
            *)
                colorized_echo red "Unknown option: $1"
                exit 1
            ;;
        esac
    done

    if ! is_rebecca_installed || [ ! -f "$COMPOSE_FILE" ]; then
        colorized_echo red "Docker installation not found at $APP_DIR"
        exit 1
    fi
    if is_binary_install; then
        colorized_echo yellow "Rebecca is already in binary mode."
        exit 0
    fi
    if [ "$rebecca_version_set" != "true" ]; then
        rebecca_version=$(get_installed_rebecca_channel)
    fi
    database_type="${database_type:-$(detect_docker_database_type)}"
    case "$database_type" in
        sqlite|mysql|mariadb) ;;
        *)
            colorized_echo red "Unsupported database type: $database_type"
            exit 1
        ;;
    esac

    if [ "$yes" != "true" ]; then
        colorized_echo yellow "This will migrate Rebecca from Docker to binary mode using $database_type."
        read -p "Continue? (y/n) "
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            colorized_echo red "Aborted"
            exit 1
        fi
    fi

    detect_compose
    local backup_dir="/opt/rebecca-docker-to-binary-backups/$(date -u +%Y%m%d%H%M%S)"
    mkdir -p "$backup_dir"
    cp "$ENV_FILE" "$backup_dir/.env" 2>/dev/null || true
    cp "$COMPOSE_FILE" "$backup_dir/docker-compose.yml" 2>/dev/null || true
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --exclude mysql --exclude xray-core "$DATA_DIR/" "$backup_dir/rebecca-data/" 2>/dev/null || true
    else
        mkdir -p "$backup_dir/rebecca-data"
        cp -a "$DATA_DIR/." "$backup_dir/rebecca-data/" 2>/dev/null || true
        rm -rf "$backup_dir/rebecca-data/mysql" "$backup_dir/rebecca-data/xray-core" 2>/dev/null || true
    fi

    if [ "$database_type" = "sqlite" ] && is_rebecca_up; then
        down_rebecca
    fi
    if [ "$database_type" != "sqlite" ] && ! is_rebecca_up; then
        up_rebecca
        sleep 8
    fi

    colorized_echo blue "Dumping Docker database to $backup_dir"
    dump_docker_database "$database_type" "$backup_dir"

    if is_rebecca_up; then
        down_rebecca
    fi
    mv "$COMPOSE_FILE" "$COMPOSE_FILE.docker-migrated" 2>/dev/null || true

    colorized_echo blue "Installing Rebecca binary files"
    MYSQL_PASSWORD="${MYSQL_PASSWORD:-$(get_env_value "MYSQL_PASSWORD")}"
    MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$(get_env_value "MYSQL_ROOT_PASSWORD")}"
    install_binary_rebecca "$rebecca_version" "$database_type"

    colorized_echo blue "Importing database backup into binary installation"
    import_binary_database_backup "$database_type" "$backup_dir"

    write_rebecca_channel "$rebecca_version"
    echo "binary" > "$INSTALL_MODE_FILE"
    up_rebecca
    colorized_echo green "Migration to binary mode completed. Backup kept at $backup_dir"
}

prune_unused_docker_images() {
    colorized_echo blue "Removing old and unused Docker images"
    if docker image prune -a -f >/dev/null 2>&1; then
        colorized_echo green "Unused Docker images removed successfully"
    else
        colorized_echo yellow "Unable to prune Docker images; continuing update"
    fi
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
        mkdir -p "$(dirname "$ENV_FILE")"
        touch "$ENV_FILE"
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

edit_env_command() {
    detect_os
    check_editor
    if [ -f "$ENV_FILE" ]; then
        $EDITOR "$ENV_FILE"
    else
        colorized_echo red "Environment file not found at $ENV_FILE"
        exit 1
    fi
}

print_menu() {
    colorized_echo blue "=============================="
    colorized_echo magenta "           Rebecca Menu"
    colorized_echo blue "=============================="
    local entries=(
        "up:Start services"
        "down:Stop services"
        "restart:Restart services"
        "status:Show status"
        "logs:Show logs"
        "cli:Rebecca CLI"
        "install:Install Rebecca"
        "update:Update to latest version"
        "uninstall:Uninstall Rebecca"
        "script-install:Install Rebecca script"
        "script-update:Update Rebecca CLI script"
        "script-uninstall:Uninstall Rebecca script"
        "backup:Manual backup launch"
        "backup-service:Backup service (Telegram + cron job)"
        "migrate-binary:Migrate Docker install to binary"
        "core-update:Update/Change Xray core"
        "enable-phpmyadmin:Add phpMyAdmin to docker-compose and restart services"
        "edit:Edit docker-compose.yml"
        "edit-env:Edit environment file"
        "ssl:Issue or renew SSL certificates"
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
        6) echo "cli" ;;
        7) echo "install" ;;
        8) echo "update" ;;
        9) echo "uninstall" ;;
        10) echo "script-install" ;;
        11) echo "script-update" ;;
        12) echo "script-uninstall" ;;
        13) echo "backup" ;;
        14) echo "backup-service" ;;
        15) echo "migrate-binary" ;;
        16) echo "core-update" ;;
        17) echo "enable-phpmyadmin" ;;
        18) echo "edit" ;;
        19) echo "edit-env" ;;
        20) echo "ssl" ;;
        21) echo "help" ;;
        *) echo "$1" ;;
    esac
}

usage() {
    local script_name="${0##*/}"
    colorized_echo blue "=============================="
    colorized_echo magenta "           Rebecca Help"
    colorized_echo blue "=============================="
    colorized_echo cyan "Usage:"
    echo "  ${script_name} [command]"
    echo

    colorized_echo cyan "Commands:"
    colorized_echo yellow "  up              $(tput sgr0)– Start services"
    colorized_echo yellow "  down            $(tput sgr0)– Stop services"
    colorized_echo yellow "  restart         $(tput sgr0)– Restart services"
    colorized_echo yellow "  status          $(tput sgr0)– Show status"
    colorized_echo yellow "  logs            $(tput sgr0)- Show logs"
    colorized_echo yellow "  cli             $(tput sgr0)- Rebecca CLI"
    colorized_echo yellow "  install         $(tput sgr0)- Install Rebecca"
    colorized_echo yellow "  update          $(tput sgr0)- Update to latest/dev or a specific release"
    colorized_echo yellow "  uninstall       $(tput sgr0)- Uninstall Rebecca"
    colorized_echo yellow "  script-install  $(tput sgr0)- Install Rebecca script"
    colorized_echo yellow "  script-update   $(tput sgr0)- Update Rebecca CLI script"
    colorized_echo yellow "  script-uninstall  $(tput sgr0)- Uninstall Rebecca script"
    colorized_echo yellow "  backup          $(tput sgr0)- Manual backup launch"
    colorized_echo yellow "  backup-service  $(tput sgr0)- Rebecca Backupservice to backup to TG, and a new job in crontab"
    colorized_echo yellow "  migrate-binary  $(tput sgr0)- Migrate Docker install to binary"
    colorized_echo yellow "  core-update     $(tput sgr0)- Update/Change Xray core"
    colorized_echo yellow "  enable-phpmyadmin $(tput sgr0)- Add phpMyAdmin to docker-compose.yml and restart services"
    colorized_echo yellow "  edit            $(tput sgr0)- Edit docker-compose.yml (via nano or vi editor)"
    colorized_echo yellow "  edit-env        $(tput sgr0)- Edit environment file (via nano or vi editor)"
    colorized_echo yellow "  ssl             $(tput sgr0)- Issue or renew SSL certificates"
    colorized_echo yellow "  help            $(tput sgr0)- Show this help message"
    
    
    echo
    colorized_echo cyan "Directories:"
    colorized_echo magenta "  App directory: $APP_DIR"
    colorized_echo magenta "  Data directory: $DATA_DIR"
    echo
    colorized_echo cyan "Install options:"
    colorized_echo magenta "  --mode docker|binary"
    colorized_echo magenta "  --database sqlite|mysql|mariadb"
    colorized_echo magenta "  --dev or --version vX.Y.Z (install/update)"
    echo
    current_version=$(get_current_xray_core_version)
    colorized_echo cyan "Current Xray-core version: $current_version"
    colorized_echo blue "================================"
    echo
}

dispatch_command() {
    local cmd="$1"
    shift || true
    case "$cmd" in
        up) up_command "$@" ;;
        down) down_command "$@" ;;
        restart) restart_command "$@" ;;
        status) status_command "$@" ;;
        logs) logs_command "$@" ;;
        cli) cli_command "$@" ;;
        backup) backup_command "$@" ;;
        backup-service) backup_service "$@" ;;
        migrate-binary|migrate-to-binary) migrate_docker_to_binary_command "$@" ;;
        install) install_command "$@" ;;
        update) update_command "$@" ;;
        uninstall) uninstall_command "$@" ;;
        script-install|install-script) install_rebecca_script "$@" ;;
        script-update|update-script) install_rebecca_script "$@" ;;
        script-uninstall|uninstall-script) uninstall_rebecca_script "$@" ;;
        core-update) update_core_command "$@" ;;
        enable-phpmyadmin) enable_phpmyadmin "$@" ;;
        ssl) ssl_command "$@" ;;
        edit) edit_command "$@" ;;
        edit-env) edit_env_command "$@" ;;
        help) usage ;;
        *) usage ;;
    esac
}

if [ $# -eq 0 ]; then
    print_menu
    read -rp "Select option (number or command): " user_choice
    if [ -z "$user_choice" ]; then
        exit 0
    fi
    mapped_command=$(map_choice_to_command "$user_choice")
    set -- $mapped_command
fi

dispatch_command "$@"
