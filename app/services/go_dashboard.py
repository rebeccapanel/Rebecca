from __future__ import annotations

from typing import Any

from app.services.go_usage import call_bridge


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _admin_payload(admin: Any) -> dict[str, Any]:
    if not admin:
        return {}
    return {
        "id": getattr(admin, "id", None),
        "username": getattr(admin, "username", "") or "",
        "role": _enum_value(getattr(admin, "role", "")) or "",
    }


def get_system_summary(admin: Any) -> dict[str, Any]:
    data = call_bridge(
        "dashboard.system_summary",
        {
            "admin": _admin_payload(admin),
        },
    )
    return data or {}
