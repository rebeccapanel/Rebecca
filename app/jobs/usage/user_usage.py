from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Union

from sqlalchemy import and_, bindparam, func, insert, or_, select, update
from sqlalchemy.orm import selectinload

from app.db import GetDB, crud
from app.db.models import Admin, AdminServiceLink, NodeUserUsage, Service, User
from app.jobs.usage.collectors import get_users_stats
from app.jobs.usage.utils import hour_bucket, safe_execute, utcnow_naive
from app.models.admin import Admin as AdminSchema
from app.models.user import UserResponse, UserStatus
from app.runtime import logger, xray
from app.utils import report
from config import DISABLE_RECORDING_NODE_USAGE


"""User/admin/service usage pipeline: collect, aggregate, cache (Redis), and persist (DB) without behavior changes."""

# region Collect & aggregate per-user stats from Xray


def _build_api_instances():
    api_instances = {}
    usage_coefficient = {}

    try:
        if getattr(xray.core, "available", False) and getattr(xray.core, "started", False):
            api_instances[None] = xray.api
            usage_coefficient[None] = 1
    except Exception:
        # Skip master core if it's unavailable; still record from nodes
        pass

    for node_id, node in list(xray.nodes.items()):
        if node.connected and node.started:
            api_instances[node_id] = node.api
            usage_coefficient[node_id] = node.usage_coefficient

    return api_instances, usage_coefficient


def _collect_usage_params(api_instances):
    if not api_instances:
        return {}

    executor = ThreadPoolExecutor(max_workers=10)
    futures = {node_id: executor.submit(get_users_stats, api) for node_id, api in api_instances.items()}

    api_params = {}
    for node_id, future in futures.items():
        try:
            api_params[node_id] = future.result(timeout=30)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"Failed to get stats from node {node_id}: {exc}")
            api_params[node_id] = []
            try:
                future.cancel()
            except Exception:
                pass

    try:
        executor.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        executor.shutdown(wait=False)

    return api_params


def _aggregate_user_usage(api_params, usage_coefficient):
    users_usage = defaultdict(int)
    for node_id, params in api_params.items():
        coefficient = usage_coefficient.get(node_id, 1)
        for param in params:
            users_usage[param["uid"]] += int(param["value"] * coefficient)
    return [{"uid": uid, "value": value} for uid, value in users_usage.items()]


def _load_user_mapping(user_ids):
    with GetDB() as db:
        rows = db.query(User.id, User.admin_id, User.service_id).filter(User.id.in_(user_ids)).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def _collect_admin_service_usage(users_usage, mapping: Dict[int, Tuple[Optional[int], Optional[int]]]):
    # Aggregate usage per admin, per service, and per admin-service link.
    admin_usage = defaultdict(int)
    service_usage = defaultdict(int)
    admin_service_usage = defaultdict(int)

    for user_usage in users_usage:
        admin_id, service_id = mapping.get(int(user_usage["uid"]), (None, None))
        value = user_usage["value"]
        if admin_id:
            admin_usage[admin_id] += value
        if service_id:
            service_usage[service_id] += value
            if admin_id:
                admin_service_usage[(admin_id, service_id)] += value

    return admin_usage, service_usage, admin_service_usage


# endregion

# region Limit/expire enforcement helpers


def _reset_user_to_next_plan(db, user: User) -> bool:
    """Apply next plan and notify; return True if applied successfully."""
    try:
        crud.reset_user_by_next(db, user)
        xray.operations.update_user(user)
        report.user_data_reset_by_next(user=UserResponse.model_validate(user), user_admin=user.admin)
        report.user_auto_renew_applied(user=UserResponse.model_validate(user), user_admin=user.admin)
        return True
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning(f"Failed to apply next plan for user {getattr(user, 'id', '?')}: {exc}")
        return False


