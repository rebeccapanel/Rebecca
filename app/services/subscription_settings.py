from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, TYPE_CHECKING

from jinja2 import TemplateNotFound
from sqlalchemy.orm import Session

from app.db.base import SessionLocal
from app.templates import _get_env
from app.utils.maintenance import maintenance_request

DEFAULT_SUBSCRIPTION_URL_PREFIX = ""
DEFAULT_SUBSCRIPTION_PROFILE_TITLE = "Subscription"
DEFAULT_SUBSCRIPTION_SUPPORT_URL = "https://t.me/"
DEFAULT_SUBSCRIPTION_UPDATE_INTERVAL = "12"
DEFAULT_CUSTOM_TEMPLATES_DIRECTORY = None
DEFAULT_CLASH_SUBSCRIPTION_TEMPLATE = "clash/default.yml"
DEFAULT_CLASH_SETTINGS_TEMPLATE = "clash/settings.yml"
DEFAULT_SUBSCRIPTION_PAGE_TEMPLATE = "subscription/index.html"
DEFAULT_HOME_PAGE_TEMPLATE = "home/index.html"
DEFAULT_V2RAY_SUBSCRIPTION_TEMPLATE = "v2ray/default.json"
DEFAULT_V2RAY_SETTINGS_TEMPLATE = "v2ray/settings.json"
DEFAULT_SINGBOX_SUBSCRIPTION_TEMPLATE = "singbox/default.json"
DEFAULT_SINGBOX_SETTINGS_TEMPLATE = "singbox/settings.json"
DEFAULT_MUX_TEMPLATE = "mux/default.json"
DEFAULT_USE_CUSTOM_JSON_DEFAULT = False
DEFAULT_USE_CUSTOM_JSON_FOR_V2RAYN = False
DEFAULT_USE_CUSTOM_JSON_FOR_V2RAYNG = False
DEFAULT_USE_CUSTOM_JSON_FOR_STREISAND = False
DEFAULT_USE_CUSTOM_JSON_FOR_HAPP = False

