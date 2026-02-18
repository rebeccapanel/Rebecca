from __future__ import annotations

import ipaddress
import json
import re
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Optional
import os
import requests
from urllib.parse import urlsplit, urlunsplit

from app.runtime import xray
from config import XRAY_ASSETS_PATH, XRAY_LOG_DIR, REDIS_ENABLED
from app.redis.client import get_redis
from app.proto.rebecca.app.router import config_pb2


@dataclass
class GeoSiteIndex:
    full: dict[str, str]
    suffix: dict[str, str]
    plain: list[tuple[str, str]]
    regex: list[tuple[str, re.Pattern[str]]]


@dataclass
class GeoIPIndex:
    ipv4: list[tuple[ipaddress.IPv4Network, str]]
    ipv6: list[tuple[ipaddress.IPv6Network, str]]


@dataclass
class GeoAssets:
    base_dir: Path
    geosite_path: Optional[Path]
    geoip_path: Optional[Path]
    geosite_mtime: Optional[float]
    geoip_mtime: Optional[float]
    geosite: GeoSiteIndex
    geoip: GeoIPIndex

    @property
    def geosite_loaded(self) -> bool:
        return self.geosite_path is not None

    @property
    def geoip_loaded(self) -> bool:
        return self.geoip_path is not None


GeoEntry = dict[str, Any]

_geo_cache: Optional[GeoAssets] = None
_geo_cache_lock = threading.Lock()

# JSON geosite/geoip cache
_json_geo_cache: dict[str, Any] = {"loaded_at": None, "domain_map": {}, "ip_networks": []}
_json_geo_lock = threading.Lock()
_JSON_GEO_TTL_SECONDS = 600
_JSON_GEOSITE_URL = "https://raw.githubusercontent.com/ppouria/geo-templates/main/geosite.json"


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(value: Optional[datetime] = None) -> str:
    dt = _ensure_utc(value) if isinstance(value, datetime) else _utcnow()
    return dt.isoformat().replace("+00:00", "Z")


def _sibling_raw_url(base_url: str, filename: str) -> str:
    """
    Build a sibling raw GitHub URL from the geosite URL.
    Keeps scheme/host/repo/branch path intact and swaps only filename.
    """
    try:
        parsed = urlsplit(base_url)
        path = parsed.path or ""
        if "/" not in path:
            return base_url
        parent = path.rsplit("/", 1)[0]
        sibling_path = f"{parent}/{filename}"
        return urlunsplit((parsed.scheme, parsed.netloc, sibling_path, parsed.query, parsed.fragment))
    except Exception:
        if "/" in base_url:
            return f"{base_url.rsplit('/', 1)[0]}/{filename}"
        return base_url


_JSON_GEOIP_URL = _sibling_raw_url(_JSON_GEOSITE_URL, "geoip.json")
_JSON_ISP_URL = _sibling_raw_url(_JSON_GEOSITE_URL, "ISPbyrange.json")
_json_isp_cache: dict[str, Any] = {"loaded_at": None, "ranges": []}  # ranges: list[(network, short_name, owner)]


@dataclass
class NodeLogSource:
    """Represents a log source (master or node)."""

    node_id: Optional[int]
    node_name: str
    log_path: Optional[Path]
    is_master: bool
    fetch_lines: Optional[Callable[[int], list[str]]] = None
    connected: bool = False


def _load_node_metadata() -> dict[int, dict[str, Any]]:
    """
    Load node metadata (name/status) for debug-friendly source labels.
    Falls back to empty mapping if DB is unavailable.
    """
    try:
        from app.db import GetDB, crud
    except Exception:
        return {}

    metadata: dict[int, dict[str, Any]] = {}
    try:
        with GetDB() as db:
            for dbnode in crud.get_nodes(db):
                if dbnode.id is None:
                    continue
                node_id = int(dbnode.id)
                metadata[node_id] = {
                    "name": getattr(dbnode, "name", None),
                    "status": getattr(dbnode, "status", None),
                }
    except Exception:
        return {}

    return metadata


def _resolve_assets_base() -> Path:
    base = getattr(getattr(xray, "core", None), "assets_path", None) or XRAY_ASSETS_PATH
    return Path(base).expanduser()


def get_all_log_sources() -> list[NodeLogSource]:
    """
    Get all available log sources (master + connected nodes).
    Returns empty list if Access Insights is disabled.
    """
    try:
        from app.services.panel_settings import PanelSettingsService

        if not PanelSettingsService.get_settings(ensure_record=True).access_insights_enabled:
            return []
    except Exception:
        return []

    sources: list[NodeLogSource] = []

    # Add master xray log
    master_log = resolve_access_log_path()
    sources.append(
        NodeLogSource(
            node_id=None,
            node_name="master",
            log_path=master_log,
            is_master=True,
            fetch_lines=None,
            connected=master_log.exists(),
        )
    )

    # Add node logs via REST API
    if xray and hasattr(xray, "nodes"):
        node_metadata = _load_node_metadata()
        for node_id, node in xray.nodes.items():
            metadata = node_metadata.get(int(node_id), {})
            status_raw = metadata.get("status")
            status = str(getattr(status_raw, "value", status_raw)).strip().lower() if status_raw is not None else ""
            if status in {"disabled", "limited"}:
                continue

            node_name = metadata.get("name") or getattr(node, "name", None) or f"Node-{node_id}"
            connected = bool(getattr(node, "_session_id", None))
            try:
                sources.append(
                    NodeLogSource(
                        node_id=node_id,
                        node_name=node_name,
                        log_path=None,
                        is_master=False,
                        fetch_lines=lambda max_lines, _node=node: _fetch_node_access_logs(_node, max_lines),
                        connected=connected,
                    )
                )
            except Exception:
                continue

    return sources


def _resolve_log_path(value: Any, filename: str, base_dir: Path) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "none":
            return "none"
        if not value.strip():
            return ""
        candidate = Path(value.strip())
        if not candidate.is_absolute() or candidate.parent == Path("/"):
            return str(base_dir / candidate.name)
        return str(candidate)
    return str(base_dir / filename)


