from unittest.mock import patch

def test_get_core_stats(client, auth_headers):
    response = client.get("/api/core", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    # Version should be a string (could be "1.0.0" from mock or actual version)
    assert isinstance(data["version"], str)
    assert len(data["version"]) > 0
    assert data["started"] is True

def test_get_core_config(client, auth_headers):
    # Mock crud.get_xray_config since it reads from DB/File
    with patch("app.db.crud.get_xray_config") as mock_get_config:
        mock_get_config.return_value = {"log": {"loglevel": "warning"}}
        response = client.get("/api/core/config", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == {"log": {"loglevel": "warning"}}