def _enforce_user_limits_and_expiry(db, user_ids: List[int]) -> List[User]:
    """
    Ensure users crossing their data/time limits are moved to limited/expired immediately.
    Also handles fire_on_either next_plan resets so we don't rely solely on the review job.
    """
    if not user_ids:
        return []

    now_ts = datetime.now(timezone.utc).timestamp()
    users = (
        db.query(User)
        .options(selectinload(User.admin), selectinload(User.next_plans))
        .filter(User.id.in_(user_ids))
        .all()
    )

    changed: List[User] = []
    for user in users:
        limited = bool(user.data_limit and (user.used_traffic or 0) >= user.data_limit)
        expired = bool(user.expire and user.expire <= now_ts)

        if user.next_plan:
            plan = user.next_plan
            trigger_matches = plan.trigger_on == "either" or (
                (plan.trigger_on == "data" and limited) or (plan.trigger_on == "expire" and expired)
            )
            if plan.start_on_first_connect and user.online_at is None and user.used_traffic == 0:
                trigger_matches = False
            if (limited or expired) and trigger_matches and _reset_user_to_next_plan(db, user):
                continue

        target_status: Optional[UserStatus] = None
        if limited:
            target_status = UserStatus.limited
        elif expired:
            target_status = UserStatus.expired

        if target_status and user.status != target_status:
            user.status = target_status
            user.last_status_change = datetime.now(timezone.utc)
            changed.append(user)

    if changed:
        db.commit()

        for user in changed:
            try:
                xray.operations.remove_user(user)
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to remove limited/expired user {user.id} from XRay: {exc}")

            try:
                report.status_change(
                    username=user.username,
                    status=user.status,
                    user=UserResponse.model_validate(user),
                    user_admin=user.admin,
                )
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to send status change report for user {user.id}: {exc}")

            # Keep Redis caches in sync (best-effort)
            try:
                from app.redis.cache import cache_user, invalidate_user_cache

                invalidate_user_cache(username=user.username, user_id=user.id)
                cache_user(user, mark_for_sync=True)
            except Exception:
                pass

    return changed


def _get_due_active_user_ids(
    db, now_ts: Optional[float] = None, *, batch_size: int = 500, after_id: Optional[int] = None
) -> List[int]:
    """Return active users that are already due for limited/expired status transitions."""
    if batch_size <= 0:
        return []

    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()

    query = (
        db.query(User.id)
        .filter(
            User.status == UserStatus.active,
            or_(
                and_(User.expire.isnot(None), User.expire > 0, User.expire <= now_ts),
                and_(
                    User.data_limit.isnot(None),
                    User.data_limit > 0,
                    func.coalesce(User.used_traffic, 0) >= User.data_limit,
                ),
            ),
        )
    )
    if after_id is not None:
        query = query.filter(User.id > after_id)

    rows = query.order_by(User.id.asc()).limit(batch_size).all()

    return [int(row[0]) for row in rows if row and row[0] is not None]


def _enforce_due_active_users(db, *, batch_size: int = 500) -> int:
    """
    Enforce limit/expiry for due active users even without fresh usage samples.
    This prevents users from staying active until their next connection.
    """
    now_ts = datetime.now(timezone.utc).timestamp()
    changed_total = 0
    last_id: Optional[int] = None

    while True:
        due_ids = _get_due_active_user_ids(db, now_ts=now_ts, batch_size=batch_size, after_id=last_id)
        if not due_ids:
            break

        changed_total += len(_enforce_user_limits_and_expiry(db, due_ids))
        last_id = due_ids[-1]

        if len(due_ids) < batch_size:
            break

    return changed_total


# endregion


# region Per-node hourly snapshots for users (Redis first, DB fallback)


def _cache_user_snapshots(params: list, node_id: Union[int, None], created_at, consumption_factor: int):
    # Per-node hourly snapshots (Redis) for charts/backups.
    from app.redis.cache import cache_user_usage_snapshot

    user_snapshots = []
    for param in params:
        uid = int(param["uid"])
        raw_value = param.get("value", 0)
        try:
            value = int(float(raw_value)) * consumption_factor
        except (ValueError, TypeError):
            logger.warning(f"Invalid usage value for user {uid}: {raw_value}")
            continue
        cache_user_usage_snapshot(uid, node_id, created_at, value)
        user_snapshots.append(
            {"user_id": uid, "node_id": node_id, "created_at": created_at.isoformat(), "used_traffic": value}
        )
    return user_snapshots


