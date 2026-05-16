import time
from types import SimpleNamespace

import pytest
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy.exc import OperationalError

import app.runtime
from app.db.models import NodeUsage, OutboundTraffic, System, User

app.runtime.scheduler = SimpleNamespace(add_job=lambda *args, **kwargs: None)

from app.jobs.usage import node_usage, outbound_traffic
from app.jobs.usage import user_usage
from app.jobs.usage.delivery_buffer import usage_delivery_buffer
from app.jobs.usage.utils import is_retryable_db_error
from tests.conftest import TestingSessionLocal


def _fake_xray(master_api, node_api=None):
    nodes = {}
    if node_api is not None:
        nodes[1] = SimpleNamespace(connected=True, started=True, api=node_api)
    return SimpleNamespace(
        core=SimpleNamespace(available=True, started=True),
        api=master_api,
        nodes=nodes,
        config={"outbounds": [{"tag": "proxy", "protocol": "freedom"}]},
    )


def test_record_node_usages_persists_master_and_node_outbound_traffic(monkeypatch):
    usage_delivery_buffer.clear()
    master_api = object()
    remote_api = object()
    fake_xray = _fake_xray(master_api, remote_api)
    monkeypatch.setattr(node_usage, "xray", fake_xray)
    monkeypatch.setattr(outbound_traffic, "xray", fake_xray)
    monkeypatch.setattr(node_usage, "DISABLE_RECORDING_NODE_USAGE", True)

    def fake_stats(api):
        if api is master_api:
            return [{"tag": "proxy", "up": 10, "down": 20}]
        return [{"tag": "proxy", "up": 100, "down": 200}]

    monkeypatch.setattr(node_usage, "get_outbounds_stats", fake_stats)

    db = TestingSessionLocal()
    try:
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    node_usage.record_node_usages()

    db = TestingSessionLocal()
    try:
        master_record = (
            db.query(OutboundTraffic)
            .filter(OutboundTraffic.tag == "proxy", OutboundTraffic.target_id == "master")
            .first()
        )
        node_record = (
            db.query(OutboundTraffic)
            .filter(OutboundTraffic.tag == "proxy", OutboundTraffic.target_id == "node:1")
            .first()
        )
        assert master_record is not None
        assert master_record.uplink == 10
        assert master_record.downlink == 20
        assert node_record is not None
        assert node_record.uplink == 100
        assert node_record.downlink == 200
    finally:
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        db.commit()
        db.close()
        usage_delivery_buffer.clear()


def test_record_node_usages_acks_node_buffer_after_persist(monkeypatch):
    usage_delivery_buffer.clear()

    class BufferedNode:
        connected = True
        started = True
        usage_coefficient = 1

        def __init__(self):
            self.acked = []

        def collect_outbound_stats(self):
            return {"batch_id": "node-batch-1", "stats": [{"tag": "proxy", "up": 7, "down": 11}]}

        def ack_outbound_stats(self, batch_id):
            self.acked.append(batch_id)

    node = BufferedNode()
    fake_xray = SimpleNamespace(
        core=SimpleNamespace(available=False, started=False),
        api=None,
        nodes={1: node},
        config={"outbounds": [{"tag": "proxy", "protocol": "freedom"}]},
    )
    monkeypatch.setattr(node_usage, "xray", fake_xray)
    monkeypatch.setattr(outbound_traffic, "xray", fake_xray)
    monkeypatch.setattr(node_usage, "DISABLE_RECORDING_NODE_USAGE", True)

    db = TestingSessionLocal()
    try:
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    node_usage.record_node_usages()

    db = TestingSessionLocal()
    try:
        record = (
            db.query(OutboundTraffic)
            .filter(OutboundTraffic.tag == "proxy", OutboundTraffic.target_id == "node:1")
            .first()
        )
        assert record is not None
        assert record.uplink == 7
        assert record.downlink == 11
        assert node.acked == ["node-batch-1"]
    finally:
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        db.commit()
        db.close()
        usage_delivery_buffer.clear()


def test_collect_usage_params_uses_node_user_buffer(monkeypatch):
    usage_delivery_buffer.clear()

    class BufferedNode:
        def collect_user_stats(self):
            return {"batch_id": "user-batch-1", "stats": [{"uid": "42", "value": 123}]}

    api_params, node_batches = user_usage._collect_usage_params({1: BufferedNode()})

    assert api_params == {1: [{"uid": "42", "value": 123}]}
    assert node_batches == {1: "user-batch-1"}
    usage_delivery_buffer.clear()


def test_collect_usage_params_replaces_cumulative_node_user_batches(monkeypatch):
    usage_delivery_buffer.clear()

    class BufferedNode:
        def collect_user_stats(self):
            return {"batch_id": "user-batch-1", "stats": [{"uid": "42", "value": 123}]}

    first_params, _ = user_usage._collect_usage_params({1: BufferedNode()})
    second_params, _ = user_usage._collect_usage_params({1: BufferedNode()})

    assert first_params == {1: [{"uid": "42", "value": 123}]}
    assert second_params == {1: [{"uid": "42", "value": 123}]}
    usage_delivery_buffer.clear()


