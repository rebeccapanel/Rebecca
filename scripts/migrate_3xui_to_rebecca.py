#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.getcwd())
os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")
if os.getenv("DEBUG", "").strip().lower() not in {"", "0", "1", "true", "false", "yes", "no", "on", "off"}:
    os.environ["DEBUG"] = "false"

from app.db import models as db_models
from app.models.proxy import ProxyTypes
from app.models.user import UserDataLimitResetStrategy, UserStatus
from app.utils.credentials import normalize_flow_value, uuid_to_key
from config import SQLALCHEMY_DATABASE_URL

SUPPORTED_PROTOCOLS = {
    "vmess": ProxyTypes.VMess,
    "vless": ProxyTypes.VLESS,
    "trojan": ProxyTypes.Trojan,
    "shadowsocks": ProxyTypes.Shadowsocks,
}
USERNAME_ALLOWED_CHARS = re.compile(r"[^a-zA-Z0-9_.@-]")
MAX_USERNAME_LEN = 32
NOTE_MAX_LEN = 500
KEY_DERIVATION_NAMESPACE = b"rebecca-3xui-migration-v1"


@dataclass
class Stats:
    source_inbounds: int = 0
    source_clients: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    skipped_duplicate_subadress: int = 0
    skipped_unsupported: int = 0
    skipped_invalid: int = 0


@dataclass
class SourceClient:
    inbound_id: int
    inbound_remark: str
    inbound_enabled: bool
    protocol: ProxyTypes
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


def _log(message: str) -> None:
    print(f"[3xui-migrate] {message}")


def _warn(message: str) -> None:
    print(f"[3xui-migrate][WARN] {message}")


def _parse_json(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    text = str(raw).strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _coerce_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_datetime_from_ms(value: Any) -> Optional[datetime]:
    ms_value = _coerce_int(value, 0)
    if ms_value <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms_value / 1000, UTC).replace(tzinfo=None)
    except Exception:
        return None


