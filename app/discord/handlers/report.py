import requests
from datetime import datetime
from typing import Optional, Union

from app import logger
from app.db.models import User
from app.models.admin import Admin
from app.models.node import NodeResponse, NodeStatus
from app.models.user import UserDataLimitResetStrategy
from app.utils.system import readable_size
from config import DISCORD_WEBHOOK_URL
from telebot.formatting import escape_html


def send_webhooks(json_data, admin_webhook: str = None) -> None:
    if DISCORD_WEBHOOK_URL:
        send_webhook(json_data=json_data, webhook=DISCORD_WEBHOOK_URL)
    if admin_webhook:
        send_webhook(json_data=json_data, webhook=admin_webhook)


def send_webhook(json_data, webhook: str) -> None:
    result = requests.post(webhook, json=json_data)

    try:
        result.raise_for_status()
    except requests.exceptions.HTTPError as err:
        logger.error(err)
    else:
        logger.debug("Discord payload delivered successfully, code %s.", result.status_code)


def _format_timestamp(timestamp: Optional[int]) -> str:
    if not timestamp:
        return "Never"
    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def _format_data_limit(limit: Optional[int]) -> str:
    if not limit:
        return "Unlimited"
    try:
        return readable_size(limit)
    except Exception:
        return str(limit)


def _format_users_limit(limit: Optional[int]) -> str:
    if not limit or limit <= 0:
        return "Unlimited"
    return str(limit)


def report_status_change(username: str, status: str, admin: Optional[Admin] = None) -> None:
    statuses = {
        "active": ("**:white_check_mark: Activated**", int("9ae6b4", 16)),
        "disabled": ("**:x: Disabled**", int("424b59", 16)),
        "limited": ("**:warning: Limited**", int("f8a7a8", 16)),
        "expired": ("**:clock5: Expired**", int("fbd38d", 16)),
    }
    label, color = statuses.get(status, (f"**Status:** {status}", int("7289da", 16)))

    payload = {
        "content": "",
        "embeds": [
            {
                "description": f"{label}\n----------------------\n**Username:** {username}",
                "color": color,
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}"
                },
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_new_user(
    username: str,
    by: str,
    expire_date: Optional[int],
    data_limit: Optional[int],
    proxies: list,
    has_next_plan: bool,
    data_limit_reset_strategy: UserDataLimitResetStrategy,
    admin: Optional[Admin] = None,
) -> None:
    description = f"""
                **Username:** {username}
**Traffic Limit:** {_format_data_limit(data_limit)}
**Expire Date:** {_format_timestamp(expire_date)}
**Proxies:** {", ".join([escape_html(proxy) for proxy in proxies]) if proxies else "-"}
**Data Limit Reset Strategy:** {data_limit_reset_strategy}
**Has Next Plan:** {"Yes" if has_next_plan else "No"}"""

    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":new: User Created",
                "description": description,
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}\nBy: {by}"
                },
                "color": int("00ff00", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_user_modification(
    username: str,
    expire_date: Optional[int],
    data_limit: Optional[int],
    proxies: list,
    by: str,
    has_next_plan: bool,
    data_limit_reset_strategy: UserDataLimitResetStrategy,
    admin: Optional[Admin] = None,
) -> None:
    description = f"""
                **Username:** {username}
**Traffic Limit:** {_format_data_limit(data_limit)}
**Expire Date:** {_format_timestamp(expire_date)}
**Proxies:** {", ".join([escape_html(proxy) for proxy in proxies]) if proxies else "-"}
**Data Limit Reset Strategy:** {data_limit_reset_strategy}
**Has Next Plan:** {"Yes" if has_next_plan else "No"}"""

    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":pencil2: User Modified",
                "description": description,
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}\nBy: {by}"
                },
                "color": int("00ffff", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_user_deletion(username: str, by: str, admin: Optional[Admin] = None) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":wastebasket: User Deleted",
                "description": f"**Username:** {username}",
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}\nBy: {by}"
                },
                "color": int("ff0000", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_user_usage_reset(username: str, by: str, admin: Optional[Admin] = None) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":repeat: Usage Reset",
                "description": f"**Username:** {username}",
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}\nBy: {by}"
                },
                "color": int("00ffff", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_user_data_reset_by_next(user: User, admin: Optional[Admin] = None) -> None:
    description = f"""
                **Username:** {user.username}
**Traffic Limit:** {_format_data_limit(getattr(user, "data_limit", None))}
**Expire Date:** {_format_timestamp(getattr(user, "expire", None))}"""

    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":repeat: Auto Reset",
                "description": description,
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}"
                },
                "color": int("00ffff", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_user_subscription_revoked(username: str, by: str, admin: Optional[Admin] = None) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":mute: Subscription Revoked",
                "description": f"**Username:** {username}",
                "footer": {
                    "text": f"Belongs To: {admin.username if admin else '—'}\nBy: {by}"
                },
                "color": int("ff0000", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=admin.discord_webhook if admin and admin.discord_webhook else None)


def report_login(username: str, password: str, client_ip: str, status: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":inbox_tray: Login",
                "description": f"""
                **Username:** {username}
**Password:** {password}
**Client IP:** {client_ip}""",
                "footer": {"text": f"Status: {status}"},
                "color": int("7289da", 16),
            }
        ],
    }
    send_webhooks(json_data=payload, admin_webhook=None)


