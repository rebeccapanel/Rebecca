"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

from copy import deepcopy
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple, Union, Literal

import sqlalchemy as sa
from sqlalchemy import and_, delete, func, or_, inspect
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Query, Session, joinedload
from sqlalchemy.sql.functions import coalesce
from app.db.models import (
    JWT,
    TLS,
    Admin,
    AdminServiceLink,
    AdminUsageLogs,
    NextPlan,
    MasterNodeState,
    Node,
    NodeUsage,
    NodeUserUsage,
    Proxy,
    ProxyHost,
    ProxyInbound,
    ProxyTypes,
    Service,
    ServiceHostLink,
    System,
    User,
    UserTemplate,
    UserUsageResetLogs,
    XrayConfig,
    excluded_inbounds_association,
    template_inbounds_association,
)
from app.models.admin import AdminStatus
from app.models.admin import AdminCreate, AdminModify, AdminPartialModify
from app.utils.xray_defaults import load_legacy_xray_config
from app.utils.credentials import (
    generate_key,
    normalize_key,
    serialize_proxy_settings,
    uuid_to_key,
)
from app.utils.credentials import UUID_PROTOCOLS, PASSWORD_PROTOCOLS
from app.models.proxy import ProxyTypes
from app.models.node import GeoMode, NodeCreate, NodeModify, NodeStatus, NodeUsageResponse
from app.models.proxy import ProxyHost as ProxyHostModify, ProxySettings
from app.models.service import ServiceCreate, ServiceHostAssignment, ServiceModify
from app.models.user import (
    UserCreate,
    UserDataLimitResetStrategy,
    UserModify,
    UserResponse,
    UserStatus,
    UserUsageResponse,
)
from app.models.user_template import UserTemplateCreate, UserTemplateModify
from config import USERS_AUTODELETE_DAYS
from app.db.exceptions import UsersLimitReachedError
MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False


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
        proxy.settings = serialize_proxy_settings(settings_obj, proxy_type, normalized, preserve_existing_uuid=preserve_uuid)


def _get_or_create_xray_config(db: Session) -> XrayConfig:
    if not _xray_config_table_exists(db):
        raise RuntimeError("xray_config table is not available yet")

    config = db.get(XrayConfig, 1)
    if config is None:
        config = XrayConfig(id=1, data=load_legacy_xray_config())
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def get_xray_config(db: Session) -> Dict[str, Any]:
    if not _xray_config_table_exists(db):
        return deepcopy(load_legacy_xray_config())

    config = _get_or_create_xray_config(db)
    return deepcopy(config.data or {})


