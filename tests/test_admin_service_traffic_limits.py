from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import crud
from app.db.crud.proxy import ProxyInboundRepository
from app.db.models import AdminServiceLink
from app.models.proxy import ProxyHost
from app.models.service import ServiceCreate, ServiceHostAssignment
from app.models.user import UserStatus
from tests.conftest import TestingSessionLocal

GB = 1024**3
MB = 1024**2
_INBOUNDS = {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]}


def _login_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post("/api/admin/token", data={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_service_for_admin(admin_id: int, name: str):
    with TestingSessionLocal() as db:
        repo = ProxyInboundRepository(db)
        inbound = repo.get_or_create("VMess TCP")
        host = inbound.hosts[0] if inbound.hosts else None
        if host is None:
            host = repo.add_host(
                "VMess TCP",
                ProxyHost(remark=f"{name}-host", address="127.0.0.1", port=443),
            )[-1]
        service = crud.create_service(
            db,
            ServiceCreate(
                name=name,
                hosts=[ServiceHostAssignment(host_id=host.id)],
                admin_ids=[admin_id],
            ),
        )
        return service.id


def _create_created_admin(client: TestClient, username: str, password: str, *, delete_cap: int):
    response = client.post(
        "/api/admin",
        json={
            "username": username,
            "password": password,
            "role": "standard",
            "data_limit": GB,
            "traffic_limit_mode": "created_traffic",
            "permissions": {"users": {"delete": True, "reset_usage": True}},
            "delete_user_usage_limit_enabled": True,
            "delete_user_usage_limit": delete_cap,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_user(client: TestClient, headers: dict[str, str], username: str, *, service_id: int | None = None):
    payload = {
        "username": username,
        "expire": 1735689600,
        "data_limit": GB,
        "data_limit_reset_strategy": "no_reset",
    }
    if service_id is None:
        payload["proxies"] = {"vmess": {"id": str(uuid4())}}
    else:
        payload["service_id"] = service_id

    with patch("app.routers.user.xray.config.inbounds_by_protocol", _INBOUNDS):
        response = client.post("/api/user", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_global_created_delete_cap_credits_usage(auth_client: TestClient):
    unique = uuid4().hex[:8]
    username = f"delcap_{unique}"
    password = "deletecap123"
    user_username = f"delcap_user_{unique}"
    _create_created_admin(auth_client, username, password, delete_cap=100 * MB)
    headers = _login_headers(auth_client, username, password)
    _create_user(auth_client, headers, user_username)

    with TestingSessionLocal() as db:
        dbuser = crud.get_user(db, user_username)
        dbuser.used_traffic = 50 * MB
        db.commit()

    response = auth_client.delete(f"/api/user/{user_username}", headers=headers)
    assert response.status_code == 200, response.text

    with TestingSessionLocal() as db:
        dbadmin = crud.get_admin(db, username)
        dbuser = crud.get_user(db, user_username)
        assert dbadmin.created_traffic == GB - 50 * MB
        assert dbadmin.deleted_users_usage == 50 * MB
        assert dbuser is None


def test_global_created_delete_cap_blocks_over_limit(auth_client: TestClient):
    unique = uuid4().hex[:8]
    username = f"delcap_block_{unique}"
    password = "deletecap123"
    user_username = f"delcap_block_user_{unique}"
    _create_created_admin(auth_client, username, password, delete_cap=100 * MB)
    headers = _login_headers(auth_client, username, password)
    _create_user(auth_client, headers, user_username)

    with TestingSessionLocal() as db:
        dbuser = crud.get_user(db, user_username)
        dbuser.used_traffic = 150 * MB
        db.commit()

    response = auth_client.delete(f"/api/user/{user_username}", headers=headers)
    assert response.status_code == 403


def test_per_service_created_limits_delete_cap_and_service_lock(auth_client: TestClient):
    unique = uuid4().hex[:8]
    username = f"svc_ct_{unique}"
    password = "svcctpass123"
    response = auth_client.post(
        "/api/admin",
        json={
            "username": username,
            "password": password,
            "role": "standard",
            "use_service_traffic_limits": True,
            "permissions": {"users": {"delete": True}},
        },
    )
    assert response.status_code == 200, response.text
    admin_id = response.json()["id"]
    service_id = _create_service_for_admin(admin_id, f"svc-ct-{unique}")

    update_response = auth_client.put(
        f"/api/admin/{username}",
        json={
            "services": [service_id],
            "use_service_traffic_limits": True,
            "service_limits": [
                {
                    "service_id": service_id,
                    "traffic_limit_mode": "created_traffic",
                    "data_limit": GB,
                    "delete_user_usage_limit_enabled": True,
                    "delete_user_usage_limit": 100 * MB,
                }
            ],
        },
    )
    assert update_response.status_code == 200, update_response.text
    headers = _login_headers(auth_client, username, password)

    no_service_response = auth_client.post(
        "/api/user",
        json={"username": f"nosvc_{unique}", "proxies": {"vmess": {"id": str(uuid4())}}, "data_limit": GB},
        headers=headers,
    )
    assert no_service_response.status_code == 403

    user_username = f"svc_ct_user_{unique}"
    _create_user(auth_client, headers, user_username, service_id=service_id)
    with TestingSessionLocal() as db:
        dbuser = crud.get_user(db, user_username)
        dbuser.used_traffic = 50 * MB
        db.commit()

    transfer_response = auth_client.put(f"/api/user/{user_username}", json={"service_id": None}, headers=headers)
    assert transfer_response.status_code == 403

    delete_response = auth_client.delete(f"/api/user/{user_username}", headers=headers)
    assert delete_response.status_code == 200, delete_response.text

    with TestingSessionLocal() as db:
        link = (
            db.query(AdminServiceLink)
            .filter(AdminServiceLink.admin_id == admin_id, AdminServiceLink.service_id == service_id)
            .first()
        )
        assert link.created_traffic == GB - 50 * MB
        assert link.deleted_users_usage == 50 * MB


def test_per_service_limits_ignore_global_created_lock(auth_client: TestClient):
    unique = uuid4().hex[:8]
    username = f"svc_global_{unique}"
    password = "svcglobal123"
    response = auth_client.post(
        "/api/admin",
        json={
            "username": username,
            "password": password,
            "role": "standard",
            "data_limit": 100 * MB,
            "traffic_limit_mode": "created_traffic",
            "use_service_traffic_limits": True,
        },
    )
    assert response.status_code == 200, response.text
    admin_id = response.json()["id"]
    service_id = _create_service_for_admin(admin_id, f"svc-global-{unique}")

    with TestingSessionLocal() as db:
        dbadmin = crud.get_admin(db, username)
        dbadmin.created_traffic = 100 * MB
        db.commit()

    update_response = auth_client.put(
        f"/api/admin/{username}",
        json={
            "services": [service_id],
            "use_service_traffic_limits": True,
            "service_limits": [
                {
                    "service_id": service_id,
                    "traffic_limit_mode": "created_traffic",
                    "data_limit": GB,
                }
            ],
        },
    )
    assert update_response.status_code == 200, update_response.text

    headers = _login_headers(auth_client, username, password)
    _create_user(auth_client, headers, f"svc_global_user_{unique}", service_id=service_id)


def test_per_service_used_limit_disables_and_blocks_activation(auth_client: TestClient):
    unique = uuid4().hex[:8]
    username = f"svc_used_{unique}"
    password = "svcusedpass123"
    response = auth_client.post(
        "/api/admin",
        json={
            "username": username,
            "password": password,
            "role": "standard",
            "use_service_traffic_limits": True,
        },
    )
    assert response.status_code == 200, response.text
    admin_id = response.json()["id"]
    service_id = _create_service_for_admin(admin_id, f"svc-used-{unique}")
    auth_client.put(
        f"/api/admin/{username}",
        json={
            "services": [service_id],
            "use_service_traffic_limits": True,
            "service_limits": [
                {
                    "service_id": service_id,
                    "traffic_limit_mode": "used_traffic",
                    "data_limit": 100 * MB,
                }
            ],
        },
    )
    headers = _login_headers(auth_client, username, password)
    user_username = f"svc_used_user_{unique}"
    _create_user(auth_client, headers, user_username, service_id=service_id)

    with TestingSessionLocal() as db:
        link = (
            db.query(AdminServiceLink)
            .filter(AdminServiceLink.admin_id == admin_id, AdminServiceLink.service_id == service_id)
            .first()
        )
        link.used_traffic = 100 * MB
        crud.enforce_admin_service_data_limit(db, link)
        db.commit()
        dbuser = crud.get_user(db, user_username)
        assert dbuser.status == UserStatus.disabled

    activate_response = auth_client.put(f"/api/user/{user_username}", json={"status": "active"}, headers=headers)
    assert activate_response.status_code == 403
