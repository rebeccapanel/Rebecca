import re
import ssl
import tempfile
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Optional

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
from xray_api import XRay as XRayAPI


def string_to_temp_file(content: str):
    file = tempfile.NamedTemporaryFile(mode="w+t")
    file.write(content)
    file.flush()
    return file


class SANIgnoringAdaptor(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        self.poolmanager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, assert_hostname=False)


class NodeAPIError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


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


class ReSTXRayNode:
    def __init__(
        self,
        address: str,
        port: int,
        api_port: int,
        ssl_key: str,
        ssl_cert: str,
        usage_coefficient: float = 1,
    ):
        self.address = address
        self.port = port
        self.api_port = api_port
        self.ssl_key = ssl_key
        self.ssl_cert = ssl_cert
        self.usage_coefficient = usage_coefficient

        self._keyfile = string_to_temp_file(ssl_key)
        self._certfile = string_to_temp_file(ssl_cert)

        self.session = requests.Session()
        self.session.mount("https://", SANIgnoringAdaptor())
        self.session.cert = (self._certfile.name, self._keyfile.name)

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
                if certificate.get("certificateFile"):
                    with open(certificate["certificateFile"]) as file:
                        certificate["certificate"] = [line.strip() for line in file.readlines()]
                        del certificate["certificateFile"]

                if certificate.get("keyFile"):
                    with open(certificate["keyFile"]) as file:
                        certificate["key"] = [line.strip() for line in file.readlines()]
                        del certificate["keyFile"]

        return config

    def make_request(self, path: str, timeout: int, **params):
        try:
            res = self.session.post(
                self._rest_api_url + path, timeout=timeout, json={"session_id": self._session_id, **params}
            )
            data = res.json()
        except Exception as e:
            exc = NodeAPIError(0, str(e))
            raise exc

        if res.status_code == 200:
            return data
        else:
            exc = NodeAPIError(res.status_code, data["detail"])
            raise exc

    @property
    def connected(self):
        if not self._session_id:
            return False
        try:
            self.make_request("/ping", timeout=60)
            return True
        except NodeAPIError:
            return False

    @property
    def started(self):
        res = self.make_request("/", timeout=60)
        return res.get("started", False)

    @property
    def api(self):
        if not self._session_id:
            raise ConnectionError("Node is not connected")

        if not self._api:
            if self._started is True:
                self._api = XRayAPI(
                    address=self.address,
                    port=self.api_port,
                    ssl_cert=self._grpc_root_cert,
                    ssl_target_name=self._tls_target_name,
                )
            else:
                raise ConnectionError("Node is not started")

        return self._api

    def connect(self):
        self._node_cert = ssl.get_server_certificate((self.address, self.port))
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

    def disconnect(self):
        self.make_request("/disconnect", timeout=60)
        self._session_id = None

    def get_version(self):
        res = self.make_request("/", timeout=60)
        node_version = res.get("node_version")
        if node_version:
            self.node_version = node_version
        return res.get("core_version")

    def start(self, config: XRayConfig):
        if not self.connected:
            self.connect()

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

        self._api = XRayAPI(
            address=self.address,
            port=self.api_port,
            ssl_cert=self._grpc_root_cert,
            ssl_target_name=self._tls_target_name,
        )

        try:
            grpc.channel_ready_future(self._api._channel).result(timeout=100)
        except grpc.FutureTimeoutError:
            raise ConnectionError("Failed to connect to node's API")

        return res

    def stop(self):
        if not self.connected:
            self.connect()

        self.make_request("/stop", timeout=100)
        self._api = None
        self._started = False

    def restart(self, config: XRayConfig):
        if not self.connected:
            self.connect()

        config = self._prepare_config(config)
        json_config = config.to_json()

        res = self.make_request("/restart", timeout=200, config=json_config)

        self._started = True

        self._api = XRayAPI(
            address=self.address,
            port=self.api_port,
            ssl_cert=self._grpc_root_cert,
            ssl_target_name=self._tls_target_name,
        )

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
                ws = create_connection(websocket_url, sslopt={"context": self._ssl_context}, timeout=40)
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
        self.make_request("/update_core", timeout=300, version=version)

    def restart_host_service(self):
        """Ask the remote node to restart its Rebecca services via maintenance API."""
        if not self.connected:
            self.connect()
        return self.make_request("/maintenance/restart", timeout=300)

    def update_host_service(self):
        """Ask the remote node to run the Rebecca-node update workflow via maintenance API."""
        if not self.connected:
            self.connect()
        return self.make_request("/maintenance/update", timeout=900)

    def update_geo(self, files: list[dict]):
        """
        Push geo assets to node via its REST endpoint.
        files: list of {"name": "...", "url": "..."}
        """
        if not self.connected:
            self.connect()
        self.make_request("/update_geo", timeout=300, files=files)


class XRayNode:
    def __new__(
        self, address: str, port: int, api_port: int, ssl_key: str, ssl_cert: str, usage_coefficient: float = 1
    ):
        return ReSTXRayNode(
            address=address,
            port=port,
            api_port=api_port,
            ssl_key=ssl_key,
            ssl_cert=ssl_cert,
            usage_coefficient=usage_coefficient,
        )
