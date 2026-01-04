import re
import secrets
from datetime import datetime
import math
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from contextvars import ContextVar

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.admin import Admin
from app.models.proxy import ProxySettings, ProxyTypes
from app.subscription.share import generate_v2ray_links
from app.utils.credentials import (
    apply_credentials_to_settings,
    runtime_proxy_settings,
    PASSWORD_PROTOCOLS,
    UUID_PROTOCOLS,
)
from xray_api.types.account import Account
from app.utils.jwt import create_subscription_token
from config import XRAY_SUBSCRIPTION_PATH

# Fallback import to avoid deployment breakage when settings model isn't updated yet
try:  # pragma: no cover
    from app.models.settings import SubscriptionLinkType
except Exception:  # pragma: no cover - defensive

    class SubscriptionLinkType(str, Enum):
        username_key = "username-key"
        key = "key"
        token = "token"


USERNAME_REGEXP = re.compile(r"^(?=\w{3,32}\b)[a-zA-Z0-9-_@.]+(?:_[a-zA-Z0-9-_@.]+)*$")

_skip_expensive_computations: ContextVar[bool] = ContextVar("skip_expensive_computations", default=False)

ALLOWED_FLOW_VALUES = {
    None,
    "",
    "xtls-rprx-vision",
    "xtls-rprx-vision-udp443",
}


def _normalize_ip_limit(value) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed or trimmed == "-":
            return 0
        try:
            value = int(float(trimmed))
        except (TypeError, ValueError):
            raise ValueError("ip_limit must be a number or '-' for unlimited")
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("ip_limit must be a finite number")
        value = int(value)
    if isinstance(value, int):
        return value if value > 0 else 0
    raise ValueError("ip_limit must be numeric")


class ReminderType(str, Enum):
    expiration_date = "expiration_date"
    data_usage = "data_usage"


class UserStatus(str, Enum):
    active = "active"
    disabled = "disabled"
    limited = "limited"
    expired = "expired"
    on_hold = "on_hold"
    deleted = "deleted"


class AdvancedUserAction(str, Enum):
    extend_expire = "extend_expire"
    reduce_expire = "reduce_expire"
    increase_traffic = "increase_traffic"
    decrease_traffic = "decrease_traffic"
    cleanup_status = "cleanup_status"
    activate_users = "activate_users"
    disable_users = "disable_users"
    change_service = "change_service"


class UserStatusModify(str, Enum):
    active = "active"
    disabled = "disabled"
    on_hold = "on_hold"


class UserStatusCreate(str, Enum):
    active = "active"
    on_hold = "on_hold"


class UserDataLimitResetStrategy(str, Enum):
    no_reset = "no_reset"
    day = "day"
    week = "week"
    month = "month"
    year = "year"


class BulkUsersActionRequest(BaseModel):
    action: AdvancedUserAction
    days: Optional[int] = None
    gigabytes: Optional[float] = None
    statuses: Optional[List[UserStatus]] = None
    admin_username: Optional[str] = None
    service_id: Optional[int] = None
    target_service_id: Optional[int] = None
    service_id_is_null: Optional[bool] = None

    @model_validator(mode="after")
    def _validate_action(self):
        action = self.action
        days = self.days
        gigabytes = self.gigabytes
        statuses = self.statuses
        target_service_id = self.target_service_id

        needs_days = {
            AdvancedUserAction.extend_expire,
            AdvancedUserAction.reduce_expire,
            AdvancedUserAction.cleanup_status,
        }

        if action in needs_days:
            if not isinstance(days, int) or days <= 0:
                raise ValueError("days must be a positive integer")

        if action in (AdvancedUserAction.increase_traffic, AdvancedUserAction.decrease_traffic):
            if gigabytes is None or not isinstance(gigabytes, (int, float)) or gigabytes <= 0:
                raise ValueError("gigabytes must be a positive number")

        if action == AdvancedUserAction.cleanup_status:
            allowed = {UserStatus.expired, UserStatus.limited}
            resolved_statuses = statuses or list(allowed)
            invalid = [status for status in resolved_statuses if status not in allowed]
            if invalid:
                raise ValueError("cleanup_status only accepts expired or limited")
            self.statuses = resolved_statuses

        service_id = self.service_id
        if service_id is not None and service_id <= 0:
            raise ValueError("service_id must be a positive integer")
        if action == AdvancedUserAction.change_service:
            if target_service_id is not None and target_service_id <= 0:
                raise ValueError("target_service_id must be a positive integer when provided for change_service")
        if self.service_id_is_null and service_id is not None:
            raise ValueError("service_id and service_id_is_null cannot both be set")

        return self


