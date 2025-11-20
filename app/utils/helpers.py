import json
from datetime import datetime as dt
from uuid import UUID
from ipaddress import ip_address, IPv6Address


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
