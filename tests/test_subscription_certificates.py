def _patch_maintenance(monkeypatch, calls):
    from app.services import subscription_settings

    def _fake(method, path, json=None, **kwargs):
        calls.append({"method": method, "path": path, "json": json})
        return {}

    monkeypatch.setattr(subscription_settings, "maintenance_request", _fake)


def _issue_sample_certificate(auth_client, monkeypatch):
    calls = []
    _patch_maintenance(monkeypatch, calls)
    payload = {
        "email": "admin@example.com",
        "domains": ["example.com", "www.example.com"],
    }
    resp = auth_client.post("/api/settings/subscriptions/certificates/issue", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return data, calls


def test_issue_certificate_creates_record(auth_client, monkeypatch):
    data, calls = _issue_sample_certificate(auth_client, monkeypatch)

    assert data["domain"] == "example.com"
    assert data["path"].endswith("example.com/")
    assert data["alt_names"] == ["www.example.com"]
    assert data["admin_id"] is None
    assert calls and calls[0]["path"] == "/ssl/issue"
    assert calls[0]["json"]["domains"][0] == "example.com"


def test_renew_certificate_updates_record(auth_client, monkeypatch):
    data, _ = _issue_sample_certificate(auth_client, monkeypatch)
    calls = []
    _patch_maintenance(monkeypatch, calls)

    resp = auth_client.post(
        "/api/settings/subscriptions/certificates/renew",
        json={"domain": data["domain"]},
    )
    assert resp.status_code == 200, resp.text
    renewed = resp.json()

    assert renewed["domain"] == data["domain"]
    assert renewed["path"].endswith(f"{data['domain']}/")
    assert renewed["alt_names"] == data["alt_names"]
    assert "last_renewed_at" in renewed
    assert calls and calls[0]["path"] == "/ssl/renew"
    assert calls[0]["json"]["domain"] == data["domain"]


def test_renew_all_without_domain(auth_client, monkeypatch):
    calls = []
    _patch_maintenance(monkeypatch, calls)

    resp = auth_client.post(
        "/api/settings/subscriptions/certificates/renew",
        json={"domain": None},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() is None
    assert calls and calls[0]["path"] == "/ssl/renew"
    assert calls[0]["json"] == {} or calls[0]["json"] is None
