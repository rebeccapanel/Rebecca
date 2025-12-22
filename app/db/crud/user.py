"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
import json
from datetime import datetime, timedelta, timezone
from enum import Enum
import uuid
from typing import Dict, Iterable, List, Optional, Set, Tuple, Union

from sqlalchemy import and_, exists, func, or_, inspect
from sqlalchemy.exc import DataError, IntegrityError, OperationalError
from sqlalchemy.orm import Query, Session, joinedload, selectinload
from sqlalchemy.sql.functions import coalesce
from app.db.models import (
    Admin,
    NextPlan,
    NodeUserUsage,
    Proxy,
    ProxyInbound,
    ProxyTypes,
    Service,
    User,
    UserTemplate,
    UserUsageResetLogs,
)
from .proxy import get_or_create_inbound, _apply_key_to_existing_proxies
from .common import _is_record_changed_error, _ensure_user_deleted_status

# _apply_service_to_user imported inside functions to avoid circular import
from app.utils.credentials import (
    generate_key,
    serialize_proxy_settings,
    uuid_to_key,
    UUID_PROTOCOLS,
    PASSWORD_PROTOCOLS,
)
from app.models.proxy import ProxySettings
from app.models.user import (
    UserCreate,
    UserDataLimitResetStrategy,
    UserModify,
    UserStatus,
)
from app.models.user_template import UserTemplateCreate, UserTemplateModify
from config import (
    USERS_AUTODELETE_DAYS,
)

# MasterSettingsService not available in current project structure
from app.db.exceptions import UsersLimitReachedError

MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


def get_user_queryset(db: Session, eager_load: bool = True) -> Query:
    """Retrieves the base user query with optional eager loading."""
    query = db.query(User).filter(User.status != UserStatus.deleted)

    if eager_load:
        # Use selectinload for one-to-many relationships (more efficient)
        # Use joinedload for many-to-one relationships (single row per user)
        from app.db.models import Service

        options = [
            joinedload(User.admin),  # many-to-one: one admin per user
            joinedload(User.service).joinedload(
                Service.host_links
            ),  # many-to-one: one service per user, with host_links for service_host_orders
            selectinload(User.proxies).selectinload(Proxy.excluded_inbounds),
            selectinload(User.usage_logs),  # one-to-many: for lifetime_used_traffic
        ]
        if _next_plan_table_exists(db):
            options.append(joinedload(User.next_plan))  # one-to-one: one plan per user

        query = query.options(*options)

    return query


def _apply_service_filter(
    query,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
):
    if service_without_assignment:
        return query.filter(User.service_id.is_(None))
    if service_id is not None:
        return query.filter(User.service_id == service_id)
    return query


def _build_user_bulk_query(
    db: Session,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
    additional_filters: Optional[Dict] = None,
    eager_load: bool = True,
) -> Query:
    """Helper to build a user query with common filters for bulk operations."""
    query = get_user_queryset(db, eager_load=eager_load)
    if admin:
        query = query.filter(User.admin == admin)
    query = _apply_service_filter(query, service_id, service_without_assignment)
    if additional_filters:
        for key, value in additional_filters.items():
            if hasattr(User, key):
                query = query.filter(getattr(User, key) == value)
    return query


def _next_plan_table_exists(db: Session) -> bool:
    bind = db.get_bind()
    if bind is None:
        return False
    try:
        inspector = inspect(bind)
        return inspector.has_table("next_plans")
    except Exception:
        return False