class NextPlanModel(BaseModel):
    data_limit: Optional[int] = None
    expire: Optional[int] = None
    add_remaining_traffic: bool = False
    fire_on_either: bool = True
    increase_data_limit: bool = False
    start_on_first_connect: bool = False
    trigger_on: str = "either"
    position: int = 0
    model_config = ConfigDict(from_attributes=True)


class User(BaseModel):
    credential_key: Optional[str] = None
    key_subscription_url: Optional[str] = None
    proxies: Dict[ProxyTypes, ProxySettings] = {}
    flow: Optional[str] = None
    expire: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    data_limit: Optional[int] = Field(ge=0, default=None, description="data_limit can be 0 or greater")
    data_limit_reset_strategy: UserDataLimitResetStrategy = UserDataLimitResetStrategy.no_reset
    inbounds: Dict[ProxyTypes, List[str]] = {}
    note: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    telegram_id: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    contact_number: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    sub_updated_at: Optional[datetime] = Field(default=None, json_schema_extra={"nullable": True})
    sub_last_user_agent: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    online_at: Optional[datetime] = Field(default=None, json_schema_extra={"nullable": True})
    on_hold_expire_duration: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    on_hold_timeout: Optional[Union[datetime, None]] = Field(default=None, json_schema_extra={"nullable": True})
    ip_limit: int = Field(
        0,
        ge=0,
        description="Maximum number of unique IPs allowed (0 = unlimited)",
    )

    auto_delete_in_days: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})

    next_plan: Optional[NextPlanModel] = Field(default=None, json_schema_extra={"nullable": True})
    next_plans: Optional[List[NextPlanModel]] = Field(default=None, json_schema_extra={"nullable": True})

    @property
    def proxy_type(self) -> Optional[ProxyTypes]:
        if not self.proxies:
            return None
        first = next(iter(self.proxies))
        return first if isinstance(first, ProxyTypes) else ProxyTypes(first)

    @field_validator("flow", mode="before")
    def validate_flow(cls, value):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if normalized in ALLOWED_FLOW_VALUES:
                return normalized
        raise ValueError("Unsupported flow value")

    @field_validator("telegram_id", mode="before")
    def validate_telegram_id(cls, value):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed == "":
                return None
            if re.match(r"^[\w.@+\- ]+$", trimmed):
                return trimmed
        raise ValueError("Invalid telegram_id format")

    @field_validator("contact_number", mode="before")
    def validate_contact_number(cls, value):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed == "":
                return None
            if re.match(r"^[0-9+\-() ]+$", trimmed):
                return trimmed
        raise ValueError("Invalid contact_number format")

    def _account_email(self) -> str:
        identifier = getattr(self, "id", None)
        if identifier:
            return f"{identifier}.{self.username}"
        return self.username

    def get_account(
        self,
        proxy_type: Optional[ProxyTypes | str] = None,
        *,
        credential_key: Optional[str] = None,
    ) -> Account:
        resolved_type = proxy_type or self.proxy_type
        if resolved_type is None:
            raise ValueError("Proxy type is missing for account generation")
        resolved_type = resolved_type if isinstance(resolved_type, ProxyTypes) else ProxyTypes(resolved_type)

        settings = self.proxies.get(resolved_type) or self.proxies.get(resolved_type.value)
        if settings is None:
            raise ValueError(f"Proxy settings for {resolved_type.value} not provided")

        account_data = {"email": self._account_email()}
        runtime_key = credential_key or self.credential_key
        if runtime_key and self.flow:
            proxy_data = runtime_proxy_settings(settings, resolved_type, runtime_key, flow=self.flow)
        elif runtime_key:
            proxy_data = runtime_proxy_settings(settings, resolved_type, runtime_key)
            proxy_data.pop("flow", None)
        else:
            proxy_data = settings.dict(no_obj=True)
            if not self.flow:
                proxy_data.pop("flow", None)

        if resolved_type in UUID_PROTOCOLS and "id" not in proxy_data:
            raise ValueError("UUID is required for proxy type %s" % resolved_type.value)

        account_data.update(proxy_data)
        return resolved_type.account_model(**account_data)

    @field_validator("data_limit", mode="before")
    def cast_to_int(cls, v):
        if v is None:  # Allow None values
            return v
        if isinstance(v, float):  # Allow float to int conversion
            return int(v)
        if isinstance(v, int):  # Allow integers directly
            return v
        raise ValueError("data_limit must be an integer or a float, not a string")  # Reject strings

    @field_validator("proxies", mode="before")
    def validate_proxies(cls, v, values, **kwargs):
        if not v:
            return {}
        return {proxy_type: ProxySettings.from_dict(proxy_type, v.get(proxy_type, {})) for proxy_type in v}

    @field_validator("username", check_fields=False)
    @classmethod
    def validate_username(cls, v):
        if not USERNAME_REGEXP.match(v):
            raise ValueError(
                "Username only can be 3 to 32 characters and contain a-z, 0-9, and underscores in between."
            )
        return v

    @field_validator("note", check_fields=False)
    @classmethod
    def validate_note(cls, v):
        if v and len(v) > 500:
            raise ValueError("User's note can be a maximum of 500 character")
        return v

    @field_validator("on_hold_expire_duration", "on_hold_timeout", mode="before")
    def validate_timeout(cls, v, values):
        # Check if expire is 0 or None and timeout is not 0 or None
        if v in (0, None):
            return None
        return v

    @field_validator("ip_limit", mode="before")
    def normalize_ip_limit(cls, value):
        return _normalize_ip_limit(value)


