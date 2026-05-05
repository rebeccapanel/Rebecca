from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Union

from sqlalchemy import and_, bindparam, case, func, insert, or_, select, update
from sqlalchemy.exc import OperationalError, TimeoutError as SQLTimeoutError
from sqlalchemy.orm import selectinload

from app.db import GetDB, crud
from app.db.models import Admin, AdminServiceLink, NodeUserUsage, Service, User
from app.jobs.usage.collectors import get_users_stats
from app.jobs.usage.delivery_buffer import usage_delivery_buffer
from app.jobs.usage.utils import hour_bucket, is_retryable_db_error, retry_delay, safe_execute, utcnow_naive
from app.models.admin import Admin as AdminSchema, AdminStatus
from app.models.user import UserResponse, UserStatus
from app.runtime import logger, xray
from app.utils import report
from config import DISABLE_RECORDING_NODE_USAGE


"""User/admin/service usage pipeline: collect, aggregate, and persist usage in the database."""

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
            api_instances[node_id] = node
            usage_coefficient[node_id] = node.usage_coefficient

    return api_instances, usage_coefficient


def _is_missing_node_usage_endpoint(exc: Exception) -> bool:
    return getattr(exc, "status_code", None) in (404, 405)


def _collect_user_stats(source):
    if not hasattr(source, "collect_user_stats"):
        return {"stats": get_users_stats(source), "node_batch_id": ""}
    try:
        payload = source.collect_user_stats()
        return {
            "stats": payload.get("stats") or [],
            "node_batch_id": payload.get("batch_id") or "",
        }
    except Exception as exc:
        if not _is_missing_node_usage_endpoint(exc):
            raise

    return {"stats": get_users_stats(source.api), "node_batch_id": ""}


def _ack_node_user_batches(node_batches: dict[int, str]) -> None:
    for node_id, batch_id in node_batches.items():
        if not batch_id:
            continue
        node = xray.nodes.get(node_id)
        if not node:
            continue
        max_retries = 3
        for tries in range(1, max_retries + 1):
            try:
                node.ack_user_stats(batch_id)
                break
            except Exception as exc:  # pragma: no cover - best effort
                if tries >= max_retries:
                    logger.warning(f"Failed to ack user usage batch {batch_id} for node {node_id}: {exc}")
                    break
                retry_delay(tries)


def _collect_usage_params(api_instances):
    if not api_instances:
        return {}, {}

    executor = ThreadPoolExecutor(max_workers=10)
    futures = {node_id: executor.submit(_collect_user_stats, source) for node_id, source in api_instances.items()}

    api_params = {}
    node_batches = {}
    for node_id, future in futures.items():
        try:
            result = future.result(timeout=30)
            node_batch_id = ""
            if isinstance(result, dict):
                node_batch_id = result.get("node_batch_id") or ""
                node_batches[node_id] = node_batch_id
                result = result.get("stats") or []
            if node_batch_id:
                api_params[node_id] = usage_delivery_buffer.replace_user_stats(node_id, result)
            else:
                api_params[node_id] = usage_delivery_buffer.add_user_stats(node_id, result)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"Failed to get stats from node {node_id}: {exc}")
            api_params[node_id] = usage_delivery_buffer.pending_user_stats(node_id)
            try:
                future.cancel()
            except Exception:
                pass

    try:
        executor.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        executor.shutdown(wait=False)

    return api_params, node_batches


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


def _to_utc_timestamp(value: Optional[datetime]) -> Optional[float]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).timestamp()
    return value.astimezone(timezone.utc).timestamp()


def _should_reactivate_on_hold(user: User, *, now_ts: float) -> bool:
    if user.status != UserStatus.on_hold:
        return False

    base_time = user.edit_at or user.created_at or user.last_status_change
    base_ts = _to_utc_timestamp(base_time)
    online_ts = _to_utc_timestamp(user.online_at)
    if online_ts is not None and (base_ts is None or online_ts >= base_ts):
        return True

    timeout_ts = _to_utc_timestamp(user.on_hold_timeout)
    return timeout_ts is not None and timeout_ts <= now_ts