def test_collect_usage_params_uses_pending_memory_when_node_times_out(monkeypatch):
    usage_delivery_buffer.clear()
    monkeypatch.setattr(user_usage, "JOB_RECORD_USER_USAGE_COLLECT_TIMEOUT", 1)
    usage_delivery_buffer.add_user_stats(1, [{"uid": "42", "value": 50}])

    class SlowNode:
        def collect_user_stats(self):
            time.sleep(2)
            return {"batch_id": "late-batch", "stats": [{"uid": "42", "value": 123}]}

    started_at = time.monotonic()
    api_params, node_batches = user_usage._collect_usage_params({1: SlowNode()})

    assert time.monotonic() - started_at < 1.8
    assert api_params == {1: [{"uid": "42", "value": 50}]}
    assert node_batches == {}
    usage_delivery_buffer.clear()


def test_node_outbound_usage_replaces_cumulative_node_batches(monkeypatch):
    usage_delivery_buffer.clear()

    class BufferedNode:
        connected = True
        started = True
        usage_coefficient = 1

        def collect_outbound_stats(self):
            return {"batch_id": "outbound-batch-1", "stats": [{"tag": "proxy", "up": 7, "down": 11}]}

    fake_xray = SimpleNamespace(
        core=SimpleNamespace(available=False, started=False),
        api=None,
        nodes={1: BufferedNode()},
        config={"outbounds": [{"tag": "proxy", "protocol": "freedom"}]},
    )
    monkeypatch.setattr(node_usage, "xray", fake_xray)
    monkeypatch.setattr(
        node_usage,
        "_persist_node_usage_batch",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("db is down")),
    )

    with pytest.raises(RuntimeError, match="db is down"):
        node_usage.record_node_usages()
    with pytest.raises(RuntimeError, match="db is down"):
        node_usage.record_node_usages()

    assert usage_delivery_buffer.pending_outbound_stats(1) == [{"tag": "proxy", "up": 7, "down": 11}]
    usage_delivery_buffer.clear()


def test_user_usage_ack_prevents_replay_when_hourly_snapshot_fails(monkeypatch):
    usage_delivery_buffer.clear()

    class DummyDB:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    samples = [[{"uid": "42", "value": 100}], []]
    applied = []

    monkeypatch.setattr(user_usage, "GetDB", DummyDB)
    monkeypatch.setattr(user_usage, "_enforce_due_active_admins", lambda db: 0)
    monkeypatch.setattr(user_usage, "_enforce_due_active_users", lambda db: 0)
    monkeypatch.setattr(user_usage, "_build_api_instances", lambda: ({None: object()}, {None: 1}))

    def collect_from_buffer(api_instances):
        return {None: usage_delivery_buffer.add_user_stats(None, samples.pop(0))}, {}

    def apply_usage(users_usage, admin_usage, service_usage, admin_service_usage):
        applied.extend(users_usage)
        return []

    monkeypatch.setattr(user_usage, "_collect_usage_params", collect_from_buffer)
    monkeypatch.setattr(user_usage, "_load_user_mapping", lambda user_ids: {42: (None, None)})
    monkeypatch.setattr(user_usage, "_apply_usage_to_db", apply_usage)
    monkeypatch.setattr(
        user_usage, "record_user_stats", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("locked"))
    )
    monkeypatch.setattr(user_usage, "DISABLE_RECORDING_NODE_USAGE", False)

    user_usage.record_user_usages()
    user_usage.record_user_usages()

    assert applied == [{"uid": "42", "value": 100}]
    assert usage_delivery_buffer.pending_user_stats(None) == []


def test_lock_wait_timeout_is_retryable():
    exc = OperationalError(
        "UPDATE users SET used_traffic = used_traffic + 1",
        {},
        PyMySQLOperationalError(1205, "Lock wait timeout exceeded; try restarting transaction"),
    )

    assert is_retryable_db_error(exc)


def test_mysql_connection_loss_is_retryable():
    exc = OperationalError(
        "UPDATE users SET used_traffic = used_traffic + 1",
        {},
        PyMySQLOperationalError(2013, "Lost connection to MySQL server during query"),
    )

    assert is_retryable_db_error(exc)


