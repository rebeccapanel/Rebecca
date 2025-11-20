import re
import time
from datetime import datetime
from typing import Callable, Optional

from telebot.apihelper import ApiTelegramException
from telebot.formatting import escape_html

from app.runtime import logger
from app.db.models import User
from app.models.admin import Admin
from app.models.node import NodeResponse, NodeStatus
from app.models.user import UserDataLimitResetStrategy
from app.telegram import ensure_forum_topic, get_bot
from app.telegram.utils.keyboard import BotKeyboard
from app.utils.system import readable_size


CATEGORY_USERS = "users"
CATEGORY_LOGIN = "login"
CATEGORY_NODES = "nodes"
CATEGORY_ADMINS = "admins"
CATEGORY_ERRORS = "errors"

_MAX_RATE_LIMIT_DELAY = 60


def _extract_retry_after(exc: ApiTelegramException) -> Optional[int]:
    """
    Extract retry_after seconds from Telegram exception payload or description.
    """
    retry_after = None
    result_json = getattr(exc, "result_json", None)
    if isinstance(result_json, dict):
        parameters = result_json.get("parameters") or {}
        retry_after = parameters.get("retry_after") or result_json.get("retry_after")
    if retry_after is None:
        match = re.search(r"retry after (\d+)", getattr(exc, "description", ""), re.IGNORECASE)
        if match:
            retry_after = match.group(1)
    try:
        if retry_after is None:
            return None
        wait_seconds = int(retry_after)
        if wait_seconds <= 0:
            return None
        return min(wait_seconds, _MAX_RATE_LIMIT_DELAY)
    except (TypeError, ValueError):
        return None


def _send_with_retry(send_callable: Callable[[], None], *, category: str, target_desc: str) -> bool:
    """
    Attempt to send a Telegram message and retry once when hitting the rate limit.
    """
    attempts = 2
    for attempt in range(attempts):
        try:
            send_callable()
            return True
        except ApiTelegramException as exc:
            retry_delay = _extract_retry_after(exc)
            should_retry = exc.error_code == 429 and retry_delay and attempt + 1 < attempts
            if should_retry:
                logger.warning(
                    "Telegram rate limit triggered while sending '%s' notification to %s; retrying in %s seconds",
                    category,
                    target_desc,
                    retry_delay,
                )
                time.sleep(retry_delay)
                continue
            logger.error(
                "Failed to send Telegram notification to %s for category '%s': %s",
                target_desc,
                category,
                exc,
            )
            return False
        except Exception:  # pragma: no cover - defensive logging
            logger.exception(
                "Unexpected error while sending Telegram notification to %s for category '%s'",
                target_desc,
                category,
            )
            return False
    return False


def _format_expire(timestamp: Optional[int]) -> str:
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


def _format_change(current: str, previous: Optional[str]) -> str:
    if previous is None or previous == current:
        return current
    return f"{current} <i>(was {previous})</i>"


def _dispatch(
    category: str,
    text: str,
    *,
    parse_mode: str = "html",
    keyboard=None,
    chat_id: Optional[int] = None,
) -> None:
    bot_instance, settings = get_bot(with_settings=True)
    if not bot_instance or settings is None:
        logger.warning(
            "Telegram bot is not configured; skipped notification for category '%s'",
            category,
        )
        return

    delivered = False

    def _send_to(target_chat_id: int, kwargs: dict, target_desc: str) -> None:
        nonlocal delivered
        send_kwargs = dict(kwargs)

        def _call() -> None:
            bot_instance.send_message(target_chat_id, text, **send_kwargs)

        if _send_with_retry(_call, category=category, target_desc=target_desc):
            delivered = True

    if settings.logs_chat_id:
        kwargs = {"parse_mode": parse_mode}
        if settings.logs_chat_is_forum:
            thread_id = ensure_forum_topic(
                category, bot_instance=bot_instance, settings=settings
            )
            if thread_id:
                kwargs["message_thread_id"] = thread_id
        _send_to(
            settings.logs_chat_id,
            kwargs,
            f"logs chat {settings.logs_chat_id}",
        )
    else:
        for admin_id in settings.admin_chat_ids or []:
            kwargs = {"parse_mode": parse_mode}
            if keyboard:
                kwargs["reply_markup"] = keyboard
            _send_to(
                admin_id,
                kwargs,
                f"admin chat {admin_id}",
            )

    if chat_id:
        kwargs = {"parse_mode": parse_mode}
        if keyboard:
            kwargs["reply_markup"] = keyboard
        _send_to(
            chat_id,
            kwargs,
            f"user chat {chat_id}",
        )

    if not delivered:
        logger.warning(
            "Telegram notification for category '%s' had no recipients configured",
            category,
        )


