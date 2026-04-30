from scripts.render_release_assets import MANAGED_END, MANAGED_START, render_assets_section, update_body


def test_render_assets_section_contains_downloads_and_reports():
    body = render_assets_section("rebeccapanel/Rebecca", "v0.1.0")

    assert "## Panel Binary Builds" in body
    assert "## Reports" in body
    assert "`rebecca-linux-amd64.tar.gz`" in body
    assert "`rebecca-windows-amd64.zip`" in body
    assert "releases/download/v0.1.0/rebecca-linux-amd64.tar.gz" in body
    assert "github/downloads/rebeccapanel/Rebecca/v0.1.0/total?label=Total" in body
    assert "github/downloads/rebeccapanel/Rebecca/v0.1.0/rebecca-windows-amd64.zip?label=windows-amd64" in body


def test_update_body_replaces_managed_section():
    old = f"Intro\n\n{MANAGED_START}\nold\n{MANAGED_END}\n\nTail\n"
    new_section = render_assets_section("rebeccapanel/Rebecca", "v0.1.0")

    updated = update_body(old, new_section)

    assert "Intro" in updated
    assert "Tail" in updated
    assert "old" not in updated
    assert updated.count(MANAGED_START) == 1
    assert updated.count(MANAGED_END) == 1
