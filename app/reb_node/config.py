from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import subprocess
import uuid
from collections import defaultdict
from copy import deepcopy
from pathlib import PosixPath
from typing import Union

import commentjson
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from sqlalchemy import func, literal

from app.db import GetDB
from app.db import models as db_models
from app.models.proxy import ProxyTypes, ProxySettings
from app.models.user import UserStatus
from app.utils.crypto import get_cert_SANs
from app.utils.credentials import runtime_proxy_settings, UUID_PROTOCOLS, normalize_flow_value
from app.utils.xray_defaults import apply_log_paths
from config import (
    DEBUG,
    XRAY_EXECUTABLE_PATH,
    XRAY_EXCLUDE_INBOUND_TAGS,
    XRAY_FALLBACKS_INBOUND_TAG,
)


def merge_dicts(a, b):  # B will override A dictionary key and values
    for key, value in b.items():
        if isinstance(value, dict) and key in a and isinstance(a[key], dict):
            merge_dicts(a[key], value)  # Recursively merge nested dictionaries
        else:
            a[key] = value
    return a


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


def _derive_reality_public_key_python(private_key: str) -> str:
    """
    Derive the public key for a Reality inbound using pure Python (X25519).
    Raises ValueError when the provided key cannot be decoded or is invalid.
    """
    if not private_key:
        raise ValueError("Reality private key is empty")

    normalized = "".join(private_key.split())
    padding = "=" * ((4 - len(normalized) % 4) % 4)
    candidate = normalized + padding

    decoded: bytes | None = None
    errors: list[Exception] = []
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            decoded = decoder(candidate.encode("utf-8"))
            break
        except (binascii.Error, ValueError) as exc:  # pragma: no cover - defensive
            errors.append(exc)
            continue

    if decoded is None:
        last_error = errors[-1] if errors else None
        raise ValueError("Reality private key is not valid Base64") from last_error

    if len(decoded) != 32:
        raise ValueError("Reality private key must decode to 32 bytes")

    try:
        private_key_obj = x25519.X25519PrivateKey.from_private_bytes(decoded)
    except ValueError as exc:
        raise ValueError("Reality private key bytes are invalid") from exc

    public_bytes = private_key_obj.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    # Xray's built-in generator returns url-safe Base64 without padding.
    return base64.urlsafe_b64encode(public_bytes).rstrip(b"=").decode("utf-8")


def derive_reality_public_key(private_key: str) -> str:
    """
    Try to derive the Reality public key exactly the way Xray does (through the
    CLI helper) to ensure identical formatting. Fall back to a pure Python
    implementation when the CLI helper is unavailable.
    """
    if not private_key:
        raise ValueError("Reality private key is empty")

    try:
        cmd = [XRAY_EXECUTABLE_PATH, "x25519"]
        if private_key:
            cmd.extend(["-i", private_key])
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8")
        match = re.match(r"Private key: (.+)\nPublic key: (.+)", output)
        if match:
            return match.group(2)
    except Exception:  # pragma: no cover - fallback handled below
        pass

    return _derive_reality_public_key_python(private_key)


def _is_valid_uuid(uuid_value) -> bool:
    """
    Check if a value is a valid UUID.

    Args:
        uuid_value: The value to check (can be UUID object, string, None, etc.)

    Returns:
        True if uuid_value is a valid UUID, False otherwise
    """
    if uuid_value is None:
        return False

    if isinstance(uuid_value, uuid.UUID):
        return True

    if isinstance(uuid_value, str):
        # Check for empty string or "null" string
        if not uuid_value or uuid_value.lower() == "null":
            return False
        try:
            uuid.UUID(uuid_value)
            return True
        except (ValueError, AttributeError):
            return False

    return False


def _flow_supported_for_inbound(inbound: dict) -> bool:
    """
    XTLS flow is only supported on TCP/RAW/KCP transports with TLS/Reality
    and non-HTTP headers. If inbound info is missing, treat as unsupported.
    """
    try:
        network = inbound.get("network", "tcp")
        tls_type = inbound.get("tls", "none")
        header_type = inbound.get("header_type", "")
    except Exception:
        return False
    return network in ("tcp", "kcp") and tls_type in ("tls", "reality") and header_type != "http"


