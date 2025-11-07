from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.runtime import logger, scheduler, xray
from app.db import (
    GetDB,
    get_users,
    start_user_expire,
    update_user_status,
    reset_user_by_next,
)
from app.models.user import UserResponse, UserStatus
from app.utils import report
from config import JOB_REVIEW_USERS_INTERVAL

if TYPE_CHECKING:
    from app.db.models import User


def reset_user_by_next_report(db: Session, user: "User"):
    user = reset_user_by_next(db, user)

    xray.operations.update_user(user)

    report.user_data_reset_by_next(user=UserResponse.model_validate(user), user_admin=user.admin)


def review():
    now = datetime.utcnow()
    now_ts = now.timestamp()
    with GetDB() as db:
        for user in get_users(db, status=UserStatus.active):

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

            xray.operations.remove_user(user)
            update_user_status(db, user, status)

            report.status_change(username=user.username, status=status,
                                 user=UserResponse.model_validate(user), user_admin=user.admin)

            logger.info(f"User \"{user.username}\" status changed to {status}")

        for user in get_users(db, status=UserStatus.on_hold):

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

            report.status_change(username=user.username, status=status,
                                 user=UserResponse.model_validate(user), user_admin=user.admin)

            logger.info(f"User \"{user.username}\" status changed to {status}")


scheduler.add_job(review, 'interval',
                  seconds=JOB_REVIEW_USERS_INTERVAL,
                  coalesce=True, max_instances=1)