def save_xray_config(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
    config = _get_or_create_xray_config(db)
    config.data = deepcopy(payload or {})
    db.add(config)
    db.commit()
    db.refresh(config)
    return deepcopy(config.data or {})


def _xray_config_table_exists(db: Session) -> bool:
    bind = db.get_bind()
    if bind is None:
        return False
    try:
        inspector = inspect(bind)
        return inspector.has_table("xray_config")
    except Exception:
        return False


def _ensure_user_deleted_status(db: Session) -> bool:
    """
    Ensure the underlying user status enum (if any) supports the 'deleted' value.

    Returns:
        bool: True if the enum already supported, was updated successfully,
              or does not need updating. False if no automated fix was applied.
    """
    global _USER_STATUS_ENUM_ENSURED

    if _USER_STATUS_ENUM_ENSURED:
        return True

    bind = db.get_bind()
    if bind is None:
        return False

    engine = getattr(bind, "engine", bind)
    dialect = engine.dialect.name

    try:
        inspector = sa.inspect(engine)
        columns = inspector.get_columns("users")
    except Exception:  # pragma: no cover - inspector failure
        return False

    status_column = next((col for col in columns if col.get("name") == "status"), None)
    if not status_column:
        return False

    enum_type = status_column.get("type")
    enum_values = getattr(enum_type, "enums", None)
    if enum_values and "deleted" in enum_values:
        _USER_STATUS_ENUM_ENSURED = True
        return True

    try:
        if dialect == "mysql":
            with engine.begin() as conn:
                conn.exec_driver_sql(
                    "ALTER TABLE users MODIFY COLUMN status "
                    "ENUM('active','disabled','limited','expired','on_hold','deleted') NOT NULL"
                )
        elif dialect == "postgresql":
            with engine.begin() as conn:
                conn.exec_driver_sql("ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'deleted'")
        else:
            # SQLite and other backends require running the Alembic migration.
            return False
    except Exception:  # pragma: no cover - ALTER failure
        return False

    _USER_STATUS_ENUM_ENSURED = True
    return True


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
    """
    Repository-like helper that encapsulates all host/inbound operations.
    """

    def __init__(self, db: Session):
        self.db = db

    # region: inbound lifecycle -------------------------------------------------
    def add_default_host(self, inbound: ProxyInbound) -> None:
        host = ProxyHost(
            remark="🚀 Marz ({USERNAME}) [{PROTOCOL} - {TRANSPORT}]",
            address="{SERVER_IP}",
            inbound=inbound,
            sort=0,
        )
        self.db.add(host)
        self.db.commit()

    def get_or_create(self, inbound_tag: str) -> ProxyInbound:
        inbound = (
            self.db.query(ProxyInbound).filter(ProxyInbound.tag == inbound_tag).first()
        )
        if inbound:
            return inbound
        inbound = ProxyInbound(tag=inbound_tag)
        self.db.add(inbound)
        self.db.commit()
        self.add_default_host(inbound)
        self.db.refresh(inbound)
        return inbound

    def delete(self, inbound_tag: str) -> bool:
        inbound = (
            self.db.query(ProxyInbound).filter(ProxyInbound.tag == inbound_tag).first()
        )
        if inbound is None:
            return False

        if inbound.hosts:
            raise ValueError("Inbound has hosts assigned. Remove hosts before deleting.")

        self.db.execute(
            delete(excluded_inbounds_association).where(
                excluded_inbounds_association.c.inbound_tag == inbound_tag
            )
        )
        self.db.execute(
            delete(template_inbounds_association).where(
                template_inbounds_association.c.inbound_tag == inbound_tag
            )
        )

        self.db.delete(inbound)
        self.db.flush()
        return True

    # endregion

    # region: host CRUD --------------------------------------------------------
    def list_hosts(self, inbound_tag: str) -> List[ProxyHost]:
        inbound = self.get_or_create(inbound_tag)
        return (
            self.db.query(ProxyHost)
            .filter(ProxyHost.inbound_tag == inbound.tag)
            .order_by(ProxyHost.sort.asc(), ProxyHost.id.asc())
            .all()
        )

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

    def bulk_replace_hosts(
        self, inbound_tag: str, modified_hosts: List[ProxyHostModify]
    ) -> Tuple[List[ProxyHost], List[Service]]:
        inbound = self.get_or_create(inbound_tag)
        existing_by_id: Dict[int, ProxyHost] = {
            host.id: host for host in inbound.hosts if host.id is not None
        }

        affected_services: Dict[int, Service] = {}
        new_hosts: List[ProxyHost] = []

        for index, host_payload in enumerate(modified_hosts):
            sort_value = host_payload.sort if host_payload.sort is not None else index
            db_host: Optional[ProxyHost] = None

            if host_payload.id is not None:
                db_host = existing_by_id.pop(host_payload.id, None)

            if db_host is None:
                db_host = ProxyHost(inbound=inbound)

            db_host.inbound = inbound
            db_host.inbound_tag = inbound.tag
            _apply_proxy_host_payload(db_host, host_payload, sort_value=sort_value)

            new_hosts.append(db_host)

        # Remove hosts that no longer exist
        removed_hosts = list(existing_by_id.values())
        if removed_hosts:
            affected_services.update(_detach_hosts_from_services(self.db, removed_hosts))
            for host in removed_hosts:
                self.db.delete(host)

        inbound.hosts = new_hosts

        disabled_hosts = [host for host in new_hosts if host.is_disabled]
        if disabled_hosts:
            affected_services.update(_detach_hosts_from_services(self.db, disabled_hosts))

        self.db.flush()
        self.db.refresh(inbound)
        return inbound.hosts, list(affected_services.values())

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

    # endregion


def add_default_host(db: Session, inbound: ProxyInbound):
    ProxyInboundRepository(db).add_default_host(inbound)


def get_or_create_inbound(db: Session, inbound_tag: str) -> ProxyInbound:
    return ProxyInboundRepository(db).get_or_create(inbound_tag)


def get_hosts(db: Session, inbound_tag: str) -> List[ProxyHost]:
    return ProxyInboundRepository(db).list_hosts(inbound_tag)


def add_host(db: Session, inbound_tag: str, host: ProxyHostModify) -> List[ProxyHost]:
    return ProxyInboundRepository(db).add_host(inbound_tag, host)


def update_hosts(
    db: Session, inbound_tag: str, modified_hosts: List[ProxyHostModify]
) -> Tuple[List[ProxyHost], List[User]]:
    hosts, affected_services = ProxyInboundRepository(db).bulk_replace_hosts(inbound_tag, modified_hosts)

    users_to_refresh: Dict[int, User] = {}
    if affected_services:
        repo = _service_repo(db)
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


def _fetch_hosts_by_ids(db: Session, host_ids: Iterable[int]) -> Dict[int, ProxyHost]:
    if not host_ids:
        return {}
    hosts = (
        db.query(ProxyHost)
        .filter(ProxyHost.id.in_(set(host_ids)))
        .all()
    )
    return {host.id: host for host in hosts}


def _detach_hosts_from_services(db: Session, hosts: Iterable[ProxyHost]) -> Dict[int, Service]:
    affected: Dict[int, Service] = {}
    for host in hosts:
        for link in list(host.service_links):
            if link.service and link.service.id is not None:
                affected[link.service.id] = link.service
            db.delete(link)
    return affected


class ServiceRepository:
    def __init__(self, db: Session):
        self.db = db

    def assign_hosts(
        self, service: Service, assignments: Iterable[ServiceHostAssignment]
    ) -> None:
        assignments = list(assignments)
        desired_ids = [assignment.host_id for assignment in assignments]
        host_map = _fetch_hosts_by_ids(self.db, desired_ids)

        if len(host_map) != len(set(desired_ids)):
            raise ValueError("One or more hosts could not be found")

        existing_links = {link.host_id: link for link in service.host_links}
        desired_id_set = set(desired_ids)

        for link in list(service.host_links):
            if link.host_id not in desired_id_set:
                service.host_links.remove(link)
                self.db.delete(link)

        for index, assignment in enumerate(assignments):
            sort_value = assignment.sort if assignment.sort is not None else index
            link = existing_links.get(assignment.host_id)
            if link:
                link.sort = sort_value
            else:
                service.host_links.append(
                    ServiceHostLink(
                        host=host_map[assignment.host_id],
                        sort=sort_value,
                    )
                )

    def assign_admins(self, service: Service, admin_ids: Iterable[int]) -> None:
        admin_ids = list(dict.fromkeys(admin_ids))
        existing_links = {link.admin_id: link for link in service.admin_links}
        desired_id_set = set(admin_ids)

        for link in list(service.admin_links):
            if link.admin_id not in desired_id_set:
                service.admin_links.remove(link)
                self.db.delete(link)

        if not admin_ids:
            return

        admins = (
            self.db.query(Admin)
            .filter(Admin.id.in_(desired_id_set))
            .filter(Admin.status != AdminStatus.deleted)
            .all()
        )
        if len(admins) != len(desired_id_set):
            raise ValueError("One or more admins could not be found")

        for admin in admins:
            if admin.id in existing_links:
                continue
            service.admin_links.append(AdminServiceLink(admin=admin, service=service))

    def ensure_admin_service_link(self, admin: Optional[Admin], service: Service) -> None:
        if not admin or admin.id is None or service.id is None:
            return

        exists = (
            self.db.query(AdminServiceLink)
            .filter(
                AdminServiceLink.admin_id == admin.id,
                AdminServiceLink.service_id == service.id,
            )
            .first()
        )
        if exists:
            return

        self.db.add(AdminServiceLink(admin_id=admin.id, service_id=service.id))

    @staticmethod
    def compute_allowed_inbounds(service: Service) -> Dict[ProxyTypes, Set[str]]:
        from app.runtime import xray

        allowed: Dict[ProxyTypes, Set[str]] = {}
        if service is None:
            return allowed

        inbound_map = xray.config.inbounds_by_tag

        for link in service.host_links:
            host = link.host
            if not host or host.is_disabled:
                continue
            inbound_tag = host.inbound_tag
            inbound_info = inbound_map.get(inbound_tag)
            if not inbound_info:
                continue
            protocol = inbound_info.get("protocol")
            if not protocol:
                continue
            try:
                proxy_type = ProxyTypes(protocol)
            except ValueError:
                continue
            allowed.setdefault(proxy_type, set()).add(inbound_tag)

        return allowed

    def apply_service_to_user(
        self,
        dbuser: User,
        service: Service,
        allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
    ) -> None:
        from app.runtime import xray

        if allowed_inbounds is None:
            allowed_inbounds = self.compute_allowed_inbounds(service)

        allowed_protocols = set(allowed_inbounds.keys())
        existing_proxies: Dict[ProxyTypes, Proxy] = {}

        for proxy in list(dbuser.proxies):
            proxy_type = ProxyTypes(proxy.type)
            if proxy_type not in allowed_protocols:
                self.db.delete(proxy)
                continue
            existing_proxies[proxy_type] = proxy

        for proxy_type in allowed_protocols:
            allowed_tags = allowed_inbounds[proxy_type]
            proxy = existing_proxies.get(proxy_type)
            if not proxy:
                settings_model = proxy_type.settings_model
                serialized = serialize_proxy_settings(
                    settings_model(), proxy_type, dbuser.credential_key
                )
                proxy = Proxy(type=proxy_type.value, settings=serialized)
                dbuser.proxies.append(proxy)

            available_tags = {
                inbound["tag"]
                for inbound in xray.config.inbounds_by_protocol.get(proxy_type, [])
            }
            excluded_tags = sorted(available_tags - set(allowed_tags))
            proxy.excluded_inbounds = [
                get_or_create_inbound(self.db, tag) for tag in excluded_tags
            ]

        dbuser.service = service
        dbuser.edit_at = datetime.utcnow()

    def refresh_users(
        self,
        service: Service,
        allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
    ) -> List[User]:
        if allowed_inbounds is None:
            allowed_inbounds = self.compute_allowed_inbounds(service)

        updated_users: List[User] = []
        for user in service.users:
            if user.status == UserStatus.deleted:
                continue
            self.apply_service_to_user(user, service, allowed_inbounds)
            updated_users.append(user)

        self.db.flush()
        return updated_users

    def get_allowed_inbounds(self, service: Service) -> Dict[ProxyTypes, Set[str]]:
        return self.compute_allowed_inbounds(service)

    def get(self, service_id: int) -> Optional[Service]:
        return (
            self.db.query(Service)
            .options(
                joinedload(Service.admin_links).joinedload(AdminServiceLink.admin),
                joinedload(Service.host_links).joinedload(ServiceHostLink.host),
            )
            .filter(Service.id == service_id)
            .first()
        )

    def list(
        self,
        name: Optional[str] = None,
        admin: Optional[Admin] = None,
        offset: int = 0,
        limit: Optional[int] = None,
    ) -> Dict[str, Union[List[Service], int]]:
        query = self.db.query(Service)

        if name:
            query = query.filter(Service.name.ilike(f"%{name}%"))

        if admin and not admin.is_sudo:
            query = query.join(Service.admin_links).filter(
                AdminServiceLink.admin_id == admin.id
            )

        total = query.count()
        query = query.order_by(Service.created_at.desc())

        if offset:
            query = query.offset(offset)

        if limit:
            query = query.limit(limit)

        services = query.all()

        service_ids = [service.id for service in services if service.id is not None]

        host_counts: Dict[int, int] = {}
        user_counts: Dict[int, int] = {}

        if service_ids:
            host_counts = {
                service_id: int(count or 0)
                for service_id, count in (
                    self.db.query(
                        ServiceHostLink.service_id, func.count(ServiceHostLink.host_id)
                    )
                    .filter(ServiceHostLink.service_id.in_(service_ids))
                    .group_by(ServiceHostLink.service_id)
                    .all()
                )
            }
            user_counts = {
                service_id: int(count or 0)
                for service_id, count in (
                    self.db.query(User.service_id, func.count(User.id))
                    .filter(User.service_id.in_(service_ids))
                    .group_by(User.service_id)
                    .all()
                )
            }

        return {
            "services": services,
            "total": total,
            "host_counts": host_counts,
            "user_counts": user_counts,
        }

    def create(self, payload: ServiceCreate) -> Service:
        if not payload.hosts:
            raise ValueError("Service must include at least one host")

        service = Service(
            name=payload.name.strip(),
            description=payload.description or None,
        )
        self.db.add(service)
        self.db.flush()

        self.assign_hosts(service, payload.hosts)
        self.assign_admins(service, payload.admin_ids)

        self.db.commit()
        self.db.refresh(service)
        return service

    def update(
        self,
        service: Service,
        modification: ServiceModify,
    ) -> Tuple[
        Service,
        Optional[Dict[ProxyTypes, Set[str]]],
        Optional[Dict[ProxyTypes, Set[str]]],
    ]:
        allowed_before: Optional[Dict[ProxyTypes, Set[str]]] = None

        if modification.hosts is not None:
            if not modification.hosts:
                raise ValueError("Service must include at least one host")
            allowed_before = self.compute_allowed_inbounds(service)
            self.assign_hosts(service, modification.hosts)

        if modification.name is not None:
            service.name = modification.name.strip()

        if modification.description is not None:
            service.description = modification.description or None

        if modification.admin_ids is not None:
            self.assign_admins(service, modification.admin_ids)

        self.db.flush()
        allowed_after: Optional[Dict[ProxyTypes, Set[str]]] = (
            self.compute_allowed_inbounds(service) if allowed_before is not None else None
        )

        self.db.commit()
        self.db.refresh(service)

        return service, allowed_before, allowed_after

    def remove(
        self,
        service: Service,
        *,
        mode: Literal["delete_users", "transfer_users"] = "delete_users",
        target_service: Optional[Service] = None,
        unlink_admins: bool = False,
    ) -> Tuple[List[User], List[User]]:
        if service.admin_links and not unlink_admins:
            raise ValueError("Service has admins assigned. Unlink them before deleting.")

        deleted_users: List[User] = []
        transferred_users: List[User] = []
        service_users = list(service.users)

        if unlink_admins and service.admin_links:
            service.admin_links.clear()

        if service_users:
            if mode == "transfer_users":
                if not target_service or target_service.id == service.id:
                    raise ValueError("A different target service is required for transferring users")
                for user in service_users:
                    user.service_id = target_service.id
                    transferred_users.append(user)
            elif mode == "delete_users":
                deleted_users.extend(service_users)
                for user in service_users:
                    self.db.delete(user)
            else:
                raise ValueError("Invalid delete mode")

        self.db.delete(service)
        self.db.commit()
        return deleted_users, transferred_users

    def reset_usage(self, service: Service) -> Service:
        service.used_traffic = 0
        service.updated_at = datetime.utcnow()

        for link in service.admin_links:
            link.used_traffic = 0
            link.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(service)
        return service

    def usage_timeseries(
        self,
        service: Service,
        start: datetime,
        end: datetime,
        granularity: str = "day",
    ) -> List[Dict[str, Union[datetime, int]]]:
        granularity_value = (granularity or "day").lower()
        if granularity_value not in {"day", "hour"}:
            granularity_value = "day"

        start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
        end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
        tzinfo = start_aware.tzinfo or timezone.utc

        if granularity_value == "hour":
            current = start_aware.replace(minute=0, second=0, microsecond=0)
            end_aligned = end_aware.replace(minute=0, second=0, microsecond=0)
            step = timedelta(hours=1)
        else:
            current = start_aware.replace(hour=0, minute=0, second=0, microsecond=0)
            end_aligned = end_aware.replace(hour=0, minute=0, second=0, microsecond=0)
            step = timedelta(days=1)

        if current > end_aligned:
            return []

        usage_map: Dict[datetime, int] = {}
        cursor = current
        while cursor <= end_aligned:
            usage_map[cursor] = 0
            cursor += step

        rows = (
            self.db.query(NodeUserUsage.created_at, NodeUserUsage.used_traffic)
            .join(User, User.id == NodeUserUsage.user_id)
            .filter(
                User.service_id == service.id,
                NodeUserUsage.created_at >= start_aware,
                NodeUserUsage.created_at <= end_aware,
            )
            .all()
        )

        for created_at, used_traffic in rows:
            if created_at is None or used_traffic is None:
                continue
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=tzinfo)
            else:
                created_at = created_at.astimezone(tzinfo)
            if granularity_value == "hour":
                bucket = created_at.replace(minute=0, second=0, microsecond=0)
            else:
                bucket = created_at.replace(hour=0, minute=0, second=0, microsecond=0)
            usage_map.setdefault(bucket, 0)
            usage_map[bucket] += int(used_traffic)

        return [
            {"timestamp": bucket, "used_traffic": value}
            for bucket, value in sorted(usage_map.items(), key=lambda item: item[0])
        ]

    def admin_usage_timeseries(
        self,
        service: Service,
        admin_id: Optional[int],
        start: datetime,
        end: datetime,
        granularity: str = "day",
    ) -> List[Dict[str, Union[datetime, int]]]:
        granularity_value = (granularity or "day").lower()
        if granularity_value not in {"day", "hour"}:
            granularity_value = "day"

        start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
        end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
        tzinfo = start_aware.tzinfo or timezone.utc

        if granularity_value == "hour":
            current = start_aware.replace(minute=0, second=0, microsecond=0)
            end_aligned = end_aware.replace(minute=0, second=0, microsecond=0)
            step = timedelta(hours=1)
        else:
            current = start_aware.replace(hour=0, minute=0, second=0, microsecond=0)
            end_aligned = end_aware.replace(hour=0, minute=0, second=0, microsecond=0)
            step = timedelta(days=1)

        if current > end_aligned:
            return []

        usage_map: Dict[datetime, int] = {}
        cursor = current
        while cursor <= end_aligned:
            usage_map[cursor] = 0
            cursor += step

        query = (
            self.db.query(NodeUserUsage.created_at, NodeUserUsage.used_traffic)
            .join(User, User.id == NodeUserUsage.user_id)
            .filter(
                User.service_id == service.id,
                NodeUserUsage.created_at >= start_aware,
                NodeUserUsage.created_at <= end_aware,
            )
        )

        if admin_id is None:
            query = query.filter(User.admin_id.is_(None))
        else:
            query = query.filter(User.admin_id == admin_id)

        rows = query.all()
        for created_at, used_traffic in rows:
            if created_at is None or used_traffic is None:
                continue
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=tzinfo)
            else:
                created_at = created_at.astimezone(tzinfo)
            if granularity_value == "hour":
                bucket = created_at.replace(minute=0, second=0, microsecond=0)
            else:
                bucket = created_at.replace(hour=0, minute=0, second=0, microsecond=0)
            usage_map.setdefault(bucket, 0)
            usage_map[bucket] += int(used_traffic)

        return [
            {"timestamp": bucket, "used_traffic": value}
            for bucket, value in sorted(usage_map.items(), key=lambda item: item[0])
        ]

    def admin_usage(
        self,
        service: Service,
        start: datetime,
        end: datetime,
    ) -> List[Dict[str, Union[int, None, str]]]:
        usage_rows = (
            self.db.query(
                Admin.id.label("admin_id"),
                Admin.username.label("username"),
                func.coalesce(func.sum(NodeUserUsage.used_traffic), 0).label("used_traffic"),
            )
            .select_from(NodeUserUsage)
            .join(User, User.id == NodeUserUsage.user_id)
            .outerjoin(Admin, Admin.id == User.admin_id)
            .filter(
                User.service_id == service.id,
                NodeUserUsage.created_at >= start,
                NodeUserUsage.created_at <= end,
            )
            .group_by(Admin.id, Admin.username)
            .all()
        )

        usage_map: Dict[Optional[int], Dict[str, Union[int, None, str]]] = {}
        for admin_id, username, used in usage_rows:
            label = username or "Unassigned"
            usage_map[admin_id] = {
                "admin_id": admin_id,
                "username": label,
                "used_traffic": int(used or 0),
            }

        for link in service.admin_links:
            if link.admin_id is None or not link.admin:
                continue
            usage_map.setdefault(
                link.admin_id,
                {
                    "admin_id": link.admin_id,
                    "username": link.admin.username,
                    "used_traffic": 0,
                },
            )

        return sorted(
            usage_map.values(),
            key=lambda entry: int(entry.get("used_traffic") or 0),
            reverse=True,
        )


