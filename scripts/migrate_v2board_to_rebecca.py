#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Optional
from uuid import NAMESPACE_DNS, UUID, uuid5

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.getcwd())
# Prevent full app runtime bootstrap during migration script imports.
os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")
# Some deployments use non-boolean values for DEBUG (e.g. "release"),
# but Rebecca's config parser expects strict booleans.
if os.getenv("DEBUG", "").strip().lower() not in {"", "0", "1", "true", "false", "yes", "no", "on", "off"}:
    os.environ["DEBUG"] = "false"

from app.db import models as db_models
from app.models.admin import AdminStatus
from app.models.proxy import ProxyHostSecurity, ProxyTypes
from app.models.user import UserDataLimitResetStrategy, UserStatus
from config import SQLALCHEMY_DATABASE_URL

USERNAME_ALLOWED_CHARS = re.compile(r"[^a-zA-Z0-9_.@-]")
V2_MARKER_RE = re.compile(r"\[v2-id:(\d+)\]")
DEFAULT_MAX_USERNAME_LEN = 34
MAX_EXPIRE_INT = 2_147_483_647


@dataclass
class SourceServer:
    protocol: ProxyTypes
    source_type: str
    source_id: int
    name: str
    groups: set[int]
    host: str
    port: Optional[int]
    sort: int
    network: Optional[str] = None
    path: Optional[str] = None
    host_header: Optional[str] = None
    sni: Optional[str] = None
    allow_insecure: Optional[bool] = None
    security: ProxyHostSecurity = ProxyHostSecurity.inbound_default
    cipher: Optional[str] = None


@dataclass
class Stats:
    source_users: int = 0
    source_plans: int = 0
    source_servers: int = 0
    hysteria_skipped: int = 0
    inbounds_created: int = 0
    hosts_created: int = 0
    services_created: int = 0
    service_links_created: int = 0
    admin_links_created: int = 0
    users_created: int = 0
    users_updated: int = 0
    users_skipped: int = 0
    users_invalid: int = 0
    proxies_created: int = 0


def _log(msg: str) -> None:
    print(f"[v2board-migrate] {msg}")


def _warn(msg: str) -> None:
    print(f"[v2board-migrate][WARN] {msg}")


def _as_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if value is None:
        return default
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text_value = str(value).strip().lower()
    if text_value in {"1", "true", "yes", "on"}:
        return True
    if text_value in {"0", "false", "no", "off"}:
        return False
    return default


def _as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    text_value = str(value).strip()
    if not text_value:
        return None
    try:
        return json.loads(text_value)
    except json.JSONDecodeError:
        return None


