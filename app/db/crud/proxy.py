"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from app.db.models import (
    ProxyHost,
    ProxyInbound,
    ProxyTypes,
    Service,
    ServiceHostLink,
    User,
    excluded_inbounds_association,
    template_inbounds_association,
)
from app.utils.credentials import (
    normalize_key,
    serialize_proxy_settings,
    uuid_to_key,
    UUID_PROTOCOLS,
)
from app.models.proxy import ProxyHost as ProxyHostModify, ProxySettings

# MasterSettingsService not available in current project structure
MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


def _extract_key_from_proxies(proxies: Dict[ProxyTypes, ProxySettings]) -> Optional[str]:
    candidate: Optional[str] = None
    for proxy_type in (ProxyTypes.VMess, ProxyTypes.VLESS):
        settings = proxies.get(proxy_type) or proxies.get(proxy_type.value)
        if settings and getattr(settings, "id", None):
            derived = uuid_to_key(settings.id, proxy_type)
            if candidate and candidate != derived:
                raise ValueError("VMess and VLESS UUIDs must match when deriving credential keys")
            candidate = derived
    return candidate


def _apply_key_to_existing_proxies(dbuser: User, credential_key: str) -> None:
    normalized = normalize_key(credential_key)
    for proxy in dbuser.proxies:
        proxy_type = proxy.type
        if isinstance(proxy_type, str):
            proxy_type = ProxyTypes(proxy_type)
        settings_obj = ProxySettings.from_dict(proxy_type, proxy.settings)
        # Preserve existing UUID if it exists in the database
        existing_uuid = proxy.settings.get("id") if isinstance(proxy.settings, dict) else None
        preserve_uuid = bool(existing_uuid and proxy_type in UUID_PROTOCOLS)
        proxy.settings = serialize_proxy_settings(
            settings_obj, proxy_type, normalized, preserve_existing_uuid=preserve_uuid
        )


def _apply_proxy_host_payload(
    db_host: ProxyHost,
    host_data: ProxyHostModify,
    *,
    sort_value: Optional[int] = None,
) -> ProxyHost:
    """
    Copy shared host fields from the pydantic payload to the SQLAlchemy model.
    """
    db_host.remark = host_data.remark
    db_host.address = host_data.address
    db_host.port = host_data.port
    if sort_value is not None:
        db_host.sort = sort_value
    elif host_data.sort is not None:
        db_host.sort = host_data.sort
    db_host.path = host_data.path
    db_host.sni = host_data.sni
    db_host.host = host_data.host
    db_host.security = host_data.security
    db_host.alpn = host_data.alpn
    db_host.fingerprint = host_data.fingerprint
    db_host.allowinsecure = host_data.allowinsecure
    db_host.is_disabled = host_data.is_disabled
    db_host.mux_enable = host_data.mux_enable
    db_host.fragment_setting = host_data.fragment_setting
    db_host.noise_setting = host_data.noise_setting
    db_host.random_user_agent = host_data.random_user_agent
    db_host.use_sni_as_host = host_data.use_sni_as_host
    return db_host


