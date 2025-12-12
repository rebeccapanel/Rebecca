import json

from decouple import config
from dotenv import load_dotenv

load_dotenv()


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

DEBUG = config("DEBUG", default=False, cast=bool)
DOCS = config("DOCS", default=False, cast=bool)

ALLOWED_ORIGINS = config("ALLOWED_ORIGINS", default="*").split(",")

VITE_BASE_API = (
    f"http://127.0.0.1:{UVICORN_PORT}/api/"
    if DEBUG and config("VITE_BASE_API", default="/api/") == "/api/"
    else config("VITE_BASE_API", default="/api/")
)

XRAY_FALLBACKS_INBOUND_TAG = config("XRAY_FALLBACKS_INBOUND_TAG", cast=str, default="") or config(
    "XRAY_FALLBACK_INBOUND_TAG", cast=str, default=""
)
XRAY_EXECUTABLE_PATH = config("XRAY_EXECUTABLE_PATH", default="/usr/local/bin/xray")
XRAY_ASSETS_PATH = config("XRAY_ASSETS_PATH", default="/usr/local/share/xray")
XRAY_EXCLUDE_INBOUND_TAGS = config("XRAY_EXCLUDE_INBOUND_TAGS", default="").split()
XRAY_SUBSCRIPTION_URL_PREFIX = config("XRAY_SUBSCRIPTION_URL_PREFIX", default="").strip("/")
XRAY_SUBSCRIPTION_PATH = config("XRAY_SUBSCRIPTION_PATH", default="sub").strip("/")
XRAY_JSON = config("XRAY_JSON", default="/var/lib/rebecca/xray_config.json")
XRAY_LOG_DIR = config("XRAY_LOG_DIR", default="").strip()
MAINTENANCE_API_BASE_URL = config("MAINTENANCE_API_BASE_URL", default="http://127.0.0.1:3000").rstrip("/")
NODE_MAINTENANCE_API_BASE_URL = config("NODE_MAINTENANCE_API_BASE_URL", default="http://127.0.0.1:3100").rstrip("/")

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

USE_CUSTOM_JSON_DEFAULT = config("USE_CUSTOM_JSON_DEFAULT", default=False, cast=bool)
USE_CUSTOM_JSON_FOR_V2RAYN = config("USE_CUSTOM_JSON_FOR_V2RAYN", default=False, cast=bool)
USE_CUSTOM_JSON_FOR_V2RAYNG = config("USE_CUSTOM_JSON_FOR_V2RAYNG", default=False, cast=bool)
USE_CUSTOM_JSON_FOR_STREISAND = config("USE_CUSTOM_JSON_FOR_STREISAND", default=False, cast=bool)
USE_CUSTOM_JSON_FOR_HAPP = config("USE_CUSTOM_JSON_FOR_HAPP", default=False, cast=bool)

ACTIVE_STATUS_TEXT = config("ACTIVE_STATUS_TEXT", default="Active")

# Redis configuration
REDIS_ENABLED = config("REDIS_ENABLED", cast=bool, default=False)
REDIS_HOST = config("REDIS_HOST", default="127.0.0.1")
REDIS_PORT = config("REDIS_PORT", cast=int, default=6379)
REDIS_DB = config("REDIS_DB", cast=int, default=0)
REDIS_PASSWORD = config("REDIS_PASSWORD", default=None)
REDIS_AUTO_START = config("REDIS_AUTO_START", cast=bool, default=False)
_redis_enabled = config("REDIS_ENABLED", cast=bool, default=False)
REDIS_USERS_CACHE_ENABLED = config("REDIS_USERS_CACHE_ENABLED", cast=bool, default=_redis_enabled)
REDIS_SYNC_INTERVAL = config("REDIS_SYNC_INTERVAL", cast=int, default=180)  # 3 minutes default
EXPIRED_STATUS_TEXT = config("EXPIRED_STATUS_TEXT", default="Expired")
LIMITED_STATUS_TEXT = config("LIMITED_STATUS_TEXT", default="Limited")
DISABLED_STATUS_TEXT = config("DISABLED_STATUS_TEXT", default="Disabled")
ONHOLD_STATUS_TEXT = config("ONHOLD_STATUS_TEXT", default="On-Hold")

USERS_AUTODELETE_DAYS = config("USERS_AUTODELETE_DAYS", default=-1, cast=int)
USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS = config("USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS", default=False, cast=bool)


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

DISABLE_RECORDING_NODE_USAGE = config("DISABLE_RECORDING_NODE_USAGE", cast=bool, default=False)

# headers: profile-update-interval, support-url, profile-title
SUB_UPDATE_INTERVAL = config("SUB_UPDATE_INTERVAL", default="12")
SUB_SUPPORT_URL = config("SUB_SUPPORT_URL", default="https://t.me/")
SUB_PROFILE_TITLE = config("SUB_PROFILE_TITLE", default="Subscription")

# Interval jobs, all values are in seconds
JOB_CORE_HEALTH_CHECK_INTERVAL = config("JOB_CORE_HEALTH_CHECK_INTERVAL", cast=int, default=10)
JOB_RECORD_NODE_USAGES_INTERVAL = config("JOB_RECORD_NODE_USAGES_INTERVAL", cast=int, default=30)
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
