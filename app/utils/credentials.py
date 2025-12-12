import hashlib
import secrets
import uuid
import re
from functools import lru_cache
from typing import TYPE_CHECKING, Any, Dict, MutableMapping, Optional, Union
from uuid import UUID

from app.models.proxy import ProxySettings, ProxyTypes, ShadowsocksMethods
from app.utils.system import random_password

if TYPE_CHECKING:
    from app.models.user import UserCreate


UUID_PROTOCOLS = {ProxyTypes.VMess, ProxyTypes.VLESS}
PASSWORD_PROTOCOLS = {ProxyTypes.Trojan, ProxyTypes.Shadowsocks}


def _get_uuid_masks() -> Dict[ProxyTypes, bytes]:
    """
    Retrieves UUID masks from database.
    Note: Not using lru_cache here because masks might change after migration.
    """
    from app.db import GetDB, get_uuid_masks

    with GetDB() as db:
        masks = get_uuid_masks(db)
        return {
            ProxyTypes.VMess: bytes.fromhex(masks["vmess_mask"]),
            ProxyTypes.VLESS: bytes.fromhex(masks["vless_mask"]),
        }


def get_protocol_uuid_masks() -> Dict[ProxyTypes, bytes]:
    """
    Get UUID masks for protocols from database.
    This function loads masks from database.
    """
    return _get_uuid_masks()


def _apply_mask(value: bytes, mask: bytes) -> bytes:
    return bytes(b ^ mask[i] for i, b in enumerate(value))


def generate_key() -> str:
    return secrets.token_hex(16)


def normalize_key(key: str) -> str:
    cleaned = key.replace("-", "").strip().lower()
    if len(cleaned) != 32 or any(ch not in "0123456789abcdef" for ch in cleaned):
        raise ValueError("credential key must be a 32 character hex string")
    return cleaned


def key_to_uuid(key: str, proxy_type: ProxyTypes | None = None) -> uuid.UUID:
    normalized = normalize_key(key)
    key_bytes = bytearray.fromhex(normalized)
    masks = get_protocol_uuid_masks()
    mask = masks.get(proxy_type)
    if mask:
        key_bytes = bytearray(_apply_mask(bytes(key_bytes), mask))
    return uuid.UUID(bytes=bytes(key_bytes))


def uuid_to_key(value: uuid.UUID | str, proxy_type: ProxyTypes | None = None) -> str:
    uuid_bytes = bytearray(uuid.UUID(str(value)).bytes)
    masks = get_protocol_uuid_masks()
    mask = masks.get(proxy_type)
    if mask:
        uuid_bytes = bytearray(_apply_mask(bytes(uuid_bytes), mask))
    return uuid_bytes.hex()


def key_to_password(key: str, label: str) -> str:
    normalized = normalize_key(key)
    digest = hashlib.sha256(f"{label}:{normalized}".encode()).hexdigest()
    return digest[:32]


def serialize_proxy_settings(
    settings: ProxySettings,
    proxy_type: ProxyTypes,
    credential_key: Optional[str],
    preserve_existing_uuid: bool = False,
    allow_auto_generate: bool = True,
) -> dict:
    """
    Serialize proxy settings for storage in the database.

    Args:
        settings: Proxy settings object
        proxy_type: Type of proxy protocol
        credential_key: User's credential key (if exists)
        preserve_existing_uuid: If True, preserve existing UUID in proxies table when credential_key exists.
                                This is used for existing users with UUIDs. For new users, set to False.
        allow_auto_generate: If False, don't auto-generate UUID/password when credential_key is None.
                             This is used in update_user to prevent auto-generating credentials.

    Returns:
        Serialized proxy settings dictionary
    """
    data = settings.dict(no_obj=True)
    # flow should live on the user, not per-proxy
    data.pop("flow", None)

    if credential_key:
        if proxy_type in UUID_PROTOCOLS:
            derived_id = str(key_to_uuid(credential_key, proxy_type))
            if not preserve_existing_uuid or not data.get("id"):
                data["id"] = derived_id
        if proxy_type in PASSWORD_PROTOCOLS:
            data.pop("password", None)
    else:
        if allow_auto_generate:
            if proxy_type in UUID_PROTOCOLS and not data.get("id"):
                data["id"] = str(uuid.uuid4())
            if proxy_type in PASSWORD_PROTOCOLS and not data.get("password"):
                data["password"] = random_password()
            if proxy_type == ProxyTypes.Shadowsocks and not data.get("method"):
                data["method"] = ShadowsocksMethods.CHACHA20_POLY1305.value

    return data


