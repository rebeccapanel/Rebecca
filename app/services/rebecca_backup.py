import base64
import json
import os
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import Date, DateTime, LargeBinary, MetaData, Numeric, Time, func, insert, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.sql.sqltypes import JSON as SAJSON

from app.db.base import Base, engine as default_engine
from config import REBECCA_DATA_DIR, SQLALCHEMY_DATABASE_URL


BACKUP_FORMAT = "rebecca-backup"
BACKUP_VERSION = 1
BACKUP_EXTENSION = ".rbbackup"
BACKUP_MEDIA_TYPE = "application/vnd.rebecca.backup"
BACKUP_SCOPES = {"database", "full"}
MANIFEST_NAME = "manifest.json"
DATABASE_DUMP_NAME = "database.json"
DATABASE_SQLITE_NAME = "database.sqlite3"
DATABASE_SQL_NAME = "database.sql"
FILES_PREFIX = "files"


class RebeccaBackupError(ValueError):
    pass


@dataclass(frozen=True)
class BackupFileRoot:
    archive_name: str
    path: Path


@dataclass(frozen=True)
class BackupExportResult:
    path: Path
    filename: str
    scope: str


@dataclass(frozen=True)
class BackupImportResult:
    scope: str
    tables_restored: int
    rows_restored: int
    files_restored: list[str]
    warnings: list[str]


