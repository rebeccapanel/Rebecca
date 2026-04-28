import json
import os
import sys
from pathlib import Path

from decouple import config
from dotenv import find_dotenv, load_dotenv


def _iter_env_candidates():
    explicit_env_file = (os.getenv("REBECCA_ENV_FILE") or "").strip()
    if explicit_env_file:
        yield Path(explicit_env_file).expanduser()

    argv0 = (sys.argv[0] or "").strip()
    if argv0:
        script_path = Path(argv0).expanduser()
        if script_path.exists():
            resolved_script = script_path.resolve()
            yield resolved_script.parent / ".env"
            yield resolved_script.parent.parent / ".env"

    if getattr(sys, "frozen", False):
        executable_path = Path(sys.executable).resolve()
        yield executable_path.parent / ".env"
        yield executable_path.parent.parent / ".env"

    yield Path.cwd() / ".env"
    yield Path(__file__).resolve().with_name(".env")

    discovered = find_dotenv(usecwd=True)
    if discovered:
        yield Path(discovered)


def _load_environment_file() -> Path | None:
    seen_paths: set[str] = set()
    for candidate in _iter_env_candidates():
        candidate = candidate.expanduser()
        try:
            resolved_candidate = candidate.resolve()
        except OSError:
            resolved_candidate = candidate

        normalized = str(resolved_candidate)
        if normalized in seen_paths:
            continue
        seen_paths.add(normalized)

        if resolved_candidate.is_file():
            load_dotenv(dotenv_path=resolved_candidate, override=False)
            return resolved_candidate

    return None


LOADED_ENV_FILE = _load_environment_file()


def _cast_bool_compat(value):
    if isinstance(value, bool):
        return value

    normalized = str(value).strip().lower()
    if normalized in {"", "0", "false", "no", "off", "release", "prod", "production"}:
        return False
    if normalized in {"1", "true", "yes", "on", "debug", "dev", "development"}:
        return True

    raise ValueError(f"Invalid truth value: {value}")


SQLALCHEMY_DATABASE_URL = config("SQLALCHEMY_DATABASE_URL", default="sqlite:///db.sqlite3")
SQLALCHEMY_POOL_SIZE = config("SQLALCHEMY_POOL_SIZE", cast=int, default=50)
SQLALCHEMY_MAX_OVERFLOW = config("SQLALCHEMY_MAX_OVERFLOW", cast=int, default=100)

UVICORN_HOST = config("UVICORN_HOST", default="::")
UVICORN_PORT = config("UVICORN_PORT", cast=int, default=8000)
UVICORN_UDS = config("UVICORN_UDS", default=None)
UVICORN_SSL_CERTFILE = config("UVICORN_SSL_CERTFILE", default=None)
UVICORN_SSL_KEYFILE = config("UVICORN_SSL_KEYFILE", default=None)
UVICORN_SSL_CA_TYPE = config("UVICORN_SSL_CA_TYPE", default="public").lower()
DASHBOARD_PATH = config("DASHBOARD_PATH", default="/dashboard/")

DEBUG = config("DEBUG", default=False, cast=_cast_bool_compat)
DOCS = config("DOCS", default=False, cast=_cast_bool_compat)

ALLOWED_ORIGINS = config("ALLOWED_ORIGINS", default="*").split(",")

VITE_BASE_API = (
    f"http://127.0.0.1:{UVICORN_PORT}/api/"
    if DEBUG and config("VITE_BASE_API", default="/api/") == "/api/"
    else config("VITE_BASE_API", default="/api/")
)

XRAY_FALLBACKS_INBOUND_TAG = config("XRAY_FALLBACKS_INBOUND_TAG", cast=str, default="") or config(
    "XRAY_FALLBACK_INBOUND_TAG", cast=str, default=""
)
REBECCA_DATA_DIR = Path(config("REBECCA_DATA_DIR", default="/var/lib/rebecca")).expanduser()
PERSISTENT_XRAY_DIR = REBECCA_DATA_DIR / "xray-core"
PERSISTENT_XRAY_EXECUTABLE = PERSISTENT_XRAY_DIR / "xray"


