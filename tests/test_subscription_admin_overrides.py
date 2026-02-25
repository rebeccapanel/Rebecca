import json
import uuid
from typing import List
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db.models import Admin as DBAdmin
from app.services.subscription_settings import SubscriptionSettingsService
from tests.conftest import TestingSessionLocal


def _create_admin(auth_client: TestClient, username: str) -> int:
    resp = auth_client.post(
        "/api/admin",
        json={"username": username, "password": "pass123", "role": "standard"},
    )
    assert resp.status_code == 200, resp.text
    with TestingSessionLocal() as db:
        admin = db.query(DBAdmin).filter(DBAdmin.username == username).first()
        assert admin is not None
        return admin.id


def _create_user_for_admin(auth_client: TestClient, admin_id: int, username: str) -> str:
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "admin_id": admin_id,
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
        }
        resp = auth_client.post("/api/user", json=payload)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data.get("credential_key"), "credential_key not returned"
        return data["credential_key"]


def _patch_generate(monkeypatch, calls: List[dict]):
    from app.routers import subscription as sub_router
    from app.subscription import share as sub_share

    def _fake_generate_subscription(*, user, config_format, as_base64, reverse, settings):
        calls.append(
            {
                "config_format": config_format,
                "as_base64": as_base64,
                "reverse": reverse,
                "settings": settings,
                "use_custom_json_default": getattr(settings, "use_custom_json_default", False),
                "use_custom_json_for_v2rayng": getattr(settings, "use_custom_json_for_v2rayng", False),
            }
        )
        if "json" in config_format or config_format in ("sing-box", "outline"):
            return json.dumps({"outbounds": [{"tag": config_format}]})
        return f"stub-{config_format}"

    monkeypatch.setattr(sub_router, "generate_subscription", _fake_generate_subscription)
    monkeypatch.setattr(sub_share, "generate_subscription", _fake_generate_subscription)


def _patch_admin_settings(monkeypatch, admin_id: int, *, use_custom_json_for_v2rayng: bool = True):
    original = SubscriptionSettingsService.get_effective_settings.__func__

    def _patched(cls, admin=None, ensure_record: bool = True, db=None):
        settings = original(cls, admin=admin, ensure_record=ensure_record, db=db)
        if admin is not None and getattr(admin, "id", None) == admin_id:
            settings.use_custom_json_for_v2rayng = use_custom_json_for_v2rayng
            settings.use_custom_json_default = False
        return settings

    monkeypatch.setattr(
        SubscriptionSettingsService,
        "get_effective_settings",
        classmethod(_patched),
    )


def test_admin_override_v2rayng_json_and_singbox(auth_client: TestClient, monkeypatch):
    unique = uuid.uuid4().hex[:8]
    admin_name = f"subadmin_{unique}"
    admin_id = _create_admin(auth_client, admin_name)

    # Apply per-admin subscription settings (force JSON for v2rayng)
    update_payload = {
        "subscription_settings": {
            "use_custom_json_for_v2rayng": True,
            "use_custom_json_default": False,
        }
    }
    resp = auth_client.put(
        f"/api/settings/subscriptions/admins/{admin_id}",
        json=update_payload,
    )
    assert resp.status_code == 200, resp.text
    _patch_admin_settings(monkeypatch, admin_id)
    calls: List[dict] = []
    _patch_generate(monkeypatch, calls)

    # Create a user under this admin
    user_name = f"user_{unique}"
    cred_key = _create_user_for_admin(auth_client, admin_id, user_name)

    # v2rayng (explicit client type) should return JSON
    v2_resp = auth_client.get(f"/sub/{user_name}/{cred_key}/v2ray-json")
    assert v2_resp.status_code == 200, v2_resp.text
    assert "application/json" in v2_resp.headers.get("content-type", "").lower()
    parsed = json.loads(v2_resp.text or "{}")
    assert isinstance(parsed, (dict, list))
    if isinstance(parsed, dict):
        assert parsed.get("outbounds") is not None

    # sing-box config should also be returned for this user
    sb_resp = auth_client.get(
        f"/sub/{user_name}/{cred_key}/sing-box",
        headers={"User-Agent": "sing-box"},
    )
    assert sb_resp.status_code == 200, sb_resp.text
    assert "application/json" in sb_resp.headers.get("content-type", "").lower()
    sb_parsed = json.loads(sb_resp.text)
    assert isinstance(sb_parsed, dict)
    assert sb_parsed.get("outbounds") is not None


def test_all_supported_client_types_per_admin(auth_client: TestClient, monkeypatch):
    # Admin A: default settings (no custom JSON)
    unique = uuid.uuid4().hex[:6]
    admin_default = _create_admin(auth_client, f"adm_default_{unique}")
    user_default = f"user_default_{unique}"
    cred_default = _create_user_for_admin(auth_client, admin_default, user_default)

    # Admin B: force JSON for v2rayng
    admin_override = _create_admin(auth_client, f"adm_override_{unique}")
    resp = auth_client.put(
        f"/api/settings/subscriptions/admins/{admin_override}",
        json={
            "subscription_settings": {
                "use_custom_json_default": False,
                "use_custom_json_for_v2rayng": True,
            }
        },
    )
    assert resp.status_code == 200, resp.text
    user_override = f"user_override_{unique}"
    cred_override = _create_user_for_admin(auth_client, admin_override, user_override)

    _patch_generate(monkeypatch, [])
    _patch_admin_settings(monkeypatch, admin_override)

    # Explicit client types (path-based)
    path_client_types = [
        ("clash-meta", "text/yaml"),
        ("clash", "text/yaml"),
        ("sing-box", "application/json"),
        ("outline", "application/json"),
        ("v2ray-json", "application/json"),
        ("v2ray", "text/plain"),
    ]
    for client_type, expected_content_type in path_client_types:
        resp = auth_client.get(f"/sub/{user_default}/{cred_default}/{client_type}")
        assert resp.status_code == 200, resp.text
        assert expected_content_type in resp.headers.get("content-type", "").lower()

    # Path-based v2ray-json should return JSON for override admin
    resp_override = auth_client.get(f"/sub/{user_override}/{cred_override}/v2ray-json")
    assert resp_override.status_code == 200, resp_override.text
    assert "application/json" in resp_override.headers.get("content-type", "").lower()
    json.loads(resp_override.text or "{}")
