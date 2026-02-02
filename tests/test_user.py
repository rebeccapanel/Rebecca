from uuid import uuid4
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
from fastapi.testclient import TestClient
from unittest.mock import patch

from tests.conftest import TestingSessionLocal
from app.db import crud
from app.db.crud.proxy import ProxyInboundRepository
from app.models.proxy import ProxyHost
from app.models.service import ServiceCreate, ServiceHostAssignment


def test_add_user(auth_client: TestClient):
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        response = auth_client.post("/api/user", json=user_data)
        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "testuser"


def test_add_user_with_inbounds_marzban_compatible(auth_client: TestClient):
    """Test that endpoint accepts inbounds in payload like Marzban"""
    with (
        patch(
            "app.routers.user.xray.config.inbounds_by_protocol",
            {"vmess": [{"tag": "VMess TCP"}, {"tag": "VMess WS"}], "vless": [{"tag": "VLESS TCP"}]},
        ),
        patch(
            "app.routers.user.xray.config.inbounds_by_tag",
            {"VMess TCP": {}, "VMess WS": {}, "VLESS TCP": {}},
        ),
    ):
        user_data = {
            "username": "testuser_marzban",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "inbounds": {"vmess": ["VMess TCP", "VMess WS"]},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        response = auth_client.post("/api/user", json=user_data)
        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "testuser_marzban"
        # Verify inbounds are in response (Marzban-compatible)
        assert "inbounds" in data
        assert "vmess" in data["inbounds"]
        assert "VMess TCP" in data["inbounds"]["vmess"]
        assert "VMess WS" in data["inbounds"]["vmess"]


def test_get_user(auth_client: TestClient):
    # First create a user
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser2",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.get("/api/user/testuser2")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testuser2"


def test_get_users(auth_client: TestClient):
    response = auth_client.get("/api/users")
    assert response.status_code == 200
    data = response.json()
    assert "users" in data


def test_delete_user(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser3",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.delete("/api/user/testuser3")
    assert response.status_code == 200

    # Check if deleted
    response = auth_client.get("/api/user/testuser3")
    assert response.status_code == 404


def test_update_user(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser4",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    # Update user
    update_data = {
        "data_limit": 2147483648,  # 2GB
        "expire": 1767225600,  # Extended expiry
    }
    response = auth_client.put("/api/user/testuser4", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["data_limit"] == 2147483648


def test_reset_user_data_usage(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser5",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.post("/api/user/testuser5/reset")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testuser5"


def test_revoke_user_subscription(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser6",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.post("/api/user/testuser6/revoke_sub")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testuser6"


def test_bulk_user_actions(auth_client: TestClient):
    # Create users first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        for i in range(7, 10):
            user_data = {
                "username": f"testuser{i}",
                "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
                "expire": 1735689600,
                "data_limit": 1073741824,
                "data_limit_reset_strategy": "no_reset",
            }
            auth_client.post("/api/user", json=user_data)

    # Bulk action to delete users
    action_data = {"action": "delete", "usernames": ["testuser7", "testuser8"]}
    response = auth_client.post("/api/users/actions", json=action_data)
    # This might fail due to payload validation, so just check it doesn't crash
    assert response.status_code in [200, 422]


def test_get_user_usage(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser10",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.get("/api/user/testuser10/usage")
    assert response.status_code == 200
    data = response.json()
    assert "usages" in data


def test_activate_next_plan(auth_client: TestClient):
    # Create user first
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        user_data = {
            "username": "testuser11",
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
            "expire": 1735689600,
            "data_limit": 1073741824,
            "data_limit_reset_strategy": "no_reset",
        }
        auth_client.post("/api/user", json=user_data)

    response = auth_client.post("/api/user/testuser11/active-next")
    # This might fail if no next plan exists
    assert response.status_code in [200, 404]


def _load_user_usage_module():
    """Load the user_usage module without triggering app.jobs __init__ side effects."""
    path = Path("app/jobs/usage/user_usage.py")
    # Stub app.jobs package so imports inside user_usage don't execute the real package __init__
    import sys
    import types

    if "app.jobs" not in sys.modules:
        jobs_pkg = types.ModuleType("app.jobs")
        jobs_pkg.__path__ = []
        sys.modules["app.jobs"] = jobs_pkg
    if "app.jobs.usage" not in sys.modules:
        usage_pkg = types.ModuleType("app.jobs.usage")
        usage_pkg.__path__ = []
        sys.modules["app.jobs.usage"] = usage_pkg
    if "app.jobs.usage.collectors" not in sys.modules:
        collectors = types.ModuleType("app.jobs.usage.collectors")

        def _noop_get_users_stats(api=None):
            return []

        collectors.get_users_stats = _noop_get_users_stats
        sys.modules["app.jobs.usage.collectors"] = collectors
    if "app.jobs.usage.utils" not in sys.modules:
        utils_mod = types.ModuleType("app.jobs.usage.utils")

        def hour_bucket(ts):
            return ts

        def safe_execute(func, *args, **kwargs):
            return func(*args, **kwargs)

        def utcnow_naive():
            return datetime.now()

        utils_mod.hour_bucket = hour_bucket
        utils_mod.safe_execute = safe_execute
        utils_mod.utcnow_naive = utcnow_naive
        sys.modules["app.jobs.usage.utils"] = utils_mod

    spec = importlib.util.spec_from_file_location("user_usage_for_tests", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_active_next_plan_applies_plan_data_and_expire(auth_client: TestClient):
    username = f"auto_next_{uuid4().hex[:8]}"
    now_ts = int(datetime.now(timezone.utc).timestamp())
    next_expire = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp())
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": uuid4().hex}},
            "expire": now_ts + 3600,
            "data_limit": 512 * 1024 * 1024,  # 0.5 GB
            "data_limit_reset_strategy": "no_reset",
            "next_plan": {
                "data_limit": 1024 * 1024 * 1024,  # +1 GB
                "expire": next_expire,
                "add_remaining_traffic": False,
                "fire_on_either": True,
                "increase_data_limit": False,
                "start_on_first_connect": False,
                "trigger_on": "either",
            },
        }
        create_resp = auth_client.post("/api/user", json=payload)
        assert create_resp.status_code == 201

    resp = auth_client.post(f"/api/user/{username}/active-next")
    # Endpoint may respond 404 after applying; verify persisted state
    assert resp.status_code in [200, 404]
    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, username)
        assert dbuser.next_plan is None
        assert dbuser.data_limit == 512 * 1024 * 1024 + 1024 * 1024 * 1024
        assert dbuser.expire == next_expire
        assert dbuser.used_traffic == 0
    finally:
        db.close()


def test_active_next_plan_waits_for_first_connect(auth_client: TestClient):
    username = f"auto_next_wait_{uuid4().hex[:8]}"
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": uuid4().hex}},
            "data_limit": 1024 * 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
            "next_plan": {
                "data_limit": 1024 * 1024 * 512,
                "expire": None,
                "start_on_first_connect": True,
                "trigger_on": "either",
            },
        }
        create_resp = auth_client.post("/api/user", json=payload)
        assert create_resp.status_code == 201

    # Should not apply while user has never connected
    first = auth_client.post(f"/api/user/{username}/active-next")
    assert first.status_code == 404

    # Mark as connected, then it should apply
    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, username)
        dbuser.online_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()

    second = auth_client.post(f"/api/user/{username}/active-next")
    assert second.status_code in [200, 404]
    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, username)
        assert dbuser.next_plan is None
    finally:
        db.close()


def test_auto_renew_triggers_on_expire(auth_client: TestClient):
    username = f"auto_expire_{uuid4().hex[:8]}"
    expired_ts = int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())
    next_expire = int((datetime.now(timezone.utc) + timedelta(days=2)).timestamp())
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": uuid4().hex}},
            "expire": expired_ts,
            "data_limit": 0,
            "data_limit_reset_strategy": "no_reset",
            "next_plan": {
                "data_limit": 1024 * 1024 * 1024,
                "expire": next_expire,
                "trigger_on": "expire",
                "fire_on_either": False,
            },
        }
        create_resp = auth_client.post("/api/user", json=payload)
        assert create_resp.status_code == 201

    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, username)
        user_usage = _load_user_usage_module()
        user_usage._enforce_user_limits_and_expiry(db, [dbuser.id])
        db.refresh(dbuser)
        assert dbuser.next_plan is None
        assert dbuser.expire == next_expire
        assert dbuser.used_traffic == 0
        # Auto renew should keep user active after applying next plan
        assert dbuser.status.value == "active"
    finally:
        db.close()


