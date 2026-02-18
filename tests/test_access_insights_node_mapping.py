from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from app.services import access_insights
from app.services.panel_settings import PanelSettingsService


def _empty_assets() -> access_insights.GeoAssets:
    return access_insights.GeoAssets(
        base_dir=Path("."),
        geosite_path=None,
        geoip_path=None,
        geosite_mtime=None,
        geoip_mtime=None,
        geosite=access_insights.GeoSiteIndex(full={}, suffix={}, plain=[], regex=[]),
        geoip=access_insights.GeoIPIndex(ipv4=[], ipv6=[]),
    )


def _enable_access_insights(monkeypatch):
    monkeypatch.setattr(
        PanelSettingsService,
        "get_settings",
        lambda ensure_record=True: SimpleNamespace(access_insights_enabled=True),
    )


def test_multi_node_insights_contains_source_node_mapping(monkeypatch):
    _enable_access_insights(monkeypatch)
    monkeypatch.setattr(access_insights, "REDIS_ENABLED", False)
    monkeypatch.setattr(access_insights, "load_geo_assets", _empty_assets)
    monkeypatch.setattr(access_insights, "guess_platform", lambda host, ip, assets: "other")
    monkeypatch.setattr(access_insights, "classify_isp", lambda ip: ("Unknown", "Unknown"))

    now = datetime.now(timezone.utc).strftime("%Y/%m/%d %H:%M:%S")
    line_a = f"{now} from tcp:1.1.1.1:1234 accepted tcp:chatgpt.com:443 [api] email: user@example.com"
    line_b = f"{now} from tcp:2.2.2.2:2345 accepted tcp:chatgpt.com:443 [api] email: user@example.com"

    sources = [
        access_insights.NodeLogSource(
            node_id=None,
            node_name="master",
            log_path=None,
            is_master=True,
            fetch_lines=lambda max_lines: [line_a],
            connected=True,
        ),
        access_insights.NodeLogSource(
            node_id=1,
            node_name="node-1",
            log_path=None,
            is_master=False,
            fetch_lines=lambda max_lines: [line_b],
            connected=True,
        ),
    ]
    monkeypatch.setattr(access_insights, "get_all_log_sources", lambda: sources)

    payload = access_insights.build_multi_node_insights(
        limit=50,
        lookback_lines=200,
        search="",
        window_seconds=3600,
    )

    assert payload.get("items"), "Expected at least one aggregated client"
    client = payload["items"][0]
    assert sorted(client.get("nodes") or []) == ["master", "node-1"]
    assert client.get("source_nodes", {}).get("1.1.1.1") == ["master"]
    assert client.get("source_nodes", {}).get("2.2.2.2") == ["node-1"]
