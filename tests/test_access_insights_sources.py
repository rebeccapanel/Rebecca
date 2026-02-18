from pathlib import Path
from types import SimpleNamespace

from app.services import access_insights
from app.services.panel_settings import PanelSettingsService


def _enable_access_insights(monkeypatch):
    monkeypatch.setattr(
        PanelSettingsService,
        "get_settings",
        lambda ensure_record=True: SimpleNamespace(access_insights_enabled=True),
    )


def test_get_all_log_sources_reads_node_name_from_db_metadata(monkeypatch, tmp_path: Path):
    _enable_access_insights(monkeypatch)

    master_log = tmp_path / "access.log"
    master_log.write_text("", encoding="utf-8")

    monkeypatch.setattr(access_insights, "resolve_access_log_path", lambda: master_log)
    monkeypatch.setattr(
        access_insights,
        "_load_node_metadata",
        lambda: {1: {"name": "node1", "status": "connected"}},
    )

    node_without_name = SimpleNamespace(_session_id="session-1")
    monkeypatch.setattr(access_insights, "xray", SimpleNamespace(nodes={1: node_without_name}))

    sources = access_insights.get_all_log_sources()

    assert any(source.is_master and source.node_name == "master" for source in sources)
    node_source = next(source for source in sources if source.node_id == 1)
    assert node_source.node_name == "node1"
    assert callable(node_source.fetch_lines)


def test_get_all_log_sources_skips_disabled_and_limited_nodes(monkeypatch, tmp_path: Path):
    _enable_access_insights(monkeypatch)

    master_log = tmp_path / "access.log"
    master_log.write_text("", encoding="utf-8")

    monkeypatch.setattr(access_insights, "resolve_access_log_path", lambda: master_log)
    monkeypatch.setattr(
        access_insights,
        "_load_node_metadata",
        lambda: {
            1: {"name": "disabled-node", "status": "disabled"},
            2: {"name": "limited-node", "status": "limited"},
            3: {"name": "connected-node", "status": "connected"},
        },
    )

    monkeypatch.setattr(
        access_insights,
        "xray",
        SimpleNamespace(
            nodes={
                1: SimpleNamespace(_session_id="s1"),
                2: SimpleNamespace(_session_id="s2"),
                3: SimpleNamespace(_session_id="s3"),
            }
        ),
    )

    sources = access_insights.get_all_log_sources()
    node_ids = {source.node_id for source in sources if not source.is_master}

    assert 1 not in node_ids
    assert 2 not in node_ids
    assert 3 in node_ids

