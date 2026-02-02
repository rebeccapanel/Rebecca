import json
from pathlib import PosixPath


def merge_dicts(a, b):
    for key, value in b.items():
        if isinstance(value, dict) and key in a and isinstance(a[key], dict):
            merge_dicts(a[key], value)
        else:
            a[key] = value
    return a


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

        # Always enable API services/policy at runtime (do not persist).
        self["api"] = {"services": ["HandlerService", "StatsService", "LoggerService"], "tag": "API"}
        self["stats"] = {}
        forced_policies = {
            "levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}},
            "system": {
                "statsInboundDownlink": False,
                "statsInboundUplink": False,
                "statsOutboundDownlink": True,
                "statsOutboundUplink": True,
            },
        }
        current_policy = self.get("policy")
        if isinstance(current_policy, dict):
            self["policy"] = current_policy
        elif current_policy:
            try:
                self["policy"] = json.loads(current_policy)
            except Exception:
                self["policy"] = {}
        if self.get("policy"):
            self["policy"] = merge_dicts(self.get("policy", {}), forced_policies)
        else:
            self["policy"] = forced_policies

        if api_inbound:
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
            else:
                api_inbound["settings"] = {"address": self.api_host}
        else:
            inbound = {
                "listen": self.api_host,
                "port": self.api_port,
                "protocol": "dokodemo-door",
                "settings": {"address": self.api_host},
                "tag": "API_INBOUND",
            }
            try:
                self["inbounds"].insert(0, inbound)
            except KeyError:
                self["inbounds"] = []
                self["inbounds"].insert(0, inbound)

        rule = {"inboundTag": ["API_INBOUND"], "outboundTag": "API", "type": "field"}
        rules = None
        if isinstance(self.get("routing"), dict):
            rules = self.get("routing", {}).get("rules")
        if not isinstance(rules, list):
            self["routing"] = {"rules": []}
            rules = self["routing"]["rules"]
        if not any(
            isinstance(r, dict)
            and r.get("type") == "field"
            and r.get("outboundTag") == "API"
            and "API_INBOUND" in (r.get("inboundTag") or [])
            for r in rules
        ):
            rules.insert(0, rule)

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
