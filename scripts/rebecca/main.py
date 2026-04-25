"""
Out-of-container maintenance API for Rebecca installations.

This FastAPI service stays outside the docker stack and exposes a very small
surface that can be wired to systemd. All operations are executed via the
existing `rebecca` CLI (update / restart).

Environment variables are read from Rebecca's `.env` file as well as the host
environment. The most important knobs are:

    REBECCA_SCRIPT_HOST        (default: 127.0.0.1)
    REBECCA_SCRIPT_PORT        (default: 3000)
    REBECCA_SCRIPT_ALLOWED_HOSTS   (default: 127.0.0.1,::1,localhost)
    REBECCA_SCRIPT_BIN         (default: resolved `rebecca` CLI)
    REBECCA_APP_NAME           (default: rebecca)
    REBECCA_INSTALL_DIR        (default: /opt)
    REBECCA_APP_DIR            (default: /opt/<app_name>)
    REBECCA_DATA_DIR           (default: /var/lib/<app_name>)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional

try:
    import pymysql
except ImportError:
    pymysql = None  # pymysql is optional, only needed for MySQL/MariaDB

import uvicorn
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, EmailStr, field_validator

logger = logging.getLogger("rebecca.scripts.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MAINT_SOURCE_URL = os.getenv(
    "REBECCA_MAINT_SOURCE_URL",
    "https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/main.py",
)
MAINT_UNIT_NAME = os.getenv("REBECCA_MAINT_UNIT", "rebecca-maint.service")


class Settings:
    def __init__(self) -> None:
        self.host = os.getenv("REBECCA_SCRIPT_HOST", os.getenv("UVICORN_HOST", "127.0.0.1"))
        self.port = int(os.getenv("REBECCA_SCRIPT_PORT", os.getenv("REBECCA_MAINT_PORT", "3000")))
        allowed = os.getenv("REBECCA_SCRIPT_ALLOWED_HOSTS", "127.0.0.1,::1,localhost")
        self.allowed_hosts = {host.strip() for host in allowed.split(",") if host.strip()}

        self.app_name = os.getenv("REBECCA_APP_NAME", "rebecca")
        install_dir = Path(os.getenv("REBECCA_INSTALL_DIR", "/opt"))
        self.app_dir = Path(os.getenv("REBECCA_APP_DIR", install_dir / self.app_name)).resolve()
        self.data_dir = Path(
            os.getenv("REBECCA_DATA_DIR", f"/var/lib/{self.app_name}")
        ).resolve()
        self.install_mode_file = Path(os.getenv("REBECCA_INSTALL_MODE_FILE", self.app_dir / ".install-mode"))
        self.install_mode = self._resolve_install_mode()

        self.env_file = Path(os.getenv("REBECCA_ENV_FILE", self.app_dir / ".env"))
        self.compose_file = Path(
            os.getenv("REBECCA_COMPOSE_FILE", self.app_dir / "docker-compose.yml")
        )
        self.compose_project = os.getenv("REBECCA_COMPOSE_PROJECT", self.app_name)
        self.service_name = os.getenv("REBECCA_SERVICE_NAME", self.app_name)
        self.binary_server = Path(os.getenv("REBECCA_BINARY_SERVER", self.app_dir / "bin" / "rebecca-server")).resolve()
        self.binary_cli = Path(os.getenv("REBECCA_BINARY_CLI", self.app_dir / "bin" / "rebecca-cli")).resolve()
        self.binary_metadata_file = Path(
            os.getenv("REBECCA_BINARY_METADATA_FILE", self.app_dir / ".binary-release.json")
        ).resolve()

        self.node_app_dir = Path(os.getenv("REBECCA_NODE_APP_DIR", "/opt/rebecca-node")).resolve()
        self.node_compose_file = Path(
            os.getenv("REBECCA_NODE_COMPOSE_FILE", self.node_app_dir / "docker-compose.yml")
        )
        self.node_service_name = os.getenv("REBECCA_NODE_SERVICE_NAME", "rebecca-node")

        self.rebecca_cli = self._resolve_rebecca_cli()
        self.compose_binary: Optional[List[str]] = None

    def _resolve_install_mode(self) -> str:
        requested_mode = (os.getenv("REBECCA_INSTALL_MODE") or "").strip().lower()
        if requested_mode in {"binary", "docker"}:
            return requested_mode

        if self.install_mode_file.exists():
            try:
                file_mode = self.install_mode_file.read_text(encoding="utf-8").strip().lower()
            except OSError:
                file_mode = ""
            if file_mode in {"binary", "docker"}:
                return file_mode

        return "docker"

    @staticmethod
    def _resolve_rebecca_cli() -> Path:
        user_defined = os.getenv("REBECCA_SCRIPT_BIN")
        candidates: Iterable[Path] = []

        if user_defined:
            candidates = [Path(user_defined)]
        else:
            detected = shutil.which("rebecca")
            fallback = Path(__file__).resolve().parent / "rebecca.sh"
            candidates = [Path(detected)] if detected else []
            candidates.append(fallback)

        for candidate in candidates:
            if candidate and candidate.exists():
                return candidate
        raise RuntimeError("Unable to locate the rebecca CLI. Set REBECCA_SCRIPT_BIN.")

    @staticmethod
    def _resolve_compose_binary() -> List[str]:
        if shutil.which("docker-compose"):
            return ["docker-compose"]
        if shutil.which("docker"):
            return ["docker", "compose"]
        raise RuntimeError("docker compose is not installed or not in PATH")

    def compose_cmd(self, *args: str) -> List[str]:
        if self.compose_binary is None:
            self.compose_binary = self._resolve_compose_binary()
        return (
            self.compose_binary
            + ["-f", str(self.compose_file), "-p", self.compose_project]
            + list(args)
        )


settings = Settings()
app = FastAPI(title="Rebecca Maintenance API", version="0.1.0")
DOMAIN_PATTERN = re.compile(r"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

MYSQL_DEFAULT_DATABASES = {
    "information_schema",
    "performance_schema",
    "mysql",
    "sys",
    "phpmyadmin",
}


def load_compose_file(path: Path) -> Dict:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Compose file not found at {path}")
    try:
        data = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse compose file: {exc}") from exc
    return data


def extract_image_tag(image: str) -> Optional[str]:
    if ":" not in image:
        return None
    return image.rsplit(":", 1)[1]


def get_service_image_info(compose_path: Path, service_name: str) -> Dict[str, Optional[str]]:
    compose = load_compose_file(compose_path)
    services = compose.get("services") or {}
    service = services.get(service_name)
    if not service:
        raise HTTPException(
            status_code=404, detail=f"Service '{service_name}' not defined in {compose_path}"
        )
    image = service.get("image")
    if not image:
        raise HTTPException(
            status_code=400, detail=f"Service '{service_name}' in {compose_path} does not define an image"
        )
    return {"image": image, "tag": extract_image_tag(image)}


def detect_architecture() -> str:
    machine = platform.machine().lower()
    mapping = {
        "i386": "32",
        "i686": "32",
        "x86_64": "64",
        "amd64": "64",
        "armv5tel": "arm32-v5",
        "armv6l": "arm32-v6",
        "armv7l": "arm32-v7a",
        "armv7": "arm32-v7a",
        "arm64": "arm64-v8a",
        "aarch64": "arm64-v8a",
        "mips": "mips32",
        "mipsle": "mips32le",
        "mips64": "mips64",
        "mips64le": "mips64le",
        "ppc64": "ppc64",
        "ppc64le": "ppc64le",
        "riscv64": "riscv64",
        "s390x": "s390x",
    }
    if machine not in mapping:
        raise HTTPException(status_code=400, detail=f"Unsupported architecture: {machine}")
    arch = mapping[machine]
    if arch == "arm32-v6":
        arch = "arm32-v5"
    return arch


def resolve_xray_tag(version: Optional[str]) -> str:
    if version and version.lower() != "latest":
        return version
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/XTLS/Xray-core/releases/latest",
            headers={"User-Agent": "Rebecca-Maintenance-Service"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return payload.get("tag_name")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to resolve latest Xray version: {exc}") from exc


def download_release_archive(tag: str, arch: str) -> Path:
    url = f"https://github.com/XTLS/Xray-core/releases/download/{tag}/Xray-linux-{arch}.zip"
    tmp_dir = Path(tempfile.mkdtemp())
    zip_path = tmp_dir / "xray.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "Rebecca-Maintenance-Service"})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp, zip_path.open("wb") as handle:
            shutil.copyfileobj(resp, handle)
    except urllib.error.URLError as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=502, detail=f"Failed to download Xray release: {exc}") from exc

    try:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp_dir)
    except zipfile.BadZipFile as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Downloaded archive is corrupted: {exc}") from exc

    return tmp_dir


def get_xray_paths() -> tuple[Path, Path]:
    env_values = load_env_file(settings.env_file)
    exec_path = Path(env_values.get("XRAY_EXECUTABLE_PATH", "/usr/local/bin/xray"))
    assets_path = Path(env_values.get("XRAY_ASSETS_PATH", "/usr/local/share/xray"))
    return exec_path, assets_path


def install_xray_assets(
    version: Optional[str],
    include_binary: bool = True,
    include_geo: bool = True,
) -> str:
    if not include_binary and not include_geo:
        return ""

    arch = detect_architecture()
    tag = resolve_xray_tag(version)
    tmp_dir = download_release_archive(tag, arch)
    try:
        exec_path, assets_path = get_xray_paths()
        if include_binary:
            source_binary = tmp_dir / "xray"
            if not source_binary.exists():
                raise HTTPException(status_code=500, detail="Downloaded archive missing xray binary")
            exec_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_binary, exec_path)
            os.chmod(exec_path, 0o755)

        if include_geo:
            assets_path.mkdir(parents=True, exist_ok=True)
            for geo_name in ("geoip.dat", "geosite.dat"):
                source = tmp_dir / geo_name
                if not source.exists():
                    raise HTTPException(
                        status_code=500, detail=f"Downloaded archive missing {geo_name}"
                    )
                shutil.copy2(source, assets_path / geo_name)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return tag


def download_geo_files(files: List[Dict[str, str]]) -> List[str]:
    if not files:
        raise HTTPException(status_code=422, detail="files is required")
    _, assets_path = get_xray_paths()
    saved: List[str] = []
    assets_path.mkdir(parents=True, exist_ok=True)

    for entry in files:
        name = (entry.get("name") or "").strip()
        url = (entry.get("url") or "").strip()
        if not name or not url:
            raise HTTPException(status_code=422, detail="Each file must include name and url")

        dest = assets_path / name
        req = urllib.request.Request(url, headers={"User-Agent": "Rebecca-Maintenance-Service"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as handle:
                shutil.copyfileobj(resp, handle)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to download {name}: {exc}") from exc
        saved.append(str(dest))
    return saved


class SSLRequest(BaseModel):
    email: EmailStr
    domains: List[str]

    @field_validator("domains")
    @classmethod
    def validate_domains(cls, value: List[str]) -> List[str]:
        normalized: List[str] = []
        for domain in value:
            cleaned = domain.strip()
            if not cleaned:
                continue
            if not DOMAIN_PATTERN.match(cleaned):
                raise ValueError(f"Invalid domain: {domain}")
            normalized.append(cleaned)
        if not normalized:
            raise ValueError("At least one domain must be provided")
        return normalized


class SSLRenewRequest(BaseModel):
    domain: Optional[str] = None


class XrayUpdateRequest(BaseModel):
    version: Optional[str] = None


class GeoUpdateRequest(BaseModel):
    files: List[Dict[str, str]]


def load_env_file(env_path: Path) -> Dict[str, str]:
    env_values: Dict[str, str] = {}
    if not env_path.exists():
        return env_values
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_values[key.strip()] = value.strip().strip('"').strip("'")
    return env_values


def load_json_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    if isinstance(data, dict):
        return {str(key): str(value) for key, value in data.items() if isinstance(value, (str, int, float, bool))}
    return {}


def get_binary_panel_info() -> Dict[str, Optional[str]]:
    metadata = load_json_file(settings.binary_metadata_file)
    image = (metadata.get("image") or "").strip()
    tag = (metadata.get("tag") or "").strip()

    if not image:
        image = "rebecca-server (binary)" if settings.binary_server.exists() else "rebecca (binary)"

    payload: Dict[str, Optional[str]] = {"image": image, "tag": tag or None}
    asset_url = (metadata.get("asset_url") or "").strip()
    if asset_url:
        payload["asset_url"] = asset_url
    return payload


def run_subprocess(
    cmd: List[str],
    *,
    input_bytes: Optional[bytes] = None,
    cwd: Optional[Path] = None,
    check: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    logger.info("Executing command: %s", " ".join(cmd))
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"Command {' '.join(cmd)} failed with exit code {proc.returncode}",
            proc.stdout.decode(errors="ignore"),
            proc.stderr.decode(errors="ignore"),
        )
    return proc


def run_rebecca_command(*args: str) -> subprocess.CompletedProcess[bytes]:
    if not settings.rebecca_cli.exists():
        raise RuntimeError(f"rebecca CLI not found at {settings.rebecca_cli}")
    cmd = [str(settings.rebecca_cli), *args]
    return run_subprocess(cmd)


def compose_command(*args: str, input_bytes: Optional[bytes] = None) -> subprocess.CompletedProcess[bytes]:
    if not settings.compose_file.exists():
        raise RuntimeError("docker-compose.yml was not found")
    return run_subprocess(settings.compose_cmd(*args), input_bytes=input_bytes)


def ensure_local_request(request: Request) -> None:
    host = request.client.host if request.client else None
    if host not in settings.allowed_hosts:
        raise HTTPException(status_code=403, detail="Only local requests are allowed")


def safe_extract_tar(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            member_path = destination / member.name
            if not str(member_path.resolve()).startswith(str(destination.resolve())):
                raise HTTPException(status_code=400, detail="Unsafe archive detected")
        tar.extractall(destination)


def copy_directory(source: Path, destination: Path, excluded: Optional[List[Path]] = None) -> None:
    if not source.exists():
        return
    excluded = [path.resolve() for path in (excluded or [])]

    def _ignore(current: str, entries: List[str]) -> List[str]:
        ignored: List[str] = []
        for name in entries:
            full_path = (Path(current) / name).resolve()
            for excluded_path in excluded:
                excluded_str = str(excluded_path)
                full_str = str(full_path)
            if full_str == excluded_str or full_str.startswith(f"{excluded_str}{os.sep}"):
                ignored.append(name)
                break
        return ignored

    shutil.copytree(source, destination, dirs_exist_ok=True, ignore=_ignore)


def cleanup_file(path: Path) -> None:
    Path(path).unlink(missing_ok=True)


def stop_stack() -> None:
    compose_command("down")


def start_stack() -> None:
    compose_command("up", "-d", "--remove-orphans")


def detect_db_service(compose_content: str) -> Optional[str]:
    lowered = compose_content.lower()
    if "mariadb" in lowered:
        return "mariadb"
    if "mysql" in lowered:
        return "mysql"
    return None


def resolve_sqlite_path(env_values: Dict[str, str]) -> Path:
    url = env_values.get("SQLALCHEMY_DATABASE_URL", "")
    url = url.strip().strip('"').strip("'")
    if not url.startswith("sqlite"):
        raise HTTPException(status_code=400, detail="SQLite URL not detected in .env")
    path = url.split("sqlite://", 1)[-1]
    path = path.lstrip("/")
    sqlite_path = Path("/") / path
    return sqlite_path


async def trigger_rebecca_command(*args: str) -> Dict[str, str]:
    def _runner() -> Dict[str, str]:
        try:
            result = run_rebecca_command(*args)
            return {
                "status": "ok",
                "stdout": result.stdout.decode(errors="ignore"),
                "stderr": result.stderr.decode(errors="ignore"),
            }
        except RuntimeError as exc:
            message = exc.args[0]
            stdout = exc.args[1] if len(exc.args) > 1 else ""
            stderr = exc.args[2] if len(exc.args) > 2 else ""
            raise HTTPException(
                status_code=500,
                detail={"message": message, "stdout": stdout, "stderr": stderr},
            ) from exc

    return await asyncio.to_thread(_runner)


@app.middleware("http")
async def local_only(request: Request, call_next):
    try:
        ensure_local_request(request)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "app_dir": str(settings.app_dir),
        "data_dir": str(settings.data_dir),
        "rebecca_cli": str(settings.rebecca_cli),
        "install_mode": settings.install_mode,
    }


@app.post("/update")
async def update_panel():
    result = await trigger_rebecca_command("update")
    return {"status": "ok", "stdout": result["stdout"].strip()}


@app.post("/restart")
async def restart_panel():
    result = await trigger_rebecca_command("restart", "-n")
    return {"status": "ok", "stdout": result["stdout"].strip()}
@app.post("/ssl/issue")
async def ssl_issue(request: SSLRequest):
    domains_arg = ",".join(request.domains)
    cert_path = settings.data_dir / "certs" / request.domains[0]
    result = await trigger_rebecca_command(
        "ssl",
        "issue",
        f"--email={request.email}",
        f"--domains={domains_arg}",
        "--non-interactive",
    )
    return {"status": "ok", "stdout": result["stdout"].strip(), "certificate_path": str(cert_path)}


@app.post("/ssl/renew")
async def ssl_renew(request: Optional[SSLRenewRequest] = None):
    cmd = ["ssl", "renew"]
    if request and request.domain:
        cmd.append(f"--domain={request.domain}")
    result = await trigger_rebecca_command(*cmd)
    payload = {"status": "ok", "stdout": result["stdout"].strip()}
    if request and request.domain:
        payload["certificate_path"] = str(settings.data_dir / "certs" / request.domain)
    return payload


@app.get("/version/panel")
async def panel_version():
    if settings.install_mode == "binary":
        return get_binary_panel_info()
    return get_service_image_info(settings.compose_file, settings.service_name)


@app.get("/version/node")
async def node_version():
    return get_service_image_info(settings.node_compose_file, settings.node_service_name)


@app.post("/service/update")
async def update_service():
    try:
        req = urllib.request.Request(
            MAINT_SOURCE_URL,
            headers={"User-Agent": "Rebecca-Maintenance-Service"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to download service source: {exc}") from exc

    path = Path(__file__).resolve()
    tmp_path = path.with_suffix(".tmp")
    try:
        tmp_path.write_bytes(content)
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

    try:
        run_subprocess(["systemctl", "restart", MAINT_UNIT_NAME], check=False)
    except Exception as exc:
        logger.warning("Failed to restart maintenance service: %s", exc)

    return {"status": "ok", "message": "Service source updated, restart requested"}


def main():
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