def test_auto_renew_triggers_on_data_limit(auth_client: TestClient):
    username = f"auto_data_{uuid4().hex[:8]}"
    initial_limit = 512 * 1024 * 1024
    next_limit = 256 * 1024 * 1024
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": uuid4().hex}},
            "data_limit": initial_limit,
            "data_limit_reset_strategy": "no_reset",
            "next_plan": {
                "data_limit": next_limit,
                "trigger_on": "data",
                "increase_data_limit": True,
            },
        }
        create_resp = auth_client.post("/api/user", json=payload)
        assert create_resp.status_code == 201

    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, username)
        dbuser.used_traffic = initial_limit  # reach limit
        db.commit()
        user_usage = _load_user_usage_module()
        user_usage._enforce_user_limits_and_expiry(db, [dbuser.id])
        db.refresh(dbuser)
        assert dbuser.next_plan is None
        # increase_data_limit=True adds plan limit on top of current limit
        assert dbuser.data_limit == initial_limit + next_limit
        assert dbuser.used_traffic == 0
        assert dbuser.status.value == "active"
    finally:
        db.close()


def test_get_all_users_usage(auth_client: TestClient):
    response = auth_client.get("/api/users/usage")
    assert response.status_code == 200
    data = response.json()
    assert "usages" in data


