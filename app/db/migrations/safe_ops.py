from __future__ import annotations

from typing import Iterable, Mapping

import sqlalchemy as sa
from alembic import op


def get_bind():
    """Return current Alembic connection."""
    return op.get_bind()


def inspector():
    return sa.inspect(get_bind())


def is_sqlite() -> bool:
    return get_bind().engine.dialect.name == "sqlite"


def table_exists(table_name: str) -> bool:
    return table_name in inspector().get_table_names()


def column_exists(table_name: str, column_name: str) -> bool:
    return column_name in {col["name"] for col in inspector().get_columns(table_name)}


def index_exists(table_name: str, index_name: str) -> bool:
    return any(index["name"] == index_name for index in inspector().get_indexes(table_name))


def load_table(table_name: str) -> sa.Table:
    metadata = sa.MetaData()
    return sa.Table(table_name, metadata, autoload_with=get_bind())


def row_exists(table_name: str, filters: Mapping[str, object] | None = None) -> bool:
    filters = filters or {}
    table = load_table(table_name)
    stmt = sa.select(sa.func.count()).select_from(table)
    for column_name, value in filters.items():
        stmt = stmt.where(getattr(table.c, column_name) == value)
    return bool(get_bind().scalar(stmt))


def ensure_bulk_insert(table: sa.Table, rows: Iterable[Mapping[str, object]]) -> None:
    existing = row_exists(table.name)
    if existing:
        return
    op.bulk_insert(table, rows)
