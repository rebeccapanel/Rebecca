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


def test_disable_admin_users(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "disableusersadmin", "password": "disableuserspass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    response = auth_client.post("/api/admin/disableusersadmin/users/disable")
    assert response.status_code == 200


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


def test_disable_admin(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "disableadmin", "password": "disablepass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    # Disable the admin
    response = auth_client.post("/api/admin/disableadmin/disable", json={"reason": "Test disable"})
    assert response.status_code == 200


def test_disable_admin_users(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "disableusersadmin", "password": "disableuserspass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    response = auth_client.post("/api/admin/disableusersadmin/users/disable")
    assert response.status_code == 200


def test_activate_admin_users(auth_client: TestClient):
    # First create an admin
    admin_data = {"username": "activateusersadmin", "password": "activateuserspass123", "role": "standard"}
    auth_client.post("/api/admin", json=admin_data)

    response = auth_client.post("/api/admin/activateusersadmin/users/activate")
    assert response.status_code == 200


def test_reset_admin(auth_client: TestClient):
    response = auth_client.post("/api/admin/usage/reset/testadmin")
    assert response.status_code == 200


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
