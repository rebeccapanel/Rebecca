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

_review_lock = threading.Lock()

_last_active_id: Optional[int] = None
_last_on_hold_id: Optional[int] = None


def _get_user_used_traffic(user: User) -> int:
    return user.used_traffic or 0


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
    global _last_active_id, _last_on_hold_id
    if not _review_lock.acquire(blocking=False):
        logger.debug("Review job skipped because a previous run is still in progress")
        return
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    started_at = now_ts
    max_run_seconds = max(5, JOB_REVIEW_USERS_INTERVAL * 0.7)
    try:
        with GetDB() as db:
            try:
                last_active_id: Optional[int] = _last_active_id
                active_batch = _batch_users_by_status(db, UserStatus.active, after_id=last_active_id)
                if not active_batch:
                    _last_active_id = None
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
                        _last_active_id = last_active_id

                if datetime.now(timezone.utc).timestamp() - started_at > max_run_seconds:
                    return

                last_on_hold_id: Optional[int] = _last_on_hold_id
                on_hold_batch = _batch_users_by_status(db, UserStatus.on_hold, after_id=last_on_hold_id)
                if not on_hold_batch:
                    _last_on_hold_id = None
                else:
                    for user in on_hold_batch:
                        if user.edit_at:
                            base_time = datetime.timestamp(user.edit_at)
                        else:
                            base_time = datetime.timestamp(user.created_at)

                        effective_online = user.online_at

                        status = None
                        if effective_online and base_time <= datetime.timestamp(effective_online):
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
                        _last_on_hold_id = last_on_hold_id
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
