from __future__ import annotations

import shutil
import sqlite3
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.db import crud
from app.db import models as db_models
from app.db.base import SessionLocal
from app.models.proxy import ProxyTypes
from app.models.settings import (
    ThreeXUiDuplicateSubadressExistingMode,
    ThreeXUiDuplicateSubadressGroup,
    ThreeXUiDuplicateSubadressSourceMode,
    ThreeXUiImportAdminOption,
    ThreeXUiImportJobResponse,
    ThreeXUiImportJobResult,
    ThreeXUiImportJobStatus,
    ThreeXUiImportRequest,
    ThreeXUiImportServiceOption,
    ThreeXUiInboundImportConfig,
    ThreeXUiInboundPreview,
    ThreeXUiPreviewResponse,
    ThreeXUiSubadressOccurrence,
    ThreeXUiUsernameConflictItem,
    ThreeXUiUsernameConflictMode,
)
from app.models.user import UserDataLimitResetStrategy, UserStatus
from app.runtime import xray
from app.services.data_access import get_inbounds_by_tag_cached
from app.utils.credentials import normalize_flow_value, uuid_to_key
from scripts.migrate_3xui_to_rebecca import (
    MAX_USERNAME_LEN,
    NOTE_MAX_LEN,
    USERNAME_ALLOWED_CHARS,
    _build_deterministic_key,
    _clean_text,
    _coerce_bool,
    _coerce_int,
    _convert_expire_to_seconds,
    _extract_proxy_settings,
    _load_traffic_rows,
    _parse_json,
    _resolve_status,
    _safe_datetime_from_ms,
)

SUPPORTED_PROTOCOLS: dict[str, ProxyTypes] = {
    "vmess": ProxyTypes.VMess,
    "vless": ProxyTypes.VLESS,
    "trojan": ProxyTypes.Trojan,
}
PREVIEW_TTL = timedelta(hours=6)
IMPORT_TMP_DIR = Path(tempfile.gettempdir()) / "rebecca-3xui-imports"
_LOCK = threading.RLock()
_PREVIEWS: dict[str, "_PreviewRecord"] = {}
_JOBS: dict[str, "_JobState"] = {}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _sanitize_username(value: str) -> str:
    candidate = USERNAME_ALLOWED_CHARS.sub("_", _clean_text(value))
    candidate = __import__("re").sub(r"_+", "_", candidate).strip("._-@")
    if not candidate:
        candidate = "user"
    if len(candidate) > MAX_USERNAME_LEN:
        candidate = candidate[:MAX_USERNAME_LEN].rstrip("._-@")
    while len(candidate) < 3:
        candidate += "x"
    return candidate


def _build_note(comment: str, email: str, inbound_remark: str) -> Optional[str]:
    parts = [
        part
        for part in [comment.strip(), f"Imported from 3x-ui ({email or 'no-email'})", inbound_remark]
        if part
    ]
    if not parts:
        return None
    return " | ".join(parts)[:NOTE_MAX_LEN]


def _preferred_username(client: "_ParsedClient") -> str:
    if client.email:
        return client.email
    if client.subadress:
        return client.subadress
    if client.comment:
        return client.comment
    return f"{client.protocol.value}-{client.inbound_id}"


def _normalize_key(value: Optional[str]) -> str:
    return _clean_text(value).lower()


def _unique_username(preferred: str, reserved: set[str]) -> str:
    base = _sanitize_username(preferred)
    candidate = base
    counter = 2
    while candidate.lower() in reserved:
        suffix = f"-{counter}"
        allowed_len = max(MAX_USERNAME_LEN - len(suffix), 1)
        trimmed = base[:allowed_len].rstrip("._-@") or "user"
        candidate = f"{trimmed}{suffix}"
        counter += 1
    reserved.add(candidate.lower())
    return candidate


