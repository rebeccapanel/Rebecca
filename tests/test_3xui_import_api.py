import json
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone

from app.db import GetDB, crud
from app.db import models as db_models
from app.models.admin import AdminCreate, AdminRole
from app.models.user import UserDataLimitResetStrategy, UserStatus
from app.utils.credentials import uuid_to_key


def _build_3xui_db(path, inbounds):
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE inbounds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                enable INTEGER NOT NULL,
                remark TEXT,
                protocol TEXT NOT NULL,
                settings TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE client_traffics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inbound_id INTEGER,
                enable INTEGER,
                email TEXT,
                up INTEGER,
                down INTEGER
            )
            """
        )

        for inbound in inbounds:
            conn.execute(
                "INSERT INTO inbounds (id, enable, remark, protocol, settings) VALUES (?, ?, ?, ?, ?)",
                (
                    inbound["id"],
                    1 if inbound.get("enable", True) else 0,
                    inbound["remark"],
                    inbound["protocol"],
                    json.dumps({"clients": inbound["clients"], **(inbound.get("extra_settings") or {})}),
                ),
            )
            for traffic in inbound.get("traffics", []):
                conn.execute(
                    "INSERT INTO client_traffics (inbound_id, enable, email, up, down) VALUES (?, ?, ?, ?, ?)",
                    (
                        inbound["id"],
                        1,
                        traffic["email"],
                        traffic.get("up", 0),
                        traffic.get("down", 0),
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def _build_client(*, protocol, email, sub_id, total_bytes, expire_ms, enable=True, limit_ip=0, comment="", tg_id=0):
    payload = {
        "email": email,
        "enable": enable,
        "subId": sub_id,
        "totalGB": total_bytes,
        "expiryTime": expire_ms,
        "limitIp": limit_ip,
        "comment": comment,
        "tgId": tg_id,
        "created_at": int(datetime.now(timezone.utc).timestamp() * 1000),
    }
    if protocol in {"vmess", "vless"}:
        payload["id"] = str(uuid.uuid4())
    elif protocol == "trojan":
        payload["password"] = f"pw-{uuid.uuid4().hex[:12]}"
    else:
        payload["password"] = f"ss-{uuid.uuid4().hex[:12]}"
    return payload


def _create_admin(username_prefix: str):
    username = f"{username_prefix}_{uuid.uuid4().hex[:8]}"
    with GetDB() as db:
        admin = crud.create_admin(
            db,
            AdminCreate(username=username, password="testpass123", role=AdminRole.standard),
        )
        db.commit()
        db.refresh(admin)
        return admin


def _create_service(name_prefix: str, admin_ids=None):
    admin_ids = admin_ids or []
    name = f"{name_prefix}_{uuid.uuid4().hex[:8]}"
    with GetDB() as db:
        service = db_models.Service(name=name, description="import test")
        db.add(service)
        db.flush()
        for admin_id in admin_ids:
            db.add(db_models.AdminServiceLink(admin_id=admin_id, service_id=service.id))
        db.commit()
        db.refresh(service)
        return service


def _upload_preview(auth_client, db_path):
    with open(db_path, "rb") as handle:
        response = auth_client.post(
            "/api/settings/database/3xui/preview",
            files={"file": ("x-ui.db", handle, "application/octet-stream")},
        )
    assert response.status_code == 200, response.text
    return response.json()


def _wait_for_job(auth_client, job_id: str):
    last_payload = None
    for _ in range(10):
        response = auth_client.get(f"/api/settings/database/3xui/jobs/{job_id}")
        assert response.status_code == 200, response.text
        last_payload = response.json()
        if last_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.05)
    assert last_payload is not None
    return last_payload


def test_3xui_preview_reports_conflicts_and_options(auth_client, tmp_path):
    owner = _create_admin("preview_owner")
    service = _create_service("preview_service", admin_ids=[owner.id])

    duplicate_username = f"dup_{uuid.uuid4().hex[:8]}@example.com"
    future_ms = int((datetime.now(timezone.utc) + timedelta(days=10)).timestamp() * 1000)

    with GetDB() as db:
        existing = db_models.User(
            username=duplicate_username,
            credential_key="legacy-key",
            status=UserStatus.active,
            data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            proxies=[db_models.Proxy(type="vmess", settings={"id": str(uuid.uuid4())}, excluded_inbounds=[])],
        )
        db.add(existing)
        db.commit()

    vmess_client = _build_client(
        protocol="vmess",
        email=duplicate_username,
        sub_id="legacy-sub-preview",
        total_bytes=5 * 1024**3,
        expire_ms=future_ms,
        limit_ip=2,
        comment="Preview VMess",
    )
    trojan_client = _build_client(
        protocol="trojan",
        email=f"fresh_{uuid.uuid4().hex[:8]}@example.com",
        sub_id="legacy-sub-preview",
        total_bytes=3 * 1024**3,
        expire_ms=future_ms,
        comment="Preview Trojan",
    )
    unsupported_client = _build_client(
        protocol="shadowsocks",
        email=f"ss_{uuid.uuid4().hex[:8]}@example.com",
        sub_id=f"ss-{uuid.uuid4().hex[:8]}",
        total_bytes=1 * 1024**3,
        expire_ms=future_ms,
    )

    source_db = tmp_path / "preview.db"
    _build_3xui_db(
        source_db,
        [
            {
                "id": 1,
                "remark": "VMess Preview",
                "protocol": "vmess",
                "clients": [vmess_client],
                "traffics": [{"email": duplicate_username, "up": 10, "down": 20}],
            },
            {
                "id": 2,
                "remark": "Trojan Preview",
                "protocol": "trojan",
                "clients": [trojan_client],
            },
            {
                "id": 3,
                "remark": "Unsupported",
                "protocol": "shadowsocks",
                "clients": [unsupported_client],
            },
        ],
    )

    payload = _upload_preview(auth_client, source_db)

    assert payload["source_inbounds"] == 3
    assert payload["supported_inbounds"] == 2
    assert payload["source_clients"] == 3
    assert payload["importable_clients"] == 2
    assert payload["skipped_unsupported"] == 1
    assert len(payload["duplicate_subaddresses"]) == 1
    assert payload["duplicate_subaddresses"][0]["subadress"] == "legacy-sub-preview"
    assert payload["duplicate_subaddresses"][0]["source_count"] == 2

    inbound_map = {item["inbound_id"]: item for item in payload["inbounds"]}
    assert inbound_map[1]["protocol"] == "vmess"
    assert inbound_map[1]["raw_client_count"] == 1
    assert inbound_map[1]["importable_client_count"] == 1
    assert inbound_map[1]["username_conflicts"][0]["username"] == duplicate_username
    assert inbound_map[1]["username_conflicts"][0]["existing_usernames"] == [duplicate_username]

    service_ids = {item["id"] for item in payload["services"]}
    admin_ids = {item["id"] for item in payload["admins"]}
    assert owner.id in admin_ids
    assert service.id in service_ids


def test_3xui_import_rejects_admin_service_mismatch(auth_client, tmp_path):
    owner = _create_admin("mismatch_owner")
    other_admin = _create_admin("mismatch_other")
    service = _create_service("mismatch_service", admin_ids=[other_admin.id])

    future_ms = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp() * 1000)
    vmess_client = _build_client(
        protocol="vmess",
        email=f"user_{uuid.uuid4().hex[:8]}@example.com",
        sub_id=f"sub-{uuid.uuid4().hex[:8]}",
        total_bytes=2 * 1024**3,
        expire_ms=future_ms,
    )
    source_db = tmp_path / "mismatch.db"
    _build_3xui_db(
        source_db,
        [{"id": 11, "remark": "Mismatch", "protocol": "vmess", "clients": [vmess_client]}],
    )

    preview = _upload_preview(auth_client, source_db)
    response = auth_client.post(
        "/api/settings/database/3xui/import",
        json={
            "preview_id": preview["preview_id"],
            "inbounds": [
                {
                    "inbound_id": 11,
                    "admin_id": owner.id,
                    "service_id": service.id,
                    "username_conflict_mode": "rename",
                }
            ],
            "duplicate_subaddress_policy": {
                "source_conflict_mode": "keep_first",
                "existing_conflict_mode": "overwrite",
            },
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Selected admin is not linked to the selected service"


def test_3xui_import_overwrites_existing_username(auth_client, tmp_path):
    owner = _create_admin("overwrite_owner")
    future_ms = int((datetime.now(timezone.utc) + timedelta(days=14)).timestamp() * 1000)
    username = f"overwrite_{uuid.uuid4().hex[:8]}@example.com"
    source_client = _build_client(
        protocol="vmess",
        email=username,
        sub_id=f"sub-{uuid.uuid4().hex[:8]}",
        total_bytes=7 * 1024**3,
        expire_ms=future_ms,
        limit_ip=4,
        comment="Overwrite from 3x-ui",
        tg_id=12345,
    )

    existing_uuid = str(uuid.uuid4())
    with GetDB() as db:
        existing = db_models.User(
            username=username,
            credential_key=uuid_to_key(existing_uuid, db_models.ProxyTypes.VMess),
            status=UserStatus.disabled,
            data_limit=1 * 1024**3,
            used_traffic=999,
            data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            proxies=[db_models.Proxy(type="vmess", settings={"id": existing_uuid}, excluded_inbounds=[])],
        )
        db.add(existing)
        db.commit()

    source_db = tmp_path / "overwrite.db"
    _build_3xui_db(
        source_db,
        [
            {
                "id": 21,
                "remark": "Overwrite Inbound",
                "protocol": "vmess",
                "clients": [source_client],
                "traffics": [{"email": username, "up": 111, "down": 222}],
            }
        ],
    )

    preview = _upload_preview(auth_client, source_db)
    response = auth_client.post(
        "/api/settings/database/3xui/import",
        json={
            "preview_id": preview["preview_id"],
            "inbounds": [
                {
                    "inbound_id": 21,
                    "admin_id": owner.id,
                    "service_id": None,
                    "username_conflict_mode": "overwrite",
                }
            ],
            "duplicate_subaddress_policy": {
                "source_conflict_mode": "keep_first",
                "existing_conflict_mode": "overwrite",
            },
        },
    )

    assert response.status_code == 200, response.text
    job = _wait_for_job(auth_client, response.json()["job_id"])
    assert job["status"] == "completed", job
    assert job["result"]["updated"] == 1
    assert job["result"]["updated_by_username_overwrite"] == 1

    with GetDB() as db:
        imported = crud.get_user(db, username)
        assert imported is not None
        assert imported.username == username
        assert imported.subadress == source_client["subId"]
        assert imported.used_traffic == 333
        assert imported.data_limit == source_client["totalGB"]
        assert imported.ip_limit == 4
        assert imported.telegram_id == "12345"
        assert imported.admin_id == owner.id
        assert imported.status == UserStatus.active
        assert imported.note and "Overwrite from 3x-ui" in imported.note
        assert len(imported.proxies) == 1
        assert imported.proxies[0].settings["id"] == source_client["id"]


def test_3xui_import_keeps_first_duplicate_subaddress(auth_client, tmp_path):
    owner = _create_admin("dup_sub_owner")
    future_ms = int((datetime.now(timezone.utc) + timedelta(days=5)).timestamp() * 1000)
    subadress = f"dup-sub-{uuid.uuid4().hex[:8]}"
    vmess_client = _build_client(
        protocol="vmess",
        email=f"vmess_{uuid.uuid4().hex[:8]}@example.com",
        sub_id=subadress,
        total_bytes=1 * 1024**3,
        expire_ms=future_ms,
    )
    trojan_client = _build_client(
        protocol="trojan",
        email=f"trojan_{uuid.uuid4().hex[:8]}@example.com",
        sub_id=subadress,
        total_bytes=2 * 1024**3,
        expire_ms=future_ms,
    )
    source_db = tmp_path / "dup_sub.db"
    _build_3xui_db(
        source_db,
        [
            {"id": 31, "remark": "VMess", "protocol": "vmess", "clients": [vmess_client]},
            {"id": 32, "remark": "Trojan", "protocol": "trojan", "clients": [trojan_client]},
        ],
    )

    preview = _upload_preview(auth_client, source_db)
    response = auth_client.post(
        "/api/settings/database/3xui/import",
        json={
            "preview_id": preview["preview_id"],
            "inbounds": [
                {"inbound_id": 31, "admin_id": owner.id, "service_id": None, "username_conflict_mode": "rename"},
                {"inbound_id": 32, "admin_id": owner.id, "service_id": None, "username_conflict_mode": "rename"},
            ],
            "duplicate_subaddress_policy": {
                "source_conflict_mode": "keep_first",
                "existing_conflict_mode": "overwrite",
            },
        },
    )

    assert response.status_code == 200, response.text
    job = _wait_for_job(auth_client, response.json()["job_id"])
    assert job["status"] == "completed", job
    assert job["result"]["created"] == 1
    assert job["result"]["skipped_subaddress_conflicts"] == 1

    with GetDB() as db:
        count = (
            db.query(db_models.User)
            .filter(db_models.User.subadress == subadress)
            .filter(db_models.User.status != UserStatus.deleted)
            .count()
        )
        assert count == 1