class UserCreate(User):
    username: str
    status: UserStatusCreate = None
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "username": "user1234",
                "proxies": {
                    "vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"},
                    "vless": {},
                },
                "inbounds": {
                    "vmess": ["VMess TCP", "VMess Websocket"],
                    "vless": ["VLESS TCP REALITY", "VLESS GRPC REALITY"],
                },
                "next_plan": {"data_limit": 0, "expire": 0, "add_remaining_traffic": False, "fire_on_either": True},
                "expire": 0,
                "data_limit": 0,
                "data_limit_reset_strategy": "no_reset",
                "status": "active",
                "note": "",
                "on_hold_timeout": "2023-11-03T20:30:00",
                "on_hold_expire_duration": 0,
            }
        }
    )

    @property
    def excluded_inbounds(self):
        from app.runtime import xray

        excluded = {}
        for proxy_type in self.proxies:
            excluded[proxy_type] = []
            for inbound in xray.config.inbounds_by_protocol.get(proxy_type, []):
                if inbound["tag"] not in self.inbounds.get(proxy_type, []):
                    excluded[proxy_type].append(inbound["tag"])

        return excluded

    @field_validator("inbounds", mode="before")
    def validate_inbounds(cls, inbounds, values, **kwargs):
        from app.runtime import xray
        from app.services.data_access import get_service_host_map_cached
        from app.db import GetDB
        from app.models.proxy import ProxyTypes

        proxies = values.data.get("proxies", {})
        service_id = values.data.get("service_id")

        # delete inbounds that are for protocols not activated
        for proxy_type in list(inbounds.keys()):
            proxy_type_str = proxy_type.value if hasattr(proxy_type, "value") else str(proxy_type)
            if proxy_type_str not in proxies and proxy_type not in proxies:
                del inbounds[proxy_type]

        # check by proxies to ensure that every protocol has inbounds set
        for proxy_type_key, proxy_settings in proxies.items():
            if isinstance(proxy_type_key, str):
                try:
                    proxy_type = ProxyTypes(proxy_type_key)
                except ValueError:
                    continue
            else:
                proxy_type = proxy_type_key

            tags = inbounds.get(proxy_type) or inbounds.get(proxy_type_key)

            if tags:
                # Validate that all specified tags exist
                for tag in tags:
                    if tag not in xray.config.inbounds_by_tag:
                        raise ValueError(f"Inbound {tag} doesn't exist")
                    # For no-service mode, also check if tag has enabled hosts
                    # Only validate if host_map is available and tag exists in it
                    if service_id is None:
                        try:
                            with GetDB():
                                host_map = get_service_host_map_cached(None, force_refresh=False)
                                # Only check if host_map has this tag
                                if tag in host_map:
                                    tag_hosts = host_map.get(tag, [])
                                    if not tag_hosts or all(h.get("is_disabled", False) for h in tag_hosts):
                                        raise ValueError(f"Inbound {tag} has no enabled hosts")
                        except Exception:
                            # If we can't get host_map (e.g., in tests), skip the check
                            pass

            # elif isinstance(tags, list) and not tags:
            #     raise ValueError(f"{proxy_type} inbounds cannot be empty")

            else:
                if service_id is None:
                    try:
                        with GetDB():
                            host_map = get_service_host_map_cached(None, force_refresh=False)
                            enabled_inbound_tags = set()
                            for tag, hosts in host_map.items():
                                if hosts and any(not h.get("is_disabled", False) for h in hosts):
                                    enabled_inbound_tags.add(tag)

                            protocol_str = proxy_type.value if hasattr(proxy_type, "value") else str(proxy_type)
                            protocol_inbounds = xray.config.inbounds_by_protocol.get(protocol_str, [])
                            enabled_tags = [i["tag"] for i in protocol_inbounds if i["tag"] in enabled_inbound_tags]
                            inbounds[proxy_type] = enabled_tags
                    except Exception:
                        # If we can't get host_map (e.g., in tests), fall back to all inbounds
                        protocol_str = proxy_type.value if hasattr(proxy_type, "value") else str(proxy_type)
                        inbounds[proxy_type] = [
                            i["tag"] for i in xray.config.inbounds_by_protocol.get(protocol_str, [])
                        ]
                else:
                    protocol_str = proxy_type.value if hasattr(proxy_type, "value") else str(proxy_type)
                    inbounds[proxy_type] = [i["tag"] for i in xray.config.inbounds_by_protocol.get(protocol_str, [])]

        return inbounds

    @model_validator(mode="after")
    def ensure_proxies(self):
        if not self.proxies:
            raise ValueError("Each user needs at least one proxy")
        return self

    @field_validator("status", mode="before")
    def validate_status(cls, status, values):
        on_hold_expire = values.data.get("on_hold_expire_duration")
        expire = values.data.get("expire")
        if status == UserStatusCreate.on_hold:
            if on_hold_expire == 0 or on_hold_expire is None:
                raise ValueError("User cannot be on hold without a valid on_hold_expire_duration.")
            if expire:
                raise ValueError("User cannot be on hold with specified expire.")
        return status


