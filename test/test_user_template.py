def test_create_user_template(client, auth_headers):
    new_template = {
        "name": "test_template",
        "data_limit": 1073741824,  # 1GB
        "expire_duration": 2592000,  # 30 days in seconds
        "inbounds": {}  # Empty dict means all inbounds
    }
    response = client.post("/api/user_template", json=new_template, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "test_template"
    assert data["data_limit"] == 1073741824
    assert "id" in data

def test_get_user_templates(client, auth_headers):
    # First create a template
    new_template = {
        "name": "list_template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "inbounds": {}
    }
    client.post("/api/user_template", json=new_template, headers=auth_headers)
    
    response = client.get("/api/user_template", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any(t["name"] == "list_template" for t in data)

def test_get_user_template(client, auth_headers):
    # First create a template
    new_template = {
        "name": "get_template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "inbounds": {}
    }
    create_resp = client.post("/api/user_template", json=new_template, headers=auth_headers)
    assert create_resp.status_code == 200
    template_id = create_resp.json()["id"]
    
    response = client.get(f"/api/user_template/{template_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "get_template"

def test_modify_user_template(client, auth_headers):
    # First create a template
    new_template = {
        "name": "mod_template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "inbounds": {}
    }
    create_resp = client.post("/api/user_template", json=new_template, headers=auth_headers)
    assert create_resp.status_code == 200
    template_id = create_resp.json()["id"]
    
    # Modify it
    mod_data = {
        "data_limit": 2147483648  # 2GB
    }
    response = client.put(f"/api/user_template/{template_id}", json=mod_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["data_limit"] == 2147483648

def test_delete_user_template(client, auth_headers):
    # First create a template
    new_template = {
        "name": "del_template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "inbounds": {}
    }
    create_resp = client.post("/api/user_template", json=new_template, headers=auth_headers)
    assert create_resp.status_code == 200
    template_id = create_resp.json()["id"]
    
    response = client.delete(f"/api/user_template/{template_id}", headers=auth_headers)
    assert response.status_code == 200
    
    # Verify it's gone
    response = client.get(f"/api/user_template/{template_id}", headers=auth_headers)
    assert response.status_code == 404

