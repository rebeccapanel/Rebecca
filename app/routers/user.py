from datetime import datetime, timedelta, timezone
from typing import List, Optional, Union
import time
import re

from anyio import from_thread
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError

from app.db import Session, crud, get_db
from app.db.exceptions import UsersLimitReachedError
from app.dependencies import get_validated_user, validate_dates
from app.models.admin import Admin, AdminRole, UserPermission, admin_can_view_user_traffic
from app.models.user import (
    AdvancedUserAction,
    BulkUsersActionRequest,
    UserCreate,
    UserCreateResponse,
    UserModify,
    UserServiceCreate,
    UserResponse,
    UsersResponse,
    UserStatus,
    UserListItem,
    UsersUsagesResponse,
    UserUsagesResponse,
)
from app.utils import report, responses
from app.utils.credentials import ensure_user_credential_key
from app.utils.request_context import get_request_origin, use_subscription_request_origin
from app.utils.subscription_links import build_subscription_links
from app import runtime
from app.runtime import logger
from app.services import metrics_service

# region Helpers

xray = runtime.xray

router = APIRouter(tags=["User"], prefix="/api", responses={401: responses._401})

_AUTO_SERVICE_INBOUND_RE = re.compile(r"^setservice-(\d+)$", re.IGNORECASE)


def _ensure_service_visibility(service, admin: Admin):
    # Enforce service ownership/visibility for non-sudo admins.
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return
    if admin.id is None or admin.id not in service.admin_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")


def _detect_auto_service_from_inbounds(payload_dict: dict) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """
    Detect the special auto-service inbound tag: setservice-<service_id>.

    Auto-service mode is activated only when there is exactly one inbound tag
    across all protocols in the *raw* payload (before model validation).
    """
    if payload_dict.get("service_id") is not None:
        return None, None, None

    inbounds_payload = payload_dict.get("inbounds")
    if not isinstance(inbounds_payload, dict) or not inbounds_payload:
        return None, None, None

    tags: List[str] = []
    for value in inbounds_payload.values():
        if isinstance(value, list):
            tags.extend([tag for tag in value if isinstance(tag, str)])
        elif isinstance(value, str):
            tags.append(value)

    normalized_tags = {tag.strip() for tag in tags if isinstance(tag, str) and tag.strip()}
    if not normalized_tags:
        return None, None, None

    auto_tags = [tag for tag in normalized_tags if _AUTO_SERVICE_INBOUND_RE.match(tag)]
    if not auto_tags:
        return None, None, None

    if len(auto_tags) > 1:
        return None, None, "Only one service inbound can be selected at a time."

    if len(normalized_tags) != 1:
        return (
            None,
            auto_tags[0],
            "Service inbound must be selected alone without any additional inbounds.",
        )

    inbound_tag = auto_tags[0]
    match = _AUTO_SERVICE_INBOUND_RE.match(inbound_tag)
    if not match:
        return None, inbound_tag, None

    try:
        service_id = int(match.group(1))
    except ValueError:
        return None, inbound_tag, f'Invalid service inbound tag "{inbound_tag}".'

    if service_id <= 0:
        return None, inbound_tag, f'Invalid service inbound tag "{inbound_tag}".'

    return service_id, inbound_tag, None


def _ensure_flow_permission(admin: Admin, has_flow: bool) -> None:
    # Restrict flow settings to privileged admins.
    if not has_flow:
        return
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return
    if getattr(admin.permissions, "users", None) and getattr(admin.permissions.users, "set_flow", False):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You're not allowed to set user flow.",
    )


def _ensure_custom_key_permission(admin: Admin, has_key: bool) -> None:
    # Restrict custom credential keys to privileged admins.
    if not has_key:
        return
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return
    if getattr(admin.permissions, "users", None) and getattr(admin.permissions.users, "allow_custom_key", False):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You're not allowed to set a custom credential key.",
    )


def _ensure_user_management_available(admin: Admin, action: str) -> None:
    if admin.user_management_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "User management is locked because the created traffic limit has been reached. "
                f"You can't {action}."
            ),
        )


def _can_view_user_traffic(admin: Admin) -> bool:
    return admin.role == AdminRole.full_access or admin_can_view_user_traffic(admin)


def _is_disable_enable_only_update(modified_user: UserModify) -> bool:
    changed_fields = set(modified_user.model_fields_set)
    if changed_fields != {"status"}:
        return False
    status_value = getattr(modified_user.status, "value", modified_user.status)
    return status_value in {"active", "disabled"}


def _owner_uses_created_reset_policy(dbuser) -> bool:
    owner = getattr(dbuser, "admin", None)
    if owner is None:
        return False
    mode = getattr(owner, "traffic_limit_mode", None)
    role = getattr(owner, "role", None)
    mode_value = getattr(mode, "value", mode) or "used_traffic"
    return role != AdminRole.full_access and mode_value == "created_traffic"


