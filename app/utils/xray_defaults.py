from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable
import os

import commentjson


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
