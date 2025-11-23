import json
import os
from pathlib import PosixPath
import logging

logger = logging.getLogger("uvicorn.error")


class XRayConfig(dict):
    def __init__(self,
                 config: dict | str | PosixPath = {},
                 api_host: str = "127.0.0.1",
                 api_port: int = 8080):
        if isinstance(config, str):
            try:
                # considering string as json
                config = json.loads(config)
            except json.JSONDecodeError:
                # considering string as file path
                if os.path.exists(config):
                    try:
                        with open(config, 'r') as file:
                            file_content = file.read()
                            try:
                                config = json.loads(file_content)
                            except json.JSONDecodeError:
                                # If file exists but contains invalid JSON, keep as empty dict
                                logger.warning("Xray config file %s contains invalid JSON, using empty fallback config", config)
                                config = {}
                    except Exception:
                        logger.warning("Failed to read Xray config file %s, using empty fallback config", config)
                        config = {}
                else:
                    # Not a JSON string or a path to file -> fallback to empty config
                    logger.warning("Xray config file %s not found, using empty fallback config", config)
                    config = {}

        if isinstance(config, PosixPath):
            if config.exists():
                try:
                    with open(config, 'r') as file:
                        file_content = file.read()
                        try:
                            config = json.loads(file_content)
                        except json.JSONDecodeError:
                            logger.warning("Xray config file %s contains invalid JSON, using empty fallback config", config)
                            config = {}
                            config = {}
                except Exception:
                    logger.warning("Failed to read Xray config file %s, using empty fallback config", config)
                    config = {}
            else:
                logger.warning("Xray config %s not found, using empty fallback config", config)
                config = {}

        self.api_host = api_host
        self.api_port = api_port

        super().__init__(config)
        self._apply_api()

    def _apply_api(self):
        if self.get_inbound("API_INBOUND"):
            return

        self["api"] = {
            "services": [
                "HandlerService",
                "StatsService",
                "LoggerService"
            ],
            "tag": "API"
        }
        self["stats"] = {}
        self["policy"] = {
            "levels": {
                "0": {
                    "statsUserUplink": True,
                    "statsUserDownlink": True
                }
            },
            "system": {
                "statsInboundDownlink": False,
                "statsInboundUplink": False,
                "statsOutboundDownlink": True,
                "statsOutboundUplink": True
            }
        }
        inbound = {
            "listen": self.api_host,
            "port": self.api_port,
            "protocol": "dokodemo-door",
            "settings": {
                "address": self.api_host
            },
            "tag": "API_INBOUND"
        }
        try:
            self["inbounds"].insert(0, inbound)
        except KeyError:
            self["inbounds"] = []
            self["inbounds"].insert(0, inbound)

        rule = {
            "inboundTag": [
                "API_INBOUND"
            ],
            "outboundTag": "API",
            "type": "field"
        }
        try:
            self["routing"]["rules"].insert(0, rule)
        except KeyError:
            self["routing"] = {"rules": []}
            self["routing"]["rules"].insert(0, rule)

    def get_inbound(self, tag) -> dict:
        for inbound in self.get('inbounds', []):
            if inbound['tag'] == tag:
                return inbound

    def get_outbound(self, tag) -> dict:
        for outbound in self.get('outbounds', []):
            if outbound['tag'] == tag:
                return outbound

    def to_json(self, **json_kwargs):
        return json.dumps(self, **json_kwargs)
