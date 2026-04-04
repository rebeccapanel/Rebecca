from datetime import datetime, timezone, timedelta
from uuid import uuid4
from unittest.mock import patch

from app.db import crud
from app.services.usage_service import _enforce_user_limits_after_sync
from tests.conftest import TestingSessionLocal


def _create_user(auth_client, username: str):
    with patch(
        "app.routers.user.xray.config.inbounds_by_protocol",
        {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]},
    ):
        payload = {
            "username": username,
            "proxies": {"vmess": {"id": uuid4().hex}},
            "expire": int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()),
            "data_limit": 1024 * 1024,
            "data_limit_reset_strategy": "no_reset",
        }
        r = auth_client.post("/api/user", json=payload)
        assert r.status_code == 201


def test_already_limited_user_is_not_removed_again(auth_client):
    from app import runtime

    username = f"lim_no_rm_{uuid4().hex[:8]}"
    _create_user(auth_client, username)

    db = TestingSessionLocal()
    try:
        user = crud.get_user(db, username)
        assert user is not None

        # already non-runtime status
        user.used_traffic = (user.data_limit or 0) + 1024
        user.status = "limited"
        db.commit()
        db.refresh(user)

        runtime.xray.operations.remove_user.reset_mock()

        _enforce_user_limits_after_sync(db, [user])

        # no transition from active/on_hold => no runtime remove spam
        runtime.xray.operations.remove_user.assert_not_called()
    finally:
        db.close()


def test_active_user_turns_expired_and_is_removed(auth_client):
    from app import runtime

    username = f"exp_rm_{uuid4().hex[:8]}"
    _create_user(auth_client, username)

    db = TestingSessionLocal()
    try:
        user = crud.get_user(db, username)
        assert user is not None

        # active -> expired transition
        user.expire = int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp())
        user.status = "active"
        db.commit()
        db.refresh(user)

        runtime.xray.operations.remove_user.reset_mock()

        _enforce_user_limits_after_sync(db, [user])

        runtime.xray.operations.remove_user.assert_called_once()
    finally:
        db.close()
