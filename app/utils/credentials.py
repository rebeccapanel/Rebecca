import hashlib
import secrets
import uuid
from functools import lru_cache
from typing import TYPE_CHECKING, Dict, MutableMapping, Optional, Union
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
) -> dict:
    """
    Serialize proxy settings for storage in the database.
    
    Args:
        settings: Proxy settings object
        proxy_type: Type of proxy protocol
        credential_key: User's credential key (if exists)
        preserve_existing_uuid: If True, preserve existing UUID in proxies table when credential_key exists.
                                This is used for existing users with UUIDs. For new users, set to False.
    
    Returns:
        Serialized proxy settings dictionary
    """
    data = settings.dict(no_obj=True)

    if credential_key:
        if proxy_type in UUID_PROTOCOLS:
            # For new users: don't save UUID (it will be generated at runtime from key)
            # For existing users: preserve UUID if it exists and preserve_existing_uuid is True
            if not preserve_existing_uuid:
                data.pop("id", None)
            # If preserve_existing_uuid is True and UUID exists, keep it
            # If preserve_existing_uuid is True but UUID doesn't exist, don't add one
        if proxy_type in PASSWORD_PROTOCOLS:
            data.pop("password", None)
    else:
        if proxy_type in UUID_PROTOCOLS and not data.get("id"):
            data["id"] = str(uuid.uuid4())
        if proxy_type in PASSWORD_PROTOCOLS and not data.get("password"):
            data["password"] = random_password()
        if proxy_type == ProxyTypes.Shadowsocks and not data.get("method"):
            data["method"] = ShadowsocksMethods.CHACHA20_POLY1305.value

    return data


def apply_credentials_to_settings(
    settings: ProxySettings,
    proxy_type: ProxyTypes,
    credential_key: Optional[str],
) -> None:
    if not credential_key:
        return

    normalized = normalize_key(credential_key)
    if proxy_type in UUID_PROTOCOLS:
        setattr(settings, "id", key_to_uuid(normalized, proxy_type))
    if proxy_type == ProxyTypes.Trojan:
        setattr(settings, "password", key_to_password(normalized, proxy_type.value))
    if proxy_type == ProxyTypes.Shadowsocks:
        setattr(settings, "password", key_to_password(normalized, proxy_type.value))
        if getattr(settings, "method", None) is None:
            settings.method = ShadowsocksMethods.CHACHA20_POLY1305


def runtime_proxy_settings(
    settings: ProxySettings,
    proxy_type: ProxyTypes,
    credential_key: Optional[str],
) -> dict:
    data = settings.dict(no_obj=True)
    if credential_key:
        normalized = normalize_key(credential_key)
        if proxy_type in UUID_PROTOCOLS:
            data["id"] = str(key_to_uuid(normalized, proxy_type))
        if proxy_type == ProxyTypes.Trojan:
            data["password"] = key_to_password(normalized, proxy_type.value)
        if proxy_type == ProxyTypes.Shadowsocks:
            data["password"] = key_to_password(normalized, proxy_type.value)
            data.setdefault("method", ShadowsocksMethods.CHACHA20_POLY1305.value)
    else:
        if proxy_type in UUID_PROTOCOLS and "id" not in data:
            raise ValueError(f"UUID is required for proxy type {proxy_type}")
        if proxy_type in PASSWORD_PROTOCOLS and "password" not in data:
            raise ValueError(f"Password is required for proxy type {proxy_type}")
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