def report(
    text: str,
    category: str = CATEGORY_USERS,
    chat_id: Optional[int] = None,
    parse_mode: str = "html",
    keyboard=None,
) -> None:
    _dispatch(
        category=category,
        text=text,
        parse_mode=parse_mode,
        keyboard=keyboard,
        chat_id=chat_id,
    )


def report_new_user(
    user_id: int,
    username: str,
    by: str,
    expire_date: Optional[int],
    data_limit: Optional[int],
    proxies: list,
    has_next_plan: bool,
    data_limit_reset_strategy: UserDataLimitResetStrategy,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
✅ <b>#UserCreated</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Traffic Limit:</b> <code>{data_limit}</code>
<b>Expire Date:</b> <code>{expire_date}</code>
<b>Proxies:</b> <code>{proxies}</code>
<b>Reset Strategy:</b> <code>{reset_strategy}</code>
<b>Has Next Plan:</b> <code>{has_next_plan}</code>
━━━━━━━━━━━━
<b>Belongs To:</b> <code>{owner}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        data_limit=_format_data_limit(data_limit),
        expire_date=_format_expire(expire_date),
        proxies=", ".join([escape_html(proxy) for proxy in proxies]) if proxies else "-",
        reset_strategy=escape_html(str(data_limit_reset_strategy)),
        has_next_plan="Yes" if has_next_plan else "No",
        owner=escape_html(admin.username) if admin else "-",
        by=escape_html(by),
    )

    keyboard = BotKeyboard.user_menu(
        {"username": username, "id": user_id, "status": "active"}, with_back=False
    )
    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None

    report(
        text=text,
        category=CATEGORY_USERS,
        chat_id=chat_id,
        keyboard=keyboard,
    )


def report_user_modification(
    username: str,
    expire_date: Optional[int],
    data_limit: Optional[int],
    proxies: list,
    has_next_plan: bool,
    by: str,
    data_limit_reset_strategy: UserDataLimitResetStrategy,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
✏️ <b>#UserUpdated</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Traffic Limit:</b> <code>{data_limit}</code>
<b>Expire Date:</b> <code>{expire_date}</code>
<b>Protocols:</b> <code>{proxies}</code>
<b>Reset Strategy:</b> <code>{reset_strategy}</code>
<b>Has Next Plan:</b> <code>{has_next_plan}</code>
━━━━━━━━━━━━
<b>Belongs To:</b> <code>{owner}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        data_limit=_format_data_limit(data_limit),
        expire_date=_format_expire(expire_date),
        proxies=", ".join([escape_html(proxy) for proxy in proxies]) if proxies else "-",
        reset_strategy=escape_html(str(data_limit_reset_strategy)),
        has_next_plan="Yes" if has_next_plan else "No",
        owner=escape_html(admin.username) if admin else "-",
        by=escape_html(by),
    )

    keyboard = BotKeyboard.user_menu(
        {"username": username, "status": "active"}, with_back=False
    )
    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None

    report(
        text=text,
        category=CATEGORY_USERS,
        chat_id=chat_id,
        keyboard=keyboard,
    )


def report_user_deletion(
    username: str,
    by: str,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
🗑️ <b>#UserDeleted</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
━━━━━━━━━━━━
<b>Belongs To:</b> <code>{owner}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        owner=escape_html(admin.username) if admin else "-",
        by=escape_html(by),
    )

    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None
    report(text=text, category=CATEGORY_USERS, chat_id=chat_id)


def report_status_change(
    username: str,
    status: str,
    admin: Optional[Admin] = None,
) -> None:
    labels = {
        "active": "🟢 <b>#Activated</b>",
        "disabled": "⛔ <b>#Disabled</b>",
        "limited": "📉 <b>#Limited</b>",
        "expired": "⏰ <b>#Expired</b>",
    }
    title = labels.get(status, f"ℹ️ <b>#{escape_html(status)}</b>")
    text = """\
{title}
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Belongs To:</b> <code>{owner}</code>""".format(
        title=title,
        username=escape_html(username),
        owner=escape_html(admin.username) if admin else "-",
    )

    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None
    report(text=text, category=CATEGORY_USERS, chat_id=chat_id)


def report_user_usage_reset(
    username: str,
    by: str,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
🔄 <b>#UsageReset</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
━━━━━━━━━━━━
<b>Belongs To:</b> <code>{owner}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        owner=escape_html(admin.username) if admin else "-",
        by=escape_html(by),
    )

    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None
    report(text=text, category=CATEGORY_USERS, chat_id=chat_id)


