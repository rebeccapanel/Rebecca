import json
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REBECCA_SCRIPT_PATH = PROJECT_ROOT / "scripts" / "rebecca" / "rebecca.sh"
REBECCA_CLI_PATH = PROJECT_ROOT / "rebecca-cli.py"


def test_config_loads_env_from_installed_binary_layout(tmp_path: Path):
    app_dir = tmp_path / "rebecca"
    bin_dir = app_dir / "bin"
    bin_dir.mkdir(parents=True)

    expected_url = f"sqlite:///{tmp_path / 'panel.db'}"
    (app_dir / ".env").write_text(f"SQLALCHEMY_DATABASE_URL={expected_url}\n", encoding="utf-8")

    runner = bin_dir / "rebecca-cli.py"
    runner.write_text("import config\nprint(config.SQLALCHEMY_DATABASE_URL)\n", encoding="utf-8")

    env = os.environ.copy()
    env.pop("REBECCA_ENV_FILE", None)
    env.pop("SQLALCHEMY_DATABASE_URL", None)
    existing_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(PROJECT_ROOT) if not existing_pythonpath else f"{PROJECT_ROOT}{os.pathsep}{existing_pythonpath}"

    result = subprocess.run(
        [sys.executable, str(runner)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.strip() == expected_url


def test_binary_runtime_info_supports_binary_mode_without_docker(tmp_path: Path, monkeypatch):
    app_dir = tmp_path / "rebecca"
    app_dir.mkdir()
    (app_dir / ".binary-release.json").write_text(
        json.dumps(
            {
                "install_mode": "binary",
                "image": "rebecca-server (binary)",
                "tag": "v1.2.3",
                "asset_url": "https://example.invalid/rebecca-linux-amd64.tar.gz",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("REBECCA_APP_DIR", str(app_dir))
    monkeypatch.setenv("REBECCA_SCRIPT_BIN", str(REBECCA_SCRIPT_PATH))
    monkeypatch.setenv("REBECCA_INSTALL_MODE", "binary")
    monkeypatch.setenv("REBECCA_BINARY_METADATA_FILE", str(app_dir / ".binary-release.json"))

    from app.utils.binary_control import get_binary_runtime_info

    panel_info = get_binary_runtime_info()
    assert panel_info["mode"] == "binary"
    assert panel_info["image"] == "rebecca-server (binary)"
    assert panel_info["tag"] == "v1.2.3"
    assert panel_info["binary"]["image"] == "rebecca-server (binary)"
    assert panel_info["binary"]["tag"] == "v1.2.3"


def test_runtime_info_defaults_to_docker_without_binary_marker(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("REBECCA_APP_DIR", str(tmp_path / "rebecca"))
    monkeypatch.delenv("REBECCA_INSTALL_MODE", raising=False)
    monkeypatch.delenv("REBECCA_BINARY_METADATA_FILE", raising=False)

    from app.utils.binary_control import get_binary_runtime_info, is_binary_runtime

    panel_info = get_binary_runtime_info()
    assert panel_info["mode"] == "docker"
    assert is_binary_runtime() is False


def test_cli_help_skips_dashboard_runtime(tmp_path: Path):
    env = os.environ.copy()
    env["REBECCA_ENV_FILE"] = str(tmp_path / ".env")
    env["SQLALCHEMY_DATABASE_URL"] = f"sqlite:///{tmp_path / 'cli.db'}"
    existing_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(PROJECT_ROOT) if not existing_pythonpath else f"{PROJECT_ROOT}{os.pathsep}{existing_pythonpath}"

    result = subprocess.run(
        [sys.executable, str(REBECCA_CLI_PATH), "--help"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    assert "admin" in result.stdout
