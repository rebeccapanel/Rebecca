from __future__ import annotations

import os
from logging.config import fileConfig

import sqlalchemy as sa
from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")

from app.db.base import Base
from config import SQLALCHEMY_DATABASE_URL

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config
config.set_main_option('sqlalchemy.url', SQLALCHEMY_DATABASE_URL)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.

_SAFE_OPS_INSTALLED = False


def _install_safe_ops() -> None:
    global _SAFE_OPS_INSTALLED
    if _SAFE_OPS_INSTALLED:
        return
    _SAFE_OPS_INSTALLED = True

    from alembic.operations import BatchOperations, Operations

    def _get_inspector(bind: sa.engine.Connection) -> sa.Inspector:
        return sa.inspect(bind)

    def _table_exists(
        bind: sa.engine.Connection, table_name: str, schema: str | None = None
    ) -> bool:
        inspector = _get_inspector(bind)
        try:
            return inspector.has_table(table_name, schema=schema)
        except Exception:
            try:
                return table_name in inspector.get_table_names(schema=schema)
            except Exception:
                return False

    def _normalize_table(table_name, schema: str | None = None) -> tuple[str, str | None]:
        if hasattr(table_name, "name"):
            table_obj = table_name
            resolved_schema = schema if schema is not None else getattr(table_obj, "schema", None)
            return table_obj.name, resolved_schema
        return table_name, schema

    def _column_exists(
        bind: sa.engine.Connection,
        table_name: str,
        column_name: str,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            columns = inspector.get_columns(table_name, schema=schema)
        except Exception:
            return False
        return any(column.get("name") == column_name for column in columns)

    def _index_exists(
        bind: sa.engine.Connection,
        table_name: str,
        index_name: str | None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not index_name or not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            indexes = inspector.get_indexes(table_name, schema=schema)
        except Exception:
            return False
        return any(index.get("name") == index_name for index in indexes)

    def _unique_constraint_exists(
        bind: sa.engine.Connection,
        table_name: str,
        constraint_name: str | None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not constraint_name or not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            constraints = inspector.get_unique_constraints(table_name, schema=schema)
        except Exception:
            return False
        return any(constraint.get("name") == constraint_name for constraint in constraints)

    def _check_constraint_exists(
        bind: sa.engine.Connection,
        table_name: str,
        constraint_name: str | None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not constraint_name or not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            constraints = inspector.get_check_constraints(table_name, schema=schema)
        except Exception:
            return False
        return any(constraint.get("name") == constraint_name for constraint in constraints)

    def _primary_key_exists(
        bind: sa.engine.Connection,
        table_name: str,
        constraint_name: str | None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not constraint_name or not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            constraint = inspector.get_pk_constraint(table_name, schema=schema)
        except Exception:
            return False
        return constraint.get("name") == constraint_name

    def _foreign_key_exists(
        bind: sa.engine.Connection,
        table_name: str,
        constraint_name: str | None,
        local_cols: list[str] | None = None,
        remote_cols: list[str] | None = None,
        referent_table: str | None = None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not _table_exists(bind, table_name, schema):
            return False
        inspector = _get_inspector(bind)
        try:
            fks = inspector.get_foreign_keys(table_name, schema=schema)
        except Exception:
            return False
        for fk in fks:
            if constraint_name and fk.get("name") == constraint_name:
                return True
            if (
                not constraint_name
                and referent_table
                and fk.get("referred_table") == referent_table
            ):
                if local_cols and set(fk.get("constrained_columns", [])) != set(
                    local_cols
                ):
                    continue
                if remote_cols and set(fk.get("referred_columns", [])) != set(
                    remote_cols
                ):
                    continue
                return True
        return False

    def _constraint_exists(
        bind: sa.engine.Connection,
        table_name: str,
        constraint_name: str | None,
        type_: str | None,
        schema: str | None = None,
    ) -> bool:
        table_name, schema = _normalize_table(table_name, schema)
        if not constraint_name:
            return False
        if type_ == "foreignkey":
            return _foreign_key_exists(bind, table_name, constraint_name, schema=schema)
        if type_ == "unique":
            return _unique_constraint_exists(bind, table_name, constraint_name, schema)
        if type_ == "check":
            return _check_constraint_exists(bind, table_name, constraint_name, schema)
        if type_ == "primary":
            return _primary_key_exists(bind, table_name, constraint_name, schema)
        return any(
            [
                _unique_constraint_exists(bind, table_name, constraint_name, schema),
                _check_constraint_exists(bind, table_name, constraint_name, schema),
                _primary_key_exists(bind, table_name, constraint_name, schema),
                _foreign_key_exists(bind, table_name, constraint_name, schema=schema),
            ]
        )

    _MYSQL_DUPLICATE_CODES = {1050, 1060, 1061, 1826}
    _MYSQL_MISSING_CODES = {1051, 1091, 1146}
    _POSTGRES_DUPLICATE_STATES = {"42701", "42710", "42P07"}
    _POSTGRES_MISSING_STATES = {"42703", "42704", "42P01"}
    _DUPLICATE_MESSAGE_MARKERS = (
        "already exists",
        "duplicate column name",
        "duplicate key name",
        "duplicate key",
        "relation already exists",
        "constraint already exists",
    )
    _MISSING_MESSAGE_MARKERS = (
        "no such column",
        "no such table",
        "unknown column",
        "unknown table",
        "can't drop",
        "does not exist",
        "doesn't exist",
        "undefined column",
        "undefined table",
    )

    def _extract_error_metadata(exc: Exception) -> tuple[int | str | None, str]:
        target = exc
        if isinstance(exc, sa.exc.DBAPIError) and exc.orig is not None:
            target = exc.orig
        message = str(target).lower()
        code: int | str | None = None
        args = getattr(target, "args", ())
        if args:
            first = args[0]
            if isinstance(first, int):
                code = first
            elif isinstance(first, str):
                code = first.strip() or None
        sql_state = getattr(target, "sqlstate", None) or getattr(target, "pgcode", None)
        if sql_state:
            code = str(sql_state)
        if isinstance(code, str):
            text = code.strip()
            if text.isdigit():
                code = int(text)
            else:
                code = text.upper()
        return code, message

    def _is_duplicate_error(exc: Exception) -> bool:
        code, message = _extract_error_metadata(exc)
        if isinstance(code, int) and code in _MYSQL_DUPLICATE_CODES:
            return True
        if isinstance(code, str) and code in _POSTGRES_DUPLICATE_STATES:
            return True
        return any(marker in message for marker in _DUPLICATE_MESSAGE_MARKERS)

    def _is_missing_error(exc: Exception) -> bool:
        code, message = _extract_error_metadata(exc)
        if isinstance(code, int) and code in _MYSQL_MISSING_CODES:
            return True
        if isinstance(code, str) and code in _POSTGRES_MISSING_STATES:
            return True
        return any(marker in message for marker in _MISSING_MESSAGE_MARKERS)

    def _should_ignore_db_error(exc: Exception, op_kind: str | None) -> bool:
        if op_kind == "create":
            return _is_duplicate_error(exc)
        if op_kind == "drop":
            return _is_missing_error(exc)
        return False

    def _run_ddl(
        fn,
        op_kind: str | None,
    ):
        try:
            return fn()
        except Exception as exc:
            if _should_ignore_db_error(exc, op_kind):
                return None
            raise

    def _classify_sql_statement(statement) -> str | None:
        if statement is None:
            return None
        sql_text = " ".join(str(statement).lower().split())
        if not sql_text:
            return None

        create_markers = (
            " add column ",
            " add constraint ",
            " add foreign key ",
            " create table ",
            " create index ",
            " create unique index ",
            " create unique ",
        )
        drop_markers = (
            " drop column ",
            " drop constraint ",
            " drop foreign key ",
            " drop table ",
            " drop index ",
        )

        if any(marker in sql_text for marker in create_markers):
            return "create"
        if any(marker in sql_text for marker in drop_markers):
            return "drop"
        return None

    _orig_add_column = Operations.add_column
    _orig_drop_column = Operations.drop_column
    _orig_create_table = Operations.create_table
    _orig_drop_table = Operations.drop_table
    _orig_create_index = Operations.create_index
    _orig_drop_index = Operations.drop_index
    _orig_create_foreign_key = Operations.create_foreign_key
    _orig_create_unique_constraint = getattr(Operations, "create_unique_constraint", None)
    _orig_drop_constraint = Operations.drop_constraint
    _orig_execute = getattr(Operations, "execute", None)

    def _safe_add_column(self, table_name, column, schema=None, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(
                lambda: _orig_add_column(self, table_name, column, schema=schema, **kw),
                "create",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if _column_exists(bind, table_name, column.name, schema):
            return None
        return _run_ddl(
            lambda: _orig_add_column(self, table_name, column, schema=schema, **kw),
            "create",
        )

    def _safe_drop_column(self, table_name, column_name, schema=None, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(
                lambda: _orig_drop_column(self, table_name, column_name, schema=schema, **kw),
                "drop",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if not _column_exists(bind, table_name, column_name, schema):
            return None
        return _run_ddl(
            lambda: _orig_drop_column(self, table_name, column_name, schema=schema, **kw),
            "drop",
        )

    def _safe_create_table(self, table_name, *columns, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None:
            return _run_ddl(
                lambda: _orig_create_table(self, table_name, *columns, **kw),
                "create",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if _table_exists(bind, table_name, schema):
            column_defs = [
                sa.column(col.name, type_=col.type)
                for col in columns
                if isinstance(col, sa.Column)
            ]
            return sa.table(table_name, *column_defs, schema=schema)
        return _run_ddl(
            lambda: _orig_create_table(self, table_name, *columns, **kw),
            "create",
        )

    def _safe_drop_table(self, table_name, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None:
            return _run_ddl(lambda: _orig_drop_table(self, table_name, **kw), "drop")
        table_name, schema = _normalize_table(table_name, schema)
        if not _table_exists(bind, table_name, schema):
            return None
        return _run_ddl(lambda: _orig_drop_table(self, table_name, **kw), "drop")

    def _safe_create_index(self, index_name, table_name, columns, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None:
            return _run_ddl(
                lambda: _orig_create_index(self, index_name, table_name, columns, **kw),
                "create",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if _index_exists(bind, table_name, index_name, schema):
            return None
        return _run_ddl(
            lambda: _orig_create_index(self, index_name, table_name, columns, **kw),
            "create",
        )

    def _safe_drop_index(self, index_name, table_name=None, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None:
            return _run_ddl(
                lambda: _orig_drop_index(self, index_name, table_name=table_name, **kw),
                "drop",
            )
        if table_name:
            table_name, schema = _normalize_table(table_name, schema)
        if table_name and not _index_exists(bind, table_name, index_name, schema):
            return None
        return _run_ddl(
            lambda: _orig_drop_index(self, index_name, table_name=table_name, **kw),
            "drop",
        )

    def _safe_create_foreign_key(
        self,
        constraint_name,
        source_table,
        referent_table,
        local_cols,
        remote_cols,
        **kw,
    ):
        bind = self.get_bind()
        schema = kw.get("source_schema")
        if bind is None:
            return _run_ddl(
                lambda: _orig_create_foreign_key(
                    self,
                    constraint_name,
                    source_table,
                    referent_table,
                    local_cols,
                    remote_cols,
                    **kw,
                ),
                "create",
            )
        source_table, schema = _normalize_table(source_table, schema)
        if _foreign_key_exists(
            bind,
            source_table,
            constraint_name,
            local_cols=local_cols,
            remote_cols=remote_cols,
            referent_table=referent_table,
            schema=schema,
        ):
            return None
        return _run_ddl(
            lambda: _orig_create_foreign_key(
                self,
                constraint_name,
                source_table,
                referent_table,
                local_cols,
                remote_cols,
                **kw,
            ),
            "create",
        )

    def _safe_create_unique_constraint(self, constraint_name, table_name, columns, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None or _orig_create_unique_constraint is None:
            if _orig_create_unique_constraint is None:
                return None
            return _run_ddl(
                lambda: _orig_create_unique_constraint(
                    self, constraint_name, table_name, columns, **kw
                ),
                "create",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if _unique_constraint_exists(bind, table_name, constraint_name, schema):
            return None
        return _run_ddl(
            lambda: _orig_create_unique_constraint(
                self, constraint_name, table_name, columns, **kw
            ),
            "create",
        )

    def _safe_drop_constraint(self, constraint_name, table_name, type_=None, **kw):
        bind = self.get_bind()
        schema = kw.get("schema")
        if bind is None:
            return _run_ddl(
                lambda: _orig_drop_constraint(
                    self, constraint_name, table_name, type_=type_, **kw
                ),
                "drop",
            )
        table_name, schema = _normalize_table(table_name, schema)
        if not _constraint_exists(bind, table_name, constraint_name, type_, schema):
            return None
        return _run_ddl(
            lambda: _orig_drop_constraint(
                self, constraint_name, table_name, type_=type_, **kw
            ),
            "drop",
        )

    def _safe_execute(self, sqltext, execution_options=None):
        if _orig_execute is None:
            return None
        op_kind = _classify_sql_statement(sqltext)
        return _run_ddl(
            lambda: _orig_execute(self, sqltext, execution_options=execution_options),
            op_kind,
        )

    Operations.add_column = _safe_add_column
    Operations.drop_column = _safe_drop_column
    Operations.create_table = _safe_create_table
    Operations.drop_table = _safe_drop_table
    Operations.create_index = _safe_create_index
    Operations.drop_index = _safe_drop_index
    Operations.create_foreign_key = _safe_create_foreign_key
    if _orig_create_unique_constraint is not None:
        Operations.create_unique_constraint = _safe_create_unique_constraint
    Operations.drop_constraint = _safe_drop_constraint
    if _orig_execute is not None:
        Operations.execute = _safe_execute

    _orig_batch_add_column = BatchOperations.add_column
    _orig_batch_drop_column = BatchOperations.drop_column
    _orig_batch_create_index = BatchOperations.create_index
    _orig_batch_drop_index = BatchOperations.drop_index
    _orig_batch_create_foreign_key = BatchOperations.create_foreign_key
    _orig_batch_create_unique_constraint = getattr(
        BatchOperations, "create_unique_constraint", None
    )
    _orig_batch_drop_constraint = BatchOperations.drop_constraint
    _orig_batch_execute = getattr(BatchOperations, "execute", None)

    def _batch_table_info(batch_op):
        return batch_op.impl.table_name, getattr(batch_op.impl, "schema", None)

    def _safe_batch_add_column(self, column, *args, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(lambda: _orig_batch_add_column(self, column, *args, **kw), "create")
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if _column_exists(bind, table_name, column.name, schema):
            return None
        return _run_ddl(lambda: _orig_batch_add_column(self, column, *args, **kw), "create")

    def _safe_batch_drop_column(self, column_name, *args, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(lambda: _orig_batch_drop_column(self, column_name, *args, **kw), "drop")
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if not _column_exists(bind, table_name, column_name, schema):
            return None
        return _run_ddl(lambda: _orig_batch_drop_column(self, column_name, *args, **kw), "drop")

    def _safe_batch_create_index(self, index_name, columns, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(lambda: _orig_batch_create_index(self, index_name, columns, **kw), "create")
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if _index_exists(bind, table_name, index_name, schema):
            return None
        return _run_ddl(lambda: _orig_batch_create_index(self, index_name, columns, **kw), "create")

    def _safe_batch_drop_index(self, index_name, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(lambda: _orig_batch_drop_index(self, index_name, **kw), "drop")
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if not _index_exists(bind, table_name, index_name, schema):
            return None
        return _run_ddl(lambda: _orig_batch_drop_index(self, index_name, **kw), "drop")

    def _safe_batch_create_foreign_key(
        self, constraint_name, referent_table, local_cols, remote_cols, **kw
    ):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(
                lambda: _orig_batch_create_foreign_key(
                    self, constraint_name, referent_table, local_cols, remote_cols, **kw
                ),
                "create",
            )
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if _foreign_key_exists(
            bind,
            table_name,
            constraint_name,
            local_cols=local_cols,
            remote_cols=remote_cols,
            referent_table=referent_table,
            schema=schema,
        ):
            return None
        return _run_ddl(
            lambda: _orig_batch_create_foreign_key(
                self, constraint_name, referent_table, local_cols, remote_cols, **kw
            ),
            "create",
        )

    def _safe_batch_create_unique_constraint(
        self, constraint_name, columns, **kw
    ):
        bind = self.get_bind()
        if bind is None or _orig_batch_create_unique_constraint is None:
            if _orig_batch_create_unique_constraint is None:
                return None
            return _run_ddl(
                lambda: _orig_batch_create_unique_constraint(
                    self, constraint_name, columns, **kw
                ),
                "create",
            )
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if _unique_constraint_exists(bind, table_name, constraint_name, schema):
            return None
        return _run_ddl(
            lambda: _orig_batch_create_unique_constraint(
                self, constraint_name, columns, **kw
            ),
            "create",
        )

    def _safe_batch_drop_constraint(self, constraint_name, type_=None, **kw):
        bind = self.get_bind()
        if bind is None:
            return _run_ddl(
                lambda: _orig_batch_drop_constraint(self, constraint_name, type_=type_, **kw),
                "drop",
            )
        table_name, schema = _normalize_table(*_batch_table_info(self))
        if not _constraint_exists(bind, table_name, constraint_name, type_, schema):
            return None
        return _run_ddl(
            lambda: _orig_batch_drop_constraint(self, constraint_name, type_=type_, **kw),
            "drop",
        )

    def _safe_batch_execute(self, sqltext, execution_options=None):
        if _orig_batch_execute is None:
            return None
        op_kind = _classify_sql_statement(sqltext)
        return _run_ddl(
            lambda: _orig_batch_execute(self, sqltext, execution_options=execution_options),
            op_kind,
        )

    BatchOperations.add_column = _safe_batch_add_column
    BatchOperations.drop_column = _safe_batch_drop_column
    BatchOperations.create_index = _safe_batch_create_index
    BatchOperations.drop_index = _safe_batch_drop_index
    BatchOperations.create_foreign_key = _safe_batch_create_foreign_key
    if _orig_batch_create_unique_constraint is not None:
        BatchOperations.create_unique_constraint = _safe_batch_create_unique_constraint
    BatchOperations.drop_constraint = _safe_batch_drop_constraint
    if _orig_batch_execute is not None:
        BatchOperations.execute = _safe_batch_execute


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        _install_safe_ops()
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            _install_safe_ops()
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
