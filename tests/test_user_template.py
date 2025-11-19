from fastapi.testclient import TestClient


def test_create_user_template(auth_client: TestClient):
    template_data = {
        "name": "Test Template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,  # 30 days
        "username_prefix": "user_",
        "username_suffix": "@example.com",
    }
    response = auth_client.post("/api/user_template", json=template_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Template"
    template_id = data["id"]

    # Clean up
    auth_client.delete(f"/api/user_template/{template_id}")


def test_get_user_template(auth_client: TestClient):
    # Create template first
    template_data = {
        "name": "Get Test Template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "username_prefix": "user_",
        "username_suffix": "@example.com",
    }
    create_response = auth_client.post("/api/user_template", json=template_data)
    template_id = create_response.json()["id"]

    # Get template
    response = auth_client.get(f"/api/user_template/{template_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Get Test Template"

    # Clean up
    auth_client.delete(f"/api/user_template/{template_id}")


def test_update_user_template(auth_client: TestClient):
    # Create template first
    template_data = {
        "name": "Update Test Template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "username_prefix": "user_",
        "username_suffix": "@example.com",
    }
    create_response = auth_client.post("/api/user_template", json=template_data)
    template_id = create_response.json()["id"]

    # Update template
    update_data = {"name": "Updated Template", "data_limit": 2147483648}
    response = auth_client.put(f"/api/user_template/{template_id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Template"
    assert data["data_limit"] == 2147483648

    # Clean up
    auth_client.delete(f"/api/user_template/{template_id}")


def test_delete_user_template(auth_client: TestClient):
    # Create template first
    template_data = {
        "name": "Delete Test Template",
        "data_limit": 1073741824,
        "expire_duration": 2592000,
        "username_prefix": "user_",
        "username_suffix": "@example.com",
    }
    create_response = auth_client.post("/api/user_template", json=template_data)
    template_id = create_response.json()["id"]

    # Delete template
    response = auth_client.delete(f"/api/user_template/{template_id}")
    assert response.status_code == 200

    # Verify deleted
    response = auth_client.get(f"/api/user_template/{template_id}")
    assert response.status_code == 404


def test_list_user_templates(auth_client: TestClient):
    # Create a couple templates
    templates = []
    for i in range(2):
        template_data = {
            "name": f"List Test Template {i}",
            "data_limit": 1073741824,
            "expire_duration": 2592000,
            "username_prefix": "user_",
            "username_suffix": "@example.com",
        }
        create_response = auth_client.post("/api/user_template", json=template_data)
        templates.append(create_response.json()["id"])

    # List templates
    response = auth_client.get("/api/user_template")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2

    # Clean up
    for template_id in templates:
        auth_client.delete(f"/api/user_template/{template_id}")