def _apply_on_hold_activation(user: User, *, now_dt: datetime) -> None:
    user.status = UserStatus.active
    user.last_status_change = now_dt

    hold_duration = user.on_hold_expire_duration
    if hold_duration is not None:
        user.expire = int(now_dt.timestamp()) + int(hold_duration)
    user.on_hold_expire_duration = None
    user.on_hold_timeout = None


def _user_status_value(user: User) -> str:
    status = getattr(user, "status", None)
    return getattr(status, "value", status)


def _is_runtime_user(user: User) -> bool:
    return _user_status_value(user) in {UserStatus.active.value, UserStatus.on_hold.value}


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
    activated: List[User] = []
    users_to_remove_from_xray: List[User] = []
    for user in users:
        now_dt = datetime.now(timezone.utc)

        if not _is_runtime_user(user):
            users_to_remove_from_xray.append(user)
            continue

        if _should_reactivate_on_hold(user, now_ts=now_ts):
            _apply_on_hold_activation(user, now_dt=now_dt)
            activated.append(user)

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
            user.last_status_change = now_dt
            changed.append(user)

    if changed or activated:
        db.commit()

    if changed or activated or users_to_remove_from_xray:
        changed_ids = {user.id for user in changed}
        removed_ids = set()
        for user in [*changed, *users_to_remove_from_xray]:
            if user.id in removed_ids:
                continue
            removed_ids.add(user.id)
            try:
                xray.operations.remove_user(user)
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to remove limited/expired user {user.id} from XRay: {exc}")

        for user in changed:
            try:
                report.status_change(
                    username=user.username,
                    status=user.status,
                    user=UserResponse.model_validate(user),
                    user_admin=user.admin,
                )
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to send status change report for user {user.id}: {exc}")

        for user in activated:
            if user.id in changed_ids:
                continue
            try:
                xray.operations.add_user(user)
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to add re-activated user {user.id} to XRay: {exc}")

            try:
                report.status_change(
                    username=user.username,
                    status=user.status,
                    user=UserResponse.model_validate(user),
                    user_admin=user.admin,
                )
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning(f"Failed to send activation report for user {user.id}: {exc}")

    return changed