class ProxyInboundRepository:
    """Repository-like helper that encapsulates all host/inbound operations."""

    def __init__(self, db: Session):
        self.db = db

    def add_default_host(self, inbound: ProxyInbound) -> None:
        host = ProxyHost(
            remark="🚀 Marz ({USERNAME}) [{PROTOCOL} - {TRANSPORT}]",
            address="{SERVER_IP}",
            inbound=inbound,
            sort=0,
        )
        self.db.add(host)
        self.db.commit()

    def add_host(self, inbound_tag: str, host_payload: ProxyHostModify) -> List[ProxyHost]:
        inbound = self.get_or_create(inbound_tag)
        existing_sorts = [existing_host.sort for existing_host in inbound.hosts]
        next_sort = max(existing_sorts) + 1 if existing_sorts else 0
        sort_value = host_payload.sort if host_payload.sort is not None else next_sort

        new_host = ProxyHost(inbound=inbound)
        _apply_proxy_host_payload(new_host, host_payload, sort_value=sort_value)
        new_host.inbound_tag = inbound.tag
        inbound.hosts.append(new_host)
        self.db.commit()
        self.db.refresh(inbound)
        return inbound.hosts

    def get_or_create(self, inbound_tag: str) -> ProxyInbound:
        inbound = self.db.query(ProxyInbound).filter(ProxyInbound.tag == inbound_tag).first()
        if inbound:
            return inbound
        inbound = ProxyInbound(tag=inbound_tag)
        self.db.add(inbound)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            inbound = self.db.query(ProxyInbound).filter(ProxyInbound.tag == inbound_tag).first()
            if inbound:
                return inbound
            raise
        self.add_default_host(inbound)
        self.db.refresh(inbound)
        return inbound

    def delete(self, inbound_tag: str) -> bool:
        inbound = self.db.query(ProxyInbound).filter(ProxyInbound.tag == inbound_tag).first()
        if inbound is None:
            return False

        if inbound.hosts:
            raise ValueError("Inbound has hosts assigned. Remove hosts before deleting.")

        self.db.execute(
            delete(excluded_inbounds_association).where(excluded_inbounds_association.c.inbound_tag == inbound_tag)
        )
        self.db.execute(
            delete(template_inbounds_association).where(template_inbounds_association.c.inbound_tag == inbound_tag)
        )

        self.db.delete(inbound)
        self.db.flush()
        return True

    def list_hosts(self, inbound_tag: str) -> List[ProxyHost]:
        inbound = self.get_or_create(inbound_tag)
        return (
            self.db.query(ProxyHost)
            .options(joinedload(ProxyHost.service_links))
            .filter(ProxyHost.inbound_tag == inbound.tag)
            .order_by(ProxyHost.sort.asc(), ProxyHost.id.asc())
            .all()
        )

    def bulk_replace_hosts(
        self,
        inbound_tag: str,
        modified_hosts: List[ProxyHostModify],
        kept_ids: Optional[Set[int]] = None,
    ) -> Tuple[List[ProxyHost], List[Service]]:
        if kept_ids is None:
            kept_ids = set()

        inbound = self.get_or_create(inbound_tag)
        existing_by_id: Dict[int, ProxyHost] = {host.id: host for host in inbound.hosts if host.id is not None}

        affected_services: Dict[int, Service] = {}
        new_hosts: List[ProxyHost] = []

        for index, host_payload in enumerate(modified_hosts):
            sort_value = host_payload.sort if host_payload.sort is not None else index
            db_host: Optional[ProxyHost] = None

            if host_payload.id is not None:
                db_host = existing_by_id.pop(host_payload.id, None)
                if db_host is None:
                    db_host = self.db.query(ProxyHost).filter(ProxyHost.id == host_payload.id).first()

            if db_host is None:
                db_host = ProxyHost(inbound=inbound)

            db_host.inbound = inbound
            db_host.inbound_tag = inbound.tag
            _apply_proxy_host_payload(db_host, host_payload, sort_value=sort_value)

            new_hosts.append(db_host)

        # Remove hosts that no longer exist
        removed_hosts = list(existing_by_id.values())

        hosts_to_delete = []
        for h in removed_hosts:
            if h.id not in kept_ids:
                hosts_to_delete.append(h)
            else:
                # Keep it in the inbound to prevent orphan deletion
                new_hosts.append(h)

        if hosts_to_delete:
            affected_services.update(_detach_hosts_from_services(self.db, hosts_to_delete))
            for host in hosts_to_delete:
                self.db.delete(host)

        inbound.hosts = new_hosts

        disabled_hosts = [host for host in new_hosts if host.is_disabled]
        if disabled_hosts:
            affected_services.update(_detach_hosts_from_services(self.db, disabled_hosts))

        self.db.flush()
        self.db.refresh(inbound)
        return inbound.hosts, list(affected_services.values())

    def remove_all_hosts(self, inbound_tag: str) -> List[Service]:
        hosts = (
            self.db.query(ProxyHost)
            .options(joinedload(ProxyHost.service_links).joinedload(ServiceHostLink.service))
            .filter(ProxyHost.inbound_tag == inbound_tag)
            .all()
        )

        if not hosts:
            return []

        affected_services = _detach_hosts_from_services(self.db, hosts)
        for host in hosts:
            self.db.delete(host)

        self.db.flush()
        return list(affected_services.values())

    def disable_hosts(self, inbound_tag: str) -> List[Service]:
        hosts = (
            self.db.query(ProxyHost)
            .options(joinedload(ProxyHost.service_links).joinedload(ServiceHostLink.service))
            .filter(ProxyHost.inbound_tag == inbound_tag)
            .all()
        )
        affected_services: Dict[int, Service] = {}
        for host in hosts:
            host.is_disabled = True
            for link in list(host.service_links):
                if link.service and link.service.id is not None:
                    affected_services[link.service.id] = link.service
                self.db.delete(link)
        self.db.flush()
        return list(affected_services.values())