def _safe_delete(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


@dataclass
class _ParsedClient:
    inbound_id: int
    inbound_remark: str
    inbound_enabled: bool
    protocol: ProxyTypes
    inbound_order: int
    client_order: int
    email: str
    enable: bool
    subadress: str
    comment: str
    limit_ip: int
    total_bytes: Optional[int]
    expire_seconds: Optional[int]
    used_traffic: int
    flow: Optional[str]
    credential_key: str
    proxy_settings: dict[str, Any]
    created_at: Optional[datetime]
    telegram_id: Optional[str]
    preferred_username: str = ""
    normalized_username: str = ""
    normalized_subadress: str = ""
    normalized_credential_key: str = ""


@dataclass
class _InboundScan:
    inbound_id: int
    remark: str
    protocol: ProxyTypes
    source_tag: Optional[str]
    source_port: Optional[int]
    network: Optional[str]
    security: Optional[str]
    raw_client_count: int
    order: int
    importable_clients: list[_ParsedClient] = field(default_factory=list)


@dataclass
class _ParsedDatabase:
    source_inbounds: int
    source_clients: int
    supported_inbounds: int
    importable_clients: list[_ParsedClient]
    inbounds: list[_InboundScan]
    skipped_unsupported: int
    skipped_invalid: int


@dataclass
class _PreviewRecord:
    preview_id: str
    file_path: Path
    preview: ThreeXUiPreviewResponse
    created_at: datetime


@dataclass
class _JobState:
    job_id: str
    preview_id: str
    status: ThreeXUiImportJobStatus
    progress_current: int
    progress_total: int
    message: Optional[str]
    result: Optional[ThreeXUiImportJobResult]
    created_at: datetime
    updated_at: datetime


class ThreeXUiImportService:
    @classmethod
    def _cleanup_locked(cls) -> None:
        cutoff = _now() - PREVIEW_TTL
        expired_preview_ids = [preview_id for preview_id, record in _PREVIEWS.items() if record.created_at < cutoff]
        for preview_id in expired_preview_ids:
            record = _PREVIEWS.pop(preview_id, None)
            if record:
                _safe_delete(record.file_path)

        expired_job_ids = [
            job_id
            for job_id, job in _JOBS.items()
            if job.updated_at < cutoff and job.status in (ThreeXUiImportJobStatus.completed, ThreeXUiImportJobStatus.failed)
        ]
        for job_id in expired_job_ids:
            _JOBS.pop(job_id, None)

    @classmethod
    def _save_upload(cls, upload: UploadFile, preview_id: str) -> Path:
        filename = upload.filename or ""
        suffix = Path(filename).suffix.lower()
        if suffix not in {".db", ".sqlite", ".sqlite3"}:
            raise HTTPException(status_code=400, detail="Upload a SQLite database file.")

        IMPORT_TMP_DIR.mkdir(parents=True, exist_ok=True)
        target = IMPORT_TMP_DIR / f"{preview_id}.db"
        with target.open("wb") as handle:
            shutil.copyfileobj(upload.file, handle)
        return target

    @classmethod
    def _parse_database(cls, source_path: Path) -> _ParsedDatabase:
        if not source_path.exists():
            raise FileNotFoundError(f"3x-ui database not found: {source_path}")

        connection = sqlite3.connect(str(source_path))
        connection.row_factory = sqlite3.Row
        try:
            traffic_by_email = _load_traffic_rows(connection)
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(inbounds)").fetchall()
                if isinstance(row["name"], str)
            }
            select_columns = ["id", "enable", "remark", "protocol", "settings"]
            for optional_column in ("port", "tag", "stream_settings"):
                if optional_column in columns:
                    select_columns.append(optional_column)
                else:
                    select_columns.append(f"NULL AS {optional_column}")
            rows = connection.execute(f"SELECT {', '.join(select_columns)} FROM inbounds").fetchall()
            source_inbounds = len(rows)
            source_clients = 0
            skipped_unsupported = 0
            skipped_invalid = 0
            importable_clients: list[_ParsedClient] = []
            inbounds: list[_InboundScan] = []
            inbound_order = 0

            for row in rows:
                inbound_settings = _parse_json(row["settings"])
                raw_clients = inbound_settings.get("clients")
                if not isinstance(raw_clients, list):
                    continue

                raw_client_count = len(raw_clients)
                source_clients += raw_client_count

                protocol_name = _clean_text(row["protocol"]).lower()
                protocol = SUPPORTED_PROTOCOLS.get(protocol_name)
                if protocol is None:
                    skipped_unsupported += raw_client_count
                    continue

                inbound_order += 1
                inbound_id = _coerce_int(row["id"], 0)
                inbound_remark = _clean_text(row["remark"]) or f"Inbound #{inbound_id}"
                inbound_enabled = _coerce_bool(row["enable"])
                stream_settings = _parse_json(row["stream_settings"])
                source_port_raw = _coerce_int(row["port"], 0)
                inbound_scan = _InboundScan(
                    inbound_id=inbound_id,
                    remark=inbound_remark,
                    protocol=protocol,
                    source_tag=_clean_text(row["tag"]) or None,
                    source_port=source_port_raw if source_port_raw > 0 else None,
                    network=_clean_text(stream_settings.get("network")) or None,
                    security=_clean_text(stream_settings.get("security")) or None,
                    raw_client_count=raw_client_count,
                    order=inbound_order,
                )

                for client_order, raw_client in enumerate(raw_clients, start=1):
                    if not isinstance(raw_client, dict):
                        skipped_invalid += 1
                        continue

                    proxy_settings, error = _extract_proxy_settings(protocol, raw_client, inbound_settings)
                    if error:
                        skipped_unsupported += 1
                        continue

                    email = _clean_text(raw_client.get("email"))
                    subadress = _clean_text(raw_client.get("subId"))

                    if protocol in {ProxyTypes.VMess, ProxyTypes.VLESS}:
                        credential_key = uuid_to_key(proxy_settings["id"], protocol)
                    else:
                        credential_key = _build_deterministic_key(
                            protocol,
                            email,
                            subadress,
                            inbound_id,
                        )

                    traffic_row = traffic_by_email.get(email.lower(), {}) if email else {}
                    up = _coerce_int(traffic_row.get("up"), 0)
                    down = _coerce_int(traffic_row.get("down"), 0)
                    used_traffic = max(up + down, 0)

                    total_bytes_raw = _coerce_int(raw_client.get("totalGB"), 0)
                    total_bytes = total_bytes_raw if total_bytes_raw > 0 else None
                    expire_seconds = _convert_expire_to_seconds(raw_client.get("expiryTime"))
                    flow = normalize_flow_value(raw_client.get("flow"))
                    created_at = _safe_datetime_from_ms(raw_client.get("created_at")) or _safe_datetime_from_ms(
                        raw_client.get("updated_at")
                    )
                    telegram_id = _coerce_int(raw_client.get("tgId"), 0)

                    parsed = _ParsedClient(
                        inbound_id=inbound_id,
                        inbound_remark=inbound_remark,
                        inbound_enabled=inbound_enabled,
                        protocol=protocol,
                        inbound_order=inbound_order,
                        client_order=client_order,
                        email=email,
                        enable=_coerce_bool(raw_client.get("enable")),
                        subadress=subadress,
                        comment=_clean_text(raw_client.get("comment")),
                        limit_ip=max(_coerce_int(raw_client.get("limitIp"), 0), 0),
                        total_bytes=total_bytes,
                        expire_seconds=expire_seconds,
                        used_traffic=used_traffic,
                        flow=flow,
                        credential_key=credential_key,
                        proxy_settings=proxy_settings,
                        created_at=created_at,
                        telegram_id=str(telegram_id) if telegram_id > 0 else None,
                    )
                    parsed.preferred_username = _sanitize_username(_preferred_username(parsed))
                    parsed.normalized_username = parsed.preferred_username.lower()
                    parsed.normalized_subadress = _normalize_key(parsed.subadress)
                    parsed.normalized_credential_key = _normalize_key(parsed.credential_key)
                    inbound_scan.importable_clients.append(parsed)
                    importable_clients.append(parsed)

                inbounds.append(inbound_scan)

            return _ParsedDatabase(
                source_inbounds=source_inbounds,
                source_clients=source_clients,
                supported_inbounds=len(inbounds),
                importable_clients=importable_clients,
                inbounds=inbounds,
                skipped_unsupported=skipped_unsupported,
                skipped_invalid=skipped_invalid,
            )
        finally:
            connection.close()

    @classmethod
    def _existing_users_by_username(
        cls, db: Session, usernames: Iterable[str]
    ) -> dict[str, db_models.User]:
        values = sorted({value for value in usernames if value})
        if not values:
            return {}
        rows = (
            db.query(db_models.User)
            .filter(db_models.User.status != UserStatus.deleted)
            .filter(func.lower(db_models.User.username).in_(values))
            .all()
        )
        return {row.username.lower(): row for row in rows if row.username}

    @classmethod
    def _existing_users_by_subadress(
        cls, db: Session, subaddresses: Iterable[str]
    ) -> dict[str, list[db_models.User]]:
        values = sorted({value for value in subaddresses if value})
        if not values:
            return {}
        rows = (
            db.query(db_models.User)
            .filter(db_models.User.status != UserStatus.deleted)
            .filter(db_models.User.subadress != "")
            .filter(func.lower(db_models.User.subadress).in_(values))
            .all()
        )
        grouped: dict[str, list[db_models.User]] = {}
        for row in rows:
            grouped.setdefault(row.subadress.lower(), []).append(row)
        return grouped

    @classmethod
    def _existing_users_by_credential_key(
        cls, db: Session, credential_keys: Iterable[str]
    ) -> dict[str, list[db_models.User]]:
        values = sorted({value for value in credential_keys if value})
        if not values:
            return {}
        rows = (
            db.query(db_models.User)
            .filter(db_models.User.status != UserStatus.deleted)
            .filter(db_models.User.credential_key.isnot(None))
            .filter(func.lower(db_models.User.credential_key).in_(values))
            .all()
        )
        grouped: dict[str, list[db_models.User]] = {}
        for row in rows:
            key = _normalize_key(row.credential_key)
            if key:
                grouped.setdefault(key, []).append(row)
        return grouped

    @classmethod
    def _load_admin_options(cls, db: Session) -> list[ThreeXUiImportAdminOption]:
        rows = crud.get_admins(db).get("admins", [])
        return [ThreeXUiImportAdminOption(id=admin.id, username=admin.username) for admin in rows if admin.id is not None]

    @classmethod
    def _load_service_options(cls, db: Session) -> list[ThreeXUiImportServiceOption]:
        services = (
            db.query(db_models.Service)
            .options(
                joinedload(db_models.Service.admin_links),
                joinedload(db_models.Service.host_links).joinedload(db_models.ServiceHostLink.host),
            )
            .order_by(db_models.Service.name.asc())
            .all()
        )
        try:
            inbounds_by_tag = get_inbounds_by_tag_cached(db)
        except Exception:
            inbounds_by_tag = {}

        service_options: list[ThreeXUiImportServiceOption] = []
        for service in services:
            protocols: set[str] = set()
            for link in service.host_links:
                host = getattr(link, "host", None)
                if not host or not host.inbound_tag:
                    continue
                protocol = (inbounds_by_tag.get(host.inbound_tag) or {}).get("protocol")
                if protocol:
                    protocols.add(str(protocol))
            service_options.append(
                ThreeXUiImportServiceOption(
                    id=service.id,
                    name=service.name,
                    admin_ids=[link.admin_id for link in service.admin_links],
                    supported_protocols=sorted(protocols),
                )
            )
        return service_options

    @classmethod
    def _build_preview(cls, preview_id: str, parsed: _ParsedDatabase, db: Session) -> ThreeXUiPreviewResponse:
        existing_by_username = cls._existing_users_by_username(
            db, (client.normalized_username for client in parsed.importable_clients)
        )
        existing_by_subadress = cls._existing_users_by_subadress(
            db, (client.normalized_subadress for client in parsed.importable_clients)
        )

        inbound_previews: list[ThreeXUiInboundPreview] = []
        for inbound in parsed.inbounds:
            by_username: dict[str, list[_ParsedClient]] = {}
            for client in inbound.importable_clients:
                by_username.setdefault(client.normalized_username, []).append(client)

            conflicts: list[ThreeXUiUsernameConflictItem] = []
            for normalized_username, clients in sorted(by_username.items()):
                existing_user = existing_by_username.get(normalized_username)
                if len(clients) <= 1 and existing_user is None:
                    continue
                display_username = clients[0].preferred_username
                conflicts.append(
                    ThreeXUiUsernameConflictItem(
                        username=display_username,
                        source_count=len(clients),
                        existing_usernames=[existing_user.username] if existing_user else [],
                    )
                )

            inbound_previews.append(
                ThreeXUiInboundPreview(
                    inbound_id=inbound.inbound_id,
                    remark=inbound.remark,
                    protocol=inbound.protocol.value,
                    source_tag=inbound.source_tag,
                    source_port=inbound.source_port,
                    network=inbound.network,
                    security=inbound.security,
                    raw_client_count=inbound.raw_client_count,
                    importable_client_count=len(inbound.importable_clients),
                    username_conflicts=conflicts,
                )
            )

        by_subadress: dict[str, list[_ParsedClient]] = {}
        for client in parsed.importable_clients:
            if client.normalized_subadress:
                by_subadress.setdefault(client.normalized_subadress, []).append(client)

        duplicate_subaddresses: list[ThreeXUiDuplicateSubadressGroup] = []
        for normalized_subadress, clients in sorted(by_subadress.items()):
            existing_users = existing_by_subadress.get(normalized_subadress, [])
            if len(clients) <= 1 and not existing_users:
                continue

            duplicate_subaddresses.append(
                ThreeXUiDuplicateSubadressGroup(
                    subadress=clients[0].subadress,
                    source_count=len(clients),
                    occurrences=[
                        ThreeXUiSubadressOccurrence(
                            inbound_id=client.inbound_id,
                            inbound_remark=client.inbound_remark,
                            protocol=client.protocol.value,
                            username=client.preferred_username,
                            email=client.email or None,
                        )
                        for client in clients
                    ],
                    existing_users=[
                        {"id": existing_user.id, "username": existing_user.username}
                        for existing_user in existing_users
                        if existing_user.id is not None
                    ],
                )
            )

        return ThreeXUiPreviewResponse(
            preview_id=preview_id,
            source_inbounds=parsed.source_inbounds,
            supported_inbounds=parsed.supported_inbounds,
            source_clients=parsed.source_clients,
            importable_clients=len(parsed.importable_clients),
            skipped_unsupported=parsed.skipped_unsupported,
            skipped_invalid=parsed.skipped_invalid,
            inbounds=inbound_previews,
            duplicate_subaddresses=duplicate_subaddresses,
            admins=cls._load_admin_options(db),
            services=cls._load_service_options(db),
        )

    @classmethod
    def create_preview(cls, upload: UploadFile, db: Session) -> ThreeXUiPreviewResponse:
        preview_id = uuid.uuid4().hex
        with _LOCK:
            cls._cleanup_locked()
        file_path = cls._save_upload(upload, preview_id)
        try:
            parsed = cls._parse_database(file_path)
            preview = cls._build_preview(preview_id, parsed, db)
        except Exception as exc:
            _safe_delete(file_path)
            if isinstance(exc, HTTPException):
                raise
            raise HTTPException(status_code=400, detail=f"Failed to parse 3x-ui database: {exc}")

        with _LOCK:
            _PREVIEWS[preview_id] = _PreviewRecord(
                preview_id=preview_id,
                file_path=file_path,
                preview=preview,
                created_at=_now(),
            )
        return preview

    @classmethod
    def _get_preview_record(cls, preview_id: str) -> _PreviewRecord:
        with _LOCK:
            cls._cleanup_locked()
            record = _PREVIEWS.get(preview_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Preview not found or expired")
        return record

    @classmethod
    def _validate_import_request(
        cls,
        payload: ThreeXUiImportRequest,
        preview: ThreeXUiPreviewResponse,
        db: Session,
    ) -> None:
        expected_inbound_ids = {inbound.inbound_id for inbound in preview.inbounds}
        provided_inbound_ids = {item.inbound_id for item in payload.inbounds}
        if expected_inbound_ids != provided_inbound_ids:
            raise HTTPException(status_code=400, detail="Import config must include every detected inbound exactly once")

        enabled_items = [item for item in payload.inbounds if item.import_enabled]
        missing_admin_config = next((item for item in enabled_items if item.admin_id is None), None)
        if missing_admin_config is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Admin is required for inbound {missing_admin_config.inbound_id}",
            )

        admins = {
            admin.id: admin
            for admin in (
                db.query(db_models.Admin)
                .filter(db_models.Admin.id.in_([item.admin_id for item in enabled_items if item.admin_id is not None]))
                .all()
            )
            if admin.id is not None
        }
        missing_admins = sorted({item.admin_id for item in enabled_items if item.admin_id not in admins})
        if missing_admins:
            raise HTTPException(status_code=404, detail=f"Admin not found: {missing_admins[0]}")

        service_ids = [item.service_id for item in enabled_items if item.service_id is not None]
        services = {}
        if service_ids:
            rows = (
                db.query(db_models.Service)
                .options(joinedload(db_models.Service.admin_links))
                .filter(db_models.Service.id.in_(service_ids))
                .all()
            )
            services = {service.id: service for service in rows if service.id is not None}
            missing_services = sorted({service_id for service_id in service_ids if service_id not in services})
            if missing_services:
                raise HTTPException(status_code=404, detail=f"Service not found: {missing_services[0]}")

        for item in enabled_items:
            if item.service_id is None:
                continue
            service = services[item.service_id]
            if item.admin_id not in service.admin_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Selected admin is not linked to the selected service",
                )

    @classmethod
    def start_import(cls, payload: ThreeXUiImportRequest) -> ThreeXUiImportJobResponse:
        preview_record = cls._get_preview_record(payload.preview_id)
        with SessionLocal() as db:
            cls._validate_import_request(payload, preview_record.preview, db)

        job_id = uuid.uuid4().hex
        state = _JobState(
            job_id=job_id,
            preview_id=payload.preview_id,
            status=ThreeXUiImportJobStatus.pending,
            progress_current=0,
            progress_total=preview_record.preview.importable_clients,
            message="Import queued",
            result=None,
            created_at=_now(),
            updated_at=_now(),
        )
        with _LOCK:
            _JOBS[job_id] = state
        return cls.get_job(job_id)

    @classmethod
    def run_import_job(cls, job_id: str, payload: ThreeXUiImportRequest) -> None:
        preview_record = cls._get_preview_record(payload.preview_id)
        cls._update_job(
            job_id,
            status=ThreeXUiImportJobStatus.running,
            message="Import started",
        )

        with SessionLocal() as db:
            try:
                parsed = cls._parse_database(preview_record.file_path)
                result = cls._perform_import(db, parsed, payload, job_id)
            except Exception as exc:
                db.rollback()
                cls._update_job(
                    job_id,
                    status=ThreeXUiImportJobStatus.failed,
                    message=str(exc),
                )
                return

        cls._update_job(
            job_id,
            status=ThreeXUiImportJobStatus.completed,
            message="Import completed",
            progress_current=result.processed_clients,
            progress_total=result.total_clients,
            result=result,
        )

    @classmethod
    def _update_job(
        cls,
        job_id: str,
        *,
        status: Optional[ThreeXUiImportJobStatus] = None,
        message: Optional[str] = None,
        progress_current: Optional[int] = None,
        progress_total: Optional[int] = None,
        result: Optional[ThreeXUiImportJobResult] = None,
    ) -> None:
        with _LOCK:
            job = _JOBS.get(job_id)
            if not job:
                return
            if status is not None:
                job.status = status
            if message is not None:
                job.message = message
            if progress_current is not None:
                job.progress_current = progress_current
            if progress_total is not None:
                job.progress_total = progress_total
            if result is not None:
                job.result = result
            job.updated_at = _now()

    @classmethod
    def get_job(cls, job_id: str) -> ThreeXUiImportJobResponse:
        with _LOCK:
            cls._cleanup_locked()
            state = _JOBS.get(job_id)
            if state is None:
                raise HTTPException(status_code=404, detail="Import job not found")
            return ThreeXUiImportJobResponse(
                job_id=state.job_id,
                preview_id=state.preview_id,
                status=state.status,
                progress_current=state.progress_current,
                progress_total=state.progress_total,
                message=state.message,
                result=state.result,
                created_at=state.created_at,
                updated_at=state.updated_at,
            )

    @classmethod
    def _remove_list_mapping(
        cls,
        mapping: dict[str, list[db_models.User]],
        key: Optional[str],
        user_id: Optional[int],
    ) -> None:
        normalized = _normalize_key(key)
        if not normalized or user_id is None:
            return
        remaining = [user for user in mapping.get(normalized, []) if user.id != user_id]
        if remaining:
            mapping[normalized] = remaining
        else:
            mapping.pop(normalized, None)

    @classmethod
    def _refresh_indexes(
        cls,
        by_username: dict[str, db_models.User],
        by_subadress: dict[str, list[db_models.User]],
        by_credential: dict[str, list[db_models.User]],
        user: db_models.User,
        *,
        old_username: Optional[str],
        old_subadress: Optional[str],
        old_credential: Optional[str],
    ) -> None:
        if old_username and old_username != user.username.lower():
            existing = by_username.get(old_username)
            if existing and existing.id == user.id:
                by_username.pop(old_username, None)
        if user.username:
            by_username[user.username.lower()] = user

        cls._remove_list_mapping(by_subadress, old_subadress, user.id)
        if user.subadress:
            by_subadress.setdefault(user.subadress.lower(), [])
            if all(existing.id != user.id for existing in by_subadress[user.subadress.lower()]):
                by_subadress[user.subadress.lower()].append(user)

        cls._remove_list_mapping(by_credential, old_credential, user.id)
        normalized_credential = _normalize_key(user.credential_key)
        if normalized_credential:
            by_credential.setdefault(normalized_credential, [])
            if all(existing.id != user.id for existing in by_credential[normalized_credential]):
                by_credential[normalized_credential].append(user)

    @classmethod
    def _apply_expire_override(
        cls,
        inbound_config: ThreeXUiInboundImportConfig,
        source_expire_seconds: Optional[int],
    ) -> Optional[int]:
        if inbound_config.expire_override_mode == "none" or inbound_config.expire_override_seconds is None:
            return source_expire_seconds
        if inbound_config.expire_override_mode == "add":
            if source_expire_seconds is None:
                return None
            return source_expire_seconds + inbound_config.expire_override_seconds
        if inbound_config.expire_override_seconds <= 0:
            return None
        if inbound_config.expire_override_seconds < 1_000_000_000:
            return int(datetime.now(UTC).timestamp()) + inbound_config.expire_override_seconds
        return inbound_config.expire_override_seconds

    @classmethod
    def _apply_traffic_override(
        cls,
        inbound_config: ThreeXUiInboundImportConfig,
        source_total_bytes: Optional[int],
    ) -> Optional[int]:
        if inbound_config.traffic_override_mode == "none" or inbound_config.traffic_override_bytes is None:
            return source_total_bytes
        if inbound_config.traffic_override_mode == "add":
            if source_total_bytes is None:
                return None
            return max(source_total_bytes + inbound_config.traffic_override_bytes, 0)
        if inbound_config.traffic_override_bytes <= 0:
            return None
        return inbound_config.traffic_override_bytes

    @classmethod
    def _best_effort_runtime_sync(cls, user: db_models.User, *, created: bool, result: ThreeXUiImportJobResult) -> None:
        try:
            if created:
                xray.operations.add_user(dbuser=user)
            else:
                xray.operations.update_user(dbuser=user)
        except Exception as exc:
            result.warnings.append(f"Runtime sync failed for {user.username}: {exc}")

    @classmethod
    def _perform_import(
        cls,
        db: Session,
        parsed: _ParsedDatabase,
        payload: ThreeXUiImportRequest,
        job_id: str,
    ) -> ThreeXUiImportJobResult:
        config_by_inbound = {item.inbound_id: item for item in payload.inbounds}
        enabled_inbound_ids = {item.inbound_id for item in payload.inbounds if item.import_enabled}
        enabled_clients = [client for client in parsed.importable_clients if client.inbound_id in enabled_inbound_ids]
        admin_ids = {item.admin_id for item in payload.inbounds if item.import_enabled and item.admin_id is not None}
        service_ids = {item.service_id for item in payload.inbounds if item.import_enabled and item.service_id is not None}

        admins = {
            admin.id: admin
            for admin in db.query(db_models.Admin).filter(db_models.Admin.id.in_(admin_ids)).all()
            if admin.id is not None
        }
        services = {
            service.id: service
            for service in (
                db.query(db_models.Service)
                .options(joinedload(db_models.Service.admin_links))
                .filter(db_models.Service.id.in_(service_ids))
                .all()
            )
            if service.id is not None
        }

        by_username = cls._existing_users_by_username(db, (client.normalized_username for client in enabled_clients))
        by_subadress = cls._existing_users_by_subadress(
            db, (client.normalized_subadress for client in enabled_clients)
        )
        by_credential = cls._existing_users_by_credential_key(
            db, (client.normalized_credential_key for client in enabled_clients)
        )
        reserved_usernames = set(by_username.keys())

        source_subaddress_counts: dict[str, int] = {}
        for client in enabled_clients:
            if client.normalized_subadress:
                source_subaddress_counts[client.normalized_subadress] = (
                    source_subaddress_counts.get(client.normalized_subadress, 0) + 1
                )

        seen_source_subaddresses: set[str] = set()
        result = ThreeXUiImportJobResult(total_clients=len(parsed.importable_clients))

        for client in sorted(parsed.importable_clients, key=lambda item: (item.inbound_order, item.client_order)):
            inbound_config = config_by_inbound[client.inbound_id]
            if not inbound_config.import_enabled:
                result.skipped += 1
                result.processed_clients += 1
                cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                continue

            admin = admins[inbound_config.admin_id]
            service = services.get(inbound_config.service_id) if inbound_config.service_id is not None else None

            if client.normalized_subadress and source_subaddress_counts.get(client.normalized_subadress, 0) > 1:
                if payload.duplicate_subaddress_policy.source_conflict_mode == ThreeXUiDuplicateSubadressSourceMode.skip_all:
                    result.skipped += 1
                    result.skipped_subaddress_conflicts += 1
                    result.processed_clients += 1
                    cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                    continue
                if client.normalized_subadress in seen_source_subaddresses:
                    result.skipped += 1
                    result.skipped_subaddress_conflicts += 1
                    result.processed_clients += 1
                    cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                    continue
                seen_source_subaddresses.add(client.normalized_subadress)

            data_limit = cls._apply_traffic_override(inbound_config, client.total_bytes)
            expire = cls._apply_expire_override(inbound_config, client.expire_seconds)
            status = _resolve_status(
                client_enabled=client.enable,
                inbound_enabled=client.inbound_enabled,
                expire_seconds=expire,
                used_traffic=client.used_traffic,
                total_bytes=data_limit,
            )
            note = _build_note(client.comment, client.email, client.inbound_remark)

            target_user: Optional[db_models.User] = None
            created = False
            match_kind = ""

            if client.normalized_subadress:
                matching_sub_users = by_subadress.get(client.normalized_subadress, [])
                if len(matching_sub_users) > 1:
                    result.skipped += 1
                    result.skipped_subaddress_conflicts += 1
                    result.warnings.append(
                        f"Skipping {client.preferred_username}: multiple Rebecca users already use subadress {client.subadress}"
                    )
                    result.processed_clients += 1
                    cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                    continue
                if len(matching_sub_users) == 1:
                    if (
                        payload.duplicate_subaddress_policy.existing_conflict_mode
                        == ThreeXUiDuplicateSubadressExistingMode.skip
                    ):
                        result.skipped += 1
                        result.skipped_subaddress_conflicts += 1
                        result.processed_clients += 1
                        cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                        continue
                    target_user = matching_sub_users[0]
                    match_kind = "subadress"

            if target_user is None and client.normalized_credential_key:
                matching_credential_users = by_credential.get(client.normalized_credential_key, [])
                if len(matching_credential_users) > 1:
                    result.skipped += 1
                    result.warnings.append(
                        f"Skipping {client.preferred_username}: multiple Rebecca users already use the same credential key"
                    )
                    result.processed_clients += 1
                    cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                    continue
                if len(matching_credential_users) == 1:
                    target_user = matching_credential_users[0]
                    match_kind = "credential"

            resolved_username = client.preferred_username
            if target_user is None:
                existing_username_user = by_username.get(client.normalized_username)
                if existing_username_user is not None:
                    if inbound_config.username_conflict_mode == ThreeXUiUsernameConflictMode.skip:
                        result.skipped += 1
                        result.skipped_username_conflicts += 1
                        result.processed_clients += 1
                        cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                        continue
                    if inbound_config.username_conflict_mode == ThreeXUiUsernameConflictMode.overwrite:
                        target_user = existing_username_user
                        match_kind = "username"
                    else:
                        resolved_username = _unique_username(client.preferred_username, reserved_usernames)
                        result.renamed += 1
                else:
                    resolved_username = _unique_username(client.preferred_username, reserved_usernames)

            if target_user is None:
                created = True
                target_user = db_models.User(
                    username=resolved_username,
                    credential_key=client.credential_key,
                    subadress=client.subadress or "",
                    flow=client.flow,
                    status=status,
                    used_traffic=client.used_traffic,
                    data_limit=data_limit,
                    data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
                    expire=expire,
                    admin=admin,
                    service=service,
                    note=note,
                    telegram_id=client.telegram_id,
                    ip_limit=client.limit_ip,
                    created_at=client.created_at or _now(),
                    edit_at=_now(),
                    last_status_change=_now(),
                    sub_updated_at=_now(),
                    sub_revoked_at=None,
                    on_hold_expire_duration=None,
                    on_hold_timeout=None,
                    proxies=[
                        db_models.Proxy(
                            type=client.protocol.value,
                            settings=dict(client.proxy_settings),
                            excluded_inbounds=[],
                        )
                    ],
                )
                db.add(target_user)
            else:
                old_username = _normalize_key(target_user.username)
                old_subadress = _normalize_key(target_user.subadress)
                old_credential = _normalize_key(target_user.credential_key)
                previous_status = target_user.status

                target_user.credential_key = client.credential_key
                target_user.subadress = client.subadress or ""
                target_user.flow = client.flow
                target_user.status = status
                target_user.used_traffic = client.used_traffic
                target_user.data_limit = data_limit
                target_user.data_limit_reset_strategy = UserDataLimitResetStrategy.no_reset
                target_user.expire = expire
                target_user.admin = admin
                target_user.service = service
                target_user.note = note
                target_user.telegram_id = client.telegram_id
                target_user.ip_limit = client.limit_ip
                target_user.sub_revoked_at = None
                target_user.sub_updated_at = _now()
                target_user.edit_at = _now()
                target_user.on_hold_expire_duration = None
                target_user.on_hold_timeout = None
                target_user.proxies = [
                    db_models.Proxy(
                        type=client.protocol.value,
                        settings=dict(client.proxy_settings),
                        excluded_inbounds=[],
                    )
                ]
                target_user.next_plans = []
                if previous_status != status:
                    target_user.last_status_change = _now()
                db.add(target_user)

            try:
                db.commit()
                db.refresh(target_user)
            except Exception as exc:
                db.rollback()
                result.skipped += 1
                result.warnings.append(f"Skipping {client.preferred_username}: {exc}")
                result.processed_clients += 1
                cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)
                continue

            if created:
                by_username[target_user.username.lower()] = target_user
                if target_user.subadress:
                    by_subadress.setdefault(target_user.subadress.lower(), []).append(target_user)
                if target_user.credential_key:
                    by_credential.setdefault(target_user.credential_key.lower(), []).append(target_user)
                result.created += 1
            else:
                cls._refresh_indexes(
                    by_username,
                    by_subadress,
                    by_credential,
                    target_user,
                    old_username=old_username,
                    old_subadress=old_subadress,
                    old_credential=old_credential,
                )
                result.updated += 1
                if match_kind == "username":
                    result.updated_by_username_overwrite += 1
                elif match_kind == "subadress":
                    result.updated_by_subaddress_overwrite += 1
                elif match_kind == "credential":
                    result.updated_by_credential_key += 1

            cls._best_effort_runtime_sync(target_user, created=created, result=result)
            result.processed_clients += 1
            cls._update_job(job_id, progress_current=result.processed_clients, progress_total=result.total_clients)

        return result
