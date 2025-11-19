from app.models.admin import AdminRole

def test_get_current_admin(client, auth_headers):
    response = client.get("/api/admin", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "sudo_admin"
    assert data["role"] == AdminRole.sudo

def test_get_admins(client, auth_headers):
    response = client.get("/api/admins", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert len(data["admins"]) >= 1
    assert data["admins"][0]["username"] == "sudo_admin"

def test_create_admin(client, auth_headers):
    new_admin = {
        "username": "test_admin",
        "password": "password123",
        "role": "standard"
    }
    response = client.post("/api/admin", json=new_admin, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "test_admin"
    assert data["role"] == "standard"

def test_modify_admin(client, auth_headers):
    # First create an admin to modify
    new_admin = {
        "username": "mod_admin",
        "password": "password123",
        "role": "standard"
    }
    client.post("/api/admin", json=new_admin, headers=auth_headers)

    # Modify the admin
    mod_data = {
        "password": "newpassword123",
        "role": "sudo"
    }
    response = client.put("/api/admin/mod_admin", json=mod_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "sudo"

def test_remove_admin(client, auth_headers):
    # First create an admin to remove
    new_admin = {
        "username": "del_admin",
        "password": "password123",
        "role": "standard"
    }
    client.post("/api/admin", json=new_admin, headers=auth_headers)

    response = client.delete("/api/admin/del_admin", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["detail"] == "Admin removed successfully"

    # Verify it's gone
    response = client.get("/api/admins", headers=auth_headers)
    admins = response.json()["admins"]
    assert not any(a["username"] == "del_admin" for a in admins)