def _service_repo(db: Session) -> ServiceRepository:
    return ServiceRepository(db)


def _assign_service_hosts(
    db: Session, service: Service, assignments: Iterable[ServiceHostAssignment]
) -> None:
    _service_repo(db).assign_hosts(service, assignments)


def _assign_service_admins(
    db: Session, service: Service, admin_ids: Iterable[int]
) -> None:
    _service_repo(db).assign_admins(service, admin_ids)


def _service_allowed_inbounds(service: Service) -> Dict[ProxyTypes, Set[str]]:
    return ServiceRepository.compute_allowed_inbounds(service)


def _ensure_admin_service_link(db: Session, admin: Optional[Admin], service: Service) -> None:
    _service_repo(db).ensure_admin_service_link(admin, service)


def _apply_service_to_user(
    db: Session,
    dbuser: User,
    service: Service,
    allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
) -> None:
    _service_repo(db).apply_service_to_user(dbuser, service, allowed_inbounds)


def refresh_service_users(
    db: Session,
    service: Service,
    allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
) -> List[User]:
    return _service_repo(db).refresh_users(service, allowed_inbounds)


def get_service_allowed_inbounds(service: Service) -> Dict[ProxyTypes, Set[str]]:
    return _service_allowed_inbounds(service)


def get_service(db: Session, service_id: int) -> Optional[Service]:
    return _service_repo(db).get(service_id)


def list_services(
    db: Session,
    name: Optional[str] = None,
    admin: Optional[Admin] = None,
    offset: int = 0,
    limit: Optional[int] = None,
) -> Dict[str, Union[List[Service], int]]:
    return _service_repo(db).list(name=name, admin=admin, offset=offset, limit=limit)


def create_service(db: Session, payload: ServiceCreate) -> Service:
    return _service_repo(db).create(payload)


def update_service(
    db: Session,
    service: Service,
    modification: ServiceModify,
) -> Tuple[Service, Optional[Dict[ProxyTypes, Set[str]]], Optional[Dict[ProxyTypes, Set[str]]]]:
    return _service_repo(db).update(service, modification)


def remove_service(
    db: Session,
    service: Service,
    *,
    mode: Literal["delete_users", "transfer_users"] = "delete_users",
    target_service: Optional[Service] = None,
    unlink_admins: bool = False,
) -> Tuple[List[User], List[User]]:
    return _service_repo(db).remove(
        service,
        mode=mode,
        target_service=target_service,
        unlink_admins=unlink_admins,
    )


def reset_service_usage(db: Session, service: Service) -> Service:
    return _service_repo(db).reset_usage(service)


def get_service_usage_timeseries(
    db: Session,
    service: Service,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int]]]:
    return _service_repo(db).usage_timeseries(service, start, end, granularity)


def get_service_admin_usage_timeseries(
    db: Session,
    service: Service,
    admin_id: Optional[int],
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int]]]:
    return _service_repo(db).admin_usage_timeseries(service, admin_id, start, end, granularity)


def get_service_admin_usage(
    db: Session,
    service: Service,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Union[int, None, str]]]:
    return _service_repo(db).admin_usage(service, start, end)


def get_user_queryset(db: Session) -> Query:
    """
    Retrieves the base user query with joined admin details.

    Args:
        db (Session): Database session.

    Returns:
        Query: Base user query.
    """
    return (
        db.query(User)
        .options(joinedload(User.admin))
        .options(joinedload(User.next_plan))
        .filter(User.status != UserStatus.deleted)
    )


def get_user(db: Session, username: str) -> Optional[User]:
    """
    Retrieves a user by username.

    Args:
        db (Session): Database session.
        username (str): The username of the user.

    Returns:
        Optional[User]: The user object if found, else None.
    """
    normalized = username.lower()
    return (
        get_user_queryset(db)
        .filter(func.lower(User.username) == normalized)
        .first()
    )


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """
    Retrieves a user by user ID.

    Args:
        db (Session): Database session.
        user_id (int): The ID of the user.

    Returns:
        Optional[User]: The user object if found, else None.
    """
    return get_user_queryset(db).filter(User.id == user_id).first()


UsersSortingOptions = Enum('UsersSortingOptions', {
    'username': User.username.asc(),
    'used_traffic': User.used_traffic.asc(),
    'data_limit': User.data_limit.asc(),
    'expire': User.expire.asc(),
    'created_at': User.created_at.asc(),
    '-username': User.username.desc(),
    '-used_traffic': User.used_traffic.desc(),
    '-data_limit': User.data_limit.desc(),
    '-expire': User.expire.desc(),
    '-created_at': User.created_at.desc(),
})


def get_users(db: Session,
              offset: Optional[int] = None,
              limit: Optional[int] = None,
              usernames: Optional[List[str]] = None,
              search: Optional[str] = None,
              status: Optional[Union[UserStatus, list]] = None,
              sort: Optional[List[UsersSortingOptions]] = None,
              admin: Optional[Admin] = None,
              admins: Optional[List[str]] = None,
              reset_strategy: Optional[Union[UserDataLimitResetStrategy, list]] = None,
              return_with_count: bool = False) -> Union[List[User], Tuple[List[User], int]]:
    """
    Retrieves users based on various filters and options.

    Args:
        db (Session): Database session.
        offset (Optional[int]): Number of records to skip.
        limit (Optional[int]): Number of records to retrieve.
        usernames (Optional[List[str]]): List of usernames to filter by.
        search (Optional[str]): Search term to filter by username or note.
        status (Optional[Union[UserStatus, list]]): User status or list of statuses to filter by.
        sort (Optional[List[UsersSortingOptions]]): Sorting options.
        admin (Optional[Admin]): Admin to filter users by.
        admins (Optional[List[str]]): List of admin usernames to filter users by.
        reset_strategy (Optional[Union[UserDataLimitResetStrategy, list]]): Data limit reset strategy to filter by.
        return_with_count (bool): Whether to return the total count of users.

    Returns:
        Union[List[User], Tuple[List[User], int]]: List of users or tuple of users and total count.
    """
    query = get_user_queryset(db)

    if search:
        query = query.filter(or_(User.username.ilike(f"%{search}%"), User.note.ilike(f"%{search}%")))

    if usernames:
        query = query.filter(User.username.in_(usernames))

    if status:
        if isinstance(status, list):
            query = query.filter(User.status.in_(status))
        else:
            query = query.filter(User.status == status)

    if reset_strategy:
        if isinstance(reset_strategy, list):
            query = query.filter(User.data_limit_reset_strategy.in_(reset_strategy))
        else:
            query = query.filter(User.data_limit_reset_strategy == reset_strategy)

    if admin:
        query = query.filter(User.admin == admin)

    if admins:
        query = query.filter(User.admin.has(Admin.username.in_(admins)))

    if return_with_count:
        count = query.count()

    if sort:
        query = query.order_by(*(opt.value for opt in sort))

    if offset:
        query = query.offset(offset)
    if limit:
        query = query.limit(limit)

    if return_with_count:
        return query.all(), count

    return query.all()


def get_user_usage_timeseries(
    db: Session,
    dbuser: User,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int, List[Dict[str, Union[int, str, int]]]]]]:
    """Return usage timeline buckets for a user with optional per-node breakdown."""

    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        granularity_value = "day"

    start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    target_tz = start_aware.tzinfo or timezone.utc

    if granularity_value == "hour":
        current = start_aware.replace(minute=0, second=0, microsecond=0)
        end_aligned = end_aware.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
    else:
        current = start_aware.replace(hour=0, minute=0, second=0, microsecond=0)
        end_aligned = end_aware.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)

    if current > end_aligned:
        return []

    _ensure_master_state(db, for_update=False)
    node_lookup: Dict[Optional[int], str] = {None: MASTER_NODE_NAME}
    for node_id, node_name in db.query(Node.id, Node.name).all():
        node_lookup[node_id] = node_name

    usage_map: Dict[datetime, Dict[str, Union[int, Dict[Optional[int], int]]]] = {}
    cursor = current
    while cursor <= end_aligned:
        usage_map[cursor] = {"total": 0, "nodes": defaultdict(int)}
        cursor += step

    rows = (
        db.query(NodeUserUsage.created_at, NodeUserUsage.node_id, NodeUserUsage.used_traffic)
        .filter(
            NodeUserUsage.user_id == dbuser.id,
            NodeUserUsage.created_at >= start_aware,
            NodeUserUsage.created_at <= end_aware,
        )
        .all()
    )

    for created_at, node_id, used_traffic in rows:
        if created_at is None or used_traffic is None:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        created_at = created_at.astimezone(target_tz)

        if granularity_value == "hour":
            bucket = created_at.replace(minute=0, second=0, microsecond=0)
        else:
            bucket = created_at.replace(hour=0, minute=0, second=0, microsecond=0)

        if bucket not in usage_map:
            usage_map[bucket] = {"total": 0, "nodes": defaultdict(int)}

        bucket_entry = usage_map[bucket]
        bucket_entry["total"] = int(bucket_entry["total"] or 0) + int(used_traffic)
        nodes_map: Dict[int, int] = bucket_entry["nodes"]  # type: ignore[assignment]
        key = node_id if node_id is not None else master.id
        nodes_map[key] += int(used_traffic)

    timeline: List[Dict[str, Union[datetime, int, List[Dict[str, Union[int, str, int]]]]]] = []
    for bucket in sorted(usage_map.keys()):
        bucket_entry = usage_map[bucket]
        nodes_map = bucket_entry["nodes"]  # type: ignore[assignment]
        node_entries: List[Dict[str, Union[int, str, int]]] = []
        for node_id, usage in nodes_map.items():
            if not usage:
                continue
            resolved_id = 0 if node_id == master.id else node_id
            node_entries.append(
                {
                    "node_id": resolved_id,
                    "node_name": node_lookup.get(node_id) or node_lookup.get(None, "Master"),
                    "used_traffic": int(usage),
                }
            )
        timeline.append(
            {
                "timestamp": bucket,
                "total": int(bucket_entry["total"] or 0),
                "nodes": node_entries,
            }
        )

    return timeline


def get_user_usage_by_nodes(
    db: Session,
    dbuser: User,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Union[Optional[int], str, int]]]:
    """Aggregate total usage per node (downlink) for a user within a date range."""

    start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)

    _ensure_master_state(db, for_update=False)

    node_lookup: Dict[Optional[int], Dict[str, Union[Optional[int], str, int]]] = {
        None: {"node_id": None, "node_name": MASTER_NODE_NAME, "uplink": 0, "downlink": 0}
    }
    for node in db.query(Node).all():
        node_lookup[node.id] = {
            "node_id": node.id,
            "node_name": node.name,
            "uplink": 0,
            "downlink": 0,
        }

    rows = (
        db.query(NodeUserUsage.node_id, func.coalesce(func.sum(NodeUserUsage.used_traffic), 0))
        .filter(
            NodeUserUsage.user_id == dbuser.id,
            NodeUserUsage.created_at >= start_aware,
            NodeUserUsage.created_at <= end_aware,
        )
        .group_by(NodeUserUsage.node_id)
        .all()
    )

    for node_id, traffic in rows:
        target_id = node_id
        if target_id not in node_lookup:
            # fallback for nodes created after initial map
            node_lookup[target_id] = {
                "node_id": target_id,
                "node_name": MASTER_NODE_NAME if target_id is None else f"Node {target_id}",
                "uplink": 0,
                "downlink": 0,
            }
        node_lookup[target_id]["downlink"] = node_lookup[target_id].get("downlink", 0) + int(traffic or 0)

    return sorted(
        node_lookup.values(),
        key=lambda entry: (entry["node_id"] is not None, entry["node_id"] or -1),
    )


