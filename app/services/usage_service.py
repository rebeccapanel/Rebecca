"""Usage enforcement helpers shared by live recording and tests."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import selectinload

from app.db import crud
from app.db.models import User
from app.models.user import UserResponse, UserStatus
from app.runtime import xray
from app.utils import report

logger = logging.getLogger(__name__)


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


def sync_usage_updates_to_db() -> None:
    """Compatibility no-op; usage writes are already persisted by recording jobs."""
    return None


def _enforce_user_limits_after_sync(db, users: List[User]) -> None:
    """Ensure users are limited/expired as soon as their usage is applied to DB."""
    if not users:
        return

    now_ts = datetime.now(timezone.utc).timestamp()
    changed: List[User] = []
    activated: List[User] = []
    users_to_remove_from_xray: List[User] = []

    user_ids = [u.id for u in users if getattr(u, "id", None) is not None]
    hydrated_users = (
        db.query(User)
        .options(selectinload(User.admin), selectinload(User.next_plans))
        .filter(User.id.in_(user_ids))
        .all()
    )
    indexed = {u.id: u for u in hydrated_users}

    for user in users:
        db_user = indexed.get(user.id)
        if not db_user:
            continue

        now_dt = datetime.now(timezone.utc)
        if _should_reactivate_on_hold(db_user, now_ts=now_ts):
            _apply_on_hold_activation(db_user, now_dt=now_dt)
            activated.append(db_user)

        limited = bool(db_user.data_limit and (db_user.used_traffic or 0) >= db_user.data_limit)
        expired = bool(db_user.expire and db_user.expire <= now_ts)

        if db_user.next_plan:
            plan = db_user.next_plan
            trigger_matches = plan.trigger_on == "either" or (
                (plan.trigger_on == "data" and limited) or (plan.trigger_on == "expire" and expired)
            )
            if plan.start_on_first_connect and db_user.online_at is None and db_user.used_traffic == 0:
                trigger_matches = False
            if (limited or expired) and trigger_matches:
                try:
                    crud.reset_user_by_next(db, db_user)
                    xray.operations.update_user(db_user)
                    user_resp = UserResponse.model_validate(db_user)
                    report.user_data_reset_by_next(user=user_resp, user_admin=db_user.admin)
                    report.user_auto_renew_applied(user=user_resp, user_admin=db_user.admin)
                    continue
                except Exception as exc:  # pragma: no cover - best-effort
                    logger.warning("Failed to apply next plan for user %s: %s", db_user.id, exc)

        target_status: Optional[UserStatus] = None
        if limited:
            target_status = UserStatus.limited
        elif expired:
            target_status = UserStatus.expired

        if target_status:
            if db_user.status in {UserStatus.active, UserStatus.on_hold}:
                users_to_remove_from_xray.append(db_user)

            if db_user.status != target_status:
                db_user.status = target_status
                db_user.last_status_change = now_dt
                changed.append(db_user)

    if changed or activated or users_to_remove_from_xray:
        db.commit()

        changed_ids = {user.id for user in changed}
        removed_ids = set()
        for user in users_to_remove_from_xray:
            if user.id in removed_ids:
                continue
            removed_ids.add(user.id)
            try:
                xray.operations.remove_user(user)
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning("Failed to remove limited/expired user %s from XRay: %s", user.id, exc)

        for user in changed:
            try:
                report.status_change(
                    username=user.username,
                    status=user.status,
                    user=UserResponse.model_validate(user),
                    user_admin=user.admin,
                )
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning("Failed to send status change report for user %s: %s", user.id, exc)

        for user in activated:
            if user.id in changed_ids:
                continue
            try:
                xray.operations.add_user(user)
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning("Failed to add re-activated user %s to XRay: %s", user.id, exc)

            try:
                report.status_change(
                    username=user.username,
                    status=user.status,
                    user=UserResponse.model_validate(user),
                    user_admin=user.admin,
                )
            except Exception as exc:  # pragma: no cover - best-effort
                logger.warning("Failed to send activation report for user %s: %s", user.id, exc)