class UserModify(User):
    status: UserStatusModify = None
    data_limit_reset_strategy: UserDataLimitResetStrategy = None
    service_id: Optional[int] = None
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "proxies": {
                    "vmess": {"id": "35e4e39c-7d5c-4f4b-8b71-558e4f37ff53"},
                    "vless": {},
                },
                "inbounds": {
                    "vmess": ["VMess TCP", "VMess Websocket"],
                    "vless": ["VLESS TCP REALITY", "VLESS GRPC REALITY"],
                },
                "next_plan": {"data_limit": 0, "expire": 0, "add_remaining_traffic": False, "fire_on_either": True},
                "expire": 0,
                "data_limit": 0,
                "data_limit_reset_strategy": "no_reset",
                "status": "active",
                "note": "",
                "on_hold_timeout": "2023-11-03T20:30:00",
                "on_hold_expire_duration": 0,
            }
        }
    )

    @property
    def excluded_inbounds(self):
        from app.runtime import xray

        excluded = {}
        for proxy_type in self.inbounds:
            excluded[proxy_type] = []
            for inbound in xray.config.inbounds_by_protocol.get(proxy_type, []):
                if inbound["tag"] not in self.inbounds.get(proxy_type, []):
                    excluded[proxy_type].append(inbound["tag"])

        return excluded

    @field_validator("inbounds", mode="before")
    def validate_inbounds(cls, inbounds, values, **kwargs):
        from app.runtime import xray

        # check with inbounds, "proxies" is optional on modifying
        # so inbounds particularly can be modified
        if inbounds:
            for proxy_type, tags in inbounds.items():
                # if not tags:
                #     raise ValueError(f"{proxy_type} inbounds cannot be empty")

                for tag in tags:
                    if tag not in xray.config.inbounds_by_tag:
                        raise ValueError(f"Inbound {tag} doesn't exist")

        return inbounds

    @field_validator("proxies", mode="before")
    def validate_proxies(cls, v):
        return {proxy_type: ProxySettings.from_dict(proxy_type, v.get(proxy_type, {})) for proxy_type in v}

    @field_validator("status", mode="before")
    def validate_status(cls, status, values):
        on_hold_expire = values.data.get("on_hold_expire_duration")
        expire = values.data.get("expire")
        if status == UserStatusCreate.on_hold:
            if on_hold_expire == 0 or on_hold_expire is None:
                raise ValueError("User cannot be on hold without a valid on_hold_expire_duration.")
            if expire:
                raise ValueError("User cannot be on hold with specified expire.")
        return status


