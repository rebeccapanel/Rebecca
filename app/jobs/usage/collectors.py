from collections import defaultdict
from copy import deepcopy
from operator import attrgetter
import threading
import time

from xray_api import XRay as XRayAPI
from xray_api import exc as xray_exc


"""Xray collectors that fetch per-user and per-outbound usage stats for recording."""

_OUTBOUND_CACHE_LOCK = threading.RLock()
_OUTBOUND_STATS_CACHE: dict[str, tuple[float, list[dict]]] = {}


# region User stats (per account)


def get_users_stats(api: XRayAPI):
    try:
        params = defaultdict(int)
        for stat in filter(attrgetter("value"), api.get_users_stats(reset=True, timeout=600)):
            params[stat.name.split(".", 1)[0]] += stat.value
        return [{"uid": uid, "value": value} for uid, value in params.items()]
    except xray_exc.XrayError:
        return []


# endregion

# region Outbound stats (node/master)


def _cache_key(api: XRayAPI) -> str:
    return f"{getattr(api, 'address', '127.0.0.1')}:{getattr(api, 'port', '')}"


def get_outbounds_stats(api: XRayAPI, cache_ttl: int = 10):
    key = _cache_key(api)
    now = time.time()

    with _OUTBOUND_CACHE_LOCK:
        cached = _OUTBOUND_STATS_CACHE.get(key)
        if cached:
            ts, payload = cached
            if now - ts < cache_ttl:
                return [dict(item) for item in payload]

    try:
        stats_by_tag = defaultdict(lambda: {"up": 0, "down": 0, "tag": ""})
        
        for stat in filter(attrgetter("value"), api.query_stats("outbound>>>", reset=True, timeout=200)):
            
            # Skip API outbound
            if stat.name == "api":
                continue
            
            tag = stat.name
            stats_by_tag[tag]["tag"] = tag
            
            if stat.link == "uplink":
                stats_by_tag[tag]["up"] += stat.value
            elif stat.link == "downlink":
                stats_by_tag[tag]["down"] += stat.value
        
        result = list(stats_by_tag.values())
        with _OUTBOUND_CACHE_LOCK:
            _OUTBOUND_STATS_CACHE[key] = (now, deepcopy(result))
        return result
    except xray_exc.XrayError:
        # Return stale data if available to avoid total loss when API momentarily fails
        with _OUTBOUND_CACHE_LOCK:
            cached = _OUTBOUND_STATS_CACHE.get(key)
        if cached:
            return [dict(item) for item in cached[1]]
        return []


# endregion
