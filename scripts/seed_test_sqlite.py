import argparse
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db import models as db_models
from app.models.admin import AdminRole, AdminStatus, ROLE_DEFAULT_PERMISSIONS, pwd_context
from app.models.proxy import (
    ProxyHostALPN,
    ProxyHostFingerprint,
    ProxyHostSecurity,
    ProxyTypes,
    ShadowsocksSettings,
    TrojanSettings,
    VLESSSettings,
    VMessSettings,
)
from app.models.user import UserDataLimitResetStrategy, UserStatus
from xray_api.types.account import ShadowsocksMethods, XTLSFlows


GB = 1024**3


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _settings_payload(settings) -> dict:
    return settings.dict(no_obj=True) if hasattr(settings, "dict") else settings


def _make_admin(
    *,
    username: str,
    role: AdminRole,
    status: AdminStatus = AdminStatus.active,
    password: str = "password123",
    data_limit: int | None = None,
    users_limit: int | None = None,
    telegram_id: int | None = None,
) -> db_models.Admin:
    permissions = ROLE_DEFAULT_PERMISSIONS[role].model_dump()
    return db_models.Admin(
        username=username,
        hashed_password=_hash_password(password),
        role=role,
        status=status,
        permissions=permissions,
        telegram_id=telegram_id,
        data_limit=data_limit,
        users_limit=users_limit,
        subscription_settings={},
    )


def _make_proxy_settings(proxy_type: ProxyTypes, credential_key: str | None) -> dict:
    if proxy_type in (ProxyTypes.VMess, ProxyTypes.VLESS):
        derived_id = str(uuid.uuid4())
        if proxy_type == ProxyTypes.VLESS:
            settings = VLESSSettings(id=derived_id, flow=XTLSFlows.NONE)
        else:
            settings = VMessSettings(id=derived_id)
        return _settings_payload(settings)
    if proxy_type == ProxyTypes.Trojan:
        settings = TrojanSettings(password=secrets.token_hex(8), flow=XTLSFlows.NONE)
        return _settings_payload(settings)
    if proxy_type == ProxyTypes.Shadowsocks:
        settings = ShadowsocksSettings(
            password=secrets.token_hex(8),
            method=ShadowsocksMethods.CHACHA20_POLY1305,
            ivCheck=False,
        )
        return _settings_payload(settings)
    return {}


def _make_user(
    *,
    username: str,
    admin: db_models.Admin,
    status: UserStatus,
    expire: int | None,
    data_limit: int | None,
    used_traffic: int,
    reset_strategy: UserDataLimitResetStrategy = UserDataLimitResetStrategy.no_reset,
    flow: str | None = None,
    ip_limit: int = 0,
    on_hold_expire_duration: int | None = None,
    on_hold_timeout: datetime | None = None,
    service: db_models.Service | None = None,
) -> tuple[db_models.User, list[db_models.Proxy]]:
    credential_key = secrets.token_hex(16)
    user = db_models.User(
        username=username,
        credential_key=credential_key,
        flow=flow,
        status=status,
        data_limit=data_limit,
        used_traffic=used_traffic,
        data_limit_reset_strategy=reset_strategy,
        expire=expire,
        admin=admin,
        service=service,
        ip_limit=ip_limit,
        on_hold_expire_duration=on_hold_expire_duration,
        on_hold_timeout=on_hold_timeout,
        created_at=_utc_now(),
        last_status_change=_utc_now(),
        sub_updated_at=_utc_now(),
        sub_last_user_agent="seed-script",
        online_at=_utc_now() if status == UserStatus.active else None,
    )
    proxies = []
    for proxy_type in (
        ProxyTypes.VMess,
        ProxyTypes.VLESS,
        ProxyTypes.Trojan,
        ProxyTypes.Shadowsocks,
    ):
        proxy = db_models.Proxy(
            user=user,
            type=proxy_type,
            settings=_make_proxy_settings(proxy_type, credential_key),
        )
        proxies.append(proxy)
    return user, proxies


