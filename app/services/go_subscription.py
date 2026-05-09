from __future__ import annotations

import base64
from typing import Any

from app.services.go_usage import call_bridge


def generate_v2ray_subscription(*, user: Any, as_base64: bool, reverse: bool = False) -> str:
    user_id = getattr(user, "id", None)
    if user_id is None:
        raise ValueError("user id is required for Go subscription generation")

    data = call_bridge(
        "user.config_links",
        {
            "user_id": int(user_id),
            "reverse": bool(reverse),
        },
    ) or {}
    links = data.get("links") or []
    content = "\n".join(str(link) for link in links)
    if as_base64:
        return base64.b64encode(content.encode()).decode()
    return content