class UserServiceCreate(BaseModel):
    username: str
    service_id: int
    status: UserStatusCreate | None = None
    expire: Optional[int] = None
    data_limit: Optional[int] = Field(None, ge=0)
    data_limit_reset_strategy: UserDataLimitResetStrategy = UserDataLimitResetStrategy.no_reset
    note: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    on_hold_timeout: Optional[Union[datetime, None]] = Field(default=None, json_schema_extra={"nullable": True})
    on_hold_expire_duration: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    auto_delete_in_days: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    next_plan: Optional[NextPlanModel] = Field(default=None, json_schema_extra={"nullable": True})
    next_plans: Optional[List[NextPlanModel]] = Field(default=None, json_schema_extra={"nullable": True})
    ip_limit: int = 0
    flow: Optional[str] = None
    credential_key: Optional[str] = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, value):
        return User.validate_username(value)

    @field_validator("note")
    @classmethod
    def validate_note(cls, value):
        return User.validate_note(value)

    @field_validator("ip_limit", mode="before")
    def normalize_ip_limit(cls, value):
        return _normalize_ip_limit(value)

    @field_validator("flow", mode="before")
    def validate_flow(cls, value):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if normalized in ALLOWED_FLOW_VALUES:
                return normalized
        raise ValueError("Unsupported flow value")


