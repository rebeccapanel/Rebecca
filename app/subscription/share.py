import base64
import os
import string
from collections import defaultdict
from datetime import datetime as dt, timezone
from datetime import timedelta
from typing import TYPE_CHECKING, List, Literal, Union

from jdatetime import date as jd

from app.utils.system import get_public_ip, get_public_ipv6, readable_size
from app.utils.credentials import runtime_proxy_settings
from app.models.proxy import ProxyTypes
from app.services.subscription_settings import EffectiveSubscriptionSettings

from . import *

if TYPE_CHECKING:
    from app.models.user import UserResponse

from config import (
    ACTIVE_STATUS_TEXT,
    DISABLED_STATUS_TEXT,
    EXPIRED_STATUS_TEXT,
    LIMITED_STATUS_TEXT,
    ONHOLD_STATUS_TEXT,
)

SERVER_IP = get_public_ip()
SERVER_IPV6 = get_public_ipv6()

STATUS_EMOJIS = {
    "active": "✅",
    "expired": "⌛️",
    "limited": "🪫",
    "disabled": "❌",
    "on_hold": "🔌",
}

STATUS_TEXTS = {
    "active": ACTIVE_STATUS_TEXT,
    "expired": EXPIRED_STATUS_TEXT,
    "limited": LIMITED_STATUS_TEXT,
    "disabled": DISABLED_STATUS_TEXT,
    "on_hold": ONHOLD_STATUS_TEXT,
}


def is_credential_key(value: str) -> bool:
    if not isinstance(value, str):
        return False
    cleaned = value.replace("-", "").strip()
    return len(cleaned) == 32 and all(ch in string.hexdigits for ch in cleaned)


def generate_v2ray_links(
    proxies: dict,
    inbounds: dict,
    extra_data: dict,
    reverse: bool,
    *,
    inbounds_by_tag: dict | None = None,
    host_map: dict | None = None,
    force_refresh: bool = True,
) -> list:
    format_variables = setup_format_variables(extra_data)
    conf = V2rayShareLink()
    return process_inbounds_and_tags(
        inbounds,
        proxies,
        format_variables,
        extra_data,
        conf=conf,
        reverse=reverse,
        inbounds_by_tag=inbounds_by_tag,
        host_map=host_map,
        force_refresh=force_refresh,
    )


def generate_clash_subscription(
    proxies: dict,
    inbounds: dict,
    extra_data: dict,
    reverse: bool,
    is_meta: bool = False,
    settings: EffectiveSubscriptionSettings | None = None,
) -> str:
    if settings is None:
        raise ValueError("Subscription settings are required for generating clash subscriptions")
    if is_meta is True:
        conf = ClashMetaConfiguration(settings)
    else:
        conf = ClashConfiguration(settings)

    format_variables = setup_format_variables(extra_data)
    return process_inbounds_and_tags(inbounds, proxies, format_variables, extra_data, conf=conf, reverse=reverse)


def generate_singbox_subscription(
    proxies: dict, inbounds: dict, extra_data: dict, reverse: bool, settings: EffectiveSubscriptionSettings
) -> str:
    conf = SingBoxConfiguration(settings)

    format_variables = setup_format_variables(extra_data)
    return process_inbounds_and_tags(inbounds, proxies, format_variables, extra_data, conf=conf, reverse=reverse)


def generate_outline_subscription(
    proxies: dict,
    inbounds: dict,
    extra_data: dict,
    reverse: bool,
    settings: EffectiveSubscriptionSettings,
) -> str:
    conf = OutlineConfiguration()

    format_variables = setup_format_variables(extra_data)
    return process_inbounds_and_tags(inbounds, proxies, format_variables, extra_data, conf=conf, reverse=reverse)


def generate_v2ray_json_subscription(
    proxies: dict,
    inbounds: dict,
    extra_data: dict,
    reverse: bool,
    settings: EffectiveSubscriptionSettings,
) -> str:
    conf = V2rayJsonConfig(settings)

    format_variables = setup_format_variables(extra_data)
    return process_inbounds_and_tags(inbounds, proxies, format_variables, extra_data, conf=conf, reverse=reverse)


def generate_subscription(
    user: "UserResponse",
    config_format: Literal["v2ray", "clash-meta", "clash", "sing-box", "outline", "v2ray-json"],
    as_base64: bool,
    reverse: bool,
    settings: EffectiveSubscriptionSettings,
) -> str:
    kwargs = {
        "proxies": user.proxies,
        "inbounds": user.inbounds,
        "extra_data": user.__dict__,
        "reverse": reverse,
    }

    if config_format == "v2ray":
        config = "\n".join(generate_v2ray_links(**kwargs))
    elif config_format == "clash-meta":
        config = generate_clash_subscription(**kwargs, is_meta=True, settings=settings)
    elif config_format == "clash":
        config = generate_clash_subscription(**kwargs, settings=settings)
    elif config_format == "sing-box":
        config = generate_singbox_subscription(**kwargs, settings=settings)
    elif config_format == "outline":
        config = generate_outline_subscription(**kwargs, settings=settings)
    elif config_format == "v2ray-json":
        config = generate_v2ray_json_subscription(**kwargs, settings=settings)
    else:
        raise ValueError(f'Unsupported format "{config_format}"')

    if as_base64:
        config = base64.b64encode(config.encode()).decode()

    return config


