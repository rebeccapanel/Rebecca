"""
User service layer.

Routers call into this module to apply user business rules and build API responses.
"""

import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Dict, List, Optional, Union


from app.db import crud, Session
from app.db.models import User, Admin
from app.models.user import UserListItem, UserResponse, UserStatus, UsersResponse, UserCreate, UserModify
from app.models.proxy import ProxyTypes
from app.runtime import logger
from app.utils.subscription_links import build_subscription_links
from app.subscription.share import generate_v2ray_links
from app.utils.credentials import UUID_PROTOCOLS, uuid_to_key
from app.services.data_access import get_inbounds_by_tag_cached, get_service_host_map_cached
from app.db.models import ServiceHostLink
from app.db.crud.user import ONLINE_ACTIVE_WINDOW, OFFLINE_STALE_WINDOW, UPDATE_STALE_WINDOW, STATUS_FILTER_MAP


def _log_users_step(step: str, started_at: float) -> None:
    elapsed = time.perf_counter() - started_at
    if elapsed >= 0.5:
        logger.info("USERS: %s finished in %.3f s", step, elapsed)


def _compute_subscription_links(
    username: str,
    credential_key: Optional[str],
    *,
    admin=None,
    admin_id: Optional[int] = None,
    request_origin: Optional[str] = None,
) -> tuple[str, dict]:
    """
    Compute subscription links for list items without constructing heavy models.
    Falls back to empty values on failure.
    """
    try:
        payload = SimpleNamespace(username=username, credential_key=credential_key, admin=admin, admin_id=admin_id)
        links = build_subscription_links(payload, request_origin=request_origin)
        primary = links.get("primary", "")
        return primary or "", links
    except Exception as exc:
        logger.debug("Failed to build subscription links for %s: %s", username, exc)
        return "", {}


def _build_user_links(user: User, link_context: Optional[dict] = None) -> List[str]:
    try:
        proxies: dict = {}
        for proxy in getattr(user, "proxies", []) or []:
            proxy_type = getattr(proxy, "type", None)
            if not proxy_type:
                continue
            try:
                resolved_type = proxy_type if isinstance(proxy_type, ProxyTypes) else ProxyTypes(str(proxy_type))
            except Exception:
                continue
            settings = getattr(proxy, "settings", {}) or {}
            if isinstance(settings, str):
                try:
                    settings = json.loads(settings)
                except Exception:
                    settings = {}
            proxies[resolved_type] = settings

        if not proxies:
            return []

        inbounds = getattr(user, "inbounds", {}) or {}
        extra_data = {
            "username": getattr(user, "username", ""),
            "status": getattr(user, "status", None),
            "expire": getattr(user, "expire", None),
            "data_limit": getattr(user, "data_limit", None),
            "used_traffic": getattr(user, "used_traffic", 0) or 0,
            "on_hold_expire_duration": getattr(user, "on_hold_expire_duration", None),
            "service_id": getattr(user, "service_id", None),
            "service_host_orders": {},
            "credential_key": getattr(user, "credential_key", None),
            "flow": getattr(user, "flow", None),
        }
        service_id = getattr(user, "service_id", None)
        if link_context and link_context.get("service_host_orders"):
            extra_data["service_host_orders"] = link_context["service_host_orders"].get(service_id, {}) or {}
        else:
            extra_data["service_host_orders"] = getattr(user, "service_host_orders", {}) or {}

        inbounds_by_tag = link_context.get("inbounds_by_tag") if link_context else None
        host_map = None
        if link_context and link_context.get("host_map_by_service") is not None:
            host_map = link_context["host_map_by_service"].get(service_id)
        force_refresh = link_context.get("force_refresh", True) if link_context else True

        return (
            generate_v2ray_links(
                proxies,
                inbounds,
                extra_data,
                False,
                inbounds_by_tag=inbounds_by_tag,
                host_map=host_map,
                force_refresh=force_refresh,
            )
            or []
        )
    except Exception as exc:
        logger.debug("Failed to generate config links for %s: %s", getattr(user, "username", "<unknown>"), exc)
        return []


