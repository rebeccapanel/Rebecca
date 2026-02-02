import atexit
import re
import subprocess
import threading
from collections import deque
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import logging

import app.utils.system as system_utils
from app.reb_node.config import XRayConfig
from config import XRAY_LOG_DIR, XRAY_ASSETS_PATH

try:
    from cryptography.hazmat.primitives.asymmetric import x25519 as crypto_x25519
    from cryptography.hazmat.primitives import serialization as crypto_serialization
except Exception:  # pragma: no cover - optional import
    crypto_x25519 = None
    crypto_serialization = None
from config import DEBUG


logger = logging.getLogger("uvicorn.error")


class XRayCore:
    def __init__(
        self,
        executable_path: str = "/usr/bin/xray",
        assets_path: str = "/usr/share/xray",
    ):
        self.executable_path = executable_path
        self.assets_path = assets_path

        self.version = None
        self.available = False
        try:
            self.version = self.get_version()
            self.available = True
        except (FileNotFoundError, subprocess.SubprocessError) as e:
            logger.warning(f"XRay executable not found at {executable_path}: {e}")
            logger.warning("XRay functionality will be disabled")

        self.process = None
        self.restarting = False

        self._logs_buffer = deque(maxlen=100)
        self._temp_log_buffers = {}
        self._on_start_funcs = []
        self._on_stop_funcs = []
        self._env = {"XRAY_LOCATION_ASSET": assets_path}
        self.access_log_path: Optional[Path] = None
        self.error_log_path: Optional[Path] = None

        atexit.register(lambda: self.stop() if self.started else None)

    def get_version(self):
        cmd = [self.executable_path, "version"]
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8")
        m = re.match(r"^Xray (\d+\.\d+\.\d+)", output)
        if m:
            return m.groups()[0]

    def _generate_x25519_python(self, private_key: Optional[str] = None):
        if crypto_x25519 is None:
            raise RuntimeError("cryptography is not available to generate keys")

        def _parse_private(value: str) -> crypto_x25519.X25519PrivateKey:
            cleaned = value.strip()
            # Accept hex-encoded raw key
            try:
                raw = bytes.fromhex(cleaned)
                if len(raw) != 32:
                    raise ValueError("invalid length")
                return crypto_x25519.X25519PrivateKey.from_private_bytes(raw)
            except Exception as exc:
                raise ValueError(f"Invalid private key provided: {exc}") from exc

        if private_key:
            priv_obj = _parse_private(private_key)
        else:
            priv_obj = crypto_x25519.X25519PrivateKey.generate()

        pub_obj = priv_obj.public_key()
        priv_hex = priv_obj.private_bytes(
            encoding=crypto_serialization.Encoding.Raw,
            format=crypto_serialization.PrivateFormat.Raw,
            encryption_algorithm=crypto_serialization.NoEncryption(),
        ).hex()
        pub_hex = pub_obj.public_bytes(
            encoding=crypto_serialization.Encoding.Raw,
            format=crypto_serialization.PublicFormat.Raw,
        ).hex()
        return {"private_key": priv_hex, "public_key": pub_hex}

    def get_x25519(self, private_key: str = None):
        # Try Xray binary first when available, fall back to local generation.
        if self.available:
            try:
                cmd = [self.executable_path, "x25519"]
                if private_key:
                    cmd.extend(["-i", private_key])
                output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8")
                m = re.match(r"Private key: (.+)\nPublic key: (.+)", output)
                if m:
                    private, public = m.groups()
                    return {"private_key": private, "public_key": public}
            except Exception as exc:
                logger.warning("Falling back to local x25519 generation: %s", exc)

        # Fallback to python implementation
        return self._generate_x25519_python(private_key)

    def get_mldsa65(self):
        if not self.available:
            raise RuntimeError("XRay is not available. Please install XRay to enable this functionality.")
        cmd = [self.executable_path, "mldsa65"]
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8")
        lines = [line.strip() for line in output.splitlines() if line.strip()]
        if len(lines) < 2:
            raise ValueError("Invalid mldsa65 output")
        seed_parts = lines[0].split(":", 1)
        verify_parts = lines[1].split(":", 1)
        if len(seed_parts) < 2 or len(verify_parts) < 2:
            raise ValueError("Invalid mldsa65 output")
        return {
            "seed": seed_parts[1].strip(),
            "verify": verify_parts[1].strip(),
        }

    def get_ech_cert(self, server_name: str):
        if not self.available:
            raise RuntimeError("XRay is not available. Please install XRay to enable this functionality.")
        if not server_name or not server_name.strip():
            raise ValueError("SNI is required to generate ECH certificate")
        cmd = [self.executable_path, "tls", "ech", "--serverName", server_name.strip()]
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8")
        lines = [line.strip() for line in output.splitlines()]
        if len(lines) < 4:
            raise ValueError("Invalid ECH output")
        return {
            "echServerKeys": lines[3],
            "echConfigList": lines[1],
        }

    def __capture_process_logs(self):
        def capture_and_debug_log():
            while self.process:
                output = self.process.stdout.readline()
                if output:
                    output = output.strip()
                    if output:  # Only add non-empty logs
                        self._logs_buffer.append(output)
                        for buf in list(self._temp_log_buffers.values()):
                            buf.append(output)
                        # Only log to terminal in DEBUG mode
                        if DEBUG:
                            logger.debug(output)

                elif not self.process or self.process.poll() is not None:
                    break

        def capture_only():
            while self.process:
                output = self.process.stdout.readline()
                if output:
                    output = output.strip()
                    if output:  # Only add non-empty logs
                        self._logs_buffer.append(output)
                        for buf in list(self._temp_log_buffers.values()):
                            buf.append(output)
                        # Don't log to terminal - logs will be sent via WebSocket

                elif not self.process or self.process.poll() is not None:
                    break

        def capture_stderr():
            """Capture stderr separately to catch connection errors that might not appear in stdout"""
            while self.process:
                try:
                    output = self.process.stderr.readline()
                    if output:
                        output = output.strip()
                        if output:  # Only add non-empty logs
                            self._logs_buffer.append(output)
                            for buf in list(self._temp_log_buffers.values()):
                                buf.append(output)
                            # Only log to terminal in DEBUG mode
                            if DEBUG:
                                logger.debug(f"Xray stderr: {output}")
                    elif not self.process or self.process.poll() is not None:
                        break
                except Exception:
                    break

        if DEBUG:
            threading.Thread(target=capture_and_debug_log, daemon=True).start()
            threading.Thread(target=capture_stderr, daemon=True).start()
        else:
            threading.Thread(target=capture_only, daemon=True).start()
            threading.Thread(target=capture_stderr, daemon=True).start()

    @contextmanager
    def get_logs(self):
        buf = deque(self._logs_buffer, maxlen=100)
        buf_id = id(buf)
        try:
            self._temp_log_buffers[buf_id] = buf
            yield buf
        finally:
            del self._temp_log_buffers[buf_id]
            del buf

    def get_last_error(self) -> Optional[str]:
        """Get the last error log from Xray that caused it to stop."""
        if not self._logs_buffer:
            return None

        # Search backwards through logs for error patterns
        error_patterns = [
            r"error",
            r"failed",
            r"exception",
            r"fatal",
            r"panic",
            r"critical",
            r"core.*stopped",
            r"core.*exit",
            r"rejected",
            r"bad request",
            r"400",
            r"handshake.*fail",
            r"invalid",
        ]

        # Check logs in reverse order (most recent first)
        for log in reversed(list(self._logs_buffer)):
            log_lower = log.lower()
            for pattern in error_patterns:
                if re.search(pattern, log_lower, re.IGNORECASE):
                    return log

        return None

    @property
    def started(self):
        if not self.process:
            return False

        if self.process.poll() is None:
            return True

        return False

    def start(self, config: XRayConfig):
        if not self.available:
            raise RuntimeError("XRay is not available. Please install XRay to enable this functionality.")

        if self.started is True:
            raise RuntimeError("Xray is started already")

        def _resolve_log_path(value: str | None, filename: str, base_dir: Path) -> str | None:
            if value is None:
                return ""
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered == "none":
                    return "none"
                if not value.strip():
                    return ""
                candidate = Path(value.strip())
                # If user provided only filename or root-level filename (e.g., "/access.log"), place under base_dir.
                if not candidate.is_absolute() or candidate.parent == Path("/"):
                    return str(base_dir / candidate.name)
                return str(candidate)
            return str(base_dir / filename)

        base_log_dir = Path(XRAY_LOG_DIR or XRAY_ASSETS_PATH or "/var/log").expanduser()

        # Enable access/error log defaults to stdout unless overridden; resolve paths per runtime.
        log_config = config.get("log", {}) if isinstance(config.get("log", {}), dict) else {}
        log_config.setdefault("access", "")
        log_config.setdefault("error", "")

        # Track resolved log paths for downstream consumers (insights, etc.)
        self.access_log_path = None
        self.error_log_path = None

        for key, filename in (("access", "access.log"), ("error", "error.log")):
            resolved = _resolve_log_path(log_config.get(key), filename, base_log_dir)
            log_config[key] = resolved
            if resolved and isinstance(resolved, str) and resolved.lower() != "none":
                try:
                    Path(resolved).expanduser().parent.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass
                if key == "access":
                    self.access_log_path = Path(resolved).expanduser()
                elif key == "error":
                    self.error_log_path = Path(resolved).expanduser()

        config["log"] = log_config

        cmd = [self.executable_path, "run", "-config", "stdin:"]
        self.process = subprocess.Popen(
            cmd,
            env=self._env,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            universal_newlines=True,
        )
        self.process.stdin.write(config.to_json())
        self.process.stdin.flush()
        self.process.stdin.close()
        logger.warning(f"Xray core {self.version} started")

        self.__capture_process_logs()

        # execute on start functions
        for func in self._on_start_funcs:
            threading.Thread(target=func).start()

    def stop(self):
        if not self.started:
            return

        self.process.terminate()
        self.process = None
        logger.warning("Xray core stopped")

        # execute on stop functions
        for func in self._on_stop_funcs:
            threading.Thread(target=func).start()

    def restart(self, config: XRayConfig):
        if not self.available:
            raise RuntimeError("XRay is not available. Please install XRay to enable this functionality.")

        if self.restarting is True:
            return

        try:
            self.restarting = True
            logger.warning("Restarting Xray core...")
            self.stop()
            self.start(config)
        finally:
            self.restarting = False

    def on_start(self, func: callable):
        self._on_start_funcs.append(func)
        return func

    def on_stop(self, func: callable):
        self._on_stop_funcs.append(func)
        return func