class UserResponse(User):
    username: str
    status: UserStatus
    used_traffic: int
    lifetime_used_traffic: int = 0
    next_plans: List[NextPlanModel] = Field(default_factory=list)
    created_at: datetime
    links: List[str] = Field(default_factory=list, exclude=True)  # Excluded from response to reduce payload
    subscription_url: str = ""
    subscription_urls: Dict[str, str] = Field(default_factory=dict)
    proxies: dict
    excluded_inbounds: Dict[ProxyTypes, List[str]] = {}
    service_id: int | None = None
    service_name: str | None = None
    admin_id: int | None = Field(default=None, exclude=True)
    service_host_orders: Dict[int, int] = Field(default_factory=dict)
    credentials: Dict[str, str] = Field(default_factory=dict, exclude=True)  # Excluded, use link_data instead
    link_data: List[Dict[str, Any]] = Field(default_factory=list)  # UUID/password for each inbound template

    admin: Optional[Admin] = None
    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def validate_links(self):
        # Skip expensive link generation when loading user lists
        if _skip_expensive_computations.get():
            return self
        if not self.links:
            self.links = generate_v2ray_links(
                self.proxies,
                self.inbounds,
                extra_data=self.model_dump(),
                reverse=False,
            )
        return self

    @model_validator(mode="after")
    def extract_credentials(self):
        """Extract credentials (UUID/password) from proxies for lightweight response."""
        if not self.credentials and self.proxies:
            from app.utils.credentials import UUID_PROTOCOLS, PASSWORD_PROTOCOLS

            for proxy_type_key, settings in self.proxies.items():
                try:
                    # Handle both ProxyTypes enum and string
                    if isinstance(proxy_type_key, ProxyTypes):
                        proxy_type = proxy_type_key
                        proxy_type_str = proxy_type.value
                    else:
                        proxy_type_str = str(proxy_type_key)
                        proxy_type = ProxyTypes(proxy_type_str)

                    # Convert ProxySettings to dict
                    if hasattr(settings, "dict"):
                        settings_dict = settings.dict(no_obj=True)
                    elif hasattr(settings, "model_dump"):
                        settings_dict = settings.model_dump()
                    elif isinstance(settings, dict):
                        settings_dict = settings
                    else:
                        continue

                    if proxy_type in UUID_PROTOCOLS:
                        uuid_value = settings_dict.get("id")
                        if uuid_value:
                            self.credentials[proxy_type_str] = str(uuid_value)
                    elif proxy_type in PASSWORD_PROTOCOLS:
                        password = settings_dict.get("password")
                        if password:
                            self.credentials[proxy_type_str] = str(password)
                except Exception:
                    continue
        return self

    @model_validator(mode="after")
    def validate_subscription_url(self):
        if _skip_expensive_computations.get():
            return self
        salt = secrets.token_hex(8)
        try:
            from app.services.subscription_settings import SubscriptionSettingsService

            admin_obj = getattr(self, "admin", None)
            if admin_obj is None and getattr(self, "admin_id", None):
                try:
                    from app.db.base import SessionLocal

                    db = SessionLocal()
                    admin_obj = db.query(Admin).filter(Admin.id == self.admin_id).first()
                except Exception:
                    admin_obj = None
                finally:
                    try:
                        db.close()
                    except Exception:
                        pass

            effective_settings = SubscriptionSettingsService.get_effective_settings(admin_obj)
            url_prefix = SubscriptionSettingsService.build_subscription_base(effective_settings, salt=salt)
        except Exception:
            url_prefix = f"/{XRAY_SUBSCRIPTION_PATH.strip('/')}"

        links: Dict[str, str] = {}
        if self.credential_key:
            links["username-key"] = f"{url_prefix}/{self.username}/{self.credential_key}"
            links["key"] = f"{url_prefix}/{self.credential_key}"

        token = create_subscription_token(self.username)
        links["token"] = f"{url_prefix}/{token}"

        self.subscription_urls = links

        # Lazy import to avoid circular import during Alembic/env loading
        try:
            from app.services.panel_settings import PanelSettingsService

            settings = PanelSettingsService.get_settings(ensure_record=True)
            preferred: str = settings.default_subscription_type or SubscriptionLinkType.key.value
        except Exception:
            preferred = SubscriptionLinkType.key.value

        order_map = {
            SubscriptionLinkType.username_key.value: ["username-key", "token", "key"],
            SubscriptionLinkType.key.value: ["key", "token", "username-key"],
            SubscriptionLinkType.token.value: ["token", "key", "username-key"],
        }

        chosen = None
        for candidate in order_map.get(preferred, ["key", "username-key", "token"]):
            if candidate in links:
                chosen = candidate
                break
        if chosen is None and links:
            chosen = next(iter(links.keys()))

        if chosen:
            self.subscription_url = links[chosen]
        else:
            self.subscription_url = ""

        # Preserve legacy field for compatibility
        if self.credential_key:
            self.key_subscription_url = links.get("key")  # type: ignore[attr-defined]
        return self

    @model_validator(mode="after")
    def populate_key_subscription_url(self):
        if _skip_expensive_computations.get():
            return self
        if self.credential_key and not hasattr(self, "key_subscription_url"):
            # Already handled in validate_subscription_url, keep compatibility no-op
            pass
        return self

    @model_validator(mode="after")
    def populate_proxy_credentials(self):
        if not self.credential_key:
            return self

        updated_proxies = {}
        for proxy_type, settings in self.proxies.items():
            try:
                resolved_type = proxy_type if isinstance(proxy_type, ProxyTypes) else ProxyTypes(str(proxy_type))
            except Exception:
                continue

            # Ensure settings is a ProxySettings instance
            settings_obj = settings
            if not isinstance(settings_obj, ProxySettings):
                try:
                    settings_obj = ProxySettings.from_dict(resolved_type, settings)
                except Exception:
                    continue

            # Only backfill missing credentials; keep DB as source of truth when a UUID/password already exists
            needs_uuid = resolved_type in UUID_PROTOCOLS and not getattr(settings_obj, "id", None)
            needs_password = resolved_type in PASSWORD_PROTOCOLS and not getattr(settings_obj, "password", None)
            if needs_uuid or needs_password:
                apply_credentials_to_settings(settings_obj, resolved_type, self.credential_key)

            updated_proxies[resolved_type] = settings_obj

        if updated_proxies:
            self.proxies = updated_proxies
        return self

    @field_validator("proxies", mode="before")
    def validate_proxies(cls, v, values, **kwargs):
        """
        Convert proxies from database format to runtime format.
        For UserResponse, we need to convert proxies to runtime format with proper UUIDs.
        """
        if isinstance(v, list):
            v = {p.type: p.settings for p in v}

        # Get credential_key from values if available (for UserResponse)
        credential_key = None
        if isinstance(values, dict):
            credential_key = (
                values.data.get("credential_key") if hasattr(values, "data") else values.get("credential_key")
            )

        # Convert to ProxySettings first (for validation)
        proxies_dict = super().validate_proxies(v, values, **kwargs)

        # Coerce keys to ProxyTypes for consistency
        coerced_proxies: Dict[ProxyTypes, ProxySettings] = {}
        for proxy_type, settings in proxies_dict.items():
            try:
                resolved_type = proxy_type if isinstance(proxy_type, ProxyTypes) else ProxyTypes(str(proxy_type))
            except Exception:
                continue
            coerced_proxies[resolved_type] = settings
        proxies_dict = coerced_proxies

        # If credential_key exists, convert proxies to runtime format
        # This ensures UUIDs are generated from credential_key
        if credential_key:
            runtime_proxies = {}
            for proxy_type, settings in proxies_dict.items():
                try:
                    # Convert to runtime format
                    runtime_settings = runtime_proxy_settings(
                        settings,
                        proxy_type,
                        credential_key,
                        flow=values.data.get("flow") if hasattr(values, "data") else values.get("flow"),
                    )
                    # Convert back to ProxySettings for validation
                    runtime_proxies[proxy_type] = ProxySettings.from_dict(proxy_type, runtime_settings)
                except Exception:
                    # If conversion fails, use original settings
                    runtime_proxies[proxy_type] = settings
            return runtime_proxies

        return proxies_dict

    @field_validator("used_traffic", "lifetime_used_traffic", mode="before")
    def cast_to_int(cls, v):
        if v is None:  # Allow None values
            return v
        if isinstance(v, float):  # Allow float to int conversion
            return int(v)
        if isinstance(v, int):  # Allow integers directly
            return v
        raise ValueError("must be an integer or a float, not a string")  # Reject strings


