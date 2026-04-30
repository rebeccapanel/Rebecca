import sqlite3
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from sqlalchemy.exc import OperationalError

_UTILS_SPEC = spec_from_file_location(
    "usage_utils_for_test",
    Path(__file__).resolve().parents[1] / "app" / "jobs" / "usage" / "utils.py",
)
assert _UTILS_SPEC and _UTILS_SPEC.loader
usage_utils = module_from_spec(_UTILS_SPEC)
_UTILS_SPEC.loader.exec_module(usage_utils)


class _Bind:
    name = "sqlite"


class _Connection:
    def __init__(self):
        self.calls = 0

    def execute(self, stmt, params=None):
        self.calls += 1
        if self.calls == 1:
            raise OperationalError("UPDATE users SET used_traffic = used_traffic + 1", {}, sqlite3.OperationalError("database is locked"))


class _Session:
    bind = _Bind()

    def __init__(self):
        self.conn = _Connection()
        self.commits = 0
        self.rollbacks = 0

    def connection(self):
        return self.conn

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_safe_execute_retries_sqlite_database_locked(monkeypatch):
    monkeypatch.setattr(usage_utils, "retry_delay", lambda tries: None)
    db = _Session()

    usage_utils.safe_execute(db, object())

    assert db.conn.calls == 2
    assert db.rollbacks == 1
    assert db.commits == 1


def test_core_websocket_routes_are_not_wrapped_by_http_request_origin_dependency():
    from app.routers import api_router
    from app.utils.request_context import capture_subscription_request_origin

    websocket_routes = [
        route for route in api_router.routes if getattr(route, "path", "") in {"/api/core/logs", "/api/core/access/logs/ws"}
    ]
    assert websocket_routes
    for route in websocket_routes:
        dependency_calls = [dependency.dependency for dependency in getattr(route, "dependencies", [])]
        assert capture_subscription_request_origin not in dependency_calls