def get_user(db: Session, username: Optional[str] = None, user_id: Optional[int] = None) -> Optional[User]:
    """Retrieves a user by username or user ID. Uses Redis cache if available."""
    # Try Redis cache first to reduce DB load
    try:
        from app.redis.cache import get_cached_user

        cached_user = get_cached_user(username=username, user_id=user_id, db=db)
        if cached_user:
            # Refresh from DB to get latest relationships
            query = get_user_queryset(db)
            if user_id is not None:
                db_user = query.filter(User.id == user_id).first()
            elif username:
                normalized = username.lower()
                db_user = query.filter(func.lower(User.username) == normalized).first()
            else:
                db_user = None

            if db_user:
                # Update cache with fresh data and return
                from app.redis.cache import cache_user

                cache_user(db_user)
                return db_user
            return cached_user
    except Exception as e:
        _logger.debug(f"Failed to get user from Redis cache: {e}")

    # Fallback to DB
    query = get_user_queryset(db)
    if user_id is not None:
        user = query.filter(User.id == user_id).first()
    elif username:
        normalized = username.lower()
        user = query.filter(func.lower(User.username) == normalized).first()
    else:
        user = None

    # Cache for next time
    if user:
        try:
            from app.redis.cache import cache_user

            cache_user(user)
        except Exception as e:
            _logger.debug(f"Failed to cache user in Redis: {e}")

    return user


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Wrapper for backward compatibility."""
    return get_user(db, user_id=user_id)


UsersSortingOptions = Enum(
    "UsersSortingOptions",
    {
        "username": User.username.asc(),
        "used_traffic": User.used_traffic.asc(),
        "data_limit": User.data_limit.asc(),
        "expire": User.expire.asc(),
        "created_at": User.created_at.asc(),
        "-username": User.username.desc(),
        "-used_traffic": User.used_traffic.desc(),
        "-data_limit": User.data_limit.desc(),
        "-expire": User.expire.desc(),
        "-created_at": User.created_at.desc(),
    },
)

ONLINE_ACTIVE_WINDOW = timedelta(minutes=5)
OFFLINE_STALE_WINDOW = timedelta(hours=24)
UPDATE_STALE_WINDOW = timedelta(hours=24)
_HEX_DIGITS = frozenset("0123456789abcdef")

STATUS_FILTER_MAP = {
    "expired": UserStatus.expired,
    "limited": UserStatus.limited,
    "disabled": UserStatus.disabled,
    "on_hold": UserStatus.on_hold,
}


def _derive_search_tokens(value: str) -> Tuple[Set[str], Set[str]]:
    normalized = value.strip().lower()
    if not normalized:
        return set(), set()

    key_candidates: Set[str] = set()
    uuid_candidates: Set[str] = set()
    cleaned = normalized.replace("-", "")

    if len(cleaned) == 32 and all(ch in _HEX_DIGITS for ch in cleaned):
        key_candidates.add(cleaned)
        try:
            uuid_candidates.add(str(uuid.UUID(cleaned)))
        except ValueError:
            pass
    try:
        parsed = uuid.UUID(normalized)
        uuid_candidates.add(str(parsed))
    except ValueError:
        pass

    for candidate in list(uuid_candidates):
        for proxy_type in UUID_PROTOCOLS:
            try:
                key_candidates.add(uuid_to_key(candidate, proxy_type))
            except Exception:
                continue

    return key_candidates, uuid_candidates


def _apply_advanced_user_filters(
    query: Query,
    filters: Optional[List[str]],
    now: datetime,
) -> Query:
    if not filters:
        return query
    normalized_filters = {f.lower() for f in filters if f}
    if not normalized_filters:
        return query

    if "online" in normalized_filters:
        online_threshold = now - ONLINE_ACTIVE_WINDOW
        query = query.filter(
            User.online_at.isnot(None),
            User.online_at >= online_threshold,
        )

    if "offline" in normalized_filters:
        offline_threshold = now - OFFLINE_STALE_WINDOW
        query = query.filter(
            or_(
                User.online_at.is_(None),
                User.online_at < offline_threshold,
            )
        )

    if "finished" in normalized_filters:
        query = query.filter(User.status.in_((UserStatus.limited, UserStatus.expired)))

    if "limit" in normalized_filters:
        query = query.filter(User.data_limit.isnot(None), User.data_limit > 0)

    if "unlimited" in normalized_filters:
        query = query.filter(or_(User.data_limit.is_(None), User.data_limit == 0))

    if "sub_not_updated" in normalized_filters:
        update_threshold = now - UPDATE_STALE_WINDOW
        query = query.filter(
            or_(
                User.sub_updated_at.is_(None),
                User.sub_updated_at < update_threshold,
            )
        )

    if "sub_never_updated" in normalized_filters:
        query = query.filter(User.sub_updated_at.is_(None))

    status_candidates = [STATUS_FILTER_MAP[key] for key in normalized_filters if key in STATUS_FILTER_MAP]
    if status_candidates:
        query = query.filter(User.status.in_(status_candidates))

    return query


def _filter_users_in_memory(
    users: List[User],
    usernames: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, list]] = None,
    admin: Optional[Admin] = None,
    admins: Optional[List[str]] = None,
    advanced_filters: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
    now: Optional[datetime] = None,
) -> List[User]:
    """Filter users in memory (for Redis cache)."""
    if now is None:
        now = datetime.now(timezone.utc)

    # Always exclude deleted users to keep cache results consistent with DB queries
    filtered = [u for u in users if getattr(u, "status", None) != UserStatus.deleted]

    # Filter by usernames
    if usernames:
        username_set = {u.lower() for u in usernames}
        filtered = [u for u in filtered if u.username and u.username.lower() in username_set]

    # Filter by status
    if status:
        if isinstance(status, list):
            status_set = set(status)
            filtered = [u for u in filtered if u.status in status_set]
        else:
            filtered = [u for u in filtered if u.status == status]

    # Filter by service_id
    if service_id is not None:
        filtered = [u for u in filtered if u.service_id == service_id]

    # Filter by reset_strategy
    if reset_strategy:
        if isinstance(reset_strategy, list):
            strategy_set = {s.value if hasattr(s, "value") else s for s in reset_strategy}
            filtered = [
                u for u in filtered if u.data_limit_reset_strategy and u.data_limit_reset_strategy.value in strategy_set
            ]
        else:
            strategy_value = reset_strategy.value if hasattr(reset_strategy, "value") else reset_strategy
            filtered = [
                u
                for u in filtered
                if u.data_limit_reset_strategy and u.data_limit_reset_strategy.value == strategy_value
            ]

    # Filter by admin
    if admin and hasattr(admin, "id") and admin.id is not None:
        admin_id = int(admin.id)
        filtered = [u for u in filtered if u.admin_id is not None and int(u.admin_id) == admin_id]

    # Filter by admins
    if admins:
        admin_set = {a.lower() for a in admins}
        filtered = [
            u
            for u in filtered
            if (
                (
                    getattr(u, "admin", None)
                    and getattr(u.admin, "username", None)
                    and u.admin.username.lower() in admin_set
                )
                or (getattr(u, "admin_username", None) and u.admin_username.lower() in admin_set)
            )
        ]

    # Apply advanced filters
    if advanced_filters:
        normalized_filters = {f.lower() for f in advanced_filters if f}

        if "online" in normalized_filters:
            online_threshold = now - ONLINE_ACTIVE_WINDOW
            filtered = [u for u in filtered if u.online_at and u.online_at >= online_threshold]

        if "offline" in normalized_filters:
            offline_threshold = now - OFFLINE_STALE_WINDOW
            filtered = [u for u in filtered if not u.online_at or u.online_at < offline_threshold]

        if "finished" in normalized_filters:
            filtered = [u for u in filtered if u.status in (UserStatus.limited, UserStatus.expired)]

        if "limit" in normalized_filters:
            filtered = [u for u in filtered if u.data_limit and u.data_limit > 0]

        if "unlimited" in normalized_filters:
            filtered = [u for u in filtered if not u.data_limit or u.data_limit == 0]

        if "sub_not_updated" in normalized_filters:
            update_threshold = now - UPDATE_STALE_WINDOW
            filtered = [u for u in filtered if not u.sub_updated_at or u.sub_updated_at < update_threshold]

        if "sub_never_updated" in normalized_filters:
            filtered = [u for u in filtered if not u.sub_updated_at]

        status_candidates = [STATUS_FILTER_MAP[key] for key in normalized_filters if key in STATUS_FILTER_MAP]
        if status_candidates:
            status_set = set(status_candidates)
            filtered = [u for u in filtered if u.status in status_set]

    # Search filter
    if search:
        search_lower = search.lower()
        key_candidates, uuid_candidates = _derive_search_tokens(search)
        key_candidates_set = set(key_candidates) if key_candidates else set()
        uuid_candidates_set = set(uuid_candidates) if uuid_candidates else set()

        def matches_search(u: User) -> bool:
            if u.username and search_lower in u.username.lower():
                return True
            if u.note and search_lower in u.note.lower():
                return True
            if u.credential_key:
                if search_lower in u.credential_key.lower():
                    return True
                if key_candidates_set:
                    normalized_key = u.credential_key.replace("-", "").lower()
                    if normalized_key in key_candidates_set:
                        return True
            if uuid_candidates_set and hasattr(u, "proxies") and u.proxies:
                for proxy in u.proxies:
                    # Handle both dict and string settings
                    if isinstance(proxy.settings, dict):
                        proxy_id = proxy.settings.get("id")
                    elif isinstance(proxy.settings, str):
                        try:
                            proxy_settings = json.loads(proxy.settings)
                            proxy_id = proxy_settings.get("id") if isinstance(proxy_settings, dict) else None
                        except Exception:
                            proxy_id = None
                    else:
                        proxy_id = None

                    if proxy_id and proxy_id in uuid_candidates_set:
                        return True
            return False

        filtered = [u for u in filtered if matches_search(u)]

    return filtered


def get_users(
    db: Session,
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    usernames: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, list]] = None,
    sort: Optional[List[UsersSortingOptions]] = None,
    admin: Optional[Admin] = None,
    admins: Optional[List[str]] = None,
    advanced_filters: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
    return_with_count: bool = False,
) -> Union[List[User], Tuple[List[User], int]]:
    """Retrieves users based on various filters and options. Uses Redis cache if available."""
    # Ensure deterministic ordering (especially for Redis-sourced lists) so pagination is stable
    effective_sort = sort if sort else [UsersSortingOptions["-created_at"]]

    # Try to get from Redis cache first
    try:
        from app.redis.cache import get_all_users_from_cache
        from app.redis.client import get_redis
        from config import REDIS_ENABLED, REDIS_USERS_CACHE_ENABLED

        if REDIS_ENABLED and REDIS_USERS_CACHE_ENABLED and get_redis():
            # Get all users from Redis (this is fast, just deserializes basic data)
            all_users = get_all_users_from_cache(db)
            # If aggregated list missing, ensure it's warmed for next calls
            try:
                from app.redis.cache import REDIS_KEY_USER_LIST_ALL, get_redis, USER_CACHE_TTL, _serialize_user

                redis_client = get_redis()
                if redis_client and all_users:
                    redis_client.setex(
                        REDIS_KEY_USER_LIST_ALL,
                        USER_CACHE_TTL,
                        json.dumps([_serialize_user(u) for u in all_users]),
                    )
            except Exception:
                pass

            if all_users:
                # Filter in memory (fast operation)
                filtered_users = _filter_users_in_memory(
                    all_users,
                    usernames=usernames,
                    search=search,
                    status=status,
                    admin=admin,
                    admins=admins,
                    advanced_filters=advanced_filters,
                    service_id=service_id,
                    reset_strategy=reset_strategy,
                )

                # Sort (fast operation on filtered list)
                if effective_sort:
                    for sort_opt in reversed(effective_sort):  # Apply sorts in reverse order
                        sort_str = str(sort_opt.value).lower()
                        reverse = "desc" in sort_str

                        if "username" in sort_str:
                            filtered_users.sort(key=lambda u: (u.username or "").lower(), reverse=reverse)
                        elif "created_at" in sort_str:
                            filtered_users.sort(
                                key=lambda u: u.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=reverse
                            )
                        elif "used_traffic" in sort_str:
                            filtered_users.sort(key=lambda u: getattr(u, "used_traffic", 0) or 0, reverse=reverse)
                        elif "data_limit" in sort_str:
                            filtered_users.sort(key=lambda u: u.data_limit or 0, reverse=reverse)
                        elif "expire" in sort_str:
                            filtered_users.sort(
                                key=lambda u: u.expire or datetime.max.replace(tzinfo=timezone.utc)
                                if u.expire
                                else datetime.min.replace(tzinfo=timezone.utc),
                                reverse=reverse,
                            )

                # Get count before pagination (for return_with_count)
                count = len(filtered_users) if return_with_count else None

                # Pagination BEFORE loading relationships (critical for performance)
                if offset:
                    filtered_users = filtered_users[offset:]
                if limit:
                    filtered_users = filtered_users[:limit]

                # Redis-first path: return cached users directly (avoid DB round-trips).
                final_users = filtered_users or []

                if return_with_count:
                    return final_users, count
                return final_users
    except Exception as e:
        _logger.warning(f"Failed to get users from Redis cache, falling back to DB: {e}")
        # Ensure we continue to DB fallback even if Redis fails

    # Fallback to direct DB query
    try:
        query = get_user_queryset(db, eager_load=False)
        query = _apply_advanced_user_filters(
            query,
            advanced_filters,
            datetime.now(timezone.utc),
        )

        if search:
            like_pattern = f"%{search}%"
            key_candidates, uuid_candidates = _derive_search_tokens(search)
            search_clauses = [
                User.username.ilike(like_pattern),
                User.note.ilike(like_pattern),
                User.credential_key.ilike(like_pattern),
            ]
            if key_candidates:
                search_clauses.append(User.credential_key.in_(key_candidates))
            if uuid_candidates:
                proxy_exists = exists().where(
                    and_(Proxy.user_id == User.id, Proxy.settings["id"].as_string().in_(uuid_candidates))
                )
                search_clauses.append(proxy_exists)
            query = query.filter(or_(*search_clauses))

        if usernames:
            query = query.filter(User.username.in_(usernames))

        if status:
            if isinstance(status, list):
                query = query.filter(User.status.in_(status))
            else:
                query = query.filter(User.status == status)

        if service_id is not None:
            query = query.filter(User.service_id == service_id)

        if reset_strategy:
            if isinstance(reset_strategy, list):
                query = query.filter(User.data_limit_reset_strategy.in_(reset_strategy))
            else:
                query = query.filter(User.data_limit_reset_strategy == reset_strategy)

        if admin and hasattr(admin, "id") and admin.id is not None:
            query = query.filter(User.admin_id == admin.id)

        if admins:
            query = query.filter(User.admin.has(Admin.username.in_(admins)))

        count = None
        if return_with_count:
            # Use func.count() directly for better performance
            count = query.with_entities(func.count(User.id)).scalar() or 0

        query = query.options(
            joinedload(User.admin),
            joinedload(User.service),
            selectinload(User.proxies),
        )
        if _next_plan_table_exists(db):
            query = query.options(joinedload(User.next_plan))

        if effective_sort:
            query = query.order_by(*(opt.value for opt in effective_sort))

        if offset:
            query = query.offset(offset)
        if limit:
            query = query.limit(limit)

        users = query.all()

        # Cache users in Redis for future queries
        try:
            from app.redis.cache import cache_user

            for user in users:
                cache_user(user)
        except Exception as e:
            _logger.debug(f"Failed to cache users in Redis: {e}")

        if return_with_count:
            return users, count

        return users
    except Exception as e:
        _logger.error(f"Failed to get users from database: {e}")
        # Return empty result on error to prevent crash
        if return_with_count:
            return [], 0
        return []


def get_users_count(db: Session, status: UserStatus = None, admin: Admin = None) -> int:
    """Retrieves the count of users based on status and admin filters."""
    # Use optimized count query: only select User.id for faster counting
    query = db.query(func.count(User.id))
    query = query.filter(User.status != UserStatus.deleted)

    if admin:
        query = query.filter(User.admin == admin)

    if status:
        query = query.filter(User.status == status)

    # Use scalar() for single value result (faster than count())
    return query.scalar() or 0


def _build_filtered_users_query_for_aggregation(
    db: Session,
    *,
    usernames: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, list]] = None,
    admin: Optional[Admin] = None,
    admins: Optional[List[str]] = None,
    advanced_filters: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
):
    query = get_user_queryset(db, eager_load=False)
    query = _apply_advanced_user_filters(
        query,
        advanced_filters,
        datetime.now(timezone.utc),
    )

    if search:
        like_pattern = f"%{search}%"
        key_candidates, uuid_candidates = _derive_search_tokens(search)
        search_clauses = [
            User.username.ilike(like_pattern),
            User.note.ilike(like_pattern),
            User.credential_key.ilike(like_pattern),
        ]
        if key_candidates:
            search_clauses.append(User.credential_key.in_(key_candidates))
        if uuid_candidates:
            proxy_exists = exists().where(
                and_(Proxy.user_id == User.id, Proxy.settings["id"].as_string().in_(uuid_candidates))
            )
            search_clauses.append(proxy_exists)
        query = query.filter(or_(*search_clauses))

    if usernames:
        query = query.filter(User.username.in_(usernames))

    if status:
        if isinstance(status, list):
            query = query.filter(User.status.in_(status))
        else:
            query = query.filter(User.status == status)

    if service_id is not None:
        query = query.filter(User.service_id == service_id)

    if reset_strategy:
        if isinstance(reset_strategy, list):
            query = query.filter(User.data_limit_reset_strategy.in_(reset_strategy))
        else:
            query = query.filter(User.data_limit_reset_strategy == reset_strategy)

    if admin and hasattr(admin, "id") and admin.id is not None:
        query = query.filter(User.admin_id == admin.id)

    if admins:
        query = query.filter(User.admin.has(Admin.username.in_(admins)))

    return query


def get_users_status_breakdown(
    db: Session,
    *,
    usernames: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, list]] = None,
    admin: Optional[Admin] = None,
    admins: Optional[List[str]] = None,
    advanced_filters: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
) -> Dict[str, int]:
    """
    Returns status -> count for users matching the given filters (ignores pagination).
    """
    query = _build_filtered_users_query_for_aggregation(
        db,
        usernames=usernames,
        search=search,
        status=status,
        admin=admin,
        admins=admins,
        advanced_filters=advanced_filters,
        service_id=service_id,
        reset_strategy=reset_strategy,
    )

    rows = query.with_entities(User.status, func.count(User.id)).group_by(User.status).all()

    breakdown: Dict[str, int] = {}
    for status_value, count in rows:
        status_key = _status_to_str(status_value)
        if status_key:
            breakdown[status_key] = count or 0
    return breakdown


def get_users_usage_sum(
    db: Session,
    *,
    usernames: Optional[List[str]] = None,
    search: Optional[str] = None,
    status: Optional[Union[UserStatus, list]] = None,
    admin: Optional[Admin] = None,
    admins: Optional[List[str]] = None,
    advanced_filters: Optional[List[str]] = None,
    service_id: Optional[int] = None,
    reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
) -> int:
    """
    Returns total usage (used + reset history) for filtered users.
    """
    query = _build_filtered_users_query_for_aggregation(
        db,
        usernames=usernames,
        search=search,
        status=status,
        admin=admin,
        admins=admins,
        advanced_filters=advanced_filters,
        service_id=service_id,
        reset_strategy=reset_strategy,
    )
    total_usage = query.with_entities(func.coalesce(func.sum(User.reseted_usage), 0)).scalar()
    try:
        return int(total_usage or 0)
    except Exception:
        return 0


def _status_to_str(status: Union[UserStatus, str, None]) -> Optional[str]:
    if status is None:
        return None
    if isinstance(status, Enum):
        return status.value
    return str(status)


def _is_user_limit_enforced(admin: Optional[Admin]) -> bool:
    return bool(admin and admin.users_limit is not None and admin.users_limit > 0)


def _get_active_users_count(
    db: Session,
    admin: Admin,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> int:
    if not admin:
        return 0

    query = db.query(func.count(User.id)).filter(
        User.admin_id == admin.id,
        User.status == UserStatus.active,
    )
    if exclude_user_ids:
        exclude_ids = [uid for uid in exclude_user_ids if uid is not None]
        if exclude_ids:
            query = query.filter(~User.id.in_(exclude_ids))

    return query.scalar() or 0


def _ensure_active_user_capacity(
    db: Session,
    admin: Optional[Admin],
    *,
    required_slots: int = 1,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> None:
    if not _is_user_limit_enforced(admin) or required_slots <= 0:
        return

    active_count = _get_active_users_count(
        db,
        admin,
        exclude_user_ids=exclude_user_ids,
    )
    remaining_slots = (admin.users_limit or 0) - active_count
    if remaining_slots < required_slots:
        raise UsersLimitReachedError(limit=admin.users_limit, current_active=active_count)


def create_user(db: Session, user: UserCreate, admin: Admin = None, service: Optional[Service] = None) -> User:
    """Creates a new user with provided details."""
    normalized_username = user.username.lower()
    existing_user = (
        db.query(User)
        .filter(func.lower(User.username) == normalized_username)
        .filter(User.status != UserStatus.deleted)
        .first()
    )
    if existing_user:
        raise IntegrityError(
            None,
            {"username": user.username},
            Exception("User username already exists"),
        )

    status_value = _status_to_str(user.status) or UserStatus.active.value
    resolved_status = UserStatus(status_value)
    if admin:
        _ensure_active_user_capacity(db, admin, required_slots=1)

    excluded_inbounds_tags = user.excluded_inbounds
    credential_key = user.credential_key  # Already processed by ensure_user_credential_key

    # If no credential_key, check if we need to generate one.
    # We only generate one if there are NO static credentials in the proxies.
    # If there ARE static credentials, we assume "Marzban mode" and leave key as None.
    if not credential_key:
        has_static_credentials = False
        for proxy_key, settings in user.proxies.items():
            proxy_type = ProxyTypes(proxy_key)
            if proxy_type in UUID_PROTOCOLS and getattr(settings, "id", None):
                has_static_credentials = True
                break
            if proxy_type in PASSWORD_PROTOCOLS and getattr(settings, "password", None):
                has_static_credentials = True
                break

        if not has_static_credentials:
            # No key and no static credentials -> Generate a new key
            credential_key = generate_key()
            # We should also strip any (empty/invalid) credentials just in case, though they shouldn't exist if has_static_credentials is False
            # But more importantly, we need to make sure serialize_proxy_settings knows we have a key now.

    proxies = []
    for proxy_key, settings in user.proxies.items():
        proxy_type = ProxyTypes(proxy_key)
        excluded_inbounds = [get_or_create_inbound(db, tag) for tag in excluded_inbounds_tags[proxy_type]]
        # If we just generated a key, we pass it here.
        # If we have static credentials and no key, credential_key is None.
        serialized = serialize_proxy_settings(
            settings, proxy_type, credential_key, preserve_existing_uuid=True, allow_auto_generate=bool(credential_key)
        )
        proxies.append(Proxy(type=proxy_type.value, settings=serialized, excluded_inbounds=excluded_inbounds))

    # Create a fresh User object - ensure it's not from Redis cache (which would have id set)
    dbuser = User(
        username=user.username,
        credential_key=credential_key,
        flow=user.flow,
        proxies=proxies,
        status=resolved_status,
        data_limit=(user.data_limit or None),
        expire=(user.expire or None),
        admin=admin,
        data_limit_reset_strategy=user.data_limit_reset_strategy,
        note=user.note,
        on_hold_expire_duration=(user.on_hold_expire_duration or None),
        on_hold_timeout=(user.on_hold_timeout or None),
        auto_delete_in_days=user.auto_delete_in_days,
        ip_limit=user.ip_limit,
        next_plan=NextPlan(
            data_limit=user.next_plan.data_limit,
            expire=user.next_plan.expire,
            add_remaining_traffic=user.next_plan.add_remaining_traffic,
            fire_on_either=user.next_plan.fire_on_either,
        )
        if user.next_plan
        else None,
    )

    # Ensure id is None for new user (prevent duplicate key error if object came from Redis cache)
    if hasattr(dbuser, "id") and dbuser.id is not None:
        dbuser.id = None

    if service:
        dbuser.service = service
        from app.db.crud.service import _service_allowed_inbounds
        from app.db.crud.service import _ensure_admin_service_link

        allowed = _service_allowed_inbounds(service)
        from .other import _apply_service_to_user

        _apply_service_to_user(db, dbuser, service, allowed)
        _ensure_admin_service_link(db, admin, service)
    db.add(dbuser)
    db.flush()

    db.commit()
    db.refresh(dbuser)
    # Make sure proxy relationships are loaded before returning (background tasks may run after the session closes)
    try:
        for proxy in dbuser.proxies:
            _ = list(proxy.excluded_inbounds)
    except Exception as e:  # pragma: no cover - defensive logging
        _logger.debug("Failed to pre-load proxy relationships for user %s: %s", dbuser.username, e)

    # Cache user in Redis and mark for sync
    try:
        from app.redis.cache import cache_user

        cache_user(dbuser, mark_for_sync=True)
    except Exception as e:
        _logger.warning(f"Failed to cache user in Redis: {e}")

    return dbuser


def remove_user(db: Session, dbuser: User) -> User:
    """Removes a user from the database."""
    if dbuser.status == UserStatus.deleted:
        return dbuser

    dbuser.status = UserStatus.deleted
    physically_deleted = False
    try:
        db.commit()
        # Invalidate user from Redis cache
        try:
            from app.redis.cache import invalidate_user_cache

            invalidate_user_cache(username=dbuser.username, user_id=dbuser.id)
        except Exception as e:
            _logger.warning(f"Failed to invalidate user from Redis cache: {e}")
    except DataError as exc:
        db.rollback()
        if not _ensure_user_deleted_status(db):
            db.delete(dbuser)
            db.commit()
            physically_deleted = True
        else:
            dbuser.status = UserStatus.deleted
            db.add(dbuser)
            try:
                db.commit()
            except DataError:
                db.rollback()
                raise exc
    if not physically_deleted:
        db.refresh(dbuser)
    return dbuser


def remove_users(db: Session, dbusers: List[User]):
    """Removes multiple users from the database."""
    updated = False
    for dbuser in dbusers:
        if dbuser.status != UserStatus.deleted:
            dbuser.status = UserStatus.deleted
            updated = True
    if updated:
        try:
            db.commit()
        except DataError as exc:
            db.rollback()
            if not _ensure_user_deleted_status(db):
                for dbuser in dbusers:
                    db.delete(dbuser)
                db.commit()
            else:
                for dbuser in dbusers:
                    dbuser.status = UserStatus.deleted
                    db.add(dbuser)
                try:
                    db.commit()
                except DataError:
                    db.rollback()
                    raise exc
    return


def _delete_user_usage_rows(db: Session, user_ids: List[int]) -> None:
    if not user_ids:
        return
    db.query(NodeUserUsage).filter(NodeUserUsage.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(UserUsageResetLogs).filter(UserUsageResetLogs.user_id.in_(user_ids)).delete(synchronize_session=False)


def hard_delete_user(db: Session, dbuser: User) -> None:
    """Permanently remove a user and dependent usage records without soft-deleting."""
    if dbuser.id is not None:
        _delete_user_usage_rows(db, [dbuser.id])
    db.delete(dbuser)


def update_user(
    db: Session,
    dbuser: User,
    modify: UserModify,
    *,
    service: Optional[Service] = None,
    service_set: bool = False,
    admin: Optional[Admin] = None,
) -> User:
    """Updates a user with new details."""
    original_status_value = _status_to_str(dbuser.status)
    credential_key = dbuser.credential_key
    added_proxies: Dict[ProxyTypes, Proxy] = {}

    if modify.proxies:
        pass

        modify_proxy_types = {ProxyTypes(key) for key in modify.proxies}

        for proxy_key, settings in modify.proxies.items():
            proxy_type = ProxyTypes(proxy_key)
            dbproxy = db.query(Proxy).where(Proxy.user == dbuser, Proxy.type == proxy_type).first()
            if dbproxy:
                existing_uuid = dbproxy.settings.get("id") if isinstance(dbproxy.settings, dict) else None
                existing_password = dbproxy.settings.get("password") if isinstance(dbproxy.settings, dict) else None
                preserve_uuid = bool(existing_uuid and proxy_type in UUID_PROTOCOLS)

                if not credential_key:
                    if proxy_type in UUID_PROTOCOLS and existing_uuid and not getattr(settings, "id", None):
                        settings.id = existing_uuid
                    if (
                        proxy_type in PASSWORD_PROTOCOLS
                        and existing_password
                        and not getattr(settings, "password", None)
                    ):
                        settings.password = existing_password

                allow_auto_generate = bool(credential_key)
                dbproxy.settings = serialize_proxy_settings(
                    settings,
                    proxy_type,
                    credential_key,
                    preserve_existing_uuid=preserve_uuid,
                    allow_auto_generate=allow_auto_generate,
                )
            else:
                allow_auto_generate = bool(credential_key)
                serialized = serialize_proxy_settings(
                    settings, proxy_type, credential_key, allow_auto_generate=allow_auto_generate
                )
                new_proxy = Proxy(type=proxy_type.value, settings=serialized)
                dbuser.proxies.append(new_proxy)
                added_proxies.update({proxy_type: new_proxy})
        existing_types = {pt.value for pt in modify_proxy_types}
        for proxy in dbuser.proxies:
            if proxy.type not in modify.proxies and proxy.type not in existing_types:
                db.delete(proxy)
    if modify.inbounds:
        for proxy_type, tags in modify.excluded_inbounds.items():
            dbproxy = db.query(Proxy).where(
                Proxy.user == dbuser, Proxy.type == proxy_type
            ).first() or added_proxies.get(proxy_type)
            if dbproxy:
                dbproxy.excluded_inbounds = [get_or_create_inbound(db, tag) for tag in tags]

    if "flow" in modify.model_fields_set:
        dbuser.flow = modify.flow

    if modify.status is not None:
        dbuser.status = modify.status
    if "data_limit" in modify.model_fields_set:
        dbuser.data_limit = modify.data_limit or None
        if dbuser.status not in (UserStatus.expired, UserStatus.disabled):
            dbuser.status = (
                UserStatus.active
                if (not dbuser.data_limit or dbuser.used_traffic < dbuser.data_limit)
                and dbuser.status != UserStatus.on_hold
                else UserStatus.limited
            )
    if "expire" in modify.model_fields_set:
        dbuser.expire = modify.expire or None
        if dbuser.status in (UserStatus.active, UserStatus.expired):
            dbuser.status = (
                UserStatus.active
                if (not dbuser.expire or dbuser.expire > datetime.now(timezone.utc).timestamp())
                else UserStatus.expired
            )
    if modify.note is not None:
        dbuser.note = modify.note or None
    if modify.data_limit_reset_strategy is not None:
        dbuser.data_limit_reset_strategy = modify.data_limit_reset_strategy.value
    if "ip_limit" in modify.model_fields_set:
        dbuser.ip_limit = modify.ip_limit
    if modify.on_hold_timeout is not None:
        dbuser.on_hold_timeout = modify.on_hold_timeout
    if modify.on_hold_expire_duration is not None:
        dbuser.on_hold_expire_duration = modify.on_hold_expire_duration

    if modify.next_plan is not None:
        dbuser.next_plan = NextPlan(
            data_limit=modify.next_plan.data_limit,
            expire=modify.next_plan.expire,
            add_remaining_traffic=modify.next_plan.add_remaining_traffic,
            fire_on_either=modify.next_plan.fire_on_either,
        )
    elif dbuser.next_plan is not None:
        db.delete(dbuser.next_plan)

    if service_set:
        if service is None:
            dbuser.service = None
        else:
            from app.db.crud.service import _service_allowed_inbounds

            allowed = _service_allowed_inbounds(service)
            dbuser.service = service
            from .other import _apply_service_to_user

            _apply_service_to_user(db, dbuser, service, allowed)
            if admin:
                from app.db.crud.service import _ensure_admin_service_link

                _ensure_admin_service_link(db, admin, service)

    current_status_value = _status_to_str(dbuser.status)
    if current_status_value == UserStatus.active.value and original_status_value != UserStatus.active.value:
        _ensure_active_user_capacity(db, dbuser.admin, exclude_user_ids=(dbuser.id,))
    dbuser.edit_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(dbuser)
    # Ensure proxy relationships/excluded inbounds are loaded before returning (background tasks/Xray sync)
    try:
        for proxy in dbuser.proxies:
            _ = list(proxy.excluded_inbounds)
    except Exception as e:  # pragma: no cover - defensive logging
        _logger.debug("Failed to pre-load proxy relationships for updated user %s: %s", dbuser.username, e)

    # Update user in Redis cache and mark for sync
    try:
        from app.redis.cache import cache_user, invalidate_user_cache

        invalidate_user_cache(username=dbuser.username, user_id=dbuser.id)
        cache_user(dbuser, mark_for_sync=True)
    except Exception as e:
        _logger.warning(f"Failed to update user in Redis cache: {e}")

    return dbuser


def reset_user_by_next(db: Session, dbuser: User) -> User:
    """Resets the data usage of a user based on next user."""

    if dbuser.next_plan is None:
        return
    db.add(UserUsageResetLogs(user=dbuser, used_traffic_at_reset=dbuser.used_traffic))
    dbuser.node_usages.clear()
    if _status_to_str(dbuser.status) != UserStatus.active.value:
        _ensure_active_user_capacity(db, dbuser.admin, exclude_user_ids=(dbuser.id,))
    dbuser.status = UserStatus.active.value
    dbuser.data_limit = dbuser.next_plan.data_limit + (
        0 if dbuser.next_plan.add_remaining_traffic else dbuser.data_limit - dbuser.used_traffic
    )
    dbuser.expire = dbuser.next_plan.expire
    dbuser.used_traffic = 0
    db.delete(dbuser.next_plan)
    dbuser.next_plan = None
    db.add(dbuser)
    db.commit()
    db.refresh(dbuser)

    # Update user in Redis cache and mark for sync
    try:
        from app.redis.cache import cache_user

        cache_user(dbuser, mark_for_sync=True)
    except Exception as e:
        _logger.warning(f"Failed to update user in Redis cache: {e}")

    return dbuser


def revoke_user_sub(db: Session, dbuser: User) -> User:
    """Revokes the subscription of a user and updates proxies settings."""
    dbuser.sub_revoked_at = datetime.now(timezone.utc)

    # Check if user has UUID/password stored in proxies table (legacy method)
    has_legacy_credentials = False
    for proxy in dbuser.proxies:
        proxy_type = proxy.type
        if isinstance(proxy_type, str):
            proxy_type = ProxyTypes(proxy_type)
        settings = proxy.settings if isinstance(proxy.settings, dict) else {}

        # Check if UUID or password exists in settings
        if proxy_type in UUID_PROTOCOLS and settings.get("id"):
            has_legacy_credentials = True
            break
        elif proxy_type in PASSWORD_PROTOCOLS and settings.get("password"):
            has_legacy_credentials = True
            break

    # Generate new key (either first time or update existing)
    new_key = generate_key()
    dbuser.credential_key = new_key

    if has_legacy_credentials:
        # User has legacy credentials - remove UUID/password from proxies table
        # and migrate to key-based method
        for proxy in dbuser.proxies:
            proxy_type = proxy.type
            if isinstance(proxy_type, str):
                proxy_type = ProxyTypes(proxy_type)
            settings_obj = ProxySettings.from_dict(proxy_type, proxy.settings)

            # Remove UUID/password from settings (will be generated from key at runtime)
            if proxy_type in UUID_PROTOCOLS:
                settings_obj.id = None
            if proxy_type in PASSWORD_PROTOCOLS:
                settings_obj.password = None

            # Serialize without preserving existing UUID/password
            proxy.settings = serialize_proxy_settings(settings_obj, proxy_type, new_key, preserve_existing_uuid=False)
    else:
        # User already has key or no legacy credentials - just update key
        _apply_key_to_existing_proxies(dbuser, new_key)

    db.commit()
    db.refresh(dbuser)

    # Update user in Redis cache and mark for sync
    try:
        from app.redis.cache import cache_user

        cache_user(dbuser, mark_for_sync=True)
    except Exception as e:
        _logger.warning(f"Failed to update user in Redis cache: {e}")

    return dbuser


def update_user_sub(db: Session, dbuser: User, user_agent: str) -> User:
    """Updates the user's subscription metadata, retrying if the row changes underneath us."""

    max_attempts = 3
    attempts = 0
    # Get user ID first (works for both User and UserResponse)
    user_id = dbuser.id if hasattr(dbuser, "id") else None
    if not user_id:
        raise ValueError("User object must have an id attribute")

    while attempts < max_attempts:
        attempts += 1
        # Always fetch fresh user from DB to ensure it's in session
        dbuser = db.query(User).filter(User.id == user_id).with_for_update().first()
        if not dbuser:
            raise ValueError(f"User with id {user_id} not found")

        dbuser.sub_updated_at = datetime.now(timezone.utc)
        dbuser.sub_last_user_agent = user_agent
        try:
            db.commit()
            db.refresh(dbuser)
            return dbuser
        except OperationalError as exc:
            db.rollback()
            if not _is_record_changed_error(exc) or attempts >= max_attempts:
                raise
            # Re-fetch the user to ensure we start from the latest row state
            dbuser = db.query(User).filter(User.id == user_id).with_for_update().first()
            if not dbuser:
                raise
            continue


