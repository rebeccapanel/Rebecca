from datetime import datetime, UTC
import time

from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import Insert
from sqlalchemy.exc import OperationalError, TimeoutError as SQLTimeoutError


"""Shared helpers for usage recording jobs (time bucketing and DB-safe execution)."""

# region Time helpers


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def hour_bucket(timestamp: datetime | None = None) -> datetime:
    current = timestamp or utcnow_naive()
    return current.replace(minute=0, second=0, microsecond=0)


# endregion

# region DB execution helpers


def _is_deadlock_error(e: Exception) -> bool:
    """Check if exception is a deadlock error."""
    error_code = _mysql_error_code(e)
    if error_code == 1213:
        return True
    if isinstance(e, OperationalError):
        orig_error = e.orig if hasattr(e, "orig") else None
        if orig_error:
            error_code = (
                getattr(orig_error, "args", [None])[0] if hasattr(orig_error, "args") and orig_error.args else None
            )
            if error_code == 1213:  # MySQL deadlock
                return True
    elif isinstance(e, PyMySQLOperationalError):
        if e.args[0] == 1213:  # MySQL deadlock
            return True
    return False


def _mysql_error_code(e: Exception) -> int | None:
    """Return a MySQL/PyMySQL numeric error code when one is available."""
    candidates = [e]
    if isinstance(e, OperationalError) and hasattr(e, "orig"):
        candidates.append(e.orig)

    for candidate in candidates:
        args = getattr(candidate, "args", None)
        if args:
            try:
                return int(args[0])
            except (TypeError, ValueError):
                continue
    return None


def _is_lock_wait_timeout_error(e: Exception) -> bool:
    error_code = _mysql_error_code(e)
    if error_code == 1205:
        return True
    return "lock wait timeout" in str(e).lower()


def _is_connection_pool_error(e: Exception) -> bool:
    """Check if exception is a connection pool timeout error."""
    if isinstance(e, SQLTimeoutError):
        return True
    if isinstance(e, OperationalError):
        error_msg = str(e).lower()
        if "queuepool" in error_msg or "connection timed out" in error_msg or "timeout" in error_msg:
            return True
    return False


def _is_connection_lost_error(e: Exception) -> bool:
    error_code = _mysql_error_code(e)
    if error_code in (2006, 2013):
        return True
    error_msg = str(e).lower()
    return "server has gone away" in error_msg or "lost connection" in error_msg


def is_retryable_db_error(e: Exception) -> bool:
    if (
        _is_deadlock_error(e)
        or _is_lock_wait_timeout_error(e)
        or _is_connection_pool_error(e)
        or _is_connection_lost_error(e)
    ):
        return True
    if isinstance(e, (OperationalError, PyMySQLOperationalError)):
        error_msg = str(e).lower()
        return "database is locked" in error_msg or "database table is locked" in error_msg
    return False


def retry_delay(tries: int) -> None:
    time.sleep(min(0.25 * max(tries, 1), 2.0))


def safe_execute(db: Session, stmt, params=None, max_retries: int = 3):
    """
    Safely execute a database statement with retry logic for deadlocks and connection pool errors.

    If deadlock or connection pool errors occur after max retries, the exception is raised.
    """
    if db.bind.name == "mysql":
        if isinstance(stmt, Insert):
            stmt = stmt.prefix_with("IGNORE")

        tries = 0
        done = False
        while not done and tries < max_retries:
            try:
                db.connection().execute(stmt, params)
                db.commit()
                done = True
            except (OperationalError, PyMySQLOperationalError, SQLTimeoutError) as err:
                retryable = is_retryable_db_error(err)

                if retryable and tries < max_retries - 1:
                    db.rollback()
                    tries += 1
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.warning(f"Retryable database error in safe_execute, retrying ({tries}/{max_retries})...")
                    retry_delay(tries)
                    continue
                raise err

    else:
        tries = 0
        done = False
        if db.bind.name == "sqlite":
            max_retries = max(max_retries, 8)
        while not done and tries < max_retries:
            try:
                db.connection().execute(stmt, params)
                db.commit()
                done = True
            except (OperationalError, SQLTimeoutError) as err:
                retryable = is_retryable_db_error(err)

                if retryable and tries < max_retries - 1:
                    db.rollback()
                    tries += 1
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.warning(f"Retryable database error in safe_execute, retrying ({tries}/{max_retries})...")
                    retry_delay(tries)
                    continue
                raise err


# endregion