def _map_raw_to_list_item(
    raw: dict,
    include_links: bool = False,
    admin_lookup: Optional[Dict[int, Admin]] = None,
    request_origin: Optional[str] = None,
) -> UserListItem:
    admin_obj = None
    if admin_lookup:
        admin_obj = admin_lookup.get(raw.get("admin_id"))
    subscription_url, subscription_urls = _compute_subscription_links(
        raw.get("username", ""),
        raw.get("credential_key"),
        admin=admin_obj,
        admin_id=raw.get("admin_id"),
        request_origin=request_origin,
    )
    return UserListItem(
        username=raw.get("username"),
        status=raw.get("status"),
        used_traffic=raw.get("used_traffic") or 0,
        lifetime_used_traffic=raw.get("lifetime_used_traffic") or 0,
        created_at=raw.get("created_at"),
        expire=raw.get("expire"),
        data_limit=raw.get("data_limit"),
        data_limit_reset_strategy=raw.get("data_limit_reset_strategy"),
        online_at=raw.get("online_at"),
        service_id=raw.get("service_id"),
        service_name=raw.get("service_name"),
        admin_id=raw.get("admin_id"),
        admin_username=raw.get("admin_username"),
        links=[],
        subscription_url=subscription_url,
        subscription_urls=subscription_urls,
    )


def _map_user_to_list_item(
    user: User,
    include_links: bool = False,
    link_context: Optional[dict] = None,
    request_origin: Optional[str] = None,
) -> UserListItem:
    subscription_url, subscription_urls = _compute_subscription_links(
        getattr(user, "username", ""),
        getattr(user, "credential_key", None),
        admin=getattr(user, "admin", None),
        request_origin=request_origin,
    )
    links: List[str] = []
    if include_links:
        links = _build_user_links(user, link_context=link_context)
    return UserListItem(
        username=user.username,
        status=user.status,
        used_traffic=getattr(user, "used_traffic", 0) or 0,
        lifetime_used_traffic=getattr(user, "lifetime_used_traffic", 0) or 0,
        created_at=user.created_at,
        expire=user.expire,
        data_limit=user.data_limit,
        data_limit_reset_strategy=getattr(user, "data_limit_reset_strategy", None),
        online_at=getattr(user, "online_at", None),
        service_id=user.service_id,
        service_name=getattr(user, "service", None).name if getattr(user, "service", None) else None,
        admin_id=user.admin_id,
        admin_username=getattr(user.admin, "username", None) if getattr(user, "admin", None) else None,
        links=links,
        subscription_url=subscription_url,
        subscription_urls=subscription_urls,
    )


def _build_admin_lookup(db: Session, users: List[dict]) -> Dict[int, Admin]:
    admin_ids = {u.get("admin_id") for u in users if u.get("admin_id")}
    if not admin_ids:
        return {}
    try:
        admins = db.query(Admin).filter(Admin.id.in_(admin_ids)).all()
    except Exception:
        return {}
    lookup: Dict[int, Admin] = {}
    for admin in admins:
        if getattr(admin, "id", None) is not None:
            lookup[int(admin.id)] = admin
    return lookup


def _build_links_context(db: Session, users: List[User]) -> dict:
    service_ids = {getattr(u, "service_id", None) for u in users}
    service_ids_for_query = {sid for sid in service_ids if sid is not None}

    inbounds_by_tag = {}
    try:
        inbounds_by_tag = get_inbounds_by_tag_cached(db, force_refresh=False)
    except Exception:
        inbounds_by_tag = {}

    host_map_by_service: Dict[Optional[int], Optional[dict]] = {}
    for sid in service_ids:
        try:
            host_map_by_service[sid] = get_service_host_map_cached(sid, force_refresh=False)
        except Exception:
            host_map_by_service[sid] = None

    service_host_orders: Dict[int, Dict[int, int]] = {}
    if service_ids_for_query:
        try:
            links = db.query(ServiceHostLink).filter(ServiceHostLink.service_id.in_(service_ids_for_query)).all()
            for link in links:
                if link.service_id is None or link.host_id is None:
                    continue
                service_host_orders.setdefault(link.service_id, {})[link.host_id] = link.sort
        except Exception:
            service_host_orders = {}

    return {
        "inbounds_by_tag": inbounds_by_tag,
        "host_map_by_service": host_map_by_service,
        "service_host_orders": service_host_orders,
        "force_refresh": False,
    }


