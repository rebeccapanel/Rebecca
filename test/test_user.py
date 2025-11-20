def test_add_user(client, auth_headers):
    new_user = {
        "username": "test_user",
        "proxies": {"vmess": {}},
        "inbounds": {},
        "expire": 0,
        "data_limit": 0,
        "status": "active"
    }
    response = client.post("/api/user", json=new_user, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "test_user"
    assert data["status"] == "active"

def test_get_user(client, auth_headers):
    # First create user
    new_user = {
        "username": "get_user",
        "proxies": {"vmess": {}},
        "inbounds": {},
        "expire": 0,
        "data_limit": 0,
        "status": "active"
    }
    client.post("/api/user", json=new_user, headers=auth_headers)

    response = client.get("/api/user/get_user", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "get_user"

def test_modify_user(client, auth_headers):
    # First create user
    new_user = {
        "username": "mod_user",
        "proxies": {"vmess": {}},
        "inbounds": {},
        "expire": 0,
        "data_limit": 0,
        "status": "active"
    }
    client.post("/api/user", json=new_user, headers=auth_headers)

    # Modify
    mod_data = {
        "status": "disabled"
    }
    response = client.put("/api/user/mod_user", json=mod_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "disabled"

def test_remove_user(client, auth_headers):
    # First create user
    new_user = {
        "username": "del_user",
        "proxies": {"vmess": {}},
        "inbounds": {},
        "expire": 0,
        "data_limit": 0,
        "status": "active"
    }
    client.post("/api/user", json=new_user, headers=auth_headers)

    response = client.delete("/api/user/del_user", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["detail"] == "User successfully deleted"

def test_get_users(client, auth_headers):
    # Create a user
    new_user = {
        "username": "list_user",
        "proxies": {"vmess": {}},
        "inbounds": {},
        "expire": 0,
        "data_limit": 0,
        "status": "active"
    }
    client.post("/api/user", json=new_user, headers=auth_headers)

    response = client.get("/api/users", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert any(u["username"] == "list_user" for u in data["users"])
