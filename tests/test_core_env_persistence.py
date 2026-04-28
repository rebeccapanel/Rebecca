from pathlib import Path

from app.routers.core import _resolve_assets_path_master, _update_env_envfile


def test_update_env_envfile_keeps_commented_key_and_adds_active_entry(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text('#XRAY_ASSETS_PATH="/usr/local/share/xray"\n', encoding="utf-8")

    _update_env_envfile(env_path, "XRAY_ASSETS_PATH", "/var/lib/rebecca/xray-core")

    content = env_path.read_text(encoding="utf-8")
    assert '#XRAY_ASSETS_PATH="/usr/local/share/xray"' in content
    assert 'XRAY_ASSETS_PATH="/var/lib/rebecca/xray-core"' in content


def test_resolve_assets_path_master_uses_persistent_data_dir(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("REBECCA_DATA_DIR", str(data_dir))
    monkeypatch.chdir(tmp_path)

    target = _resolve_assets_path_master(persist_env=True)

    expected = data_dir / "xray-core"
    assert target == expected
    assert expected.is_dir()

    local_env = (tmp_path / ".env").read_text(encoding="utf-8")
    persistent_env = (data_dir / ".env").read_text(encoding="utf-8")
    assert 'XRAY_ASSETS_PATH="' in local_env
    assert 'XRAY_ASSETS_PATH="' in persistent_env
