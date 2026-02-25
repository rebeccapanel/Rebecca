import os
from datetime import datetime, UTC

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Text,
    String,
    Table,
    UniqueConstraint,
    func,
)
from sqlalchemy.ext.associationproxy import association_proxy
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship
from sqlalchemy.sql.expression import select, text

from app.db.base import Base
from app.models.admin import AdminRole, AdminStatus
from app.models.node import NodeStatus, GeoMode
from app.models.proxy import (
    ProxyHostALPN,
    ProxyHostFingerprint,
    ProxyHostSecurity,
    ProxyTypes,
)
from app.models.user import UserDataLimitResetStrategy, UserStatus


def utcnow():
    """Return naive UTC time using the non-deprecated API."""
    return datetime.now(UTC).replace(tzinfo=None)


class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True)
    username = Column(String(34), index=True)
    hashed_password = Column(String(128))
    users = relationship("User", back_populates="admin")
    service_links = relationship(
        "AdminServiceLink",
        back_populates="admin",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    services = association_proxy("service_links", "service")
    created_at = Column(DateTime, default=utcnow)
    role = Column(Enum(AdminRole), nullable=False, default=AdminRole.standard)
    permissions = Column(JSON, nullable=True, default=dict)
    password_reset_at = Column(DateTime, nullable=True)
    telegram_id = Column(BigInteger, nullable=True, default=None)
    subscription_domain = Column(String(255), nullable=True, default=None)
    subscription_settings = Column(JSON, nullable=True, default=dict)
    users_usage = Column(BigInteger, nullable=False, default=0)
    lifetime_usage = Column(BigInteger, nullable=False, default=0)
    data_limit = Column(BigInteger, nullable=True, default=None)
    expire = Column(Integer, nullable=True, default=None)
    users_limit = Column(Integer, nullable=True, default=None)
    status = Column(Enum(AdminStatus), nullable=False, default=AdminStatus.active, index=True)
    disabled_reason = Column(String(512), nullable=True, default=None)
    usage_logs = relationship("AdminUsageLogs", back_populates="admin")
    api_keys = relationship(
        "AdminApiKey",
        back_populates="admin",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    subscription_domains = relationship(
        "SubscriptionDomain",
        back_populates="admin",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class AdminUsageLogs(Base):
    __tablename__ = "admin_usage_logs"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, ForeignKey("admins.id"))
    admin = relationship("Admin", back_populates="usage_logs")
    used_traffic_at_reset = Column(BigInteger, nullable=False)
    reset_at = Column(DateTime, default=utcnow)


class AdminApiKey(Base):
    __tablename__ = "admin_api_keys"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=False, index=True)
    key_hash = Column(String(128), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)

    admin = relationship("Admin", back_populates="api_keys")


class TelegramSettings(Base):
    __tablename__ = "telegram_settings"

    id = Column(Integer, primary_key=True)
    api_token = Column(String(512), nullable=True)
    use_telegram = Column(Boolean, nullable=False, default=True, server_default=text("1"))
    proxy_url = Column(String(512), nullable=True)
    admin_chat_ids = Column(JSON, nullable=False, default=list)
    logs_chat_id = Column(BigInteger, nullable=True)
    logs_chat_is_forum = Column(Boolean, nullable=False, default=False)
    default_vless_flow = Column(String(255), nullable=True)
    forum_topics = Column(JSON, nullable=False, default=dict)
    event_toggles = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class PanelSettings(Base):
    __tablename__ = "panel_settings"

    id = Column(Integer, primary_key=True)
    use_nobetci = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    default_subscription_type = Column(
        String(32),
        nullable=False,
        default="key",
        server_default=text("'key'"),
    )
    access_insights_enabled = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class SubscriptionSettings(Base):
    __tablename__ = "subscription_settings"

    id = Column(Integer, primary_key=True)
    subscription_url_prefix = Column(String(512), nullable=False, default="", server_default=text("''"))
    subscription_profile_title = Column(
        String(255), nullable=False, default="Subscription", server_default="Subscription"
    )
    subscription_support_url = Column(
        String(512), nullable=False, default="https://t.me/", server_default="https://t.me/"
    )
    subscription_update_interval = Column(String(32), nullable=False, default="12", server_default="12")
    subscription_path = Column(String(128), nullable=False, default="sub", server_default="sub")
    subscription_ports = Column(Text, nullable=False, default="[]")
    custom_templates_directory = Column(String(512), nullable=True, default=None)
    clash_subscription_template = Column(String(255), nullable=False, default="clash/default.yml")
    clash_settings_template = Column(String(255), nullable=False, default="clash/settings.yml")
    subscription_page_template = Column(String(255), nullable=False, default="subscription/index.html")
    home_page_template = Column(String(255), nullable=False, default="home/index.html")
    v2ray_subscription_template = Column(String(255), nullable=False, default="v2ray/default.json")
    v2ray_settings_template = Column(String(255), nullable=False, default="v2ray/settings.json")
    singbox_subscription_template = Column(String(255), nullable=False, default="singbox/default.json")
    singbox_settings_template = Column(String(255), nullable=False, default="singbox/settings.json")
    mux_template = Column(String(255), nullable=False, default="mux/default.json")
    use_custom_json_default = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    use_custom_json_for_v2rayn = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    use_custom_json_for_v2rayng = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    use_custom_json_for_streisand = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    use_custom_json_for_happ = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    subscription_aliases = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class SubscriptionDomain(Base):
    __tablename__ = "subscription_domains"
    __table_args__ = (UniqueConstraint("domain", name="uq_subscription_domain"),)

    id = Column(Integer, primary_key=True)
    domain = Column(String(255), nullable=False, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    admin = relationship("Admin", back_populates="subscription_domains")
    email = Column(String(255), nullable=True)
    provider = Column(String(64), nullable=True)
    alt_names = Column(JSON, nullable=False, default=list)
    last_issued_at = Column(DateTime, nullable=True)
    last_renewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(34, collation="NOCASE"), index=True)
    credential_key = Column(String(64), nullable=True)
    flow = Column(String(128), nullable=True)
    proxies = relationship("Proxy", back_populates="user", cascade="all, delete-orphan")
    status = Column(Enum(UserStatus), nullable=False, default=UserStatus.active)
    used_traffic = Column(BigInteger, default=0)
    node_usages = relationship("NodeUserUsage", back_populates="user", cascade="all, delete-orphan")
    data_limit = Column(BigInteger, nullable=True)
    data_limit_reset_strategy = Column(
        Enum(UserDataLimitResetStrategy),
        nullable=False,
        default=UserDataLimitResetStrategy.no_reset,
    )
    usage_logs = relationship("UserUsageResetLogs", back_populates="user")  # maybe rename it to reset_usage_logs?
    expire = Column(Integer, nullable=True)
    admin_id = Column(Integer, ForeignKey("admins.id"))
    admin = relationship("Admin", back_populates="users")
    sub_revoked_at = Column(DateTime, nullable=True, default=None)
    sub_updated_at = Column(DateTime, nullable=True, default=None)
    sub_last_user_agent = Column(String(512), nullable=True, default=None)
    created_at = Column(DateTime, default=utcnow)
    note = Column(String(500), nullable=True, default=None)
    telegram_id = Column(String(128), nullable=True, default=None)
    contact_number = Column(String(64), nullable=True, default=None)
    online_at = Column(DateTime, nullable=True, default=None)
    on_hold_expire_duration = Column(BigInteger, nullable=True, default=None)
    on_hold_timeout = Column(DateTime, nullable=True, default=None)
    ip_limit = Column(Integer, nullable=False, default=0, server_default="0")

    # * Positive values: User will be deleted after the value of this field in days automatically.
    # * Negative values: User won't be deleted automatically at all.
    # * NULL: Uses global settings.
    auto_delete_in_days = Column(Integer, nullable=True, default=None)

    edit_at = Column(DateTime, nullable=True, default=None)
    last_status_change = Column(DateTime, default=utcnow, nullable=True)

    service_id = Column(Integer, ForeignKey("services.id", ondelete="SET NULL"), nullable=True, index=True)
    service = relationship("Service", back_populates="users")

    next_plans = relationship(
        "NextPlan",
        order_by="NextPlan.position",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def next_plan(self):
        """Compat: return the first next plan if present."""
        return self.next_plans[0] if self.next_plans else None

    @next_plan.setter
    def next_plan(self, value):
        """Compat setter to replace all next plans with a single entry."""
        if value is None:
            self.next_plans = []
            return
        self.next_plans = [value]

    @hybrid_property
    def reseted_usage(self) -> int:
        return int(sum([log.used_traffic_at_reset for log in self.usage_logs]))

    @reseted_usage.expression
    def reseted_usage(cls):
        return (
            select(func.sum(UserUsageResetLogs.used_traffic_at_reset))
            .where(UserUsageResetLogs.user_id == cls.id)
            .label("reseted_usage")
        )

    @property
    def lifetime_used_traffic(self) -> int:
        return int(sum([log.used_traffic_at_reset for log in self.usage_logs]) + self.used_traffic)

    @property
    def last_traffic_reset_time(self):
        return self.usage_logs[-1].reset_at if self.usage_logs else self.created_at

    @property
    def excluded_inbounds(self):
        if self.service_id is not None:
            return {proxy.type: [] for proxy in self.proxies}
        _ = {}
        for proxy in self.proxies:
            _[proxy.type] = [i.tag for i in proxy.excluded_inbounds]
        return _

    @property
    def inbounds(self):
        from app.runtime import xray  # lazy import to avoid circular dependency

        _ = {}
        if self.service_id is not None:
            allowed_tags = set()
            try:
                service = getattr(self, "service", None)
                host_links = getattr(service, "host_links", None) if service else None
                if host_links is not None:
                    for link in host_links:
                        host = getattr(link, "host", None)
                        if not host or getattr(host, "is_disabled", False):
                            continue
                        if getattr(host, "inbound_tag", None):
                            allowed_tags.add(host.inbound_tag)
            except Exception:
                pass

            if not allowed_tags:
                try:
                    from app.services.data_access import get_service_host_map_cached

                    host_map = get_service_host_map_cached(self.service_id, force_refresh=True)
                except Exception:
                    host_map = {}
                allowed_tags = {tag for tag, hosts in (host_map or {}).items() if hosts}
            if not allowed_tags:
                try:
                    from app.db import GetDB
                    from app.db import models as db_models

                    with GetDB() as db:
                        rows = (
                            db.query(db_models.ProxyHost.inbound_tag)
                            .join(
                                db_models.ServiceHostLink,
                                db_models.ServiceHostLink.host_id == db_models.ProxyHost.id,
                            )
                            .filter(db_models.ServiceHostLink.service_id == self.service_id)
                            .filter(~db_models.ProxyHost.is_disabled.is_(True))
                            .distinct()
                            .all()
                        )
                    allowed_tags = {row[0] for row in rows if row and row[0]}
                except Exception:
                    pass
            for proxy in self.proxies:
                proxy_key = proxy.type
                proxy_key_str = proxy_key.value if hasattr(proxy_key, "value") else str(proxy_key)
                _[proxy_key] = []
                for inbound in xray.config.inbounds_by_protocol.get(proxy_key_str, []):
                    if inbound["tag"] in allowed_tags:
                        _[proxy_key].append(inbound["tag"])
            return _

        for proxy in self.proxies:
            proxy_key = proxy.type
            proxy_key_str = proxy_key.value if hasattr(proxy_key, "value") else str(proxy_key)
            _[proxy_key] = []
            excluded_tags = [i.tag for i in proxy.excluded_inbounds]
            for inbound in xray.config.inbounds_by_protocol.get(proxy_key_str, []):
                if inbound["tag"] not in excluded_tags:
                    _[proxy_key].append(inbound["tag"])

        return _

    @property
    def service_host_orders(self):
        if not self.service:
            return {}
        return {link.host_id: link.sort for link in self.service.host_links}

    @property
    def service_name(self):
        return self.service.name if self.service else None

    @property
    def proxy_type(self):
        if not self.proxies:
            return None
        return self.proxies[0].type


excluded_inbounds_association = Table(
    "exclude_inbounds_association",
    Base.metadata,
    Column("proxy_id", ForeignKey("proxies.id")),
    Column("inbound_tag", ForeignKey("inbounds.tag")),
)

template_inbounds_association = Table(
    "template_inbounds_association",
    Base.metadata,
    Column("user_template_id", ForeignKey("user_templates.id")),
    Column("inbound_tag", ForeignKey("inbounds.tag")),
)


class NextPlan(Base):
    __tablename__ = "next_plans"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0, server_default="0")
    data_limit = Column(BigInteger, nullable=False)
    expire = Column(Integer, nullable=True)
    add_remaining_traffic = Column(Boolean, nullable=False, default=False, server_default="0")
    fire_on_either = Column(Boolean, nullable=False, default=True, server_default="0")
    increase_data_limit = Column(Boolean, nullable=False, default=False, server_default="0")
    start_on_first_connect = Column(Boolean, nullable=False, default=False, server_default="0")
    trigger_on = Column(String(16), nullable=False, default="either", server_default="either")

    user = relationship("User", back_populates="next_plans")


class UserTemplate(Base):
    __tablename__ = "user_templates"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    data_limit = Column(BigInteger, default=0)
    expire_duration = Column(BigInteger, default=0)  # in seconds
    username_prefix = Column(String(20), nullable=True)
    username_suffix = Column(String(20), nullable=True)

    inbounds = relationship("ProxyInbound", secondary=template_inbounds_association)


class UserUsageResetLogs(Base):
    __tablename__ = "user_usage_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("User", back_populates="usage_logs")
    used_traffic_at_reset = Column(BigInteger, nullable=False)
    reset_at = Column(DateTime, default=utcnow)


class Proxy(Base):
    __tablename__ = "proxies"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("User", back_populates="proxies")
    type = Column(Enum(ProxyTypes), nullable=False)
    settings = Column(JSON, nullable=False)
    excluded_inbounds = relationship("ProxyInbound", secondary=excluded_inbounds_association)


class ProxyInbound(Base):
    __tablename__ = "inbounds"

    id = Column(Integer, primary_key=True)
    tag = Column(String(256), unique=True, nullable=False, index=True)
    hosts = relationship("ProxyHost", back_populates="inbound", cascade="all, delete-orphan")


class ProxyHost(Base):
    __tablename__ = "hosts"
    # __table_args__ = (
    #     UniqueConstraint('inbound_tag', 'remark'),
    # )

    id = Column(Integer, primary_key=True)
    remark = Column(String(256), unique=False, nullable=False)
    address = Column(String(256), unique=False, nullable=False)
    port = Column(Integer, nullable=True)
    sort = Column(Integer, nullable=False, default=0, server_default="0")
    path = Column(String(256), unique=False, nullable=True)
    sni = Column(String(1000), unique=False, nullable=True)
    host = Column(String(1000), unique=False, nullable=True)
    security = Column(
        Enum(ProxyHostSecurity),
        unique=False,
        nullable=False,
        default=ProxyHostSecurity.inbound_default,
    )
    alpn = Column(
        Enum(ProxyHostALPN),
        unique=False,
        nullable=False,
        default=ProxyHostALPN.none,
        server_default=ProxyHostALPN.none.name,
    )
    fingerprint = Column(
        Enum(ProxyHostFingerprint),
        unique=False,
        nullable=False,
        default=ProxyHostFingerprint.none,
        server_default=ProxyHostFingerprint.none.name,
    )

    inbound_tag = Column(String(256), ForeignKey("inbounds.tag"), nullable=False)
    inbound = relationship("ProxyInbound", back_populates="hosts")
    allowinsecure = Column(Boolean, nullable=True)
    is_disabled = Column(Boolean, nullable=True, default=False)
    mux_enable = Column(Boolean, nullable=False, default=False, server_default="0")
    fragment_setting = Column(String(100), nullable=True)
    noise_setting = Column(String(2000), nullable=True)
    random_user_agent = Column(Boolean, nullable=False, default=False, server_default="0")
    use_sni_as_host = Column(Boolean, nullable=False, default=False, server_default="0")
    service_links = relationship(
        "ServiceHostLink",
        back_populates="host",
        cascade="all, delete-orphan",
    )


class AdminServiceLink(Base):
    __tablename__ = "admins_services"

    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), primary_key=True)
    service_id = Column(Integer, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    used_traffic = Column(BigInteger, nullable=False, default=0, server_default="0")
    lifetime_used_traffic = Column(BigInteger, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    admin = relationship("Admin", back_populates="service_links")
    service = relationship("Service", back_populates="admin_links")


class ServiceHostLink(Base):
    __tablename__ = "service_hosts"

    service_id = Column(Integer, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    host_id = Column(Integer, ForeignKey("hosts.id", ondelete="CASCADE"), primary_key=True)
    sort = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=utcnow)

    service = relationship("Service", back_populates="host_links")
    host = relationship("ProxyHost", back_populates="service_links")


class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), unique=True, nullable=False)
    description = Column(String(256), nullable=True)
    flow = Column(String(255), nullable=True)
    used_traffic = Column(BigInteger, nullable=False, default=0, server_default="0")
    lifetime_used_traffic = Column(BigInteger, nullable=False, default=0, server_default="0")
    users_usage = Column(BigInteger, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    admin_links = relationship(
        "AdminServiceLink",
        back_populates="service",
        cascade="all, delete-orphan",
    )
    host_links = relationship(
        "ServiceHostLink",
        back_populates="service",
        cascade="all, delete-orphan",
        order_by="ServiceHostLink.sort",
    )
    admins = association_proxy("admin_links", "admin")
    hosts = association_proxy("host_links", "host")
    users = relationship("User", back_populates="service")

    @property
    def admin_ids(self):
        return [link.admin_id for link in self.admin_links]

    @property
    def host_ids(self):
        return [link.host_id for link in self.host_links]

    @property
    def host_order_map(self):
        return {link.host_id: link.sort for link in self.host_links}


class System(Base):
    __tablename__ = "system"

    id = Column(Integer, primary_key=True)
    uplink = Column(BigInteger, default=0)
    downlink = Column(BigInteger, default=0)


class XrayConfig(Base):
    __tablename__ = "xray_config"

    id = Column(Integer, primary_key=True)
    data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class WarpAccount(Base):
    __tablename__ = "warp_accounts"

    id = Column(Integer, primary_key=True)
    device_id = Column(String(64), nullable=False, unique=True, index=True)
    access_token = Column(String(255), nullable=False)
    license_key = Column(String(64), nullable=True)
    private_key = Column(String(128), nullable=False)
    public_key = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class JWT(Base):
    __tablename__ = "jwt"

    id = Column(Integer, primary_key=True)
    # Legacy field - kept for backward compatibility during migration
    secret_key = Column(String(64), nullable=True)
    # Separate keys for subscription and admin authentication
    subscription_secret_key = Column(String(64), nullable=False, default=lambda: os.urandom(32).hex())
    admin_secret_key = Column(String(64), nullable=False, default=lambda: os.urandom(32).hex())
    # UUID masks for VMess and VLESS protocols
    vmess_mask = Column(String(32), nullable=False, default=lambda: os.urandom(16).hex())
    vless_mask = Column(String(32), nullable=False, default=lambda: os.urandom(16).hex())


class TLS(Base):
    __tablename__ = "tls"

    id = Column(Integer, primary_key=True)
    key = Column(String(4096), nullable=False)
    certificate = Column(String(2048), nullable=False)


class Node(Base):
    __tablename__ = "nodes"

    id = Column(Integer, primary_key=True)
    name = Column(String(256, collation="NOCASE"), unique=True)
    address = Column(String(256), unique=False, nullable=False)
    port = Column(Integer, unique=False, nullable=False)
    api_port = Column(Integer, unique=False, nullable=False)
    xray_version = Column(String(32), nullable=True)
    status = Column(Enum(NodeStatus), nullable=False, default=NodeStatus.connecting)
    last_status_change = Column(DateTime, default=utcnow)
    message = Column(String(1024), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    uplink = Column(BigInteger, default=0)
    downlink = Column(BigInteger, default=0)
    user_usages = relationship("NodeUserUsage", back_populates="node", cascade="all, delete-orphan")
    usages = relationship("NodeUsage", back_populates="node", cascade="all, delete-orphan")
    usage_coefficient = Column(Float, nullable=False, server_default=text("1.0"), default=1)
    geo_mode = Column(Enum(GeoMode), nullable=False, default=GeoMode.default)
    data_limit = Column(BigInteger, nullable=True, default=None)
    use_nobetci = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    nobetci_port = Column(Integer, nullable=True, default=None)
    proxy_enabled = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    proxy_type = Column(String(16), nullable=True, default=None)
    proxy_host = Column(String(255), nullable=True, default=None)
    proxy_port = Column(Integer, nullable=True, default=None)
    proxy_username = Column(String(255), nullable=True, default=None)
    proxy_password = Column(String(255), nullable=True, default=None)
    certificate = Column(Text, nullable=True)  # Node-specific certificate (PEM format)
    certificate_key = Column(Text, nullable=True)  # Node-specific certificate key (PEM format)


class MasterNodeState(Base):
    __tablename__ = "master_node_state"

    id = Column(Integer, primary_key=True, default=1)
    uplink = Column(BigInteger, default=0)
    downlink = Column(BigInteger, default=0)
    data_limit = Column(BigInteger, nullable=True, default=None)
    status = Column(Enum(NodeStatus), nullable=False, default=NodeStatus.connected)
    message = Column(String(1024), nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class NodeUserUsage(Base):
    __tablename__ = "node_user_usages"
    __table_args__ = (UniqueConstraint("created_at", "user_id", "node_id"),)

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, unique=False, nullable=False)  # one hour per record
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("User", back_populates="node_usages")
    node_id = Column(Integer, ForeignKey("nodes.id"))
    node = relationship("Node", back_populates="user_usages")
    used_traffic = Column(BigInteger, default=0)


class NodeUsage(Base):
    __tablename__ = "node_usages"
    __table_args__ = (UniqueConstraint("created_at", "node_id"),)

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, unique=False, nullable=False)  # one hour per record
    node_id = Column(Integer, ForeignKey("nodes.id"))
    node = relationship("Node", back_populates="usages")
    uplink = Column(BigInteger, default=0)
    downlink = Column(BigInteger, default=0)


class OutboundTraffic(Base):
    __tablename__ = "outbound_traffic"
    __table_args__ = (UniqueConstraint("outbound_id"),)

    id = Column(Integer, primary_key=True)
    outbound_id = Column(String(256), unique=True, nullable=False, index=True)  # Unique ID for outbound (not tag)
    tag = Column(String(256), nullable=True, index=True)  # Outbound tag for reference
    protocol = Column(String(64), nullable=True)  # Protocol type (vmess, vless, etc.)
    address = Column(String(256), nullable=True)  # Server address
    port = Column(Integer, nullable=True)  # Server port
    uplink = Column(BigInteger, default=0)  # Total upload traffic
    downlink = Column(BigInteger, default=0)  # Total download traffic
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