REBECCA_DATA_DIR = Path(os.getenv("REBECCA_DATA_DIR", "/var/lib/rebecca"))
CERT_BASE_PATH = Path(os.getenv("REBECCA_CERT_BASE", REBECCA_DATA_DIR / "certs"))
APP_TEMPLATE_BASE_PATH = (Path(__file__).resolve().parents[1] / "templates").resolve()
DOMAIN_PATTERN = re.compile(r"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

if TYPE_CHECKING:  # pragma: no cover
    from app.db.models import Admin, SubscriptionDomain, SubscriptionSettings as SubscriptionSettingsModel


def _models():
    from app.db.models import Admin, SubscriptionDomain, SubscriptionSettings as SubscriptionSettingsModel

    return Admin, SubscriptionDomain, SubscriptionSettingsModel


def _now() -> datetime:
    """Return naive UTC datetime compatible with existing DB columns."""
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass
class SubscriptionSettingsData:
    subscription_url_prefix: str = ""
    subscription_profile_title: str = DEFAULT_SUBSCRIPTION_PROFILE_TITLE
    subscription_support_url: str = DEFAULT_SUBSCRIPTION_SUPPORT_URL
    subscription_update_interval: str = DEFAULT_SUBSCRIPTION_UPDATE_INTERVAL
    custom_templates_directory: Optional[str] = None
    clash_subscription_template: str = "clash/default.yml"
    clash_settings_template: str = "clash/settings.yml"
    subscription_page_template: str = "subscription/index.html"
    home_page_template: str = "home/index.html"
    v2ray_subscription_template: str = "v2ray/default.json"
    v2ray_settings_template: str = "v2ray/settings.json"
    singbox_subscription_template: str = "singbox/default.json"
    singbox_settings_template: str = "singbox/settings.json"
    mux_template: str = "mux/default.json"
    use_custom_json_default: bool = False
    use_custom_json_for_v2rayn: bool = False
    use_custom_json_for_v2rayng: bool = False
    use_custom_json_for_streisand: bool = False
    use_custom_json_for_happ: bool = False
    subscription_path: str = "sub"
    subscription_aliases: List[str] = field(default_factory=list)
    subscription_ports: List[int] = field(default_factory=list)


@dataclass
class EffectiveSubscriptionSettings(SubscriptionSettingsData):
    subscription_domain: Optional[str] = None


@dataclass
class SubscriptionDomainData:
    id: Optional[int]
    domain: str
    admin_id: Optional[int]
    email: Optional[str]
    provider: Optional[str]
    alt_names: List[str]
    last_issued_at: Optional[datetime]
    last_renewed_at: Optional[datetime]
    path: str


class SubscriptionSettingsService:
    """Manage subscription template and JSON settings stored in database."""

    @staticmethod
    def _template_keys() -> List[str]:
        return [
            "clash_subscription_template",
            "clash_settings_template",
            "subscription_page_template",
            "home_page_template",
            "v2ray_subscription_template",
            "v2ray_settings_template",
            "singbox_subscription_template",
            "singbox_settings_template",
            "mux_template",
        ]

    @staticmethod
    def _normalize_prefix(prefix: Optional[str]) -> str:
        if prefix is None:
            return ""
        cleaned = prefix.strip()
        if cleaned.endswith("/"):
            cleaned = cleaned[:-1]
        return cleaned

    @staticmethod
    def _ensure_scheme(value: str) -> str:
        if not value:
            return ""
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return f"https://{value}"


    @staticmethod
    def _normalize_path(value: Optional[str]) -> str:
        raw = (value or "").strip().strip("/")
        return raw or "sub"

    @staticmethod
    def _normalize_support_url(value: Optional[str]) -> str:
        if value is None:
            return ""
        cleaned = str(value).strip()
        if not cleaned:
            return ""
        return SubscriptionSettingsService._ensure_scheme(cleaned)


    @staticmethod
    def _normalize_ports(raw: Any) -> List[int]:
        if raw is None:
            return []
        values = raw
        if isinstance(raw, str):
            text = raw.strip()
            if not text:
                return []
            try:
                values = json.loads(text)
            except Exception:
                values = [v.strip() for v in text.split(',') if v.strip()]
        if not isinstance(values, list):
            return []
        ports: List[int] = []
        for v in values:
            try:
                p = int(v)
            except Exception:
                continue
            if 1 <= p <= 65535 and p not in ports:
                ports.append(p)
        return ports

    @staticmethod
    def _sanitize_alias(alias: str) -> str:
        cleaned = str(alias or "").strip()
        if not cleaned:
            return ""
        # keep aliases readable in UI/DB (without placeholder braces)
        cleaned = cleaned.replace("{identifier}", "").replace("{token}", "").replace("{key}", "")
        cleaned = re.sub(r"//+", "/", cleaned)
        return cleaned.strip()

    @classmethod
    def _normalize_aliases(cls, raw: Any) -> List[str]:
        values: List[str] = []
        if raw is None:
            return values
        if isinstance(raw, str):
            text = raw.strip()
            if not text:
                return values
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    values = [cls._sanitize_alias(v) for v in parsed if cls._sanitize_alias(v)]
                    return values
            except Exception:
                # legacy single-line string alias support
                sanitized = cls._sanitize_alias(text)
                return [sanitized] if sanitized else []
            return values
        if isinstance(raw, list):
            return [cls._sanitize_alias(v) for v in raw if cls._sanitize_alias(v)]
        return values

    @classmethod
    def _fallback_defaults(cls) -> SubscriptionSettingsData:
        return SubscriptionSettingsData(
            subscription_url_prefix=cls._normalize_prefix(DEFAULT_SUBSCRIPTION_URL_PREFIX),
            subscription_profile_title=DEFAULT_SUBSCRIPTION_PROFILE_TITLE,
            subscription_support_url=DEFAULT_SUBSCRIPTION_SUPPORT_URL,
            subscription_update_interval=DEFAULT_SUBSCRIPTION_UPDATE_INTERVAL,
            custom_templates_directory=DEFAULT_CUSTOM_TEMPLATES_DIRECTORY,
            clash_subscription_template=DEFAULT_CLASH_SUBSCRIPTION_TEMPLATE,
            clash_settings_template=DEFAULT_CLASH_SETTINGS_TEMPLATE,
            subscription_page_template=DEFAULT_SUBSCRIPTION_PAGE_TEMPLATE,
            home_page_template=DEFAULT_HOME_PAGE_TEMPLATE,
            v2ray_subscription_template=DEFAULT_V2RAY_SUBSCRIPTION_TEMPLATE,
            v2ray_settings_template=DEFAULT_V2RAY_SETTINGS_TEMPLATE,
            singbox_subscription_template=DEFAULT_SINGBOX_SUBSCRIPTION_TEMPLATE,
            singbox_settings_template=DEFAULT_SINGBOX_SETTINGS_TEMPLATE,
            mux_template=DEFAULT_MUX_TEMPLATE,
            use_custom_json_default=DEFAULT_USE_CUSTOM_JSON_DEFAULT,
            use_custom_json_for_v2rayn=DEFAULT_USE_CUSTOM_JSON_FOR_V2RAYN,
            use_custom_json_for_v2rayng=DEFAULT_USE_CUSTOM_JSON_FOR_V2RAYNG,
            use_custom_json_for_streisand=DEFAULT_USE_CUSTOM_JSON_FOR_STREISAND,
            use_custom_json_for_happ=DEFAULT_USE_CUSTOM_JSON_FOR_HAPP,
            subscription_path="sub",
            subscription_aliases=[],
            subscription_ports=[],
        )

    @classmethod
    def _serialize(cls, record: Optional["SubscriptionSettingsModel"]) -> SubscriptionSettingsData:
        if record is None:
            return cls._fallback_defaults()

        return SubscriptionSettingsData(
            subscription_url_prefix=cls._normalize_prefix(record.subscription_url_prefix or ""),
            subscription_profile_title=record.subscription_profile_title or DEFAULT_SUBSCRIPTION_PROFILE_TITLE,
            subscription_support_url=cls._normalize_support_url(
                record.subscription_support_url or DEFAULT_SUBSCRIPTION_SUPPORT_URL
            ),
            subscription_update_interval=record.subscription_update_interval or DEFAULT_SUBSCRIPTION_UPDATE_INTERVAL,
            custom_templates_directory=record.custom_templates_directory,
            clash_subscription_template=record.clash_subscription_template or DEFAULT_CLASH_SUBSCRIPTION_TEMPLATE,
            clash_settings_template=record.clash_settings_template or DEFAULT_CLASH_SETTINGS_TEMPLATE,
            subscription_page_template=record.subscription_page_template or DEFAULT_SUBSCRIPTION_PAGE_TEMPLATE,
            home_page_template=record.home_page_template or DEFAULT_HOME_PAGE_TEMPLATE,
            v2ray_subscription_template=record.v2ray_subscription_template or DEFAULT_V2RAY_SUBSCRIPTION_TEMPLATE,
            v2ray_settings_template=record.v2ray_settings_template or DEFAULT_V2RAY_SETTINGS_TEMPLATE,
            singbox_subscription_template=record.singbox_subscription_template or DEFAULT_SINGBOX_SUBSCRIPTION_TEMPLATE,
            singbox_settings_template=record.singbox_settings_template or DEFAULT_SINGBOX_SETTINGS_TEMPLATE,
            mux_template=record.mux_template or DEFAULT_MUX_TEMPLATE,
            use_custom_json_default=bool(record.use_custom_json_default),
            use_custom_json_for_v2rayn=bool(record.use_custom_json_for_v2rayn),
            use_custom_json_for_v2rayng=bool(record.use_custom_json_for_v2rayng),
            use_custom_json_for_streisand=bool(record.use_custom_json_for_streisand),
            use_custom_json_for_happ=bool(record.use_custom_json_for_happ),
            subscription_path=cls._normalize_path(getattr(record, "subscription_path", "sub")),
            subscription_aliases=cls._normalize_aliases(record.subscription_aliases),
            subscription_ports=cls._normalize_ports(getattr(record, "subscription_ports", None)),
        )

    @classmethod
    def _effective_template_selection(
        cls,
        template_key: str,
        base: SubscriptionSettingsData,
        admin: Optional["Admin"],
    ) -> tuple[str, Optional[str]]:
        if template_key not in cls._template_keys():
            raise ValueError(f"Unsupported template key: {template_key}")
        template_name = getattr(base, template_key)
        custom_directory = base.custom_templates_directory or DEFAULT_CUSTOM_TEMPLATES_DIRECTORY
        if admin is not None:
            overrides = getattr(admin, "subscription_settings", {}) or {}
            template_name = overrides.get(template_key) or template_name
            custom_directory = overrides.get("custom_templates_directory") or custom_directory
        return template_name, custom_directory

    @classmethod
    def _ensure_record(cls, db: Session) -> "SubscriptionSettingsModel":
        _, _, SubscriptionSettingsModel = _models()
        record = db.query(SubscriptionSettingsModel).order_by(SubscriptionSettingsModel.id.desc()).first()
        if record is None:
            defaults = cls._fallback_defaults()
            record = SubscriptionSettingsModel(
                subscription_url_prefix=defaults.subscription_url_prefix,
                subscription_profile_title=defaults.subscription_profile_title,
                subscription_support_url=defaults.subscription_support_url,
                subscription_update_interval=defaults.subscription_update_interval,
                custom_templates_directory=defaults.custom_templates_directory,
                clash_subscription_template=defaults.clash_subscription_template,
                clash_settings_template=defaults.clash_settings_template,
                subscription_page_template=defaults.subscription_page_template,
                home_page_template=defaults.home_page_template,
                v2ray_subscription_template=defaults.v2ray_subscription_template,
                v2ray_settings_template=defaults.v2ray_settings_template,
                singbox_subscription_template=defaults.singbox_subscription_template,
                singbox_settings_template=defaults.singbox_settings_template,
                mux_template=defaults.mux_template,
                use_custom_json_default=defaults.use_custom_json_default,
                use_custom_json_for_v2rayn=defaults.use_custom_json_for_v2rayn,
                use_custom_json_for_v2rayng=defaults.use_custom_json_for_v2rayng,
                use_custom_json_for_streisand=defaults.use_custom_json_for_streisand,
                use_custom_json_for_happ=defaults.use_custom_json_for_happ,
                subscription_aliases=json.dumps(defaults.subscription_aliases),
                subscription_ports=json.dumps(defaults.subscription_ports),
            )
            db.add(record)
            db.commit()
            db.refresh(record)
        return record

    @classmethod
    def get_settings(
        cls,
        *,
        ensure_record: bool = True,
        db: Optional[Session] = None,
    ) -> SubscriptionSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            _, _, SubscriptionSettingsModel = _models()
            record = db.query(SubscriptionSettingsModel).order_by(SubscriptionSettingsModel.id.desc()).first()
            if record is None and ensure_record:
                record = cls._ensure_record(db)
            return cls._serialize(record)
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def read_template_content(
        cls,
        template_key: str,
        *,
        admin: Optional["Admin"] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            base = cls.get_settings(ensure_record=True, db=db)
            template_name, custom_directory = cls._effective_template_selection(template_key, base, admin)
            env = _get_env(custom_directory)
            try:
                source, resolved_path, _ = env.loader.get_source(env, template_name)
            except TemplateNotFound as exc:  # pragma: no cover - depends on FS
                raise ValueError(f"Template not found: {template_name}") from exc
            except Exception as exc:  # pragma: no cover - defensive
                raise ValueError(f"Unable to load template {template_name}: {exc}") from exc

            return {
                "template_key": template_key,
                "template_name": template_name,
                "custom_directory": custom_directory,
                "resolved_path": resolved_path,
                "admin_id": getattr(admin, "id", None),
                "content": source,
            }
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def write_template_content(
        cls,
        template_key: str,
        content: str,
        *,
        admin: Optional["Admin"] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            base = cls.get_settings(ensure_record=True, db=db)
            template_name, custom_directory = cls._effective_template_selection(template_key, base, admin)
            base_dir = (
                Path(custom_directory).expanduser().resolve() if custom_directory else APP_TEMPLATE_BASE_PATH
            )
            target_path = (base_dir / template_name).resolve()
            try:
                target_path.relative_to(base_dir)
            except ValueError as exc:
                raise ValueError("Template path escapes the templates directory.") from exc

            try:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(content, encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"Unable to write template {template_name}: {exc}") from exc

            return cls.read_template_content(template_key, admin=admin, db=db)
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def update_settings(cls, payload: Dict[str, Any], *, db: Optional[Session] = None) -> SubscriptionSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            record = cls._ensure_record(db)
            for key, value in payload.items():
                if not hasattr(record, key):
                    continue
                if key == "subscription_url_prefix":
                    value = cls._normalize_prefix(value)
                if key == "subscription_support_url":
                    value = cls._normalize_support_url(value)
                if key in {"subscription_profile_title", "subscription_update_interval"} and value is not None:
                    value = str(value).strip()
                if isinstance(value, str):
                    value = value.strip()
                if key.startswith("use_custom_json"):
                    value = bool(value)
                if key == "subscription_aliases":
                    if value is None:
                        value = []
                    if not isinstance(value, list):
                        raise ValueError("subscription_aliases must be a list")
                    normalized_aliases: List[str] = []
                    for item in value:
                        alias = cls._sanitize_alias(str(item or ""))
                        if alias:
                            normalized_aliases.append(alias)
                    value = json.dumps(normalized_aliases)
                if key == "subscription_ports":
                    if value is None:
                        value = []
                    if not isinstance(value, list):
                        raise ValueError("subscription_ports must be a list")
                    value = json.dumps(cls._normalize_ports(value))
                setattr(record, key, value)
            record.updated_at = _now()
            db.add(record)
            db.commit()
            db.refresh(record)
            return cls._serialize(record)
        except Exception:
            db.rollback()
            raise
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def get_effective_settings(
        cls,
        admin: Optional["Admin"] = None,
        *,
        ensure_record: bool = True,
        db: Optional[Session] = None,
    ) -> EffectiveSubscriptionSettings:
        base = cls.get_settings(ensure_record=ensure_record, db=db)
        effective = EffectiveSubscriptionSettings(**base.__dict__)

        overrides: Dict[str, Any] = {}
        if admin is not None:
            overrides = getattr(admin, "subscription_settings", None) or {}
            if admin.subscription_domain:
                effective.subscription_domain = admin.subscription_domain.strip()

        for key, value in overrides.items():
            if value in (None, ""):
                continue
            if hasattr(effective, key):
                if key == "subscription_url_prefix":
                    value = cls._normalize_prefix(value)
                if key == "subscription_support_url":
                    value = cls._normalize_support_url(value)
                if key in {"subscription_profile_title", "subscription_update_interval"}:
                    value = str(value).strip()
                if key == "subscription_path":
                    value = cls._normalize_path(str(value))
                if key == "subscription_path":
                    value = cls._normalize_path(str(value))
                if isinstance(value, str):
                    value = value.strip()
                if key.startswith("use_custom_json"):
                    value = bool(value)
                setattr(effective, key, value)

        if effective.subscription_domain:
            effective.subscription_url_prefix = cls._normalize_prefix(cls._ensure_scheme(effective.subscription_domain))
        else:
            effective.subscription_url_prefix = cls._normalize_prefix(effective.subscription_url_prefix)

        effective.subscription_support_url = cls._normalize_support_url(effective.subscription_support_url)

        return effective

    @classmethod
    def build_subscription_base(cls, settings: EffectiveSubscriptionSettings, *, salt: Optional[str] = None) -> str:
        return cls.build_subscription_bases(settings, salt=salt)[0]

    @classmethod
    def build_subscription_bases(cls, settings: EffectiveSubscriptionSettings, *, salt: Optional[str] = None) -> List[str]:
        prefix = settings.subscription_url_prefix or ""
        if salt:
            prefix = prefix.replace("*", salt)
        path = (settings.subscription_path or "sub").strip("/")
        if not prefix:
            return [f"/{path}"]

        bases=[f"{prefix.rstrip('/')}/{path}"]
        ports = cls._normalize_ports(getattr(settings, 'subscription_ports', []))
        if ports and prefix.startswith('http'):
            from urllib.parse import urlsplit, urlunsplit
            parts=urlsplit(prefix)
            host = parts.hostname or ''
            for p in ports:
                netloc = f"{host}:{p}"
                if parts.username:
                    auth = parts.username + ((":" + (parts.password or "")) if parts.password else "")
                    netloc = f"{auth}@{netloc}"
                alt=urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)).rstrip('/') + f"/{path}"
                if alt not in bases:
                    bases.append(alt)
        return bases


class SubscriptionCertificateService:
    """Manage SSL certificates through maintenance service and database records."""

    @staticmethod
    def _normalize_domains(domains: Sequence[str]) -> List[str]:
        normalized: List[str] = []
        for raw in domains:
            cleaned = (raw or "").strip()
            if not cleaned:
                continue
            if not DOMAIN_PATTERN.match(cleaned):
                raise ValueError(f"Invalid domain: {cleaned}")
            normalized.append(cleaned)
        if not normalized:
            raise ValueError("At least one domain must be provided")
        return normalized

    @staticmethod
    def _metadata_for_domain(domain: str) -> Dict[str, Any]:
        metadata_path = CERT_BASE_PATH / domain / ".metadata"
        if not metadata_path.exists():
            return {}
        try:
            content = metadata_path.read_text().splitlines()
        except Exception:
            return {}
        data: Dict[str, Any] = {}
        for line in content:
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
        if "domains" in data and isinstance(data["domains"], str):
            data["domains"] = [entry for entry in data["domains"].split() if entry]
        return data

    @staticmethod
    def _path_for_domain(domain: str) -> str:
        return str(CERT_BASE_PATH / domain) + "/"

    @classmethod
    def _serialize(cls, record: "SubscriptionDomain") -> SubscriptionDomainData:
        alt_names = record.alt_names or []
        if isinstance(alt_names, str):
            alt_names = [entry for entry in alt_names.split(",") if entry.strip()]
        return SubscriptionDomainData(
            id=record.id,
            domain=record.domain,
            admin_id=record.admin_id,
            email=record.email,
            provider=record.provider,
            alt_names=list(alt_names),
            last_issued_at=record.last_issued_at,
            last_renewed_at=record.last_renewed_at,
            path=cls._path_for_domain(record.domain),
        )

    @classmethod
    def list_certificates(cls, *, db: Optional[Session] = None) -> List[SubscriptionDomainData]:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            _, SubscriptionDomain, _ = _models()
            records = db.query(SubscriptionDomain).order_by(SubscriptionDomain.domain.asc()).all()
            return [cls._serialize(rec) for rec in records]
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def _upsert_domain(
        cls,
        domain: str,
        *,
        email: Optional[str],
        admin_id: Optional[int],
        alt_names: Optional[Sequence[str]] = None,
        provider: Optional[str] = None,
        issued_at: Optional[datetime] = None,
        renewed_at: Optional[datetime] = None,
        db: Session,
    ) -> "SubscriptionDomain":
        _, SubscriptionDomain, _ = _models()
        record = db.query(SubscriptionDomain).filter(SubscriptionDomain.domain == domain).first()
        if record is None:
            record = SubscriptionDomain(domain=domain)
        record.admin_id = admin_id
        record.email = email
        record.provider = provider or record.provider
        if alt_names is not None:
            record.alt_names = list(alt_names)
        elif record.alt_names is None:
            record.alt_names = []
        if issued_at:
            record.last_issued_at = issued_at
        if renewed_at:
            record.last_renewed_at = renewed_at
        record.updated_at = _now()
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    @classmethod
    def issue_certificate(
        cls,
        *,
        email: str,
        domains: Sequence[str],
        admin_id: Optional[int] = None,
        provider: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> SubscriptionDomainData:
        normalized_domains = cls._normalize_domains(domains)
        payload = {"email": email, "domains": normalized_domains}

        maintenance_request("POST", "/ssl/issue", json=payload)

        metadata = cls._metadata_for_domain(normalized_domains[0])
        alt_names = metadata.get("domains") or normalized_domains[1:]
        provider_used = provider or metadata.get("provider")
        email_used = metadata.get("email", email)

        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            record = cls._upsert_domain(
                normalized_domains[0],
                email=email_used,
                admin_id=admin_id,
                alt_names=alt_names,
                provider=provider_used,
                issued_at=_now(),
                renewed_at=_now(),
                db=db,
            )
            return cls._serialize(record)
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def renew_certificate(
        cls,
        *,
        domain: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> Optional[SubscriptionDomainData]:
        payload = {"domain": domain} if domain else {}
        maintenance_request("POST", "/ssl/renew", json=payload or None)

        if not domain:
            return None

        metadata = cls._metadata_for_domain(domain)
        alt_names = metadata.get("domains")
        provider_used = metadata.get("provider")
        email_used = metadata.get("email")

        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            record = cls._upsert_domain(
                domain,
                email=email_used,
                admin_id=None,
                alt_names=alt_names,
                provider=provider_used,
                renewed_at=_now(),
                db=db,
            )
            return cls._serialize(record)
        finally:
            if close_db and db is not None:
                db.close()
