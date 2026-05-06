import io
from pathlib import Path
import tarfile

import pytest
from fastapi import UploadFile
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

import app.db.models as db_models
from app.models.settings import RebeccaBackupScope
from app.routers import settings as settings_router
from app.db.base import Base
from app.models.admin import AdminRole
from app.services.rebecca_backup import (
    BACKUP_EXTENSION,
    BackupFileRoot,
    BackupExportResult,
    BackupImportResult,
    RebeccaBackupError,
    RebeccaBackupService,
    _safe_unlink,
)


def _build_sqlite_service(tmp_path: Path, roots=None) -> tuple[RebeccaBackupService, object]:
    db_path = tmp_path / "rebecca.sqlite"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return RebeccaBackupService(db_engine=engine, file_roots=roots or []), engine


def _create_admin(engine, username: str) -> None:
    with Session(engine) as session:
        session.add(
            db_models.Admin(
                username=username,
                hashed_password="hashed",
                role=AdminRole.full_access,
                permissions={"users": {"create": True}},
            )
        )
        session.commit()


def _admin_usernames(engine) -> list[str]:
    with Session(engine) as session:
        return list(session.scalars(select(db_models.Admin.username)).all())


def _table_names(engine) -> set[str]:
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).all()
    return {row[0] for row in rows}


def test_database_backup_round_trips_rebecca_tables(tmp_path):
    service, engine = _build_sqlite_service(tmp_path)
    _create_admin(engine, "backup_owner")

    export = service.export_backup("database")
    try:
        assert export.path.suffix == BACKUP_EXTENSION
        assert "backup_owner" in _admin_usernames(engine)

        with Session(engine) as session:
            session.query(db_models.Admin).delete()
            session.commit()
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE restore_should_drop (id INTEGER PRIMARY KEY, value TEXT)"))
            connection.execute(text("INSERT INTO restore_should_drop (value) VALUES ('stale')"))
        assert _admin_usernames(engine) == []
        assert "restore_should_drop" in _table_names(engine)

        result = service.import_backup(export.path, "database")
        assert result.tables_restored > 0
        assert result.rows_restored > 0
        assert "backup_owner" in _admin_usernames(engine)
        assert "restore_should_drop" not in _table_names(engine)
    finally:
        _safe_unlink(export.path)


def test_full_backup_restores_rebecca_file_roots_and_database(tmp_path):
    etc_root = tmp_path / "etc" / "rebecca"
    data_root = tmp_path / "var" / "lib" / "rebecca"
    etc_root.mkdir(parents=True)
    data_root.mkdir(parents=True)
    (etc_root / "panel.env").write_text("TOKEN=original\n", encoding="utf-8")
    (data_root / "xray_config.json").write_text('{"log":{}}\n', encoding="utf-8")

    roots = [
        BackupFileRoot("etc_rebecca", etc_root),
        BackupFileRoot("var_lib_rebecca", data_root),
    ]
    service, engine = _build_sqlite_service(tmp_path, roots=roots)
    _create_admin(engine, "full_owner")

    export = service.export_backup("full")
    try:
        (etc_root / "panel.env").write_text("TOKEN=changed\n", encoding="utf-8")
        (etc_root / "stale.env").write_text("REMOVE=1\n", encoding="utf-8")
        (data_root / "xray_config.json").unlink()
        _create_admin(engine, "new_after_backup")

        result = service.import_backup(export.path, "full")

        assert "full_owner" in _admin_usernames(engine)
        assert "new_after_backup" not in _admin_usernames(engine)
        assert (etc_root / "panel.env").read_text(encoding="utf-8") == "TOKEN=original\n"
        assert not (etc_root / "stale.env").exists()
        assert (data_root / "xray_config.json").read_text(encoding="utf-8") == '{"log":{}}\n'
        assert str(etc_root) in result.files_restored
        assert str(data_root) in result.files_restored
    finally:
        _safe_unlink(export.path)


def test_full_backup_excludes_active_sqlite_files_from_file_payload(tmp_path):
    data_root = tmp_path / "var" / "lib" / "rebecca"
    data_root.mkdir(parents=True)
    db_path = data_root / "db.sqlite3"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    (data_root / "db.sqlite3-wal").write_text("wal placeholder", encoding="utf-8")
    (data_root / "db.sqlite3-shm").write_text("shm placeholder", encoding="utf-8")
    (data_root / "xray_config.json").write_text('{"log":{}}\n', encoding="utf-8")

    service = RebeccaBackupService(
        db_engine=engine,
        file_roots=[BackupFileRoot("var_lib_rebecca", data_root)],
    )

    export = service.export_backup("full")
    try:
        with tarfile.open(export.path, "r:gz") as archive:
            names = set(archive.getnames())

        assert "database.sqlite3" in names
        assert "files/var_lib_rebecca/xray_config.json" in names
        assert "files/var_lib_rebecca/db.sqlite3" not in names
        assert "files/var_lib_rebecca/db.sqlite3-wal" not in names
        assert "files/var_lib_rebecca/db.sqlite3-shm" not in names
    finally:
        _safe_unlink(export.path)


def test_full_restore_rejects_database_only_backup(tmp_path):
    service, engine = _build_sqlite_service(tmp_path)
    _create_admin(engine, "database_only_owner")

    export = service.export_backup("database")
    try:
        with pytest.raises(RebeccaBackupError, match="database-only"):
            service.import_backup(export.path, "full")
    finally:
        _safe_unlink(export.path)


def test_rebecca_backup_api_exports_and_imports_database(auth_client, tmp_path, monkeypatch):
    monkeypatch.setenv("REBECCA_INSTALL_MODE", "binary")
    fake_export_path = tmp_path / "fake-api.rbbackup"
    fake_export_path.write_bytes(b"\x1f\x8bRebecca API backup payload")

    class FakeBackupService:
        def export_backup(self, scope):
            return BackupExportResult(path=fake_export_path, filename=f"fake-{scope}.rbbackup", scope=scope)

        def import_backup(self, archive_path, scope):
            assert Path(archive_path).is_file()
            return BackupImportResult(
                scope=scope,
                tables_restored=1,
                rows_restored=1,
                files_restored=[],
                warnings=[],
            )

    monkeypatch.setattr("app.routers.settings.RebeccaBackupService", FakeBackupService)

    response = auth_client.get("/api/settings/backup/export?scope=database")
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"\x1f\x8b")

    assert settings_router.RebeccaBackupService is FakeBackupService
    upload = UploadFile(file=io.BytesIO(response.content), filename="api-database.rbbackup")
    import_response = settings_router.import_rebecca_backup(
        scope=RebeccaBackupScope.database,
        file=upload,
        _=object(),
    )

    assert import_response.scope == RebeccaBackupScope.database
    assert import_response.tables_restored > 0
    assert import_response.rows_restored > 0


def test_rebecca_backup_api_is_disabled_in_docker_mode(auth_client, monkeypatch):
    monkeypatch.setenv("REBECCA_INSTALL_MODE", "docker")

    response = auth_client.get("/api/settings/backup/export?scope=database")

    assert response.status_code == 409
    assert "binary installations" in response.json()["detail"]