def report_node_created(node: NodeResponse, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":satellite: Node Created",
                "description": f"""
                **Name:** {node.name}
**Address:** {node.address}
**API Port:** {node.api_port}
**Usage Coefficient:** {node.usage_coefficient}
**Data Limit:** {_format_data_limit(getattr(node, "data_limit", None))}""",
                "footer": {"text": f"By: {by}"},
                "color": int("57f287", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_node_deleted(node_name: str, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":wastebasket: Node Deleted",
                "description": f"**Name:** {node_name}",
                "footer": {"text": f"By: {by}"},
                "color": int("ed4245", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_node_usage_reset(node: NodeResponse, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":repeat: Node Usage Reset",
                "description": f"**Name:** {node.name}",
                "footer": {"text": f"By: {by}"},
                "color": int("5865f2", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_node_status_change(
    node: NodeResponse,
    previous_status: Optional[Union[NodeStatus, str]] = None,
) -> None:
    status_labels = {
        NodeStatus.connected: ":white_check_mark: Connected",
        NodeStatus.connecting: ":arrows_counterclockwise: Connecting",
        NodeStatus.error: ":x: Error",
        NodeStatus.disabled: ":no_entry: Disabled",
        NodeStatus.limited: ":warning: Limited",
    }
    status_colors = {
        NodeStatus.connected: int("57f287", 16),
        NodeStatus.connecting: int("fee75c", 16),
        NodeStatus.error: int("ed4245", 16),
        NodeStatus.disabled: int("99aab5", 16),
        NodeStatus.limited: int("f57936", 16),
    }

    current_label = status_labels.get(node.status, f":information_source: {node.status}")
    color = status_colors.get(node.status, int("7289da", 16))

    if isinstance(previous_status, NodeStatus):
        previous_label = status_labels.get(previous_status, previous_status.value)
    elif isinstance(previous_status, str):
        previous_label = previous_status
    else:
        previous_label = "—"

    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":satellite: Node Status Update",
                "description": f"""
                **Name:** {node.name}
**Status:** {current_label}
**Previous:** {previous_label}
**Message:** {node.message or "-"}""",
                "color": color,
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_node_error(node_name: str, error: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":bangbang: Node Error",
                "description": f"""
                **Name:** {node_name}
**Error:** {error}""",
                "color": int("ed4245", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_admin_created(admin: Admin, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":busts_in_silhouette: Admin Created",
                "description": f"""
                **Username:** {admin.username}
**Sudo:** {"Yes" if getattr(admin, "is_sudo", False) else "No"}
**Users Limit:** {admin.users_limit or "Unlimited"}
**Data Limit:** {_format_data_limit(getattr(admin, "data_limit", None))}""",
                "footer": {"text": f"By: {by}"},
                "color": int("57f287", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_admin_updated(admin: Admin, by: str, previous: Optional[Admin] = None) -> None:
    def _to_yes_no(value: Optional[bool]) -> str:
        if value is None:
            return "-"
        return "Yes" if value else "No"

    def _to_text(value: Optional[object]) -> str:
        if value in (None, "", 0):
            return "-"
        return str(value)

    def _status_text(source: Optional[Admin]) -> Optional[str]:
        if source is None:
            return None
        status = getattr(source, "status", None)
        if hasattr(status, "value"):
            return str(status.value)
        return str(status) if status is not None else None

    comparisons = [
        ("Sudo", _to_yes_no(getattr(admin, "is_sudo", None)), _to_yes_no(getattr(previous, "is_sudo", None)) if previous else None),
        ("Users Limit", _format_users_limit(getattr(admin, "users_limit", None)), _format_users_limit(getattr(previous, "users_limit", None)) if previous else None),
        ("Data Limit", _format_data_limit(getattr(admin, "data_limit", None)), _format_data_limit(getattr(previous, "data_limit", None)) if previous else None),
        ("Telegram ID", _to_text(getattr(admin, "telegram_id", None)), _to_text(getattr(previous, "telegram_id", None)) if previous else None),
        ("Discord Webhook", _to_text(getattr(admin, "discord_webhook", None)), _to_text(getattr(previous, "discord_webhook", None)) if previous else None),
        ("Status", _to_text(_status_text(admin)), _to_text(_status_text(previous)) if previous else None),
    ]

    changes = []
    for label, current_value, previous_value in comparisons:
        if previous_value is not None and current_value == previous_value:
            continue
        change_text = current_value if previous_value is None else f"{current_value} (was {previous_value})"
        changes.append(f"**{label}:** {change_text}")

    if not changes:
        changes.append("_No attribute changes detected._")

    description_lines = "\n".join(changes)
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":hammer_and_wrench: Admin Updated",
                "description": f"""
                **Username:** {admin.username}
{description_lines}""",
                "footer": {"text": f"By: {by}"},
                "color": int("fee75c", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_admin_deleted(username: str, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":wastebasket: Admin Deleted",
                "description": f"**Username:** {username}",
                "footer": {"text": f"By: {by}"},
                "color": int("99aab5", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_admin_usage_reset(admin: Admin, by: str) -> None:
    payload = {
        "content": "",
        "embeds": [
            {
                "title": ":repeat: Admin Usage Reset",
                "description": f"**Username:** {admin.username}",
                "footer": {"text": f"By: {by}"},
                "color": int("5865f2", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)


def report_admin_limit_reached(
    admin: Admin,
    *,
    limit_type: str,
    limit_value: Optional[int] = None,
    current_value: Optional[int] = None,
) -> None:
    if limit_type == "data":
        title = ":warning: Admin Data Limit Reached"
        limit_display = _format_data_limit(limit_value)
        current_display = _format_data_limit(current_value)
    else:
        title = ":warning: Admin Users Limit Reached"
        limit_display = str(limit_value) if limit_value else "Unlimited"
        current_display = str(current_value) if current_value is not None else limit_display

    payload = {
        "content": "",
        "embeds": [
            {
                "title": title,
                "description": f"""
                **Username:** {admin.username}
**Limit:** {limit_display}
**Current:** {current_display}""",
                "color": int("f57936", 16),
            }
        ],
    }
    send_webhooks(json_data=payload)

