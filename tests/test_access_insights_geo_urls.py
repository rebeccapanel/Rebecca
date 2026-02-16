from app.services.access_insights import (
    _JSON_GEOIP_URL,
    _JSON_GEOSITE_URL,
    _JSON_ISP_URL,
    _sibling_raw_url,
)


def test_sibling_raw_url_replaces_filename_on_raw_github_url():
    base = "https://raw.githubusercontent.com/ppouria/geo-templates/main/geosite.json"
    assert _sibling_raw_url(base, "geoip.json") == "https://raw.githubusercontent.com/ppouria/geo-templates/main/geoip.json"
    assert _sibling_raw_url(base, "ISPbyrange.json") == "https://raw.githubusercontent.com/ppouria/geo-templates/main/ISPbyrange.json"


def test_geo_urls_are_derived_from_geosite_url():
    assert _JSON_GEOIP_URL == _sibling_raw_url(_JSON_GEOSITE_URL, "geoip.json")
    assert _JSON_ISP_URL == _sibling_raw_url(_JSON_GEOSITE_URL, "ISPbyrange.json")