def get_xray_version():
    """
    Get the installed Xray core version from the running instance.
    Falls back to creating a temporary instance if runtime is not yet initialized.

    Returns:
        str: Version string (e.g., "1.8.4") if Xray is available, None otherwise.
    """
    try:
        # Try to use the already-running core instance from runtime
        from app.reb_node.state import core

        return core.version if core.available else None
    except Exception:
        return None


def is_xray_version_at_least(target_version: str) -> bool:
    """
    Check if the current Xray version is at least the target version.
    Version format is YY.M.DD (e.g., "26.1.31" for Jan 31, 2026).

    Args:
        target_version: Target version string (e.g., "26.1.31")

    Returns:
        bool: True if current version >= target version, False otherwise.
              Returns True if version cannot be determined.

    Examples:
        >>> is_xray_version_at_least("26.1.31")  # Check if current version is at least 26.1.31
    """

    current_version = get_xray_version()

    if not current_version or not target_version:
        return True  # Assume true if version cannot be determined

    try:
        # Parse versions into tuples of integers for comparison
        current_parts = [int(x) for x in current_version.split(".")]
        target_parts = [int(x) for x in target_version.split(".")]

        # Pad shorter version with zeros for comparison
        max_len = max(len(current_parts), len(target_parts))
        current_parts.extend([0] * (max_len - len(current_parts)))
        target_parts.extend([0] * (max_len - len(target_parts)))

        # Compare versions
        return tuple(current_parts) >= tuple(target_parts)
    except (ValueError, AttributeError):
        return True  # Assume true if version cannot be determined