def _apply_pending_usage_to_dict(user_dict: dict) -> None:
    del user_dict


def _apply_pending_usage_to_model(user: User) -> None:
    del user


def _filter_users_raw(
    users: List[dict],
    *,
    username: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, str]] = None,
    dbadmin=None,
    owners: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    advanced_filters: Optional[List[str]] = None,
) -> List[dict]:
    # Pre-compute filter sets for faster lookups
    owner_set = {o.lower() for o in owners} if owners else None
    username_set = {n.lower() for n in username} if username else None
    status_target = status.value if status and hasattr(status, "value") else status
    search_lower = search.lower() if search else None
    normalized_filters = {f.lower() for f in advanced_filters if f} if advanced_filters else None
    now = datetime.now(timezone.utc) if normalized_filters else None

    # Pre-compute thresholds if needed
    online_threshold = None
    offline_threshold = None
    update_threshold = None
    if normalized_filters:
        if "online" in normalized_filters:
            online_threshold = now - ONLINE_ACTIVE_WINDOW
        if "offline" in normalized_filters:
            offline_threshold = now - OFFLINE_STALE_WINDOW
        if "sub_not_updated" in normalized_filters:
            update_threshold = now - UPDATE_STALE_WINDOW

    status_candidates = None
    if normalized_filters:
        status_candidates = [STATUS_FILTER_MAP[key] for key in normalized_filters if key in STATUS_FILTER_MAP]
        if status_candidates:
            status_candidates = {s.value if hasattr(s, "value") else s for s in status_candidates}

    def _match(u: dict) -> bool:
        # Early returns for fast filters first
        if dbadmin:
            # Standard admin: only show users belonging to this admin
            if u.get("admin_id") != dbadmin.id:
                return False
        elif owner_set is not None and len(owner_set) > 0:
            # For sudo/full_access admins, filter by owner usernames if specified
            admin_username = (u.get("admin_username") or "").lower()
            if admin_username not in owner_set:
                return False

        if username_set:
            if (u.get("username") or "").lower() not in username_set:
                return False

        if status_target is not None:
            if u.get("status") != status_target:
                return False

        if service_id is not None and u.get("service_id") != service_id:
            return False

        if search_lower:
            extracted_username, extracted_key = crud._extract_subscription_identifiers(search)
            config_uuids, config_passwords = crud._extract_config_identifiers(search)
            fallback_uuids, fallback_passwords = crud._extract_config_fallback(search)
            if extracted_username and (u.get("username") or "").lower() == extracted_username.lower():
                return True
            key_candidates, uuid_candidates = crud._derive_search_tokens(search)
            uuid_candidates.update(config_uuids)
            uuid_candidates.update(fallback_uuids)
            if fallback_passwords:
                config_passwords = set(config_passwords)
                config_passwords.update(fallback_passwords)
            for candidate in list(config_uuids):
                for proxy_type in UUID_PROTOCOLS:
                    try:
                        key_candidates.add(uuid_to_key(candidate, proxy_type))
                    except Exception:
                        continue
            for candidate in list(fallback_uuids):
                for proxy_type in UUID_PROTOCOLS:
                    try:
                        key_candidates.add(uuid_to_key(candidate, proxy_type))
                    except Exception:
                        continue
            if extracted_key:
                cleaned_key = extracted_key.replace("-", "").lower()
                if cleaned_key:
                    key_candidates.add(cleaned_key)
                key_candidates.add(extracted_key.lower())

            username = (u.get("username") or "").lower()
            note = (u.get("note") or "").lower()
            subadress = (u.get("subadress") or "").lower()
            if (
                search_lower not in username
                and (not note or search_lower not in note)
                and (not subadress or search_lower not in subadress)
            ):
                # Check credential_key, uuid and other fields before failing
                credential_key = (u.get("credential_key") or "").lower()
                if credential_key and search_lower in credential_key:
                    return True
                if key_candidates:
                    normalized_key = credential_key.replace("-", "")
                    if normalized_key in key_candidates:
                        return True
                if uuid_candidates:
                    proxies = u.get("proxies") or []
                    for proxy in proxies:
                        settings = proxy.get("settings") if isinstance(proxy, dict) else None
                        proxy_id = None
                        proxy_password = None
                        if isinstance(settings, dict):
                            proxy_id = settings.get("id")
                            proxy_password = settings.get("password")
                        elif isinstance(settings, str):
                            try:
                                parsed_settings = json.loads(settings)
                                if isinstance(parsed_settings, dict):
                                    proxy_id = parsed_settings.get("id")
                                    proxy_password = parsed_settings.get("password")
                            except Exception:
                                proxy_id = None
                                proxy_password = None
                        if proxy_id and proxy_id in uuid_candidates:
                            return True
                        if proxy_password and proxy_password in config_passwords:
                            return True
                return False

        if normalized_filters:
            # Fast status checks first
            user_status = u.get("status")
            if status_candidates and user_status not in status_candidates:
                return False

            if "finished" in normalized_filters and user_status not in (
                UserStatus.limited.value if hasattr(UserStatus, "limited") else UserStatus.limited,
                UserStatus.expired.value if hasattr(UserStatus, "expired") else UserStatus.expired,
            ):
                return False

            # Fast data_limit checks
            data_limit = u.get("data_limit")
            if "limit" in normalized_filters and not (data_limit and data_limit > 0):
                return False
            if "unlimited" in normalized_filters and (data_limit and data_limit > 0):
                return False

            # Only parse datetime if needed (expensive operation)
            if online_threshold is not None or offline_threshold is not None:
                online_at = None
                online_at_raw = u.get("online_at")
                if online_at_raw:
                    try:
                        if isinstance(online_at_raw, str):
                            # Optimize: avoid replace if not needed
                            if "Z" in online_at_raw:
                                online_at_raw = online_at_raw.replace("Z", "+00:00")
                            online_at = datetime.fromisoformat(online_at_raw)
                        else:
                            online_at = online_at_raw
                    except Exception:
                        online_at = None

                if online_threshold is not None:
                    if not online_at or online_at < online_threshold:
                        return False

                if offline_threshold is not None:
                    if online_at and online_at >= offline_threshold:
                        return False

            if update_threshold is not None:
                sub_updated_at = u.get("sub_updated_at")
                if sub_updated_at:
                    try:
                        if isinstance(sub_updated_at, str):
                            if "Z" in sub_updated_at:
                                sub_updated_at = sub_updated_at.replace("Z", "+00:00")
                            sub_dt = datetime.fromisoformat(sub_updated_at)
                        else:
                            sub_dt = sub_updated_at
                        if sub_dt and sub_dt >= update_threshold:
                            return False
                    except Exception:
                        pass

            if "sub_never_updated" in normalized_filters and u.get("sub_updated_at"):
                return False

        return True

    return [u for u in users if _match(u)]


