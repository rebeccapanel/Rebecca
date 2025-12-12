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


def _is_connection_pool_error(e: Exception) -> bool:
    """Check if exception is a connection pool timeout error."""
    if isinstance(e, SQLTimeoutError):
        return True
    if isinstance(e, OperationalError):
        error_msg = str(e).lower()
        if "queuepool" in error_msg or "connection timed out" in error_msg or "timeout" in error_msg:
            return True
    return False


def safe_execute(db: Session, stmt, params=None, max_retries: int = 3):
    """
    Safely execute a database statement with retry logic for deadlocks and connection pool errors.

    If deadlock or connection pool errors occur after max retries, the exception is raised.
    This allows callers to handle the error appropriately (e.g., keep data in Redis).
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
                is_deadlock = _is_deadlock_error(err)
                is_pool_error = _is_connection_pool_error(err)

                if (is_deadlock or is_pool_error) and tries < max_retries - 1:
                    db.rollback()
                    tries += 1
                    error_type = "deadlock" if is_deadlock else "connection pool"
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.warning(f"{error_type} detected in safe_execute, retrying ({tries}/{max_retries})...")
                    time.sleep(0.1 * tries)
                    continue
                raise err

    else:
        tries = 0
        done = False
        while not done and tries < max_retries:
            try:
                db.connection().execute(stmt, params)
                db.commit()
                done = True
            except (OperationalError, SQLTimeoutError) as err:
                is_pool_error = _is_connection_pool_error(err)

                if is_pool_error and tries < max_retries - 1:
                    db.rollback()
                    tries += 1
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.warning(
                        f"Connection pool error detected in safe_execute, retrying ({tries}/{max_retries})..."
                    )
                    time.sleep(0.1 * tries)
                    continue
                raise err


# endregion
