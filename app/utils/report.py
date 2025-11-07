from typing import Optional

from app import runtime
from app.services import TelegramSettingsService
from app.db.models import UserStatus
from app.models.admin import Admin
from app.models.node import NodeResponse, NodeStatus
from app.models.user import UserResponse
from app.utils.notification import (
    Notification,
    UserCreated,
    UserDataResetByNext,
    UserDataUsageReset,
    UserDeleted,
    UserDisabled,
    UserEnabled,
    UserExpired,
    UserLimited,
    UserSubscriptionRevoked,
    UserUpdated,
    notify,
)

_telegram_warning_cache: set[str] = set()


def _call_telegram(method_name: str, *args, **kwargs) -> bool:
    module = runtime.telegram
    if module is None:
        if method_name not in _telegram_warning_cache:
            runtime.logger.warning(
                "Telegram module is not initialized; skipping '%s'", method_name
            )
            _telegram_warning_cache.add(method_name)
        return False

    handler = getattr(module, method_name, None)
    if handler is None:
        if method_name not in _telegram_warning_cache:
            runtime.logger.warning(
                "Telegram module does not expose '%s'", method_name
            )
            _telegram_warning_cache.add(method_name)
        return False

    try:
        handler(*args, **kwargs)
        return True
    except Exception:
        runtime.logger.exception("Telegram handler '%s' failed", method_name)
        return False


def _event_enabled(event_key: str) -> bool:
    return TelegramSettingsService.is_event_enabled(event_key)


def _node_response(node) -> NodeResponse:
    if isinstance(node, NodeResponse):
        return node
    return NodeResponse.model_validate(node)


_NODE_STATUS_EVENT_MAP = {
    NodeStatus.connected: "node.status.connected",
    NodeStatus.connecting: "node.status.connecting",
    NodeStatus.error: "node.status.error",
    NodeStatus.disabled: "node.status.disabled",
    NodeStatus.limited: "node.status.limited",
}


def status_change(
        username: str, status: UserStatus, user: UserResponse, user_admin: Admin = None, by: Admin = None) -> None:
    enabled = _event_enabled("user.status_change")
    if enabled:
        _call_telegram("report_status_change", username, status, user_admin)
    if status == UserStatus.limited:
        notify(UserLimited(username=username, action=Notification.Type.user_limited, user=user))
    elif status == UserStatus.expired:
        notify(UserExpired(username=username, action=Notification.Type.user_expired, user=user))
    elif status == UserStatus.disabled:
        notify(UserDisabled(username=username, action=Notification.Type.user_disabled, user=user, by=by))
    elif status == UserStatus.active:
        notify(UserEnabled(username=username, action=Notification.Type.user_enabled, user=user, by=by))