def get_user_usages(db: Session, dbuser: User, start: datetime, end: datetime) -> List[UserUsageResponse]:
    """
    Retrieves user usages within a specified date range.

    Args:
        db (Session): Database session.
        dbuser (User): The user object.
        start (datetime): Start date for usage retrieval.
        end (datetime): End date for usage retrieval.

    Returns:
        List[UserUsageResponse]: List of user usage responses.
    """

    usages = {0: UserUsageResponse(  # Main Core
        node_id=None,
        node_name="Master",
        used_traffic=0
    )}

    for node in db.query(Node).all():
        usages[node.id] = UserUsageResponse(
            node_id=node.id,
            node_name=node.name,
            used_traffic=0
        )

    cond = and_(NodeUserUsage.user_id == dbuser.id,
                NodeUserUsage.created_at >= start,
                NodeUserUsage.created_at <= end)

    for v in db.query(NodeUserUsage).filter(cond):
        try:
            usages[v.node_id or 0].used_traffic += v.used_traffic
        except KeyError:
            pass

    return list(usages.values())


def get_users_count(db: Session, status: UserStatus = None, admin: Admin = None) -> int:
    """
    Retrieves the count of users based on status and admin filters.

    Args:
        db (Session): Database session.
        status (UserStatus, optional): Status to filter users by.
        admin (Admin, optional): Admin to filter users by.

    Returns:
        int: Count of users matching the criteria.
    """
    query = db.query(User.id)
    if status is None:
        query = query.filter(User.status != UserStatus.deleted)
    if admin:
        query = query.filter(User.admin == admin)
    if status:
        query = query.filter(User.status == status)
    return query.count()


def _status_to_str(status: Union[UserStatus, str, None]) -> Optional[str]:
    if status is None:
        return None
    if isinstance(status, Enum):
        return status.value
    return str(status)


def _is_user_limit_enforced(admin: Optional[Admin]) -> bool:
    return bool(
        admin
        and admin.users_limit is not None
        and admin.users_limit > 0
    )


