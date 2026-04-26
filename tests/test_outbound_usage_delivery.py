from types import SimpleNamespace

import pytest

import app.runtime
from app.db.models import OutboundTraffic

app.runtime.scheduler = SimpleNamespace(add_job=lambda *args, **kwargs: None)

from app.jobs.usage import node_usage, outbound_traffic
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


def test_outbound_usage_buffer_keeps_samples_until_persist_succeeds(monkeypatch):
    usage_delivery_buffer.clear()
    master_api = object()
    fake_xray = _fake_xray(master_api)
    monkeypatch.setattr(node_usage, "xray", fake_xray)
    monkeypatch.setattr(node_usage, "DISABLE_RECORDING_NODE_USAGE", True)
    monkeypatch.setattr(node_usage, "get_outbounds_stats", lambda api: [{"tag": "proxy", "up": 9, "down": 1}])
    monkeypatch.setattr(
        node_usage,
        "record_outbound_traffic_from_params",
        lambda params: (_ for _ in ()).throw(RuntimeError("db is down")),
    )

    with pytest.raises(RuntimeError, match="db is down"):
        node_usage.record_node_usages()

    assert usage_delivery_buffer.pending_outbound_stats(None) == [{"tag": "proxy", "up": 9, "down": 1}]

    captured = {}
    monkeypatch.setattr(node_usage, "get_outbounds_stats", lambda api: [])
    monkeypatch.setattr(node_usage, "record_outbound_traffic_from_params", lambda params: captured.update(params))

    node_usage.record_node_usages()

    assert captured[None] == [{"tag": "proxy", "up": 9, "down": 1}]
    assert usage_delivery_buffer.pending_outbound_stats(None) == []