class XRayConfig(dict):
    def __init__(self, config: Union[dict, str, PosixPath] = {}, api_host: str = "127.0.0.1", api_port: int = 8080):
        if isinstance(config, str):
            try:
                # considering string as json
                config = commentjson.loads(config)
            except (json.JSONDecodeError, ValueError):
                # considering string as file path
                with open(config, "r") as file:
                    config = commentjson.loads(file.read())

        if isinstance(config, PosixPath):
            with open(config, "r") as file:
                config = commentjson.loads(file.read())

        if isinstance(config, dict):
            config = deepcopy(config)
        else:
            config = {}

        config = apply_log_paths(config)

        self.api_host = api_host
        self.api_port = api_port

        super().__init__(config)
        self._validate()

        # Migrate deprecated configs before processing
        self._migrate_deprecated_configs()

        self.inbounds = []
        self.inbounds_by_protocol = {}
        self.inbounds_by_tag = {}
        self._fallbacks_inbound = self.get_inbound(XRAY_FALLBACKS_INBOUND_TAG)
        self._resolve_inbounds()

        self._apply_api()

    def _apply_api(self):
        api_inbound = self.get_inbound("API_INBOUND")
        # Always enable API services/policy at runtime (do not persist).
        self["api"] = {"services": ["HandlerService", "StatsService", "LoggerService"], "tag": "API"}
        self["stats"] = {}
        forced_policies = {
            "levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}},
            "system": {
                "statsInboundDownlink": False,
                "statsInboundUplink": False,
                "statsOutboundDownlink": True,
                "statsOutboundUplink": True,
            },
        }
        current_policy = self.get("policy")
        if not isinstance(current_policy, dict):
            if isinstance(current_policy, str):
                try:
                    current_policy = json.loads(current_policy)
                except Exception:
                    current_policy = {}
            else:
                current_policy = {}

        if current_policy:
            self["policy"] = merge_dicts(current_policy, forced_policies)
        else:
            self["policy"] = forced_policies

        if api_inbound:
            listen_value = api_inbound.get("listen")
            if isinstance(listen_value, dict):
                listen_value["address"] = self.api_host
                api_inbound["listen"] = listen_value
            else:
                api_inbound["listen"] = self.api_host
            api_inbound["port"] = self.api_port
            settings = api_inbound.get("settings")
            if isinstance(settings, dict):
                settings["address"] = self.api_host
            else:
                api_inbound["settings"] = {"address": self.api_host}
        else:
            inbound = {
                "listen": self.api_host,
                "port": self.api_port,
                "protocol": "dokodemo-door",
                "settings": {"address": self.api_host},
                "tag": "API_INBOUND",
            }
            try:
                self["inbounds"].insert(0, inbound)
            except KeyError:
                self["inbounds"] = []
                self["inbounds"].insert(0, inbound)

        rule = {"inboundTag": ["API_INBOUND"], "outboundTag": "API", "type": "field"}
        rules = None
        if isinstance(self.get("routing"), dict):
            rules = self.get("routing", {}).get("rules")
        if not isinstance(rules, list):
            self["routing"] = {"rules": []}
            rules = self["routing"]["rules"]
        if not any(
            isinstance(r, dict)
            and r.get("type") == "field"
            and r.get("outboundTag") == "API"
            and "API_INBOUND" in (r.get("inboundTag") or [])
            for r in rules
        ):
            rules.insert(0, rule)

    def _migrate_deprecated_configs(self):
        """Migrate deprecated config formats to new formats to avoid deprecation warnings."""

        def migrate_stream_settings(stream):
            """Helper function to migrate stream settings for both inbound and outbound."""
            if not stream:
                return

            # Migrate WebSocket transport: move host from headers.Host to host
            if stream.get("network") == "ws":
                ws_settings = stream.get("wsSettings", {})
                if ws_settings:
                    # Check if host is in headers (deprecated)
                    headers = ws_settings.get("headers", {})
                    if headers and "Host" in headers:
                        # Migrate host from headers to host field if host is not already set
                        if not ws_settings.get("host"):
                            ws_settings["host"] = headers["Host"]
                        # Remove Host from headers if it exists
                        if "Host" in headers:
                            del headers["Host"]
                        # Clean up empty headers dict
                        if not headers:
                            ws_settings.pop("headers", None)

            # Migrate TCP transport: move host from headers.Host to host (if applicable)
            elif stream.get("network") in ("tcp", "raw"):
                tcp_settings = stream.get("tcpSettings", {})
                if tcp_settings:
                    header = tcp_settings.get("header", {})
                    if header and header.get("type") == "http":
                        request = header.get("request", {})
                        if request:
                            req_headers = request.get("headers", {})
                            if req_headers and "Host" in req_headers:
                                # For TCP, host should be in request.headers.Host as a list
                                # But we should ensure it's properly formatted
                                host_value = req_headers["Host"]
                                if isinstance(host_value, str):
                                    # Convert string to list if needed
                                    req_headers["Host"] = [host_value]

        # Migrate inbounds
        if "inbounds" in self:
            for inbound in self["inbounds"]:
                stream = inbound.get("streamSettings", {})
                migrate_stream_settings(stream)

        # Migrate outbounds
        if "outbounds" in self:
            for outbound in self["outbounds"]:
                stream = outbound.get("streamSettings", {})
                migrate_stream_settings(stream)

    def _validate(self):
        if not self.get("inbounds"):
            raise ValueError("config doesn't have inbounds")

        if not self.get("outbounds"):
            raise ValueError("config doesn't have outbounds")

        for inbound in self["inbounds"]:
            if not inbound.get("tag"):
                raise ValueError("all inbounds must have a unique tag")
            if "," in inbound.get("tag"):
                raise ValueError("character «,» is not allowed in inbound tag")
        for outbound in self["outbounds"]:
            if not outbound.get("tag"):
                raise ValueError("all outbounds must have a unique tag")

    def _resolve_inbounds(self):
        for inbound in self["inbounds"]:
            if inbound["protocol"] not in ProxyTypes._value2member_map_:
                continue

            if inbound["tag"] in XRAY_EXCLUDE_INBOUND_TAGS:
                continue

            if not inbound.get("settings"):
                inbound["settings"] = {}
            if not inbound["settings"].get("clients"):
                inbound["settings"]["clients"] = []

            settings = {
                "tag": inbound["tag"],
                "protocol": inbound["protocol"],
                "port": None,
                "network": "tcp",
                "tls": "none",
                "sni": [],
                "host": [],
                "path": "",
                "header_type": "",
                "is_fallback": False,
            }

            if inbound["protocol"] == "vless":
                inbound_settings = inbound.get("settings") or {}
                if isinstance(inbound_settings, dict):
                    encryption = inbound_settings.get("encryption")
                    if isinstance(encryption, str):
                        encryption = encryption.strip()
                    if encryption:
                        settings["encryption"] = encryption

            # port settings
            try:
                settings["port"] = inbound["port"]
            except KeyError:
                if self._fallbacks_inbound:
                    try:
                        settings["port"] = self._fallbacks_inbound["port"]
                        settings["is_fallback"] = True
                    except KeyError:
                        raise ValueError("fallbacks inbound doesn't have port")

            # stream settings
            if stream := inbound.get("streamSettings"):
                net = stream.get("network", "tcp")
                net_settings = stream.get(f"{net}Settings", {})
                security = stream.get("security")
                tls_settings = stream.get(f"{security}Settings", {}) if security else {}
                if not isinstance(tls_settings, dict):
                    tls_settings = {}
                tls_settings_meta = (
                    tls_settings.get("settings") if isinstance(tls_settings.get("settings"), dict) else {}
                )

                if settings["is_fallback"] is True:
                    # probably this is a fallback
                    security = self._fallbacks_inbound.get("streamSettings", {}).get("security")
                    tls_settings = self._fallbacks_inbound.get("streamSettings", {}).get(f"{security}Settings", {})
                    if not isinstance(tls_settings, dict):
                        tls_settings = {}
                    tls_settings_meta = (
                        tls_settings.get("settings") if isinstance(tls_settings.get("settings"), dict) else {}
                    )

                settings["network"] = net

                if security == "tls":
                    settings["tls"] = "tls"
                    fp = tls_settings_meta.get("fingerprint") or tls_settings.get("fingerprint")
                    if fp:
                        settings["fp"] = fp
                    allow_insecure = tls_settings_meta.get("allowInsecure")
                    if allow_insecure is None:
                        allow_insecure = tls_settings.get("allowInsecure")
                    if allow_insecure is not None:
                        settings["ais"] = bool(allow_insecure)
                        settings["allowinsecure"] = bool(allow_insecure)
                    alpn = tls_settings.get("alpn")
                    if isinstance(alpn, list):
                        alpn = ",".join([str(value) for value in alpn if value])
                    if isinstance(alpn, str) and alpn.strip():
                        settings["alpn"] = alpn.strip()
                    for certificate in tls_settings.get("certificates", []):
                        if not isinstance(certificate, dict):
                            continue
                        certificate = _normalize_certificate_fields(certificate)
                        cert_path = certificate.get("certificateFile", None)
                        if isinstance(cert_path, str) and cert_path.strip():
                            with open(cert_path, "rb") as file:
                                cert = file.read()
                                settings["sni"].extend(get_cert_SANs(cert))

                        if certificate.get("certificate", None):
                            cert = certificate["certificate"]
                            if isinstance(cert, list):
                                cert = "\n".join(cert)
                            if isinstance(cert, str):
                                cert = cert.encode()
                            settings["sni"].extend(get_cert_SANs(cert))
                    if not settings["sni"]:
                        server_name = tls_settings.get("serverName") or tls_settings.get("sni")
                        if isinstance(server_name, str) and server_name.strip():
                            settings["sni"] = [server_name.strip()]

                elif security == "reality":
                    fp = tls_settings_meta.get("fingerprint") or tls_settings.get("fingerprint")
                    if fp:
                        settings["fp"] = fp
                    else:
                        settings["fp"] = "chrome"
                    settings["tls"] = "reality"
                    server_names = tls_settings.get("serverNames") or []
                    if isinstance(server_names, str):
                        server_names = [server_names]
                    if not isinstance(server_names, list):
                        server_names = []
                    settings["sni"] = server_names

                    try:
                        settings["pbk"] = tls_settings_meta.get("publicKey") or tls_settings["publicKey"]
                    except KeyError:
                        pvk = tls_settings.get("privateKey")
                        if not pvk:
                            raise ValueError(f"You need to provide privateKey in realitySettings of {inbound['tag']}")

                        try:
                            settings["pbk"] = derive_reality_public_key(pvk)
                        except ValueError as exc:
                            raise ValueError(
                                f"Invalid privateKey in realitySettings of {inbound['tag']}: {exc}"
                            ) from exc

                    sids = tls_settings.get("shortIds") or []
                    if isinstance(sids, str):
                        sids = [sids]
                    if not isinstance(sids, list):
                        sids = []
                    sids = [sid for sid in sids if isinstance(sid, str) and sid.strip()]
                    # Allow Reality configs without short IDs (Xray treats them as optional)
                    settings["sids"] = sids
                    spider_x = (
                        tls_settings_meta.get("spiderX")
                        or tls_settings.get("SpiderX")
                        or tls_settings.get("spiderX", "")
                    )
                    settings["spx"] = spider_x or ""

                if net in ("tcp", "raw"):
                    header = net_settings.get("header", {})
                    request = header.get("request", {})
                    path = request.get("path")
                    host = request.get("headers", {}).get("Host")

                    settings["header_type"] = header.get("type", "")

                    if isinstance(path, str) or isinstance(host, str):
                        raise ValueError(
                            f"Settings of {inbound['tag']} for path and host must be list, not str\n"
                            "https://xtls.github.io/config/transports/tcp.html#httpheaderobject"
                        )

                    if path and isinstance(path, list):
                        settings["path"] = path[0]

                    if host and isinstance(host, list):
                        settings["host"] = host

                elif net == "ws":
                    path = net_settings.get("path", "")
                    # Use host field directly (migration from headers.Host should be done in _migrate_deprecated_configs)
                    # Fallback to headers.Host only if host is not set (for backward compatibility during transition)
                    host = net_settings.get("host", "") or net_settings.get("headers", {}).get("Host")

                    settings["header_type"] = ""

                    if isinstance(path, list) or isinstance(host, list):
                        raise ValueError(
                            f"Settings of {inbound['tag']} for path and host must be str, not list\n"
                            "https://xtls.github.io/config/transports/websocket.html#websocketobject"
                        )

                    if isinstance(path, str):
                        settings["path"] = path

                    if isinstance(host, str):
                        settings["host"] = [host]

                    settings["heartbeatPeriod"] = net_settings.get("heartbeatPeriod", 0)
                elif net == "grpc" or net == "gun":
                    settings["header_type"] = ""
                    settings["path"] = net_settings.get("serviceName", "")
                    host = net_settings.get("authority", "")
                    settings["host"] = [host]
                    settings["multiMode"] = net_settings.get("multiMode", False)

                elif net == "quic":
                    settings["header_type"] = net_settings.get("header", {}).get("type", "")
                    settings["path"] = net_settings.get("key", "")
                    settings["host"] = [net_settings.get("security", "")]

                elif net == "httpupgrade":
                    settings["path"] = net_settings.get("path", "")
                    host = net_settings.get("host", "")
                    settings["host"] = [host]

                elif net in ("splithttp", "xhttp"):
                    settings["path"] = net_settings.get("path", "")
                    host = net_settings.get("host", "")
                    settings["host"] = [host] if host else []
                    if "scMaxEachPostBytes" in net_settings:
                        settings["scMaxEachPostBytes"] = net_settings.get("scMaxEachPostBytes")
                    if "scMaxConcurrentPosts" in net_settings:
                        settings["scMaxConcurrentPosts"] = net_settings.get("scMaxConcurrentPosts")
                    if "scMinPostsIntervalMs" in net_settings:
                        settings["scMinPostsIntervalMs"] = net_settings.get("scMinPostsIntervalMs")
                    if "xPaddingBytes" in net_settings:
                        settings["xPaddingBytes"] = net_settings.get("xPaddingBytes")
                    if "xmux" in net_settings and net_settings.get("xmux") is not None:
                        settings["xmux"] = net_settings.get("xmux")
                    if "mode" in net_settings:
                        settings["mode"] = net_settings.get("mode")
                    if "noGRPCHeader" in net_settings:
                        settings["noGRPCHeader"] = net_settings.get("noGRPCHeader")
                    if "keepAlivePeriod" in net_settings:
                        settings["keepAlivePeriod"] = net_settings.get("keepAlivePeriod")

                elif net == "kcp":
                    header = net_settings.get("header", {})

                    settings["header_type"] = header.get("type", "")
                    settings["host"] = header.get("domain", "")
                    settings["path"] = net_settings.get("seed", "")

                elif net in ("http", "h2", "h3"):
                    net_settings = stream.get("httpSettings", {})

                    settings["host"] = net_settings.get("host") or net_settings.get("Host", "")
                    settings["path"] = net_settings.get("path", "")

                else:
                    settings["path"] = net_settings.get("path", "")
                    host = net_settings.get("host", {}) or net_settings.get("Host", {})
                    if host and isinstance(host, str):
                        settings["host"] = host
                    elif host and isinstance(host, list):
                        settings["host"] = host[0]

            self.inbounds.append(settings)
            self.inbounds_by_tag[inbound["tag"]] = settings

            try:
                self.inbounds_by_protocol[inbound["protocol"]].append(settings)
            except KeyError:
                self.inbounds_by_protocol[inbound["protocol"]] = [settings]

    def get_inbound(self, tag) -> dict:
        for inbound in self["inbounds"]:
            if inbound["tag"] == tag:
                return inbound

    def get_outbound(self, tag) -> dict:
        for outbound in self["outbounds"]:
            if outbound["tag"] == tag:
                return outbound

    def to_json(self, **json_kwargs):
        # Ensure migration is applied before converting to JSON
        # This is important because config might be modified after initialization
        self._migrate_deprecated_configs()
        return json.dumps(self, **json_kwargs)

    def copy(self):
        return deepcopy(self)

    def include_db_users(self) -> XRayConfig:
        config = self.copy()
        # Ensure migration is applied to the copied config before adding users
        config._migrate_deprecated_configs()

        with GetDB() as db:
            base_columns = (
                db_models.User.id,
                db_models.User.username,
                db_models.User.credential_key,
                db_models.User.flow,
                db_models.User.service_id,
                func.lower(db_models.Proxy.type).label("type"),
                db_models.Proxy.settings,
            )

            service_query = (
                db.query(
                    *base_columns,
                    literal(None).label("excluded_inbound_tags"),
                )
                .join(db_models.Proxy, db_models.User.id == db_models.Proxy.user_id)
                .filter(db_models.User.status.in_([UserStatus.active, UserStatus.on_hold]))
                .filter(db_models.User.service_id.isnot(None))
                .group_by(
                    func.lower(db_models.Proxy.type),
                    db_models.User.id,
                    db_models.User.username,
                    db_models.User.credential_key,
                    db_models.User.flow,
                    db_models.User.service_id,
                    db_models.Proxy.settings,
                )
            )

            no_service_query = (
                db.query(
                    *base_columns,
                    func.group_concat(db_models.excluded_inbounds_association.c.inbound_tag).label(
                        "excluded_inbound_tags"
                    ),
                )
                .join(db_models.Proxy, db_models.User.id == db_models.Proxy.user_id)
                .outerjoin(
                    db_models.excluded_inbounds_association,
                    db_models.Proxy.id == db_models.excluded_inbounds_association.c.proxy_id,
                )
                .filter(db_models.User.status.in_([UserStatus.active, UserStatus.on_hold]))
                .filter(db_models.User.service_id.is_(None))
                .group_by(
                    func.lower(db_models.Proxy.type),
                    db_models.User.id,
                    db_models.User.username,
                    db_models.User.credential_key,
                    db_models.User.flow,
                    db_models.User.service_id,
                    db_models.Proxy.settings,
                )
            )
            result = list(service_query.all()) + list(no_service_query.all())

            grouped_data = defaultdict(list)
            service_allowed_cache: dict[int, set[str]] = {}

            def _get_service_allowed_tags(service_id: int) -> set[str]:
                if service_id in service_allowed_cache:
                    return service_allowed_cache[service_id]
                try:
                    from app.services.data_access import get_service_host_map_cached

                    host_map = get_service_host_map_cached(service_id, force_refresh=True)
                except Exception:
                    host_map = {}
                allowed = {tag for tag, hosts in (host_map or {}).items() if hosts}
                if not allowed:
                    try:
                        rows = (
                            db.query(db_models.ProxyHost.inbound_tag)
                            .join(
                                db_models.ServiceHostLink,
                                db_models.ServiceHostLink.host_id == db_models.ProxyHost.id,
                            )
                            .filter(db_models.ServiceHostLink.service_id == service_id)
                            .filter(~db_models.ProxyHost.is_disabled.is_(True))
                            .distinct()
                            .all()
                        )
                        allowed = {row[0] for row in rows if row and row[0]}
                    except Exception:
                        pass
                service_allowed_cache[service_id] = allowed
                return allowed

            for row in result:
                grouped_data[row.type].append(
                    (
                        row.id,
                        row.username,
                        row.credential_key,
                        row.flow,
                        row.settings,
                        [i for i in row.excluded_inbound_tags.split(",") if i] if row.excluded_inbound_tags else None,
                        row.service_id,
                    )
                )

            for proxy_type, rows in grouped_data.items():
                inbounds = self.inbounds_by_protocol.get(proxy_type)
                if not inbounds:
                    continue

                for inbound in inbounds:
                    clients = config.get_inbound(inbound["tag"])["settings"]["clients"]

                    for row in rows:
                        user_id, username, credential_key, user_flow, settings, excluded_inbound_tags, service_id = row

                        if service_id is not None:
                            allowed_tags = _get_service_allowed_tags(service_id)
                            if inbound["tag"] not in allowed_tags:
                                continue
                        elif excluded_inbound_tags and inbound["tag"] in excluded_inbound_tags:
                            continue

                        email = f"{user_id}.{username}"
                        proxy_type_enum = None

                        try:
                            proxy_type_enum = ProxyTypes(proxy_type)
                        except (ValueError, KeyError) as e:
                            logger = logging.getLogger("uvicorn.error")
                            logger.warning(f"Invalid proxy_type {proxy_type}: {e}")
                            continue

                        client_to_add = None

                        try:
                            settings_obj = ProxySettings.from_dict(proxy_type_enum, settings.copy())
                            flow_value = normalize_flow_value(user_flow) if user_flow else None
                            if flow_value and proxy_type_enum in (ProxyTypes.VLESS, ProxyTypes.Trojan):
                                runtime_settings = runtime_proxy_settings(
                                    settings_obj, proxy_type_enum, credential_key, flow=flow_value
                                )
                            else:
                                runtime_settings = runtime_proxy_settings(settings_obj, proxy_type_enum, credential_key)

                            client_to_add = {"email": email, **runtime_settings}

                            if client_to_add.get("id") is not None:
                                client_to_add["id"] = str(client_to_add["id"])

                            if client_to_add.get("flow"):
                                if not _flow_supported_for_inbound(inbound or {}):
                                    del client_to_add["flow"]
                        except Exception as e:
                            logger = logging.getLogger("uvicorn.error")
                            logger.warning(f"Failed to resolve credentials for user {user_id}: {e}")
                            client_to_add = None

                        if client_to_add:
                            # Flow is optional - users with flow can connect if inbound supports it,
                            # users without flow can always connect
                            clients.append(client_to_add)
                        else:
                            # If no client was added, this is an error case
                            logger = logging.getLogger("uvicorn.error")
                            logger.warning(
                                "User %s has no credentials (UUID/password) and no credential_key for %s - skipping",
                                user_id,
                                proxy_type,
                            )

        for inbound in config.get("inbounds", []):
            stream = inbound.get("streamSettings")
            if not isinstance(stream, dict):
                continue
            tls_settings = stream.get("tlsSettings")
            if isinstance(tls_settings, dict):
                # Create a copy to modify
                tls_settings = {**tls_settings}
                # Remove deprecated "settings" key if present
                if "settings" in tls_settings:
                    tls_settings.pop("settings", None)

                # Apply version-based migration
                if is_xray_version_at_least("26.1.31"):
                    # verifyPeerCertInNames is the old one it has been replaced by verifyPeerCertByName
                    if tls_settings.get("verifyPeerCertInNames"):
                        names = tls_settings.pop("verifyPeerCertInNames", None)
                        # If verifyPeerCertByName is already set, keep its value and just remove the old field.
                        if not tls_settings.get("verifyPeerCertByName") and names:
                            # verifyPeerCertByName expects a string, not an array
                            if isinstance(names, list) and len(names) > 0:
                                tls_settings["verifyPeerCertByName"] = names[0]
                            elif isinstance(names, str):
                                tls_settings["verifyPeerCertByName"] = names
                else:
                    if tls_settings.get("verifyPeerCertByName"):
                        names = tls_settings.pop("verifyPeerCertByName", None)
                        # If verifyPeerCertInNames is already set, keep its value and just remove the new field.
                        if not tls_settings.get("verifyPeerCertInNames") and names:
                            # verifyPeerCertInNames expects a list
                            if isinstance(names, str):
                                tls_settings["verifyPeerCertInNames"] = [names]
                            elif isinstance(names, list):
                                tls_settings["verifyPeerCertInNames"] = names

                # Update the stream with the modified settings
                stream["tlsSettings"] = tls_settings

            reality_settings = stream.get("realitySettings")
            if isinstance(reality_settings, dict) and "settings" in reality_settings:
                reality_settings = {**reality_settings}
                reality_settings.pop("settings", None)
                stream["realitySettings"] = reality_settings

        if DEBUG:
            with open("generated_config-debug.json", "w") as f:
                f.write(config.to_json(indent=4))

        return config