def _ensure_reset_usage_allowed(admin: Admin, dbuser) -> None:
    if not _can_view_user_traffic(admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewing user traffic is disabled.")

    if not _owner_uses_created_reset_policy(dbuser):
        return

    limit = int(getattr(dbuser, "data_limit", 0) or 0)
    used = int(getattr(dbuser, "used_traffic", 0) or 0)
    status_value = getattr(getattr(dbuser, "status", None), "value", getattr(dbuser, "status", None))
    if limit <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usage reset is only available for users with a finite data limit in created-traffic mode.",
        )
    if status_value == UserStatus.limited.value:
        return
    if used >= int(limit * 0.9):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Usage reset is only available after the user reaches at least 90% of their traffic limit.",
    )


def _sanitize_user_response(admin: Admin, user: UserResponse) -> UserResponse:
    if _can_view_user_traffic(admin):
        return user
    user.used_traffic = 0
    user.lifetime_used_traffic = 0
    return user


def _sanitize_users_response(admin: Admin, response: UsersResponse) -> UsersResponse:
    if _can_view_user_traffic(admin):
        return response
    sanitized_items = []
    for item in response.users:
        sanitized_items.append(
            UserListItem(
                **{
                    **item.model_dump(),
                    "used_traffic": 0,
                    "lifetime_used_traffic": 0,
                }
            )
        )
    response.users = sanitized_items
    response.usage_total = None
    return response


def _create_user_response(request: Request, dbuser) -> UserCreateResponse:
    with use_subscription_request_origin(request):
        user = UserCreateResponse.model_validate(dbuser)
        return _refresh_subscription_links(user, request)


def _user_response(request: Request, dbuser) -> UserResponse:
    with use_subscription_request_origin(request):
        user = UserResponse.model_validate(dbuser)
        return _refresh_subscription_links(user, request)


def _refresh_subscription_links(user, request: Request):
    links = build_subscription_links(user, request_origin=get_request_origin(request))
    if not links:
        return user
    user.subscription_urls = {key: value for key, value in links.items() if key != "primary"}
    user.subscription_url = links.get("primary") or next(iter(user.subscription_urls.values()), "")
    if getattr(user, "credential_key", None):
        user.key_subscription_url = user.subscription_urls.get("key")
    return user


# endregion

# region User CRUD