def report_user_data_reset_by_next(
    user: User,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
🤖 <b>#AutoReset</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Traffic Limit:</b> <code>{data_limit}</code>
<b>Expire Date:</b> <code>{expire_date}</code>""".format(
        username=escape_html(user.username),
        data_limit=_format_data_limit(getattr(user, "data_limit", None)),
        expire_date=_format_expire(getattr(user, "expire", None)),
    )

    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None
    report(text=text, category=CATEGORY_USERS, chat_id=chat_id)


def report_user_subscription_revoked(
    username: str,
    by: str,
    admin: Optional[Admin] = None,
) -> None:
    text = """\
🚫 <b>#SubscriptionRevoked</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
━━━━━━━━━━━━
<b>Belongs To:</b> <code>{owner}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        owner=escape_html(admin.username) if admin else "-",
        by=escape_html(by),
    )

    chat_id = admin.telegram_id if admin and getattr(admin, "telegram_id", None) else None
    report(text=text, category=CATEGORY_USERS, chat_id=chat_id)


def report_login(
    username: str,
    password: str,
    client_ip: str,
    status: str,
) -> None:
    text = """\
🔐 <b>#Login</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Password:</b> <code>{password}</code>
<b>Client IP:</b> <code>{client_ip}</code>
━━━━━━━━━━━━
<b>Status:</b> <code>{status}</code>""".format(
        username=escape_html(username),
        password=escape_html(password),
        client_ip=escape_html(client_ip),
        status=escape_html(status),
    )

    report(text=text, category=CATEGORY_LOGIN)


def report_node_created(
    node: NodeResponse,
    by: str,
) -> None:
    text = """\
🆕 <b>#NodeCreated</b>
━━━━━━━━━━━━
<b>Name:</b> <code>{name}</code>
<b>Address:</b> <code>{address}</code>
<b>API Port:</b> <code>{api_port}</code>
<b>Usage Coefficient:</b> <code>{coefficient}</code>
<b>Data Limit:</b> <code>{data_limit}</code>
━━━━━━━━━━━━
<b>By:</b> <b>#{by}</b>""".format(
        name=escape_html(node.name),
        address=escape_html(node.address),
        api_port=node.api_port,
        coefficient=node.usage_coefficient,
        data_limit=_format_data_limit(getattr(node, "data_limit", None)),
        by=escape_html(by),
    )

    report(text=text, category=CATEGORY_NODES)


def report_node_deleted(
    node_name: str,
    by: str,
) -> None:
    text = """\
🗑️ <b>#NodeDeleted</b>
━━━━━━━━━━━━
<b>Name:</b> <code>{name}</code>
<b>By:</b> <b>#{by}</b>""".format(
        name=escape_html(node_name),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_NODES)


def report_node_usage_reset(
    node: NodeResponse,
    by: str,
) -> None:
    text = """\
🔄 <b>#NodeUsageReset</b>
━━━━━━━━━━━━
<b>Name:</b> <code>{name}</code>
<b>By:</b> <b>#{by}</b>""".format(
        name=escape_html(node.name),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_NODES)


def report_node_status_change(
    node: NodeResponse,
    previous_status: Optional[NodeStatus] = None,
) -> None:
    status_labels = {
        NodeStatus.connected: "🟢 Connected",
        NodeStatus.connecting: "🟡 Connecting",
        NodeStatus.error: "🔴 Error",
        NodeStatus.disabled: "⛔ Disabled",
        NodeStatus.limited: "📉 Limited",
    }
    current_label = status_labels.get(node.status, str(node.status))
    previous_label = status_labels.get(previous_status, str(previous_status)) if previous_status else "-"

    text = """\
📡 <b>#NodeStatus</b>
━━━━━━━━━━━━
<b>Name:</b> <code>{name}</code>
<b>Status:</b> <code>{status}</code>
<b>Previous:</b> <code>{previous}</code>
<b>Message:</b> <code>{message}</code>""".format(
        name=escape_html(node.name),
        status=escape_html(current_label),
        previous=escape_html(previous_label),
        message=escape_html(node.message or "-"),
    )

    report(text=text, category=CATEGORY_NODES)


def report_node_error(
    node_name: str,
    error: str,
) -> None:
    text = """\
❗ <b>#NodeError</b>
━━━━━━━━━━━━
<b>Name:</b> <code>{name}</code>
<b>Error:</b> <code>{error}</code>""".format(
        name=escape_html(node_name),
        error=escape_html(error),
    )
    report(text=text, category=CATEGORY_ERRORS)