def resolve_access_log_path() -> Path:
    base_dir = Path(XRAY_LOG_DIR or _resolve_assets_base() or "/var/log").expanduser()
    candidates: list[Path] = []

    # 1) Prefer the actual resolved path used by the running core (if any)
    try:
        core_access = getattr(getattr(xray, "core", None), "access_log_path", None)
        if core_access:
            candidates.append(Path(core_access).expanduser())
    except Exception:
        pass

    # 2) Use the configured log.access value (respecting relative/None/empty)
    log_config: dict[str, Any] = {}
    try:
        log_config = getattr(getattr(xray, "config", None), "get", lambda *_: {})("log", {}) or {}
    except Exception:
        log_config = {}

    if not isinstance(log_config, dict):
        log_config = {}

    resolved = _resolve_log_path(log_config.get("access"), "access.log", base_dir)
    if resolved and resolved.lower() != "none":
        candidates.append(Path(resolved).expanduser())

    # 3) Fallback to conventional system locations
    candidates.extend(
        [
            base_dir / "access.log",
            Path("/var/log/xray/access.log"),
            Path("/var/log/xray/access/access.log"),
        ]
    )

    # Return the first existing path; otherwise return the first candidate for error reporting.
    existing = next((p for p in candidates if p and p.exists()), None)
    if existing:
        return existing
    return candidates[0] if candidates else base_dir / "access.log"


def _build_geosite_index(geosite_path: Path) -> GeoSiteIndex:
    data = geosite_path.read_bytes()
    proto = config_pb2.GeoSiteList()
    proto.ParseFromString(data)

    full: dict[str, str] = {}
    suffix: dict[str, str] = {}
    plain: list[tuple[str, str]] = []
    regex: list[tuple[str, re.Pattern[str]]] = []

    for entry in proto.entry:
        label = (entry.country_code or "").strip().lower() or "unknown"
        for domain in entry.domain:
            value = (domain.value or "").strip().lower()
            if not value:
                continue
            dtype = domain.type
            if dtype == config_pb2.Domain.Type.Full:
                full.setdefault(value, label)
            elif dtype == config_pb2.Domain.Type.Domain:
                suffix.setdefault(value, label)
            elif dtype == config_pb2.Domain.Type.Regex:
                try:
                    regex.append((label, re.compile(value, re.IGNORECASE)))
                except re.error:
                    continue
            else:
                plain.append((label, value))

    return GeoSiteIndex(full=full, suffix=suffix, plain=plain, regex=regex)


def _build_geoip_index(geoip_path: Path) -> GeoIPIndex:
    data = geoip_path.read_bytes()
    proto = config_pb2.GeoIPList()
    proto.ParseFromString(data)

    ipv4: list[tuple[ipaddress.IPv4Network, str]] = []
    ipv6: list[tuple[ipaddress.IPv6Network, str]] = []

    for entry in proto.entry:
        label = (entry.country_code or "").strip().lower() or "unknown"
        if entry.reverse_match:
            continue  # Unsupported in this lightweight inspector
        for cidr in entry.cidr:
            try:
                ip_obj = ipaddress.ip_address(cidr.ip)
                network = ipaddress.ip_network((ip_obj, cidr.prefix), strict=False)
            except ValueError:
                continue
            if isinstance(network, ipaddress.IPv4Network):
                ipv4.append((network, label))
            else:
                ipv6.append((network, label))

    ipv4.sort(key=lambda item: item[0].prefixlen, reverse=True)
    ipv6.sort(key=lambda item: item[0].prefixlen, reverse=True)
    return GeoIPIndex(ipv4=ipv4, ipv6=ipv6)


def load_geo_assets() -> GeoAssets:
    base_dir = _resolve_assets_base()
    geosite_path = base_dir / "geosite.dat"
    geoip_path = base_dir / "geoip.dat"

    geosite_mtime = geosite_path.stat().st_mtime if geosite_path.exists() else None
    geoip_mtime = geoip_path.stat().st_mtime if geoip_path.exists() else None

    global _geo_cache
    with _geo_cache_lock:
        if (
            _geo_cache
            and _geo_cache.base_dir == base_dir
            and _geo_cache.geosite_mtime == geosite_mtime
            and _geo_cache.geoip_mtime == geoip_mtime
        ):
            return _geo_cache

        geosite_index = _build_geosite_index(geosite_path) if geosite_path.exists() else GeoSiteIndex({}, {}, [], [])
        geoip_index = _build_geoip_index(geoip_path) if geoip_path.exists() else GeoIPIndex([], [])

        _geo_cache = GeoAssets(
            base_dir=base_dir,
            geosite_path=geosite_path if geosite_path.exists() else None,
            geoip_path=geoip_path if geoip_path.exists() else None,
            geosite_mtime=geosite_mtime,
            geoip_mtime=geoip_mtime,
            geosite=geosite_index,
            geoip=geoip_index,
        )
        return _geo_cache


def _load_json_geo_assets() -> tuple[dict[str, str], list[tuple[ipaddress._BaseNetwork, str]]]:
    """
    Load supplemental geosite/geoip JSON definitions from GitHub with caching.
    Returns (domain_map, ip_networks)
    """
    with _json_geo_lock:
        loaded_at = _json_geo_cache.get("loaded_at")
        if isinstance(loaded_at, datetime):
            loaded_at = _ensure_utc(loaded_at)
        if loaded_at and (_utcnow() - loaded_at).total_seconds() < _JSON_GEO_TTL_SECONDS:
            return _json_geo_cache.get("domain_map", {}), _json_geo_cache.get("ip_networks", [])

        domain_map: dict[str, str] = {}
        ip_networks: list[tuple[ipaddress._BaseNetwork, str]] = []

        def _fetch(url: str) -> Optional[dict]:
            try:
                resp = requests.get(url, timeout=15)
                resp.raise_for_status()
                return resp.json()
            except Exception:
                return None

        geosite_json = _fetch(_JSON_GEOSITE_URL) or {}
        for category, entries in geosite_json.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                label = entry.get("name") or category
                for domain in entry.get("domains", []) or []:
                    if isinstance(domain, str) and domain:
                        domain_map[domain.strip().lower()] = label

        geoip_json = _fetch(_JSON_GEOIP_URL) or {}
        for category, entries in geoip_json.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                label = entry.get("name") or category
                for cidr in entry.get("cidr", []) or entry.get("ips", []) or []:
                    try:
                        net = ipaddress.ip_network(cidr, strict=False)
                        ip_networks.append((net, label))
                    except Exception:
                        continue

        _json_geo_cache["loaded_at"] = _utcnow()
        _json_geo_cache["domain_map"] = domain_map
        _json_geo_cache["ip_networks"] = ip_networks
        return domain_map, ip_networks


