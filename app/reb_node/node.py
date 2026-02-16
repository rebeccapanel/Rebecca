import os
import re
import ssl
import tempfile
import threading
import time
import json
from collections import deque
from contextlib import contextmanager
from typing import Optional
from urllib.parse import quote

import grpc
import requests
from cryptography import x509
from cryptography.x509.oid import NameOID
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.poolmanager import PoolManager
from websocket import (
    WebSocketConnectionClosedException,
    WebSocketTimeoutException,
    create_connection,
)

from app.reb_node.config import XRayConfig
from config import NODE_HEALTH_CACHE_SECONDS
from xray_api import XRay as XRayAPI


def string_to_temp_file(content: str):
    file = tempfile.NamedTemporaryFile(mode="w+t")
    file.write(content)
    file.flush()
    return file


def _normalize_certificate_fields(certificate: dict) -> dict:
    if not isinstance(certificate, dict):
        return {}
    if "certificateFile" not in certificate:
        for key in ("certFile", "certfile"):
            if key in certificate:
                certificate["certificateFile"] = certificate.pop(key)
                break
    if "keyFile" not in certificate:
        for key in ("keyfile",):
            if key in certificate:
                certificate["keyFile"] = certificate.pop(key)
                break
    return certificate


class SANIgnoringAdaptor(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        self.poolmanager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, assert_hostname=False)


class NodeAPIError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


_GRPC_PROXY_ENV_LOCK = threading.Lock()


def _normalize_proxy_config(proxy: Optional[dict]) -> Optional[dict]:
    if not proxy:
        return None
    if not proxy.get("enabled"):
        return None
    raw_type = proxy.get("type")
    if raw_type is None:
        proxy_type = ""
    else:
        raw_value = getattr(raw_type, "value", raw_type)
        proxy_type = str(raw_value).strip().lower()
    host = str(proxy.get("host") or "").strip()
    port = proxy.get("port")
    username = proxy.get("username")
    password = proxy.get("password")

    if not proxy_type or not host or not port:
        return None
    if proxy_type not in ("http", "socks5"):
        return None

    try:
        port = int(port)
    except (TypeError, ValueError):
        return None

    return {
        "type": proxy_type,
        "host": host,
        "port": port,
        "username": username,
        "password": password,
    }


def _build_proxy_url(proxy: Optional[dict]) -> Optional[str]:
    if not proxy:
        return None
    proxy_type = proxy.get("type")
    host = proxy.get("host")
    port = proxy.get("port")
    if not proxy_type or not host or not port:
        return None

    scheme = "http" if proxy_type == "http" else "socks5h"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    username = proxy.get("username")
    password = proxy.get("password")
    auth = ""
    if username:
        safe_user = quote(str(username), safe="")
        if password:
            safe_pass = quote(str(password), safe="")
            auth = f"{safe_user}:{safe_pass}@"
        else:
            auth = f"{safe_user}@"
    return f"{scheme}://{auth}{host}:{port}"


def _build_ws_proxy_options(proxy: Optional[dict]) -> dict:
    if not proxy:
        return {}
    proxy_type = proxy.get("type")
    host = proxy.get("host")
    port = proxy.get("port")
    if not proxy_type or not host or not port:
        return {}
    ws_proxy_type = "http" if proxy_type == "http" else "socks5h"
    options = {
        "http_proxy_host": host,
        "http_proxy_port": port,
        "proxy_type": ws_proxy_type,
    }
    username = proxy.get("username")
    password = proxy.get("password")
    if username:
        options["http_proxy_auth"] = (str(username), str(password or ""))
    return options


def _extract_certificate_identity(pem_data: str) -> str | None:
    """Extract SAN/CN value from certificate for TLS target override."""
    if not pem_data:
        return None
    try:
        certificate = x509.load_pem_x509_certificate(pem_data.encode("utf-8"))
    except Exception:
        return None

    try:
        san = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        dns_names = san.value.get_values_for_type(x509.DNSName)
        if dns_names:
            return dns_names[0]
        ip_names = san.value.get_values_for_type(x509.IPAddress)
        if ip_names:
            return str(ip_names[0])
    except x509.ExtensionNotFound:
        pass
    except Exception:
        pass

    try:
        cn_attributes = certificate.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if cn_attributes:
            return cn_attributes[0].value
    except Exception:
        pass

    return None