def _sync_user_status_from_expire(db: Session, dbuser: User, now: float) -> None:
    status_value = _status_to_str(dbuser.status)
    if status_value not in (UserStatus.active.value, UserStatus.expired.value):
        return
    if not dbuser.expire or dbuser.expire > now:
        target_status = UserStatus.active
    else:
        target_status = UserStatus.expired
    if target_status.value == status_value:
        return
    dbuser.status = target_status
    dbuser.last_status_change = datetime.now(timezone.utc)
    if target_status == UserStatus.active:
        _ensure_active_user_capacity(
            db,
            dbuser.admin,
            exclude_user_ids=(dbuser.id,),
        )


def adjust_all_users_expire(
    db: Session,
    delta_seconds: int,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    if delta_seconds == 0:
        return 0
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment).filter(
        User.status == UserStatus.active, User.expire.isnot(None)
    )
    now = datetime.now(timezone.utc).timestamp()
    count = 0
    for dbuser in query.all():
        dbuser.expire = (dbuser.expire or 0) + delta_seconds
        _sync_user_status_from_expire(db, dbuser, now)
        db.add(dbuser)
        count += 1
    if count:
        db.commit()
    return count


def _sync_user_status_from_usage(db: Session, dbuser: User) -> None:
    status_value = _status_to_str(dbuser.status)
    if status_value in (UserStatus.expired.value, UserStatus.disabled.value):
        return
    limit = dbuser.data_limit or 0
    target_status: Optional[UserStatus] = None
    if limit > 0 and dbuser.used_traffic >= limit:
        target_status = UserStatus.limited
    elif status_value == UserStatus.on_hold.value:
        return
    else:
        target_status = UserStatus.active

    if target_status and target_status.value != status_value:
        dbuser.status = target_status
        dbuser.last_status_change = datetime.now(timezone.utc)
        if target_status == UserStatus.active:
            _ensure_active_user_capacity(
                db,
                dbuser.admin,
                exclude_user_ids=(dbuser.id,),
            )


