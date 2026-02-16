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
    assert access_insights.guess_platform("dns.google", None, assets) == "google"
    assert access_insights.guess_platform("rr2---sn-4g5ednre.gvt1.com", None, assets) == "google"
    assert access_insights.guess_platform("theme.transsion-os.com", None, assets) == "transsion"
    assert (
        access_insights.guess_platform("ads-config-engine-noneu.truecaller.com", None, assets)
        == "truecaller"
    )
    assert access_insights.guess_platform("findnms.samsungiotcloud.com", None, assets) == "samsung"
    assert access_insights.guess_platform("ifconfig.co", None, assets) == "ip_lookup"
    assert access_insights.guess_platform("www.pullcf.com", None, assets) == "cloudflare"
    assert access_insights.guess_platform("mobile.launchdarkly.com", None, assets) == "launchdarkly"
    assert access_insights.guess_platform("grs.dbankcloud.asia", None, assets) == "huawei"
    assert access_insights.guess_platform("xiaohongshu.com", None, assets) == "xiaohongshu"


def test_guess_platform_maps_recent_unmapped_ips_and_truncated_ipv6(monkeypatch):
    monkeypatch.setattr(access_insights, "_load_json_geo_assets", lambda: ({}, []))
    assets = _empty_assets()

    assert access_insights.guess_platform("[2a02", None, assets) == "ipv6"
    assert access_insights.guess_platform(None, "47.241.18.77", assets) == "alibaba"
    assert access_insights.guess_platform(None, "239.255.255.250", assets) == "local"
    assert access_insights.guess_platform(None, "198.18.0.10", assets) == "local"
    assert access_insights.guess_platform(None, "65.21.18.149", assets) == "hosting"
    assert access_insights.guess_platform(None, "34.102.215.99", assets) == "google"
    assert access_insights.guess_platform(None, "173.194.6.167", assets) == "google"
    assert access_insights.guess_platform(None, "172.65.102.115", assets) == "cloudflare"
    assert access_insights.guess_platform(None, "2.16.204.203", assets) == "akamai"
    assert access_insights.guess_platform(None, "102.132.99.39", assets) == "facebook"
    assert access_insights.guess_platform(None, "71.18.5.251", assets) == "tiktok"
