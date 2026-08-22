#!/usr/bin/env bash
set -e

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_PATH="$SCRIPT_DIR/rebecca-binary.sh"

new_fixture() {
    local root="$1"
    mkdir -p "$root/mysql.conf.d"
    printf '[mysqld]\nbind-address=127.0.0.1\n' > "$root/mysql.conf.d/rebecca.cnf"
}

test_dedicated_database() (
    local root
    root=$(mktemp -d)
    trap 'rm -rf "$root"' EXIT
    new_fixture "$root"
    export REBECCA_SOURCE_ONLY=1 REBECCA_MYSQL_CONFIG_ROOT="$root"
    source "$SCRIPT_PATH"

    local restarted=0 purged=0
    is_binary_install() { return 0; }
    managed_database_url_is_local() { return 0; }
    get_configured_database_type() { echo mysql; }
    mysql_root_command() {
        case "$*" in
            *"COUNT(*)"*) echo 0 ;;
            *"gtid_mode"*) echo OFF ;;
            *"@@GLOBAL.log_bin"*)
                if [ "$restarted" = "1" ]; then echo 0; else echo 1; fi
            ;;
            *"PURGE BINARY LOGS"*) purged=1 ;;
            *"SELECT 1"*) echo 1 ;;
            *) return 0 ;;
        esac
    }
    restart_managed_database() { restarted=1; }
    wait_for_managed_database() { return 0; }

    disable_managed_database_binary_log >/dev/null
    grep -qx 'skip-log-bin' "$root/mysql.conf.d/rebecca.cnf"
    [ "$purged" = "1" ]
    [ "$restarted" = "1" ]
)

test_shared_database_is_untouched() (
    local root before
    root=$(mktemp -d)
    trap 'rm -rf "$root"' EXIT
    new_fixture "$root"
    before=$(cat "$root/mysql.conf.d/rebecca.cnf")
    export REBECCA_SOURCE_ONLY=1 REBECCA_MYSQL_CONFIG_ROOT="$root"
    source "$SCRIPT_PATH"

    is_binary_install() { return 0; }
    managed_database_url_is_local() { return 0; }
    get_configured_database_type() { echo mysql; }
    mysql_root_command() {
        case "$*" in
            *"COUNT(*)"*) echo 1 ;;
            *) return 1 ;;
        esac
    }

    disable_managed_database_binary_log >/dev/null
    [ "$(cat "$root/mysql.conf.d/rebecca.cnf")" = "$before" ]
)

test_replication_database_is_untouched() (
    local root before
    root=$(mktemp -d)
    trap 'rm -rf "$root"' EXIT
    new_fixture "$root"
    printf '[mysqld]\nserver-id=12\n' > "$root/mysql.conf.d/replication.cnf"
    before=$(cat "$root/mysql.conf.d/rebecca.cnf")
    export REBECCA_SOURCE_ONLY=1 REBECCA_MYSQL_CONFIG_ROOT="$root"
    source "$SCRIPT_PATH"

    is_binary_install() { return 0; }
    managed_database_url_is_local() { return 0; }
    get_configured_database_type() { echo mysql; }
    mysql_root_command() {
        case "$*" in
            *"COUNT(*)"*) echo 0 ;;
            *) return 1 ;;
        esac
    }

    disable_managed_database_binary_log >/dev/null
    [ "$(cat "$root/mysql.conf.d/rebecca.cnf")" = "$before" ]
)

test_failed_restart_restores_config() (
    local root before
    root=$(mktemp -d)
    trap 'rm -rf "$root"' EXIT
    new_fixture "$root"
    before=$(cat "$root/mysql.conf.d/rebecca.cnf")
    export REBECCA_SOURCE_ONLY=1 REBECCA_MYSQL_CONFIG_ROOT="$root"
    source "$SCRIPT_PATH"

    is_binary_install() { return 0; }
    managed_database_url_is_local() { return 0; }
    get_configured_database_type() { echo mysql; }
    mysql_root_command() {
        case "$*" in
            *"COUNT(*)"*) echo 0 ;;
            *"gtid_mode"*) echo OFF ;;
            *"@@GLOBAL.log_bin"*) echo 1 ;;
            *"PURGE BINARY LOGS"*) return 0 ;;
            *) return 0 ;;
        esac
    }
    restart_managed_database() { return 1; }

    if disable_managed_database_binary_log >/dev/null; then
        return 1
    fi
    [ "$(cat "$root/mysql.conf.d/rebecca.cnf")" = "$before" ]
)

test_external_database_is_rejected() (
    export REBECCA_SOURCE_ONLY=1
    source "$SCRIPT_PATH"
    get_env_value() { echo 'mysql+pymysql://rebecca:secret@db.example.com:3306/rebecca'; }
    ! managed_database_url_is_local
)

test_dedicated_database
test_shared_database_is_untouched
test_replication_database_is_untouched
test_failed_restart_restores_config
test_external_database_is_rejected
echo "database maintenance tests passed"