def _resolve_xray_executable_path() -> str:
    configured = (os.getenv("XRAY_EXECUTABLE_PATH") or "").strip()
    # In container deployments, always prefer persisted host-mounted core if present.
    if PERSISTENT_XRAY_EXECUTABLE.exists():
        return str(PERSISTENT_XRAY_EXECUTABLE)
    if configured:
        return configured
    return str(PERSISTENT_XRAY_EXECUTABLE)


def _resolve_xray_assets_path() -> str:
    configured = (os.getenv("XRAY_ASSETS_PATH") or "").strip()
    persistent_candidates = [PERSISTENT_XRAY_DIR, REBECCA_DATA_DIR / "assets"]
    for candidate in persistent_candidates:
        if (candidate / "geoip.dat").exists() or (candidate / "geosite.dat").exists():
            return str(candidate)
    if configured:
        return configured
    return str(PERSISTENT_XRAY_DIR)


XRAY_EXECUTABLE_PATH = _resolve_xray_executable_path()
XRAY_ASSETS_PATH = _resolve_xray_assets_path()
XRAY_EXCLUDE_INBOUND_TAGS = config("XRAY_EXCLUDE_INBOUND_TAGS", default="").split()
XRAY_SUBSCRIPTION_URL_PREFIX = ""  # subscription prefix now comes from DB
XRAY_SUBSCRIPTION_PATH = config("XRAY_SUBSCRIPTION_PATH", default="sub").strip("/")
XRAY_JSON = config("XRAY_JSON", default="/var/lib/rebecca/xray_config.json")
XRAY_LOG_DIR = config("XRAY_LOG_DIR", default="").strip()

ADS_SOURCE_URL = "https://raw.githubusercontent.com/rebeccapanel/rebecca-ads/main/ads.json"
ADS_CACHE_TTL_SECONDS = 86400  # 24 hours
ADS_FETCH_TIMEOUT_SECONDS = 15

JWT_ACCESS_TOKEN_EXPIRE_MINUTES = config("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", cast=int, default=1440)

CUSTOM_TEMPLATES_DIRECTORY = config("CUSTOM_TEMPLATES_DIRECTORY", default=None)
SUBSCRIPTION_PAGE_TEMPLATE = config("SUBSCRIPTION_PAGE_TEMPLATE", default="subscription/index.html")
HOME_PAGE_TEMPLATE = config("HOME_PAGE_TEMPLATE", default="home/index.html")

CLASH_SUBSCRIPTION_TEMPLATE = config("CLASH_SUBSCRIPTION_TEMPLATE", default="clash/default.yml")
CLASH_SETTINGS_TEMPLATE = config("CLASH_SETTINGS_TEMPLATE", default="clash/settings.yml")

SINGBOX_SUBSCRIPTION_TEMPLATE = config("SINGBOX_SUBSCRIPTION_TEMPLATE", default="singbox/default.json")
SINGBOX_SETTINGS_TEMPLATE = config("SINGBOX_SETTINGS_TEMPLATE", default="singbox/settings.json")

MUX_TEMPLATE = config("MUX_TEMPLATE", default="mux/default.json")

V2RAY_SUBSCRIPTION_TEMPLATE = config("V2RAY_SUBSCRIPTION_TEMPLATE", default="v2ray/default.json")
V2RAY_SETTINGS_TEMPLATE = config("V2RAY_SETTINGS_TEMPLATE", default="v2ray/settings.json")

USER_AGENT_TEMPLATE = config("USER_AGENT_TEMPLATE", default="user_agent/default.json")
GRPC_USER_AGENT_TEMPLATE = config("GRPC_USER_AGENT_TEMPLATE", default="user_agent/grpc.json")

EXTERNAL_CONFIG = config("EXTERNAL_CONFIG", default="", cast=str)
LOGIN_NOTIFY_WHITE_LIST = [
    ip.strip() for ip in config("LOGIN_NOTIFY_WHITE_LIST", default="", cast=str).split(",") if ip.strip()
]

USE_CUSTOM_JSON_DEFAULT = config("USE_CUSTOM_JSON_DEFAULT", default=False, cast=_cast_bool_compat)
USE_CUSTOM_JSON_FOR_V2RAYN = config("USE_CUSTOM_JSON_FOR_V2RAYN", default=False, cast=_cast_bool_compat)
USE_CUSTOM_JSON_FOR_V2RAYNG = config("USE_CUSTOM_JSON_FOR_V2RAYNG", default=False, cast=_cast_bool_compat)
USE_CUSTOM_JSON_FOR_STREISAND = config("USE_CUSTOM_JSON_FOR_STREISAND", default=False, cast=_cast_bool_compat)
USE_CUSTOM_JSON_FOR_HAPP = config("USE_CUSTOM_JSON_FOR_HAPP", default=False, cast=_cast_bool_compat)

