from collections import defaultdict
from operator import attrgetter

from xray_api import XRay as XRayAPI
from xray_api import exc as xray_exc


"""Xray collectors that fetch per-user and per-outbound usage stats for recording."""


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


def get_outbounds_stats(api: XRayAPI):
    try:
        params = [
            {"up": stat.value, "down": 0} if stat.link == "uplink" else {"up": 0, "down": stat.value}
            for stat in filter(attrgetter("value"), api.get_outbounds_stats(reset=True, timeout=200))
        ]
        return params
    except xray_exc.XrayError:
        return []


# endregion
