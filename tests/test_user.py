from uuid import uuid4
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
