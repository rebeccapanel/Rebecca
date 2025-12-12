from datetime import datetime, UTC

from pymysql.err import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import Insert


"""Shared helpers for usage recording jobs (time bucketing and DB-safe execution)."""

# region Time helpers


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def hour_bucket(timestamp: datetime | None = None) -> datetime:
    current = timestamp or utcnow_naive()
    return current.replace(minute=0, second=0, microsecond=0)


# endregion

# region DB execution helpers


def safe_execute(db: Session, stmt, params=None):
    if db.bind.name == "mysql":
        if isinstance(stmt, Insert):
            stmt = stmt.prefix_with("IGNORE")

        tries = 0
        done = False
        while not done:
            try:
                db.connection().execute(stmt, params)
                db.commit()
                done = True
            except OperationalError as err:
                if err.args[0] == 1213 and tries < 3:
                    db.rollback()
                    tries += 1
                    continue
                raise err

    else:
        db.connection().execute(stmt, params)
        db.commit()


# endregion
