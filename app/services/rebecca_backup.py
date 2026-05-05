import base64
import json
import os
import shutil
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import Date, DateTime, LargeBinary, MetaData, Numeric, Time, delete, insert, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.sql.sqltypes import JSON as SAJSON

from app.db.base import engine as default_engine
from config import REBECCA_DATA_DIR, SQLALCHEMY_DATABASE_URL


BACKUP_FORMAT = "rebecca-backup"
BACKUP_VERSION = 1
BACKUP_EXTENSION = ".rbbackup"
BACKUP_MEDIA_TYPE = "application/vnd.rebecca.backup"
BACKUP_SCOPES = {"database", "full"}
MANIFEST_NAME = "manifest.json"
DATABASE_DUMP_NAME = "database.json"
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
                database_path = build_dir / DATABASE_DUMP_NAME
                manifest_path = build_dir / MANIFEST_NAME

                table_count, row_count = self._dump_database(database_path)
                manifest = {
                    "format": BACKUP_FORMAT,
                    "version": BACKUP_VERSION,
                    "scope": scope,
                    "created_at": _utc_now().isoformat(),
                    "database": {
                        "url_dialect": self.engine.url.get_backend_name(),
                        "source_url_dialect": self._database_url_dialect(),
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
                    archive.add(database_path, arcname=DATABASE_DUMP_NAME)
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

            database_dump_path = extract_dir / DATABASE_DUMP_NAME
            if not database_dump_path.is_file():
                raise RebeccaBackupError("Backup database payload is missing")

            warnings: list[str] = []
            tables_restored, rows_restored, db_warnings = self._restore_database(database_dump_path)
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

    def _restore_database(self, dump_path: Path) -> tuple[int, int, list[str]]:
        with dump_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self._validate_payload_header(payload, "database payload")

        metadata = MetaData()
        metadata.reflect(bind=self.engine)
        tables_by_name = {table.name: table for table in metadata.sorted_tables}
        dump_tables = payload.get("tables")
        if not isinstance(dump_tables, list):
            raise RebeccaBackupError("Backup database payload has an invalid table list")

        warnings: list[str] = []
        rows_restored = 0
        tables_restored = 0

        with self.engine.begin() as connection:
            self._disable_foreign_key_checks(connection)
            try:
                for table in reversed(metadata.sorted_tables):
                    connection.execute(delete(table))

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

    def _active_sqlite_paths(self) -> set[Path]:
        if self.engine.url.get_backend_name() != "sqlite":
            return set()
        database_path = self.engine.url.database
        if not database_path or database_path == ":memory:":
            return set()
        path = Path(database_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        resolved = path.resolve()
        return {
            resolved,
            Path(f"{resolved}-wal"),
            Path(f"{resolved}-shm"),
        }

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