def _get_due_active_user_ids(
    db, now_ts: Optional[float] = None, *, batch_size: int = 500, after_id: Optional[int] = None
) -> List[int]:
    """Return active users that are already due for limited/expired status transitions."""
    if batch_size <= 0:
        return []

    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()

    query = db.query(User.id).filter(
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


def _get_due_active_admin_ids(
    db, now_ts: Optional[float] = None, *, batch_size: int = 500, after_id: Optional[int] = None
) -> List[int]:
    """Return active admins whose time limit has already expired."""
    if batch_size <= 0:
        return []

    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()

    query = db.query(Admin.id).filter(
        Admin.status == AdminStatus.active,
        Admin.expire.isnot(None),
        Admin.expire > 0,
        Admin.expire <= now_ts,
    )
    if after_id is not None:
        query = query.filter(Admin.id > after_id)

    rows = query.order_by(Admin.id.asc()).limit(batch_size).all()
    return [int(row[0]) for row in rows if row and row[0] is not None]


def _enforce_due_active_admins(db, *, batch_size: int = 500) -> int:
    """
    Enforce time-limit expiry for admins even if no admin/user edit request happens.
    This keeps account status aligned with the configured admin expiration timestamp.
    """
    now_ts = datetime.now(timezone.utc).timestamp()
    changed_total = 0
    last_id: Optional[int] = None

    while True:
        due_ids = _get_due_active_admin_ids(db, now_ts=now_ts, batch_size=batch_size, after_id=last_id)
        if not due_ids:
            break

        due_admins = db.query(Admin).filter(Admin.id.in_(due_ids)).order_by(Admin.id.asc()).all()
        batch_changed = False
        for dbadmin in due_admins:
            if crud.enforce_admin_time_limit(db, dbadmin, now_ts=now_ts):
                changed_total += 1
                batch_changed = True

        if batch_changed:
            db.commit()

        last_id = due_ids[-1]
        if len(due_ids) < batch_size:
            break

    return changed_total


# endregion


# region Per-node hourly snapshots for users


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
    _persist_user_stats_to_db(params, node_id, created_at, consumption_factor)


# endregion


# region Admin/Service aggregates and persistence


def _apply_usage_to_db_once(users_usage, admin_usage, service_usage, admin_service_usage):
    # DB path: apply deltas to users, admins, services, and admin-service links.
    admin_limit_events = []

    with GetDB() as db:
        stmt = (
            update(User)
            .where(User.id == bindparam("uid"))
            .values(
                used_traffic=User.used_traffic + bindparam("value"),
                online_at=case(
                    (
                        or_(User.status == UserStatus.active, User.status == UserStatus.on_hold),
                        utcnow_naive(),
                    ),
                    else_=User.online_at,
                ),
            )
        )
        db.execute(stmt, users_usage)

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
            db.execute(
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
            db.execute(service_update_stmt, service_params)

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
            db.execute(admin_service_update_stmt, admin_service_params)
            for admin_id, service_id in admin_service_usage.keys():
                link = (
                    db.query(AdminServiceLink)
                    .filter(AdminServiceLink.admin_id == admin_id, AdminServiceLink.service_id == service_id)
                    .first()
                )
                if link:
                    crud.enforce_admin_service_data_limit(db, link)

        admin_ids_to_disable = {event["admin_id"] for event in admin_limit_events if event.get("admin_id") is not None}
        for admin_id in admin_ids_to_disable:
            dbadmin = db.query(Admin).filter(Admin.id == admin_id).first()
            if dbadmin:
                crud.enforce_admin_data_limit(db, dbadmin)

        # Enforce per-user limits/expiry immediately using the freshly updated usage.
        _enforce_user_limits_and_expiry(db, [int(usage["uid"]) for usage in users_usage if usage.get("uid")])
        db.commit()

    return admin_limit_events


def _apply_usage_to_db(users_usage, admin_usage, service_usage, admin_service_usage):
    max_retries = 8
    tries = 0
    while True:
        try:
            return _apply_usage_to_db_once(users_usage, admin_usage, service_usage, admin_service_usage)
        except (OperationalError, SQLTimeoutError) as exc:
            tries += 1
            if not is_retryable_db_error(exc) or tries >= max_retries:
                raise
            logger.warning("Retryable database error while recording user usage, retrying (%s/%s)...", tries, max_retries)
            retry_delay(tries)


# endregion


# region Job entrypoint


def record_user_usages():
    # Always enforce due limits/expiry first, even if no current usage was collected.
    try:
        with GetDB() as db:
            _enforce_due_active_admins(db)
            _enforce_due_active_users(db)
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning(f"Failed to enforce due active account limits/expiry: {exc}")

    api_instances, usage_coefficient = _build_api_instances()
    if not api_instances:
        return
    api_params, node_batches = _collect_usage_params(api_instances)

    users_usage = _aggregate_user_usage(api_params, usage_coefficient)
    if not users_usage:
        _ack_node_user_batches(node_batches)
        return

    user_ids = [int(entry["uid"]) for entry in users_usage]
    mapping = _load_user_mapping(user_ids)
    admin_usage, service_usage, admin_service_usage = _collect_admin_service_usage(users_usage, mapping)

    del user_ids
    admin_limit_events = _apply_usage_to_db(users_usage, admin_usage, service_usage, admin_service_usage)

    usage_delivery_buffer.ack_user_stats_for(api_params.keys())
    _ack_node_user_batches(node_batches)

    # Notify admin limit triggers.
    for event in admin_limit_events:
        try:
            report.admin_data_limit_reached(event["admin"], event["limit"], event["current"])
        except Exception as exc:  # pragma: no cover - best-effort
            logger.warning(f"Failed to send admin data limit report for admin {event.get('admin_id')}: {exc}")

    if DISABLE_RECORDING_NODE_USAGE:
        return

    # Write per-node/hour snapshots.
    for node_id, params in api_params.items():
        try:
            record_user_stats(params, node_id, usage_coefficient.get(node_id, 1))
        except Exception as exc:  # pragma: no cover - best-effort
            logger.warning(f"Failed to record hourly user usage snapshot for node {node_id}: {exc}")


# endregion