def _sort_users_raw(filtered: List[dict], sort_options) -> None:
    sort_opts = sort_options or []
    if sort_opts:
        for opt in reversed(sort_opts):
            sort_str = str(opt.value).lower()
            reverse = "desc" in sort_str
            if "username" in sort_str:
                filtered.sort(key=lambda u: (u.get("username") or "").lower(), reverse=reverse)
            elif "created_at" in sort_str:
                filtered.sort(key=lambda u: u.get("created_at") or "", reverse=reverse)
            elif "used_traffic" in sort_str:
                filtered.sort(key=lambda u: u.get("used_traffic") or 0, reverse=reverse)
            elif "data_limit" in sort_str:
                filtered.sort(key=lambda u: u.get("data_limit") or 0, reverse=reverse)
            elif "expire" in sort_str:
                filtered.sort(key=lambda u: u.get("expire") or "", reverse=reverse)


def get_users_list(
    db: Session,
    *,
    offset: Optional[int],
    limit: Optional[int],
    username: Optional[List[str]],
    search: Optional[str],
    status: Optional[UserStatus],
    sort,
    advanced_filters,
    service_id: Optional[int],
    dbadmin,
    owners: Optional[List[str]],
    users_limit: Optional[int],
    active_total: Optional[int],
    include_links: bool = False,
    request_origin: Optional[str] = None,
) -> UsersResponse:
    if include_links:
        return get_users_list_db_only(
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
            include_links=include_links,
            request_origin=request_origin,
        )

    # SQL-first path for list responses to avoid heavy Python-side filtering on large datasets.
    return get_users_list_db_only(
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


def get_users_list_db_only(
    db: Session,
    *,
    offset: Optional[int],
    limit: Optional[int],
    username: Optional[List[str]],
    search: Optional[str],
    status: Optional[UserStatus],
    sort,
    advanced_filters,
    service_id: Optional[int],
    dbadmin,
    owners: Optional[List[str]],
    users_limit: Optional[int],
    active_total: Optional[int],
    include_links: bool = False,
    request_origin: Optional[str] = None,
) -> UsersResponse:
    """Build a user list directly from database queries."""
    if include_links:
        step_started = time.perf_counter()
        users, count = crud.get_users(
            db=db,
            offset=offset,
            limit=limit,
            search=search,
            usernames=username,
            status=status,
            sort=sort,
            advanced_filters=advanced_filters,
            service_id=service_id,
            admin=dbadmin,
            admins=owners,
            return_with_count=True,
            force_db=True,
        )
        _log_users_step("list-fetch-with-links", step_started)

        step_started = time.perf_counter()
        for user in users:
            _apply_pending_usage_to_model(user)
        link_context = _build_links_context(db, users)
        items = [
            _map_user_to_list_item(
                u,
                include_links=include_links,
                link_context=link_context,
                request_origin=request_origin,
            )
            for u in users
        ]
        _log_users_step("list-map-with-links", step_started)
    else:
        step_started = time.perf_counter()
        users, count = crud.get_users_list_rows(
            db=db,
            offset=offset,
            limit=limit,
            search=search,
            usernames=username,
            status=status,
            sort=sort,
            advanced_filters=advanced_filters,
            service_id=service_id,
            admin=dbadmin,
            admins=owners,
            return_with_count=True,
        )
        _log_users_step("list-fetch-rows", step_started)

        step_started = time.perf_counter()
        for user in users:
            _apply_pending_usage_to_dict(user)
        admin_lookup = _build_admin_lookup(db, users)
        items = [
            _map_raw_to_list_item(
                u,
                include_links=False,
                admin_lookup=admin_lookup,
                request_origin=request_origin,
            )
            for u in users
        ]
        _log_users_step("list-map-rows", step_started)

    if active_total is None and dbadmin:
        step_started = time.perf_counter()
        active_total = crud.get_users_count(db, status=UserStatus.active, admin=dbadmin)
        _log_users_step("active-total", step_started)

    step_started = time.perf_counter()
    status_breakdown = crud.get_users_status_breakdown(
        db=db,
        search=search,
        status=status,
        admin=dbadmin,
        admins=owners,
        advanced_filters=advanced_filters,
        service_id=service_id,
    )
    _log_users_step("status-breakdown", step_started)
    step_started = time.perf_counter()
    usage_total = crud.get_users_usage_sum(
        db=db,
        search=search,
        status=status,
        admin=dbadmin,
        admins=owners,
        advanced_filters=advanced_filters,
        service_id=service_id,
    )
    _log_users_step("usage-total", step_started)
    step_started = time.perf_counter()
    online_total = crud.get_users_online_count(
        db=db,
        search=search,
        status=status,
        admin=dbadmin,
        admins=owners,
        advanced_filters=advanced_filters,
        service_id=service_id,
    )
    _log_users_step("online-total", step_started)

    return UsersResponse(
        users=items,
        link_templates={},
        total=count,
        active_total=active_total,
        users_limit=users_limit,
        status_breakdown=status_breakdown,
        usage_total=usage_total,
        online_total=online_total,
    )


def get_user_detail(username: str, db: Session) -> Optional[UserResponse]:
    dbuser = crud.get_user(db, username=username)
    if not dbuser:
        return None
    return UserResponse.model_validate(dbuser)


def create_user(db: Session, payload: UserCreate, admin=None, service=None) -> UserResponse:
    dbuser = crud.create_user(db, payload, admin=admin, service=service)
    return UserResponse.model_validate(dbuser)


def update_user(db: Session, dbuser: User, payload: UserModify) -> UserResponse:
    updated = crud.update_user(db, dbuser, payload)
    return UserResponse.model_validate(updated)


def delete_user(db: Session, dbuser: User):
    crud.remove_user(db, dbuser)
    return dbuser
