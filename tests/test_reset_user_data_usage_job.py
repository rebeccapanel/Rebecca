from datetime import datetime, timedelta, UTC
from pathlib import Path
import importlib.util
import types
from unittest.mock import MagicMock

from app.models.user import UserDataLimitResetStrategy, UserStatus


def _load_reset_job_module():
    path = Path("app/jobs/reset_user_data_usage.py")
    spec = importlib.util.spec_from_file_location("reset_user_data_usage_for_tests", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader

    import app.runtime as runtime

    original_scheduler = runtime.scheduler
    runtime.scheduler = types.SimpleNamespace(add_job=lambda *args, **kwargs: None)
    try:
        spec.loader.exec_module(module)
    finally:
        runtime.scheduler = original_scheduler
    return module


class _DummyGetDB:
    def __init__(self, db):
        self._db = db

    def __enter__(self):
        return self._db

    def __exit__(self, exc_type, exc, tb):
        return False


def _make_user(*, username: str, strategy, status: UserStatus, days_ago: int):
    return types.SimpleNamespace(
        username=username,
        data_limit_reset_strategy=strategy,
        status=status,
        last_traffic_reset_time=datetime.now(UTC) - timedelta(days=days_ago),
    )


def test_periodic_reset_handles_enum_strategy_and_readds_limited_user():
    module = _load_reset_job_module()

    user = _make_user(
        username="u1",
        strategy=UserDataLimitResetStrategy.day,
        status=UserStatus.limited,
        days_ago=2,
    )
    db = object()

    add_user_mock = MagicMock()
    reset_result = types.SimpleNamespace(username="u1", status=UserStatus.active)
    reset_mock = MagicMock(return_value=reset_result)

    module.GetDB = lambda: _DummyGetDB(db)
    module.get_users = lambda *args, **kwargs: [user]
    module.crud = types.SimpleNamespace(reset_user_data_usage=reset_mock)
    module.xray = types.SimpleNamespace(operations=types.SimpleNamespace(add_user=add_user_mock))

    module.reset_user_data_usage()

    reset_mock.assert_called_once_with(db, user)
    add_user_mock.assert_called_once_with(reset_result)


def test_periodic_reset_skips_unknown_strategy_without_crashing():
    module = _load_reset_job_module()

    user = _make_user(
        username="u2",
        strategy="daily",  # unsupported/legacy label should be ignored safely
        status=UserStatus.active,
        days_ago=10,
    )
    db = object()

    reset_mock = MagicMock()

    module.GetDB = lambda: _DummyGetDB(db)
    module.get_users = lambda *args, **kwargs: [user]
    module.crud = types.SimpleNamespace(reset_user_data_usage=reset_mock)
    module.xray = types.SimpleNamespace(operations=types.SimpleNamespace(add_user=MagicMock()))

    module.reset_user_data_usage()

    reset_mock.assert_not_called()


def test_periodic_reset_continues_after_single_user_failure():
    module = _load_reset_job_module()

    bad_user = _make_user(
        username="bad",
        strategy=UserDataLimitResetStrategy.day,
        status=UserStatus.active,
        days_ago=5,
    )
    good_user = _make_user(
        username="good",
        strategy=UserDataLimitResetStrategy.day,
        status=UserStatus.active,
        days_ago=5,
    )
    db = object()

    def _reset(db_obj, user_obj):
        if user_obj.username == "bad":
            raise RuntimeError("boom")
        return types.SimpleNamespace(username=user_obj.username, status=UserStatus.active)

    reset_mock = MagicMock(side_effect=_reset)

    module.GetDB = lambda: _DummyGetDB(db)
    module.get_users = lambda *args, **kwargs: [bad_user, good_user]
    module.crud = types.SimpleNamespace(reset_user_data_usage=reset_mock)
    module.xray = types.SimpleNamespace(operations=types.SimpleNamespace(add_user=MagicMock()))

    module.reset_user_data_usage()

    assert reset_mock.call_count == 2
