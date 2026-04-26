import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAINTENANCE_SERVICE_PATH = PROJECT_ROOT / "scripts" / "rebecca" / "main.py"
REBECCA_SCRIPT_PATH = PROJECT_ROOT / "scripts" / "rebecca" / "rebecca.sh"


def _load_module_from_path(module_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def test_maintenance_service_supports_binary_mode_without_docker(tmp_path: Path, monkeypatch):
    app_dir = tmp_path / "rebecca"
    app_dir.mkdir()
    (app_dir / ".install-mode").write_text("binary\n", encoding="utf-8")
    (app_dir / ".binary-release.json").write_text(
        json.dumps(
            {
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

    module = _load_module_from_path(MAINTENANCE_SERVICE_PATH, f"rebecca_maintenance_{uuid.uuid4().hex}")

    assert module.settings.install_mode == "binary"
    ssl_request = module.SSLRequest(email="admin@example.com", domains=["example.com"])
    assert ssl_request.email == "admin@example.com"
    panel_info = asyncio.run(module.panel_version())
    assert panel_info["image"] == "rebecca-server (binary)"
    assert panel_info["tag"] == "v1.2.3"