def _select_root_certificate(pem_data: str) -> Optional[bytes]:
    """
    Return PEM bytes so gRPC trusts the node certificate (self-signed or custom CA).
    Previously we only returned certs that were strictly self-signed, which caused
    TLS handshakes to fail when the node used a custom CA. Supplying the presented
    cert here lets gRPC validate the connection.
    """
    if not pem_data:
        return None
    return pem_data.encode("utf-8")


def _fetch_cert_from_session(session: requests.Session, url: str) -> Optional[str]:
    res = None
    try:
        res = session.get(url, timeout=15, verify=False, stream=True)
        sock = getattr(getattr(res.raw, "connection", None), "sock", None)
        if sock:
            der_cert = sock.getpeercert(True)
            if der_cert:
                return ssl.DER_cert_to_PEM_cert(der_cert)
    except Exception:
        return None
    finally:
        if res is not None:
            try:
                res.close()
            except Exception:
                pass
    return None


class ReSTXRayNode:
    def __init__(
        self,
        address: str,
        port: int,
        api_port: int,
        ssl_key: str,
        ssl_cert: str,
        usage_coefficient: float = 1,
        proxy: Optional[dict] = None,
        server_cert: Optional[str] = None,
    ):
        self.address = address
        self.port = port
        self.api_port = api_port
        self.ssl_key = ssl_key
        self.ssl_cert = ssl_cert
        self.usage_coefficient = usage_coefficient
        self._server_cert = server_cert

        self._keyfile = string_to_temp_file(ssl_key)
        self._certfile = string_to_temp_file(ssl_cert)

        self._proxy = _normalize_proxy_config(proxy)
        self._proxy_url = _build_proxy_url(self._proxy)
        self._ws_proxy_options = _build_ws_proxy_options(self._proxy)
        self._grpc_channel_options = (("grpc.enable_http_proxy", 1),) if self._proxy_url else None
        self._health_ttl = max(int(NODE_HEALTH_CACHE_SECONDS or 0), 0)
        self._health_cache = {"checked_at": 0.0, "connected": False, "started": False}
        self._health_lock = threading.Lock()
        self._session_lock = threading.Lock()
        self.session = self._build_session()

        self._session_id = None
        self._rest_api_url = f"https://{self.address.strip('/')}:{self.port}"

        self._ssl_context = ssl.create_default_context()
        self._ssl_context.check_hostname = False
        self._ssl_context.verify_mode = ssl.CERT_NONE
        self._ssl_context.load_cert_chain(certfile=self.session.cert[0], keyfile=self.session.cert[1])
        self._logs_ws_url = f"wss://{self.address.strip('/')}:{self.port}/logs"
        self._logs_queues = []
        self._logs_bg_thread = threading.Thread(target=self._bg_fetch_logs, daemon=True)

        self._api = None
        self._started = False
        self.node_version = None
        self._tls_target_name = "rebeccapanel"
        self._grpc_root_cert: Optional[bytes] = None

    def _prepare_config(self, config: XRayConfig):
        for inbound in config.get("inbounds", []):
            streamSettings = inbound.get("streamSettings") or {}
            tlsSettings = streamSettings.get("tlsSettings") or {}
            certificates = tlsSettings.get("certificates") or []
            for certificate in certificates:
                if not isinstance(certificate, dict):
                    continue
                certificate = _normalize_certificate_fields(certificate)
                cert_path = certificate.get("certificateFile")
                if isinstance(cert_path, str) and cert_path.strip():
                    with open(cert_path) as file:
                        certificate["certificate"] = [line.strip() for line in file.readlines()]
                        certificate.pop("certificateFile", None)

                key_path = certificate.get("keyFile")
                if isinstance(key_path, str) and key_path.strip():
                    with open(key_path) as file:
                        certificate["key"] = [line.strip() for line in file.readlines()]
                        certificate.pop("keyFile", None)

        return config

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.trust_env = False
        if self._proxy_url:
            session.proxies.update({"http": self._proxy_url, "https": self._proxy_url})
        session.mount("https://", SANIgnoringAdaptor())
        session.cert = (self._certfile.name, self._keyfile.name)
        if getattr(self, "_node_certfile", None) is not None:
            session.verify = self._node_certfile.name
        return session

    def _reset_session(self):
        try:
            self.session.close()
        except Exception:
            pass
        self.session = self._build_session()

    @contextmanager
    def _grpc_proxy_env(self):
        if not self._proxy_url:
            yield
            return

        proxy_value = self._proxy_url
        keys = ["http_proxy", "https_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]
        with _GRPC_PROXY_ENV_LOCK:
            saved = {key: os.environ.get(key) for key in keys}
            try:
                os.environ["http_proxy"] = proxy_value
                os.environ["https_proxy"] = proxy_value
                os.environ["HTTP_PROXY"] = proxy_value
                os.environ["HTTPS_PROXY"] = proxy_value
                os.environ.pop("no_proxy", None)
                os.environ.pop("NO_PROXY", None)
                yield
            finally:
                for key, value in saved.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

    def _create_api(self):
        with self._grpc_proxy_env():
            return XRayAPI(
                address=self.address,
                port=self.api_port,
                ssl_cert=self._grpc_root_cert,
                ssl_target_name=self._tls_target_name,
                channel_options=self._grpc_channel_options,
            )

    def _check_health(self, *, force: bool = False) -> tuple[bool, bool]:
        now = time.time()
        if not force and self._health_ttl > 0:
            with self._health_lock:
                if now - self._health_cache["checked_at"] < self._health_ttl:
                    if not self._session_id:
                        if self._health_cache["connected"] or self._health_cache["started"]:
                            self._health_cache.update(
                                {
                                    "checked_at": now,
                                    "connected": False,
                                    "started": False,
                                }
                            )
                        self._api = None
                        self._started = False
                        return False, False
                    return self._health_cache["connected"], self._health_cache["started"]

        if not self._session_id:
            self._set_health_cache(False, False)
            self._api = None
            self._started = False
            return False, False

        connected = False
        started = False
        try:
            res = self.make_request("/", timeout=20)
            connected = True
            started = bool(res.get("started", False))
        except NodeAPIError:
            connected = False
            started = False

        with self._health_lock:
            self._health_cache.update(
                {
                    "checked_at": now,
                    "connected": connected,
                    "started": started,
                }
            )
        if not connected:
            self._session_id = None
            self._api = None
            self._started = False
        elif not started:
            self._api = None
            self._started = False
        else:
            self._started = True
        return connected, started

    def _set_health_cache(self, connected: bool, started: bool):
        with self._health_lock:
            self._health_cache.update(
                {
                    "checked_at": time.time(),
                    "connected": connected,
                    "started": started,
                }
            )

    def refresh_health(self, *, force: bool = True) -> tuple[bool, bool]:
        return self._check_health(force=force)

    def make_request(self, path: str, timeout: int, **params):
        payload = {"session_id": self._session_id, **params}
        last_exc: Exception | None = None

        for attempt in range(2):
            res = None
            with self._session_lock:
                try:
                    res = self.session.post(self._rest_api_url + path, timeout=timeout, json=payload)
                    try:
                        data = res.json()
                    except ValueError:
                        data = {}

                    if res.status_code == 200:
                        return data

                    detail = data.get("detail") if isinstance(data, dict) else None
                    if detail is None:
                        detail = res.text or "Unexpected response from node"
                    detail_text = detail.lower() if isinstance(detail, str) else ""
                    if res.status_code in (401, 403) or ("session" in detail_text):
                        self._session_id = None
                        self._api = None
                        self._started = False
                        self._set_health_cache(False, False)
                    raise NodeAPIError(res.status_code, detail)
                except NodeAPIError:
                    raise
                except requests.RequestException as exc:
                    last_exc = exc
                    if attempt == 0:
                        self._reset_session()
                        continue
                    self._session_id = None
                    self._api = None
                    self._started = False
                    self._set_health_cache(False, False)
                    raise NodeAPIError(0, str(exc))
                except Exception as exc:
                    last_exc = exc
                    self._session_id = None
                    self._api = None
                    self._started = False
                    self._set_health_cache(False, False)
                    raise NodeAPIError(0, str(exc))
                finally:
                    if res is not None:
                        try:
                            res.close()
                        except Exception:
                            pass

        if last_exc is None:
            last_exc = Exception("Unknown request failure")
        raise NodeAPIError(0, str(last_exc))

    @property
    def connected(self):
        return self._check_health()[0]

    @property
    def started(self):
        return self._check_health()[1]

    @property
    def api(self):
        if not self._session_id:
            raise ConnectionError("Node is not connected")

        if not self._api:
            if self._started is True:
                self._api = self._create_api()
            else:
                raise ConnectionError("Node is not started")

        return self._api

    def connect(self):
        node_cert = None
        if self._proxy_url:
            node_cert = _fetch_cert_from_session(self.session, self._rest_api_url)

        if not node_cert:
            try:
                node_cert = ssl.get_server_certificate((self.address, self.port))
            except Exception:
                node_cert = None

        if not node_cert and self._server_cert:
            node_cert = self._server_cert

        if not node_cert:
            raise ConnectionError("Unable to retrieve node certificate")

        self._node_cert = node_cert
        self._node_certfile = string_to_temp_file(self._node_cert)
        self.session.verify = self._node_certfile.name
        self._grpc_root_cert = _select_root_certificate(self._node_cert)
        parsed_target = _extract_certificate_identity(self._node_cert)
        if parsed_target:
            self._tls_target_name = parsed_target

        res = self.make_request("/connect", timeout=60)
        self._session_id = res["session_id"]

        # Get node version after connecting
        version_res = self.make_request("/", timeout=60)
        node_version = version_res.get("node_version")
        if node_version:
            self.node_version = node_version
        self._set_health_cache(True, bool(version_res.get("started", False)))

    def disconnect(self):
        self.make_request("/disconnect", timeout=60)
        self._session_id = None
        self._api = None
        self._started = False
        self._set_health_cache(False, False)

    def get_version(self):
        self._ensure_connected()
        res = self.make_request("/", timeout=60)
        node_version = res.get("node_version")
        if node_version:
            self.node_version = node_version
        return res.get("core_version")

    def start(self, config: XRayConfig):
        self._ensure_connected()

        config = self._prepare_config(config)
        json_config = config.to_json()

        try:
            res = self.make_request("/start", timeout=200, config=json_config)
        except NodeAPIError as exc:
            if exc.detail == "Xray is started already":
                return self.restart(config)
            else:
                raise exc

        self._started = True
        self._set_health_cache(True, True)

        self._api = self._create_api()

        try:
            grpc.channel_ready_future(self._api._channel).result(timeout=100)
        except grpc.FutureTimeoutError:
            raise ConnectionError("Failed to connect to node's API")

        return res

    def stop(self):
        self._ensure_connected()

        self.make_request("/stop", timeout=100)
        self._api = None
        self._started = False
        self._set_health_cache(True, False)

    def restart(self, config: XRayConfig):
        self._ensure_connected()

        config = self._prepare_config(config)
        json_config = config.to_json()

        res = self.make_request("/restart", timeout=200, config=json_config)

        self._started = True
        self._set_health_cache(True, True)

        self._api = self._create_api()

        try:
            grpc.channel_ready_future(self._api._channel).result(timeout=100)
        except grpc.FutureTimeoutError:
            raise ConnectionError("Failed to connect to node's API")

        return res

    def _bg_fetch_logs(self):
        while self._logs_queues:
            try:
                websocket_url = f"{self._logs_ws_url}?session_id={self._session_id}&interval=0.7"
                self._ssl_context.load_verify_locations(self.session.verify)
                ws = create_connection(
                    websocket_url,
                    sslopt={"context": self._ssl_context},
                    timeout=40,
                    **self._ws_proxy_options,
                )
                while self._logs_queues:
                    try:
                        logs = ws.recv()
                        for buf in self._logs_queues:
                            buf.append(logs)
                    except WebSocketConnectionClosedException:
                        break
                    except WebSocketTimeoutException:
                        pass
                    except Exception:
                        pass
            except Exception:
                pass
            time.sleep(2)

    @contextmanager
    def get_logs(self):
        try:
            buf = deque(maxlen=100)
            self._logs_queues.append(buf)

            if not self._logs_bg_thread.is_alive():
                try:
                    self._logs_bg_thread.start()
                except RuntimeError:
                    self._logs_bg_thread = threading.Thread(target=self._bg_fetch_logs, daemon=True)
                    self._logs_bg_thread.start()

            yield buf

        finally:
            try:
                self._logs_queues.remove(buf)
            except ValueError:
                pass
            del buf

    def update_core(self, version: str):
        # node REST service new endpoint
        self._ensure_connected()
        self.make_request("/update_core", timeout=300, version=version)

    def restart_host_service(self):
        """Ask the remote node to restart its Rebecca services via maintenance API."""
        self._ensure_connected()
        return self.make_request("/maintenance/restart", timeout=300)

    def update_host_service(self):
        """Ask the remote node to run the Rebecca-node update workflow via maintenance API."""
        self._ensure_connected()
        return self.make_request("/maintenance/update", timeout=900)

    def update_geo(self, files: list[dict]):
        """
        Push geo assets to node via its REST endpoint.
        files: list of {"name": "...", "url": "..."}
        """
        self._ensure_connected()
        self.make_request("/update_geo", timeout=300, files=files)

    def get_access_logs(self, max_lines: int = 500) -> list[str]:
        """
        Fetch access logs from node.
        Prefer websocket transport for lower overhead; fallback to REST endpoint.
        """
        self._ensure_connected()
        max_lines = max(1, int(max_lines))

        # Prefer websocket endpoint when available on node service.
        try:
            websocket_url = (
                f"wss://{self.address.strip('/')}:{self.port}/access_logs/ws"
                f"?session_id={self._session_id}&max_lines={max_lines}"
            )
            self._ssl_context.load_verify_locations(self.session.verify)
            ws = create_connection(
                websocket_url,
                sslopt={"context": self._ssl_context},
                timeout=40,
                **self._ws_proxy_options,
            )
            try:
                payload = ws.recv()
            finally:
                try:
                    ws.close()
                except Exception:
                    pass

            data = json.loads(payload) if payload else {}
            if isinstance(data, dict):
                if data.get("error"):
                    raise NodeAPIError(0, data.get("error"))
                lines = data.get("lines", [])
                if isinstance(lines, list):
                    return [str(line) for line in lines]
        except Exception:
            # Fallback to REST endpoint for backward compatibility with older nodes.
            pass

        response = self.make_request("/access_logs", timeout=30, max_lines=max_lines)
        if not isinstance(response, dict):
            raise NodeAPIError(0, "Invalid access logs response from node")
        if not response.get("exists"):
            return []
        lines = response.get("lines") or []
        if not isinstance(lines, list):
            raise NodeAPIError(0, "Invalid access logs payload")
        return [str(line) for line in lines]

    def _ensure_connected(self):
        try:
            connected, _ = self.refresh_health(force=True)
        except Exception:
            connected = False
        if not connected:
            self.connect()


class XRayNode:
    def __new__(
        self,
        address: str,
        port: int,
        api_port: int,
        ssl_key: str,
        ssl_cert: str,
        usage_coefficient: float = 1,
        proxy: Optional[dict] = None,
        server_cert: Optional[str] = None,
    ):
        return ReSTXRayNode(
            address=address,
            port=port,
            api_port=api_port,
            ssl_key=ssl_key,
            ssl_cert=ssl_cert,
            usage_coefficient=usage_coefficient,
            proxy=proxy,
            server_cert=server_cert,
        )