def apply_credentials_to_settings(
    settings: ProxySettings | dict,
    proxy_type: ProxyTypes | str,
    credential_key: Optional[str],
) -> ProxySettings:
    """
    Ensure settings carry credentials derived from credential_key.
    Accepts proxy_type as enum or string and settings as ProxySettings or dict.
    Returns a ProxySettings instance (also mutated in place when possible).
    """
    try:
        resolved_type = proxy_type if isinstance(proxy_type, ProxyTypes) else ProxyTypes(str(proxy_type))
    except Exception:
        return settings if isinstance(settings, ProxySettings) else settings  # type: ignore[return-value]

    settings_obj = settings if isinstance(settings, ProxySettings) else ProxySettings.from_dict(resolved_type, settings)

    if not credential_key:
        return settings_obj

    normalized = normalize_key(credential_key)
    if resolved_type in UUID_PROTOCOLS:
        setattr(settings_obj, "id", key_to_uuid(normalized, resolved_type))
    if resolved_type == ProxyTypes.Trojan:
        setattr(settings_obj, "password", key_to_password(normalized, resolved_type.value))
    if resolved_type == ProxyTypes.Shadowsocks:
        setattr(settings_obj, "password", key_to_password(normalized, resolved_type.value))
        if getattr(settings_obj, "method", None) is None:
            settings_obj.method = ShadowsocksMethods.CHACHA20_POLY1305

    return settings_obj


def runtime_proxy_settings(
    settings: ProxySettings,
    proxy_type: ProxyTypes,
    credential_key: Optional[str],
    flow: Optional[str] = None,
) -> dict:
    def _sanitize_uuid(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, str):
            cleaned = value.strip()
            try:
                return str(UUID(cleaned))
            except Exception:
                cleaned = re.sub(r"[^0-9a-fA-F-]", "", cleaned)
                try:
                    return str(UUID(cleaned))
                except Exception:
                    return None
        return None

    if isinstance(settings, ProxySettings):
        data = settings.dict(no_obj=True)
    elif isinstance(settings, dict):
        try:
            model = proxy_type.settings_model.model_validate(settings)
            data = model.dict(no_obj=True)
        except Exception:
            data = dict(settings)
    else:
        data = {}

    # Remove persisted flow; flow is now user-scoped
    data.pop("flow", None)

    current_id = data.get("id") or data.get("uuid")
    sanitized_id = _sanitize_uuid(current_id)
    normalized_key: Optional[str] = None
    if credential_key:
        normalized_key = normalize_key(credential_key)

    # UUID/password priority:
    #   1) Persisted value from proxies table (sanitized)
    #   2) Derived from credential_key
    #   3) Auto-generated (where allowed)
    if proxy_type in UUID_PROTOCOLS:
        if sanitized_id:
            data["id"] = sanitized_id
        elif normalized_key:
            data["id"] = str(key_to_uuid(normalized_key, proxy_type))
        else:
            raise ValueError(f"UUID is required for proxy type {proxy_type}")

    if proxy_type == ProxyTypes.Trojan:
        if data.get("password"):
            pass  # keep stored password
        elif normalized_key:
            data["password"] = key_to_password(normalized_key, proxy_type.value)
        else:
            data.setdefault("password", random_password())

    if proxy_type == ProxyTypes.Shadowsocks:
        if data.get("password"):
            pass  # keep stored password
        elif normalized_key:
            data["password"] = key_to_password(normalized_key, proxy_type.value)
        else:
            data.setdefault("password", random_password())
        data.setdefault("method", ShadowsocksMethods.CHACHA20_POLY1305.value)

    if flow:
        data["flow"] = flow

    return data


def _as_proxy_type(value: Union[str, ProxyTypes]) -> ProxyTypes:
    """Convert a string or ProxyTypes to ProxyTypes enum."""
    return value if isinstance(value, ProxyTypes) else ProxyTypes(value)


def _derive_key_from_proxies(
    proxies: Optional[MutableMapping[Union[str, ProxyTypes], ProxySettings]],
) -> Optional[str]:
    """Derive a credential key from existing UUIDs in proxy settings."""
    candidate: Optional[str] = None
    if not proxies:
        return None
    for proxy_key, settings in proxies.items():
        proxy_type = _as_proxy_type(proxy_key)
        if proxy_type not in UUID_PROTOCOLS:
            continue
        uuid_value: Optional[UUID] = getattr(settings, "id", None)
        if not uuid_value:
            continue
        derived = uuid_to_key(uuid_value, proxy_type)
        if candidate and candidate != derived:
            raise ValueError("VMess and VLESS UUIDs must match when deriving credential keys")
        candidate = derived
    return candidate


def _strip_proxy_credentials(
    proxies: Optional[MutableMapping[Union[str, ProxyTypes], ProxySettings]],
) -> None:
    """Remove UUID/password from proxy settings before persisting to database."""
    if not proxies:
        return
    for proxy_key, settings in proxies.items():
        proxy_type = _as_proxy_type(proxy_key)
        if proxy_type in UUID_PROTOCOLS and getattr(settings, "id", None):
            settings.id = None
        if proxy_type in PASSWORD_PROTOCOLS and getattr(settings, "password", None):
            settings.password = None


def ensure_user_credential_key(user: "UserCreate") -> str:
    """
    Ensure a user payload has a normalized credential key and that static UUID/password
    values are stripped before persisting proxies.

    Args:
        user: UserCreate object to process

    Returns:
        The normalized credential key
    """
    if user.credential_key:
        credential_key = normalize_key(user.credential_key)
    else:
        credential_key = _derive_key_from_proxies(user.proxies)
        if not credential_key:
            credential_key = generate_key()

    user.credential_key = credential_key
    _strip_proxy_credentials(user.proxies)
    return credential_key
