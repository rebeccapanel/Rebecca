import json
from pathlib import PosixPath


class XRayConfig(dict):
    def __init__(self, config: dict | str | PosixPath = {}, api_host: str = "127.0.0.1", api_port: int = 8080):
        if isinstance(config, str):
            try:
                # considering string as json
                config = json.loads(config)
            except json.JSONDecodeError:
                # considering string as file path
                try:
                    with open(config, "r") as file:
                        content = file.read().strip()
                        if not content:
                            # Empty file, use empty dict
                            config = {}
                        else:
                            config = json.loads(content)
                except (FileNotFoundError, json.JSONDecodeError, OSError):
                    # File doesn't exist or invalid JSON, use empty dict
                    config = {}

        if isinstance(config, PosixPath):
            try:
                with open(config, "r") as file:
                    content = file.read().strip()
                    if not content:
                        # Empty file, use empty dict
                        config = {}
                    else:
                        config = json.loads(content)
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                # File doesn't exist or invalid JSON, use empty dict
                config = {}

        self.api_host = api_host
        self.api_port = api_port

        super().__init__(config)
        self._apply_api()

    def _apply_api(self):
        api_inbound = self.get_inbound("API_INBOUND")
        if not api_inbound:
            inbound = {
                "listen": self.api_host,
                "port": self.api_port,
                "protocol": "dokodemo-door",
                "settings": {"address": "127.0.0.1"},
                "tag": "API_INBOUND",
            }
            try:
                self["inbounds"].insert(0, inbound)
            except KeyError:
                self["inbounds"] = []
                self["inbounds"].insert(0, inbound)
                return

            rule = {
                "inboundTag": ["API_INBOUND"],
                "outboundTag": "API",
                "type": "field",
            }
            try:
                self["routing"]["rules"].insert(0, rule)
            except KeyError:
                self["routing"] = {"rules": []}
                self["routing"]["rules"].insert(0, rule)
            return

        listen_value = api_inbound.get("listen")
        if isinstance(listen_value, dict):
            listen_value["address"] = self.api_host
            api_inbound["listen"] = listen_value
        else:
            api_inbound["listen"] = self.api_host
        api_inbound["port"] = self.api_port
        settings = api_inbound.get("settings")
        if isinstance(settings, dict):
            settings["address"] = self.api_host

    def get_inbound(self, tag) -> dict:
        for inbound in self["inbounds"]:
            if inbound["tag"] == tag:
                return inbound

    def get_outbound(self, tag) -> dict:
        for outbound in self["outbounds"]:
            if outbound["tag"] == tag:
                outbound

    def to_json(self, **json_kwargs):
        return json.dumps(self, **json_kwargs)
