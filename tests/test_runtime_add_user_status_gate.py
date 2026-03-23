from types import SimpleNamespace

from app.reb_node import operations


def test_add_user_skips_non_runtime_status(monkeypatch):
    called = {"add_accounts": 0}

    monkeypatch.setattr(operations, "_prepare_user_for_runtime", lambda u: u)
    monkeypatch.setattr(operations, "UserResponse", SimpleNamespace(model_validate=lambda u: SimpleNamespace(inbounds={})))
    monkeypatch.setattr(operations, "_add_accounts_to_inbound", lambda *a, **k: called.__setitem__("add_accounts", 1))

    user = SimpleNamespace(status="limited")
    operations.add_user(user)

    assert called["add_accounts"] == 0
