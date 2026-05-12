import threading
from collections import defaultdict
from operator import attrgetter

from xray_api import XRay as XRayAPI
from xray_api import exc as xray_exc


"""Xray collectors that fetch per-user and per-outbound usage stats for recording."""

# Keep timeouts short to avoid blocking periodic usage jobs.
_USER_STATS_TIMEOUT_SECONDS = 30
_OUTBOUND_STATS_TIMEOUT_SECONDS = 10
_STATS_LAST_VALUES_ATTR = "_rebecca_stats_last_values"
_STATS_LOCK = threading.RLock()


def _stats_last_values(api: XRayAPI) -> dict[str, int]:
    values = getattr(api, _STATS_LAST_VALUES_ATTR, None)
    if values is None:
        values = {}
        setattr(api, _STATS_LAST_VALUES_ATTR, values)
    return values


def _stat_key(stat) -> str:
    return f"{stat.type}>>>{stat.name}>>>traffic>>>{stat.link}"


def _iter_stats_deltas(api: XRayAPI, pattern: str, timeout: int):
    """
    Return positive deltas from cumulative Xray counters.

    This mirrors 3x-ui's accounting model: QueryStats(reset=False), keep the
    previous value in process memory, skip first-seen counters, and treat lower
    values as an Xray restart/reset baseline instead of billable usage.
    """
    stats = list(filter(attrgetter("value"), api.query_stats(pattern, reset=False, timeout=timeout)))

    with _STATS_LOCK:
        last_values = _stats_last_values(api)
        for stat in stats:
            current_value = int(stat.value or 0)
            key = _stat_key(stat)
            last_value = last_values.get(key)
            last_values[key] = current_value

            if last_value is None or current_value < last_value:
                continue

            delta = current_value - last_value
            if delta > 0:
                yield stat, delta


def resolve_stats_api(source):
    if hasattr(source, "query_stats"):
        return source

    source_dict = getattr(source, "__dict__", {})
    if "api" in source_dict:
        return source_dict["api"]

    api_attr = getattr(type(source), "api", None)
    if isinstance(api_attr, property):
        return source.api

    return None


# region User stats (per account)


def get_users_stats(api: XRayAPI):
    try:
        params = defaultdict(int)
        for stat, value in _iter_stats_deltas(api, "user>>>", _USER_STATS_TIMEOUT_SECONDS):
            params[stat.name.split(".", 1)[0]] += value
        return [{"uid": uid, "value": value} for uid, value in params.items()]
    except xray_exc.XrayError:
        return []


# endregion

# region Outbound stats (node/master)


def get_outbounds_stats(api: XRayAPI):
    try:
        stats_by_tag = defaultdict(lambda: {"up": 0, "down": 0, "tag": ""})

        for stat, value in _iter_stats_deltas(api, "outbound>>>", _OUTBOUND_STATS_TIMEOUT_SECONDS):
            # Skip API outbound
            if stat.name.lower() == "api":
                continue

            tag = stat.name
            stats_by_tag[tag]["tag"] = tag

            if stat.link == "uplink":
                stats_by_tag[tag]["up"] += value
            elif stat.link == "downlink":
                stats_by_tag[tag]["down"] += value

        return list(stats_by_tag.values())
    except xray_exc.XrayError:
        return []


# endregion
