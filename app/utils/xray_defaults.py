from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable
import os

import commentjson

from config import XRAY_LOG_DIR, XRAY_ASSETS_PATH


_DEFAULT_XRAY_CONFIG: dict[str, Any] = {
    "log": {
        "loglevel": "warning",
    },
    "routing": {
        "rules": [
            {
                "ip": [
                    "geoip:private",
                ],
                "outboundTag": "BLOCK",
                "type": "field",
            },
        ],
    },
    "inbounds": [
        {
            "tag": "Shadowsocks TCP",
            "listen": "::",
            "port": 1080,
            "protocol": "shadowsocks",
            "settings": {
                "clients": [],
                "network": "tcp,udp",
            },
        },
    ],
    "outbounds": [
        {
            "protocol": "freedom",
            "tag": "DIRECT",
        },
        {
            "protocol": "blackhole",
            "tag": "BLOCK",
        },
    ],
}


LOG_CLEANUP_INTERVAL_DISABLED = 0
LOG_CLEANUP_INTERVAL_OPTIONS_SECONDS = (
    LOG_CLEANUP_INTERVAL_DISABLED,
    3600,
    10800,
    21600,
    86400,
)
VERIFY_PEER_CERT_BY_NAME_MIN_VERSION = "26.1.31"


def normalize_log_cleanup_interval(value: Any) -> int:
    """
    Normalize log cleanup interval to one of the supported seconds values.
    Invalid values fallback to disabled (0).
    """
    if value is None:
        return LOG_CLEANUP_INTERVAL_DISABLED
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return LOG_CLEANUP_INTERVAL_DISABLED
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return LOG_CLEANUP_INTERVAL_DISABLED
    if parsed in LOG_CLEANUP_INTERVAL_OPTIONS_SECONDS:
        return parsed
    return LOG_CLEANUP_INTERVAL_DISABLED


def _first_non_empty_string(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple, set)):
        for item in value:
            candidate = str(item).strip()
            if candidate:
                return candidate
        return ""
    if value is None:
        return ""
    return str(value).strip()


def _normalize_name_list(value: Any) -> list[str]:
    if isinstance(value, str):
        candidate = value.strip()
        return [candidate] if candidate else []
    if isinstance(value, (list, tuple, set)):
        names = [str(item).strip() for item in value]
        return [name for name in names if name]
    return []


def normalize_tls_verify_peer_cert_fields(
    tls_settings: dict[str, Any],
    *,
    use_verify_peer_cert_by_name: bool = True,
) -> dict[str, Any]:
    """
    Normalize TLS verify-peer fields by target Xray compatibility.

    - Newer Xray: use `verifyPeerCertByName` (string), remove old key.
    - Older Xray: use `verifyPeerCertInNames` (list), remove new key.
    """
    if not isinstance(tls_settings, dict):
        return {}

    normalized = dict(tls_settings)
    by_name = _first_non_empty_string(normalized.get("verifyPeerCertByName"))
    in_names = _normalize_name_list(normalized.get("verifyPeerCertInNames"))

    if not by_name and in_names:
        by_name = in_names[0]
    if not in_names and by_name:
        in_names = [by_name]

    if use_verify_peer_cert_by_name:
        if by_name:
            normalized["verifyPeerCertByName"] = by_name
        else:
            normalized.pop("verifyPeerCertByName", None)
        normalized.pop("verifyPeerCertInNames", None)
    else:
        if in_names:
            normalized["verifyPeerCertInNames"] = in_names
        else:
            normalized.pop("verifyPeerCertInNames", None)
        normalized.pop("verifyPeerCertByName", None)
    return normalized


def apply_log_paths(config: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize presence of log config without forcing absolute paths; actual paths are resolved per-runtime.
    """
    cfg = deepcopy(config or {})
    log_cfg = cfg.get("log") or {}
    if not isinstance(log_cfg, dict):
        log_cfg = {}
    # Keep existing values; set defaults to empty (stdout) so callers can override at runtime.
    log_cfg.setdefault("access", log_cfg.get("access", ""))
    log_cfg.setdefault("error", log_cfg.get("error", ""))
    log_cfg["accessCleanupInterval"] = normalize_log_cleanup_interval(log_cfg.get("accessCleanupInterval"))
    log_cfg["errorCleanupInterval"] = normalize_log_cleanup_interval(log_cfg.get("errorCleanupInterval"))
    cfg["log"] = log_cfg
    return cfg


def get_default_xray_config() -> dict[str, Any]:
    """Return a deep copy of the built-in fallback Xray configuration."""
    return deepcopy(_DEFAULT_XRAY_CONFIG)


def _candidate_paths() -> list[Path]:
    base = Path.cwd()
    raw_candidates: Iterable[str | Path | None] = [
        os.environ.get("XRAY_JSON"),
        os.environ.get("XRAY_CONFIG_PATH"),
        os.environ.get("XRAY_CONFIG_JSON"),
        "xray_config.json",
        base / "xray_config.json",
        "config/xray_config.json",
        base / "config" / "xray_config.json",
    ]
    paths: list[Path] = []
    seen: set[Path] = set()
    for candidate in raw_candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if not path.is_absolute():
            path = base / path
        try:
            path = path.resolve()
        except Exception:
            path = path.absolute()
        if path in seen:
            continue
        seen.add(path)
        paths.append(path)
    return paths


def load_legacy_xray_config() -> dict[str, Any]:
    """
    Attempt to read the legacy xray_config.json file (or any override provided
    via environment variables) and return its parsed JSON content. Falls back
    to the built-in default when the file cannot be located or parsed.
    """
    for candidate in _candidate_paths():
        try:
            if not candidate.exists():
                continue
            text = candidate.read_text(encoding="utf-8")
            return commentjson.loads(text)
        except Exception:
            continue

    return get_default_xray_config()