def classify_host(host: str, assets: GeoAssets) -> Optional[str]:
    value = (host or "").strip().lower().rstrip(".")
    if not value:
        return None

    # Check supplemental JSON geosite first
    domain_map, _ = _load_json_geo_assets()
    if domain_map:
        if value in domain_map:
            return domain_map[value]
        parts = value.split(".")
        for i in range(len(parts)):
            candidate = ".".join(parts[i:])
            if candidate in domain_map:
                return domain_map[candidate]

    site = assets.geosite
    if value in site.full:
        return site.full[value]

    parts = value.split(".")
    for i in range(len(parts)):
        candidate = ".".join(parts[i:])
        if candidate in site.suffix:
            return site.suffix[candidate]

    for label, keyword in site.plain:
        if keyword and keyword in value:
            return label

    for label, pattern in site.regex:
        if pattern.search(value):
            return label

    return None


def classify_ip(ip: str, assets: GeoAssets) -> Optional[str]:
    if not ip:
        return None
    try:
        ip_obj = ipaddress.ip_address(ip)
    except ValueError:
        return None

    # Check supplemental JSON geoip first
    _, json_ip_networks = _load_json_geo_assets()
    for network, label in json_ip_networks:
        if ip_obj in network:
            return label

    networks = assets.geoip.ipv4 if ip_obj.version == 4 else assets.geoip.ipv6
    for network, label in networks:
        if ip_obj in network:
            return label
    return None


def classify_connection(host: str | None, ip: str | None, assets: GeoAssets) -> str:
    label = None
    if host:
        label = classify_host(host, assets)
    if not label and ip:
        label = classify_ip(ip, assets)
    return label or "unknown"