def user_created(user: UserResponse, user_id: int, by: Admin, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.created")
    if enabled:
        _call_telegram(
            "report_new_user",
            user_id=user_id,
            username=user.username,
            by=by.username,
            expire_date=user.expire,
            data_limit=user.data_limit,
            proxies=user.proxies,
            has_next_plan=user.next_plan is not None,
            data_limit_reset_strategy=user.data_limit_reset_strategy,
            admin=user_admin,
        )
    notify(UserCreated(username=user.username, action=Notification.Type.user_created, by=by, user=user))


def user_updated(user: UserResponse, by: Admin, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.updated")
    if enabled:
        _call_telegram(
            "report_user_modification",
            username=user.username,
            expire_date=user.expire,
            data_limit=user.data_limit,
            proxies=user.proxies,
            by=by.username,
            has_next_plan=user.next_plan is not None,
            data_limit_reset_strategy=user.data_limit_reset_strategy,
            admin=user_admin,
        )
    notify(UserUpdated(username=user.username, action=Notification.Type.user_updated, by=by, user=user))


def user_deleted(username: str, by: Admin, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.deleted")
    if enabled:
        _call_telegram("report_user_deletion", username=username, by=by.username, admin=user_admin)
    notify(UserDeleted(username=username, action=Notification.Type.user_deleted, by=by))


def user_data_usage_reset(user: UserResponse, by: Admin, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.usage_reset")
    if enabled:
        _call_telegram(
            "report_user_usage_reset",
            username=user.username,
            by=by.username,
            admin=user_admin,
        )
    notify(UserDataUsageReset(username=user.username, action=Notification.Type.data_usage_reset, by=by, user=user))


def user_data_reset_by_next(user: UserResponse, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.auto_reset")
    if enabled:
        _call_telegram("report_user_data_reset_by_next", user=user, admin=user_admin)
    notify(UserDataResetByNext(username=user.username, action=Notification.Type.data_reset_by_next, user=user))


def user_subscription_revoked(user: UserResponse, by: Admin, user_admin: Admin = None) -> None:
    enabled = _event_enabled("user.subscription_revoked")
    if enabled:
        _call_telegram(
            "report_user_subscription_revoked",
            username=user.username,
            by=by.username,
            admin=user_admin,
        )
    notify(UserSubscriptionRevoked(username=user.username,
           action=Notification.Type.subscription_revoked, by=by, user=user))


def login(username: str, password: str, client_ip: str, success: bool) -> None:
    enabled = _event_enabled("login")
    if enabled:
        _call_telegram(
            "report_login",
            username=username,
            password=password,
            client_ip=client_ip,
            status="? Success" if success else "? Failed",
        )




def node_created(node, by: Admin) -> None:
    node_resp = _node_response(node)
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("node.created")
    if enabled:
        _call_telegram("report_node_created", node=node_resp, by=actor)


def node_deleted(node, by: Admin) -> None:
    node_resp = _node_response(node)
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("node.deleted")
    if enabled:
        _call_telegram("report_node_deleted", node_name=node_resp.name, by=actor)


def node_usage_reset(node, by: Admin) -> None:
    node_resp = _node_response(node)
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("node.usage_reset")
    if enabled:
        _call_telegram("report_node_usage_reset", node=node_resp, by=actor)


def node_status_change(node, previous_status: Optional[NodeStatus] = None) -> None:
    node_resp = _node_response(node)
    event_key = _NODE_STATUS_EVENT_MAP.get(node_resp.status)
    enabled = True if event_key is None else _event_enabled(event_key)
    if enabled:
        _call_telegram(
            "report_node_status_change",
            node=node_resp,
            previous_status=previous_status,
        )


def node_error(node_name: str, error: str) -> None:
    enabled = _event_enabled("errors.node")
    if enabled:
        _call_telegram("report_node_error", node_name=node_name, error=error)


def admin_created(admin: Admin, by: Admin) -> None:
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("admin.created")
    if enabled:
        _call_telegram("report_admin_created", admin=admin, by=actor)


def admin_deleted(username: str, by: Admin) -> None:
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("admin.deleted")
    if enabled:
        _call_telegram("report_admin_deleted", username=username, by=actor)


def admin_updated(admin: Admin, by: Admin, previous: Optional[Admin] = None) -> None:
    if not _event_enabled("admin.updated"):
        return

    actor = getattr(by, "username", str(by))
    current_admin = Admin.model_validate(admin)
    previous_admin = Admin.model_validate(previous) if previous else None
    _call_telegram("report_admin_updated", admin=current_admin, by=actor, previous=previous_admin)


def admin_usage_reset(admin: Admin, by: Admin) -> None:
    actor = getattr(by, "username", str(by))
    enabled = _event_enabled("admin.usage_reset")
    if enabled:
        _call_telegram("report_admin_usage_reset", admin=admin, by=actor)


def admin_data_limit_reached(admin: Admin, limit: Optional[int], current: Optional[int]) -> None:
    enabled = _event_enabled("admin.limit.data")
    if enabled:
        _call_telegram(
            "report_admin_limit_reached",
            admin=admin,
            limit_type="data",
            limit_value=limit,
            current_value=current,
        )


def admin_users_limit_reached(admin: Admin, limit: Optional[int], current: Optional[int]) -> None:
    enabled = _event_enabled("admin.limit.users")
    if enabled:
        _call_telegram(
            "report_admin_limit_reached",
            admin=admin,
            limit_type="users",
            limit_value=limit,
            current_value=current,
        )
