"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple, Union, Literal

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from app.db.models import (
    Admin,
    AdminServiceLink,
    NodeUserUsage,
    Proxy,
    ProxyTypes,
    Service,
    ServiceHostLink,
    User,
)
from app.models.admin import AdminRole, AdminStatus
from app.utils.credentials import (
    serialize_proxy_settings,
)
from app.models.proxy import ProxySettings
from xray_api.types.account import XTLSFlows
from app.models.service import ServiceCreate, ServiceHostAssignment, ServiceModify
from app.models.user import (
    UserStatus,
)

# Imported inside functions to avoid circular import
# from .usage import _get_usage_data, _get_usage_timeseries
# from .user import get_user_queryset, _apply_service_filter
# MasterSettingsService not available in current project structure
from .proxy import get_or_create_inbound, _fetch_hosts_by_ids

MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


class ServiceRepository:
    def __init__(self, db: Session):
        self.db = db

    def assign_hosts(self, service: Service, assignments: Iterable[ServiceHostAssignment]) -> None:
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
            self.db.query(Admin).filter(Admin.id.in_(desired_id_set)).filter(Admin.status != AdminStatus.deleted).all()
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

        link_exists = (
            self.db.query(AdminServiceLink)
            .filter(
                AdminServiceLink.admin_id == admin.id,
                AdminServiceLink.service_id == service.id,
            )
            .first()
        )
        if link_exists:
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
                settings_model = proxy_type.settings_model()
                if hasattr(settings_model, "flow"):
                    settings_model.flow = XTLSFlows.NONE
                serialized = serialize_proxy_settings(settings_model, proxy_type, dbuser.credential_key)
                proxy = Proxy(type=proxy_type.value, settings=serialized)
                dbuser.proxies.append(proxy)
            else:
                if hasattr(proxy_type.settings_model, "model_validate"):
                    settings_obj = proxy_type.settings_model.model_validate(proxy.settings or {})
                else:
                    settings_obj = proxy.settings or {}
                if isinstance(settings_obj, ProxySettings):
                    if hasattr(settings_obj, "flow"):
                        settings_obj.flow = XTLSFlows.NONE
                    proxy.settings = serialize_proxy_settings(
                        settings_obj,
                        proxy_type,
                        dbuser.credential_key,
                        preserve_existing_uuid=True,
                    )

            available_tags = {inbound["tag"] for inbound in xray.config.inbounds_by_protocol.get(proxy_type, [])}
            excluded_tags = sorted(available_tags - set(allowed_tags))
            proxy.excluded_inbounds = [get_or_create_inbound(self.db, tag) for tag in excluded_tags]

        dbuser.service = service
        dbuser.edit_at = datetime.now(timezone.utc)

    def refresh_users(
        self, service: Service, allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None
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
        if admin and admin.role not in (AdminRole.sudo, AdminRole.full_access):
            query = query.join(Service.admin_links).filter(AdminServiceLink.admin_id == admin.id)
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
                    self.db.query(ServiceHostLink.service_id, func.count(ServiceHostLink.host_id))
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

        # Update Redis cache
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import cache_service, invalidate_service_cache, invalidate_service_host_map_cache

                cache_service(service)
                invalidate_service_cache()  # Invalidate services list
                invalidate_service_host_map_cache()  # Invalidate host maps
            except Exception:
                pass  # Don't fail if Redis is unavailable

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

        # Update Redis cache
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import cache_service, invalidate_service_cache, invalidate_service_host_map_cache

                cache_service(service)
                invalidate_service_cache()  # Invalidate services list
                invalidate_service_host_map_cache()  # Invalidate host maps
            except Exception:
                pass  # Don't fail if Redis is unavailable

        return service, allowed_before, allowed_after

    def remove(
        self,
        service: Service,
        *,
        mode: Literal["delete_users", "transfer_users"] = "transfer_users",
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
                if target_service and target_service.id == service.id:
                    raise ValueError("A different target service is required for transferring users")
                for user in service_users:
                    user.service_id = target_service.id if target_service else None
                    transferred_users.append(user)
            elif mode == "delete_users":
                deleted_users.extend(service_users)
                for user in service_users:
                    self.db.delete(user)
            else:
                raise ValueError("Invalid delete mode")

        service_id = service.id
        self.db.delete(service)
        self.db.commit()

        # Update Redis cache
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import invalidate_service_cache, invalidate_service_host_map_cache

                invalidate_service_cache(service_id=service_id)
                invalidate_service_cache()  # Invalidate services list
                invalidate_service_host_map_cache()  # Invalidate host maps
            except Exception:
                pass  # Don't fail if Redis is unavailable

        return deleted_users, transferred_users

    def reset_usage(self, service: Service) -> Service:
        service.used_traffic = 0
        service.updated_at = datetime.now(timezone.utc)

        for link in service.admin_links:
            link.used_traffic = 0
            link.updated_at = datetime.now(timezone.utc)

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
        from .usage import _get_usage_data

        return _get_usage_data(
            db=self.db,
            entity_type="service",
            service=service,
            start=start,
            end=end,
            granularity=granularity,
            format="timeseries",
        )

    def admin_usage_timeseries(
        self,
        service: Service,
        admin_id: Optional[int],
        start: datetime,
        end: datetime,
        granularity: str = "day",
    ) -> List[Dict[str, Union[datetime, int]]]:
        query = (
            self.db.query(NodeUserUsage)
            .join(User, User.id == NodeUserUsage.user_id)
            .filter(
                User.service_id == service.id,
                NodeUserUsage.created_at >= start,
                NodeUserUsage.created_at <= end,
            )
        )
        if admin_id is None:
            query = query.filter(User.admin_id.is_(None))
        else:
            query = query.filter(User.admin_id == admin_id)

        start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
        end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
        tzinfo = start_aware.tzinfo or timezone.utc

        from .usage import _get_usage_timeseries

        return _get_usage_timeseries(query, start_aware, end_aware, tzinfo, granularity, {}, False)

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


def _apply_service_to_user(
    db: Session,
    dbuser: User,
    service: Service,
    allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
) -> None:
    ServiceRepository(db).apply_service_to_user(dbuser, service, allowed_inbounds)


def count_users(
    db: Session,
    admin: Optional[Admin] = None,
    service_id: Optional[int] = None,
    service_without_assignment: bool = False,
) -> int:
    """Return a lightweight count of users respecting admin/service filters."""
    from .user import get_user_queryset, _apply_service_filter

    query = get_user_queryset(db, eager_load=False)
    if admin:
        query = query.filter(User.admin == admin)
    query = _apply_service_filter(
        query,
        service_id=service_id,
        service_without_assignment=service_without_assignment,
    )
    return query.count()


def count_online_users(db: Session, hours: int = 24, admin: Admin | None = None):
    twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = db.query(func.count(User.id)).filter(
        User.online_at.isnot(None),
        User.online_at >= twenty_four_hours_ago,
    )
    if admin and admin.id is not None:
        query = query.filter(User.admin_id == admin.id)
    return query.scalar() or 0