@router.post(
    "/user",
    response_model=UserCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses={400: responses._400, 409: responses._409},
)
@router.post(
    "/v2/users",
    response_model=UserCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses={400: responses._400, 409: responses._409},
)
def add_user(
    payload: dict,
    request: Request,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.require_active),
):
    """
    Add a new user (service mode if service_id provided, otherwise no-service legacy mode).

    Compatible with Marzban API: accepts UserCreate directly when no service_id is provided.
    """

    admin.ensure_user_permission(UserPermission.create)
    _ensure_user_management_available(admin, "create users")

    # Convert UserCreate to dict if needed, or use dict directly
    if isinstance(payload, UserCreate):
        payload_dict = payload.model_dump(exclude_none=True)
    else:
        payload_dict = payload

    # Normalize service_id=0 to None to allow "no service" creation
    if payload_dict.get("service_id") == 0:
        payload_dict["service_id"] = None

    # FastAPI may mutate the incoming dict while attempting UserCreate parsing
    # (even when it later falls back to `dict`). Read the raw JSON payload to
    # detect the auto-service tag reliably.
    raw_payload_dict: Optional[dict] = None
    try:
        raw_payload_dict = from_thread.run(request.json)
    except Exception:
        raw_payload_dict = None

    detect_payload = raw_payload_dict if isinstance(raw_payload_dict, dict) else payload_dict

    # Auto-service mode: detect setservice-<service_id> inbound tag when it is
    # the only inbound provided in the raw payload.
    auto_service_id, auto_service_tag, auto_service_error = _detect_auto_service_from_inbounds(detect_payload)
    if auto_service_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=auto_service_error)
    if auto_service_id is not None:
        payload_dict["service_id"] = auto_service_id
        logger.info(
            'Auto-selected service_id=%s from inbound tag "%s" for user "%s"',
            auto_service_id,
            auto_service_tag,
            payload_dict.get("username"),
        )

    # Service mode ----------------------------------------------------------
    if payload_dict.get("service_id") is not None:
        try:
            service_payload = UserServiceCreate.model_validate(payload_dict)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        _ensure_flow_permission(admin, bool(service_payload.flow))
        _ensure_custom_key_permission(admin, bool(service_payload.credential_key))

        service = crud.get_service(db, service_payload.service_id)
        if not service:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

        _ensure_service_visibility(service, admin)

        db_admin = crud.get_admin(db, admin.username)
        if not db_admin:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

        from app.services.data_access import get_service_allowed_inbounds_cached

        allowed_inbounds = get_service_allowed_inbounds_cached(db, service)
        if not allowed_inbounds or not any(allowed_inbounds.values()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Service does not have any active hosts",
            )

        proxies_payload = {proxy_type.value: {} for proxy_type in allowed_inbounds.keys()}
        inbounds_payload = {proxy_type.value: sorted(list(tags)) for proxy_type, tags in allowed_inbounds.items()}

        user_payload = service_payload.model_dump(exclude={"service_id"}, exclude_none=True)
        user_payload["proxies"] = proxies_payload
        user_payload["inbounds"] = inbounds_payload

        try:
            new_user = UserCreate.model_validate(user_payload)
            if new_user.data_limit is not None:
                max_limit = admin.permissions.users.max_data_limit_per_user
                if max_limit is not None:
                    if new_user.data_limit == 0 and not admin.permissions.users.allows(
                        UserPermission.allow_unlimited_data
                    ):
                        max_gb = max_limit / (1024**3)
                        raise HTTPException(
                            status_code=400, detail=f"Unlimited data is not allowed. Maximum allowed: {max_gb:.2f} GB"
                        )
                    if new_user.data_limit > 0 and new_user.data_limit > max_limit:
                        original_gb = new_user.data_limit / (1024**3)
                        max_gb = max_limit / (1024**3)
                        raise HTTPException(
                            status_code=400,
                            detail=f"Data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB. Maximum allowed: {max_gb:.2f} GB",
                        )
            if new_user.next_plan and new_user.next_plan.data_limit is not None:
                max_limit = admin.permissions.users.max_data_limit_per_user
                if max_limit is not None:
                    if new_user.next_plan.data_limit == 0 and not admin.permissions.users.allows(
                        UserPermission.allow_unlimited_data
                    ):
                        max_gb = max_limit / (1024**3)
                        raise HTTPException(
                            status_code=400,
                            detail=f"Unlimited data is not allowed for next plan. Maximum allowed: {max_gb:.2f} GB",
                        )
                    if new_user.next_plan.data_limit > 0 and new_user.next_plan.data_limit > max_limit:
                        original_gb = new_user.next_plan.data_limit / (1024**3)
                        max_gb = max_limit / (1024**3)
                        raise HTTPException(
                            status_code=400,
                            detail=f"Next plan data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB. Maximum allowed: {max_gb:.2f} GB",
                        )

            admin.ensure_user_constraints(
                status_value=new_user.status.value if new_user.status else None,
                data_limit=new_user.data_limit,
                expire=new_user.expire,
                next_plan=new_user.next_plan.model_dump() if new_user.next_plan else None,
            )
            _ensure_custom_key_permission(admin, bool(new_user.credential_key))
            ensure_user_credential_key(new_user)
            dbuser = crud.create_user(
                db,
                new_user,
                admin=db_admin,
                service=service,
            )
        except UsersLimitReachedError as exc:
            report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="User already exists")

        bg.add_task(xray.operations.add_user, dbuser=dbuser)
        user = _create_user_response(request, dbuser)
        report.user_created(user=user, user_id=dbuser.id, by=admin, user_admin=dbuser.admin)
        if user.next_plans or user.next_plan:
            total_rules = len(user.next_plans) if getattr(user, "next_plans", None) else 1
            bg.add_task(
                report.user_auto_renew_set,
                user=user,
                user_admin=dbuser.admin,
                by=admin,
                total_rules=total_rules,
            )
        logger.info(f'New user "{dbuser.username}" added via service {service.name}')
        return _sanitize_user_response(admin, user)

    # No-service mode (Marzban-compatible) ----------------------------------
    try:
        if not payload_dict.get("proxies"):
            raise HTTPException(
                status_code=400,
                detail="Each user needs at least one proxy when creating without a service",
            )

        # Accept UserCreate directly for Marzban compatibility
        if isinstance(payload, UserCreate):
            new_user = payload
        else:
            new_user = UserCreate.model_validate(payload_dict)

        if new_user.data_limit is not None:
            max_limit = admin.permissions.users.max_data_limit_per_user
            if max_limit is not None:
                if new_user.data_limit == 0 and not admin.permissions.users.allows(UserPermission.allow_unlimited_data):
                    max_gb = max_limit / (1024**3)
                    raise HTTPException(
                        status_code=400, detail=f"Unlimited data is not allowed. Maximum allowed: {max_gb:.2f} GB"
                    )
                if new_user.data_limit > 0 and new_user.data_limit > max_limit:
                    original_gb = new_user.data_limit / (1024**3)
                    max_gb = max_limit / (1024**3)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB. Maximum allowed: {max_gb:.2f} GB",
                    )
        if new_user.next_plan and new_user.next_plan.data_limit is not None:
            max_limit = admin.permissions.users.max_data_limit_per_user
            if max_limit is not None:
                if new_user.next_plan.data_limit == 0 and not admin.permissions.users.allows(
                    UserPermission.allow_unlimited_data
                ):
                    max_gb = max_limit / (1024**3)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unlimited data is not allowed for next plan. Maximum allowed: {max_gb:.2f} GB",
                    )
                if new_user.next_plan.data_limit > 0 and new_user.next_plan.data_limit > max_limit:
                    original_gb = new_user.next_plan.data_limit / (1024**3)
                    max_gb = max_limit / (1024**3)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Next plan data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB",
                    )

        admin.ensure_user_constraints(
            status_value=new_user.status.value if new_user.status else None,
            data_limit=new_user.data_limit,
            expire=new_user.expire,
            next_plan=new_user.next_plan.model_dump() if new_user.next_plan else None,
        )
        _ensure_flow_permission(admin, bool(new_user.flow))
        _ensure_custom_key_permission(admin, bool(new_user.credential_key))

        # In no-service mode, don't validate if protocol is enabled
        # Just let it use all available inbounds for the specified protocols
        # The validate_inbounds method in UserCreate will automatically set all inbounds
        # for each protocol if not specified

        ensure_user_credential_key(new_user)
        dbuser = crud.create_user(db, new_user, admin=crud.get_admin(db, admin.username))
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User already exists")

    bg.add_task(xray.operations.add_user, dbuser=dbuser)
    user = _create_user_response(request, dbuser)
    report.user_created(user=user, user_id=dbuser.id, by=admin, user_admin=dbuser.admin)
    logger.info(f'New user "{dbuser.username}" added')
    return _sanitize_user_response(admin, user)


