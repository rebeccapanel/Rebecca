from fastapi.testclient import TestClient


def test_admin_login(client: TestClient):
    response = client.post("/api/admin/token", data={"username": "testadmin", "password": "testpass"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data


def test_get_admin(auth_client: TestClient):
    response = auth_client.get("/api/admin")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testadmin"


def test_get_admins(auth_client: TestClient):
    response = auth_client.get("/api/admins")
    assert response.status_code == 200
    data = response.json()
    assert "admins" in data


def test_create_admin(auth_client: TestClient):
    admin_data = {"username": "newadmin", "password": "newpass123", "role": "standard"}
    response = auth_client.post("/api/admin", json=admin_data)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "newadmin"


def test_update_admin(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "updateadmin", "password": "updatepass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    # Update the admin
    update_data = {"role": "sudo"}
    response = auth_client.put("/api/admin/updateadmin", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "sudo"


def test_delete_admin(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "deleteadmin", "password": "deletepass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    # Delete the admin
    response = auth_client.delete("/api/admin/deleteadmin")
    assert response.status_code == 200


def test_disable_admin_users(auth_client: TestClient, xray_mock):
    import uuid
    from app.db.models import User as DBUser, Admin as DBAdmin
    from app.models.user import UserStatus
    from tests.conftest import TestingSessionLocal

    # Use unique username to avoid conflicts
    unique_id = uuid.uuid4().hex[:8]
    admin_username = f"disableusersadmin_{unique_id}"

    # First create an admin
    admin_data = {"username": admin_username, "password": "disableuserspass123", "role": "standard"}
    create_response = auth_client.post("/api/admin", json=admin_data)
    assert create_response.status_code == 200

    db = TestingSessionLocal()
    try:
        admin = db.query(DBAdmin).filter(DBAdmin.username == admin_username).first()
        assert admin is not None

        user1 = DBUser(username=f"disable_test_user1_{unique_id}", admin_id=admin.id, status=UserStatus.active)
        user2 = DBUser(username=f"disable_test_user2_{unique_id}", admin_id=admin.id, status=UserStatus.active)
        user3 = DBUser(username=f"disable_test_user3_{unique_id}", admin_id=admin.id, status=UserStatus.on_hold)
        db.add_all([user1, user2, user3])
        db.commit()
        db.flush()

        user1_id, user2_id, user3_id = user1.id, user2.id, user3.id

        response = auth_client.post(f"/api/admin/{admin_username}/users/disable")
        assert response.status_code == 200
        assert response.json()["detail"] == "Users successfully disabled"

        db.expire_all()
        user1 = db.query(DBUser).filter(DBUser.id == user1_id).first()
        user2 = db.query(DBUser).filter(DBUser.id == user2_id).first()
        user3 = db.query(DBUser).filter(DBUser.id == user3_id).first()

        assert user1.status == UserStatus.disabled
        assert user2.status == UserStatus.disabled
        assert user3.status == UserStatus.disabled

        xray_mock.config.include_db_users.assert_called_once()
        xray_mock.core.restart.assert_called_once()

    finally:
        # Cleanup
        db.query(DBUser).filter(
            DBUser.username.in_(
                [
                    f"disable_test_user1_{unique_id}",
                    f"disable_test_user2_{unique_id}",
                    f"disable_test_user3_{unique_id}",
                ]
            )
        ).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_get_admin_daily_usage(auth_client: TestClient):
    response = auth_client.get("/api/admin/testadmin/usage/daily")
    assert response.status_code == 200
    data = response.json()
    assert "usages" in data


def test_get_admin_usage_chart(auth_client: TestClient):
    response = auth_client.get("/api/admin/testadmin/usage/chart")
    assert response.status_code == 200
    data = response.json()
    assert "usages" in data


def test_get_admin_nodes_usage(auth_client: TestClient):
    response = auth_client.get("/api/admin/testadmin/usage/nodes")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "usages" in data


def test_enable_admin(auth_client: TestClient):
    # First create and disable an admin
    admin_data = {"username": "enableadmin", "password": "enablepass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)
    auth_client.post("/api/admin/enableadmin/disable", json={"reason": "Test disable"})

    # Enable the admin
    response = auth_client.post("/api/admin/enableadmin/enable")
    assert response.status_code == 200


def test_disable_admin(auth_client: TestClient, xray_mock):
    import uuid
    from app.db.models import User as DBUser, Admin as DBAdmin
    from app.models.user import UserStatus
    from app.models.admin import AdminStatus
    from tests.conftest import TestingSessionLocal

    # Use unique username to avoid conflicts
    unique_id = uuid.uuid4().hex[:8]
    admin_username = f"disableadmin_{unique_id}"

    # First create an admin
    admin_data = {"username": admin_username, "password": "disablepass123", "role": "standard"}
    create_response = auth_client.post("/api/admin", json=admin_data)
    assert create_response.status_code == 200

    # Create some active users for this admin using the test database
    db = TestingSessionLocal()
    try:
        admin = db.query(DBAdmin).filter(DBAdmin.username == admin_username).first()
        assert admin is not None

        # Create test users with unique names
        user1 = DBUser(username=f"test_disable_user1_{unique_id}", admin_id=admin.id, status=UserStatus.active)
        user2 = DBUser(username=f"test_disable_user2_{unique_id}", admin_id=admin.id, status=UserStatus.active)
        user3 = DBUser(username=f"test_disable_user3_{unique_id}", admin_id=admin.id, status=UserStatus.on_hold)
        db.add_all([user1, user2, user3])
        db.commit()
        db.flush()

        # Store user IDs for later verification
        user1_id, user2_id, user3_id = user1.id, user2.id, user3.id

        # Disable the admin
        response = auth_client.post(f"/api/admin/{admin_username}/disable", json={"reason": "Test disable"})
        assert response.status_code == 200

        # Verify admin is disabled in response
        data = response.json()
        assert data["status"] == "disabled"
        assert data["disabled_reason"] == "Test disable"

        # Refresh to get latest data from DB
        db.expire_all()
        admin = db.query(DBAdmin).filter(DBAdmin.username == admin_username).first()
        user1 = db.query(DBUser).filter(DBUser.id == user1_id).first()
        user2 = db.query(DBUser).filter(DBUser.id == user2_id).first()
        user3 = db.query(DBUser).filter(DBUser.id == user3_id).first()

        # Verify admin is disabled in DB
        assert admin.status == AdminStatus.disabled
        assert admin.disabled_reason == "Test disable"

        # Verify all active and on_hold users are disabled in DB
        assert user1.status == UserStatus.disabled
        assert user2.status == UserStatus.disabled
        assert user3.status == UserStatus.disabled

        # Verify xray was restarted with updated config
        xray_mock.config.include_db_users.assert_called_once()
        xray_mock.core.restart.assert_called_once()

        # Get the config that was passed to restart
        restart_call_args = xray_mock.core.restart.call_args
        assert restart_call_args is not None

    finally:
        # Cleanup
        db.query(DBUser).filter(
            DBUser.username.in_(
                [
                    f"test_disable_user1_{unique_id}",
                    f"test_disable_user2_{unique_id}",
                    f"test_disable_user3_{unique_id}",
                ]
            )
        ).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_activate_admin_users(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "activateusersadmin", "password": "activateuserspass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    response = auth_client.post("/api/admin/activateusersadmin/users/activate")
    assert response.status_code == 200


def test_reset_admin(auth_client: TestClient):
    response = auth_client.post("/api/admin/usage/reset/testadmin")
    assert response.status_code == 200
