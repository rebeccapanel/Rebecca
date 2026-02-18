from datetime import datetime, UTC

from app.runtime import logger, scheduler, xray
from app.db import crud, GetDB, get_users
from app.models.user import UserDataLimitResetStrategy, UserStatus

RESET_STRATEGY_TO_DAYS = {
    UserDataLimitResetStrategy.day.value: 1,
    UserDataLimitResetStrategy.week.value: 7,
    UserDataLimitResetStrategy.month.value: 30,
    UserDataLimitResetStrategy.year.value: 365,
}


def _strategy_value(strategy) -> str:
    return strategy.value if hasattr(strategy, "value") else str(strategy or "")


def _to_utc_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def reset_user_data_usage():
    now = datetime.now(UTC)
    with GetDB() as db:
        for user in get_users(
            db,
            status=[UserStatus.active, UserStatus.limited],
            reset_strategy=[
                UserDataLimitResetStrategy.day.value,
                UserDataLimitResetStrategy.week.value,
                UserDataLimitResetStrategy.month.value,
                UserDataLimitResetStrategy.year.value,
            ],
        ):
            try:
                strategy = _strategy_value(user.data_limit_reset_strategy)
                num_days_to_reset = RESET_STRATEGY_TO_DAYS.get(strategy)
                if not num_days_to_reset:
                    continue

                last_reset_time = _to_utc_aware(user.last_traffic_reset_time)
                if not last_reset_time:
                    continue

                elapsed_days = (now - last_reset_time).total_seconds() / 86400
                if elapsed_days < num_days_to_reset:
                    continue

                was_limited = user.status == UserStatus.limited
                updated_user = crud.reset_user_data_usage(db, user)

                # User was limited before reset and is now active => re-add to xray.
                if was_limited and updated_user.status == UserStatus.active:
                    xray.operations.add_user(updated_user)

                logger.info(f'User data usage reset for User "{updated_user.username}"')
            except Exception as exc:
                logger.warning(
                    f'Failed periodic usage reset for user "{getattr(user, "username", "?")}": {exc}',
                    exc_info=True,
                )


scheduler.add_job(reset_user_data_usage, "interval", coalesce=True, hours=1)
