import atexit
import logging

from app.utils import check_port
from app.utils.xray_defaults import load_legacy_xray_config
from app.xray.config import XRayConfig
from app.xray.core import XRayCore
from xray_api import XRay
from xray_api import exceptions
from xray_api import exceptions as exc
from xray_api import types

from config import XRAY_ASSETS_PATH, XRAY_EXECUTABLE_PATH

logger = logging.getLogger("uvicorn.error")


def _try_load_config_from_db(api_port: int) -> XRayConfig | None:
    try:
        from app.db import GetDB
        from app.db import crud
    except ImportError:
        return None

    try:
        with GetDB() as db:
            payload = crud.get_xray_config(db)
    except Exception as err:  # pragma: no cover
        logger.warning("Unable to load Xray config from database: %s", err)
        return None

    if not payload:
        return None

    try:
        return XRayConfig(payload, api_port=api_port)
    except Exception as err:  # pragma: no cover
        logger.warning("Database Xray config is invalid: %s", err)
        return None


def _load_initial_xray_config(api_port: int) -> XRayConfig:
    db_config = _try_load_config_from_db(api_port)
    if db_config:
        return db_config

    logger.warning("Xray config not found in database, using default config")
    legacy = load_legacy_xray_config()
    return XRayConfig(legacy, api_port=api_port)


# Search for a free API port from 8080
try:
    for api_port in range(8080, 65536):
        if not check_port(api_port):
            break
finally:
    config = _load_initial_xray_config(api_port)
    del api_port


core = XRayCore(XRAY_EXECUTABLE_PATH, XRAY_ASSETS_PATH)
try:
    core.start(config)
except Exception as e:
    logger.error("Failed to start XRay core: %s", e)


@atexit.register
def stop_core():
    if core.started:
        core.stop()


api = XRay(config.api_host, config.api_port)


INBOUND_PORTS = {inbound['protocol']: inbound['port'] for inbound in config['inbounds']}
INBOUND_TAGS = {inbound['protocol']: inbound['tag'] for inbound in config['inbounds']}
INBOUND_STREAMS = {inbound['protocol']: (
                   {
                       "net": inbound['streamSettings'].get('network', 'tcp'),
                       "tls": inbound['streamSettings'].get('security') in ('tls', 'xtls'),
                       "sni": (
                           inbound['streamSettings'].get('tlsSettings') or
                           inbound['streamSettings'].get('xtlsSettings') or
                           {}
                       ).get('serverName', ''),
                       "path": inbound['streamSettings'].get(
                           f"{inbound['streamSettings'].get('network', 'tcp')}Settings", {}
                       ).get('path', '')
                   }
                   if inbound.get('streamSettings') else
                   {
                       "net": "tcp",
                       "tls": False,
                       "sni": "",
                       "path": ""
                   }
                   ) for inbound in config['inbounds']}


__all__ = [
    "config",
    "core",
    "api",
    "exceptions",
    "exc",
    "types",
    "INBOUND_PORTS",
    "INBOUND_TAGS",
    "INBOUND_STREAMS"
]