def test_user_usage_retryable_db_error_keeps_memory_buffer_until_success(monkeypatch):
    usage_delivery_buffer.clear()

    class DummyDB:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    samples = [[{"uid": "42", "value": 100}], []]
    attempts = {"count": 0}
    applied = []

    monkeypatch.setattr(user_usage, "GetDB", DummyDB)
    monkeypatch.setattr(user_usage, "_enforce_due_active_admins", lambda db: 0)
    monkeypatch.setattr(user_usage, "_enforce_due_active_users", lambda db: 0)
    monkeypatch.setattr(user_usage, "_build_api_instances", lambda: ({None: object()}, {None: 1}))

    def collect_from_buffer(api_instances):
        return {None: usage_delivery_buffer.add_user_stats(None, samples.pop(0))}, {}

    def apply_usage(users_usage, admin_usage, service_usage, admin_service_usage):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise OperationalError(
                "UPDATE users SET used_traffic = used_traffic + 1",
                {},
                PyMySQLOperationalError(1205, "Lock wait timeout exceeded; try restarting transaction"),
            )
        applied.extend(users_usage)
        return []

    monkeypatch.setattr(user_usage, "_collect_usage_params", collect_from_buffer)
    monkeypatch.setattr(user_usage, "_load_user_mapping", lambda user_ids: {42: (None, None)})
    monkeypatch.setattr(user_usage, "_apply_usage_to_db", apply_usage)
    monkeypatch.setattr(user_usage, "DISABLE_RECORDING_NODE_USAGE", True)

    user_usage.record_user_usages()
    assert usage_delivery_buffer.pending_user_stats(None) == [{"uid": "42", "value": 100}]

    user_usage.record_user_usages()
    assert applied == [{"uid": "42", "value": 100}]
    assert usage_delivery_buffer.pending_user_stats(None) == []


def test_apply_usage_bulk_update_does_not_require_session_sync(monkeypatch):
    username = "usage_bulk_sync_test"
    db = TestingSessionLocal()
    try:
        db.query(User).filter(User.username == username).delete(synchronize_session=False)
        db.commit()
        dbuser = User(username=username, used_traffic=0)
        db.add(dbuser)
        db.commit()
        user_id = dbuser.id
    finally:
        db.close()

    user_usage._apply_usage_to_db([{"uid": str(user_id), "value": 1234}], {}, {}, {})

    db = TestingSessionLocal()
    try:
        dbuser = db.query(User).filter(User.id == user_id).first()
        assert dbuser is not None
        assert dbuser.used_traffic == 1234
    finally:
        db.query(User).filter(User.username == username).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_outbound_usage_buffer_rolls_back_partial_persist_until_retry_succeeds(monkeypatch):
    usage_delivery_buffer.clear()
    master_api = object()
    fake_xray = _fake_xray(master_api)
    monkeypatch.setattr(node_usage, "xray", fake_xray)
    monkeypatch.setattr(outbound_traffic, "xray", fake_xray)
    monkeypatch.setattr(node_usage, "DISABLE_RECORDING_NODE_USAGE", False)
    monkeypatch.setattr(node_usage, "get_outbounds_stats", lambda api: [{"tag": "proxy", "up": 9, "down": 1}])

    original_persist_node_stats = node_usage._persist_node_stats_in_session

    def fail_after_outbound_persist(*args, **kwargs):
        raise RuntimeError("db is down")

    monkeypatch.setattr(node_usage, "_persist_node_stats_in_session", fail_after_outbound_persist)

    db = TestingSessionLocal()
    try:
        system = db.query(System).first()
        if system:
            system.uplink = 0
            system.downlink = 0
        db.query(NodeUsage).delete(synchronize_session=False)
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    with pytest.raises(RuntimeError, match="db is down"):
        node_usage.record_node_usages()

    assert usage_delivery_buffer.pending_outbound_stats(None) == [{"tag": "proxy", "up": 9, "down": 1}]

    db = TestingSessionLocal()
    try:
        assert db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").first() is None
        system = db.query(System).first()
        if system:
            assert system.uplink == 0
            assert system.downlink == 0
        assert db.query(NodeUsage).count() == 0
    finally:
        db.close()

    monkeypatch.setattr(node_usage, "get_outbounds_stats", lambda api: [])
    monkeypatch.setattr(node_usage, "_persist_node_stats_in_session", original_persist_node_stats)

    node_usage.record_node_usages()

    db = TestingSessionLocal()
    try:
        record = db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").first()
        assert record is not None
        assert record.uplink == 9
        assert record.downlink == 1
        system = db.query(System).first()
        if system:
            assert system.uplink == 9
            assert system.downlink == 1
        node_usage_row = db.query(NodeUsage).filter(NodeUsage.node_id.is_(None)).first()
        assert node_usage_row is not None
        assert node_usage_row.uplink == 9
        assert node_usage_row.downlink == 1
    finally:
        db.query(NodeUsage).delete(synchronize_session=False)
        db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").delete(synchronize_session=False)
        system = db.query(System).first()
        if system:
            system.uplink = 0
            system.downlink = 0
        db.commit()
        db.close()
        usage_delivery_buffer.clear()

    assert usage_delivery_buffer.pending_outbound_stats(None) == []
