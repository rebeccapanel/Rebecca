from __future__ import annotations

import ctypes
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from config import SQLALCHEMY_DATABASE_URL


class GoUsageUnavailable(RuntimeError):
    pass


class GoUsageError(RuntimeError):
    pass


_bridge = None
_bridge_path: Path | None = None


def _library_names() -> list[str]:
    if sys.platform.startswith("win"):
        return ["rebecca_bridge.dll"]
    if sys.platform == "darwin":
        return ["librebecca_bridge.dylib"]
    return ["librebecca_bridge.so"]


def _candidate_dirs() -> list[Path]:
    root = Path(__file__).resolve().parents[2]
    dirs: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        base = Path(meipass)
        dirs.extend([base / "go_bridge", base])
    dirs.extend([root / "go" / "build", root])
    return dirs


def _load_bridge():
    global _bridge, _bridge_path
    if _bridge is not None:
        return _bridge

    for directory in _candidate_dirs():
        for name in _library_names():
            candidate = directory / name
            if not candidate.exists():
                continue
            bridge = ctypes.CDLL(str(candidate))
            bridge.RebeccaBridgeCall.argtypes = [ctypes.c_char_p]
            bridge.RebeccaBridgeCall.restype = ctypes.c_void_p
            bridge.RebeccaBridgeFree.argtypes = [ctypes.c_void_p]
            bridge.RebeccaBridgeFree.restype = None
            _bridge = bridge
            _bridge_path = candidate
            return bridge

    searched = ", ".join(str(path) for path in _candidate_dirs())
    raise GoUsageUnavailable(f"Rebecca Go usage bridge was not found. Searched: {searched}")


def bridge_path() -> Path | None:
    return _bridge_path


def _dt(value: datetime) -> str:
    return value.isoformat()


def _call(action: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    bridge = _load_bridge()
    request = {
        "action": action,
        "database_url": SQLALCHEMY_DATABASE_URL,
        "payload": payload,
    }
    encoded = json.dumps(request, separators=(",", ":")).encode()
    ptr = bridge.RebeccaBridgeCall(encoded)
    if not ptr:
        raise GoUsageError("Rebecca Go usage bridge returned an empty response")

    try:
        raw = ctypes.string_at(ptr).decode()
    finally:
        bridge.RebeccaBridgeFree(ptr)

    response = json.loads(raw)
    if not response.get("ok"):
        raise GoUsageError(str(response.get("error") or "Rebecca Go usage bridge failed"))
    return response.get("data") or []


def get_user_usage(user_id: int, start: datetime, end: datetime) -> list[dict[str, Any]]:
    return _call(
        "usage.user",
        {
            "user_id": int(user_id),
            "start": _dt(start),
            "end": _dt(end),
        },
    )


def get_users_usage(admins: list[str] | None, start: datetime, end: datetime) -> list[dict[str, Any]]:
    return _call(
        "usage.admins",
        {
            "admins": list(admins or []),
            "start": _dt(start),
            "end": _dt(end),
        },
    )