def _get_active_users_count(
    db: Session,
    admin: Admin,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> int:
    if not admin:
        return 0

    query = db.query(func.count(User.id)).filter(
        User.admin_id == admin.id,
        User.status == UserStatus.active,
    )
    if exclude_user_ids:
        exclude_ids = [uid for uid in exclude_user_ids if uid is not None]
        if exclude_ids:
            query = query.filter(~User.id.in_(exclude_ids))

    return query.scalar() or 0


def _ensure_active_user_capacity(
    db: Session,
    admin: Optional[Admin],
    *,
    required_slots: int = 1,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> None:
    if not _is_user_limit_enforced(admin) or required_slots <= 0:
        return

    active_count = _get_active_users_count(
        db,
        admin,
        exclude_user_ids=exclude_user_ids,
    )
    remaining_slots = (admin.users_limit or 0) - active_count
    if remaining_slots < required_slots:
        raise UsersLimitReachedError(limit=admin.users_limit)


def create_user(
    db: Session,
    user: UserCreate,
    admin: Admin = None,
    service: Optional[Service] = None,
) -> User:
    """
    Creates a new user with provided details.

    Args:
        db (Session): Database session.
        user (UserCreate): User creation details.
        admin (Admin, optional): Admin associated with the user.
        service (Service, optional): Service profile associated with the user.

    Returns:
        User: The created user object.
    """
    normalized_username = user.username.lower()
    existing_user = (
        db.query(User)
        .filter(func.lower(User.username) == normalized_username)
        .filter(User.status != UserStatus.deleted)
        .first()
    )
    if existing_user:
        raise IntegrityError(
            None,
            {"username": user.username},
            Exception("User username already exists"),
        )

    status_value = _status_to_str(user.status) or UserStatus.active.value
    resolved_status = UserStatus(status_value)
    if resolved_status == UserStatus.active and admin:
        _ensure_active_user_capacity(db, admin, required_slots=1)

    excluded_inbounds_tags = user.excluded_inbounds
    if user.credential_key:
        credential_key = normalize_key(user.credential_key)
    else:
        try:
            credential_key = _extract_key_from_proxies(user.proxies) or generate_key()
        except ValueError as exc:
            raise IntegrityError(None, {}, exc)

    proxies = []
    for proxy_key, settings in user.proxies.items():
        proxy_type = ProxyTypes(proxy_key)
        excluded_inbounds = [
            get_or_create_inbound(db, tag) for tag in excluded_inbounds_tags[proxy_type]
        ]
        serialized = serialize_proxy_settings(settings, proxy_type, credential_key)
        proxies.append(
            Proxy(type=proxy_type.value,
                  settings=serialized,
                  excluded_inbounds=excluded_inbounds)
        )

    dbuser = User(
        username=user.username,
        credential_key=credential_key,
        proxies=proxies,
        status=resolved_status,
        data_limit=(user.data_limit or None),
        expire=(user.expire or None),
        admin=admin,
        data_limit_reset_strategy=user.data_limit_reset_strategy,
        note=user.note,
        on_hold_expire_duration=(user.on_hold_expire_duration or None),
        on_hold_timeout=(user.on_hold_timeout or None),
        auto_delete_in_days=user.auto_delete_in_days,
        ip_limit=user.ip_limit,
        next_plan=NextPlan(
            data_limit=user.next_plan.data_limit,
            expire=user.next_plan.expire,
            add_remaining_traffic=user.next_plan.add_remaining_traffic,
            fire_on_either=user.next_plan.fire_on_either,
        ) if user.next_plan else None
    )
    if service:
        dbuser.service = service
    db.add(dbuser)
    db.flush()

    if service:
        allowed = _service_allowed_inbounds(service)
        _apply_service_to_user(db, dbuser, service, allowed)
        _ensure_admin_service_link(db, admin, service)

    db.commit()
    db.refresh(dbuser)
    return dbuser


def remove_user(db: Session, dbuser: User) -> User:
    """
    Removes a user from the database.

    Args:
        db (Session): Database session.
        dbuser (User): The user object to be removed.

    Returns:
        User: The removed user object.
    """
    if dbuser.status == UserStatus.deleted:
        return dbuser

    dbuser.status = UserStatus.deleted
    physically_deleted = False
    try:
        db.commit()
    except DataError as exc:
        db.rollback()
        if not _ensure_user_deleted_status(db):
            db.delete(dbuser)
            db.commit()
            physically_deleted = True
        else:
            dbuser.status = UserStatus.deleted
            db.add(dbuser)
            try:
                db.commit()
            except DataError:
                db.rollback()
                raise exc
    if not physically_deleted:
        db.refresh(dbuser)
    return dbuser


def remove_users(db: Session, dbusers: List[User]):
    """
    Removes multiple users from the database.

    Args:
        db (Session): Database session.
        dbusers (List[User]): List of user objects to be removed.
    """
    updated = False
    for dbuser in dbusers:
        if dbuser.status != UserStatus.deleted:
            dbuser.status = UserStatus.deleted
            updated = True
    if updated:
        try:
            db.commit()
        except DataError as exc:
            db.rollback()
            if not _ensure_user_deleted_status(db):
                for dbuser in dbusers:
                    db.delete(dbuser)
                db.commit()
            else:
                for dbuser in dbusers:
                    dbuser.status = UserStatus.deleted
                    db.add(dbuser)
                try:
                    db.commit()
                except DataError:
                    db.rollback()
                    raise exc
    return


def _delete_user_usage_rows(db: Session, user_ids: List[int]) -> None:
    if not user_ids:
        return
    db.query(NodeUserUsage).filter(NodeUserUsage.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(UserUsageResetLogs).filter(UserUsageResetLogs.user_id.in_(user_ids)).delete(synchronize_session=False)


def hard_delete_user(db: Session, dbuser: User) -> None:
    """
    Permanently remove a user and dependent usage records without soft-deleting.
    """
    if dbuser.id is not None:
        _delete_user_usage_rows(db, [dbuser.id])
    db.delete(dbuser)


def update_user(
    db: Session,
    dbuser: User,
    modify: UserModify,
    *,
    service: Optional[Service] = None,
    service_set: bool = False,
    admin: Optional[Admin] = None,
) -> User:
    """
    Updates a user with new details.

    Args:
        db (Session): Database session.
        dbuser (User): The user object to be updated.
        modify (UserModify): New details for the user.

    Returns:
        User: The updated user object.
    """
    original_status_value = _status_to_str(dbuser.status)
    credential_key = dbuser.credential_key
    added_proxies: Dict[ProxyTypes, Proxy] = {}

    if modify.proxies:
        try:
            new_key = _extract_key_from_proxies(modify.proxies)
        except ValueError as exc:
            raise ValueError(str(exc))
        if new_key:
            normalized_key = normalize_key(new_key)
            if credential_key != normalized_key:
                credential_key = normalized_key
                dbuser.credential_key = credential_key
                _apply_key_to_existing_proxies(dbuser, credential_key)

        modify_proxy_types = {ProxyTypes(key) for key in modify.proxies}

        for proxy_key, settings in modify.proxies.items():
            proxy_type = ProxyTypes(proxy_key)
            dbproxy = db.query(Proxy) \
                .where(Proxy.user == dbuser, Proxy.type == proxy_type) \
                .first()
            if dbproxy:
                # Preserve existing UUID if it exists in the database
                existing_uuid = dbproxy.settings.get("id") if isinstance(dbproxy.settings, dict) else None
                preserve_uuid = bool(existing_uuid and proxy_type in UUID_PROTOCOLS)
                dbproxy.settings = serialize_proxy_settings(settings, proxy_type, credential_key, preserve_existing_uuid=preserve_uuid)
            else:
                # New proxy for existing user - don't preserve UUID (will be generated at runtime from key)
                serialized = serialize_proxy_settings(settings, proxy_type, credential_key)
                new_proxy = Proxy(type=proxy_type.value, settings=serialized)
                dbuser.proxies.append(new_proxy)
                added_proxies.update({proxy_type: new_proxy})
        existing_types = {pt.value for pt in modify_proxy_types}
        for proxy in dbuser.proxies:
            if proxy.type not in modify.proxies and proxy.type not in existing_types:
                db.delete(proxy)
    if modify.inbounds:
        for proxy_type, tags in modify.excluded_inbounds.items():
            dbproxy = db.query(Proxy) \
                .where(Proxy.user == dbuser, Proxy.type == proxy_type) \
                .first() or added_proxies.get(proxy_type)
            if dbproxy:
                dbproxy.excluded_inbounds = [get_or_create_inbound(db, tag) for tag in tags]

    if modify.status is not None:
        dbuser.status = modify.status

    if modify.data_limit is not None:
        dbuser.data_limit = (modify.data_limit or None)
        if dbuser.status not in (UserStatus.expired, UserStatus.disabled):
            if not dbuser.data_limit or dbuser.used_traffic < dbuser.data_limit:
                if dbuser.status != UserStatus.on_hold:
                    dbuser.status = UserStatus.active

            else:
                dbuser.status = UserStatus.limited

    if modify.expire is not None:
        dbuser.expire = (modify.expire or None)
        if dbuser.status in (UserStatus.active, UserStatus.expired):
            if not dbuser.expire or dbuser.expire > datetime.utcnow().timestamp():
                dbuser.status = UserStatus.active
            else:
                dbuser.status = UserStatus.expired

    if modify.note is not None:
        dbuser.note = modify.note or None

    if modify.data_limit_reset_strategy is not None:
        dbuser.data_limit_reset_strategy = modify.data_limit_reset_strategy.value

    if "ip_limit" in modify.model_fields_set:
        dbuser.ip_limit = modify.ip_limit

    if modify.on_hold_timeout is not None:
        dbuser.on_hold_timeout = modify.on_hold_timeout

    if modify.on_hold_expire_duration is not None:
        dbuser.on_hold_expire_duration = modify.on_hold_expire_duration

    if modify.next_plan is not None:
        dbuser.next_plan = NextPlan(
            data_limit=modify.next_plan.data_limit,
            expire=modify.next_plan.expire,
            add_remaining_traffic=modify.next_plan.add_remaining_traffic,
            fire_on_either=modify.next_plan.fire_on_either,
        )
    elif dbuser.next_plan is not None:
        db.delete(dbuser.next_plan)

    if service_set:
        if service is None:
            dbuser.service = None
        else:
            allowed = _service_allowed_inbounds(service)
            dbuser.service = service
            _apply_service_to_user(db, dbuser, service, allowed)
            if admin:
                _ensure_admin_service_link(db, admin, service)

    current_status_value = _status_to_str(dbuser.status)
    if (
        current_status_value == UserStatus.active.value
        and original_status_value != UserStatus.active.value
    ):
        _ensure_active_user_capacity(
            db,
            dbuser.admin,
            exclude_user_ids=(dbuser.id,),
        )

    dbuser.edit_at = datetime.utcnow()

    db.commit()
    db.refresh(dbuser)
    return dbuser


def reset_user_data_usage(db: Session, dbuser: User) -> User:
    """
    Resets the data usage of a user and logs the reset.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose data usage is to be reset.

    Returns:
        User: The updated user object.
    """
    usage_log = UserUsageResetLogs(
        user=dbuser,
        used_traffic_at_reset=dbuser.used_traffic,
    )
    db.add(usage_log)

    dbuser.used_traffic = 0
    dbuser.node_usages.clear()
    current_status_value = _status_to_str(dbuser.status)
    should_activate = current_status_value not in (
        UserStatus.expired.value,
        UserStatus.disabled.value,
    )
    if should_activate:
        if current_status_value != UserStatus.active.value:
            _ensure_active_user_capacity(
                db,
                dbuser.admin,
                exclude_user_ids=(dbuser.id,),
            )
        dbuser.status = UserStatus.active.value

    if dbuser.next_plan:
        db.delete(dbuser.next_plan)
        dbuser.next_plan = None
    db.add(dbuser)

    db.commit()
    db.refresh(dbuser)
    return dbuser


def reset_user_by_next(db: Session, dbuser: User) -> User:
    """
    Resets the data usage of a user based on next user.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose data usage is to be reset.

    Returns:
        User: The updated user object.
    """

    if (dbuser.next_plan is None):
        return

    usage_log = UserUsageResetLogs(
        user=dbuser,
        used_traffic_at_reset=dbuser.used_traffic,
    )
    db.add(usage_log)

    dbuser.node_usages.clear()
    if _status_to_str(dbuser.status) != UserStatus.active.value:
        _ensure_active_user_capacity(
            db,
            dbuser.admin,
            exclude_user_ids=(dbuser.id,),
        )
    dbuser.status = UserStatus.active.value

    dbuser.data_limit = dbuser.next_plan.data_limit + \
        (0 if dbuser.next_plan.add_remaining_traffic else dbuser.data_limit - dbuser.used_traffic)
    dbuser.expire = dbuser.next_plan.expire

    dbuser.used_traffic = 0
    db.delete(dbuser.next_plan)
    dbuser.next_plan = None
    db.add(dbuser)

    db.commit()
    db.refresh(dbuser)
    return dbuser


def revoke_user_sub(db: Session, dbuser: User) -> User:
    """
    Revokes the subscription of a user and updates proxies settings.
    
    If user has UUID/password stored in proxies table (legacy method), removes them
    and assigns a new credential_key (migrates to new method).
    If user already has credential_key, generates a new one.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose subscription is to be revoked.

    Returns:
        User: The updated user object.
    """
    dbuser.sub_revoked_at = datetime.utcnow()

    # Check if user has UUID/password stored in proxies table (legacy method)
    has_legacy_credentials = False
    for proxy in dbuser.proxies:
        proxy_type = proxy.type
        if isinstance(proxy_type, str):
            proxy_type = ProxyTypes(proxy_type)
        settings = proxy.settings if isinstance(proxy.settings, dict) else {}
        
        # Check if UUID or password exists in settings
        if proxy_type in UUID_PROTOCOLS and settings.get("id"):
            has_legacy_credentials = True
            break
        elif proxy_type in PASSWORD_PROTOCOLS and settings.get("password"):
            has_legacy_credentials = True
            break

    # Generate new key (either first time or update existing)
    new_key = generate_key()
    dbuser.credential_key = new_key

    if has_legacy_credentials:
        # User has legacy credentials - remove UUID/password from proxies table
        # and migrate to key-based method
        for proxy in dbuser.proxies:
            proxy_type = proxy.type
            if isinstance(proxy_type, str):
                proxy_type = ProxyTypes(proxy_type)
            settings_obj = ProxySettings.from_dict(proxy_type, proxy.settings)
            
            # Remove UUID/password from settings (will be generated from key at runtime)
            if proxy_type in UUID_PROTOCOLS:
                settings_obj.id = None
            if proxy_type in PASSWORD_PROTOCOLS:
                settings_obj.password = None
            
            # Serialize without preserving existing UUID/password
            proxy.settings = serialize_proxy_settings(settings_obj, proxy_type, new_key, preserve_existing_uuid=False)
    else:
        # User already has key or no legacy credentials - just update key
        _apply_key_to_existing_proxies(dbuser, new_key)

    db.commit()
    db.refresh(dbuser)
    return dbuser


def update_user_sub(db: Session, dbuser: User, user_agent: str) -> User:
    """
    Updates the user's subscription details.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose subscription is to be updated.
        user_agent (str): The user agent string to update.

    Returns:
        User: The updated user object.
    """
    dbuser.sub_updated_at = datetime.utcnow()
    dbuser.sub_last_user_agent = user_agent

    db.commit()
    db.refresh(dbuser)
    return dbuser


def reset_all_users_data_usage(db: Session, admin: Optional[Admin] = None):
    """
    Resets the data usage for all users or users under a specific admin.

    Args:
        db (Session): Database session.
        admin (Optional[Admin]): Admin to filter users by, if any.
    """
    query = get_user_queryset(db)

    if admin:
        query = query.filter(User.admin == admin)

    for dbuser in query.all():
        dbuser.used_traffic = 0
        current_status_value = _status_to_str(dbuser.status)
        should_activate = current_status_value not in (
            UserStatus.on_hold.value,
            UserStatus.expired.value,
            UserStatus.disabled.value,
        )
        if should_activate:
            if current_status_value != UserStatus.active.value:
                _ensure_active_user_capacity(
                    db,
                    dbuser.admin,
                    exclude_user_ids=(dbuser.id,),
                )
            dbuser.status = UserStatus.active
        dbuser.usage_logs.clear()
        dbuser.node_usages.clear()
        if dbuser.next_plan:
            db.delete(dbuser.next_plan)
            dbuser.next_plan = None
        db.add(dbuser)

    db.commit()


def disable_all_active_users(db: Session, admin: Optional[Admin] = None):
    """
    Disable all active users or users under a specific admin.

    Args:
        db (Session): Database session.
        admin (Optional[Admin]): Admin to filter users by, if any.
    """
    query = db.query(User).filter(User.status.in_((UserStatus.active, UserStatus.on_hold)))
    if admin:
        query = query.filter(User.admin == admin)

    query.update({User.status: UserStatus.disabled, User.last_status_change: datetime.utcnow()}, synchronize_session=False)

    db.commit()


def activate_all_disabled_users(db: Session, admin: Optional[Admin] = None):
    """
    Activate all disabled users or users under a specific admin.

    Args:
        db (Session): Database session.
        admin (Optional[Admin]): Admin to filter users by, if any.
    """
    disabled_users_query = db.query(User).filter(User.status == UserStatus.disabled)
    on_hold_candidates_query = db.query(User).filter(
        and_(
            User.status == UserStatus.disabled,
            User.expire.is_(None),
            User.on_hold_expire_duration.isnot(None),
            User.online_at.is_(None),
        )
    )
    if admin:
        disabled_users_query = disabled_users_query.filter(User.admin == admin)
        on_hold_candidates_query = on_hold_candidates_query.filter(User.admin == admin)

    for user in on_hold_candidates_query.all():
        user.status = UserStatus.on_hold
        user.last_status_change = datetime.utcnow()

    # Refresh query to account for users moved to on-hold status
    disabled_users_query = db.query(User).filter(User.status == UserStatus.disabled)
    if admin:
        disabled_users_query = disabled_users_query.filter(User.admin == admin)

    for user in disabled_users_query.all():
        if _status_to_str(user.status) != UserStatus.active.value:
            _ensure_active_user_capacity(
                db,
                user.admin,
                exclude_user_ids=(user.id,),
            )
        user.status = UserStatus.active
        user.last_status_change = datetime.utcnow()

    db.commit()


def autodelete_expired_users(db: Session,
                             include_limited_users: bool = False) -> List[User]:
    """
    Deletes expired (optionally also limited) users whose auto-delete time has passed.

    Args:
        db (Session): Database session
        include_limited_users (bool, optional): Whether to delete limited users as well.
            Defaults to False.

    Returns:
        list[User]: List of deleted users.
    """
    target_status = (
        [UserStatus.expired] if not include_limited_users
        else [UserStatus.expired, UserStatus.limited]
    )

    auto_delete = coalesce(User.auto_delete_in_days, USERS_AUTODELETE_DAYS)

    query = db.query(
        User, auto_delete,  # Use global auto-delete days as fallback
    ).filter(
        auto_delete >= 0,  # Negative values prevent auto-deletion
        User.status.in_(target_status),
    ).options(joinedload(User.admin))

    # TODO: Handle time filter in query itself (NOTE: Be careful with sqlite's strange datetime handling)
    expired_users = [
        user
        for (user, auto_delete) in query
        if user.last_status_change + timedelta(days=auto_delete) <= datetime.utcnow()
    ]

    if expired_users:
        remove_users(db, expired_users)

    return expired_users


def get_all_users_usages(
        db: Session, admin: Admin, start: datetime, end: datetime
) -> List[UserUsageResponse]:
    """
    Retrieves usage data for all users associated with an admin within a specified time range.

    This function calculates the total traffic used by users across different nodes,
    including a "Master" node that represents the main core.

    Args:
        db (Session): Database session for querying.
        admin (Admin): The admin user for which to retrieve user usage data.
        start (datetime): The start date and time of the period to consider.
        end (datetime): The end date and time of the period to consider.

    Returns:
        List[UserUsageResponse]: A list of UserUsageResponse objects, each representing
        the usage data for a specific node or the main core.
    """
    usages = {0: UserUsageResponse(  # Main Core
        node_id=None,
        node_name="Master",
        used_traffic=0
    )}

    for node in db.query(Node).all():
        usages[node.id] = UserUsageResponse(
            node_id=node.id,
            node_name=node.name,
            used_traffic=0
        )

    admin_users = set(user.id for user in get_users(db=db, admins=admin))

    cond = and_(
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end,
        NodeUserUsage.user_id.in_(admin_users)
    )

    for v in db.query(NodeUserUsage).filter(cond):
        try:
            usages[v.node_id or 0].used_traffic += v.used_traffic
        except KeyError:
            pass

    return list(usages.values())


def update_user_status(db: Session, dbuser: User, status: UserStatus) -> User:
    """
    Updates a user's status and records the time of change.

    Args:
        db (Session): Database session.
        dbuser (User): The user to update.
        status (UserStatus): The new status.

    Returns:
        User: The updated user object.
    """
    dbuser.status = status
    dbuser.last_status_change = datetime.utcnow()
    db.commit()
    db.refresh(dbuser)
    return dbuser


def set_owner(db: Session, dbuser: User, admin: Admin) -> User:
    """
    Sets the owner (admin) of a user.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose owner is to be set.
        admin (Admin): The admin to set as owner.

    Returns:
        User: The updated user object.
    """
    dbuser.admin = admin
    db.commit()
    db.refresh(dbuser)
    return dbuser


def start_user_expire(db: Session, dbuser: User) -> User:
    """
    Starts the expiration timer for a user.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose expiration timer is to be started.

    Returns:
        User: The updated user object.
    """
    expire = int(datetime.utcnow().timestamp()) + dbuser.on_hold_expire_duration
    dbuser.expire = expire
    dbuser.on_hold_expire_duration = None
    dbuser.on_hold_timeout = None
    db.commit()
    db.refresh(dbuser)
    return dbuser


def get_system_usage(db: Session) -> System:
    """
    Retrieves system usage information.

    Args:
        db (Session): Database session.

    Returns:
        System: System usage information.
    """
    return db.query(System).first()


def get_jwt_secret_key(db: Session) -> str:
    """
    Retrieves the JWT secret key for admin authentication.
    This is a legacy function - use get_admin_secret_key() instead.

    Args:
        db (Session): Database session.

    Returns:
        str: Admin JWT secret key.
    """
    jwt_record = db.query(JWT).first()
    if jwt_record is None:
        import os
        jwt_record = JWT(
            subscription_secret_key=os.urandom(32).hex(),
            admin_secret_key=os.urandom(32).hex(),
            vmess_mask=os.urandom(16).hex(),
            vless_mask=os.urandom(16).hex(),
        )
        db.add(jwt_record)
        db.commit()
        db.refresh(jwt_record)
    
    if hasattr(jwt_record, 'admin_secret_key') and jwt_record.admin_secret_key:
        return jwt_record.admin_secret_key
    elif hasattr(jwt_record, 'secret_key') and jwt_record.secret_key:
        return jwt_record.secret_key
    else:
        import os
        if not hasattr(jwt_record, 'admin_secret_key'):
            jwt_record.admin_secret_key = os.urandom(32).hex()
            db.commit()
            db.refresh(jwt_record)
        return jwt_record.admin_secret_key


def get_subscription_secret_key(db: Session) -> str:
    """
    Retrieves the secret key for subscription tokens.

    Args:
        db (Session): Database session.

    Returns:
        str: Subscription secret key.
    """
    jwt_record = db.query(JWT).first()
    if jwt_record is None:
        import os
        jwt_record = JWT(
            subscription_secret_key=os.urandom(32).hex(),
            admin_secret_key=os.urandom(32).hex(),
            vmess_mask=os.urandom(16).hex(),
            vless_mask=os.urandom(16).hex(),
        )
        db.add(jwt_record)
        db.commit()
        db.refresh(jwt_record)
    return jwt_record.subscription_secret_key


def get_admin_secret_key(db: Session) -> str:
    """
    Retrieves the secret key for admin authentication tokens.

    Args:
        db (Session): Database session.

    Returns:
        str: Admin secret key.
    """
    jwt_record = db.query(JWT).first()
    if jwt_record is None:
        import os
        jwt_record = JWT(
            subscription_secret_key=os.urandom(32).hex(),
            admin_secret_key=os.urandom(32).hex(),
            vmess_mask=os.urandom(16).hex(),
            vless_mask=os.urandom(16).hex(),
        )
        db.add(jwt_record)
        db.commit()
        db.refresh(jwt_record)
    return jwt_record.admin_secret_key


def get_uuid_masks(db: Session) -> dict:
    """
    Retrieves the UUID masks for VMess and VLESS protocols.

    Args:
        db (Session): Database session.

    Returns:
        dict: Dictionary with 'vmess_mask' and 'vless_mask' keys, each containing a 32-character hex string.
    """
    import os
    from sqlalchemy import text

    jwt_record = db.query(JWT).first()
    if jwt_record is None:
        jwt_record = JWT(
            subscription_secret_key=os.urandom(32).hex(),
            admin_secret_key=os.urandom(32).hex(),
        )
        try:
            setattr(jwt_record, "vmess_mask", os.urandom(16).hex())
            setattr(jwt_record, "vless_mask", os.urandom(16).hex())
        except Exception:
            pass
        db.add(jwt_record)
        db.commit()
        try:
            db.refresh(jwt_record)
        except Exception:
            pass

    try:
        vm = getattr(jwt_record, "vmess_mask")
        vl = getattr(jwt_record, "vless_mask")
    except AttributeError:
        try:
            row = db.execute(text("SELECT vmess_mask, vless_mask FROM jwt LIMIT 1")).first()
            if row and row[0] and row[1]:
                return {"vmess_mask": row[0], "vless_mask": row[1]}
        except Exception:
            pass
        return {"vmess_mask": os.urandom(16).hex(), "vless_mask": os.urandom(16).hex()}

    updated = False
    if not vm:
        vm = os.urandom(16).hex()
        try:
            setattr(jwt_record, "vmess_mask", vm)
            updated = True
        except Exception:
            pass
    if not vl:
        vl = os.urandom(16).hex()
        try:
            setattr(jwt_record, "vless_mask", vl)
            updated = True
        except Exception:
            pass
    if updated:
        try:
            db.add(jwt_record)
            db.commit()
        except Exception:
            db.rollback()

    return {"vmess_mask": vm, "vless_mask": vl}


def get_tls_certificate(db: Session) -> TLS:
    """
    Retrieves the TLS certificate.

    Args:
        db (Session): Database session.

    Returns:
        TLS: TLS certificate information.
    """
    return db.query(TLS).first()


def get_admin(db: Session, username: str) -> Admin:
    """
    Retrieves an active admin by username (case-insensitive).

    Args:
        db (Session): Database session.
        username (str): The username of the admin.

    Returns:
        Admin: The admin object.
    """
    normalized = username.lower()
    return (
        db.query(Admin)
        .filter(func.lower(Admin.username) == normalized)
        .filter(Admin.status != AdminStatus.deleted)
        .first()
    )


def create_admin(db: Session, admin: AdminCreate) -> Admin:
    """
    Creates a new admin in the database.

    Args:
        db (Session): Database session.
        admin (AdminCreate): The admin creation data.

    Returns:
        Admin: The created admin object.
    """
    normalized_username = admin.username.lower()
    existing_admin = (
        db.query(Admin)
        .filter(func.lower(Admin.username) == normalized_username)
        .filter(Admin.status != AdminStatus.deleted)
        .first()
    )
    if existing_admin:
        raise IntegrityError(
            None,
            {"username": admin.username},
            Exception("Admin username already exists"),
        )

    dbadmin = Admin(
        username=admin.username,
        hashed_password=admin.hashed_password,
        is_sudo=admin.is_sudo,
        telegram_id=admin.telegram_id if admin.telegram_id else None,
        data_limit=admin.data_limit if admin.data_limit is not None else None,
        users_limit=admin.users_limit if admin.users_limit is not None else None,
        status=AdminStatus.active,
    )
    db.add(dbadmin)
    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def update_admin(db: Session, dbadmin: Admin, modified_admin: AdminModify) -> Admin:
    """
    Updates an admin's details.

    Args:
        db (Session): Database session.
        dbadmin (Admin): The admin object to be updated.
        modified_admin (AdminModify): The modified admin data.

    Returns:
        Admin: The updated admin object.
    """
    if modified_admin.is_sudo:
        dbadmin.is_sudo = modified_admin.is_sudo
    if modified_admin.password is not None and dbadmin.hashed_password != modified_admin.hashed_password:
        dbadmin.hashed_password = modified_admin.hashed_password
        dbadmin.password_reset_at = datetime.utcnow()
    if modified_admin.telegram_id:
        dbadmin.telegram_id = modified_admin.telegram_id
    if modified_admin.data_limit is not None:
        dbadmin.data_limit = modified_admin.data_limit
    if modified_admin.users_limit is not None:
        new_limit = modified_admin.users_limit
        if new_limit is not None and new_limit > 0:
            active_count = _get_active_users_count(db, dbadmin)
            if active_count > new_limit:
                raise UsersLimitReachedError(
                    limit=new_limit,
                    current_active=active_count,
                )
        dbadmin.users_limit = new_limit

    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def partial_update_admin(db: Session, dbadmin: Admin, modified_admin: AdminPartialModify) -> Admin:
    """
    Partially updates an admin's details.

    Args:
        db (Session): Database session.
        dbadmin (Admin): The admin object to be updated.
        modified_admin (AdminPartialModify): The modified admin data.

    Returns:
        Admin: The updated admin object.
    """
    if modified_admin.is_sudo is not None:
        dbadmin.is_sudo = modified_admin.is_sudo
    if modified_admin.password is not None and dbadmin.hashed_password != modified_admin.hashed_password:
        dbadmin.hashed_password = modified_admin.hashed_password
        dbadmin.password_reset_at = datetime.utcnow()
    if modified_admin.telegram_id is not None:
        dbadmin.telegram_id = modified_admin.telegram_id
    if modified_admin.data_limit is not None:
        dbadmin.data_limit = modified_admin.data_limit
    if modified_admin.users_limit is not None:
        new_limit = modified_admin.users_limit
        if new_limit is not None and new_limit > 0:
            active_count = _get_active_users_count(db, dbadmin)
            if active_count > new_limit:
                raise UsersLimitReachedError(
                    limit=new_limit,
                    current_active=active_count,
                )
        dbadmin.users_limit = new_limit

    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def remove_admin(db: Session, dbadmin: Admin) -> Admin:
    """
    Soft delete an admin, their users, and remove from services.
    This performs soft delete (sets status to deleted) rather than hard delete.
    """
    if dbadmin.id is None:
        raise ValueError("Admin must have a valid identifier before removal")

    # Soft delete all users belonging to this admin
    admin_users = db.query(User).filter(
        User.admin_id == dbadmin.id,
        User.status != UserStatus.deleted
    ).all()
    
    for dbuser in admin_users:
        dbuser.status = UserStatus.deleted
        # Remove user from Xray
        from app.reb_node import operations as core_operations
        try:
            core_operations.remove_user(dbuser=dbuser)
        except Exception:
            pass  # Ignore errors if user already removed

    # Remove admin from all services (unlink from services)
    db.query(AdminServiceLink).filter(AdminServiceLink.admin_id == dbadmin.id).delete(synchronize_session=False)

    # Soft delete the admin
    dbadmin.status = AdminStatus.deleted
    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def get_admin_by_id(db: Session, id: int) -> Admin:
    """
    Retrieves an admin by their ID.

    Args:
        db (Session): Database session.
        id (int): The ID of the admin.

    Returns:
        Admin: The admin object.
    """
    return (
        db.query(Admin)
        .filter(Admin.id == id)
        .filter(Admin.status != AdminStatus.deleted)
        .first()
    )


def get_admin_by_telegram_id(db: Session, telegram_id: int) -> Admin:
    """
    Retrieves an admin by their Telegram ID.

    Args:
        db (Session): Database session.
        telegram_id (int): The Telegram ID of the admin.

    Returns:
        Admin: The admin object.
    """
    return (
        db.query(Admin)
        .filter(Admin.telegram_id == telegram_id)
        .filter(Admin.status != AdminStatus.deleted)
        .first()
    )


def get_admins(db: Session,
               offset: Optional[int] = None,
               limit: Optional[int] = None,
               username: Optional[str] = None,
               sort: Optional[str] = None) -> Dict:
    """
    Retrieves a list of admins with optional filters and pagination.

    Args:
        db (Session): Database session.
        offset (Optional[int]): The number of records to skip (for pagination).
        limit (Optional[int]): The maximum number of records to return.
        username (Optional[str]): The username to filter by.
        sort (Optional[str]): Sort expression. Supports "username" and "users_usage"
                              with optional "-" prefix for descending order.

    Returns:
        Dict: A dictionary with 'admins' (list of admin objects) and 'total' (total count).
    """
    query = db.query(Admin).filter(Admin.status != AdminStatus.deleted)
    if username:
        query = query.filter(Admin.username.ilike(f'%{username}%'))

    # Get total count before pagination
    total = query.count()

    if sort:
        descending = sort.startswith('-')
        sort_key = sort[1:] if descending else sort
        sortable_columns = {
            "username": Admin.username,
            "users_usage": Admin.users_usage,
            "data_limit": Admin.data_limit,
            "created_at": Admin.created_at,
        }
        column = sortable_columns.get(sort_key)
        if column is not None:
            query = query.order_by(column.desc() if descending else column.asc())
    else:
        query = query.order_by(Admin.username.asc())

    if offset:
        query = query.offset(offset)
    if limit:
        query = query.limit(limit)

    admins = query.all()
    if not admins:
        return {"admins": admins, "total": total}

    admin_ids = [admin.id for admin in admins if admin.id is not None]
    if not admin_ids:
        return {"admins": admins, "total": total}

    counts_by_admin: Dict[int, Dict[str, int]] = {
        admin_id: {
            "active": 0,
            "limited": 0,
            "expired": 0,
        }
        for admin_id in admin_ids
    }

    status_counts = (
        db.query(User.admin_id, User.status, func.count(User.id))
        .filter(User.admin_id.in_(admin_ids))
        .filter(User.status != UserStatus.deleted)
        .group_by(User.admin_id, User.status)
        .all()
    )

    for admin_id, status, count in status_counts:
        if admin_id not in counts_by_admin:
            continue
        if status == UserStatus.active:
            counts_by_admin[admin_id]["active"] = count or 0
        elif status == UserStatus.limited:
            counts_by_admin[admin_id]["limited"] = count or 0
        elif status == UserStatus.expired:
            counts_by_admin[admin_id]["expired"] = count or 0

    online_threshold = datetime.utcnow() - timedelta(hours=24)
    online_counts = {
        admin_id: count
        for admin_id, count in (
            db.query(User.admin_id, func.count(User.id))
            .filter(
                User.admin_id.in_(admin_ids),
                User.status != UserStatus.deleted,
                User.online_at.isnot(None),
                User.online_at >= online_threshold,
            )
            .group_by(User.admin_id)
            .all()
        )
    }

    # Add users_count for each admin
    users_counts = {
        admin_id: count
        for admin_id, count in (
            db.query(User.admin_id, func.count(User.id))
            .filter(
                User.admin_id.in_(admin_ids),
                User.status != UserStatus.deleted,
            )
            .group_by(User.admin_id)
            .all()
        )
    }

    for admin in admins:
        admin_id = getattr(admin, "id", None)
        if admin_id is None:
            continue
        counts = counts_by_admin.get(admin_id, {})
        setattr(admin, "active_users", counts.get("active", 0))
        setattr(admin, "limited_users", counts.get("limited", 0))
        setattr(admin, "expired_users", counts.get("expired", 0))
        setattr(admin, "online_users", online_counts.get(admin_id, 0))
        setattr(admin, "users_count", users_counts.get(admin_id, 0))

    return {"admins": admins, "total": total}


def reset_admin_usage(db: Session, dbadmin: Admin) -> int:
    """
    Retrieves an admin's usage by their username.
    Args:
        db (Session): Database session.
        dbadmin (Admin): The admin object to be updated.
    Returns:
        Admin: The updated admin.
    """
    if (dbadmin.users_usage == 0):
        return dbadmin

    usage_log = AdminUsageLogs(
        admin=dbadmin,
        used_traffic_at_reset=dbadmin.users_usage
    )
    db.add(usage_log)
    dbadmin.users_usage = 0

    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def create_user_template(db: Session, user_template: UserTemplateCreate) -> UserTemplate:
    """
    Creates a new user template in the database.

    Args:
        db (Session): Database session.
        user_template (UserTemplateCreate): The user template creation data.

    Returns:
        UserTemplate: The created user template object.
    """
    inbound_tags: List[str] = []
    for _, i in user_template.inbounds.items():
        inbound_tags.extend(i)
    dbuser_template = UserTemplate(
        name=user_template.name,
        data_limit=user_template.data_limit,
        expire_duration=user_template.expire_duration,
        username_prefix=user_template.username_prefix,
        username_suffix=user_template.username_suffix,
        inbounds=db.query(ProxyInbound).filter(ProxyInbound.tag.in_(inbound_tags)).all()
    )
    db.add(dbuser_template)
    db.commit()
    db.refresh(dbuser_template)
    return dbuser_template


def update_user_template(
        db: Session, dbuser_template: UserTemplate, modified_user_template: UserTemplateModify) -> UserTemplate:
    """
    Updates a user template's details.

    Args:
        db (Session): Database session.
        dbuser_template (UserTemplate): The user template object to be updated.
        modified_user_template (UserTemplateModify): The modified user template data.

    Returns:
        UserTemplate: The updated user template object.
    """
    if modified_user_template.name is not None:
        dbuser_template.name = modified_user_template.name
    if modified_user_template.data_limit is not None:
        dbuser_template.data_limit = modified_user_template.data_limit
    if modified_user_template.expire_duration is not None:
        dbuser_template.expire_duration = modified_user_template.expire_duration
    if modified_user_template.username_prefix is not None:
        dbuser_template.username_prefix = modified_user_template.username_prefix
    if modified_user_template.username_suffix is not None:
        dbuser_template.username_suffix = modified_user_template.username_suffix

    if modified_user_template.inbounds:
        inbound_tags: List[str] = []
        for _, i in modified_user_template.inbounds.items():
            inbound_tags.extend(i)
        dbuser_template.inbounds = db.query(ProxyInbound).filter(ProxyInbound.tag.in_(inbound_tags)).all()

    db.commit()
    db.refresh(dbuser_template)
    return dbuser_template


def remove_user_template(db: Session, dbuser_template: UserTemplate):
    """
    Removes a user template from the database.

    Args:
        db (Session): Database session.
        dbuser_template (UserTemplate): The user template object to be removed.
    """
    db.delete(dbuser_template)
    db.commit()


def get_user_template(db: Session, user_template_id: int) -> UserTemplate:
    """
    Retrieves a user template by its ID.

    Args:
        db (Session): Database session.
        user_template_id (int): The ID of the user template.

    Returns:
        UserTemplate: The user template object.
    """
    return db.query(UserTemplate).filter(UserTemplate.id == user_template_id).first()


def get_user_templates(
        db: Session, offset: Union[int, None] = None, limit: Union[int, None] = None) -> List[UserTemplate]:
    """
    Retrieves a list of user templates with optional pagination.

    Args:
        db (Session): Database session.
        offset (Union[int, None]): The number of records to skip (for pagination).
        limit (Union[int, None]): The maximum number of records to return.

    Returns:
        List[UserTemplate]: A list of user template objects.
    """
    dbuser_templates = db.query(UserTemplate)
    if offset:
        dbuser_templates = dbuser_templates.offset(offset)
    if limit:
        dbuser_templates = dbuser_templates.limit(limit)

    return dbuser_templates.all()


def get_node(db: Session, name: str) -> Optional[Node]:
    """
    Retrieves a node by its name.

    Args:
        db (Session): The database session.
        name (str): The name of the node to retrieve.

    Returns:
        Optional[Node]: The Node object if found, None otherwise.
    """
    return db.query(Node).filter(Node.name == name).first()


def get_node_by_id(db: Session, node_id: int) -> Optional[Node]:
    """
    Retrieves a node by its ID.

    Args:
        db (Session): The database session.
        node_id (int): The ID of the node to retrieve.

    Returns:
        Optional[Node]: The Node object if found, None otherwise.
    """
    return db.query(Node).filter(Node.id == node_id).first()


def _ensure_master_state(db: Session, *, for_update: bool = False) -> MasterNodeState:
    """Retrieve or create the singleton master node state entry."""
    query = db.query(MasterNodeState)
    if for_update:
        query = query.with_for_update()

    state = query.first()
    if state:
        return state

    state = MasterNodeState(status=NodeStatus.connected)
    db.add(state)
    db.flush()
    db.refresh(state)
    return state


def get_master_node_state(db: Session) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=False)
    db.refresh(master_state)
    return master_state


def set_master_data_limit(db: Session, data_limit: Optional[int]) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=True)
    normalized_limit = data_limit or None
    master_state.data_limit = normalized_limit

    total_usage = (master_state.uplink or 0) + (master_state.downlink or 0)
    limited = normalized_limit is not None and total_usage >= normalized_limit

    if limited:
        if master_state.status != NodeStatus.limited:
            master_state.status = NodeStatus.limited
            master_state.message = "Data limit reached"
    else:
        if master_state.status == NodeStatus.limited:
            master_state.status = NodeStatus.connected
            master_state.message = None

    master_state.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(master_state)
    return master_state


def reset_master_usage(db: Session) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=True)

    db.query(NodeUsage).filter(
        or_(NodeUsage.node_id.is_(None), NodeUsage.node_id == master_state.id)
    ).delete(synchronize_session=False)
    db.query(NodeUserUsage).filter(
        or_(NodeUserUsage.node_id.is_(None), NodeUserUsage.node_id == master_state.id)
    ).delete(synchronize_session=False)

    master_state.uplink = 0
    master_state.downlink = 0
    master_state.status = NodeStatus.connected
    master_state.message = None
    master_state.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(master_state)
    return master_state


