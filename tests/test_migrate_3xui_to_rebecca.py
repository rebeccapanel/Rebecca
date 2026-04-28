import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

from app.db import GetDB
from app.db import models as db_models
from scripts.migrate_3xui_to_rebecca import migrate_3xui_users


def _build_source_db(path):
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
                email TEXT UNIQUE,
                up INTEGER,
                down INTEGER
            )
            """
        )

        vmess_uuid = str(uuid.uuid4())
        future_ms = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp() * 1000)
        created_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        vmess_settings = {
            "clients": [
                {
                    "id": vmess_uuid,
                    "email": f"vmess-{uuid.uuid4().hex[:8]}@example.com",
                    "totalGB": 5 * 1024 * 1024 * 1024,
                    "expiryTime": future_ms,
                    "enable": True,
                    "subId": f"sub{uuid.uuid4().hex[:12]}",
                    "comment": "Imported VMess user",
                    "limitIp": 3,
                    "created_at": created_ms,
                }
            ]
        }
        ss2022_settings = {
            "method": "2022-blake3-aes-128-gcm",
            "password": "server-key",
            "clients": [
                {
                    "password": "client-key",
                    "email": f"ss2022-{uuid.uuid4().hex[:8]}@example.com",
                    "enable": True,
                    "subId": f"sub{uuid.uuid4().hex[:12]}",
                }
            ],
        }

        conn.execute(
            "INSERT INTO inbounds (enable, remark, protocol, settings) VALUES (?, ?, ?, ?)",
            (1, "VMess Import", "vmess", json.dumps(vmess_settings)),
        )
        conn.execute(
            "INSERT INTO inbounds (enable, remark, protocol, settings) VALUES (?, ?, ?, ?)",
            (1, "SS2022 Import", "shadowsocks", json.dumps(ss2022_settings)),
        )
        conn.execute(
            "INSERT INTO client_traffics (inbound_id, enable, email, up, down) VALUES (?, ?, ?, ?, ?)",
            (1, 1, vmess_settings["clients"][0]["email"], 111, 222),
        )
        conn.commit()
        return vmess_settings
    finally:
        conn.close()


def test_migrate_3xui_users_imports_supported_clients_and_is_idempotent(tmp_path):
    source_db = tmp_path / "3xui.sqlite3"
    vmess_settings = _build_source_db(source_db)
    source_client = vmess_settings["clients"][0]

    first = migrate_3xui_users(str(source_db))
    assert first.created == 1
    assert first.updated == 0
    assert first.skipped_unsupported == 1

    with GetDB() as db:
        imported = (
            db.query(db_models.User)
            .filter(db_models.User.subadress == source_client["subId"])
            .first()
        )
        assert imported is not None
        assert imported.subadress == source_client["subId"]
        assert imported.used_traffic == 333
        assert imported.data_limit == source_client["totalGB"]
        assert imported.ip_limit == 3
        assert getattr(imported.status, "value", imported.status) == "active"
        assert imported.credential_key
        assert len(imported.proxies) == 1
        assert getattr(imported.proxies[0].type, "value", imported.proxies[0].type) == "vmess"
        assert imported.proxies[0].settings["id"] == source_client["id"]

    second = migrate_3xui_users(str(source_db))
    assert second.created == 0
    assert second.updated == 1
    assert second.skipped_unsupported == 1

    with GetDB() as db:
        count = db.query(db_models.User).filter(db_models.User.subadress == source_client["subId"]).count()
        assert count == 1
