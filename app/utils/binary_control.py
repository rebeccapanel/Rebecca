from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import HTTPException


def _resolve_rebecca_cli() -> str:
    candidates = [
        os.getenv("REBECCA_SCRIPT_BIN", "").strip(),
        shutil.which("rebecca") or "",
        "/usr/local/bin/rebecca",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise HTTPException(status_code=503, detail="Rebecca CLI was not found on this host")


def _service_name() -> str:
    return os.getenv("REBECCA_SERVICE_NAME", "rebecca").strip() or "rebecca"


def _metadata_path() -> Path:
    configured = os.getenv("REBECCA_BINARY_METADATA_FILE", "").strip()
    if configured:
        return Path(configured)
    app_dir = Path(os.getenv("REBECCA_APP_DIR", "/opt/rebecca"))
    return app_dir / ".binary-release.json"


def _read_metadata() -> dict[str, Any] | None:
    path = _metadata_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def get_binary_runtime_info() -> dict[str, Any]:
    metadata = _read_metadata() or {}
    return {
        "mode": os.getenv("REBECCA_INSTALL_MODE", metadata.get("install_mode", "unknown")),
        "service": _service_name(),
        "python": sys.version.split()[0],
        "binary": metadata,
    }


def run_rebecca_cli(args: list[str], *, timeout: int = 900) -> dict[str, str]:
    command = [_resolve_rebecca_cli(), *args]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"Rebecca command timed out: {' '.join(command)}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run Rebecca command: {exc}") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"exit code {result.returncode}"
        raise HTTPException(status_code=500, detail=detail)

    return {"stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def schedule_rebecca_cli(args: list[str]) -> None:
    command = [_resolve_rebecca_cli(), *args]
    popen_kwargs: dict[str, Any] = {}
    if os.name != "nt":
        popen_kwargs["start_new_session"] = True
    try:
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **popen_kwargs)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to schedule Rebecca command: {exc}") from exc
