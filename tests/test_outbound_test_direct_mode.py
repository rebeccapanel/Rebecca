from types import SimpleNamespace

from app.routers import core


def test_run_outbound_ping_test_direct_path(monkeypatch):
    monkeypatch.setattr(core, "_get_outbound_test_url", lambda: "https://example.com/generate_204")
    monkeypatch.setattr(core, "_measure_direct_delay", lambda url: (42, 204))

    result = core._run_outbound_ping_test(
        outbound_tag="DIRECT",
        all_outbounds=[],
        outbound_protocol="freedom",
    )

    assert result["success"] is True
    assert result["delay"] == 42
    assert result["statusCode"] == 204
