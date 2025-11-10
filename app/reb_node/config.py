from __future__ import annotations

import base64
import binascii
import json
import re
import subprocess
from collections import defaultdict
from copy import deepcopy
from pathlib import PosixPath
from typing import Union

import commentjson
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from sqlalchemy import func

from app.db import GetDB
from app.db import models as db_models
from app.models.proxy import ProxyTypes
from app.models.user import UserStatus
from app.utils.crypto import get_cert_SANs
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


class XRayConfig(dict):
    def __init__(self,
                 config: Union[dict, str, PosixPath] = {},
                 api_host: str = "127.0.0.1",
                 api_port: int = 8080):
        if isinstance(config, str):
            try:
                # considering string as json
                config = commentjson.loads(config)
            except (json.JSONDecodeError, ValueError):
                # considering string as file path
                with open(config, 'r') as file:
                    config = commentjson.loads(file.read())

        if isinstance(config, PosixPath):
            with open(config, 'r') as file:
                config = commentjson.loads(file.read())

        if isinstance(config, dict):
            config = deepcopy(config)

        self.api_host = api_host
        self.api_port = api_port

        super().__init__(config)
        self._validate()

        self.inbounds = []
        self.inbounds_by_protocol = {}
        self.inbounds_by_tag = {}
        self._fallbacks_inbound = self.get_inbound(XRAY_FALLBACKS_INBOUND_TAG)
        self._resolve_inbounds()

        self._apply_api()

    def _apply_api(self):
        api_inbound = self.get_inbound("API_INBOUND")
        if api_inbound:
            api_inbound["listen"] = self.api_host
            api_inbound["listen"]["address"] = self.api_host
            api_inbound["port"] = self.api_port
            return

        self["api"] = {
            "services": [
                "HandlerService",
                "StatsService",
                "LoggerService"
            ],
            "tag": "API"
        }
        self["stats"] = {}
        forced_policies = {
            "levels": {
                "0": {
                    "statsUserUplink": True,
                    "statsUserDownlink": True
                }
            },
            "system": {
                "statsInboundDownlink": False,
                "statsInboundUplink": False,
                "statsOutboundDownlink": True,
                "statsOutboundUplink": True
            }
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
        inbound = {
            "listen": self.api_host,
            "port": self.api_port,
            "protocol": "dokodemo-door",
            "settings": {
                "address": self.api_host
            },
            "tag": "API_INBOUND"
        }
        try:
            self["inbounds"].insert(0, inbound)
        except KeyError:
            self["inbounds"] = []
            self["inbounds"].insert(0, inbound)

        rule = {
            "inboundTag": [
                "API_INBOUND"
            ],
            "outboundTag": "API",
            "type": "field"
        }
        try:
            self["routing"]["rules"].insert(0, rule)
        except KeyError:
            self["routing"] = {"rules": []}
            self["routing"]["rules"].insert(0, rule)

    def _validate(self):
        if not self.get("inbounds"):
            raise ValueError("config doesn't have inbounds")

        if not self.get("outbounds"):
            raise ValueError("config doesn't have outbounds")

        for inbound in self['inbounds']:
            if not inbound.get("tag"):
                raise ValueError("all inbounds must have a unique tag")
            if ',' in inbound.get("tag"):
                raise ValueError("character «,» is not allowed in inbound tag")
        for outbound in self['outbounds']:
            if not outbound.get("tag"):
                raise ValueError("all outbounds must have a unique tag")

    def _resolve_inbounds(self):
        for inbound in self['inbounds']:
            if not inbound['protocol'] in ProxyTypes._value2member_map_:
                continue

            if inbound['tag'] in XRAY_EXCLUDE_INBOUND_TAGS:
                continue

            if not inbound.get('settings'):
                inbound['settings'] = {}
            if not inbound['settings'].get('clients'):
                inbound['settings']['clients'] = []

            settings = {
                "tag": inbound["tag"],
                "protocol": inbound["protocol"],
                "port": None,
                "network": "tcp",
                "tls": 'none',
                "sni": [],
                "host": [],
                "path": "",
                "header_type": "",
                "is_fallback": False
            }

            # port settings
            try:
                settings['port'] = inbound['port']
            except KeyError:
                if self._fallbacks_inbound:
                    try:
                        settings['port'] = self._fallbacks_inbound['port']
                        settings['is_fallback'] = True
                    except KeyError:
                        raise ValueError("fallbacks inbound doesn't have port")

            # stream settings
            if stream := inbound.get('streamSettings'):
                net = stream.get('network', 'tcp')
                net_settings = stream.get(f"{net}Settings", {})
                security = stream.get("security")
                tls_settings = stream.get(f"{security}Settings", {}) if security else {}
                if not isinstance(tls_settings, dict):
                    tls_settings = {}

                if settings['is_fallback'] is True:
                    # probably this is a fallback
                    security = self._fallbacks_inbound.get(
                        'streamSettings', {}).get('security')
                    tls_settings = self._fallbacks_inbound.get(
                        'streamSettings', {}).get(f"{security}Settings", {})

                settings['network'] = net

                if security == 'tls':
                    # settings['fp']
                    # settings['alpn']
                    settings['tls'] = 'tls'
                    for certificate in tls_settings.get('certificates', []):

                        if certificate.get("certificateFile", None):
                            with open(certificate['certificateFile'], 'rb') as file:
                                cert = file.read()
                                settings['sni'].extend(get_cert_SANs(cert))

                        if certificate.get("certificate", None):
                            cert = certificate['certificate']
                            if isinstance(cert, list):
                                cert = '\n'.join(cert)
                            if isinstance(cert, str):
                                cert = cert.encode()
                            settings['sni'].extend(get_cert_SANs(cert))

                elif security == 'reality':
                    settings['fp'] = 'chrome'
                    settings['tls'] = 'reality'
                    server_names = tls_settings.get('serverNames') or []
                    if isinstance(server_names, str):
                        server_names = [server_names]
                    if not isinstance(server_names, list):
                        server_names = []
                    settings['sni'] = server_names

                    try:
                        settings['pbk'] = tls_settings['publicKey']
                    except KeyError:
                        pvk = tls_settings.get('privateKey')
                        if not pvk:
                            raise ValueError(
                                f"You need to provide privateKey in realitySettings of {inbound['tag']}")

                        try:
                            settings['pbk'] = derive_reality_public_key(pvk)
                        except ValueError as exc:
                            raise ValueError(
                                f"Invalid privateKey in realitySettings of {inbound['tag']}: {exc}") from exc

                    sids = tls_settings.get('shortIds') or []
                    if isinstance(sids, str):
                        sids = [sids]
                    if not isinstance(sids, list):
                        sids = []
                    sids = [sid for sid in sids if isinstance(sid, str) and sid.strip()]
                    # Allow Reality configs without short IDs (Xray treats them as optional)
                    settings['sids'] = sids
                    spider_x = tls_settings.get('SpiderX', tls_settings.get('spiderX', ''))
                    settings['spx'] = spider_x or ""

                if net in ('tcp', 'raw'):
                    header = net_settings.get('header', {})
                    request = header.get('request', {})
                    path = request.get('path')
                    host = request.get('headers', {}).get('Host')

                    settings['header_type'] = header.get('type', '')

                    if isinstance(path, str) or isinstance(host, str):
                        raise ValueError(f"Settings of {inbound['tag']} for path and host must be list, not str\n"
                                         "https://xtls.github.io/config/transports/tcp.html#httpheaderobject")

                    if path and isinstance(path, list):
                        settings['path'] = path[0]

                    if host and isinstance(host, list):
                        settings['host'] = host

                elif net == 'ws':
                    path = net_settings.get('path', '')
                    host = net_settings.get('host', '') or net_settings.get('headers', {}).get('Host')

                    settings['header_type'] = ''

                    if isinstance(path, list) or isinstance(host, list):
                        raise ValueError(f"Settings of {inbound['tag']} for path and host must be str, not list\n"
                                         "https://xtls.github.io/config/transports/websocket.html#websocketobject")

                    if isinstance(path, str):
                        settings['path'] = path

                    if isinstance(host, str):
                        settings['host'] = [host]

                    settings["heartbeatPeriod"] = net_settings.get('heartbeatPeriod', 0)
                elif net == 'grpc' or net == 'gun':
                    settings['header_type'] = ''
                    settings['path'] = net_settings.get('serviceName', '')
                    host = net_settings.get('authority', '')
                    settings['host'] = [host]
                    settings['multiMode'] = net_settings.get('multiMode', False)

                elif net == 'quic':
                    settings['header_type'] = net_settings.get('header', {}).get('type', '')
                    settings['path'] = net_settings.get('key', '')
                    settings['host'] = [net_settings.get('security', '')]

                elif net == 'httpupgrade':
                    settings['path'] = net_settings.get('path', '')
                    host = net_settings.get('host', '')
                    settings['host'] = [host]

                elif net in ('splithttp', 'xhttp'):
                    settings['path'] = net_settings.get('path', '')
                    host = net_settings.get('host', '')
                    settings['host'] = [host]
                    settings['scMaxEachPostBytes'] = net_settings.get('scMaxEachPostBytes', 1000000)
                    settings['scMaxConcurrentPosts'] = net_settings.get('scMaxConcurrentPosts', 100)
                    settings['scMinPostsIntervalMs'] = net_settings.get('scMinPostsIntervalMs', 30)
                    settings['xPaddingBytes'] = net_settings.get('xPaddingBytes', "100-1000")
                    settings['xmux'] = net_settings.get('xmux', {})
                    settings["mode"] = net_settings.get("mode", "auto")
                    settings["noGRPCHeader"] = net_settings.get("noGRPCHeader", False)
                    settings["keepAlivePeriod"] = net_settings.get("keepAlivePeriod", 0)

                elif net == 'kcp':
                    header = net_settings.get('header', {})

                    settings['header_type'] = header.get('type', '')
                    settings['host'] = header.get('domain', '')
                    settings['path'] = net_settings.get('seed', '')

                elif net in ("http", "h2", "h3"):
                    net_settings = stream.get("httpSettings", {})

                    settings['host'] = net_settings.get('host') or net_settings.get('Host', '')
                    settings['path'] = net_settings.get('path', '')

                else:
                    settings['path'] = net_settings.get('path', '')
                    host = net_settings.get(
                        'host', {}) or net_settings.get('Host', {})
                    if host and isinstance(host, str):
                        settings['host'] = host
                    elif host and isinstance(host, list):
                        settings['host'] = host[0]

            self.inbounds.append(settings)
            self.inbounds_by_tag[inbound['tag']] = settings

            try:
                self.inbounds_by_protocol[inbound['protocol']].append(settings)
            except KeyError:
                self.inbounds_by_protocol[inbound['protocol']] = [settings]

    def get_inbound(self, tag) -> dict:
        for inbound in self['inbounds']:
            if inbound['tag'] == tag:
                return inbound

    def get_outbound(self, tag) -> dict:
        for outbound in self['outbounds']:
            if outbound['tag'] == tag:
                return outbound

    def to_json(self, **json_kwargs):
        return json.dumps(self, **json_kwargs)

    def copy(self):
        return deepcopy(self)

    def include_db_users(self) -> XRayConfig:
        config = self.copy()

        with GetDB() as db:
            query = db.query(
                db_models.User.id,
                db_models.User.username,
                func.lower(db_models.Proxy.type).label('type'),
                db_models.Proxy.settings,
                func.group_concat(db_models.excluded_inbounds_association.c.inbound_tag).label('excluded_inbound_tags')
            ).join(
                db_models.Proxy, db_models.User.id == db_models.Proxy.user_id
            ).outerjoin(
                db_models.excluded_inbounds_association,
                db_models.Proxy.id == db_models.excluded_inbounds_association.c.proxy_id
            ).filter(
                db_models.User.status.in_([UserStatus.active, UserStatus.on_hold])
            ).group_by(
                func.lower(db_models.Proxy.type),
                db_models.User.id,
                db_models.User.username,
                db_models.Proxy.settings,
            )
            result = query.all()

            grouped_data = defaultdict(list)

            for row in result:
                grouped_data[row.type].append((
                    row.id,
                    row.username,
                    row.settings,
                    [i for i in row.excluded_inbound_tags.split(',') if i] if row.excluded_inbound_tags else None
                ))

            for proxy_type, rows in grouped_data.items():

                inbounds = self.inbounds_by_protocol.get(proxy_type)
                if not inbounds:
                    continue

                for inbound in inbounds:
                    clients = config.get_inbound(inbound['tag'])['settings']['clients']

                    for row in rows:
                        user_id, username, settings, excluded_inbound_tags = row

                        if excluded_inbound_tags and inbound['tag'] in excluded_inbound_tags:
                            continue

                        client = {
                            "email": f"{user_id}.{username}",
                            **settings
                        }

                        # XTLS currently only supports transmission methods of TCP and mKCP
                        if client.get('flow') and (
                                inbound.get('network', 'tcp') not in ('tcp', 'raw', 'kcp')
                                or
                                (
                                    inbound.get('network', 'tcp') in ('tcp', 'raw', 'kcp')
                                    and
                                    inbound.get('tls') not in ('tls', 'reality')
                                )
                                or
                                inbound.get('header_type') == 'http'
                        ):
                            del client['flow']

                        clients.append(client)

        if DEBUG:
            with open('generated_config-debug.json', 'w') as f:
                f.write(config.to_json(indent=4))

        return config