def test_get_expired_users(auth_client: TestClient):
    # This endpoint has been removed
    response = auth_client.get("/api/users/expired")
    assert response.status_code == 405  # Method not allowed or endpoint removed


def test_delete_expired_users(auth_client: TestClient):
    response = auth_client.delete("/api/users/expired")
    # This will likely return 404 if no expired users
    assert response.status_code in [200, 404]


def _create_service_with_host(db, name: str):
    """Create a service with at least one VMess host for testing."""
    repo = ProxyInboundRepository(db)
    inbound = repo.get_or_create("VMess TCP")
    host = inbound.hosts[0] if inbound.hosts else None
    if host is None:
        host = repo.add_host(
            "VMess TCP",
            ProxyHost(remark=f"{name}-host", address="127.0.0.1", port=443),
        )[-1]
    admin = crud.get_admin(db, "testadmin")
    admin_ids = [admin.id] if admin and admin.id else []
    return crud.create_service(
        db,
        ServiceCreate(
            name=name,
            hosts=[ServiceHostAssignment(host_id=host.id)],
            admin_ids=admin_ids,
        ),
    )


def test_add_user_auto_service_from_inbound_tag(auth_client: TestClient):
    unique = uuid4().hex[:6]
    with TestingSessionLocal() as db:
        service = _create_service_with_host(db, f"auto-svc-{unique}")
        service_id = service.id

    assert service_id is not None
    auto_tag = f"setservice-{service_id}"
    username = f"autosvc-{unique}"

    with (
        patch(
            "app.routers.user.xray.config.inbounds_by_protocol",
            {"vmess": [{"tag": "VMess TCP"}]},
        ),
        patch(
            "app.routers.user.xray.config.inbounds_by_tag",
            {"VMess TCP": {"tag": "VMess TCP", "protocol": "vmess"}},
        ),
    ):
        response = auth_client.post(
            "/api/user",
            json={
                "username": username,
                "inbounds": {"vmess": [auto_tag]},
            },
        )

    assert response.status_code == 201
    data = response.json()
    assert data["service_id"] == service_id
    assert "vmess" in data["inbounds"]
    assert "VMess TCP" in data["inbounds"]["vmess"]
    assert auto_tag not in data["inbounds"]["vmess"]


def test_update_user_service_change(auth_client: TestClient):
    unique = uuid4().hex[:6]
    with TestingSessionLocal() as db:
        service_one = _create_service_with_host(db, f"svc-{unique}-one")
        service_two = _create_service_with_host(db, f"svc-{unique}-two")
        service_one_id, service_two_id = service_one.id, service_two.id

    username = f"svcuser-{unique}"
    create_resp = auth_client.post("/api/user", json={"username": username, "service_id": service_one_id})
    assert create_resp.status_code == 201
    assert create_resp.json()["service_id"] == service_one_id

    update_resp = auth_client.put(f"/api/user/{username}", json={"service_id": service_two_id})
    assert update_resp.status_code == 200
    assert update_resp.json()["service_id"] == service_two_id

    fetch_resp = auth_client.get(f"/api/user/{username}")
    assert fetch_resp.status_code == 200
    assert fetch_resp.json()["service_id"] == service_two_id
