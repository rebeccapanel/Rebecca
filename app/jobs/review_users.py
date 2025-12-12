from datetime import datetime, timezone
from typing import List, Optional
import threading

from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from app.runtime import logger, scheduler, xray
from app.db import (
    GetDB,
    get_user_queryset,
    start_user_expire,
    update_user_status,
    reset_user_by_next,
)
from app.db.models import User
from app.models.user import UserResponse, UserStatus
from app.utils import report
from config import JOB_REVIEW_USERS_BATCH_SIZE, JOB_REVIEW_USERS_INTERVAL
from app.redis.client import get_redis
from app.redis.cache import get_user_pending_usage_state

_review_lock = threading.Lock()

REDIS_REVIEW_LAST_ACTIVE_ID = "job:review:last_active_id"
REDIS_REVIEW_LAST_ON_HOLD_ID = "job:review:last_on_hold_id"


def _redis():
    try:
        return get_redis()
    except Exception:
        return None


def _get_last_id(key: str) -> Optional[int]:
    client = _redis()
    if not client:
        return None
    value = client.get(key)
    if not value:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _set_last_id(key: str, value: int) -> None:
    client = _redis()
    if not client:
        return
    try:
        client.set(key, str(value))
    except Exception:
        return


def _get_user_used_traffic(user: User) -> int:
    # Combine DB usage with any pending deltas in Redis (not yet synced to DB).
    base_usage = user.used_traffic or 0
    try:
        pending_total, _ = get_user_pending_usage_state(user.id) if user.id is not None else (0, None)
        base_usage += pending_total
    except Exception:
        pass

    # Allow overriding with a dedicated Redis key if present.
    client = _redis()
    if client and user.id is not None:
        key = f"user:{user.id}:used_traffic"
        value = client.get(key)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                pass
    return base_usage


def _is_user_limited(user: User) -> bool:
    if not user.data_limit:
        return False
    used = _get_user_used_traffic(user)
    return used >= user.data_limit


def _batch_users_by_status(db: Session, status: UserStatus, after_id: Optional[int] = None) -> List[User]:
    """
    Fetch a stable, ordered batch of users so pagination keeps moving even
    when user statuses change mid-iteration.
    """
    query = get_user_queryset(db).filter(User.status == status).order_by(User.id)

    if after_id is not None:
        query = query.filter(User.id > after_id)

    return query.limit(JOB_REVIEW_USERS_BATCH_SIZE).all()


def reset_user_by_next_report(db: Session, user: User):
    user = reset_user_by_next(db, user)

    xray.operations.update_user(user)

    report.user_data_reset_by_next(user=UserResponse.model_validate(user), user_admin=user.admin)


def review():
    if not _review_lock.acquire(blocking=False):
        logger.debug("Review job skipped because a previous run is still in progress")
        return
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    started_at = now_ts
    max_run_seconds = JOB_REVIEW_USERS_INTERVAL * 0.7
    try:
        with GetDB() as db:
            try:
                last_active_id: Optional[int] = _get_last_id(REDIS_REVIEW_LAST_ACTIVE_ID)
                active_batch = _batch_users_by_status(db, UserStatus.active, after_id=last_active_id)
                if not active_batch:
                    _set_last_id(REDIS_REVIEW_LAST_ACTIVE_ID, 0)
                else:
                    for user in active_batch:
                        limited = _is_user_limited(user)
                        expired = user.expire and user.expire <= now_ts

                        if (limited or expired) and user.next_plan is not None:
                            if user.next_plan.fire_on_either:
                                reset_user_by_next_report(db, user)
                                last_active_id = user.id
                                if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                                    break
                                continue
                            elif limited and expired:
                                reset_user_by_next_report(db, user)
                                last_active_id = user.id
                                if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                                    break
                                continue

                        if limited:
                            status = UserStatus.limited
                        elif expired:
                            status = UserStatus.expired
                        else:
                            last_active_id = user.id
                            if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                                break
                            continue

                        try:
                            xray.operations.remove_user(user)
                        except Exception as e:
                            logger.warning(
                                f"Failed to remove user {user.id} ({user.username}) from XRay: {e}. "
                                f"Status will still be updated to {status}."
                            )

                        try:
                            update_user_status(db, user, status)
                            logger.info(f'User "{user.username}" status changed to {status}')
                            try:
                                report.status_change(
                                    username=user.username,
                                    status=status,
                                    user=UserResponse.model_validate(user),
                                    user_admin=user.admin,
                                )
                            except Exception as report_error:
                                logger.warning(
                                    f"Failed to send status change report for user {user.id} ({user.username}): {report_error}"
                                )
                        except Exception as e:
                            logger.error(
                                f"Failed to update status for user {user.id} ({user.username}) to {status}: {e}"
                            )
                            db.rollback()

                        last_active_id = user.id
                        if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                            break

                    if last_active_id is not None:
                        _set_last_id(REDIS_REVIEW_LAST_ACTIVE_ID, last_active_id)

                if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                    return

                last_on_hold_id: Optional[int] = _get_last_id(REDIS_REVIEW_LAST_ON_HOLD_ID)
                on_hold_batch = _batch_users_by_status(db, UserStatus.on_hold, after_id=last_on_hold_id)
                if not on_hold_batch:
                    _set_last_id(REDIS_REVIEW_LAST_ON_HOLD_ID, 0)
                else:
                    for user in on_hold_batch:
                        if user.edit_at:
                            base_time = datetime.timestamp(user.edit_at)
                        else:
                            base_time = datetime.timestamp(user.created_at)

                        status = None
                        if user.online_at and base_time <= datetime.timestamp(user.online_at):
                            status = UserStatus.active
                        elif user.on_hold_timeout and (datetime.timestamp(user.on_hold_timeout) <= (now_ts)):
                            status = UserStatus.active
                        else:
                            last_on_hold_id = user.id
                            if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                                break
                            continue

                        update_user_status(db, user, status)
                        start_user_expire(db, user)

                        if status == UserStatus.active:
                            try:
                                xray.operations.add_user(user)
                            except Exception as e:
                                logger.warning(
                                    f"Failed to add user {user.id} ({user.username}) to XRay: {e}. "
                                    f"Status will still be updated to {status}."
                                )

                        report.status_change(
                            username=user.username,
                            status=status,
                            user=UserResponse.model_validate(user),
                            user_admin=user.admin,
                        )

                        logger.info(f'User "{user.username}" status changed to {status}')

                        last_on_hold_id = user.id
                        if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                            break

                    if last_on_hold_id is not None:
                        _set_last_id(REDIS_REVIEW_LAST_ON_HOLD_ID, last_on_hold_id)
            except OperationalError as exc:
                logger.error(f"Review job aborted due to database error: {exc}")
                db.rollback()
                return
    finally:
        _review_lock.release()


scheduler.add_job(
    review,
    "interval",
    seconds=JOB_REVIEW_USERS_INTERVAL,
    coalesce=True,
    max_instances=1,
    misfire_grace_time=JOB_REVIEW_USERS_INTERVAL,
    replace_existing=True,
)
