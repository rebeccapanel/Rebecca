from unittest.mock import patch

from app.db import GetDB, crud
from app.db import models as db_models
from app.models.proxy import ProxyHostALPN, ProxyHostFingerprint, ProxyHostSecurity
from app.models.user import UserDataLimitResetStrategy, UserStatus


def _create_user_payload(auth_client, username: str, *, headers: dict | None = None) -> dict:
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
        }
        resp = auth_client.post("/api/user", json=payload, headers=headers or {})
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
        f"https://sub.example.com:443/mysub/multi_port_user/{credential_key}"
    )
    assert created["subscription_urls"]["key"].startswith("https://sub.example.com:443/mysub/")
    assert created["subscription_urls"]["username-key"].startswith(
        "https://sub.example.com:443/mysub/multi_port_user/"
    )
    assert created["subscription_urls"]["key@8443"].startswith("https://sub.example.com:8443/mysub/")
    assert created["subscription_urls"]["token@8443"].startswith("https://sub.example.com:8443/mysub/")

    detail_resp = auth_client.get("/api/user/multi_port_user")
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail["subscription_url"].startswith(
        f"https://sub.example.com:443/mysub/multi_port_user/{credential_key}"
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
        f"https://sub.example.com:443/mysub/multi_port_user/{credential_key}"
    )
    assert list_user["subscription_urls"]["key"].startswith("https://sub.example.com:443/mysub/")


def test_subscription_ports_override_prefix_panel_port(auth_client):
    panel_resp = auth_client.put(
        "/api/settings/panel",
        json={"default_subscription_type": "key"},
    )
    assert panel_resp.status_code == 200, panel_resp.text

    settings_resp = auth_client.put(
        "/api/settings/subscriptions",
        json={
            "subscription_url_prefix": "https://panel.example.com:8000",
            "subscription_path": "mysub",
            "subscription_ports": [2096],
        },
    )
    assert settings_resp.status_code == 200, settings_resp.text

    created = _create_user_payload(auth_client, "prefix_port_user")
    credential_key = created["credential_key"]

    assert created["subscription_url"].startswith(f"https://panel.example.com:2096/mysub/{credential_key}")
    assert created["subscription_urls"]["key"].startswith(f"https://panel.example.com:2096/mysub/{credential_key}")
    assert ":8000" not in created["subscription_url"]


def test_imported_3xui_subadress_is_primary_subscription_link(auth_client):
    with GetDB() as db:
        imported = db_models.User(
            username="imported_sub_user",
            credential_key="0123456789abcdef0123456789abcdef",
            subadress="legacy-3xui-sub",
            status=UserStatus.active,
            used_traffic=0,
            data_limit=0,
            data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
            proxies=[
                db_models.Proxy(
                    type="vless",
                    settings={"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"},
                    excluded_inbounds=[],
                )
            ],
        )
        db.add(imported)
        db.commit()

    detail_resp = auth_client.get("/api/user/imported_sub_user")
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail["subscription_url"].endswith("/legacy-3xui-sub")
    assert detail["subscription_urls"]["subadress"].endswith("/legacy-3xui-sub")
    assert detail["subscription_urls"]["key"].endswith("/0123456789abcdef0123456789abcdef")

    legacy_resp = auth_client.get("/sub/legacy-3xui-sub")
    assert legacy_resp.status_code == 200, legacy_resp.text

    username_legacy_resp = auth_client.get("/sub/imported_sub_user/legacy-3xui-sub")
    assert username_legacy_resp.status_code == 200, username_legacy_resp.text