ACTIVE_STATUS_TEXT = config("ACTIVE_STATUS_TEXT", default="Active")

EXPIRED_STATUS_TEXT = config("EXPIRED_STATUS_TEXT", default="Expired")
LIMITED_STATUS_TEXT = config("LIMITED_STATUS_TEXT", default="Limited")
DISABLED_STATUS_TEXT = config("DISABLED_STATUS_TEXT", default="Disabled")
ONHOLD_STATUS_TEXT = config("ONHOLD_STATUS_TEXT", default="On-Hold")

USERS_AUTODELETE_DAYS = config("USERS_AUTODELETE_DAYS", default=-1, cast=int)
USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS = config(
    "USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS", default=False, cast=_cast_bool_compat
)


# USERNAME: PASSWORD
SUDOERS = (
    {config("SUDO_USERNAME"): config("SUDO_PASSWORD")}
    if config("SUDO_USERNAME", default="") and config("SUDO_PASSWORD", default="")
    else {}
)


WEBHOOK_ADDRESS = config(
    "WEBHOOK_ADDRESS",
    default="",
    cast=lambda v: [address.strip() for address in v.split(",")] if v else [],
)
WEBHOOK_SECRET = config("WEBHOOK_SECRET", default=None)

# recurrent notifications

# timeout between each retry of sending a notification in seconds
RECURRENT_NOTIFICATIONS_TIMEOUT = config("RECURRENT_NOTIFICATIONS_TIMEOUT", default=180, cast=int)
# how many times to try after ok response not recevied after sending a notifications
NUMBER_OF_RECURRENT_NOTIFICATIONS = config("NUMBER_OF_RECURRENT_NOTIFICATIONS", default=3, cast=int)

DISABLE_RECORDING_NODE_USAGE = config("DISABLE_RECORDING_NODE_USAGE", cast=_cast_bool_compat, default=False)

# headers: profile-update-interval, support-url, profile-title (DB-driven; keep static defaults)
SUB_UPDATE_INTERVAL = "12"
SUB_SUPPORT_URL = "https://t.me/"
SUB_PROFILE_TITLE = "Subscription"

# Interval jobs, all values are in seconds
JOB_CORE_HEALTH_CHECK_INTERVAL = config("JOB_CORE_HEALTH_CHECK_INTERVAL", cast=int, default=10)
JOB_RECORD_NODE_USAGES_INTERVAL = config("JOB_RECORD_NODE_USAGES_INTERVAL", cast=int, default=30)
NODE_HEALTH_CACHE_SECONDS = config("NODE_HEALTH_CACHE_SECONDS", cast=int, default=60)
JOB_RECORD_USER_USAGES_INTERVAL = config("JOB_RECORD_USER_USAGES_INTERVAL", cast=int, default=10)
JOB_REVIEW_USERS_INTERVAL = config("JOB_REVIEW_USERS_INTERVAL", cast=int, default=10)
JOB_SEND_NOTIFICATIONS_INTERVAL = config("JOB_SEND_NOTIFICATIONS_INTERVAL", cast=int, default=30)
JOB_REVIEW_USERS_BATCH_SIZE = config("JOB_REVIEW_USERS_BATCH_SIZE", cast=int, default=200)


def _parse_xray_hosts():
    raw = config("XRAY_HOSTS", default="").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                normalized = []
                for item in parsed:
                    if isinstance(item, dict) and "hostname" in item:
                        remark = item.get("remark", item["hostname"])
                        hostname = item["hostname"]
                        normalized.append({"remark": remark, "hostname": hostname})
                    elif isinstance(item, str):
                        normalized.append({"remark": item, "hostname": item})
                if normalized:
                    return normalized
        except json.JSONDecodeError:
            pass

    fallback_host = config("XRAY_HOST", default=config("XRAY_HOSTNAME", default="")).strip()
    if fallback_host:
        return [{"remark": fallback_host, "hostname": fallback_host}]
    return []


XRAY_HOSTS = _parse_xray_hosts()