def _load_json_isp_ranges() -> list[tuple[ipaddress._BaseNetwork, str, str]]:
    with _json_geo_lock:
        loaded_at = _json_isp_cache.get("loaded_at")
        if isinstance(loaded_at, datetime):
            loaded_at = _ensure_utc(loaded_at)
        if loaded_at and (_utcnow() - loaded_at).total_seconds() < _JSON_GEO_TTL_SECONDS:
            return _json_isp_cache.get("ranges", [])

        ranges: list[tuple[ipaddress._BaseNetwork, str, str]] = []
        try:
            resp = requests.get(_JSON_ISP_URL, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                for entry in data:
                    if not isinstance(entry, dict):
                        continue
                    start = entry.get("from")
                    end = entry.get("to")
                    short_name = (entry.get("short_name") or entry.get("owner") or "Unknown").strip()
                    owner = (entry.get("owner") or short_name).strip()
                    try:
                        if start and end:
                            start_ip = ipaddress.ip_address(start)
                            end_ip = ipaddress.ip_address(end)
                            for net in ipaddress.summarize_address_range(start_ip, end_ip):
                                ranges.append((net, short_name, owner))
                    except Exception:
                        continue
        except Exception:
            ranges = _json_isp_cache.get("ranges", [])

        _json_isp_cache["loaded_at"] = _utcnow()
        _json_isp_cache["ranges"] = ranges
        return ranges


def classify_isp(ip: str) -> tuple[str, str]:
    """
    Return (short_name, owner) based on ISP range JSON; fall back to Unknown.
    """
    try:
        ip_obj = ipaddress.ip_address(ip)
    except Exception:
        return ("Unknown", "Unknown")

    for net, short_name, owner in _load_json_isp_ranges():
        if ip_obj in net:
            return (short_name or owner or "Unknown", owner or short_name or "Unknown")
    return ("Unknown", "Unknown")


def guess_platform(host: str | None, ip: str | None, assets: GeoAssets) -> str:
    """
    Fast, heuristic-oriented classifier for analytics.
    Prefers quick string checks; falls back to lightweight geosite,
    and only cheap IP prefix heuristics (no full geoip scan).
    """
    host_val = (host or "").lower()
    if host_val:
        # Access log parser may produce truncated bracketed IPv6 hosts like "[2a02".
        # Treat those as IPv6 traffic instead of unmapped "other".
        if host_val.startswith("["):
            return "ipv6"

        fast_map = [
            (("googlevideo.com", "ytimg.com", "youtube.com"), "youtube"),
            (("instagram.com", "cdninstagram.com", "fbcdn.net"), "instagram"),
            (("tiktok", "pangle", "ibyteimg.com", "byteimg.com"), "tiktok"),
            (("whatsapp.com", "whatsapp.net"), "whatsapp"),
            (("facebook.com", "messenger.com"), "facebook"),
            (("telegram.org", "t.me", "telegram.me"), "telegram"),
            (("snapchat.com",), "snapchat"),
            (("netflix.com",), "netflix"),
            (("twitter.com", "x.com"), "twitter"),
            (
                (
                    "google.com",
                    "googleapis.com",
                    "gstatic.com",
                    "gmail.com",
                    "google.",
                    "play.googleapis.com",
                    "googlevideo.com",
                    "googleusercontent.com",
                    "crashlytics.com",
                    "doubleclick.net",
                    "gvt1.com",
                    "ggpht.com",
                    "dns.google",
                ),
                "google",
            ),
            (("icloud.com", "apple.com", "mzstatic.com", "mail.me.com", "safebrowsing.apple"), "apple"),
            (
                (
                    "microsoft.com",
                    "live.com",
                    "office.com",
                    "msn.com",
                    "bing.com",
                    "trafficmanager.net",
                    "vscode-cdn.net",
                    "vscode.dev",
                    "vscode-sync.",
                ),
                "microsoft",
            ),
            (
                (
                    "github.com",
                    "githubusercontent.com",
                    "githubassets.com",
                    "github.io",
                    "github.dev",
                    "alive.github.com",
                ),
                "github",
            ),
            (
                (
                    "steampowered.com",
                    "steamcommunity.com",
                    "steamstatic.com",
                    "steamserver.net",
                    "steamcontent.com",
                    "steam-chat.com",
                ),
                "steam",
            ),
            (
                (
                    "chatgpt.com",
                    "chat.openai.com",
                    "ab.chatgpt.com",
                    "openai.com",
                    "auth.openai.com",
                    "help.openai.com",
                    "cdn.platform.openai.com",
                    "cdn.openai.com",
                    "oaistatic.com",
                ),
                "openai",
            ),
            (
                (
                    "opera.com",
                    "operacdn.com",
                ),
                "opera",
            ),
            (
                (
                    "mail.yahoo.com",
                    "yahoo.com",
                    "yahoosandbox.net",
                ),
                "yahoo",
            ),
            (
                (
                    "micloud.xiaomi.net",
                    "miui.com",
                    "xiaomi.com",
                    "msg.global.xiaomi.net",
                ),
                "xiaomi",
            ),
            (("neshanmap.ir",), "neshan"),
            (("eitaa.com", "eitaa.ir"), "eitaa"),
            (("web.splus.ir",), "splus"),
            (("linkedin.com",), "linkedin"),
            (("divar.ir", "divarcdn.com"), "divar"),
            (("services.mozilla.com",), "mozilla"),
            (("codmwest.com",), "codm"),
            (("soundcloud.com",), "soundcloud"),
            (("discord.gg", "discord.com"), "discord"),
            (("yektanet.com",), "yektanet"),
            (("tsyndicate.com",), "tsyndicate"),
            (("uuidksinc.net",), "uuidksinc"),
            (("beyla.site",), "beyla"),
            (("flixcdn.com",), "flixcdn"),
            (("xhcdn.com", "xnxx-cdn.com"), "porn"),
            (("hansha.online",), "hansha"),
            (("sotoon.ir",), "sotoon"),
            (("ocsp-certum.com",), "certum"),
            (("mazholl.com",), "mazholl"),
            (("samsungosp.com", "samsungapps.com"), "samsung"),
            (("samsungiotcloud.com",), "samsung"),
            (("ipwho.is", "api.ip.sb", "seeip.org"), "ip_lookup"),
            (("ifconfig.co",), "ip_lookup"),
            (("cloudflare.com", "one.one.one.one", "pullcf.com"), "cloudflare"),
            (("applovin.com",), "applovin"),
            (("applvn.com",), "applovin"),
            (("samsung.com", "samsungcloudcdn.com"), "samsung"),
            (("googlesyndication.com", "googleadservices.com"), "google_ads"),
            (("appmetrica.yandex.net",), "yandex"),
            (("playfabapi.com",), "playfab"),
            (("shalltry.com", "transsion-os.com"), "transsion"),
            (("optime-ai.com",), "optime_ai"),
            (("truecaller.com",), "truecaller"),
            (("xiaohongshu.com",), "xiaohongshu"),
            (("dbankcloud.asia", "dbankcloud.eu"), "huawei"),
            (("launchdarkly.com",), "launchdarkly"),
            (("expressapisv2.net",), "expressapis"),
            (("dalyfeds.com",), "dalyfeds"),
            (("fexori.com",), "fexori"),
        ]
        for needles, platform in fast_map:
            if any(n in host_val for n in needles):
                return platform

        if "1.1.1.1" in host_val:
            return "cloudflare"

        label = classify_host(host_val, assets)
        if label and label != "unknown":
            return label

    ip_val = ip or ""
    if ip_val:
        fast_ip_map = [
            (("149.154.", "91.108."), "telegram"),
            (("157.240.",), "facebook"),
            (("102.132.",), "facebook"),
            (("31.13.", "57.144.", "185.60."), "instagram"),
            (("140.82.", "185.199.", "20.201.", "192.30."), "github"),
            (("155.133.", "162.254.", "208.64.", "146.66.", "205.196."), "steam"),
            (("47.241.", "47.74.", "161.117."), "alibaba"),
            (("20.33.",), "microsoft"),
            (("2.16.",), "akamai"),
            (("2.189.58.",), "eitaa"),
            (("2.189.68.", "5.28.", "85.133.", "185.79.", "195.254.", "91.98."), "iran"),
            (("13.51.",), "aws"),
            (
                (
                    "188.212.98.",
                    "89.167.",
                    "194.26.66.",
                    "74.1.1.",
                    "87.248.132.",
                    "65.21.",
                    "65.109.",
                    "95.216.",
                    "37.27.",
                    "5.78.",
                    "193.151.132.",
                    "199.103.24.",
                    "82.21.204.",
                    "195.62.32.",
                    "198.46.254.",
                    "178.156.212.",
                    "185.22.42.",
                    "212.33.197.",
                    "156.146.",
                ),
                "hosting",
            ),
            (("17.",), "apple"),
            (
                ("172.64.", "172.65.", "162.159.", "104.16.", "104.17.", "104.18.", "104.19.", "104.20."),
                "cloudflare",
            ),
            (
                (
                    "8.8.8.8",
                    "8.8.4.4",
                    "216.58.",
                    "216.239.",
                    "142.250.",
                    "142.251.",
                    "172.217.",
                    "173.194.",
                    "74.125.",
                    "34.102.",
                    "34.120.",
                    "35.190.",
                ),
                "google",
            ),
            (("1.1.1.1", "1.0.0.1"), "cloudflare-dns"),
            (("10.", "127.", "198.18.", "239.255.255."), "local"),
            (("71.18.",), "tiktok"),
        ]
        for prefixes, platform in fast_ip_map:
            if any(ip_val.startswith(pref) for pref in prefixes):
                return platform

    return "other"


def _build_user_key(source: str, email: Optional[str]) -> tuple[str, str]:
    """
    Build a stable grouping key for a logical user.
    Prefers email when present; otherwise strips port from source.
    """
    if email:
        key = email.strip().lower()
        label = email.strip()
        if key:
            return key, label or key

    src = (source or "").strip()
    if ":" in src and not src.startswith("["):
        ip_part = src.split(":", 1)[0]
    else:
        ip_part = src
    return ip_part, ip_part


ACCESS_RE = re.compile(
    r"^(?P<ts>\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+"
    r"from\s+(?:(?P<src_prefix>\w+):)?(?P<src_ip>[0-9a-fA-F\.:]+)"
    r"(?::(?P<src_port>\d+))?\s+"
    r"(?P<action>accepted|rejected)\s+"
    r"(?:(?P<net>\w+):)?(?P<dest>[^:\s]+)"
    r"(?::(?P<dest_port>\d+))?"
    r"(?:\s+\[(?P<route>[^\]]+)\])?"
    r"(?:\s+email:\s+(?P<email>\S+))?",
    re.IGNORECASE,
)


def _parse_timestamp(raw: str) -> Optional[datetime]:
    for fmt in ("%Y/%m/%d %H:%M:%S.%f", "%Y/%m/%d %H:%M:%S"):
        try:
            return _ensure_utc(datetime.strptime(raw, fmt))
        except ValueError:
            continue
    return None


def parse_access_line(line: str) -> Optional[dict[str, Any]]:
    match = ACCESS_RE.match(line.strip())
    if not match:
        return None

    action = (match.group("action") or "").lower()
    ts_raw = match.group("ts") or ""
    dest = match.group("dest") or ""
    dest_ip: Optional[str] = None
    try:
        ipaddress.ip_address(dest)
        dest_ip = dest
    except ValueError:
        dest_ip = None

    source_ip = match.group("src_ip") or ""
    email = match.group("email") or None
    user_key, user_label = _build_user_key(source_ip, email)

    ts_parsed = _parse_timestamp(ts_raw)

    return {
        "timestamp": ts_parsed,
        "action": action,
        "protocol": (match.group("net") or "").lower(),
        "destination": dest,
        "destination_port": int(match.group("dest_port")) if match.group("dest_port") else None,
        "destination_ip": dest_ip,
        "source": source_ip,
        "source_port": int(match.group("src_port")) if match.group("src_port") else None,
        "email": email,
        "route": match.group("route") or None,
        "user_key": user_key,
        "user_label": user_label,
        "raw": line.rstrip(),
    }


def _tail(path: Path, max_lines: int) -> list[str]:
    """
    Read only the tail of a large file efficiently without loading the whole file.
    Returns lines in chronological order.
    """
    if max_lines <= 0:
        return []

    lines: list[bytes] = []
    buffer = b""
    chunk_size = 8192
    newline = b"\n"

    with path.open("rb") as fp:
        fp.seek(0, os.SEEK_END)
        position = fp.tell()

        while position > 0 and len(lines) < max_lines:
            read_size = min(chunk_size, position)
            position -= read_size
            fp.seek(position)
            data = fp.read(read_size)
            buffer = data + buffer
            parts = buffer.split(newline)
            buffer = parts[0]  # First part may be incomplete; carry over to next chunk

            for line in reversed(parts[1:]):
                if len(lines) >= max_lines:
                    break
                if line.endswith(b"\r"):
                    line = line[:-1]
                lines.append(line)

        if buffer and len(lines) < max_lines:
            lines.append(buffer.rstrip(b"\r"))

    # We collected from the end backwards; reverse to chronological order
    return [line.decode("utf-8", errors="ignore") for line in reversed(lines)]


def build_access_insights(
    limit: int = 200,
    lookback_lines: int = 1500,
    search: str = "",
    window_seconds: int = 120,
) -> dict[str, Any]:
    # Gate by panel settings to avoid unnecessary memory usage when disabled
    try:
        from app.services.panel_settings import PanelSettingsService

        if not PanelSettingsService.get_settings(ensure_record=True).access_insights_enabled:
            return {
                "error": "access_insights_disabled",
                "detail": "Access Insights is disabled in panel settings",
                "log_path": "",
                "items": [],
                "platform_counts": {},
                "platforms": [],
                "matched_entries": 0,
                "geo_assets_path": "",
                "geo_assets": {"geosite": False, "geoip": False},
                "generated_at": _utc_iso(),
                "lookback_lines": 0,
                "window_seconds": window_seconds,
            }
    except Exception:
        # On error reading settings, proceed but keep safeguards below
        pass

    # Clamp lookback and window to sane bounds
    lookback_lines = max(limit, min(lookback_lines, 10000))
    window_seconds = max(5, min(window_seconds, 3600))

    log_path = resolve_access_log_path()
    if not log_path.exists():
        return {
            "error": "access_log_missing",
            "detail": f"access log not found at {log_path}",
            "log_path": str(log_path),
            "items": [],
            "platform_counts": {},
            "platforms": [],
            "matched_entries": 0,
            "geo_assets_path": str(_resolve_assets_base()),
            "geo_assets": {"geosite": False, "geoip": False},
            "generated_at": _utc_iso(),
            "lookback_lines": lookback_lines,
            "window_seconds": window_seconds,
        }

    assets = load_geo_assets()
    lines = _tail(log_path, lookback_lines)

    # Aggregation structures
    clients: dict[str, dict[str, Any]] = {}
    users_by_platform: dict[str, set[str]] = {}
    total_unique_clients: set[str] = set()
    platform_cache: dict[tuple[Any, Any], Optional[str]] = {}
    isp_cache: dict[str, tuple[str, str]] = {}
    unmatched_entries: list[dict[str, Any]] = []
    unmatched_seen: set[tuple[str, Optional[str]]] = set()
    redis_client = get_redis() if REDIS_ENABLED else None

    cutoff = _utcnow() - timedelta(seconds=window_seconds)
    total_matches = 0

    for raw in reversed(lines):
        entry = parse_access_line(raw)
        if not entry:
            continue
        if entry["action"] != "accepted":
            continue

        ts = entry.get("timestamp")
        if not isinstance(ts, datetime):
            continue
        if ts < cutoff:
            break

        source_ip = entry.get("source") or ""
        if ":" in source_ip and not source_ip.startswith("["):
            source_ip = source_ip.split(":", 1)[0]
        if source_ip.startswith("127.") or source_ip == "localhost":
            continue

        dest = entry.get("destination")
        dest_ip = entry.get("destination_ip")
        cache_key = (dest, dest_ip)
        platform = platform_cache.get(cache_key)
        if platform is None:
            redis_key = None
            if dest or dest_ip:
                redis_key = f"access:platform:{dest or ''}:{dest_ip or ''}"
            if redis_client and redis_key:
                try:
                    cached = redis_client.get(redis_key)
                    if cached:
                        platform = cached.decode() if isinstance(cached, bytes) else cached
                except Exception:
                    platform = None

            if platform is None:
                platform = guess_platform(dest, dest_ip, assets)
                if redis_client and redis_key and platform:
                    try:
                        redis_client.setex(redis_key, 3600, platform)
                    except Exception:
                        pass
            platform_cache[cache_key] = platform

        entry["platform"] = platform

        user_key = entry.get("user_key") or "unknown"
        user_label = entry.get("user_label") or user_key
        total_unique_clients.add(user_key)
        users_by_platform.setdefault(platform, set()).add(user_key)

        # Aggregate per client
        client = clients.get(user_key)
        if not client:
            client = {
                "user_key": user_key,
                "user_label": user_label,
                "last_seen": ts,
                "route": entry.get("route") or "",
                "connections": 0,
                "sources": set(),
                "nodes": set(),
                "source_nodes": {},
                "operators": {},
                "operator_counts": {},
                "platforms": {},
            }
            clients[user_key] = client

        if source_ip:
            client["sources"].add(source_ip)
            client["nodes"].add("master")
            source_nodes = client["source_nodes"]
            if source_ip not in source_nodes:
                source_nodes[source_ip] = set()
            source_nodes[source_ip].add("master")
            op_short, op_owner = isp_cache.get(source_ip) or ("Unknown", "Unknown")
            if source_ip not in isp_cache:
                op_short, op_owner = classify_isp(source_ip)
                isp_cache[source_ip] = (op_short, op_owner)
            client["operators"][source_ip] = {"short_name": op_short, "owner": op_owner}
            op_key = op_short or op_owner or "Unknown"
            client["operator_counts"][op_key] = client["operator_counts"].get(op_key, 0) + 1
        client["connections"] = len(client["sources"]) if client["sources"] else client["connections"] + 1
        if ts > client["last_seen"]:
            client["last_seen"] = ts
        if entry.get("route"):
            client["route"] = entry["route"]

        pmap = client["platforms"]
        pdata = pmap.get(platform)
        if not pdata:
            pdata = {"platform": platform, "connections": 0, "destinations": set()}
            pmap[platform] = pdata
        pdata["connections"] += 1
        if entry.get("destination"):
            pdata["destinations"].add(entry["destination"])

        total_matches += 1

        if platform == "other":
            marker = (entry.get("destination") or "", entry.get("destination_ip"))
            if marker not in unmatched_seen:
                unmatched_seen.add(marker)
                unmatched_entries.append(
                    {
                        "destination": entry.get("destination") or "",
                        "destination_ip": entry.get("destination_ip"),
                        "platform": platform,
                    }
                )

    # Finalize clients list
    client_list: list[dict[str, Any]] = []
    for c in clients.values():
        platforms_list = []
        for pdata in c["platforms"].values():
            platforms_list.append(
                {
                    "platform": pdata["platform"],
                    "connections": pdata["connections"],
                    "destinations": sorted(pdata["destinations"]),
                }
            )
        platforms_list.sort(key=lambda x: x["connections"], reverse=True)
        last_seen_dt: datetime = c["last_seen"]
        client_list.append(
            {
                "user_key": c["user_key"],
                "user_label": c["user_label"],
                "last_seen": _utc_iso(last_seen_dt),
                "route": c.get("route") or "",
                "connections": c["connections"],
                "sources": sorted(c.get("sources") or []),
                "nodes": sorted(c.get("nodes") or []),
                "source_nodes": {
                    ip: sorted(list(node_names)) for ip, node_names in sorted((c.get("source_nodes") or {}).items())
                },
                "operators": [
                    {"ip": ip, "short_name": meta.get("short_name"), "owner": meta.get("owner")}
                    for ip, meta in sorted(c.get("operators", {}).items())
                ],
                "operator_counts": c.get("operator_counts", {}),
                "platforms": platforms_list,
            }
        )

    client_list.sort(key=lambda x: x["last_seen"], reverse=True)
    if limit and limit > 0:
        client_list = client_list[:limit]

    platform_counts = {name: len(user_set) for name, user_set in users_by_platform.items()}
    top_platforms = sorted(platform_counts.items(), key=lambda kv: kv[1], reverse=True)

    return {
        "log_path": str(log_path),
        "geo_assets_path": str(assets.base_dir),
        "geo_assets": {
            "geosite": assets.geosite_loaded,
            "geoip": assets.geoip_loaded,
        },
        "items": client_list,
        "platform_counts": platform_counts,
        "platforms": [
            {
                "platform": name,
                "count": count,
                "percent": (count / len(total_unique_clients)) if total_unique_clients else 0.0,
            }
            for name, count in top_platforms
        ],
        "matched_entries": total_matches,
        "generated_at": _utc_iso(),
        "lookback_lines": lookback_lines,
        "window_seconds": window_seconds,
        "unmatched": unmatched_entries,
    }


def _fetch_node_access_logs(node, max_lines: int = 500) -> list[str]:
    """
    Fetch access logs from a remote node.
    Uses websocket transport when available on the node, otherwise REST fallback.
    Returns list of log lines.
    """
    max_lines = max(1, int(max_lines))
    try:
        # New node client API (websocket-preferred + REST fallback)
        if hasattr(node, "get_access_logs"):
            lines = node.get_access_logs(max_lines=max_lines)
            if isinstance(lines, list):
                return [str(line) for line in lines]
            raise RuntimeError("Invalid access logs response from node")

        # Legacy fallback for older node client objects.
        if hasattr(node, "_ensure_connected"):
            node._ensure_connected()

        response = node.make_request("/access_logs", timeout=40, max_lines=max_lines)
        if isinstance(response, dict):
            if not response.get("exists"):
                return []
            lines = response.get("lines") or []
            if isinstance(lines, list):
                return [str(line) for line in lines]
            raise RuntimeError("Invalid access logs payload from node")
        return []
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc


def _iter_source_lines(source: NodeLogSource, max_lines: int) -> list[str]:
    """Retrieve recent lines for a source, using a fetcher when provided or tailing a local file."""
    if source.fetch_lines:
        return source.fetch_lines(max_lines)

    if source.log_path and source.log_path.exists():
        return _tail(source.log_path, max_lines)

    return []


def _distribute_line_budget(
    total_lines: int,
    source_count: int,
    preferred_min_per_source: int = 0,
) -> list[int]:
    """
    Distribute one global line budget across N sources without exceeding total_lines.
    """
    if source_count <= 0:
        return []

    total_lines = max(0, int(total_lines))
    preferred_min_per_source = max(0, int(preferred_min_per_source))

    if preferred_min_per_source > 0 and total_lines >= preferred_min_per_source * source_count:
        budgets = [preferred_min_per_source] * source_count
        remaining = total_lines - (preferred_min_per_source * source_count)
        idx = 0
        while remaining > 0:
            budgets[idx] += 1
            remaining -= 1
            idx = (idx + 1) % source_count
        return budgets

    base = total_lines // source_count
    remainder = total_lines % source_count
    return [base + (1 if i < remainder else 0) for i in range(source_count)]


def stream_raw_logs(
    max_lines: int = 500,
    node_id: Optional[int] = None,
    search: str = "",
) -> Iterator[dict[str, Any]]:
    """
    Stream raw log entries for frontend processing.
    This reduces backend CPU/RAM by offloading parsing to client.

    Yields chunks of log data that can be processed by the frontend.
    """
    try:
        from app.services.panel_settings import PanelSettingsService

        if not PanelSettingsService.get_settings(ensure_record=True).access_insights_enabled:
            yield {"error": "access_insights_disabled"}
            return
    except Exception:
        yield {"error": "settings_unavailable"}
        return

    sources = get_all_log_sources()

    # Filter to specific node if requested
    if node_id is not None:
        sources = [s for s in sources if s.node_id == node_id]

    if not sources:
        yield {"error": "no_log_sources"}
        return

    # Send metadata first
    yield {
        "type": "metadata",
        "sources": [
            {
                "node_id": s.node_id,
                "node_name": s.node_name,
                "is_master": s.is_master,
                "connected": s.connected,
            }
            for s in sources
        ],
    }

    # Stream lines from each source
    search_lower = search.lower() if search else ""
    source_budgets = _distribute_line_budget(
        total_lines=max_lines,
        source_count=len(sources),
        preferred_min_per_source=50,
    )

    for source, source_max_lines in zip(sources, source_budgets):
        if source_max_lines <= 0:
            continue
        try:
            lines = _iter_source_lines(source, source_max_lines)
            total_lines = len(lines)

            chunk = []
            matched_lines = 0
            for line in lines:
                if search_lower and search_lower not in line.lower():
                    continue

                chunk.append(line)
                matched_lines += 1

                if len(chunk) >= 50:
                    yield {
                        "type": "logs",
                        "node_id": source.node_id,
                        "node_name": source.node_name,
                        "lines": chunk,
                    }
                    chunk = []

            # Send remaining lines
            if chunk:
                yield {
                    "type": "logs",
                    "node_id": source.node_id,
                    "node_name": source.node_name,
                    "lines": chunk,
                }

            yield {
                "type": "source_status",
                "node_id": source.node_id,
                "node_name": source.node_name,
                "is_master": source.is_master,
                "connected": source.connected,
                "ok": True,
                "total_lines": total_lines,
                "matched_lines": matched_lines,
            }

        except Exception as e:
            yield {
                "type": "error",
                "node_id": source.node_id,
                "node_name": source.node_name,
                "error": str(e),
            }
            yield {
                "type": "source_status",
                "node_id": source.node_id,
                "node_name": source.node_name,
                "is_master": source.is_master,
                "connected": source.connected,
                "ok": False,
                "total_lines": 0,
                "matched_lines": 0,
                "error": str(e),
            }

    yield {"type": "complete"}


def build_multi_node_insights(
    limit: int = 200,
    lookback_lines: int = 1000,
    search: str = "",
    window_seconds: int = 120,
    node_ids: Optional[list[int]] = None,
) -> dict[str, Any]:
    """
    Build access insights from multiple nodes with optimized memory usage.
    """
    try:
        from app.services.panel_settings import PanelSettingsService

        if not PanelSettingsService.get_settings(ensure_record=True).access_insights_enabled:
            return {
                "error": "access_insights_disabled",
                "detail": "Access Insights is disabled in panel settings",
                "items": [],
                "platforms": [],
                "generated_at": _utc_iso(),
            }
    except Exception:
        pass

    sources = get_all_log_sources()

    if node_ids is not None:
        sources = [s for s in sources if s.node_id in node_ids or (s.is_master and None in node_ids)]

    if not sources:
        return {
            "error": "no_log_sources",
            "detail": "No access logs found for the requested nodes",
            "items": [],
            "platforms": [],
            "generated_at": _utc_iso(),
        }

    lookback_lines = max(limit, min(lookback_lines, 2000))
    window_seconds = max(5, min(window_seconds, 600))

    assets = load_geo_assets()
    cutoff = _utcnow() - timedelta(seconds=window_seconds)

    MAX_CLIENTS = 500
    clients: dict[str, dict[str, Any]] = {}
    users_by_platform: dict[str, set[str]] = {}
    platform_cache: dict[tuple[Any, Any], Optional[str]] = {}
    isp_cache: dict[str, tuple[str, str]] = {}
    redis_client = get_redis() if REDIS_ENABLED else None

    total_matches = 0
    search_lower = (search or "").strip().lower()
    source_statuses: list[dict[str, Any]] = []
    source_budgets = _distribute_line_budget(
        total_lines=lookback_lines,
        source_count=len(sources),
        preferred_min_per_source=100,
    )

    for source, source_max_lines in zip(sources, source_budgets):
        if source_max_lines <= 0:
            continue
        try:
            lines = _iter_source_lines(source, source_max_lines)
        except Exception as exc:
            source_statuses.append(
                {
                    "node_id": source.node_id,
                    "node_name": source.node_name,
                    "is_master": source.is_master,
                    "connected": source.connected,
                    "ok": False,
                    "total_lines": 0,
                    "matched_lines": 0,
                    "error": str(exc),
                }
            )
            continue

        source_total_lines = len(lines)
        source_matched_lines = 0
        for raw in reversed(lines):
            if search_lower and search_lower not in raw.lower():
                continue
            source_matched_lines += 1
            entry = parse_access_line(raw)
            if not entry or entry.get("action") != "accepted":
                continue

            ts = entry.get("timestamp")
            if not isinstance(ts, datetime):
                continue
            if ts < cutoff:
                break

            source_ip = entry.get("source") or ""
            if ":" in source_ip and not source_ip.startswith("["):
                source_ip = source_ip.split(":", 1)[0]
            if source_ip.startswith("127.") or source_ip == "localhost":
                continue

            dest = entry.get("destination")
            dest_ip = entry.get("destination_ip")
            cache_key = (dest, dest_ip)
            platform = platform_cache.get(cache_key)

            if platform is None and redis_client:
                redis_key = f"access:platform:{dest or ''}:{dest_ip or ''}"
                try:
                    cached = redis_client.get(redis_key)
                    if cached:
                        platform = cached.decode() if isinstance(cached, bytes) else cached
                except Exception:
                    pass

            if platform is None:
                platform = guess_platform(dest, dest_ip, assets)
                platform_cache[cache_key] = platform
                if redis_client:
                    try:
                        redis_client.setex(f"access:platform:{dest or ''}:{dest_ip or ''}", 3600, platform)
                    except Exception:
                        pass

            entry["platform"] = platform
            entry["node_name"] = source.node_name

            user_key = entry.get("user_key") or "unknown"
            user_label = entry.get("user_label") or user_key

            if user_key not in clients and len(clients) >= MAX_CLIENTS:
                continue

            users_by_platform.setdefault(platform, set()).add(user_key)

            client = clients.get(user_key)
            if not client:
                client = {
                    "user_key": user_key,
                    "user_label": user_label,
                    "last_seen": ts,
                    "route": entry.get("route") or "",
                    "connections": 0,
                    "sources": set(),
                    "nodes": set(),
                    "source_nodes": {},
                    "operators": {},
                    "operator_counts": {},
                    "platforms": {},
                }
                clients[user_key] = client

            client["nodes"].add(source.node_name)

            if source_ip:
                client["sources"].add(source_ip)
                source_nodes = client["source_nodes"]
                if source_ip not in source_nodes:
                    source_nodes[source_ip] = set()
                source_nodes[source_ip].add(source.node_name)
                op_short, op_owner = isp_cache.get(source_ip) or ("Unknown", "Unknown")
                if source_ip not in isp_cache:
                    op_short, op_owner = classify_isp(source_ip)
                    isp_cache[source_ip] = (op_short, op_owner)
                client["operators"][source_ip] = {"short_name": op_short, "owner": op_owner}
                op_key = op_short or op_owner or "Unknown"
                client["operator_counts"][op_key] = client["operator_counts"].get(op_key, 0) + 1

            client["connections"] = len(client["sources"]) if client["sources"] else client["connections"] + 1
            if ts > client["last_seen"]:
                client["last_seen"] = ts
            if entry.get("route"):
                client["route"] = entry["route"]

            pmap = client["platforms"]
            pdata = pmap.get(platform)
            if not pdata:
                pdata = {"platform": platform, "connections": 0, "destinations": set()}
                pmap[platform] = pdata
            pdata["connections"] += 1
            if entry.get("destination"):
                pdata["destinations"].add(entry["destination"])

            total_matches += 1

        source_statuses.append(
            {
                "node_id": source.node_id,
                "node_name": source.node_name,
                "is_master": source.is_master,
                "connected": source.connected,
                "ok": True,
                "total_lines": source_total_lines,
                "matched_lines": source_matched_lines,
            }
        )

    client_list: list[dict[str, Any]] = []
    for c in clients.values():
        platforms_list = []
        for pdata in c["platforms"].values():
            platforms_list.append(
                {
                    "platform": pdata["platform"],
                    "connections": pdata["connections"],
                    "destinations": sorted(list(pdata["destinations"])[:20]),
                }
            )
        platforms_list.sort(key=lambda x: x["connections"], reverse=True)

        last_seen_dt: datetime = c["last_seen"]
        client_list.append(
            {
                "user_key": c["user_key"],
                "user_label": c["user_label"],
                "last_seen": _utc_iso(last_seen_dt),
                "route": c.get("route") or "",
                "connections": c["connections"],
                "sources": sorted(list(c.get("sources") or [])[:20]),
                "nodes": sorted(list(c.get("nodes") or [])),
                "source_nodes": {
                    ip: sorted(list(node_names)) for ip, node_names in sorted((c.get("source_nodes") or {}).items())
                },
                "operators": [
                    {"ip": ip, "short_name": meta.get("short_name"), "owner": meta.get("owner")}
                    for ip, meta in sorted(list(c.get("operators", {}).items())[:10])
                ],
                "operator_counts": c.get("operator_counts", {}),
                "platforms": platforms_list,
            }
        )

    client_list.sort(key=lambda x: x["last_seen"], reverse=True)
    if limit and limit > 0:
        client_list = client_list[:limit]

    platform_counts = {name: len(user_set) for name, user_set in users_by_platform.items()}
    top_platforms = sorted(platform_counts.items(), key=lambda kv: kv[1], reverse=True)
    total_unique_clients = len(clients)

    return {
        "sources": [
            {
                "node_id": s.node_id,
                "node_name": s.node_name,
                "is_master": s.is_master,
                "connected": s.connected,
            }
            for s in sources
        ],
        "source_statuses": source_statuses,
        "items": client_list,
        "platform_counts": platform_counts,
        "platforms": [
            {
                "platform": name,
                "count": count,
                "percent": (count / total_unique_clients) if total_unique_clients else 0.0,
            }
            for name, count in top_platforms
        ],
        "matched_entries": total_matches,
        "generated_at": _utc_iso(),
        "lookback_lines": lookback_lines,
        "window_seconds": window_seconds,
    }