def report_admin_created(
    admin: Admin,
    by: str,
) -> None:
    text = """\
🧑‍💼 <b>#AdminCreated</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>Sudo:</b> <code>{sudo}</code>
<b>Users Limit:</b> <code>{users_limit}</code>
<b>Data Limit:</b> <code>{data_limit}</code>
━━━━━━━━━━━━
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(admin.username),
        sudo="Yes" if getattr(admin, "role", None) in ("sudo", "full_access") else "No",
        users_limit=_format_users_limit(getattr(admin, "users_limit", None)),
        data_limit=_format_data_limit(getattr(admin, "data_limit", None)),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_ADMINS)


def report_admin_updated(
    admin: Admin,
    by: str,
    previous: Optional[Admin] = None,
) -> None:
    def _to_yes_no(value: Optional[bool]) -> str:
        if value is None:
            return "-"
        return "Yes" if value else "No"

    def _to_text(value: Optional[object]) -> str:
        if value in (None, "", 0):
            return "-"
        return str(value)

    def _status_value(admin_obj: Optional[Admin]) -> Optional[str]:
        if admin_obj is None:
            return None
        status = getattr(admin_obj, "status", None)
        if hasattr(status, "value"):
            return str(status.value)
        return str(status) if status is not None else None

    comparisons = [
        (
            "Sudo",
            _to_yes_no(
                getattr(admin, "role", None) in ("sudo", "full_access")
                if getattr(admin, "role", None) is not None
                else None
            ),
            _to_yes_no(
                getattr(previous, "role", None) in ("sudo", "full_access")
                if previous
                else None
            )
            if previous
            else None,
        ),
        ("Users Limit", _format_users_limit(getattr(admin, "users_limit", None)), _format_users_limit(getattr(previous, "users_limit", None)) if previous else None),
        ("Data Limit", _format_data_limit(getattr(admin, "data_limit", None)), _format_data_limit(getattr(previous, "data_limit", None)) if previous else None),
        ("Telegram ID", _to_text(getattr(admin, "telegram_id", None)), _to_text(getattr(previous, "telegram_id", None)) if previous else None),
        ("Status", _to_text(_status_value(admin)), _to_text(_status_value(previous)) if previous else None),
    ]

    changes = []
    for label, current_value, previous_value in comparisons:
        if previous_value is not None and current_value == previous_value:
            continue
        current_repr = f"<code>{escape_html(current_value)}</code>"
        previous_repr = f"<code>{escape_html(previous_value)}</code>" if previous_value is not None else None
        changes.append(f"<b>{label}:</b> {_format_change(current_repr, previous_repr)}")

    if not changes:
        changes.append("<i>No attribute changes detected.</i>")

    text = """\
<b>#AdminUpdated</b>
--------------------
<b>Username:</b> <code>{username}</code>
{changes}
--------------------
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(admin.username),
        changes="\n".join(changes),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_ADMINS)


def report_admin_deleted(
    username: str,
    by: str,
) -> None:
    text = """\
🗑️ <b>#AdminDeleted</b>
━━━━━━━━━━━━
<b>Username:</b> <code>{username}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(username),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_ADMINS)


def report_admin_usage_reset(
    admin: Admin,
    by: str,
) -> None:
    text = """\
♻️ <b>#AdminUsageReset</b>
━━━━━━━━━━━━
<b>Admin:</b> <code>{username}</code>
<b>By:</b> <b>#{by}</b>""".format(
        username=escape_html(admin.username),
        by=escape_html(by),
    )
    report(text=text, category=CATEGORY_ADMINS)


def report_admin_limit_reached(
    admin: Admin,
    *,
    limit_type: str,
    limit_value: Optional[int] = None,
    current_value: Optional[int] = None,
) -> None:
    if limit_type == "data":
        formatted_limit = _format_data_limit(limit_value)
        formatted_current = _format_data_limit(current_value)
        title = "📉 <b>#AdminDataLimit</b>"
    else:
        formatted_limit = _format_users_limit(limit_value if limit_value is None else int(limit_value))
        formatted_current = (
            str(current_value) if current_value is not None else formatted_limit
        )
        title = "👥 <b>#AdminUsersLimit</b>"

    text = """\
{title}
━━━━━━━━━━━━
<b>Admin:</b> <code>{username}</code>
<b>Limit:</b> <code>{limit}</code>
<b>Current:</b> <code>{current}</code>""".format(
        title=title,
        username=escape_html(admin.username),
        limit=formatted_limit,
        current=formatted_current,
    )
    report(text=text, category=CATEGORY_ADMINS)