# endregion

# region User lifecycle (get/update/delete/reset/revoke)


@router.get("/user/{username}", response_model=UserResponse, responses={403: responses._403, 404: responses._404})
def get_user(
    request: Request,
    dbuser: UserResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.get_current),
):
    """Get user information"""
    return _sanitize_user_response(admin, _user_response(request, dbuser))


@router.put(
    "/user/{username}",
    response_model=UserResponse,
    responses={400: responses._400, 403: responses._403, 404: responses._404},
)
@router.put(
    "/v2/users/{username}",
    response_model=UserResponse,
    responses={400: responses._400, 403: responses._403, 404: responses._404},
)
def modify_user(
    modified_user: UserModify,
    request: Request,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    dbuser: UsersResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.require_active),
):
    """
    Modify an existing user

    - **username**: Cannot be changed. Used to identify the user.
    - **status**: User's new status. Can be 'active', 'disabled', 'on_hold', 'limited', or 'expired'.
    - **expire**: UTC timestamp for new account expiration. Set to `0` for unlimited, `null` for no change.
    - **data_limit**: New max data usage in bytes (e.g., `1073741824` for 1GB). Set to `0` for unlimited, `null` for no change.
    - **data_limit_reset_strategy**: New strategy for data limit reset. Options include 'daily', 'weekly', 'monthly', or 'no_reset'.
    - **proxies**: Dictionary of new protocol settings (e.g., `vmess`, `vless`). Empty dictionary means no change.
    - **inbounds**: Dictionary of new protocol tags to specify inbound connections. Empty dictionary means no change.
    - **note**: New optional text for additional user information or notes. `null` means no change.
    - **on_hold_timeout**: New UTC timestamp for when `on_hold` status should start or end. Only applicable if status is changed to 'on_hold'.
    - **on_hold_expire_duration**: New duration (in seconds) for how long the user should stay in `on_hold` status. Only applicable if status is changed to 'on_hold'.
    - **next_plan**: Next user plan (resets after use).

    Note: Fields set to `null` or omitted will not be modified.
    """

    if admin.user_management_locked and not _is_disable_enable_only_update(modified_user):
        _ensure_user_management_available(admin, "modify users")

    if "data_limit" in modified_user.model_fields_set and modified_user.data_limit is not None:
        max_limit = admin.permissions.users.max_data_limit_per_user
        if max_limit is not None:
            if modified_user.data_limit == 0 and not admin.permissions.users.allows(
                UserPermission.allow_unlimited_data
            ):
                max_gb = max_limit / (1024**3)
                raise HTTPException(
                    status_code=400, detail=f"Unlimited data is not allowed. Maximum allowed: {max_gb:.2f} GB"
                )
            if modified_user.data_limit > 0 and modified_user.data_limit > max_limit:
                original_gb = modified_user.data_limit / (1024**3)
                max_gb = max_limit / (1024**3)
                raise HTTPException(
                    status_code=400,
                    detail=f"Data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB. Maximum allowed: {max_gb:.2f} GB",
                )
    if modified_user.next_plan and modified_user.next_plan.data_limit is not None:
        max_limit = admin.permissions.users.max_data_limit_per_user
        if max_limit is not None:
            if modified_user.next_plan.data_limit == 0 and not admin.permissions.users.allows(
                UserPermission.allow_unlimited_data
            ):
                max_gb = max_limit / (1024**3)
                raise HTTPException(
                    status_code=400,
                    detail=f"Unlimited data is not allowed for next plan. Maximum allowed: {max_gb:.2f} GB",
                )
            if modified_user.next_plan.data_limit > 0 and modified_user.next_plan.data_limit > max_limit:
                original_gb = modified_user.next_plan.data_limit / (1024**3)
                max_gb = max_limit / (1024**3)
                raise HTTPException(
                    status_code=400,
                    detail=f"Next plan data limit {original_gb:.2f} GB exceeds maximum {max_gb:.2f} GB. Maximum allowed: {max_gb:.2f} GB",
                )

    admin.ensure_user_constraints(
        status_value=modified_user.status.value if modified_user.status else None,
        data_limit=modified_user.data_limit,
        expire=modified_user.expire,
        next_plan=modified_user.next_plan.model_dump() if modified_user.next_plan else None,
    )

    explicit_service_selected = "service_id" in modified_user.model_fields_set and modified_user.service_id is not None
    if explicit_service_selected and modified_user.inbounds:
        # Service mode ignores inbound selections.
        modified_user = modified_user.model_copy(update={"inbounds": {}})

    detect_payload = {
        "service_id": modified_user.service_id if explicit_service_selected else None,
        "inbounds": modified_user.inbounds if "inbounds" in modified_user.model_fields_set else {},
    }
    auto_service_id, auto_service_tag, auto_service_error = _detect_auto_service_from_inbounds(detect_payload)
    if auto_service_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=auto_service_error)

    auto_service_applied = False
    if auto_service_id is not None and not explicit_service_selected:
        modified_user = modified_user.model_copy(
            update={
                "service_id": auto_service_id,
                "inbounds": {},
            }
        )
        auto_service_applied = True
        logger.info(
            'Auto-selected service_id=%s from inbound tag "%s" for user "%s" on modify',
            auto_service_id,
            auto_service_tag,
            dbuser.username,
        )

    if modified_user.service_id is not None:
        from app.services.data_access import get_inbounds_by_tag_cached

        inbound_map = get_inbounds_by_tag_cached(db)
        for proxy_type in modified_user.proxies:
            proxy_type_value = proxy_type.value if hasattr(proxy_type, "value") else str(proxy_type)
            if not any(inbound.get("protocol") == proxy_type_value for inbound in inbound_map.values()):
                raise HTTPException(
                    status_code=400,
                    detail=f"Protocol {proxy_type} is disabled on your server",
                )

    if (
        "service_id" in modified_user.model_fields_set
        and modified_user.service_id is None
        and admin.role not in (AdminRole.sudo, AdminRole.full_access)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only sudo admins can set service to null.",
        )

    service_set = ("service_id" in modified_user.model_fields_set) or auto_service_applied
    target_service = None
    db_admin = None
    if service_set and modified_user.service_id is not None:
        target_service = crud.get_service(db, modified_user.service_id)
        if not target_service:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

        _ensure_service_visibility(target_service, admin)

        from app.services.data_access import get_service_allowed_inbounds_cached

        allowed_inbounds = get_service_allowed_inbounds_cached(db, target_service)
        if not allowed_inbounds or not any(allowed_inbounds.values()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Service does not have any active hosts",
            )

        db_admin = crud.get_admin(db, admin.username)
        if not db_admin:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

    old_status = dbuser.status

    try:
        dbuser = crud.update_user(
            db,
            dbuser,
            modified_user,
            service=target_service,
            service_set=service_set,
            admin=db_admin,
        )
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    user = _user_response(request, dbuser)

    if user.status in [UserStatus.active, UserStatus.on_hold]:
        bg.add_task(xray.operations.update_user, dbuser=dbuser)
    elif old_status in [UserStatus.active, UserStatus.on_hold] and user.status not in [
        UserStatus.active,
        UserStatus.on_hold,
    ]:
        bg.add_task(xray.operations.remove_user, dbuser=dbuser)
    elif old_status not in [UserStatus.active, UserStatus.on_hold] and user.status in [
        UserStatus.active,
        UserStatus.on_hold,
    ]:
        bg.add_task(xray.operations.add_user, dbuser=dbuser)

    bg.add_task(report.user_updated, user=user, user_admin=dbuser.admin, by=admin)
    if user.next_plans or user.next_plan:
        total_rules = len(user.next_plans) if getattr(user, "next_plans", None) else 1
        bg.add_task(
            report.user_auto_renew_set,
            user=user,
            user_admin=dbuser.admin,
            by=admin,
            total_rules=total_rules,
        )

    logger.info(f'User "{user.username}" modified')

    if user.status != old_status:
        bg.add_task(
            report.status_change,
            username=user.username,
            status=user.status,
            user=user,
            user_admin=dbuser.admin,
            by=admin,
        )
        logger.info(f'User "{dbuser.username}" status changed from {old_status} to {user.status}')

    return _sanitize_user_response(admin, user)