def get_nodes(db: Session,
              status: Optional[Union[NodeStatus, list]] = None,
              enabled: bool = None,
              include_master: bool = False) -> List[Node]:
    """
    Retrieves nodes based on optional status and enabled filters.

    Args:
        db (Session): The database session.
        status (Optional[Union[NodeStatus, list]]): The status or list of statuses to filter by.
        enabled (bool): If True, excludes disabled nodes.

    Returns:
        List[Node]: A list of Node objects matching the criteria.
    """
    query = db.query(Node)

    if status:
        if isinstance(status, list):
            query = query.filter(Node.status.in_(status))
        else:
            query = query.filter(Node.status == status)

    if enabled:
        query = query.filter(Node.status.notin_([NodeStatus.disabled, NodeStatus.limited]))

    return query.all()


def get_nodes_usage(db: Session, start: datetime, end: datetime) -> List[NodeUsageResponse]:
    """
    Retrieves usage data for all nodes within a specified time range.

    Args:
        db (Session): The database session.
        start (datetime): The start time of the usage period.
        end (datetime): The end time of the usage period.

    Returns:
        List[NodeUsageResponse]: A list of NodeUsageResponse objects containing usage data.
    """
    _ensure_master_state(db, for_update=False)

    usages: Dict[Optional[int], NodeUsageResponse] = {
        None: NodeUsageResponse(
            node_id=None,
            node_name=MASTER_NODE_NAME,
            uplink=0,
            downlink=0,
        )
    }

    for node in db.query(Node).all():
        usages[node.id] = NodeUsageResponse(
            node_id=node.id,
            node_name=node.name,
            uplink=0,
            downlink=0,
        )

    cond = and_(NodeUsage.created_at >= start, NodeUsage.created_at <= end)

    for entry in db.query(NodeUsage).filter(cond):
        target_id = entry.node_id
        if target_id not in usages:
            usages[target_id] = NodeUsageResponse(
                node_id=target_id,
                node_name=MASTER_NODE_NAME if target_id is None else f"Node {target_id}",
                uplink=0,
                downlink=0,
            )
        usages[target_id].uplink += entry.uplink
        usages[target_id].downlink += entry.downlink

    return list(usages.values())