def _array_like(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    if isinstance(value, (int, float)):
        return [int(value)]
    text_value = str(value).strip()
    if not text_value:
        return []
    parsed = _parse_json(text_value)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        keys = [key for key in parsed if str(key).isdigit()]
        if keys:
            return [parsed[key] for key in sorted(keys, key=lambda k: int(str(k)))]
        return [parsed]
    if "," in text_value:
        return [item.strip() for item in text_value.split(",") if item.strip()]
    return [text_value]


def _int_set(value: Any) -> set[int]:
    result: set[int] = set()
    for item in _array_like(value):
        parsed = _as_int(item, None)
        if parsed is not None:
            result.add(parsed)
    return result


def _table(connection: Connection, logical_name: str, prefix: str) -> Optional[str]:
    inspector = inspect(connection)
    candidates = [f"{prefix}{logical_name}" if prefix else logical_name]
    if logical_name not in candidates:
        candidates.append(logical_name)
    for candidate in candidates:
        if inspector.has_table(candidate):
            return candidate
    return None


def _rows(connection: Connection, table_name: str) -> list[dict[str, Any]]:
    quoted = connection.dialect.identifier_preparer.quote(table_name)
    result = connection.execute(text(f"SELECT * FROM {quoted}")).mappings().all()
    return [dict(item) for item in result]


def _network(settings: Any, raw_network: Any) -> Optional[str]:
    value = _as_text(raw_network)
    if value:
        return value.lower()
    if isinstance(settings, dict):
        value = _as_text(settings.get("network"))
        if value:
            return value.lower()
    return None


def _path(settings: Any) -> Optional[str]:
    if not isinstance(settings, dict):
        return None
    return _as_text(settings.get("path")) or _as_text(settings.get("serviceName"))


def _header_host(settings: Any) -> Optional[str]:
    if not isinstance(settings, dict):
        return None
    host_value = settings.get("host")
    if isinstance(host_value, list):
        values = [_as_text(item) for item in host_value]
        values = [item for item in values if item]
        return ",".join(values) if values else None
    if host_value is not None:
        return _as_text(host_value)
    headers = settings.get("headers")
    if isinstance(headers, dict):
        return _as_text(headers.get("Host")) or _as_text(headers.get("host"))
    return None


def _load_servers(connection: Connection, prefix: str, stats: Stats) -> list[SourceServer]:
    servers: list[SourceServer] = []

    vmess_table = _table(connection, "server_vmess", prefix)
    if vmess_table:
        for row in _rows(connection, vmess_table):
            host = _as_text(row.get("host"))
            if not host:
                continue
            network_settings = _parse_json(row.get("networkSettings")) or {}
            tls_settings = _parse_json(row.get("tlsSettings")) or {}
            server = SourceServer(
                protocol=ProxyTypes.VMess,
                source_type="vmess",
                source_id=_as_int(row.get("id"), 0) or 0,
                name=_as_text(row.get("name")) or f"VMess #{row.get('id')}",
                groups=_int_set(row.get("group_id")),
                host=host,
                port=_as_int(row.get("port"), None),
                sort=_as_int(row.get("sort"), 0) or 0,
                network=_network(network_settings, row.get("network")),
                path=_path(network_settings),
                host_header=_header_host(network_settings),
                sni=_as_text(tls_settings.get("serverName")) or host,
                allow_insecure=_as_bool(
                    row.get("allow_insecure"),
                    default=_as_bool(tls_settings.get("allowInsecure"), default=False),
                ),
                security=ProxyHostSecurity.tls if _as_bool(row.get("tls"), default=False) else ProxyHostSecurity.none,
            )
            servers.append(server)

    trojan_table = _table(connection, "server_trojan", prefix)
    if trojan_table:
        for row in _rows(connection, trojan_table):
            host = _as_text(row.get("host"))
            if not host:
                continue
            server = SourceServer(
                protocol=ProxyTypes.Trojan,
                source_type="trojan",
                source_id=_as_int(row.get("id"), 0) or 0,
                name=_as_text(row.get("name")) or f"Trojan #{row.get('id')}",
                groups=_int_set(row.get("group_id")),
                host=host,
                port=_as_int(row.get("port"), None),
                sort=_as_int(row.get("sort"), 0) or 0,
                sni=_as_text(row.get("server_name")) or host,
                allow_insecure=_as_bool(row.get("allow_insecure"), default=False),
                security=ProxyHostSecurity.tls,
            )
            servers.append(server)

    shadowsocks_table = _table(connection, "server_shadowsocks", prefix)
    if shadowsocks_table:
        for row in _rows(connection, shadowsocks_table):
            host = _as_text(row.get("host"))
            if not host:
                continue
            server = SourceServer(
                protocol=ProxyTypes.Shadowsocks,
                source_type="shadowsocks",
                source_id=_as_int(row.get("id"), 0) or 0,
                name=_as_text(row.get("name")) or f"Shadowsocks #{row.get('id')}",
                groups=_int_set(row.get("group_id")),
                host=host,
                port=_as_int(row.get("port"), None),
                sort=_as_int(row.get("sort"), 0) or 0,
                security=ProxyHostSecurity.none,
                cipher=_as_text(row.get("cipher")),
            )
            servers.append(server)

    hysteria_table = _table(connection, "server_hysteria", prefix)
    if hysteria_table:
        count = len(_rows(connection, hysteria_table))
        if count:
            stats.hysteria_skipped = count
            _warn("Hysteria servers detected and skipped.")

    stats.source_servers = len(servers)
    return servers


def _inbound_candidates(target_db: Session) -> dict[ProxyTypes, list[tuple[str, Optional[str]]]]:
    candidates: dict[ProxyTypes, list[tuple[str, Optional[str]]]] = defaultdict(list)
    latest = (
        target_db.query(db_models.XrayConfig)
        .order_by(db_models.XrayConfig.updated_at.desc(), db_models.XrayConfig.id.desc())
        .first()
    )
    if latest and isinstance(latest.data, dict):
        for inbound in latest.data.get("inbounds", []):
            if not isinstance(inbound, dict):
                continue
            protocol = _as_text(inbound.get("protocol"))
            tag = _as_text(inbound.get("tag"))
            if not protocol or not tag:
                continue
            try:
                proxy_type = ProxyTypes(protocol.lower())
            except ValueError:
                continue
            stream = inbound.get("streamSettings") or {}
            network = _as_text(stream.get("network")) if isinstance(stream, dict) else None
            candidates[proxy_type].append((tag, network.lower() if network else None))

    if candidates:
        return dict(candidates)

    # Fallback to existing inbound tags by name inference.
    for inbound in target_db.query(db_models.ProxyInbound).all():
        tag = inbound.tag
        lowered = tag.lower()
        if "vmess" in lowered:
            candidates[ProxyTypes.VMess].append((tag, None))
        elif "vless" in lowered:
            candidates[ProxyTypes.VLESS].append((tag, None))
        elif "trojan" in lowered:
            candidates[ProxyTypes.Trojan].append((tag, None))
        elif "shadow" in lowered or lowered.startswith("ss"):
            candidates[ProxyTypes.Shadowsocks].append((tag, None))
    return dict(candidates)


def _choose_inbound(
    candidates: dict[ProxyTypes, list[tuple[str, Optional[str]]]],
    protocol: ProxyTypes,
    network: Optional[str],
) -> Optional[str]:
    options = candidates.get(protocol, [])
    if not options:
        return None
    network = (network or "").lower().strip()
    if network:
        for tag, candidate_network in options:
            if (candidate_network or "") == network:
                return tag
        for tag, _candidate_network in options:
            if network in tag.lower():
                return tag
    return options[0][0]


def _service_name(base_name: str, prefix: str, used_names: set[str]) -> str:
    compact = re.sub(r"\s+", " ", f"{prefix}{base_name}").strip() or "Unnamed"
    if compact.lower() not in used_names:
        used_names.add(compact.lower())
        return compact
    idx = 2
    while True:
        candidate = f"{compact} #{idx}"
        if candidate.lower() not in used_names:
            used_names.add(candidate.lower())
            return candidate
        idx += 1


def _host_sig(
    inbound_tag: str,
    address: str,
    port: Optional[int],
    path: Optional[str],
    sni: Optional[str],
    host: Optional[str],
    security: ProxyHostSecurity,
    allow_insecure: Optional[bool],
) -> tuple[Any, ...]:
    return (
        inbound_tag.lower(),
        address.lower(),
        int(port or 0),
        (path or "").strip(),
        (sni or "").lower(),
        (host or "").lower(),
        str(security.value if hasattr(security, "value") else security),
        None if allow_insecure is None else bool(allow_insecure),
    )


def _resolve_admin(target_db: Session, admin_id: Optional[int]) -> db_models.Admin:
    query = target_db.query(db_models.Admin).filter(db_models.Admin.status != AdminStatus.deleted)
    if admin_id is not None:
        admin = query.filter(db_models.Admin.id == admin_id).first()
        if not admin:
            raise ValueError(f"Admin id={admin_id} not found.")
        return admin
    admin = query.order_by(db_models.Admin.id.asc()).first()
    if not admin:
        raise ValueError("No active admin found in target database.")
    return admin


def _migrate_services(
    target_db: Session,
    plans: list[dict[str, Any]],
    servers: list[SourceServer],
    admin: db_models.Admin,
    service_prefix: str,
    stats: Stats,
) -> tuple[dict[int, int], dict[int, set[ProxyTypes]]]:
    plan_to_service_id: dict[int, int] = {}
    service_protocols: dict[int, set[ProxyTypes]] = defaultdict(set)
    if not plans:
        return plan_to_service_id, service_protocols

    candidates = _inbound_candidates(target_db)
    inbounds = {row.tag: row for row in target_db.query(db_models.ProxyInbound).all()}

    hosts_by_sig: dict[tuple[Any, ...], db_models.ProxyHost] = {}
    for host in target_db.query(db_models.ProxyHost).all():
        hosts_by_sig[_host_sig(
            host.inbound_tag, host.address, host.port, host.path, host.sni, host.host, host.security, host.allowinsecure
        )] = host

    hosts_by_group: dict[int, list[tuple[int, ProxyTypes, int]]] = defaultdict(list)
    ungrouped: list[tuple[int, ProxyTypes, int]] = []
    all_hosts: list[tuple[int, ProxyTypes, int]] = []

    for server in sorted(servers, key=lambda item: (item.source_type, item.sort, item.source_id)):
        tag = _choose_inbound(candidates, server.protocol, server.network) or f"v2-import-{server.protocol.value}"
        inbound = inbounds.get(tag)
        if not inbound:
            inbound = db_models.ProxyInbound(tag=tag)
            target_db.add(inbound)
            target_db.flush()
            inbounds[tag] = inbound
            stats.inbounds_created += 1

        signature = _host_sig(
            inbound.tag,
            server.host,
            server.port,
            server.path,
            server.sni,
            server.host_header,
            server.security,
            server.allow_insecure,
        )
        host = hosts_by_sig.get(signature)
        if not host:
            host = db_models.ProxyHost(
                remark=f"v2:{server.name}",
                address=server.host,
                port=server.port,
                sort=max(server.sort, 0),
                path=server.path,
                sni=server.sni,
                host=server.host_header,
                security=server.security,
                allowinsecure=server.allow_insecure,
                inbound_tag=inbound.tag,
            )
            target_db.add(host)
            target_db.flush()
            hosts_by_sig[signature] = host
            stats.hosts_created += 1

        row = (host.id, server.protocol, max(server.sort, 0))
        all_hosts.append(row)
        if server.groups:
            for group_id in server.groups:
                hosts_by_group[group_id].append(row)
        else:
            ungrouped.append(row)

    services = {service.name.lower(): service for service in target_db.query(db_models.Service).all()}
    used_names = set(services.keys())
    service_links = {(row.service_id, row.host_id) for row in target_db.query(db_models.ServiceHostLink).all()}
    admin_links = {(row.admin_id, row.service_id) for row in target_db.query(db_models.AdminServiceLink).all()}

    for plan in sorted(plans, key=lambda item: _as_int(item.get("id"), 0) or 0):
        plan_id = _as_int(plan.get("id"), None)
        if plan_id is None:
            continue
        plan_name = _as_text(plan.get("name")) or f"Plan {plan_id}"
        preferred = re.sub(r"\s+", " ", f"{service_prefix}{plan_name}").strip() or "Unnamed"
        service = services.get(preferred.lower())
        if service:
            name = service.name
        else:
            name = _service_name(plan_name, service_prefix, used_names)
            service = services.get(name.lower())
        if not service:
            description = _as_text(plan.get("content")) or ""
            service = db_models.Service(name=name, description=f"Migrated from v2board #{plan_id}. {description}".strip())
            target_db.add(service)
            target_db.flush()
            services[name.lower()] = service
            stats.services_created += 1

        groups = _int_set(plan.get("group_id"))
        if not groups:
            group_single = _as_int(plan.get("group_id"), None)
            if group_single is not None:
                groups = {group_single}

        selected: list[tuple[int, ProxyTypes, int]] = []
        if groups:
            for group_id in sorted(groups):
                selected.extend(hosts_by_group.get(group_id, []))
            selected.extend(ungrouped)
        else:
            selected.extend(all_hosts)

        dedup: dict[int, tuple[int, ProxyTypes, int]] = {}
        for host_id, protocol, sort in selected:
            if host_id not in dedup:
                dedup[host_id] = (host_id, protocol, sort)
        for idx, (host_id, protocol, sort) in enumerate(sorted(dedup.values(), key=lambda item: (item[2], item[0]))):
            if (service.id, host_id) not in service_links:
                target_db.add(db_models.ServiceHostLink(service_id=service.id, host_id=host_id, sort=idx))
                service_links.add((service.id, host_id))
                stats.service_links_created += 1
            service_protocols[service.id].add(protocol)

        if (admin.id, service.id) not in admin_links:
            target_db.add(db_models.AdminServiceLink(admin_id=admin.id, service_id=service.id))
            admin_links.add((admin.id, service.id))
            stats.admin_links_created += 1

        plan_to_service_id[plan_id] = service.id

    return plan_to_service_id, service_protocols


def _migrate_services_from_groups(
    target_db: Session,
    users: list[dict[str, Any]],
    group_names: dict[int, str],
    admin: db_models.Admin,
    service_prefix: str,
    stats: Stats,
) -> tuple[dict[int, int], dict[int, set[ProxyTypes]]]:
    group_to_service_id: dict[int, int] = {}
    service_protocols: dict[int, set[ProxyTypes]] = defaultdict(set)

    group_ids = sorted({_as_int(row.get("group_id"), None) for row in users if _as_int(row.get("group_id"), None) is not None})
    if not group_ids:
        return group_to_service_id, service_protocols

    existing_services = target_db.query(db_models.Service).all()
    services_by_name = {service.name.lower(): service for service in existing_services}
    used_names = set(services_by_name.keys())

    admin_links = {(row.admin_id, row.service_id) for row in target_db.query(db_models.AdminServiceLink).all()}

    for group_id in group_ids:
        marker = f"[v2-group-id:{group_id}]"
        matched = None
        for service in existing_services:
            if marker in (service.description or ""):
                matched = service
                break

        if matched:
            service = matched
        else:
            base_name = _as_text(group_names.get(group_id)) or f"group-{group_id}"
            preferred = re.sub(r"\s+", " ", f"{service_prefix}{base_name}").strip() or "Unnamed"
            service = services_by_name.get(preferred.lower())
            service_name = preferred
            if not service:
                service_name = _service_name(base_name, service_prefix, used_names)
                service = services_by_name.get(service_name.lower())
            if not service:
                description = f"Migrated from v2board group #{group_id}. {marker}"
                service = db_models.Service(name=service_name, description=description)
                target_db.add(service)
                target_db.flush()
                existing_services.append(service)
                services_by_name[service.name.lower()] = service
                stats.services_created += 1

        group_to_service_id[group_id] = service.id
        if (admin.id, service.id) not in admin_links:
            target_db.add(db_models.AdminServiceLink(admin_id=admin.id, service_id=service.id))
            admin_links.add((admin.id, service.id))
            stats.admin_links_created += 1

    return group_to_service_id, service_protocols


def _normalize_username(raw: str, seed: str) -> str:
    value = (raw or "").strip().lower()
    value = USERNAME_ALLOWED_CHARS.sub("_", value)
    value = re.sub(r"_+", "_", value).strip("_.-@")
    if len(value) < 3:
        value = f"user_{seed}"
    return value[:DEFAULT_MAX_USERNAME_LEN]


def _unique_username(base: str, used: set[str]) -> str:
    candidate = base[:DEFAULT_MAX_USERNAME_LEN]
    if candidate.lower() not in used:
        used.add(candidate.lower())
        return candidate
    idx = 1
    while True:
        suffix = f"_{idx}"
        cut = max(3, DEFAULT_MAX_USERNAME_LEN - len(suffix))
        next_value = f"{candidate[:cut]}{suffix}"
        if next_value.lower() not in used:
            used.add(next_value.lower())
            return next_value
        idx += 1


def _normalize_uuid(raw: Any, seed: str) -> str:
    text_value = _as_text(raw)
    if text_value:
        try:
            return str(UUID(text_value))
        except ValueError:
            pass
    return str(uuid5(NAMESPACE_DNS, seed))


def _normalize_credential_key(raw: Any) -> Optional[str]:
    token = _as_text(raw)
    if not token:
        return None
    normalized = token.replace("-", "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{32}", normalized):
        return normalized
    return None


def _ss_method(default_method: str, servers: list[SourceServer]) -> str:
    supported = {
        "aes-128-gcm",
        "aes-256-gcm",
        "chacha20-ietf-poly1305",
        "xchacha20-ietf-poly1305",
        "2022-blake3-aes-128-gcm",
        "2022-blake3-aes-256-gcm",
        "2022-blake3-chacha20-poly1305",
    }
    ciphers = [server.cipher for server in servers if server.protocol == ProxyTypes.Shadowsocks and server.cipher]
    if not ciphers:
        return default_method
    candidate = Counter(ciphers).most_common(1)[0][0].lower().strip()
    return candidate if candidate in supported else default_method


def _status(source_row: dict[str, Any], now_ts: int) -> UserStatus:
    if _as_bool(source_row.get("banned"), default=False):
        return UserStatus.disabled
    expired_at = _as_int(source_row.get("expired_at"), 0) or 0
    if expired_at > 0 and expired_at < now_ts:
        return UserStatus.expired
    used = (_as_int(source_row.get("u"), 0) or 0) + (_as_int(source_row.get("d"), 0) or 0)
    limit_value = _as_int(source_row.get("transfer_enable"), 0) or 0
    if limit_value > 0 and used >= limit_value:
        return UserStatus.limited
    return UserStatus.active


def _proxy_rows(
    protocols: set[ProxyTypes],
    uuid_value: str,
    password_value: str,
    ss_method: str,
) -> list[db_models.Proxy]:
    rows: list[db_models.Proxy] = []
    for protocol in sorted(protocols, key=lambda item: item.value):
        if protocol == ProxyTypes.VMess:
            settings = {"id": uuid_value}
        elif protocol == ProxyTypes.VLESS:
            settings = {"id": uuid_value}
        elif protocol == ProxyTypes.Trojan:
            settings = {"password": password_value}
        elif protocol == ProxyTypes.Shadowsocks:
            settings = {"password": password_value, "method": ss_method, "ivCheck": False}
        else:
            continue
        rows.append(db_models.Proxy(type=protocol, settings=settings))
    return rows


def _migrate_users(
    target_db: Session,
    users: list[dict[str, Any]],
    servers: list[SourceServer],
    admin: db_models.Admin,
    source_to_service_id: dict[int, int],
    service_protocols: dict[int, set[ProxyTypes]],
    user_service_source: str,
    include_vless: bool,
    update_existing: bool,
    default_ss_method: str,
    stats: Stats,
    *,
    touch_service_assignment: bool,
    allow_commit: bool,
    commit_every: int = 200,
    max_create_users: Optional[int] = None,
) -> None:
    now_ts = int(datetime.now(UTC).timestamp())
    global_protocols = {server.protocol for server in servers} or {ProxyTypes.VMess}
    if include_vless and ProxyTypes.VMess in global_protocols:
        global_protocols.add(ProxyTypes.VLESS)

    existing = target_db.query(db_models.User).all()
    users_by_username = {row.username.lower(): row for row in existing if row.username}
    users_by_marker: dict[int, db_models.User] = {}
    for row in existing:
        if not row.note:
            continue
        match = V2_MARKER_RE.search(row.note)
        if not match:
            continue
        marker_id = _as_int(match.group(1), None)
        if marker_id is not None and marker_id not in users_by_marker:
            users_by_marker[marker_id] = row
    used_usernames = set(users_by_username.keys())
    ss_selected = _ss_method(default_ss_method, servers)
    changed_since_commit = 0
    created_in_run = 0

    for source in sorted(users, key=lambda item: _as_int(item.get("id"), 0) or 0):
        source_id = _as_int(source.get("id"), None)
        source_email = _as_text(source.get("email"))
        if source_id is None or not source_email:
            stats.users_invalid += 1
            continue

        base_username = _normalize_username(source_email, str(source_id))
        existing_user = users_by_marker.get(source_id)
        username = existing_user.username if existing_user and existing_user.username else base_username

        if not existing_user:
            existing_by_base = users_by_username.get(base_username.lower())
            if existing_by_base:
                marker_match = V2_MARKER_RE.search(existing_by_base.note or "")
                marker_id = _as_int(marker_match.group(1), None) if marker_match else None
                if marker_id is None:
                    username = _unique_username(base_username, used_usernames)
                    existing_user = None
                else:
                    existing_user = existing_by_base
                    username = existing_by_base.username
            else:
                username = _unique_username(base_username, used_usernames)

        if existing_user and not update_existing:
            stats.users_skipped += 1
            continue

        source_service_key = _as_int(source.get("plan_id"), None)
        if user_service_source == "group":
            source_service_key = _as_int(source.get("group_id"), None)
        service_id = (
            source_to_service_id.get(source_service_key)
            if (touch_service_assignment and source_service_key is not None)
            else None
        )
        protocols = set(global_protocols)
        if service_id is not None and service_id in service_protocols and service_protocols[service_id]:
            protocols = set(service_protocols[service_id])
        if include_vless and ProxyTypes.VMess in protocols:
            protocols.add(ProxyTypes.VLESS)

        credential_key = _normalize_credential_key(source.get("token"))
        uuid_value = _normalize_uuid(source.get("uuid"), f"v2-user-{source_id}-{source_email}")
        password_value = _as_text(source.get("uuid")) or _as_text(source.get("token")) or source_email
        proxies = _proxy_rows(protocols, uuid_value, password_value, ss_selected)
        if not proxies:
            stats.users_invalid += 1
            continue

        used_traffic = (_as_int(source.get("u"), 0) or 0) + (_as_int(source.get("d"), 0) or 0)
        transfer_enable = _as_int(source.get("transfer_enable"), 0) or 0
        data_limit = transfer_enable if transfer_enable > 0 else None
        expire = _as_int(source.get("expired_at"), 0) or None
        if expire is not None and expire <= 0:
            expire = None
        if expire is not None and expire > MAX_EXPIRE_INT:
            expire = MAX_EXPIRE_INT

        remarks = _as_text(source.get("remarks"))
        marker = f"[v2-id:{source_id}]"
        note_chunks = [chunk for chunk in [remarks] if chunk]
        if username.lower() != source_email.lower():
            note_chunks.append(f"[migrated-email] {source_email}")
        note_chunks.append(marker)
        note = " | ".join(note_chunks) if note_chunks else None
        if note and len(note) > 500:
            reserved = len(marker) + 3
            head = max(0, 500 - reserved)
            trimmed = note[:head].rstrip(" |")
            note = f"{trimmed} | {marker}" if trimmed else marker
        created_at = datetime.fromtimestamp(
            _as_int(source.get("created_at"), int(datetime.now(UTC).timestamp())) or int(datetime.now(UTC).timestamp()),
            tz=UTC,
        ).replace(tzinfo=None)
        updated_at = datetime.fromtimestamp(
            _as_int(source.get("updated_at"), int(created_at.timestamp())) or int(created_at.timestamp()),
            tz=UTC,
        ).replace(tzinfo=None)

        if existing_user and update_existing:
            existing_user.status = _status(source, now_ts=now_ts)
            existing_user.used_traffic = used_traffic
            existing_user.data_limit = data_limit
            existing_user.expire = expire
            existing_user.admin_id = admin.id
            if touch_service_assignment:
                existing_user.service_id = service_id
            existing_user.credential_key = credential_key
            existing_user.note = note
            existing_user.telegram_id = _as_text(source.get("telegram_id"))
            existing_user.data_limit_reset_strategy = UserDataLimitResetStrategy.no_reset
            existing_user.created_at = created_at
            existing_user.sub_updated_at = updated_at
            existing_user.last_status_change = updated_at
            existing_user.proxies.clear()
            for proxy in proxies:
                existing_user.proxies.append(proxy)
            stats.users_updated += 1
            stats.proxies_created += len(proxies)
            changed_since_commit += 1
            if allow_commit and changed_since_commit >= commit_every:
                target_db.commit()
                changed_since_commit = 0
            continue

        user = db_models.User(
            username=username,
            status=_status(source, now_ts=now_ts),
            used_traffic=used_traffic,
            data_limit=data_limit,
            data_limit_reset_strategy=UserDataLimitResetStrategy.no_reset,
            expire=expire,
            admin_id=admin.id,
            service_id=service_id,
            credential_key=credential_key,
            note=note,
            telegram_id=_as_text(source.get("telegram_id")),
            created_at=created_at,
            sub_updated_at=updated_at,
            last_status_change=updated_at,
            ip_limit=0,
        )
        for proxy in proxies:
            user.proxies.append(proxy)
        target_db.add(user)
        users_by_username[username.lower()] = user
        users_by_marker[source_id] = user
        stats.users_created += 1
        stats.proxies_created += len(proxies)
        created_in_run += 1
        changed_since_commit += 1

        if allow_commit and changed_since_commit >= commit_every:
            target_db.commit()
            changed_since_commit = 0

        if allow_commit and max_create_users is not None and created_in_run >= max_create_users:
            break

    if allow_commit and changed_since_commit > 0:
        target_db.commit()


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate v2board data into Rebecca DB.")
    parser.add_argument("--source-url", required=True, help="SQLAlchemy source URL (v2board).")
    parser.add_argument(
        "--target-url",
        default=SQLALCHEMY_DATABASE_URL,
        help="SQLAlchemy target URL (Rebecca). Defaults to SQLALCHEMY_DATABASE_URL.",
    )
    parser.add_argument("--source-prefix", default="v2_", help="Table prefix in source DB.")
    parser.add_argument("--admin-id", type=int, default=None, help="Target admin ID.")
    parser.add_argument("--service-name-prefix", default="v2-", help="Prefix for migrated services.")
    parser.add_argument(
        "--service-source",
        choices=["plan", "group"],
        default="group",
        help="Build user services from v2 plan IDs or v2 user group IDs.",
    )
    parser.add_argument("--include-vless", action="store_true", help="Also create VLESS proxies when VMess exists.")
    parser.add_argument("--default-ss-method", default="chacha20-ietf-poly1305", help="Fallback SS method.")
    parser.add_argument("--skip-services", action="store_true", help="Skip plan/server migration.")
    parser.add_argument("--skip-users", action="store_true", help="Skip users migration.")
    parser.add_argument("--update-existing-users", action="store_true", help="Update existing users instead of skipping.")
    parser.add_argument(
        "--max-create-users",
        type=int,
        default=None,
        help="Limit number of newly created users in this run (resume-safe).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not commit changes.")
    return parser.parse_args()


def main() -> int:
    args = _args()
    stats = Stats()
    source_engine = create_engine(args.source_url)
    target_engine = create_engine(args.target_url)
    SessionLocal = sessionmaker(bind=target_engine, autocommit=False, autoflush=False)

    try:
        with source_engine.connect() as source:
            user_table = _table(source, "user", args.source_prefix)
            if not user_table:
                raise ValueError("Could not find source user table.")
            users = _rows(source, user_table)
            plan_table = _table(source, "plan", args.source_prefix)
            plans = _rows(source, plan_table) if plan_table else []
            group_table = _table(source, "server_group", args.source_prefix)
            groups = _rows(source, group_table) if group_table else []
            servers = _load_servers(source, args.source_prefix, stats)
        stats.source_users = len(users)
        stats.source_plans = len(plans)
    except Exception as exc:
        _warn(f"Failed to read source database: {exc}")
        return 1

    target_db: Optional[Session] = None
    try:
        target_db = SessionLocal()
        admin = _resolve_admin(target_db, args.admin_id)
        _log(f"Using admin id={admin.id} username={admin.username}")

        source_to_service_id: dict[int, int] = {}
        service_protocols: dict[int, set[ProxyTypes]] = {}
        if not args.skip_services:
            if args.service_source == "group":
                group_names = {
                    gid: name
                    for gid, name in (
                        (_as_int(item.get("id"), None), _as_text(item.get("name")))
                        for item in groups
                    )
                    if gid is not None
                }
                source_to_service_id, service_protocols = _migrate_services_from_groups(
                    target_db=target_db,
                    users=users,
                    group_names=group_names,
                    admin=admin,
                    service_prefix=args.service_name_prefix,
                    stats=stats,
                )
                _log(f"Groups mapped to services: {len(source_to_service_id)}")
            else:
                source_to_service_id, service_protocols = _migrate_services(
                    target_db, plans, servers, admin, args.service_name_prefix, stats
                )
                _log(f"Plans mapped to services: {len(source_to_service_id)}")

        if not args.skip_users:
            _migrate_users(
                target_db=target_db,
                users=users,
                servers=servers,
                admin=admin,
                source_to_service_id=source_to_service_id,
                service_protocols=service_protocols,
                user_service_source=args.service_source,
                include_vless=args.include_vless,
                update_existing=args.update_existing_users,
                default_ss_method=args.default_ss_method,
                stats=stats,
                touch_service_assignment=not args.skip_services,
                allow_commit=not args.dry_run,
                max_create_users=args.max_create_users,
            )

        if args.dry_run:
            target_db.rollback()
        else:
            target_db.commit()

        _log("Migration summary:")
        _log(f"  source users/plans/servers: {stats.source_users}/{stats.source_plans}/{stats.source_servers}")
        _log(f"  hysteria skipped: {stats.hysteria_skipped}")
        _log(f"  inbounds/hosts/services created: {stats.inbounds_created}/{stats.hosts_created}/{stats.services_created}")
        _log(f"  service links/admin links created: {stats.service_links_created}/{stats.admin_links_created}")
        _log(
            "  users created/updated/skipped/invalid: "
            f"{stats.users_created}/{stats.users_updated}/{stats.users_skipped}/{stats.users_invalid}"
        )
        _log(f"  proxies created: {stats.proxies_created}")
        _log("  result: DRY-RUN" if args.dry_run else "  result: COMMITTED")
        return 0
    except SQLAlchemyError as exc:
        if target_db:
            target_db.rollback()
        _warn(f"Database error: {exc}")
        return 1
    except Exception as exc:
        if target_db:
            target_db.rollback()
        _warn(f"Migration failed: {exc}")
        return 1
    finally:
        if target_db:
            target_db.close()
        source_engine.dispose()
        target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