@router.delete("/user/{username}", responses={403: responses._403, 404: responses._404})
def remove_user(
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.require_active),
):
    """Remove a user"""
    admin.ensure_user_permission(UserPermission.delete)
    _ensure_user_management_available(admin, "delete users")
    crud.remove_user(db, dbuser)
    bg.add_task(xray.operations.remove_user, dbuser=dbuser)

    bg.add_task(report.user_deleted, username=dbuser.username, user_admin=Admin.model_validate(dbuser.admin), by=admin)

    logger.info(f'User "{dbuser.username}" deleted')
    return {"detail": "User successfully deleted"}


# endregion

# region User usage & subscription management


@router.post(
    "/user/{username}/reset", response_model=UserResponse, responses={403: responses._403, 404: responses._404}
)
def reset_user_data_usage(
    request: Request,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.require_active),
):
    """Reset user data usage"""
    admin.ensure_user_permission(UserPermission.reset_usage)
    _ensure_user_management_available(admin, "reset user usage")
    _ensure_reset_usage_allowed(admin, dbuser)
    try:
        dbuser = crud.reset_user_data_usage(db=db, dbuser=dbuser)
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    if dbuser.status in [UserStatus.active, UserStatus.on_hold]:
        bg.add_task(xray.operations.add_user, dbuser=dbuser)

    user = _user_response(request, dbuser)
    bg.add_task(report.user_data_usage_reset, user=user, user_admin=dbuser.admin, by=admin)

    logger.info(f'User "{dbuser.username}"\'s usage was reset')
    return _sanitize_user_response(admin, user)


