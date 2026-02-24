from unittest.mock import patch


def _create_user(auth_client, username: str) -> str:
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
        return resp.json()["credential_key"]


def test_subscription_alias_path_and_query(auth_client):
    credential_key = _create_user(auth_client, "alias_user")

    settings_payload = {
        "subscription_aliases": [
            "/mypath/{identifier}",
            "/test/{token}",
            "/api/v1/client/subscribe?token={identifier}",
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

    # all aliases should resolve to the same subscription payload
    assert p1.text == baseline.text
    assert p2.text == baseline.text
    assert q1.text == baseline.text