def test_service_subscription_links_fallback_to_database_hosts(auth_client):
    inbound = {
        "tag": "svc-vless",
        "protocol": "vless",
        "port": 443,
        "network": "ws",
        "tls": "tls",
        "sni": [],
        "host": [],
        "path": "/",
        "header_type": "none",
        "is_fallback": False,
    }

    with patch("app.runtime.xray.config.inbounds_by_tag", {"svc-vless": inbound}):
        with GetDB() as db:
            admin = crud.get_admin(db, "testadmin")
            service = db_models.Service(name="subscription-host-fallback")
            db.add(service)
            db.flush()
            db.add(db_models.AdminServiceLink(admin_id=admin.id, service_id=service.id))
            db.add(db_models.ProxyInbound(tag="svc-vless"))
            db.flush()
            host = db_models.ProxyHost(
                remark="Service {USERNAME}",
                address="{SERVER_IP}",
                port=443,
                inbound_tag="svc-vless",
                path=None,
                sni=None,
                host=None,
                security=ProxyHostSecurity.inbound_default,
                alpn=ProxyHostALPN.none,
                fingerprint=ProxyHostFingerprint.none,
                allowinsecure=None,
                is_disabled=False,
            )
            db.add(host)
            db.flush()
            db.add(db_models.ServiceHostLink(service_id=service.id, host_id=host.id, sort=0))
            imported = db_models.User(
                username="service_sub_user",
                credential_key="1123456789abcdef0123456789abcdef",
                subadress="service-subadress",
                status=UserStatus.active,
                used_traffic=0,
                data_limit=0,
                data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
                admin_id=admin.id,
                service_id=service.id,
                proxies=[
                    db_models.Proxy(
                        type="vless",
                        settings={"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"},
                        excluded_inbounds=[],
                    )
                ],
            )
            db.add(imported)
            db.commit()

        detail_resp = auth_client.get("/api/user/service_sub_user")
        assert detail_resp.status_code == 200, detail_resp.text
        detail = detail_resp.json()
        assert detail["links"]
        assert detail["links"][0].startswith("vless://")

        sub_resp = auth_client.get("/sub/service-subadress")
        assert sub_resp.status_code == 200, sub_resp.text
        assert sub_resp.text

        json_resp = auth_client.get("/sub/service-subadress/json")
        assert json_resp.status_code == 200, json_resp.text
        assert json_resp.headers["content-type"].startswith("application/json")

        v2ray_json_resp = auth_client.get("/sub/service-subadress/v2ray-json")
        assert v2ray_json_resp.status_code == 200, v2ray_json_resp.text
        assert v2ray_json_resp.headers["content-type"].startswith("application/json")


def test_subscription_ports_use_request_host_when_prefix_is_empty(auth_client):
    panel_resp = auth_client.put(
        "/api/settings/panel",
        json={"default_subscription_type": "key"},
    )
    assert panel_resp.status_code == 200, panel_resp.text

    settings_resp = auth_client.put(
        "/api/settings/subscriptions",
        json={
            "subscription_url_prefix": "",
            "subscription_path": "mysub",
            "subscription_ports": [8443, 9443],
        },
    )
    assert settings_resp.status_code == 200, settings_resp.text

    created = _create_user_payload(
        auth_client,
        "request_port_user",
        headers={
            "host": "panel.example.com:2096",
            "x-forwarded-proto": "https",
        },
    )
    credential_key = created["credential_key"]

    assert created["subscription_url"].startswith(f"https://panel.example.com:8443/mysub/{credential_key}")
    assert created["subscription_urls"]["key"].startswith(f"https://panel.example.com:8443/mysub/{credential_key}")
    assert created["subscription_urls"]["key@9443"].startswith(
        f"https://panel.example.com:9443/mysub/{credential_key}"
    )
    assert "panel.example.com:2096" not in created["subscription_url"]

    detail_resp = auth_client.get(
        "/api/user/request_port_user",
        headers={
            "host": "panel.example.com:2096",
            "x-forwarded-proto": "https",
        },
    )
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail["subscription_url"].startswith(f"https://panel.example.com:8443/mysub/{credential_key}")
    assert detail["subscription_urls"]["key@9443"].startswith(
        f"https://panel.example.com:9443/mysub/{credential_key}"
    )

    list_resp = auth_client.get(
        "/api/users",
        params=[("username", "request_port_user")],
        headers={
            "host": "panel.example.com:2096",
            "x-forwarded-proto": "https",
        },
    )
    assert list_resp.status_code == 200, list_resp.text
    list_user = list_resp.json()["users"][0]
    assert list_user["subscription_url"].startswith(f"https://panel.example.com:8443/mysub/{credential_key}")


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


def test_subadress_subscription_route_and_info_fallback(auth_client):
    created = _create_user_payload(auth_client, "legacy_sub_user")
    credential_key = created["credential_key"]

    with GetDB() as db:
        dbuser = crud.get_user(db, "legacy_sub_user")
        dbuser.subadress = "legacy3xsub01"
        db.commit()

    baseline = auth_client.get(f"/sub/{credential_key}")
    assert baseline.status_code == 200, baseline.text

    compat = auth_client.get("/sub/legacy3xsub01")
    assert compat.status_code == 200, compat.text
    assert compat.text == baseline.text

    info = auth_client.get("/sub/legacy3xsub01/info")
    assert info.status_code == 200, info.text
    payload = info.json()
    assert payload["username"] == "legacy_sub_user"
    assert "subadress" not in payload


def test_subadress_is_not_accepted_in_normal_user_create_flow(auth_client):
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        response = auth_client.post(
            "/api/user",
            json={
                "username": "hidden_subadress_user",
                "proxies": {"vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"}},
                "subadress": "should-not-persist",
            },
        )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert "subadress" not in payload

    with GetDB() as db:
        dbuser = crud.get_user(db, "hidden_subadress_user")
        assert dbuser is not None
        assert dbuser.subadress == ""
