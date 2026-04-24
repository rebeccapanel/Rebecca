from unittest.mock import patch


def _create_user_payload(auth_client, username: str) -> dict:
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
        }
        resp = auth_client.post("/api/user", json=payload)
        assert resp.status_code == 201, resp.text
        return resp.json()


def _create_user(auth_client, username: str) -> str:
    return _create_user_payload(auth_client, username)["credential_key"]


def test_subscription_alias_path_and_query(auth_client):
    credential_key = _create_user(auth_client, "alias_user")

    settings_payload = {
        "subscription_aliases": [
            "/mypath/",
            "/test/",
            "/api/v1/client/subscribe?token=",
            "/api/v1/client/subscribe?key=",
        ]
    }
    upd = auth_client.put("/api/settings/subscriptions", json=settings_payload)
    assert upd.status_code == 200, upd.text

    baseline = auth_client.get(f"/sub/{credential_key}")
    assert baseline.status_code == 200, baseline.text

    p1 = auth_client.get(f"/mypath/{credential_key}")
    assert p1.status_code == 200, p1.text

    p2 = auth_client.get(f"/test/{credential_key}")
    assert p2.status_code == 200, p2.text

    q1 = auth_client.get(f"/api/v1/client/subscribe?token={credential_key}")
    assert q1.status_code == 200, q1.text

    # wildcard query alias with empty template value
    q2 = auth_client.get(f"/api/v1/client/subscribe?key={credential_key}")
    assert q2.status_code == 200, q2.text

    # packed legacy format like username+key should resolve to key
    q3 = auth_client.get(f"/api/v1/client/subscribe?token=alias_user+{credential_key}")
    assert q3.status_code == 200, q3.text

    # all aliases should resolve to the same subscription payload
    assert p1.text == baseline.text
    assert p2.text == baseline.text
    assert q1.text == baseline.text
    assert q2.text == baseline.text
    assert q3.text == baseline.text


def test_subscription_path_update_is_persisted(auth_client):
    response = auth_client.put(
        "/api/settings/subscriptions",
        json={"subscription_path": "mysub"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["subscription_path"] == "mysub"


def test_user_responses_use_db_subscription_path_and_multi_ports(auth_client):
    panel_resp = auth_client.put(
        "/api/settings/panel",
        json={"default_subscription_type": "username-key"},
    )
    assert panel_resp.status_code == 200, panel_resp.text

    settings_resp = auth_client.put(
        "/api/settings/subscriptions",
        json={
            "subscription_url_prefix": "https://sub.example.com",
            "subscription_path": "mysub",
            "subscription_ports": [443, 8443],
        },
    )
    assert settings_resp.status_code == 200, settings_resp.text

    created = _create_user_payload(auth_client, "multi_port_user")
    credential_key = created["credential_key"]

    assert created["subscription_url"].startswith(
        f"https://sub.example.com/mysub/multi_port_user/{credential_key}"
    )
    assert created["subscription_urls"]["key"].startswith("https://sub.example.com/mysub/")
    assert created["subscription_urls"]["username-key@443"].startswith(
        "https://sub.example.com:443/mysub/multi_port_user/"
    )
    assert created["subscription_urls"]["key@8443"].startswith("https://sub.example.com:8443/mysub/")
    assert created["subscription_urls"]["token@8443"].startswith("https://sub.example.com:8443/mysub/")

    detail_resp = auth_client.get("/api/user/multi_port_user")
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail["subscription_url"].startswith(
        f"https://sub.example.com/mysub/multi_port_user/{credential_key}"
    )
    assert detail["subscription_urls"]["username-key@8443"].startswith(
        "https://sub.example.com:8443/mysub/multi_port_user/"
    )

    list_resp = auth_client.get("/api/users", params=[("username", "multi_port_user")])
    assert list_resp.status_code == 200, list_resp.text
    users = list_resp.json()["users"]
    assert len(users) == 1
    list_user = users[0]
    assert list_user["subscription_url"].startswith(
        f"https://sub.example.com/mysub/multi_port_user/{credential_key}"
    )
    assert list_user["subscription_urls"]["key@443"].startswith("https://sub.example.com:443/mysub/")


def test_custom_primary_path_supports_key_routes_info_usage_and_client_types(auth_client):
    settings_resp = auth_client.put(
        "/api/settings/subscriptions",
        json={"subscription_path": "customsub"},
    )
    assert settings_resp.status_code == 200, settings_resp.text

    credential_key = _create_user(auth_client, "custom_path_user")

    baseline_key = auth_client.get(f"/sub/custom_path_user/{credential_key}")
    assert baseline_key.status_code == 200, baseline_key.text

    custom_key = auth_client.get(f"/customsub/custom_path_user/{credential_key}")
    assert custom_key.status_code == 200, custom_key.text
    assert custom_key.text == baseline_key.text

    baseline_info = auth_client.get(f"/sub/custom_path_user/{credential_key}/info")
    assert baseline_info.status_code == 200, baseline_info.text

    custom_info = auth_client.get(f"/customsub/custom_path_user/{credential_key}/info")
    assert custom_info.status_code == 200, custom_info.text
    assert custom_info.json()["username"] == baseline_info.json()["username"]

    baseline_usage = auth_client.get(f"/sub/custom_path_user/{credential_key}/usage")
    assert baseline_usage.status_code == 200, baseline_usage.text

    custom_usage = auth_client.get(f"/customsub/custom_path_user/{credential_key}/usage")
    assert custom_usage.status_code == 200, custom_usage.text
    assert custom_usage.json()["username"] == baseline_usage.json()["username"]

    baseline_client = auth_client.get(f"/sub/custom_path_user/{credential_key}/v2ray")
    assert baseline_client.status_code == 200, baseline_client.text

    custom_client = auth_client.get(f"/customsub/custom_path_user/{credential_key}/v2ray")
    assert custom_client.status_code == 200, custom_client.text
    assert custom_client.text == baseline_client.text
