from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import crud
from app.db.models import Admin as DBAdmin, User as DBUser
from app.models.admin import AdminStatus
from app.models.user import UserStatus
from tests.conftest import TestingSessionLocal

GB = 1024**3
_INBOUNDS = {
    "vmess": [{"tag": "VMess TCP"}],
    "vless": [{"tag": "VLESS TCP"}],
}


def _login_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post("/api/admin/token", data={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_created_mode_admin(
    auth_client: TestClient,
    *,
    username: str,
    password: str,
    data_limit: int,
    show_user_traffic: bool = True,
    permissions: dict | None = None,
):
    payload = {
        "username": username,
        "password": password,
        "role": "standard",
        "data_limit": data_limit,
        "traffic_limit_mode": "created_traffic",
        "show_user_traffic": show_user_traffic,
    }
    if permissions is not None:
        payload["permissions"] = permissions

    response = auth_client.post("/api/admin", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def _create_user_as_admin(
    client: TestClient,
    headers: dict[str, str],
    *,
    username: str,
    data_limit: int,
    next_plan: dict | None = None,
):
    payload = {
        "username": username,
        "proxies": {"vmess": {"id": str(uuid4())}},
        "expire": 1735689600,
        "data_limit": data_limit,
        "data_limit_reset_strategy": "no_reset",
    }
    if next_plan is not None:
        payload["next_plan"] = next_plan

    with patch("app.routers.user.xray.config.inbounds_by_protocol", _INBOUNDS):
        response = client.post("/api/user", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_created_traffic_mode_hides_user_usage_and_updates_myaccount(auth_client: TestClient):
    unique = uuid4().hex[:8]
    admin_username = f"ct_hide_{unique}"
    admin_password = "cthidepass123"
    user_username = f"ct_user_{unique}"

    _create_created_mode_admin(
        auth_client,
        username=admin_username,
        password=admin_password,
        data_limit=20 * GB,
        show_user_traffic=False,
    )
    admin_headers = _login_headers(auth_client, admin_username, admin_password)

    _create_user_as_admin(
        auth_client,
        admin_headers,
        username=user_username,
        data_limit=5 * GB,
    )

    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, user_username)
        assert dbuser is not None
        dbuser.used_traffic = 2 * GB
        db.commit()
    finally:
        db.close()

    user_response = auth_client.get(f"/api/user/{user_username}", headers=admin_headers)
    assert user_response.status_code == 200
    assert user_response.json()["used_traffic"] == 0
    assert user_response.json()["lifetime_used_traffic"] == 0

    usage_response = auth_client.get(f"/api/user/{user_username}/usage", headers=admin_headers)
    assert usage_response.status_code == 403

    myaccount_response = auth_client.get("/api/myaccount", headers=admin_headers)
    assert myaccount_response.status_code == 200
    myaccount_payload = myaccount_response.json()
    assert myaccount_payload["traffic_basis"] == "created_traffic"
    assert myaccount_payload["used_traffic"] == 5 * GB
    assert myaccount_payload["remaining_data"] == 15 * GB

    admin_usage_response = auth_client.get(f"/api/admin/usage/{admin_username}")
    assert admin_usage_response.status_code == 200
    assert admin_usage_response.json() == 5 * GB

    admin_nodes_response = auth_client.get(f"/api/admin/{admin_username}/usage/nodes")
    assert admin_nodes_response.status_code == 200
    assert admin_nodes_response.json()["usages"] == []


def test_created_traffic_limit_locks_management_but_allows_status_toggle(auth_client: TestClient):
    unique = uuid4().hex[:8]
    admin_username = f"ct_lock_{unique}"
    admin_password = "ctlockpass123"
    user_username = f"ct_lock_user_{unique}"

    _create_created_mode_admin(
        auth_client,
        username=admin_username,
        password=admin_password,
        data_limit=1 * GB,
        permissions={
            "users": {
                "delete": True,
                "reset_usage": True,
                "revoke": True,
            }
        },
    )
    admin_headers = _login_headers(auth_client, admin_username, admin_password)

    _create_user_as_admin(
        auth_client,
        admin_headers,
        username=user_username,
        data_limit=1 * GB,
    )

    db = TestingSessionLocal()
    try:
        dbadmin = db.query(DBAdmin).filter(DBAdmin.username == admin_username).first()
        dbuser = db.query(DBUser).filter(DBUser.username == user_username).first()
        assert dbadmin is not None
        assert dbuser is not None
        assert dbadmin.status == AdminStatus.active
        assert dbadmin.created_traffic == 1 * GB
        assert dbuser.status == UserStatus.active
    finally:
        db.close()

    with patch("app.routers.user.xray.config.inbounds_by_protocol", _INBOUNDS):
        create_response = auth_client.post(
            "/api/user",
            json={
                "username": f"ct_lock_user2_{unique}",
                "proxies": {"vmess": {"id": str(uuid4())}},
                "expire": 1735689600,
                "data_limit": 1 * GB,
                "data_limit_reset_strategy": "no_reset",
            },
            headers=admin_headers,
        )
    assert create_response.status_code == 403

    modify_response = auth_client.put(
        f"/api/user/{user_username}",
        json={"note": "should be blocked"},
        headers=admin_headers,
    )
    assert modify_response.status_code == 403

    reset_response = auth_client.post(f"/api/user/{user_username}/reset", headers=admin_headers)
    assert reset_response.status_code == 403

    revoke_response = auth_client.post(f"/api/user/{user_username}/revoke_sub", headers=admin_headers)
    assert revoke_response.status_code == 403

    delete_response = auth_client.delete(f"/api/user/{user_username}", headers=admin_headers)
    assert delete_response.status_code == 403

    disable_response = auth_client.put(
        f"/api/user/{user_username}",
        json={"status": "disabled"},
        headers=admin_headers,
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["status"] == "disabled"

    enable_response = auth_client.put(
        f"/api/user/{user_username}",
        json={"status": "active"},
        headers=admin_headers,
    )
    assert enable_response.status_code == 200
    assert enable_response.json()["status"] == "active"


def test_created_traffic_reset_usage_requires_90_percent_and_increments_admin_total(auth_client: TestClient):
    unique = uuid4().hex[:8]
    admin_username = f"ct_reset_{unique}"
    admin_password = "ctresetpass123"
    user_username = f"ct_reset_user_{unique}"

    _create_created_mode_admin(
        auth_client,
        username=admin_username,
        password=admin_password,
        data_limit=30 * GB,
        permissions={"users": {"reset_usage": True}},
    )
    admin_headers = _login_headers(auth_client, admin_username, admin_password)

    _create_user_as_admin(
        auth_client,
        admin_headers,
        username=user_username,
        data_limit=10 * GB,
    )

    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, user_username)
        assert dbuser is not None
        dbuser.used_traffic = 8 * GB
        dbuser.status = UserStatus.active
        db.commit()
    finally:
        db.close()

    early_reset_response = auth_client.post(f"/api/user/{user_username}/reset", headers=admin_headers)
    assert early_reset_response.status_code == 400
    assert "90%" in early_reset_response.json()["detail"]

    db = TestingSessionLocal()
    try:
        dbuser = crud.get_user(db, user_username)
        assert dbuser is not None
        dbuser.used_traffic = 9 * GB
        dbuser.status = UserStatus.active
        db.commit()
    finally:
        db.close()

    reset_response = auth_client.post(f"/api/user/{user_username}/reset", headers=admin_headers)
    assert reset_response.status_code == 200, reset_response.text

    db = TestingSessionLocal()
    try:
        dbadmin = crud.get_admin(db, admin_username)
        dbuser = crud.get_user(db, user_username)
        assert dbadmin is not None
        assert dbuser is not None
        assert dbadmin.created_traffic == 20 * GB
        assert dbuser.used_traffic == 0
    finally:
        db.close()


def test_next_plan_does_not_increase_admin_created_traffic(auth_client: TestClient):
    unique = uuid4().hex[:8]
    admin_username = f"ct_next_{unique}"
    admin_password = "ctnextpass123"
    user_username = f"ct_next_user_{unique}"

    _create_created_mode_admin(
        auth_client,
        username=admin_username,
        password=admin_password,
        data_limit=30 * GB,
    )
    admin_headers = _login_headers(auth_client, admin_username, admin_password)

    _create_user_as_admin(
        auth_client,
        admin_headers,
        username=user_username,
        data_limit=5 * GB,
        next_plan={
            "data_limit": 10 * GB,
            "expire": 1767225600,
            "add_remaining_traffic": True,
            "fire_on_either": True,
            "increase_data_limit": False,
            "start_on_first_connect": False,
            "trigger_on": "either",
        },
    )

    db = TestingSessionLocal()
    try:
        before_admin = crud.get_admin(db, admin_username)
        assert before_admin is not None
        assert before_admin.created_traffic == 5 * GB
    finally:
        db.close()

    next_plan_response = auth_client.post(f"/api/user/{user_username}/active-next", headers=admin_headers)
    assert next_plan_response.status_code == 200, next_plan_response.text

    db = TestingSessionLocal()
    try:
        after_admin = crud.get_admin(db, admin_username)
        after_user = crud.get_user(db, user_username)
        assert after_admin is not None
        assert after_user is not None
        assert after_admin.created_traffic == 5 * GB
        assert after_user.data_limit == 10 * GB
    finally:
        db.close()
