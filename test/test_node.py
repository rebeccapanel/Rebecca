from unittest.mock import MagicMock
import app.runtime

def test_get_master_node_state(client, auth_headers):
    response = client.get("/api/node/master", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Master"
    assert "uplink" in data
    assert "downlink" in data

def test_get_nodes(client, auth_headers):
    response = client.get("/api/nodes", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_add_node(client, auth_headers):
    new_node = {
        "name": "test_node",
        "address": "1.2.3.4",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0
    }
    response = client.post("/api/node", json=new_node, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "test_node"
    assert data["address"] == "1.2.3.4"

def test_get_node(client, auth_headers):
    # First create a node
    new_node = {
        "name": "get_node",
        "address": "1.2.3.4",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0
    }
    create_resp = client.post("/api/node", json=new_node, headers=auth_headers)
    node_id = create_resp.json()["id"]

    response = client.get(f"/api/node/{node_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "get_node"

def test_modify_node(client, auth_headers):
    # First create a node
    new_node = {
        "name": "mod_node",
        "address": "1.2.3.4",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0
    }
    create_resp = client.post("/api/node", json=new_node, headers=auth_headers)
    node_id = create_resp.json()["id"]

    # Modify
    mod_data = {
        "name": "mod_node_updated",
        "address": "5.6.7.8"
    }
    response = client.put(f"/api/node/{node_id}", json=mod_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "mod_node_updated"
    assert data["address"] == "5.6.7.8"

def test_remove_node(client, auth_headers):
    # First create a node
    new_node = {
        "name": "del_node",
        "address": "1.2.3.4",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0
    }
    create_resp = client.post("/api/node", json=new_node, headers=auth_headers)
    node_id = create_resp.json()["id"]

    response = client.delete(f"/api/node/{node_id}", headers=auth_headers)
    assert response.status_code == 200

    # Verify it's gone
    response = client.get(f"/api/node/{node_id}", headers=auth_headers)
    assert response.status_code == 404
