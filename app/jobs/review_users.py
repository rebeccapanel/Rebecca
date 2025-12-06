from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

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
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    with GetDB() as db:
        last_id: Optional[int] = None
        while True:
            active_batch = _batch_users_by_status(db, UserStatus.active, after_id=last_id)
            if not active_batch:
                break

            for user in active_batch:
                limited = user.data_limit and user.used_traffic >= user.data_limit
                expired = user.expire and user.expire <= now_ts

                if (limited or expired) and user.next_plan is not None:
                    if user.next_plan is not None:
                        if user.next_plan.fire_on_either:
                            reset_user_by_next_report(db, user)
                            continue

                        elif limited and expired:
                            reset_user_by_next_report(db, user)
                            continue

                if limited:
                    status = UserStatus.limited
                elif expired:
                    status = UserStatus.expired
                else:
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
                    logger.error(f"Failed to update status for user {user.id} ({user.username}) to {status}: {e}")
                    db.rollback()

            last_id = active_batch[-1].id

        last_id = None
        while True:
            on_hold_batch = _batch_users_by_status(db, UserStatus.on_hold, after_id=last_id)
            if not on_hold_batch:
                break

            for user in on_hold_batch:
                if user.edit_at:
                    base_time = datetime.timestamp(user.edit_at)
                else:
                    base_time = datetime.timestamp(user.created_at)

                # Check if the user is online After or at 'base_time'
                if user.online_at and base_time <= datetime.timestamp(user.online_at):
                    status = UserStatus.active

                elif user.on_hold_timeout and (datetime.timestamp(user.on_hold_timeout) <= (now_ts)):
                    # If the user didn't connect within the timeout period, change status to "Active"
                    status = UserStatus.active

                else:
                    continue

                update_user_status(db, user, status)
                start_user_expire(db, user)

                # Update user in xray when status changes from on_hold to active
                if status == UserStatus.active:
                    try:
                        xray.operations.add_user(user)
                    except Exception as e:
                        logger.warning(
                            f"Failed to add user {user.id} ({user.username}) to XRay: {e}. "
                            f"Status will still be updated to {status}."
                        )

                report.status_change(
                    username=user.username, status=status, user=UserResponse.model_validate(user), user_admin=user.admin
                )

                logger.info(f'User "{user.username}" status changed to {status}')

            last_id = on_hold_batch[-1].id


scheduler.add_job(
    review,
    "interval",
    seconds=JOB_REVIEW_USERS_INTERVAL,
    coalesce=True,
    max_instances=3,
    misfire_grace_time=JOB_REVIEW_USERS_INTERVAL,
    replace_existing=True,
)
