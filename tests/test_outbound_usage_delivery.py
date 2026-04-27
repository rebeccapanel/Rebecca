from types import SimpleNamespace

import pytest

import app.runtime
from app.db.models import NodeUsage, OutboundTraffic, System

app.runtime.scheduler = SimpleNamespace(add_job=lambda *args, **kwargs: None)

from app.jobs.usage import node_usage, outbound_traffic
from app.jobs.usage import user_usage
from app.jobs.usage.delivery_buffer import usage_delivery_buffer
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
        record = db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").first()
        assert record is not None
        assert record.uplink == 110
        assert record.downlink == 220
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
        record = db.query(OutboundTraffic).filter(OutboundTraffic.tag == "proxy").first()
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
