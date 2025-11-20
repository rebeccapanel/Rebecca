import logging
from typing import Set

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError

from app.db.base import engine

logger = logging.getLogger("uvicorn.error")


def _get_columns(connection: Connection, table_name: str) -> Set[str]:
    inspector = inspect(connection)
    if not inspector.has_table(table_name):
        return set()
    columns = inspector.get_columns(table_name)
    return {column["name"].lower() for column in columns}


def ensure_users_credential_key_column() -> None:
    """
    Ensure the users table contains the credential_key column.

    Some installations might skip Alembic migrations; rather than crashing,
    attempt to add the missing column automatically so the application can start.
    """
    try:
        with engine.connect() as connection:
            columns = _get_columns(connection, "users")
    except SQLAlchemyError as exc:
        logger.warning("Unable to inspect 'users' table for credential_key column: %s", exc)
        return
    except Exception as exc:  # pragma: no cover - safety net
        logger.warning("Unexpected error inspecting 'users' table: %s", exc)
        return

    if "credential_key" in columns:
        return

    try:
        with engine.begin() as connection:
            logger.info("Adding missing 'credential_key' column to 'users' table")
            connection.execute(
                text("ALTER TABLE users ADD COLUMN credential_key VARCHAR(64)")
            )
    except SQLAlchemyError as exc:
        # If the column was created concurrently or database disallows ALTER, log and continue.
        logger.error("Failed to add 'credential_key' column automatically: %s", exc)
    except Exception as exc:  # pragma: no cover - safety net
        logger.error("Unexpected error while adding 'credential_key' column: %s", exc)


def ensure_core_schema() -> None:
    ensure_users_credential_key_column()