def format_time_left(seconds_left: int) -> str:
    if not seconds_left or seconds_left <= 0:
        return "∞"

    minutes, seconds = divmod(seconds_left, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    months, days = divmod(days, 30)

    result = []
    if months:
        result.append(f"{months}m")
    if days:
        result.append(f"{days}d")
    if hours and (days < 7):
        result.append(f"{hours}h")
    if minutes and not (months or days):
        result.append(f"{minutes}m")
    if seconds and not (months or days):
        result.append(f"{seconds}s")
    return " ".join(result)


def setup_format_variables(extra_data: dict) -> dict:
    from app.models.user import UserStatus

    user_status = extra_data.get("status")
    expire_timestamp = extra_data.get("expire")
    on_hold_expire_duration = extra_data.get("on_hold_expire_duration")
    now = dt.now(timezone.utc)
    now_ts = now.timestamp()

    if user_status != UserStatus.on_hold:
        if expire_timestamp is not None and expire_timestamp >= 0:
            seconds_left = expire_timestamp - int(dt.now(timezone.utc).timestamp())
            expire_datetime = dt.fromtimestamp(expire_timestamp, timezone.utc)
            expire_date = expire_datetime.date()
            jalali_expire_date = jd.fromgregorian(
                year=expire_date.year, month=expire_date.month, day=expire_date.day
            ).strftime("%Y-%m-%d")
            if now_ts < expire_timestamp:
                days_left = (expire_datetime - dt.now(timezone.utc)).days + 1
                time_left = format_time_left(seconds_left)
            else:
                days_left = "0"
                time_left = "0"

        else:
            days_left = "∞"
            time_left = "∞"
            expire_date = "∞"
            jalali_expire_date = "∞"
    else:
        if on_hold_expire_duration is not None and on_hold_expire_duration >= 0:
            days_left = timedelta(seconds=on_hold_expire_duration).days
            time_left = format_time_left(on_hold_expire_duration)
            expire_date = "-"
            jalali_expire_date = "-"
        else:
            days_left = "∞"
            time_left = "∞"
            expire_date = "∞"
            jalali_expire_date = "∞"

    if extra_data.get("data_limit"):
        data_limit = readable_size(extra_data["data_limit"])
        data_left = extra_data["data_limit"] - extra_data["used_traffic"]
        if data_left < 0:
            data_left = 0
        data_left = readable_size(data_left)
    else:
        data_limit = "∞"
        data_left = "∞"

    status_emoji = STATUS_EMOJIS.get(extra_data.get("status")) or ""
    status_text = STATUS_TEXTS.get(extra_data.get("status")) or ""

    format_variables = defaultdict(
        lambda: "<missing>",
        {
            "SERVER_IP": SERVER_IP,
            "SERVER_IPV6": SERVER_IPV6,
            "USERNAME": extra_data.get("username", "{USERNAME}"),
            "DATA_USAGE": readable_size(extra_data.get("used_traffic")),
            "DATA_LIMIT": data_limit,
            "DATA_LEFT": data_left,
            "REMAINING_DATA": data_left,
            "DAYS_LEFT": days_left,
            "EXPIRE_DATE": expire_date,
            "JALALI_EXPIRE_DATE": jalali_expire_date,
            "TIME_LEFT": time_left,
            "STATUS_EMOJI": status_emoji,
            "STATUS_TEXT": status_text,
        },
    )

    return format_variables


def process_inbounds_and_tags(
    inbounds: dict,
    proxies: dict,
    format_variables: dict,
    extra_data: dict,
    conf: Union[
        V2rayShareLink,
        V2rayJsonConfig,
        SingBoxConfiguration,
        ClashConfiguration,
        ClashMetaConfiguration,
        OutlineConfiguration,
    ],
    reverse=False,
    inbounds_by_tag: dict | None = None,
    host_map: dict | None = None,
    force_refresh: bool = True,
) -> Union[List, str]:
    from app.runtime import xray
    from app.services.data_access import get_service_host_map_cached
    from app.db import GetDB
    from app.db import crud
    from app.reb_node.config import XRayConfig

    service_id = extra_data.get("service_id")

    from app.services.data_access import get_inbounds_by_tag_cached
    from config import REDIS_ENABLED

    if inbounds_by_tag is None:
        inbounds_by_tag = {}
    if not inbounds_by_tag and REDIS_ENABLED:
        try:
            with GetDB() as db:
                inbounds_by_tag = get_inbounds_by_tag_cached(db, force_refresh=force_refresh)
        except Exception:
            pass

    if not inbounds_by_tag:
        xray_config = None
        try:
            with GetDB() as db:
                raw_config = crud.get_xray_config(db)
                xray_config = XRayConfig(raw_config, api_port=xray.config.api_port)
        except Exception:
            xray_config = getattr(xray, "config", None)

        if not xray_config:
            return [] if isinstance(conf, list) else ""

        inbounds_by_tag = getattr(xray_config, "inbounds_by_tag", {}) or {}

    if host_map is None:
        host_map = {}
        if not os.getenv("PYTEST_CURRENT_TEST") and os.getenv("REBECCA_SKIP_RUNTIME_INIT") != "1":
            try:
                host_map = get_service_host_map_cached(service_id, force_refresh=force_refresh)
            except Exception:
                host_map = {}
    inbound_index = {tag: index for index, tag in enumerate(inbounds_by_tag.keys())}

    service_host_orders = (extra_data or {}).get("service_host_orders") or {}
    if service_host_orders:
        service_host_orders = {int(k): v for k, v in service_host_orders.items()}

    host_entries = []
    for protocol, tags in inbounds.items():
        settings = proxies.get(protocol)
        if not settings:
            continue

        for tag in tags:
            inbound = inbounds_by_tag.get(tag)
            if not inbound:
                continue

            # Get host list for this tag from host_map
            host_list = host_map.get(tag, []) if host_map else []

            sorted_host_list = sorted(host_list, key=lambda h: (h.get("sort", 0), h.get("id") or 0))
            for position, host in enumerate(sorted_host_list):
                if host.get("is_disabled"):
                    continue
                host_id = host.get("id")
                host_entries.append(
                    (
                        protocol,
                        tag,
                        settings,
                        inbound,
                        host,
                        inbound_index.get(tag, float("inf")),
                        position,
                        host_id if host_id is not None else 0,
                    )
                )

    host_entries.sort(
        key=lambda entry: (
            service_host_orders.get(entry[7], entry[4].get("sort", 0))
            if entry[7] is not None
            else entry[4].get("sort", 0),
            entry[5],
            entry[6],
        )
    )

    for protocol, tag, settings, inbound, host, _, _, _ in host_entries:
        if host.get("is_disabled"):
            continue
        format_variables.update({"PROTOCOL": protocol.name})
        format_variables.update({"TRANSPORT": inbound["network"]})
        host_inbound = inbound.copy()

        sni = ""
        sni_list = host["sni"] or inbound["sni"]
        if sni_list:
            # Use first SNI to ensure consistent configs
            sni = sni_list[0]
            if "*" in sni:
                # Generate a stable salt based on username for wildcards
                username = format_variables.get("USERNAME", "user")
                salt = username[:8].ljust(8, "0")
                sni = sni.replace("*", salt)

        # Get shortId from inbound sids if available
        sid = ""
        if sids := inbound.get("sids"):
            # Use first SID to ensure consistent configs
            sid = sids[0]

        req_host = ""
        req_host_list = host["host"] or inbound["host"]
        if req_host_list:
            # Use first host to ensure consistent configs
            req_host = req_host_list[0]
            if "*" in req_host:
                username = format_variables.get("USERNAME", "user")
                salt = username[:8].ljust(8, "0")
                req_host = req_host.replace("*", salt)

        address = ""
        address_list = host["address"]
        if host["address"]:
            # Use first address to ensure consistent configs
            address = address_list[0]
            if "*" in address:
                username = format_variables.get("USERNAME", "user")
                salt = username[:8].ljust(8, "0")
                address = address.replace("*", salt)

        if host["path"] is not None:
            path = host["path"].format_map(format_variables)
        else:
            path = inbound.get("path", "").format_map(format_variables)

        if host.get("use_sni_as_host", False) and sni:
            req_host = sni

        host_inbound.update(
            {
                "port": host["port"] or inbound["port"],
                "sni": sni,
                "host": req_host,
                "tls": inbound["tls"] if host["tls"] is None else host["tls"],
                "alpn": host["alpn"] if host["alpn"] else None,
                "path": path,
                "fp": host["fingerprint"] or inbound.get("fp", ""),
                "ais": host["allowinsecure"] or inbound.get("allowinsecure", ""),
                "mux_enable": host["mux_enable"],
                "fragment_setting": host["fragment_setting"],
                "noise_setting": host["noise_setting"],
                "random_user_agent": host["random_user_agent"],
                "sid": sid,  # Include shortId in host_inbound so it's passed to user configs
            }
        )

        credential_key = extra_data.get("credential_key")
        if not credential_key and hasattr(settings, "credential_key"):
            credential_key = getattr(settings, "credential_key", None)

        if isinstance(protocol, str):
            proxy_type = ProxyTypes(protocol)
        else:
            proxy_type = protocol

        user_flow = extra_data.get("flow")
        if user_flow:
            runtime_settings = runtime_proxy_settings(settings, proxy_type, credential_key, flow=user_flow)
        else:
            # Call without flow to mirror server-side account generation when flow is absent
            runtime_settings = runtime_proxy_settings(settings, proxy_type, credential_key)
        if not user_flow:
            runtime_settings.pop("flow", None)

        conf.add(
            remark=host["remark"].format_map(format_variables),
            address=address.format_map(format_variables),
            inbound=host_inbound,
            settings=runtime_settings,
        )

    return conf.render(reverse=reverse)


def encode_title(text: str) -> str:
    return f"base64:{base64.b64encode(text.encode()).decode()}"
