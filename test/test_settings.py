def test_get_telegram_settings(client, auth_headers):
    response = client.get("/api/settings/telegram", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "use_telegram" in data
    assert "api_token" in data

def test_get_panel_settings(client, auth_headers):
    response = client.get("/api/settings/panel", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "use_nobetci" in data

def test_update_panel_settings(client, auth_headers):
    update_data = {
        "use_nobetci": True
    }
    response = client.put("/api/settings/panel", json=update_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["use_nobetci"] is True