def seed(session):
    session.add(db_models.JWT())
    session.add(db_models.System())
    session.add(db_models.PanelSettings())
    session.add(db_models.SubscriptionSettings())

    admins = [
        _make_admin(username="fulladmin", role=AdminRole.full_access, password="fulladmin"),
        _make_admin(username="sudoadmin", role=AdminRole.sudo, password="sudoadmin"),
        _make_admin(username="reseller", role=AdminRole.reseller, password="reseller"),
        _make_admin(username="standard", role=AdminRole.standard, password="standard"),
        _make_admin(
            username="standard_disabled",
            role=AdminRole.standard,
            status=AdminStatus.disabled,
            password="disabled",
        ),
    ]
    session.add_all(admins)

    inbound_tcp = db_models.ProxyInbound(tag="in-vless-tcp")
    inbound_ws = db_models.ProxyInbound(tag="in-vless-ws")
    inbound_tls = db_models.ProxyInbound(tag="in-trojan-tls")
    inbound_reality = db_models.ProxyInbound(tag="in-reality")
    inbound_ss = db_models.ProxyInbound(tag="in-ss")

    session.add_all([inbound_tcp, inbound_ws, inbound_tls, inbound_reality, inbound_ss])

    host_tcp_main = db_models.ProxyHost(
        remark="tcp-main",
        address="tcp.example.net",
        port=443,
        path="/",
        sni="tcp.example.net",
        host="tcp.example.net",
        security=ProxyHostSecurity.inbound_default,
        alpn=ProxyHostALPN.h2,
        fingerprint=ProxyHostFingerprint.chrome,
        allowinsecure=False,
        inbound=inbound_tcp,
        sort=0,
    )
    host_tcp_backup = db_models.ProxyHost(
        remark="tcp-backup",
        address="backup.example.net",
        port=443,
        security=ProxyHostSecurity.none,
        inbound=inbound_tcp,
        sort=1,
    )
    host_ws_cdn = db_models.ProxyHost(
        remark="ws-cdn",
        address="ws.example.net",
        port=443,
        path="/ws",
        sni="ws.example.net",
        host="ws.example.net",
        security=ProxyHostSecurity.tls,
        alpn=ProxyHostALPN.h2,
        fingerprint=ProxyHostFingerprint.firefox,
        inbound=inbound_ws,
        sort=0,
    )
    host_tls_main = db_models.ProxyHost(
        remark="tls-main",
        address="tls.example.net",
        port=443,
        sni="tls.example.net",
        security=ProxyHostSecurity.tls,
        alpn=ProxyHostALPN.h2,
        fingerprint=ProxyHostFingerprint.chrome,
        inbound=inbound_tls,
        sort=0,
    )
    host_reality = db_models.ProxyHost(
        remark="reality-edge",
        address="reality.example.net",
        port=443,
        sni="reality.example.net",
        security=ProxyHostSecurity.inbound_default,
        inbound=inbound_reality,
        sort=0,
    )
    host_ss = db_models.ProxyHost(
        remark="ss-node",
        address="ss.example.net",
        port=8388,
        security=ProxyHostSecurity.none,
        inbound=inbound_ss,
        sort=0,
    )

    session.add_all(
        [
            host_tcp_main,
            host_tcp_backup,
            host_ws_cdn,
            host_tls_main,
            host_reality,
            host_ss,
        ]
    )

    service_basic = db_models.Service(
        name="Basic Plan",
        description="Basic plan for testing",
        flow=None,
    )
    service_premium = db_models.Service(
        name="Premium Plan",
        description="Premium plan for testing",
        flow="xtls-rprx-vision",
    )
    session.add_all([service_basic, service_premium])

    session.add(db_models.AdminServiceLink(admin=admins[0], service=service_basic))
    session.add(db_models.AdminServiceLink(admin=admins[0], service=service_premium))
    session.add(db_models.AdminServiceLink(admin=admins[2], service=service_basic))

    session.add(db_models.ServiceHostLink(service=service_basic, host=host_tcp_main, sort=0))
    session.add(db_models.ServiceHostLink(service=service_basic, host=host_ws_cdn, sort=1))
    session.add(db_models.ServiceHostLink(service=service_premium, host=host_tls_main, sort=0))

    now_ts = int(datetime.now(UTC).timestamp())

    users = []
    proxies = []

    user_active, user_active_proxies = _make_user(
        username="user_active_unlimited",
        admin=admins[3],
        status=UserStatus.active,
        expire=0,
        data_limit=0,
        used_traffic=2 * GB,
        reset_strategy=UserDataLimitResetStrategy.month,
        ip_limit=2,
        service=service_basic,
    )
    users.append(user_active)
    proxies.extend(user_active_proxies)

    user_active_limited, user_active_limited_proxies = _make_user(
        username="user_active_limited",
        admin=admins[2],
        status=UserStatus.active,
        expire=now_ts + 20 * 86400,
        data_limit=20 * GB,
        used_traffic=3 * GB,
        reset_strategy=UserDataLimitResetStrategy.week,
        service=service_basic,
    )
    users.append(user_active_limited)
    proxies.extend(user_active_limited_proxies)

    user_limited, user_limited_proxies = _make_user(
        username="user_limited",
        admin=admins[2],
        status=UserStatus.limited,
        expire=now_ts + 7 * 86400,
        data_limit=5 * GB,
        used_traffic=7 * GB,
        reset_strategy=UserDataLimitResetStrategy.day,
        service=service_basic,
    )
    users.append(user_limited)
    proxies.extend(user_limited_proxies)

    user_expired, user_expired_proxies = _make_user(
        username="user_expired",
        admin=admins[3],
        status=UserStatus.expired,
        expire=now_ts - 2 * 86400,
        data_limit=10 * GB,
        used_traffic=10 * GB,
        reset_strategy=UserDataLimitResetStrategy.no_reset,
        service=service_basic,
    )
    users.append(user_expired)
    proxies.extend(user_expired_proxies)

    user_disabled, user_disabled_proxies = _make_user(
        username="user_disabled",
        admin=admins[3],
        status=UserStatus.disabled,
        expire=now_ts + 5 * 86400,
        data_limit=15 * GB,
        used_traffic=1 * GB,
        reset_strategy=UserDataLimitResetStrategy.month,
        service=service_basic,
    )
    users.append(user_disabled)
    proxies.extend(user_disabled_proxies)

    user_on_hold, user_on_hold_proxies = _make_user(
        username="user_on_hold",
        admin=admins[1],
        status=UserStatus.on_hold,
        expire=None,
        data_limit=8 * GB,
        used_traffic=0,
        reset_strategy=UserDataLimitResetStrategy.no_reset,
        on_hold_expire_duration=7 * 86400,
        on_hold_timeout=_utc_now() + timedelta(hours=6),
        service=service_basic,
    )
    users.append(user_on_hold)
    proxies.extend(user_on_hold_proxies)

    user_deleted, user_deleted_proxies = _make_user(
        username="user_deleted",
        admin=admins[1],
        status=UserStatus.deleted,
        expire=now_ts - 10 * 86400,
        data_limit=2 * GB,
        used_traffic=2 * GB,
        reset_strategy=UserDataLimitResetStrategy.no_reset,
        service=service_basic,
    )
    users.append(user_deleted)
    proxies.extend(user_deleted_proxies)

    user_expiring, user_expiring_proxies = _make_user(
        username="user_expiring_soon",
        admin=admins[0],
        status=UserStatus.active,
        expire=now_ts + 3600,
        data_limit=6 * GB,
        used_traffic=1 * GB,
        reset_strategy=UserDataLimitResetStrategy.week,
        flow="xtls-rprx-vision",
        service=service_premium,
    )
    users.append(user_expiring)
    proxies.extend(user_expiring_proxies)

    user_unlimited_expire, user_unlimited_expire_proxies = _make_user(
        username="user_unlimited_expire",
        admin=admins[0],
        status=UserStatus.active,
        expire=None,
        data_limit=12 * GB,
        used_traffic=4 * GB,
        reset_strategy=UserDataLimitResetStrategy.year,
        service=service_premium,
    )
    users.append(user_unlimited_expire)
    proxies.extend(user_unlimited_expire_proxies)

    session.add_all(users)
    session.add_all(proxies)

    session.add(
        db_models.NextPlan(
            user=user_active_limited,
            position=0,
            data_limit=10 * GB,
            expire=now_ts + 60 * 86400,
            add_remaining_traffic=True,
            fire_on_either=True,
            start_on_first_connect=False,
            trigger_on="either",
        )
    )

    session.add(
        db_models.UserTemplate(
            name="starter-template",
            data_limit=5 * GB,
            expire_duration=30 * 86400,
            username_prefix="dev",
            username_suffix="plan",
            inbounds=[inbound_tcp, inbound_ws],
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a test SQLite database for development.")
    parser.add_argument(
        "--db",
        default="dev_test.sqlite3",
        help="SQLite database file path (default: dev_test.sqlite3)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the database file if it already exists.",
    )
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if db_path.exists():
        if not args.force:
            raise SystemExit(f"Database already exists: {db_path}. Use --force to overwrite.")
        db_path.unlink()

    db_path.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(_sqlite_url(db_path), connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        seed(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    print(f"Seeded test database at {db_path}")


if __name__ == "__main__":
    main()
