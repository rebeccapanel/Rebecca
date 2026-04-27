from collections import defaultdict
from operator import attrgetter

from xray_api import XRay as XRayAPI
from xray_api import exc as xray_exc


"""Xray collectors that fetch per-user and per-outbound usage stats for recording."""

# Keep timeouts short to avoid blocking periodic usage jobs.
_USER_STATS_TIMEOUT_SECONDS = 30
_OUTBOUND_STATS_TIMEOUT_SECONDS = 10


# region User stats (per account)


def get_users_stats(api: XRayAPI):
    try:
        params = defaultdict(int)
        for stat in filter(attrgetter("value"), api.get_users_stats(reset=True, timeout=_USER_STATS_TIMEOUT_SECONDS)):
            params[stat.name.split(".", 1)[0]] += stat.value
        return [{"uid": uid, "value": value} for uid, value in params.items()]
    except xray_exc.XrayError:
        return []


# endregion

# region Outbound stats (node/master)


def get_outbounds_stats(api: XRayAPI):
    try:
        stats_by_tag = defaultdict(lambda: {"up": 0, "down": 0, "tag": ""})

        for stat in filter(
            attrgetter("value"),
            api.query_stats("outbound>>>", reset=True, timeout=_OUTBOUND_STATS_TIMEOUT_SECONDS),
        ):
            # Skip API outbound
            if stat.name.lower() == "api":
                continue

            tag = stat.name
            stats_by_tag[tag]["tag"] = tag

            if stat.link == "uplink":
                stats_by_tag[tag]["up"] += stat.value
            elif stat.link == "downlink":
                stats_by_tag[tag]["down"] += stat.value

        return list(stats_by_tag.values())
    except xray_exc.XrayError:
        return []


# endregion