class UserCreateResponse(UserResponse):
    # Include share links in create-user responses.
    links: List[str] = Field(default_factory=list, exclude=False)


class SubscriptionUserResponse(UserResponse):
    admin: Admin | None = Field(default=None, exclude=True)
    excluded_inbounds: Dict[ProxyTypes, List[str]] | None = Field(None, exclude=True)
    note: str | None = Field(None, exclude=True)
    inbounds: Dict[ProxyTypes, List[str]] | None = Field(None, exclude=True)
    auto_delete_in_days: int | None = Field(None, exclude=True)
    model_config = ConfigDict(from_attributes=True)


class UserListItem(BaseModel):
    """
    Lightweight shape returned by /api/users list endpoint.
    For detailed user information, call /api/user/{username}.
    """

    username: str
    status: UserStatus
    used_traffic: int
    lifetime_used_traffic: int = 0
    created_at: datetime
    expire: Optional[int] = None
    data_limit: Optional[int] = None
    data_limit_reset_strategy: Optional[UserDataLimitResetStrategy] = None
    online_at: Optional[datetime] = None
    service_id: int | None = None
    service_name: str | None = None
    admin_id: int | None = None
    admin_username: str | None = None
    subscription_url: str = ""
    subscription_urls: Dict[str, str] = Field(default_factory=dict)
    model_config = ConfigDict(from_attributes=True)


class UsersResponse(BaseModel):
    users: List[UserListItem]
    link_templates: Dict[str, List[str]] = Field(default_factory=dict)
    total: int
    active_total: Optional[int] = None
    users_limit: Optional[int] = None
    status_breakdown: Dict[str, int] = Field(default_factory=dict)
    usage_total: Optional[int] = None
    online_total: Optional[int] = None


class UserUsageResponse(BaseModel):
    node_id: Union[int, None] = None
    node_name: str
    used_traffic: int

    @field_validator("used_traffic", mode="before")
    def cast_to_int(cls, v):
        if v is None:  # Allow None values
            return v
        if isinstance(v, float):  # Allow float to int conversion
            return int(v)
        if isinstance(v, int):  # Allow integers directly
            return v
        raise ValueError("must be an integer or a float, not a string")  # Reject strings


class UserUsagesResponse(BaseModel):
    username: str
    usages: List[UserUsageResponse]


class UsersUsagesResponse(BaseModel):
    usages: List[UserUsageResponse]
