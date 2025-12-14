"""
User service layer.

Routers call into this module; it decides between Redis and DB,
applies business rules, and keeps caches in sync.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import List, Optional, Union


from app.db import crud, Session, GetDB
from app.db.models import User, Admin
from app.models.user import UserListItem, UserResponse, UserStatus, UsersResponse, UserCreate, UserModify
from app.redis.repositories import user_cache
from app.redis.cache import get_user_pending_usage_state
from app.runtime import logger
from app.utils.subscription_links import build_subscription_links
from app.services.cache_adapter import (
    merge_pending_usage as _merge_pending_usage_model,
    get_user_from_cache,
    upsert_user_cache,
    invalidate_user_cache as _invalidate_user_cache,
)
from app.db.crud.user import ONLINE_ACTIVE_WINDOW, OFFLINE_STALE_WINDOW, UPDATE_STALE_WINDOW, STATUS_FILTER_MAP


def _compute_subscription_links(username: str, credential_key: Optional[str]) -> tuple[str, dict]:
    """
    Compute subscription links for list items without constructing heavy models.
    Falls back to empty values on failure.
    """
    try:
        payload = SimpleNamespace(username=username, credential_key=credential_key)
        links = build_subscription_links(payload)
        primary = links.get("primary", "")
        return primary or "", links
    except Exception as exc:
        logger.debug("Failed to build subscription links for %s: %s", username, exc)
        return "", {}


def _map_raw_to_list_item(raw: dict) -> UserListItem:
    subscription_url, subscription_urls = _compute_subscription_links(
        raw.get("username", ""), raw.get("credential_key")
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
        subscription_url=subscription_url,
        subscription_urls=subscription_urls,
    )


def _map_user_to_list_item(user: User) -> UserListItem:
    subscription_url, subscription_urls = _compute_subscription_links(
        getattr(user, "username", ""), getattr(user, "credential_key", None)
    )
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
        subscription_url=subscription_url,
        subscription_urls=subscription_urls,
    )


def _apply_pending_usage_to_dict(user_dict: dict) -> None:
    try:
        uid = user_dict.get("id")
        if not uid:
            return
        pending_total, pending_online = get_user_pending_usage_state(uid)
        if pending_total:
            user_dict["used_traffic"] = (user_dict.get("used_traffic") or 0) + pending_total
            user_dict["lifetime_used_traffic"] = (user_dict.get("lifetime_used_traffic") or 0) + pending_total
        if pending_online:
            current_online = user_dict.get("online_at")
            try:
                current_dt = datetime.fromisoformat(current_online) if isinstance(current_online, str) else None
            except Exception:
                current_dt = None
            if not current_dt or pending_online > current_dt:
                user_dict["online_at"] = pending_online.isoformat()
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Failed to merge pending usage for user %s: %s", user_dict.get("username"), exc)


def _apply_pending_usage_to_model(user: User) -> None:
    try:
        _merge_pending_usage_model(user)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Failed to merge pending usage for user %s: %s", getattr(user, "username", None), exc)


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
            username = (u.get("username") or "").lower()
            note = (u.get("note") or "").lower()
            if search_lower not in username and (not note or search_lower not in note):
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
) -> UsersResponse:
    db_closed = False

    def _release_db_connection():
        nonlocal db_closed
        if not db_closed:
            try:
                db.close()
            except Exception:
                pass
            db_closed = True

    # Redis-first path - always use Redis when available
    from app.redis.client import get_redis
    from config import REDIS_ENABLED, REDIS_USERS_CACHE_ENABLED
    import time

    start_time = time.perf_counter()
    redis_client = get_redis()

    logger.debug(
        f"Redis check: REDIS_ENABLED={REDIS_ENABLED}, REDIS_USERS_CACHE_ENABLED={REDIS_USERS_CACHE_ENABLED}, redis_client={'available' if redis_client else 'None'}"
    )

    if REDIS_ENABLED and REDIS_USERS_CACHE_ENABLED and redis_client:
        try:
            cache_start = time.perf_counter()
            all_users = user_cache.get_users_raw(db=db)
            cache_time = time.perf_counter() - cache_start
            logger.debug(
                f"Redis cache retrieval took {cache_time:.3f}s, got {len(all_users) if all_users else 0} users"
            )

            if not all_users:
                # If cache is empty, try to warm it up from DB and retry
                logger.warning("User cache is empty, attempting to warm up from database...")
                try:
                    from app.redis.cache import warmup_users_cache

                    warmup_start = time.perf_counter()
                    total, cached = warmup_users_cache()
                    warmup_time = time.perf_counter() - warmup_start
                    logger.info(f"Warmup completed in {warmup_time:.3f}s: {cached}/{total} users cached")
                    all_users = user_cache.get_users_raw(db=db)
                    if not all_users:
                        raise RuntimeError("User cache still empty after warmup")
                except Exception as warmup_exc:
                    logger.error(f"Failed to warmup users cache: {warmup_exc}", exc_info=True)
                    # Fall through to DB fallback only if warmup fails
                    raise RuntimeError("User cache empty and warmup failed")

            if all_users and len(all_users) > 0:
                # We won't need the request-scoped DB connection anymore on the Redis path;
                # release it early so long-running filters don't hold a pool slot.
                _release_db_connection()
                filter_start = time.perf_counter()
                logger.debug(
                    f"Filtering {len(all_users)} users with filters: dbadmin={dbadmin.id if dbadmin else None}, owners={owners}, status={status}, service_id={service_id}, advanced_filters={advanced_filters}"
                )
                filtered = _filter_users_raw(
                    all_users,
                    username=username,
                    search=search,
                    status=status,
                    dbadmin=dbadmin,
                    owners=owners,
                    service_id=service_id,
                    advanced_filters=advanced_filters,
                )
                logger.debug(f"After filtering: {len(filtered)} users remain")

                if len(filtered) == 0 and dbadmin:
                    admin_user_count = sum(1 for u in all_users if u.get("admin_id") == dbadmin.id)
                    if admin_user_count == 0:
                        logger.warning(
                            f"Cache returned {len(all_users)} users but none belong to admin {dbadmin.username}, "
                            "falling back to DB to verify"
                        )
                        raise RuntimeError("Cache may be corrupted - no users found for admin")

                _sort_users_raw(filtered, sort)
                total = len(filtered)
                if offset:
                    filtered = filtered[offset:]
                if limit:
                    filtered = filtered[:limit]
                if active_total is None and dbadmin:
                    active_total = len(
                        [
                            u
                            for u in all_users
                            if u.get("admin_id") == dbadmin.id and u.get("status") == UserStatus.active.value
                        ]
                    )
                items = [_map_raw_to_list_item(u) for u in filtered]
                filter_time = time.perf_counter() - filter_start
                total_time = time.perf_counter() - start_time
                logger.info(
                    f"Users list from Redis completed in {total_time:.3f}s (cache: {cache_time:.3f}s, filter: {filter_time:.3f}s)"
                )
                return UsersResponse(
                    users=items,
                    link_templates={},
                    total=total,
                    active_total=active_total,
                    users_limit=users_limit,
                )
            elif all_users is not None and len(all_users) == 0:
                # Cache exists but is empty - this could mean no users in DB or cache issue
                logger.warning("Cache returned empty list, falling back to DB to verify")
                raise RuntimeError("Cache returned empty list")
        except Exception as exc:
            logger.error(f"Users list Redis path failed: {exc}", exc_info=True)
            # Only fallback to DB if Redis is not available or cache is truly broken
            if not redis_client:
                logger.warning("Redis not available, falling back to database")
            else:
                # Redis is available but cache failed - this is unexpected, log it
                logger.error("Redis available but cache retrieval failed, falling back to database")
    else:
        logger.warning(
            f"Redis not enabled or not available: REDIS_ENABLED={REDIS_ENABLED}, REDIS_USERS_CACHE_ENABLED={REDIS_USERS_CACHE_ENABLED}, redis_client={'available' if redis_client else 'None'}"
        )

    # DB fallback path (only when Redis is disabled or unavailable)
    _release_db_connection()
    with GetDB() as db_fallback:
        dbadmin_in_use = dbadmin
        if dbadmin and getattr(dbadmin, "id", None) is not None:
            try:
                dbadmin_in_use = db_fallback.query(Admin).get(dbadmin.id)
            except Exception:
                dbadmin_in_use = dbadmin

        users, count = crud.get_users(
            db=db_fallback,
            offset=offset,
            limit=limit,
            search=search,
            usernames=username,
            status=status,
            sort=sort,
            advanced_filters=advanced_filters,
            service_id=service_id,
            admin=dbadmin_in_use,
            admins=owners,
            return_with_count=True,
        )
        for user in users:
            _apply_pending_usage_to_model(user)
        items = [_map_user_to_list_item(u) for u in users]
        if active_total is None and dbadmin_in_use:
            active_total = crud.get_users_count(db_fallback, status=UserStatus.active, admin=dbadmin_in_use)
        return UsersResponse(
            users=items,
            link_templates={},
            total=count,
            active_total=active_total,
            users_limit=users_limit,
        )


def get_user_detail(username: str, db: Session) -> Optional[UserResponse]:
    cached = get_user_from_cache(username=username, db=db)
    if cached:
        try:
            return UserResponse.model_validate(cached)
        except Exception:
            pass
    dbuser = crud.get_user(db, username=username)
    if not dbuser:
        return None
    try:
        upsert_user_cache(dbuser)
    except Exception:
        pass
    _apply_pending_usage_to_model(dbuser)
    return UserResponse.model_validate(dbuser)


def create_user(db: Session, payload: UserCreate, admin=None, service=None) -> UserResponse:
    dbuser = crud.create_user(db, payload, admin=admin, service=service)
    try:
        upsert_user_cache(dbuser)
    except Exception:
        pass
    return UserResponse.model_validate(dbuser)


def update_user(db: Session, dbuser: User, payload: UserModify) -> UserResponse:
    updated = crud.update_user(db, dbuser, payload)
    try:
        upsert_user_cache(updated)
    except Exception:
        pass
    return UserResponse.model_validate(updated)


def delete_user(db: Session, dbuser: User):
    crud.remove_user(db, dbuser)
    try:
        _invalidate_user_cache(username=dbuser.username, user_id=dbuser.id)
    except Exception:
        pass
    return dbuser