def _persist_user_stats_to_db(params: list, node_id: Union[int, None], created_at, consumption_factor: int):
    with GetDB() as db:
        select_stmt = select(NodeUserUsage.user_id).where(
            and_(NodeUserUsage.node_id == node_id, NodeUserUsage.created_at == created_at)
        )
        existings = [row[0] for row in db.execute(select_stmt).fetchall()]
        uids_to_insert = {int(param["uid"]) for param in params if int(param["uid"]) not in existings}

        if uids_to_insert:
            stmt = insert(NodeUserUsage).values(
                user_id=bindparam("uid"), created_at=created_at, node_id=node_id, used_traffic=0
            )
            safe_execute(db, stmt, [{"uid": uid} for uid in uids_to_insert])

        stmt = (
            update(NodeUserUsage)
            .values(used_traffic=NodeUserUsage.used_traffic + bindparam("value") * consumption_factor)
            .where(
                and_(
                    NodeUserUsage.user_id == bindparam("uid"),
                    NodeUserUsage.node_id == node_id,
                    NodeUserUsage.created_at == created_at,
                )
            )
        )
        safe_execute(db, stmt, params)


def record_user_stats(params: list, node_id: Union[int, None], consumption_factor: int = 1):
    if not params:
        return

    created_at = hour_bucket()

    from app.redis.client import get_redis
    from app.redis.pending_backup import save_usage_snapshots_backup
    from config import REDIS_ENABLED

    redis_client = get_redis() if REDIS_ENABLED else None
    if redis_client:
        # Redis path: cache snapshots + write pending backup.
        user_snapshots = _cache_user_snapshots(params, node_id, created_at, consumption_factor)
        save_usage_snapshots_backup(user_snapshots, [])
        return

    _persist_user_stats_to_db(params, node_id, created_at, consumption_factor)


# endregion


# region Admin/Service aggregates and persistence (Redis or DB)


def _cache_usage_updates(users_usage, admin_usage, service_usage):
    # Redis path: cache per-user delta and backup admin/service aggregates.
    from app.redis.cache import cache_user_usage_update
    from app.redis.pending_backup import save_admin_usage_backup, save_service_usage_backup, save_user_usage_backup

    online_at = utcnow_naive()

    user_usage_backup = []
    for usage in users_usage:
        user_id = int(usage["uid"])
        raw_value = usage.get("value", 0)
        try:
            value = int(float(raw_value))
        except (ValueError, TypeError):
            logger.warning(f"Invalid usage value for user {user_id}: {raw_value}")
            continue
        cache_user_usage_update(user_id, value, online_at)
        user_usage_backup.append({"user_id": user_id, "used_traffic_delta": value, "online_at": online_at.isoformat()})

    save_user_usage_backup(user_usage_backup)
    save_admin_usage_backup(admin_usage)
    save_service_usage_backup(service_usage)