def _convert_expire_to_seconds(value: Any) -> Optional[int]:
    ms_value = _coerce_int(value, 0)
    if ms_value == 0:
        return None
    if ms_value < 0:
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
        ms_value = now_ms - ms_value
    return max(ms_value // 1000, 0)


def _build_deterministic_key(protocol: ProxyTypes, password: str, email: str, subadress: str, inbound_id: int) -> str:
    seed = f"3xui:{protocol.value}:{password}:{email}:{subadress}:{inbound_id}"
    return hmac.new(KEY_DERIVATION_NAMESPACE, seed.encode("utf-8"), "sha256").hexdigest()[:32]


def _sanitize_username(value: str) -> str:
    candidate = USERNAME_ALLOWED_CHARS.sub("_", _clean_text(value))
    candidate = re.sub(r"_+", "_", candidate).strip("._-@")
    if not candidate:
        candidate = "user"
    if len(candidate) > MAX_USERNAME_LEN:
        candidate = candidate[:MAX_USERNAME_LEN].rstrip("._-@")
    while len(candidate) < 3:
        candidate += "x"
    return candidate


def _unique_username(
    db: Session,
    preferred: str,
    reserved: set[str],
    *,
    ignore_user_id: Optional[int] = None,
) -> str:
    base = _sanitize_username(preferred)
    candidate = base
    counter = 2
    while True:
        normalized = candidate.lower()
        if normalized in reserved:
            pass
        else:
            query = db.query(db_models.User).filter(func.lower(db_models.User.username) == normalized)
            if ignore_user_id is not None:
                query = query.filter(db_models.User.id != ignore_user_id)
            exists = query.first()
            if not exists:
                reserved.add(normalized)
                return candidate

        suffix = f"-{counter}"
        allowed_len = max(MAX_USERNAME_LEN - len(suffix), 1)
        candidate = f"{base[:allowed_len].rstrip('._-@')}{suffix}"
        counter += 1


def _build_note(comment: str, email: str, inbound_remark: str) -> Optional[str]:
    parts = [part for part in [comment.strip(), f"Imported from 3x-ui ({email or 'no-email'})", inbound_remark] if part]
    if not parts:
        return None
    note = " | ".join(parts)
    return note[:NOTE_MAX_LEN]


def _resolve_status(
    *,
    client_enabled: bool,
    inbound_enabled: bool,
    expire_seconds: Optional[int],
    used_traffic: int,
    total_bytes: Optional[int],
) -> UserStatus:
    if not client_enabled or not inbound_enabled:
        return UserStatus.disabled

    now_ts = int(datetime.now(UTC).timestamp())
    if expire_seconds and expire_seconds <= now_ts:
        return UserStatus.expired
    if total_bytes and total_bytes > 0 and used_traffic >= total_bytes:
        return UserStatus.limited
    return UserStatus.active


def _load_traffic_rows(connection: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    try:
        table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='client_traffics'"
        ).fetchone()
        if not table:
            return rows
        cursor = connection.execute(
            "SELECT email, up, down FROM client_traffics"
        )
        for row in cursor.fetchall():
            email = _clean_text(row["email"]).lower()
            if email:
                rows[email] = dict(row)
    except Exception as exc:
        _warn(f"Failed to load client_traffics table: {exc}")
    return rows


def _extract_proxy_settings(
    protocol: ProxyTypes,
    client: dict[str, Any],
    inbound_settings: dict[str, Any],
) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    if protocol in {ProxyTypes.VMess, ProxyTypes.VLESS}:
        raw_id = _clean_text(client.get("id"))
        try:
            user_id = UUID(raw_id)
        except Exception:
            return None, "missing or invalid UUID"
        return {"id": str(user_id)}, None

    if protocol == ProxyTypes.Trojan:
        password = _clean_text(client.get("password"))
        if not password:
            return None, "missing trojan password"
        return {"password": password}, None

    if protocol == ProxyTypes.Shadowsocks:
        method = _clean_text(inbound_settings.get("method"))
        password = _clean_text(client.get("password"))
        if not method:
            return None, "missing shadowsocks method"
        if method.startswith("2022"):
            return None, "shadowsocks-2022 is not supported by Rebecca importer yet"
        if not password:
            return None, "missing shadowsocks password"
        iv_check = inbound_settings.get("ivCheck")
        if iv_check is None:
            iv_check = inbound_settings.get("iv_check")
        return {
            "password": password,
            "method": method,
            "ivCheck": bool(iv_check),
        }, None

    return None, "unsupported protocol"


def load_3xui_clients(source_db: str) -> tuple[list[SourceClient], Stats]:
    stats = Stats()
    source_path = Path(source_db)
    if not source_path.exists():
        raise FileNotFoundError(f"3x-ui database not found: {source_path}")

    connection = sqlite3.connect(str(source_path))
    connection.row_factory = sqlite3.Row
    try:
        traffic_by_email = _load_traffic_rows(connection)
        source_clients: list[SourceClient] = []
        seen_subaddresses: set[str] = set()

        rows = connection.execute(
            "SELECT id, enable, remark, protocol, settings FROM inbounds"
        ).fetchall()
        stats.source_inbounds = len(rows)

        for row in rows:
            protocol_name = _clean_text(row["protocol"]).lower()
            protocol = SUPPORTED_PROTOCOLS.get(protocol_name)
            if not protocol:
                continue

            inbound_settings = _parse_json(row["settings"])
            clients = inbound_settings.get("clients")
            if not isinstance(clients, list):
                continue

            inbound_id = _coerce_int(row["id"], 0)
            inbound_remark = _clean_text(row["remark"]) or f"Inbound #{inbound_id}"
            inbound_enabled = _coerce_bool(row["enable"])

            for raw_client in clients:
                if not isinstance(raw_client, dict):
                    stats.skipped_invalid += 1
                    continue

                stats.source_clients += 1
                email = _clean_text(raw_client.get("email"))
                subadress = _clean_text(raw_client.get("subId"))
                normalized_subadress = subadress.lower()
                if normalized_subadress:
                    if normalized_subadress in seen_subaddresses:
                        stats.skipped_duplicate_subadress += 1
                        _warn(
                            f"Skipping client {email or '<no-email>'} from inbound {inbound_remark}: "
                            f"duplicate subId/subadress '{subadress}' cannot be represented safely."
                        )
                        continue
                    seen_subaddresses.add(normalized_subadress)

                proxy_settings, error = _extract_proxy_settings(protocol, raw_client, inbound_settings)
                if error:
                    stats.skipped_unsupported += 1
                    _warn(
                        f"Skipping client {email or '<no-email>'} from inbound {inbound_remark}: {error}."
                    )
                    continue

                if protocol in {ProxyTypes.VMess, ProxyTypes.VLESS}:
                    credential_key = uuid_to_key(proxy_settings["id"], protocol)
                else:
                    credential_key = _build_deterministic_key(
                        protocol,
                        _clean_text(proxy_settings.get("password")),
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

                source_clients.append(
                    SourceClient(
                        inbound_id=inbound_id,
                        inbound_remark=inbound_remark,
                        inbound_enabled=inbound_enabled,
                        protocol=protocol,
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
                )

        return source_clients, stats
    finally:
        connection.close()


def _get_existing_user_by_subadress(db: Session, subadress: str) -> Optional[db_models.User]:
    normalized_subadress = _clean_text(subadress).lower()
    if not normalized_subadress:
        return None
    matches = (
        db.query(db_models.User)
        .filter(db_models.User.subadress != "")
        .filter(func.lower(db_models.User.subadress) == normalized_subadress)
        .limit(2)
        .all()
    )
    if len(matches) > 1:
        raise ValueError(f"Multiple Rebecca users already use subadress '{subadress}'")
    return matches[0] if matches else None


def _get_existing_user(db: Session, source: SourceClient) -> Optional[db_models.User]:
    existing = _get_existing_user_by_subadress(db, source.subadress)
    if existing is not None:
        return existing

    matches = (
        db.query(db_models.User)
        .filter(db_models.User.credential_key.isnot(None))
        .filter(func.lower(db_models.User.credential_key) == source.credential_key.lower())
        .limit(2)
        .all()
    )
    if len(matches) > 1:
        raise ValueError("Multiple Rebecca users already use the same imported credential key")
    return matches[0] if matches else None


def _preferred_username(source: SourceClient) -> str:
    if source.email:
        return source.email
    if source.subadress:
        return source.subadress
    if source.comment:
        return source.comment
    return f"{source.protocol.value}-{source.inbound_id}"


def migrate_3xui_users(
    source_db: str,
    *,
    target_url: str = SQLALCHEMY_DATABASE_URL,
    admin_username: Optional[str] = None,
    dry_run: bool = False,
) -> Stats:
    clients, stats = load_3xui_clients(source_db)
    engine_kwargs: dict[str, Any] = {}
    if target_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(target_url, **engine_kwargs)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    reserved_usernames: set[str] = set()
    db = SessionLocal()
    try:
        admin = None
        if admin_username:
            admin = db.query(db_models.Admin).filter(func.lower(db_models.Admin.username) == admin_username.lower()).first()
            if not admin:
                raise ValueError(f"Admin '{admin_username}' not found in Rebecca database")

        now = datetime.now(UTC).replace(tzinfo=None)
        for source in clients:
            try:
                existing = _get_existing_user(db, source)
            except ValueError as exc:
                stats.skipped += 1
                _warn(str(exc))
                continue

            resolved_status = _resolve_status(
                client_enabled=source.enable,
                inbound_enabled=source.inbound_enabled,
                expire_seconds=source.expire_seconds,
                used_traffic=source.used_traffic,
                total_bytes=source.total_bytes,
            )
            note = _build_note(source.comment, source.email, source.inbound_remark)

            if existing is None:
                username = _unique_username(db, _preferred_username(source), reserved_usernames)
                dbuser = db_models.User(
                    username=username,
                    credential_key=source.credential_key,
                    subadress=source.subadress,
                    flow=source.flow,
                    status=resolved_status,
                    used_traffic=source.used_traffic,
                    data_limit=source.total_bytes,
                    data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
                    expire=source.expire_seconds,
                    admin=admin,
                    note=note,
                    telegram_id=source.telegram_id,
                    ip_limit=source.limit_ip,
                    created_at=source.created_at or now,
                    sub_updated_at=now,
                    proxies=[
                        db_models.Proxy(
                            type=source.protocol.value,
                            settings=dict(source.proxy_settings),
                            excluded_inbounds=[],
                        )
                    ],
                )
                db.add(dbuser)
                stats.created += 1
            else:
                reserved_usernames.add(existing.username.lower())
                existing.credential_key = source.credential_key
                existing.subadress = source.subadress
                existing.flow = source.flow
                existing.status = resolved_status
                existing.used_traffic = source.used_traffic
                existing.data_limit = source.total_bytes
                existing.data_limit_reset_strategy = UserDataLimitResetStrategy.no_reset
                existing.expire = source.expire_seconds
                existing.note = note
                existing.telegram_id = source.telegram_id
                existing.ip_limit = source.limit_ip
                existing.sub_updated_at = now
                existing.proxies = [
                    db_models.Proxy(
                        type=source.protocol.value,
                        settings=dict(source.proxy_settings),
                        excluded_inbounds=[],
                    )
                ]
                if admin and existing.admin is None:
                    existing.admin = admin
                stats.updated += 1

        if dry_run:
            db.rollback()
        else:
            db.commit()
        return stats
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        engine.dispose()


def _print_summary(stats: Stats, *, dry_run: bool) -> None:
    mode = "dry-run" if dry_run else "import"
    _log(
        f"{mode} summary: "
        f"inbounds={stats.source_inbounds}, "
        f"clients={stats.source_clients}, "
        f"created={stats.created}, "
        f"updated={stats.updated}, "
        f"skipped={stats.skipped}, "
        f"duplicate_subadress={stats.skipped_duplicate_subadress}, "
        f"unsupported={stats.skipped_unsupported}, "
        f"invalid={stats.skipped_invalid}"
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Import 3x-ui users into Rebecca.")
    parser.add_argument(
        "--source-db",
        required=True,
        help="Path to the 3x-ui SQLite database file.",
    )
    parser.add_argument(
        "--target-url",
        default=SQLALCHEMY_DATABASE_URL,
        help="SQLAlchemy target URL (Rebecca). Defaults to SQLALCHEMY_DATABASE_URL.",
    )
    parser.add_argument(
        "--admin-username",
        default=None,
        help="Optional Rebecca admin username to own imported users.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and prepare the import without committing changes.",
    )
    args = parser.parse_args(argv)

    stats = migrate_3xui_users(
        args.source_db,
        target_url=args.target_url,
        admin_username=args.admin_username,
        dry_run=args.dry_run,
    )
    _print_summary(stats, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