@router.post(
    "/user/{username}/revoke_sub", response_model=UserResponse, responses={403: responses._403, 404: responses._404}
)
def revoke_user_subscription(
    request: Request,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.require_active),
):
    """Revoke users subscription (Subscription link and proxies)"""
    admin.ensure_user_permission(UserPermission.revoke)
    _ensure_user_management_available(admin, "revoke user subscriptions")
    dbuser = crud.revoke_user_sub(db=db, dbuser=dbuser)

    if dbuser.status in [UserStatus.active, UserStatus.on_hold]:
        bg.add_task(xray.operations.update_user, dbuser=dbuser)
    user = _user_response(request, dbuser)
    bg.add_task(report.user_subscription_revoked, user=user, user_admin=dbuser.admin, by=admin)

    logger.info(f'User "{dbuser.username}" subscription revoked')

    return _sanitize_user_response(admin, user)


# endregion

# region Users listing & bulk actions


@router.get(
    "/users", response_model=UsersResponse, responses={400: responses._400, 403: responses._403, 404: responses._404}
)
def get_users(
    request: Request,
    offset: int = None,
    limit: int = None,
    username: List[str] = Query(None),
    search: Union[str, None] = None,
    owner: Union[List[str], None] = Query(None, alias="admin"),
    status: UserStatus = None,
    advanced_filters: List[str] = Query(None, alias="filter"),
    service_id: int = Query(None, alias="service_id"),
    sort: str = None,
    links: bool = Query(False, description="Include full config links for each user"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    """Get all users

    - **filter**: repeatable advanced filter keys (online, offline, finished, limit, unlimited, sub_not_updated, sub_never_updated, expired, limited, disabled, on_hold).
    - **service_id**: Filter users who belong to a specific service.
    """
    start_ts = time.perf_counter()
    logger.info(
        "GET /users called with params: offset=%s limit=%s username=%s search=%s owner=%s status=%s filters=%s service_id=%s sort=%s links=%s",
        offset,
        limit,
        username,
        search,
        owner,
        status,
        advanced_filters,
        service_id,
        sort,
        links,
    )
    if sort is not None:
        opts = sort.strip(",").split(",")
        sort = []
        for opt in opts:
            if opt in {"used_traffic", "-used_traffic"} and not _can_view_user_traffic(admin):
                raise HTTPException(status_code=403, detail="Viewing user traffic is disabled.")
            try:
                sort.append(crud.UsersSortingOptions[opt])
            except KeyError:
                raise HTTPException(status_code=400, detail=f'"{opt}" is not a valid sort option')

    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        owners = owner if owner and len(owner) > 0 else None
    else:
        owners = [admin.username]

    dbadmin = None
    users_limit = None
    active_total = None

    if admin.role not in (AdminRole.sudo, AdminRole.full_access):
        dbadmin = crud.get_admin(db, admin.username)
        if not dbadmin:
            raise HTTPException(status_code=404, detail="Admin not found")
        users_limit = dbadmin.users_limit

    from app.services import user_service

    request_origin = get_request_origin(request)
    if links:
        # Generating share links requires DB-loaded proxies/inbounds.
        with use_subscription_request_origin(request):
            response = user_service.get_users_list_db_only(
                db,
                offset=offset,
                limit=limit,
                username=username,
                search=search,
                status=status,
                sort=sort,
                advanced_filters=advanced_filters,
                service_id=service_id,
                dbadmin=dbadmin,
                owners=owners,
                users_limit=users_limit,
                active_total=active_total,
                include_links=True,
                request_origin=request_origin,
            )
    else:
        with use_subscription_request_origin(request):
            response = user_service.get_users_list(
                db,
                offset=offset,
                limit=limit,
                username=username,
                search=search,
                status=status,
                sort=sort,
                advanced_filters=advanced_filters,
                service_id=service_id,
                dbadmin=dbadmin,
                owners=owners,
                users_limit=users_limit,
                active_total=active_total,
                include_links=False,
                request_origin=request_origin,
            )
    logger.info("USERS: handler finished in %.3f s", time.perf_counter() - start_ts)
    return _sanitize_users_response(admin, response)


@router.post("/users/actions", responses={403: responses._403})
def perform_users_bulk_action(
    payload: BulkUsersActionRequest,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.require_active),
):
    """Perform advanced bulk operations across all users."""
    admin.ensure_user_permission(UserPermission.advanced_actions)
    if admin.user_management_locked and payload.action not in (
        AdvancedUserAction.activate_users,
        AdvancedUserAction.disable_users,
    ):
        _ensure_user_management_available(admin, "run this bulk action")

    affected = 0
    detail = "Advanced action applied"
    target_admin: Optional[Admin] = None
    target_service = None
    destination_service = None
    target_service_id = payload.target_service_id
    service_filter_by_null = bool(payload.service_id_is_null)

    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        if payload.admin_username:
            target_admin = crud.get_admin(db, payload.admin_username)
            if not target_admin:
                raise HTTPException(status_code=404, detail="Admin not found")
        if payload.service_id is not None:
            target_service = crud.get_service(db, payload.service_id)
            if not target_service:
                raise HTTPException(status_code=404, detail="Service not found")
        if payload.action == AdvancedUserAction.change_service and target_service_id is not None:
            destination_service = crud.get_service(db, target_service_id)
            if not destination_service:
                raise HTTPException(status_code=404, detail="Target service not found")
    else:
        if "admin_username" in payload.model_fields_set:
            if payload.admin_username is None or payload.admin_username != admin.username:
                raise HTTPException(
                    status_code=403,
                    detail="Standard admins can only target their own users",
                )
        target_admin = crud.get_admin(db, admin.username)
        if not target_admin:
            raise HTTPException(status_code=404, detail="Admin not found")
        if payload.service_id is not None:
            target_service = crud.get_service(db, payload.service_id)
            if not target_service:
                raise HTTPException(status_code=404, detail="Service not found")
            if target_admin.id not in target_service.admin_ids:
                raise HTTPException(status_code=403, detail="Service not assigned to admin")
        if payload.action == AdvancedUserAction.change_service:
            if target_service_id is None:
                raise HTTPException(
                    status_code=403,
                    detail="Standard admins must select a target service",
                )
            destination_service = crud.get_service(db, target_service_id)
            if not destination_service:
                raise HTTPException(status_code=404, detail="Target service not found")
            if target_admin.id not in destination_service.admin_ids:
                raise HTTPException(status_code=403, detail="Target service not assigned to admin")

    try:
        if payload.action == AdvancedUserAction.extend_expire:
            affected = crud.adjust_all_users_expire(
                db,
                payload.days * 86400,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
                status_scope=payload.scope,
            )
            detail = "Expiration dates extended"
        elif payload.action == AdvancedUserAction.reduce_expire:
            affected = crud.adjust_all_users_expire(
                db,
                -payload.days * 86400,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
                status_scope=payload.scope,
            )
            detail = "Expiration dates shortened"
        elif payload.action == AdvancedUserAction.increase_traffic:
            delta = max(1, int(round(payload.gigabytes * 1073741824)))
            affected = crud.adjust_all_users_limit(
                db,
                delta,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
                status_scope=payload.scope,
            )
            detail = "Data limits increased for users"
        elif payload.action == AdvancedUserAction.decrease_traffic:
            delta = max(1, int(round(payload.gigabytes * 1073741824)))
            affected = crud.adjust_all_users_limit(
                db,
                -delta,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
                status_scope=payload.scope,
            )
            detail = "Data limits decreased for users"
        elif payload.action == AdvancedUserAction.cleanup_status:
            affected = crud.delete_users_by_status_age(
                db,
                payload.statuses,
                payload.days,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
            )
            detail = "Users removed by status age"
        elif payload.action == AdvancedUserAction.activate_users:
            affected = crud.bulk_update_user_status(
                db,
                UserStatus.active,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
            )
            detail = "Users activated"
        elif payload.action == AdvancedUserAction.disable_users:
            affected = crud.bulk_update_user_status(
                db,
                UserStatus.disabled,
                admin=target_admin,
                service_id=payload.service_id,
                service_without_assignment=service_filter_by_null,
            )
            detail = "Users disabled"
        elif payload.action == AdvancedUserAction.change_service:
            if target_service_id is None:
                affected = crud.clear_users_service(
                    db,
                    admin=target_admin,
                    service_id=payload.service_id,
                    service_without_assignment=service_filter_by_null,
                )
                detail = "Users removed from service"
            else:
                if not destination_service:
                    raise HTTPException(status_code=400, detail="Target service not provided")
                user_count = crud.count_users(
                    db,
                    admin=target_admin,
                    service_id=payload.service_id,
                    service_without_assignment=service_filter_by_null,
                )
                use_fast_path = payload.service_id is None or user_count > 1000
                if use_fast_path:
                    affected = crud.move_users_to_service_fast(
                        db,
                        destination_service,
                        admin=target_admin,
                        service_id=payload.service_id,
                        service_without_assignment=service_filter_by_null,
                    )
                else:
                    affected = crud.move_users_to_service(
                        db,
                        destination_service,
                        admin=target_admin,
                        service_id=payload.service_id,
                        service_without_assignment=service_filter_by_null,
                    )
                if destination_service.id is not None:
                    crud.refresh_service_users_by_id(db, destination_service.id)
                detail = "Users moved to target service"
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    return {"detail": detail, "count": affected}


@router.get(
    "/user/{username}/usage", response_model=UserUsagesResponse, responses={403: responses._403, 404: responses._404}
)
def get_user_usage(
    dbuser: UserResponse = Depends(get_validated_user),
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    """Get users usage"""
    if not _can_view_user_traffic(admin):
        raise HTTPException(status_code=403, detail="Viewing user traffic is disabled.")
    start, end = validate_dates(start, end)

    usages = metrics_service.get_user_usage(db, dbuser, start, end)

    return {"usages": usages, "username": dbuser.username}


@router.post(
    "/user/{username}/active-next", response_model=UserResponse, responses={403: responses._403, 404: responses._404}
)
def active_next_plan(
    request: Request,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_user),
    admin: Admin = Depends(Admin.require_active),
):
    """Reset user by next plan"""
    admin.ensure_user_permission(UserPermission.allow_next_plan)
    _ensure_user_management_available(admin, "activate the next plan")
    had_next_plan = getattr(dbuser, "next_plan", None) is not None
    try:
        dbuser = crud.reset_user_by_next(db=db, dbuser=dbuser)
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(admin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

    if dbuser is None or not had_next_plan:
        raise HTTPException(
            status_code=404,
            detail="User doesn't have next plan",
        )

    if dbuser.status in [UserStatus.active, UserStatus.on_hold]:
        bg.add_task(xray.operations.add_user, dbuser=dbuser)

    user = _user_response(request, dbuser)
    bg.add_task(
        report.user_data_reset_by_next,
        user=user,
        user_admin=dbuser.admin,
    )

    logger.info(f'User "{dbuser.username}"\'s usage was reset by next plan')
    return _sanitize_user_response(admin, user)


@router.get("/users/usage", response_model=UsersUsagesResponse)
def get_users_usage(
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    owner: Union[List[str], None] = Query(None, alias="admin"),
    admin: Admin = Depends(Admin.get_current),
):
    """Get all users usage"""
    if not _can_view_user_traffic(admin):
        raise HTTPException(status_code=403, detail="Viewing user traffic is disabled.")
    start, end = validate_dates(start, end)

    admins_filter = owner if admin.role in (AdminRole.sudo, AdminRole.full_access) else [admin.username]
    usages = metrics_service.get_users_usage(
        db=db,
        admins=admins_filter,
        start=start,
        end=end,
    )

    return {"usages": usages}


# endregion


@router.put("/user/{username}/set-owner", response_model=UserResponse)
def set_owner(
    admin_username: str,
    request: Request,
    dbuser: UserResponse = Depends(get_validated_user),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Set a new owner (admin) for a user."""
    new_admin = crud.get_admin(db, username=admin_username)
    if not new_admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    dbuser = crud.set_owner(db, dbuser, new_admin)
    user = _user_response(request, dbuser)

    logger.info(f'{user.username}"owner successfully set to{admin.username}')

    return user


# endregion

# region Admin cleanup utilities


@router.delete("/users/expired", response_model=List[str])
def delete_expired_users(
    bg: BackgroundTasks,
    expired_after: Optional[datetime] = Query(None, examples=["2024-01-01T00:00:00"]),
    expired_before: Optional[datetime] = Query(None, examples=["2024-01-31T23:59:59"]),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    """
    Delete users who have expired within the specified date range.

    - **expired_after** UTC datetime (optional)
    - **expired_before** UTC datetime (optional)
    - At least one of expired_after or expired_before must be provided
    """
    expired_after, expired_before = validate_dates(expired_after, expired_before)

    from app.dependencies import get_expired_users_list

    expired_users = get_expired_users_list(db, admin, expired_after, expired_before)
    removed_users = [u.username for u in expired_users]

    if not removed_users:
        raise HTTPException(status_code=404, detail="No expired users found in the specified date range")

    admin.ensure_user_permission(UserPermission.delete)
    _ensure_user_management_available(admin, "delete users")
    crud.remove_users(db, expired_users)

    for removed_user in removed_users:
        logger.info(f'User "{removed_user}" deleted')
        bg.add_task(
            report.user_deleted,
            username=removed_user,
            user_admin=next((u.admin for u in expired_users if u.username == removed_user), None),
            by=admin,
        )

    return removed_users
