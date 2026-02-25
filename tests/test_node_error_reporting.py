import types
from unittest import mock
from unittest.mock import MagicMock

import pytest

from app.models.node import NodeStatus
from app.reb_node import operations

if isinstance(operations, mock.MagicMock):
    pytestmark = pytest.mark.skip(reason="app.reb_node is mocked by tests/conftest.py")


class _DummyGetDB:
    def __init__(self, db):
        self._db = db

    def __enter__(self):
        return self._db

    def __exit__(self, exc_type, exc, tb):
        return False


def _make_dbnode(status: NodeStatus):
    return types.SimpleNamespace(
        id=7,
        name="node-7",
        status=status,
        xray_version="v1.8.0",
    )


def test_register_node_runtime_error_updates_status_and_notifies(monkeypatch):
    operations._last_node_error_report.clear()
    dbnode = _make_dbnode(NodeStatus.connected)
    updated = _make_dbnode(NodeStatus.error)

    mock_get_node = MagicMock(return_value=dbnode)
    mock_update = MagicMock(return_value=updated)
    mock_status_change = MagicMock()
    mock_node_error = MagicMock()

    monkeypatch.setattr(operations, "GetDB", lambda: _DummyGetDB(object()))
    monkeypatch.setattr(operations.crud, "get_node_by_id", mock_get_node)
    monkeypatch.setattr(operations.crud, "update_node_status", mock_update)
    monkeypatch.setattr(operations.report, "node_status_change", mock_status_change)
    monkeypatch.setattr(operations.report, "node_error", mock_node_error)
    mock_schedule = MagicMock()
    monkeypatch.setattr(operations, "schedule_node_reconnect", mock_schedule)
    monkeypatch.setattr(
        operations.NodeResponse,
        "model_validate",
        classmethod(lambda cls, obj: obj),
    )

    operations.register_node_runtime_error(7, "grpc timeout")

    mock_get_node.assert_called_once()
    mock_update.assert_called_once()
    mock_status_change.assert_called_once()
    mock_node_error.assert_called_once_with("node-7", "grpc timeout")
    mock_schedule.assert_called_once_with(7)


def test_register_node_runtime_error_keeps_limited_status_but_notifies(monkeypatch):
    operations._last_node_error_report.clear()
    dbnode = _make_dbnode(NodeStatus.limited)

    mock_get_node = MagicMock(return_value=dbnode)
    mock_update = MagicMock()
    mock_status_change = MagicMock()
    mock_node_error = MagicMock()

    monkeypatch.setattr(operations, "GetDB", lambda: _DummyGetDB(object()))
    monkeypatch.setattr(operations.crud, "get_node_by_id", mock_get_node)
    monkeypatch.setattr(operations.crud, "update_node_status", mock_update)
    monkeypatch.setattr(operations.report, "node_status_change", mock_status_change)
    monkeypatch.setattr(operations.report, "node_error", mock_node_error)
    mock_schedule = MagicMock()
    monkeypatch.setattr(operations, "schedule_node_reconnect", mock_schedule)

    operations.register_node_runtime_error(7, "node is limited")

    mock_update.assert_not_called()
    mock_status_change.assert_not_called()
    mock_node_error.assert_called_once_with("node-7", "node is limited")
    mock_schedule.assert_called_once_with(7)


def test_register_node_runtime_error_has_cooldown_for_same_error(monkeypatch):
    operations._last_node_error_report.clear()
    dbnode = _make_dbnode(NodeStatus.error)

    mock_get_node = MagicMock(return_value=dbnode)
    mock_node_error = MagicMock()

    monkeypatch.setattr(operations, "GetDB", lambda: _DummyGetDB(object()))
    monkeypatch.setattr(operations.crud, "get_node_by_id", mock_get_node)
    monkeypatch.setattr(operations.crud, "update_node_status", MagicMock(return_value=dbnode))
    monkeypatch.setattr(operations.report, "node_status_change", MagicMock())
    monkeypatch.setattr(operations.report, "node_error", mock_node_error)
    mock_schedule = MagicMock()
    monkeypatch.setattr(operations, "schedule_node_reconnect", mock_schedule)
    monkeypatch.setattr(
        operations.NodeResponse,
        "model_validate",
        classmethod(lambda cls, obj: obj),
    )

    operations.register_node_runtime_error(7, "same error")
    operations.register_node_runtime_error(7, "same error")

    assert mock_node_error.call_count == 1
    assert mock_schedule.call_count == 2
