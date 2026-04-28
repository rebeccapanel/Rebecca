"""Common constants and helper functions for CRUD operations."""

import logging

import sqlalchemy as sa


_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"
ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY = "admin_time_limit_exhausted"
MASTER_NODE_NAME = "Master"
_USER_STATUS_ENUM_ENSURED = False


def _is_record_changed_error(exc) -> bool:
    """Check if error is a record changed error."""
    orig = getattr(exc, "orig", None)
    if not orig:
        return False
    try:
        err_code = orig.args[0]
    except (AttributeError, IndexError):
        return False
    return err_code == _RECORD_CHANGED_ERRNO


def _ensure_user_deleted_status(db) -> bool:
    """Ensure the underlying user status enum (if any) supports the 'deleted' value."""
    global _USER_STATUS_ENUM_ENSURED
    if _USER_STATUS_ENUM_ENSURED:
        return True
    bind = db.get_bind()
    if bind is None:
        return False
    engine = getattr(bind, "engine", bind)
    dialect = engine.dialect.name
    try:
        inspector = sa.inspect(engine)
        columns = inspector.get_columns("users")
    except Exception:
        return False
    status_column = next((col for col in columns if col.get("name") == "status"), None)
    if not status_column:
        return False
    enum_type = status_column.get("type")
    enum_values = getattr(enum_type, "enums", None)
    if enum_values and "deleted" in enum_values:
        _USER_STATUS_ENUM_ENSURED = True
        return True
    try:
        if dialect == "mysql":
            with engine.begin() as conn:
                conn.exec_driver_sql(
                    "ALTER TABLE users MODIFY COLUMN status "
                    "ENUM('active','disabled','limited','expired','on_hold','deleted') NOT NULL"
                )
        elif dialect == "postgresql":
            with engine.begin() as conn:
                conn.exec_driver_sql("ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'deleted'")
        else:
            return False
    except Exception:
        return False
    _USER_STATUS_ENUM_ENSURED = True
    return True
