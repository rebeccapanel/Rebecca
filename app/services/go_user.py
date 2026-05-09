from __future__ import annotations

from typing import Any, Optional

from app.models.user import UserResponse, UsersResponse, UserStatus
from app.services.go_usage import call_bridge


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _admin_payload(dbadmin: Any) -> dict[str, Any]:
    if not dbadmin:
        return {}
    return {
        "id": getattr(dbadmin, "id", None),
        "username": getattr(dbadmin, "username", "") or "",
        "role": _enum_value(getattr(dbadmin, "role", "")) or "",
    }


def _sort_payload(sort: Any) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for item in sort or []:
        name = getattr(item, "name", None) or str(item)
        name = name.strip()
        if not name:
            continue
        direction = "desc" if name.startswith("-") else "asc"
        field = name[1:] if name.startswith("-") else name
        result.append({"field": field, "direction": direction})
    return result


def get_users_list(
    *,
    offset: Optional[int],
    limit: Optional[int],
    username: Optional[list[str]],
    search: Optional[str],
    status: Optional[UserStatus],
    sort: Any,
    advanced_filters: Optional[list[str]],
    service_id: Optional[int],
    dbadmin: Any,
    owners: Optional[list[str]],
    users_limit: Optional[int],
    active_total: Optional[int],
    include_links: bool = False,
    request_origin: Optional[str] = None,
) -> UsersResponse:
    payload: dict[str, Any] = {
        "usernames": list(username or []),
        "search": search or "",
        "owners": list(owners or []),
        "status": _enum_value(status) if status else "",
        "advanced_filters": list(advanced_filters or []),
        "sort": _sort_payload(sort),
        "include_links": bool(include_links),
        "request_origin": request_origin or "",
        "admin": _admin_payload(dbadmin),
    }
    if offset is not None:
        payload["offset"] = int(offset)
    if limit is not None:
        payload["limit"] = int(limit)
    if service_id is not None:
        payload["service_id"] = int(service_id)

    data = call_bridge("users.list", payload) or {}
    if users_limit is not None:
        data["users_limit"] = users_limit
    if active_total is not None:
        data["active_total"] = active_total
    return UsersResponse.model_validate(data)


def get_user_detail(username: str, *, admin: Any, request_origin: Optional[str] = None) -> UserResponse:
    data = call_bridge(
        "user.get",
        {
            "username": username,
            "request_origin": request_origin or "",
            "admin": _admin_payload(admin),
        },
    )
    return UserResponse.model_validate(data or {})