def add_default_host(db: Session, inbound: ProxyInbound):
    ProxyInboundRepository(db).add_default_host(inbound)


def get_or_create_inbound(db: Session, inbound_tag: str) -> ProxyInbound:
    return ProxyInboundRepository(db).get_or_create(inbound_tag)


def get_hosts(db: Session, inbound_tag: str) -> List[ProxyHost]:
    return ProxyInboundRepository(db).list_hosts(inbound_tag)


def add_host(db: Session, inbound_tag: str, host: ProxyHostModify) -> List[ProxyHost]:
    return ProxyInboundRepository(db).add_host(inbound_tag, host)


def update_hosts(
    db: Session,
    inbound_tag: str,
    modified_hosts: List[ProxyHostModify],
    kept_ids: Optional[Set[int]] = None,
) -> Tuple[List[ProxyHost], List[User]]:
    hosts, affected_services = ProxyInboundRepository(db).bulk_replace_hosts(
        inbound_tag, modified_hosts, kept_ids=kept_ids
    )

    users_to_refresh: Dict[int, User] = {}
    if affected_services:
        from .other import ServiceRepository

        repo = ServiceRepository(db)
        for service in affected_services:
            allowed = repo.get_allowed_inbounds(service)
            refreshed = repo.refresh_users(service, allowed)
            for user in refreshed:
                if user.id is not None:
                    users_to_refresh[user.id] = user

    db.commit()
    return hosts, list(users_to_refresh.values())


def delete_inbound(db: Session, inbound_tag: str) -> bool:
    return ProxyInboundRepository(db).delete(inbound_tag)


def disable_hosts_for_inbound(db: Session, inbound_tag: str) -> List[Service]:
    return ProxyInboundRepository(db).disable_hosts(inbound_tag)


def remove_hosts_for_inbound(db: Session, inbound_tag: str) -> List[Service]:
    return ProxyInboundRepository(db).remove_all_hosts(inbound_tag)


def _fetch_hosts_by_ids(db: Session, host_ids: Iterable[int]) -> Dict[int, ProxyHost]:
    if not host_ids:
        return {}
    hosts = db.query(ProxyHost).filter(ProxyHost.id.in_(set(host_ids))).all()
    return {host.id: host for host in hosts}


def _detach_hosts_from_services(db: Session, hosts: Iterable[ProxyHost]) -> Dict[int, Service]:
    affected: Dict[int, Service] = {}
    for host in hosts:
        for link in list(host.service_links):
            if link.service and link.service.id is not None:
                affected[link.service.id] = link.service
            db.delete(link)
    return affected