@dataclass(frozen=True)
class DatabaseExportPayload:
    archive_name: str
    payload_type: str


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"__rebecca_type__": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__rebecca_type__": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"__rebecca_type__": "time", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__rebecca_type__": "decimal", "value": str(value)}
    if isinstance(value, bytes):
        return {"__rebecca_type__": "bytes", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, Enum):
        return value.value
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _decode_marker(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    if set(value.keys()) != {"__rebecca_type__", "value"}:
        return value

    marker = value["__rebecca_type__"]
    raw_value = value["value"]
    if marker == "datetime":
        return datetime.fromisoformat(raw_value)
    if marker == "date":
        return date.fromisoformat(raw_value)
    if marker == "time":
        return time.fromisoformat(raw_value)
    if marker == "decimal":
        return Decimal(str(raw_value))
    if marker == "bytes":
        return base64.b64decode(raw_value.encode("ascii"))
    return value


def _decode_value_for_column(column, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(column.type, SAJSON):
        return value
    decoded = _decode_marker(value)
    if isinstance(column.type, DateTime) and isinstance(decoded, str):
        return datetime.fromisoformat(decoded)
    if isinstance(column.type, Date) and isinstance(decoded, str):
        return date.fromisoformat(decoded)
    if isinstance(column.type, Time) and isinstance(decoded, str):
        return time.fromisoformat(decoded)
    if isinstance(column.type, Numeric) and isinstance(decoded, str):
        return Decimal(decoded)
    if isinstance(column.type, LargeBinary) and isinstance(decoded, str):
        return base64.b64decode(decoded.encode("ascii"))
    return decoded


def _sanitize_filename_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value).strip("-") or "backup"


def _default_file_roots() -> list[BackupFileRoot]:
    return [
        BackupFileRoot("etc_rebecca", Path(os.getenv("REBECCA_CONFIG_DIR", "/etc/rebecca")).expanduser()),
        BackupFileRoot("var_lib_rebecca", REBECCA_DATA_DIR.expanduser()),
    ]


def _safe_unlink(path: str | Path) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


class RebeccaBackupService:
    def __init__(
        self,
        *,
        db_engine: Engine | None = None,
        file_roots: Iterable[BackupFileRoot] | None = None,
    ):
        self.engine = db_engine or default_engine
        self.file_roots = list(file_roots or _default_file_roots())

    def export_backup(self, scope: str) -> BackupExportResult:
        scope = self._validate_scope(scope)
        timestamp = _utc_now().strftime("%Y%m%d-%H%M%S")
        filename = f"rebecca-{scope}-{timestamp}{BACKUP_EXTENSION}"

        handle = tempfile.NamedTemporaryFile(prefix="rebecca-backup-", suffix=BACKUP_EXTENSION, delete=False)
        output_path = Path(handle.name)
        handle.close()

        try:
            with tempfile.TemporaryDirectory(prefix="rebecca-backup-build-") as build_dir_name:
                build_dir = Path(build_dir_name)
                manifest_path = build_dir / MANIFEST_NAME

                database_payload = self._export_database_payload(build_dir)
                table_count, row_count = self._database_counts()
                manifest = {
                    "format": BACKUP_FORMAT,
                    "version": BACKUP_VERSION,
                    "scope": scope,
                    "created_at": _utc_now().isoformat(),
                    "database": {
                        "url_dialect": self.engine.url.get_backend_name(),
                        "source_url_dialect": self._database_url_dialect(),
                        "payload": database_payload.archive_name,
                        "payload_type": database_payload.payload_type,
                        "tables": table_count,
                        "rows": row_count,
                    },
                    "paths": [
                        {"archive_name": root.archive_name, "path": str(root.path)}
                        for root in self.file_roots
                        if scope == "full" and root.path.exists()
                    ],
                }
                manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

                sqlite_skip_paths = self._active_sqlite_paths()
                with tarfile.open(output_path, "w:gz") as archive:
                    archive.add(manifest_path, arcname=MANIFEST_NAME)
                    archive.add(build_dir / database_payload.archive_name, arcname=database_payload.archive_name)
                    if scope == "full":
                        for root in self.file_roots:
                            if root.path.exists():
                                archive.add(
                                    root.path,
                                    arcname=f"{FILES_PREFIX}/{root.archive_name}",
                                    filter=lambda tarinfo, backup_root=root: self._archive_file_filter(
                                        tarinfo,
                                        root=backup_root,
                                        skip_paths=sqlite_skip_paths,
                                    ),
                                )
            return BackupExportResult(path=output_path, filename=filename, scope=scope)
        except Exception:
            _safe_unlink(output_path)
            raise

    def import_backup(self, archive_path: str | Path, scope: str) -> BackupImportResult:
        scope = self._validate_scope(scope)
        archive_path = Path(archive_path)
        if not archive_path.is_file():
            raise RebeccaBackupError("Backup file not found")

        with tempfile.TemporaryDirectory(prefix="rebecca-backup-import-") as extract_dir_name:
            extract_dir = Path(extract_dir_name)
            with tarfile.open(archive_path, "r:gz") as archive:
                self._safe_extract(archive, extract_dir)

            manifest = self._load_manifest(extract_dir / MANIFEST_NAME)
            backup_scope = manifest.get("scope")
            if scope == "full" and backup_scope != "full":
                raise RebeccaBackupError("Selected full restore, but the uploaded backup is database-only")

            warnings: list[str] = []
            tables_restored, rows_restored, db_warnings = self._restore_database_payload(extract_dir, manifest)
            warnings.extend(db_warnings)

            files_restored: list[str] = []
            if scope == "full":
                restored, file_warnings = self._restore_file_roots(extract_dir / FILES_PREFIX)
                files_restored.extend(restored)
                warnings.extend(file_warnings)

            return BackupImportResult(
                scope=scope,
                tables_restored=tables_restored,
                rows_restored=rows_restored,
                files_restored=files_restored,
                warnings=warnings,
            )

    def _export_database_payload(self, build_dir: Path) -> DatabaseExportPayload:
        dialect = self.engine.url.get_backend_name()
        if dialect == "sqlite":
            self._export_sqlite_database(build_dir / DATABASE_SQLITE_NAME)
            return DatabaseExportPayload(archive_name=DATABASE_SQLITE_NAME, payload_type="sqlite-file")
        if dialect in {"mysql", "mariadb"}:
            self._export_mysql_database(build_dir / DATABASE_SQL_NAME)
            return DatabaseExportPayload(archive_name=DATABASE_SQL_NAME, payload_type="mysql-dump")
        raise RebeccaBackupError(f"Unsupported database backend for Rebecca backup: {dialect}")

    def _restore_database_payload(self, extract_dir: Path, manifest: dict[str, Any]) -> tuple[int, int, list[str]]:
        database_info = manifest.get("database") if isinstance(manifest.get("database"), dict) else {}
        payload_name = database_info.get("payload")
        payload_type = database_info.get("payload_type")

        if payload_name:
            payload_path = extract_dir / str(payload_name)
            if not payload_path.is_file():
                raise RebeccaBackupError("Backup database payload is missing")
            if payload_type == "sqlite-file":
                self._restore_sqlite_database(payload_path)
            elif payload_type == "mysql-dump":
                self._restore_mysql_database(payload_path)
            else:
                raise RebeccaBackupError("Backup database payload type is not supported")
            tables_restored, rows_restored = self._database_counts()
            return tables_restored, rows_restored, []

        legacy_dump_path = extract_dir / DATABASE_DUMP_NAME
        if not legacy_dump_path.is_file():
            raise RebeccaBackupError("Backup database payload is missing")
        tables_restored, rows_restored, warnings = self._restore_legacy_database(legacy_dump_path)
        warnings.append("Restored a legacy JSON database payload; create a fresh backup to use hard database replacement.")
        return tables_restored, rows_restored, warnings

    def _export_sqlite_database(self, output_path: Path) -> None:
        source_path = self._sqlite_database_path()
        if source_path is None:
            raise RebeccaBackupError("SQLite database file path is not available")
        source_path.parent.mkdir(parents=True, exist_ok=True)
        if not source_path.exists():
            sqlite3.connect(source_path).close()

        source = sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)
        destination = sqlite3.connect(output_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()

    def _restore_sqlite_database(self, payload_path: Path) -> None:
        target_path = self._sqlite_database_path()
        if target_path is None:
            raise RebeccaBackupError("This backup contains a SQLite database, but the current installation is not using SQLite")

        self.engine.dispose()
        target_path.parent.mkdir(parents=True, exist_ok=True)
        temp_target = target_path.with_name(f".{target_path.name}.restore-{os.getpid()}.tmp")
        shutil.copy2(payload_path, temp_target)
        try:
            os.replace(temp_target, target_path)
        except PermissionError:
            _safe_unlink(temp_target)
            self._overwrite_sqlite_database(payload_path, target_path)
        for sidecar in (Path(f"{target_path}-wal"), Path(f"{target_path}-shm")):
            _safe_unlink(sidecar)
        self.engine.dispose()

    def _overwrite_sqlite_database(self, payload_path: Path, target_path: Path) -> None:
        source = sqlite3.connect(f"file:{payload_path.as_posix()}?mode=ro", uri=True)
        target = sqlite3.connect(target_path)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()

    def _export_mysql_database(self, output_path: Path) -> None:
        dump_command = self._find_executable(["mariadb-dump", "mysqldump"])
        database_name = self._mysql_database_name()
        with tempfile.TemporaryDirectory(prefix="rebecca-mysql-dump-") as temp_dir_name:
            defaults_file = self._write_mysql_defaults_file(Path(temp_dir_name))
            command = [
                dump_command,
                f"--defaults-extra-file={defaults_file}",
                "--single-transaction",
                "--quick",
                "--routines",
                "--triggers",
                "--events",
                "--hex-blob",
                "--add-drop-database",
                "--default-character-set=utf8mb4",
                "--databases",
                database_name,
            ]
            try:
                with output_path.open("wb") as handle:
                    subprocess.run(command, stdout=handle, stderr=subprocess.PIPE, check=True)
            except subprocess.CalledProcessError as exc:
                message = exc.stderr.decode("utf-8", errors="replace").strip()
                raise RebeccaBackupError(f"Failed to dump MySQL/MariaDB database: {message}") from exc

    def _restore_mysql_database(self, payload_path: Path) -> None:
        mysql_command = self._find_executable(["mariadb", "mysql"])
        database_name = self._mysql_database_name()
        self.engine.dispose()
        with tempfile.TemporaryDirectory(prefix="rebecca-mysql-restore-") as temp_dir_name:
            defaults_file = self._write_mysql_defaults_file(Path(temp_dir_name))
            drop_command = [
                mysql_command,
                f"--defaults-extra-file={defaults_file}",
                "-e",
                f"DROP DATABASE IF EXISTS {self._quote_mysql_identifier(database_name)}",
            ]
            try:
                subprocess.run(drop_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                with payload_path.open("rb") as handle:
                    subprocess.run(
                        [mysql_command, f"--defaults-extra-file={defaults_file}"],
                        stdin=handle,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        check=True,
                    )
            except subprocess.CalledProcessError as exc:
                message = exc.stderr.decode("utf-8", errors="replace").strip()
                raise RebeccaBackupError(f"Failed to restore MySQL/MariaDB database: {message}") from exc
            finally:
                self.engine.dispose()

    def _database_counts(self) -> tuple[int, int]:
        metadata = MetaData()
        metadata.reflect(bind=self.engine)
        tables = list(metadata.sorted_tables)
        rows = 0
        with self.engine.connect() as connection:
            for table in tables:
                rows += int(connection.execute(select(func.count()).select_from(table)).scalar_one() or 0)
        return len(tables), rows

    def _dump_database(self, output_path: Path) -> tuple[int, int]:
        metadata = MetaData()
        metadata.reflect(bind=self.engine)
        tables = list(metadata.sorted_tables)
        total_rows = 0

        with self.engine.connect() as connection, output_path.open("w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "format": BACKUP_FORMAT,
                        "version": BACKUP_VERSION,
                        "dumped_at": _utc_now().isoformat(),
                    },
                    default=_json_default,
                )[:-1]
            )
            handle.write(',"tables":[')
            first_table = True
            for table in tables:
                if not first_table:
                    handle.write(",")
                first_table = False
                handle.write(
                    json.dumps(
                        {
                            "name": table.name,
                            "columns": [column.name for column in table.columns],
                        },
                        default=_json_default,
                    )[:-1]
                )
                handle.write(',"rows":[')
                first_row = True
                for row in connection.execute(select(table)).mappings():
                    if not first_row:
                        handle.write(",")
                    first_row = False
                    total_rows += 1
                    handle.write(json.dumps(dict(row), default=_json_default, separators=(",", ":")))
                handle.write("]}")
            handle.write("]}")
        return len(tables), total_rows

    def _restore_legacy_database(self, dump_path: Path) -> tuple[int, int, list[str]]:
        with dump_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self._validate_payload_header(payload, "database payload")

        dump_tables = payload.get("tables")
        if not isinstance(dump_tables, list):
            raise RebeccaBackupError("Backup database payload has an invalid table list")

        warnings: list[str] = []
        rows_restored = 0
        tables_restored = 0

        self.engine.dispose()
        with self.engine.begin() as connection:
            self._disable_foreign_key_checks(connection)
            try:
                existing_metadata = MetaData()
                existing_metadata.reflect(bind=connection)
                existing_metadata.drop_all(bind=connection)
                Base.metadata.create_all(bind=connection)
                restored_metadata = MetaData()
                restored_metadata.reflect(bind=connection)
                tables_by_name = {table.name: table for table in restored_metadata.sorted_tables}

                for table_payload in dump_tables:
                    table_name = table_payload.get("name")
                    if table_name not in tables_by_name:
                        warnings.append(f"Skipped unknown table: {table_name}")
                        continue
                    table = tables_by_name[table_name]
                    rows = table_payload.get("rows", [])
                    if not rows:
                        tables_restored += 1
                        continue
                    column_map = {column.name: column for column in table.columns}
                    table_rows = []
                    for raw_row in rows:
                        row = {
                            name: _decode_value_for_column(column_map[name], value)
                            for name, value in raw_row.items()
                            if name in column_map
                        }
                        table_rows.append(row)
                    for batch_start in range(0, len(table_rows), 500):
                        batch = table_rows[batch_start : batch_start + 500]
                        if batch:
                            connection.execute(insert(table), batch)
                    rows_restored += len(table_rows)
                    tables_restored += 1
            finally:
                self._enable_foreign_key_checks(connection)
        self.engine.dispose()

        return tables_restored, rows_restored, warnings

    def _restore_file_roots(self, files_dir: Path) -> tuple[list[str], list[str]]:
        restored: list[str] = []
        warnings: list[str] = []
        if not files_dir.exists():
            return restored, ["Backup does not contain file payloads"]

        sqlite_skip_paths = self._active_sqlite_paths()
        for root in self.file_roots:
            source = files_dir / root.archive_name
            if not source.exists():
                warnings.append(f"Backup does not contain {root.archive_name}")
                continue
            self._replace_directory_contents(source, root.path, skip_paths=sqlite_skip_paths)
            restored.append(str(root.path))
        return restored, warnings

    def _replace_directory_contents(self, source: Path, target: Path, *, skip_paths: set[Path]) -> None:
        target = target.expanduser()
        target.mkdir(parents=True, exist_ok=True)
        resolved_target = target.resolve()
        allowed_targets = {root.path.expanduser().resolve() for root in self.file_roots}
        if resolved_target not in allowed_targets:
            raise RebeccaBackupError(f"Refusing to restore outside Rebecca paths: {target}")

        for child in list(target.iterdir()):
            resolved_child = child.resolve()
            if resolved_child in skip_paths:
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)

        for child in source.iterdir():
            destination = target / child.name
            if destination.resolve() in skip_paths:
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.copytree(child, destination, copy_function=shutil.copy2)
            else:
                shutil.copy2(child, destination)

    def _safe_extract(self, archive: tarfile.TarFile, destination: Path) -> None:
        resolved_destination = destination.resolve()
        for member in archive.getmembers():
            target = (destination / member.name).resolve()
            if os.path.commonpath([str(resolved_destination), str(target)]) != str(resolved_destination):
                raise RebeccaBackupError("Backup archive contains unsafe paths")
            if member.issym() or member.islnk() or member.isdev():
                raise RebeccaBackupError("Backup archive contains unsupported linked or device entries")
        try:
            archive.extractall(destination, filter="data")
        except TypeError:
            archive.extractall(destination)

    def _archive_file_filter(
        self,
        tarinfo: tarfile.TarInfo,
        *,
        root: BackupFileRoot | None = None,
        skip_paths: set[Path] | None = None,
    ) -> tarfile.TarInfo | None:
        if tarinfo.issym() or tarinfo.islnk() or tarinfo.isdev():
            return None
        if root is not None and skip_paths:
            try:
                relative = Path(tarinfo.name).relative_to(Path(FILES_PREFIX) / root.archive_name)
            except ValueError:
                relative = None
            if relative is not None and str(relative) not in {"", "."}:
                source_path = (root.path / relative).expanduser().resolve()
                if source_path in skip_paths:
                    return None
        tarinfo.uid = 0
        tarinfo.gid = 0
        tarinfo.uname = ""
        tarinfo.gname = ""
        return tarinfo

    def _load_manifest(self, manifest_path: Path) -> dict[str, Any]:
        if not manifest_path.is_file():
            raise RebeccaBackupError("Backup manifest is missing")
        with manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        self._validate_payload_header(manifest, "backup manifest")
        return manifest

    def _validate_payload_header(self, payload: dict[str, Any], label: str) -> None:
        if payload.get("format") != BACKUP_FORMAT:
            raise RebeccaBackupError(f"Invalid {label} format")
        if payload.get("version") != BACKUP_VERSION:
            raise RebeccaBackupError(f"Unsupported {label} version")

    def _disable_foreign_key_checks(self, connection) -> None:
        dialect = connection.dialect.name
        if dialect == "sqlite":
            connection.execute(text("PRAGMA foreign_keys=OFF"))
        elif dialect in {"mysql", "mariadb"}:
            connection.execute(text("SET FOREIGN_KEY_CHECKS=0"))

    def _enable_foreign_key_checks(self, connection) -> None:
        dialect = connection.dialect.name
        if dialect == "sqlite":
            connection.execute(text("PRAGMA foreign_keys=ON"))
        elif dialect in {"mysql", "mariadb"}:
            connection.execute(text("SET FOREIGN_KEY_CHECKS=1"))

    def _sqlite_database_path(self) -> Path | None:
        if self.engine.url.get_backend_name() != "sqlite":
            return None
        database_path = self.engine.url.database
        if not database_path or database_path == ":memory:":
            return None
        path = Path(database_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        return path.resolve()

    def _active_sqlite_paths(self) -> set[Path]:
        resolved = self._sqlite_database_path()
        if resolved is None:
            return set()
        return {
            resolved,
            Path(f"{resolved}-wal"),
            Path(f"{resolved}-shm"),
        }

    def _mysql_database_name(self) -> str:
        database_name = self.engine.url.database
        if not database_name:
            raise RebeccaBackupError("MySQL/MariaDB database name is not available")
        return database_name

    def _write_mysql_defaults_file(self, directory: Path) -> Path:
        url = self.engine.url
        lines = ["[client]"]
        if url.username:
            lines.append(f"user={url.username}")
        if url.password:
            lines.append(f"password={url.password}")
        if url.host:
            lines.append(f"host={url.host}")
            if not (url.query.get("unix_socket") or url.query.get("socket")):
                lines.append("protocol=tcp")
        if url.port:
            lines.append(f"port={url.port}")
        socket_path = url.query.get("unix_socket") or url.query.get("socket")
        if socket_path:
            lines.append(f"socket={socket_path}")
        path = directory / "mysql-client.cnf"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        path.chmod(0o600)
        return path

    def _find_executable(self, candidates: list[str]) -> str:
        for candidate in candidates:
            executable = shutil.which(candidate)
            if executable:
                return executable
        raise RebeccaBackupError(f"Required database tool is not installed: {' or '.join(candidates)}")

    def _quote_mysql_identifier(self, value: str) -> str:
        return f"`{value.replace('`', '``')}`"

    def _database_url_dialect(self) -> str:
        return SQLALCHEMY_DATABASE_URL.split(":", 1)[0] if ":" in SQLALCHEMY_DATABASE_URL else "unknown"

    def _validate_scope(self, scope: str) -> str:
        if scope not in BACKUP_SCOPES:
            raise RebeccaBackupError("Backup scope must be database or full")
        return scope


__all__ = [
    "BACKUP_EXTENSION",
    "BACKUP_MEDIA_TYPE",
    "BackupExportResult",
    "BackupFileRoot",
    "BackupImportResult",
    "RebeccaBackupError",
    "RebeccaBackupService",
    "_safe_unlink",
]
