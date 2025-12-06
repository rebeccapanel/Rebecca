import json
from datetime import datetime as dt
from ipaddress import ip_address, IPv6Address
from typing import Any, Mapping, Optional, Union
from uuid import UUID

from xray_api.types.account import XTLSFlows


def calculate_usage_percent(used_traffic: int, data_limit: int) -> float:
    return (used_traffic * 100) / data_limit


def calculate_expiration_days(expire: int) -> int:
    return (dt.fromtimestamp(expire) - dt.utcnow()).days


def yml_uuid_representer(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(data))


class UUIDEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, UUID):
            # if the obj is uuid, we simply return the value of uuid
            return str(obj)
        return super().default(self, obj)


def inbound_requires_xtls_flow(inbound: Mapping[str, Any]) -> bool:
    protocol = inbound.get("protocol")
    return (
        protocol in {"vless", "trojan"}
        and inbound.get("network", "tcp") in {"tcp", "raw", "kcp"}
        and inbound.get("tls") in {"tls", "reality"}
        and inbound.get("header_type") != "http"
    )


def resolve_xtls_flow(inbound: Mapping[str, Any], flow_value: Optional[Union[XTLSFlows, str]]) -> Optional[XTLSFlows]:
    if flow_value:
        try:
            resolved = flow_value if isinstance(flow_value, XTLSFlows) else XTLSFlows(flow_value)
        except ValueError:
            resolved = None
        else:
            if resolved != XTLSFlows.NONE:
                return resolved
    # Do not auto-assign flow; only use explicit values
    return None


def format_ip_for_url(ip: str) -> str:
    """Format IP address for use in URLs. IPv6 addresses are enclosed in brackets."""
    try:
        addr = ip_address(ip)
        if isinstance(addr, IPv6Address):
            return f"[{ip}]"
        else:
            return ip
    except ValueError:
        return ip