def adjust_all_users_usage(
    db: Session,
    delta_bytes: int,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
) -> int:
    if delta_bytes == 0:
        return 0
    query = _build_user_bulk_query(db, admin, service_id, False)
    count = 0
    for dbuser in query.all():
        dbuser.used_traffic = max(dbuser.used_traffic + delta_bytes, 0)
        _sync_user_status_from_usage(db, dbuser)
        db.add(dbuser)
        count += 1
    if count:
        db.commit()
    return count


def move_users_to_service(
    db: Session,
    target_service: Service,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
    use_bulk_update: bool = True,
) -> int:
    """Move users to a new service, honoring optional admin/service filters."""
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment, eager_load=False)
    query = query.filter(or_(User.service_id.is_(None), User.service_id != target_service.id))

    affected = query.update(
        {User.service_id: target_service.id},
        synchronize_session=False,
    )
    if affected:
        db.commit()
    return affected


def move_users_to_service_fast(
    db: Session,
    target_service: Service,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    """Wrapper for move_users_to_service for backward compatibility."""
    return move_users_to_service(
        db, target_service, admin, service_id, service_without_assignment, use_bulk_update=True
    )


def clear_users_service(
    db: Session,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    """Remove the service assignment for matching users."""
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment, eager_load=False)
    if not service_without_assignment:
        query = query.filter(User.service_id.isnot(None))
    affected = query.update({User.service_id: None}, synchronize_session=False)
    if affected:
        db.commit()
    return affected


def adjust_all_users_limit(
    db: Session,
    delta_bytes: int,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    """Increase or decrease data limits for users, optionally scoped by admin/service."""
    if delta_bytes == 0:
        return 0
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment).filter(
        User.status == UserStatus.active,
        User.data_limit.isnot(None),
        User.data_limit > 0,
    )
    count = 0
    for dbuser in query.all():
        new_limit = max((dbuser.data_limit or 0) + delta_bytes, 0)
        dbuser.data_limit = new_limit
        _sync_user_status_from_usage(db, dbuser)
        db.add(dbuser)
        count += 1
    if count:
        db.commit()
    return count


def delete_users_by_status_age(
    db: Session,
    statuses: List[UserStatus],
    days: int,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment).filter(
        User.status.in_(statuses), User.last_status_change.isnot(None), User.last_status_change <= cutoff
    )
    candidates = query.all()
    if not candidates:
        return 0
    remove_users(db, candidates)
    return len(candidates)


def disable_all_active_users(db: Session, admin: Optional[Admin] = None):
    """Disable all active users or users under a specific admin."""
    query = db.query(User).filter(User.status.in_((UserStatus.active, UserStatus.on_hold)))
    if admin:
        query = query.filter(User.admin == admin)
    query.update(
        {User.status: UserStatus.disabled, User.last_status_change: datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    db.commit()


def activate_all_disabled_users(db: Session, admin: Optional[Admin] = None):
    """
    Activate all disabled users or users under a specific admin.

    Args:
        db (Session): Database session.
        admin (Optional[Admin]): Admin to filter users by, if any.
    """
    disabled_users_query = db.query(User).filter(User.status == UserStatus.disabled)
    on_hold_candidates_query = db.query(User).filter(
        and_(
            User.status == UserStatus.disabled,
            User.expire.is_(None),
            User.on_hold_expire_duration.isnot(None),
            User.online_at.is_(None),
        )
    )
    if admin:
        disabled_users_query = disabled_users_query.filter(User.admin == admin)
        on_hold_candidates_query = on_hold_candidates_query.filter(User.admin == admin)

    for user in on_hold_candidates_query.all():
        user.status = UserStatus.on_hold
        user.last_status_change = datetime.now(timezone.utc)

    # Refresh query to account for users moved to on-hold status
    disabled_users_query = db.query(User).filter(User.status == UserStatus.disabled)
    if admin:
        disabled_users_query = disabled_users_query.filter(User.admin == admin)

    for user in disabled_users_query.all():
        if _status_to_str(user.status) != UserStatus.active.value:
            _ensure_active_user_capacity(
                db,
                user.admin,
                exclude_user_ids=(user.id,),
            )
        user.status = UserStatus.active
        user.last_status_change = datetime.now(timezone.utc)

    db.commit()


def bulk_update_user_status(
    db: Session,
    target_status: UserStatus,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    query = _build_user_bulk_query(db, admin, service_id, service_without_assignment)
    count = 0
    for user in query.all():
        if user.status == target_status:
            continue
        if target_status == UserStatus.active and _status_to_str(user.status) != UserStatus.active.value:
            _ensure_active_user_capacity(db, user.admin, exclude_user_ids=(user.id,))
        user.status = target_status
        user.last_status_change = datetime.now(timezone.utc)
        db.add(user)
        count += 1
    if count:
        db.commit()
    return count


def autodelete_expired_users(db: Session, include_limited_users: bool = False) -> List[User]:
    """Deletes expired (optionally also limited) users whose auto-delete time has passed."""
    target_status = [UserStatus.expired] if not include_limited_users else [UserStatus.expired, UserStatus.limited]

    auto_delete = coalesce(User.auto_delete_in_days, USERS_AUTODELETE_DAYS)

    query = (
        db.query(
            User,
            auto_delete,  # Use global auto-delete days as fallback
        )
        .filter(
            auto_delete >= 0,  # Negative values prevent auto-deletion
            User.status.in_(target_status),
        )
        .options(joinedload(User.admin))
    )

    expired_users = [
        user
        for (user, auto_delete) in query
        if user.last_status_change + timedelta(days=auto_delete) <= datetime.now(timezone.utc)
    ]

    if expired_users:
        remove_users(db, expired_users)

    return expired_users


def update_user_status(db: Session, dbuser: User, status: UserStatus) -> User:
    """Updates a user's status and records the time of change."""
    dbuser.status, dbuser.last_status_change = status, datetime.now(timezone.utc)
    db.commit()
    db.refresh(dbuser)
    return dbuser


def set_owner(db: Session, dbuser: User, admin: Admin) -> User:
    """Sets the owner (admin) of a user."""
    dbuser.admin = admin
    db.commit()
    db.refresh(dbuser)
    return dbuser


def start_user_expire(db: Session, dbuser: User) -> User:
    """Starts the expiration timer for a user."""
    dbuser.expire, dbuser.on_hold_expire_duration, dbuser.on_hold_timeout = (
        int(datetime.now(timezone.utc).timestamp()) + dbuser.on_hold_expire_duration,
        None,
        None,
    )
    db.commit()
    db.refresh(dbuser)
    return dbuser


def create_user_template(db: Session, user_template: UserTemplateCreate) -> UserTemplate:
    """Creates a new user template in the database."""
    inbound_tags: List[str] = []
    for _, i in user_template.inbounds.items():
        inbound_tags.extend(i)
    dbuser_template = UserTemplate(
        name=user_template.name,
        data_limit=user_template.data_limit,
        expire_duration=user_template.expire_duration,
        username_prefix=user_template.username_prefix,
        username_suffix=user_template.username_suffix,
        inbounds=db.query(ProxyInbound).filter(ProxyInbound.tag.in_(inbound_tags)).all(),
    )
    db.add(dbuser_template)
    db.commit()
    db.refresh(dbuser_template)
    return dbuser_template


def update_user_template(
    db: Session, dbuser_template: UserTemplate, modified_user_template: UserTemplateModify
) -> UserTemplate:
    """Updates a user template's details."""
    if modified_user_template.name is not None:
        dbuser_template.name = modified_user_template.name
    if modified_user_template.data_limit is not None:
        dbuser_template.data_limit = modified_user_template.data_limit
    if modified_user_template.expire_duration is not None:
        dbuser_template.expire_duration = modified_user_template.expire_duration
    if modified_user_template.username_prefix is not None:
        dbuser_template.username_prefix = modified_user_template.username_prefix
    if modified_user_template.username_suffix is not None:
        dbuser_template.username_suffix = modified_user_template.username_suffix

    if modified_user_template.inbounds:
        inbound_tags: List[str] = []
        for _, i in modified_user_template.inbounds.items():
            inbound_tags.extend(i)
        dbuser_template.inbounds = db.query(ProxyInbound).filter(ProxyInbound.tag.in_(inbound_tags)).all()

    db.commit()
    db.refresh(dbuser_template)
    return dbuser_template


def remove_user_template(db: Session, dbuser_template: UserTemplate):
    """Removes a user template from the database."""
    db.delete(dbuser_template)
    db.commit()


def get_user_template(db: Session, user_template_id: int) -> UserTemplate:
    """Retrieves a user template by its ID."""
    return db.query(UserTemplate).filter(UserTemplate.id == user_template_id).first()


def get_user_templates(
    db: Session, offset: Union[int, None] = None, limit: Union[int, None] = None
) -> List[UserTemplate]:
    """Retrieves a list of user templates with optional pagination."""
    query = db.query(UserTemplate)
    if offset:
        query = query.offset(offset)
    if limit:
        query = query.limit(limit)
    return query.all()