def _apply_usage_to_db(users_usage, admin_usage, service_usage, admin_service_usage):
    # DB path: apply deltas to users, admins, services, and admin-service links.
    admin_limit_events = []

    with GetDB() as db:
        stmt = (
            update(User)
            .where(User.id == bindparam("uid"))
            .values(used_traffic=User.used_traffic + bindparam("value"), online_at=utcnow_naive())
        )
        safe_execute(db, stmt, users_usage)

        admin_data = [{"admin_id": admin_id, "value": value} for admin_id, value in admin_usage.items()]
        if admin_data:
            increments = {entry["admin_id"]: entry["value"] for entry in admin_data}
            admin_rows = db.query(Admin).filter(Admin.id.in_(increments.keys())).all()
            for admin_row in admin_rows:
                limit = admin_row.data_limit
                if limit:
                    previous_usage = admin_row.users_usage or 0
                    new_usage = previous_usage + increments.get(admin_row.id, 0)
                    if previous_usage < limit <= new_usage:
                        admin_limit_events.append(
                            {
                                "admin_id": admin_row.id,
                                "admin": AdminSchema.model_validate(admin_row),
                                "limit": limit,
                                "current": new_usage,
                            }
                        )

            admin_update_stmt = (
                update(Admin)
                .where(Admin.id == bindparam("b_admin_id"))
                .values(
                    users_usage=Admin.users_usage + bindparam("value"),
                    lifetime_usage=Admin.lifetime_usage + bindparam("value"),
                )
            )
            safe_execute(
                db,
                admin_update_stmt,
                [{"b_admin_id": entry["admin_id"], "value": entry["value"]} for entry in admin_data],
            )

        if service_usage:
            service_update_stmt = (
                update(Service)
                .where(Service.id == bindparam("b_service_id"))
                .values(
                    used_traffic=Service.used_traffic + bindparam("value"),
                    lifetime_used_traffic=Service.lifetime_used_traffic + bindparam("value"),
                    updated_at=func.now(),
                )
            )
            service_params = [{"b_service_id": sid, "value": value} for sid, value in service_usage.items()]
            safe_execute(db, service_update_stmt, service_params)

        if admin_service_usage:
            admin_service_update_stmt = (
                update(AdminServiceLink)
                .where(
                    and_(
                        AdminServiceLink.admin_id == bindparam("b_admin_id"),
                        AdminServiceLink.service_id == bindparam("b_service_id"),
                    )
                )
                .values(
                    used_traffic=AdminServiceLink.used_traffic + bindparam("value"),
                    lifetime_used_traffic=AdminServiceLink.lifetime_used_traffic + bindparam("value"),
                    updated_at=func.now(),
                )
            )
            admin_service_params = [
                {"b_admin_id": admin_id, "b_service_id": service_id, "value": value}
                for (admin_id, service_id), value in admin_service_usage.items()
            ]
            safe_execute(db, admin_service_update_stmt, admin_service_params)

        admin_ids_to_disable = {event["admin_id"] for event in admin_limit_events if event.get("admin_id") is not None}
        for admin_id in admin_ids_to_disable:
            dbadmin = db.query(Admin).filter(Admin.id == admin_id).first()
            if dbadmin:
                crud.enforce_admin_data_limit(db, dbadmin)

        # Enforce per-user limits/expiry immediately using the freshly updated usage.
        _enforce_user_limits_and_expiry(db, [int(usage["uid"]) for usage in users_usage if usage.get("uid")])

    return admin_limit_events


# endregion


# region Job entrypoint


def record_user_usages():
    # Always enforce due limits/expiry first, even if no current usage was collected.
    try:
        with GetDB() as db:
            _enforce_due_active_users(db)
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning(f"Failed to enforce due active-user limits/expiry: {exc}")

    api_instances, usage_coefficient = _build_api_instances()
    if not api_instances:
        return
    api_params = _collect_usage_params(api_instances)

    users_usage = _aggregate_user_usage(api_params, usage_coefficient)
    if not users_usage:
        return

    user_ids = [int(entry["uid"]) for entry in users_usage]
    mapping = _load_user_mapping(user_ids)
    admin_usage, service_usage, admin_service_usage = _collect_admin_service_usage(users_usage, mapping)

    from app.redis.client import get_redis

    redis_client = get_redis()
    if redis_client:
        # Redis mode: push deltas + backup (user/admin/service).
        _cache_usage_updates(users_usage, admin_usage, service_usage)
        # Also write-through to DB immediately, then clear pending keys to avoid double-count.
        admin_limit_events = _apply_usage_to_db(users_usage, admin_usage, service_usage, admin_service_usage)
        try:
            from app.redis.cache import clear_user_pending_usage

            clear_user_pending_usage(user_ids)
        except Exception:
            pass
    else:
        # DB mode: update user/admin/service/admin-service tables.
        admin_limit_events = _apply_usage_to_db(users_usage, admin_usage, service_usage, admin_service_usage)

    # Notify admin limit triggers (only DB path populates events).
    for event in admin_limit_events:
        report.admin_data_limit_reached(event["admin"], event["limit"], event["current"])

    if DISABLE_RECORDING_NODE_USAGE:
        return

    # Write per-node/hour snapshots (Redis or DB fallback).
    for node_id, params in api_params.items():
        record_user_stats(params, node_id, usage_coefficient.get(node_id, 1))


# endregion
