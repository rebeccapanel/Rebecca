from pathlib import Path

from app.services import access_insights


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


def test_guess_platform_maps_recent_unmapped_domains(monkeypatch):
    monkeypatch.setattr(access_insights, "_load_json_geo_assets", lambda: ({}, []))
    assets = _empty_assets()

    assert access_insights.guess_platform("one.one.one.one", None, assets) == "cloudflare"
    assert access_insights.guess_platform("bot.mazholl.com", None, assets) == "mazholl"
    assert access_insights.guess_platform("s.uuidksinc.net", None, assets) == "uuidksinc"
    assert access_insights.guess_platform("dt.beyla.site", None, assets) == "beyla"
    assert access_insights.guess_platform("0afac2e.cdn.edge.sotoon.ir", None, assets) == "sotoon"
    assert access_insights.guess_platform("thumb-v3.xhcdn.com", None, assets) == "porn"
    assert access_insights.guess_platform("hansha.online", None, assets) == "hansha"


def test_guess_platform_maps_recent_unmapped_ips_and_truncated_ipv6(monkeypatch):
    monkeypatch.setattr(access_insights, "_load_json_geo_assets", lambda: ({}, []))
    assets = _empty_assets()

    assert access_insights.guess_platform("[2a02", None, assets) == "ipv6"
    assert access_insights.guess_platform(None, "47.241.18.77", assets) == "alibaba"
    assert access_insights.guess_platform(None, "239.255.255.250", assets) == "local"