def create_node(db: Session, node: NodeCreate) -> Node:
    """
    Creates a new node in the database.

    Args:
        db (Session): The database session.
        node (NodeCreate): The node creation model containing node details.

    Returns:
        Node: The newly created Node object.
    """
    dbnode = Node(
        name=node.name,
        address=node.address,
        port=node.port,
        api_port=node.api_port,
        usage_coefficient=node.usage_coefficient if getattr(node, "usage_coefficient", None) else 1,
        data_limit=node.data_limit if getattr(node, "data_limit", None) is not None else None,
        geo_mode=node.geo_mode,
        use_nobetci=bool(getattr(node, "use_nobetci", False)),
        nobetci_port=getattr(node, "nobetci_port", None) or None,
    )

    db.add(dbnode)
    db.commit()
    db.refresh(dbnode)
    return dbnode


def remove_node(db: Session, dbnode: Node) -> Node:
    """
    Removes a node from the database.

    Args:
        db (Session): The database session.
        dbnode (Node): The Node object to be removed.

    Returns:
        Node: The removed Node object.
    """
    db.query(NodeUsage).filter(NodeUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.query(NodeUserUsage).filter(NodeUserUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.delete(dbnode)
    db.commit()
    return dbnode


def update_node(db: Session, dbnode: Node, modify: NodeModify) -> Node:
    """
    Updates an existing node with new information.

    Args:
        db (Session): The database session.
        dbnode (Node): The Node object to be updated.
        modify (NodeModify): The modification model containing updated node details.

    Returns:
        Node: The updated Node object.
    """
    if modify.name is not None:
        dbnode.name = modify.name

    if modify.address is not None:
        dbnode.address = modify.address

    if modify.port is not None:
        dbnode.port = modify.port

    if modify.api_port is not None:
        dbnode.api_port = modify.api_port

    if modify.status is not None:
        if modify.status is NodeStatus.disabled:
            dbnode.status = modify.status
            dbnode.xray_version = None
            dbnode.message = None
        elif modify.status is NodeStatus.limited:
            dbnode.status = NodeStatus.limited
            dbnode.message = "Data limit reached"
        else:
            dbnode.status = NodeStatus.connecting
    else:
        if dbnode.status not in {NodeStatus.disabled, NodeStatus.limited}:
            dbnode.status = NodeStatus.connecting

    if modify.usage_coefficient is not None:
        dbnode.usage_coefficient = modify.usage_coefficient

    data_limit_updated = False
    if modify.data_limit is not None:
        dbnode.data_limit = modify.data_limit
        data_limit_updated = True

    if getattr(modify, "use_nobetci", None) is not None:
        dbnode.use_nobetci = bool(modify.use_nobetci)
        if not dbnode.use_nobetci:
            dbnode.nobetci_port = None

    if getattr(modify, "nobetci_port", None) is not None:
        dbnode.nobetci_port = modify.nobetci_port or None
        if dbnode.nobetci_port and not dbnode.use_nobetci:
            dbnode.use_nobetci = True

    if data_limit_updated:
        usage_total = (dbnode.uplink or 0) + (dbnode.downlink or 0)
        if dbnode.data_limit is None or usage_total < dbnode.data_limit:
            if modify.status is None and dbnode.status == NodeStatus.limited:
                dbnode.status = NodeStatus.connecting
                dbnode.message = None


    db.commit()
    db.refresh(dbnode)
    return dbnode


def update_node_status(db: Session, dbnode: Node, status: NodeStatus, message: str = None, version: str = None) -> Node:
    """
    Updates the status of a node.

    Args:
        db (Session): The database session.
        dbnode (Node): The Node object to be updated.
        status (NodeStatus): The new status of the node.
        message (str, optional): A message associated with the status update.
        version (str, optional): The version of the node software.

    Returns:
        Node: The updated Node object.
    """
    dbnode.status = status
    dbnode.message = message
    dbnode.xray_version = version
    dbnode.last_status_change = datetime.utcnow()
    db.commit()
    db.refresh(dbnode)
    return dbnode


def reset_node_usage(db: Session, dbnode: Node) -> Node:
    """
    Resets the stored data usage metrics for a node.

    Args:
        db (Session): The database session.
        dbnode (Node): The node whose usage should be reset.

    Returns:
        Node: The updated node object.
    """
    db.query(NodeUsage).filter(NodeUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.query(NodeUserUsage).filter(NodeUserUsage.node_id == dbnode.id).delete(synchronize_session=False)

    dbnode.uplink = 0
    dbnode.downlink = 0
    dbnode.status = NodeStatus.connected
    dbnode.message = None
    db.commit()
    db.refresh(dbnode)
    return dbnode


def count_online_users(db: Session, hours: int = 24):
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=hours)
    query = db.query(func.count(User.id)).filter(User.online_at.isnot(
        None), User.online_at >= twenty_four_hours_ago)
    return query.scalar()


def get_admin_usages(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[UserUsageResponse]:
    """
    Retrieves total usage for all users under a specific admin within a date range.
    Returns data grouped by node.
    """
    usages = {0: UserUsageResponse(  # Main Core
        node_id=None,
        node_name="Master",
        used_traffic=0
    )}

    # Create usage objects for each node
    for node in db.query(Node).all():
        usages[node.id] = UserUsageResponse(
            node_id=node.id,
            node_name=node.name,
            used_traffic=0
        )

    # Get all user IDs owned by this admin
    user_ids = [
        u.id
        for u in db.query(User.id)
        .filter(User.admin_id == dbadmin.id)
        .filter(User.status != UserStatus.deleted)
    ]

    if not user_ids:
        return list(usages.values())

    cond = and_(
        NodeUserUsage.user_id.in_(user_ids),
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end
    )

    for v in db.query(NodeUserUsage).filter(cond):
        try:
            usages[v.node_id or 0].used_traffic += v.used_traffic
        except KeyError:
            pass

    return list(usages.values())


def get_admin_daily_usages(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[dict]:
    """
    Retrieves daily usage for all users under a specific admin, aggregated over all nodes.
    Returns a list of dictionaries with date and total used_traffic.
    """
    # Initialize result list
    usages = []

    # Get all user IDs owned by this admin
    user_ids = [
        u.id
        for u in db.query(User.id)
        .filter(User.admin_id == dbadmin.id)
        .filter(User.status != UserStatus.deleted)
    ]
    if not user_ids:
        return usages

    # Initialize usage dictionary for all dates
    usage_by_date = {}
    current_date = start
    while current_date <= end:
        date_str = current_date.strftime("%Y-%m-%d")
        usage_by_date[date_str] = {
            "date": date_str,
            "used_traffic": 0
        }
        current_date += timedelta(days=1)

    # Query usage data
    cond = and_(
        NodeUserUsage.user_id.in_(user_ids),
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end
    )

    for v in db.query(NodeUserUsage).filter(cond):
        date_str = v.created_at.strftime("%Y-%m-%d")
        try:
            usage_by_date[date_str]["used_traffic"] += v.used_traffic
        except KeyError:
            pass

    # Convert to list and filter out zero-traffic entries
    usages = [entry for entry in usage_by_date.values() if entry["used_traffic"] > 0]

    return sorted(usages, key=lambda x: x["date"])


def get_admin_usages_by_day(
    db: Session,
    dbadmin: Admin,
    start: datetime,
    end: datetime,
    node_id: Optional[int] = None,
    granularity: str = "day",
) -> List[dict]:
    """
    Retrieves usage for all users under a specific admin, optionally filtered by node_id.
    Supports daily (default) or hourly granularity.
    """
    user_ids = [
        u.id
        for u in db.query(User.id)
        .filter(User.admin_id == dbadmin.id)
        .filter(User.status != UserStatus.deleted)
    ]
    if not user_ids:
        return []

    granularity = (granularity or "day").lower()
    if granularity not in {"day", "hour"}:
        granularity = "day"

    align_unit = "hour" if granularity == "hour" else "day"
    step = timedelta(hours=1) if granularity == "hour" else timedelta(days=1)
    fmt = "%Y-%m-%d %H:00" if granularity == "hour" else "%Y-%m-%d"

    node_lookup: dict[int, str] = {node.id: node.name for node in db.query(Node).all()}
    node_lookup[0] = "Master"

    def resolve_node_name(n_id: int) -> str:
        return node_lookup.get(n_id, "Unknown")

    if node_id is not None:
        node_keys: List[int] = [node_id]
    else:
        node_keys = sorted(node_lookup.keys())

    if granularity == "hour":
        current = start.replace(minute=0, second=0, microsecond=0)
        end_aligned = end.replace(minute=0, second=0, microsecond=0)
    else:
        current = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end_aligned = end.replace(hour=0, minute=0, second=0, microsecond=0)

    if current > end_aligned:
        return []

    usage_by_node_and_date: Dict[tuple[int, str], dict] = {}
    while current <= end_aligned:
        label = current.strftime(fmt)
        for n_key in node_keys:
            usage_by_node_and_date[(n_key, label)] = {
                "node_id": None if n_key in (0, None) else n_key,
                "node_name": resolve_node_name(n_key if n_key is not None else 0),
                "date": label,
                "used_traffic": 0,
            }
        current += step

    cond = and_(
        NodeUserUsage.user_id.in_(user_ids),
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end,
    )
    if node_id is not None:
        if node_id == 0:
            cond = and_(cond, NodeUserUsage.node_id.is_(None))
        else:
            cond = and_(cond, NodeUserUsage.node_id == node_id)

    for usage in db.query(NodeUserUsage).filter(cond):
        bucket_time = usage.created_at
        if granularity == "hour":
            bucket_time = bucket_time.replace(minute=0, second=0, microsecond=0)
        else:
            bucket_time = bucket_time.replace(hour=0, minute=0, second=0, microsecond=0)
        label = bucket_time.strftime(fmt)
        node_key = usage.node_id or 0
        key = (node_key, label)
        if key in usage_by_node_and_date:
            usage_by_node_and_date[key]["used_traffic"] += usage.used_traffic

    if node_id is not None:
        return [
            {"date": entry["date"], "used_traffic": entry["used_traffic"]}
            for entry in sorted(usage_by_node_and_date.values(), key=lambda x: x["date"])
        ]

    return [
        entry
        for _, entry in sorted(
            usage_by_node_and_date.items(), key=lambda item: (item[0][1], item[0][0] or 0)
        )
        if entry["used_traffic"] > 0
    ]


def get_node_usage_by_day(
    db: Session,
    node_id: int,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[dict]:
    """
    Retrieves usage for a specific node from NodeUserUsage.
    Granularity can be "day" (default) or "hour".
    """
    granularity = (granularity or "day").lower()
    if granularity not in {"day", "hour"}:
        granularity = "day"

    if granularity == "hour":
        current = start.replace(minute=0, second=0, microsecond=0)
        end_aligned = end.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
        fmt = "%Y-%m-%d %H:00"
    else:
        current = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end_aligned = end.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)
        fmt = "%Y-%m-%d"

    if current > end_aligned:
        return []

    usage_by_date: Dict[str, Dict[str, Union[str, int]]] = {}
    while current <= end_aligned:
        label = current.strftime(fmt)
        usage_by_date[label] = {"date": label, "used_traffic": 0}
        current += step

    cond = and_(
        (NodeUserUsage.node_id == node_id) if node_id != 0 else NodeUserUsage.node_id.is_(None),
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end,
    )

    for usage in db.query(NodeUserUsage).filter(cond):
        bucket_time = usage.created_at
        if granularity == "hour":
            bucket_time = bucket_time.replace(minute=0, second=0, microsecond=0)
        else:
            bucket_time = bucket_time.replace(hour=0, minute=0, second=0, microsecond=0)
        label = bucket_time.strftime(fmt)
        if label in usage_by_date:
            usage_by_date[label]["used_traffic"] += usage.used_traffic

    return list(usage_by_date.values())


def get_admin_usage_by_nodes(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[dict]:
    """
    Retrieves uplink and downlink usage for all users under a specific admin within a date range,
    grouped by node. Returns a list of dictionaries with node_id, node_name, uplink, and downlink.
    """
    usages = []

    # Initialize usage dictionary for all nodes
    usage_by_node = {0: {"node_id": None, "node_name": "Master", "uplink": 0, "downlink": 0}}
    for node in db.query(Node).all():
        usage_by_node[node.id] = {
            "node_id": node.id,
            "node_name": node.name,
            "uplink": 0,
            "downlink": 0
        }

    # Get all user IDs owned by this admin
    user_ids = [
        u.id
        for u in db.query(User.id)
        .filter(User.admin_id == dbadmin.id)
        .filter(User.status != UserStatus.deleted)
    ]
    if not user_ids:
        return list(usage_by_node.values())

    # Query usage data
    cond = and_(
        NodeUserUsage.user_id.in_(user_ids),
        NodeUserUsage.created_at >= start,
        NodeUserUsage.created_at <= end
    )

    for usage in db.query(NodeUserUsage).filter(cond):
        node_id = usage.node_id or 0
        traffic = usage.used_traffic or 0
        try:
            usage_by_node[node_id]["downlink"] += traffic
        except KeyError:
            pass

    # Convert to list and filter out nodes with zero traffic
    usages = [entry for entry in usage_by_node.values() if entry["uplink"] > 0 or entry["downlink"] > 0]

    return sorted(usages, key=lambda x: x["node_id"] or 0)
