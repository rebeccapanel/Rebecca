import secrets
from enum import Enum
from typing import Dict, Optional

from app.models.user import UserResponse
from app.utils.jwt import create_subscription_token
from config import XRAY_SUBSCRIPTION_PATH

# Lazy/fallback import to avoid hard dependency in environments missing updated settings model
try:  # pragma: no cover - defensive for mixed deployments
    from app.services.panel_settings import PanelSettingsService
    from app.models.settings import SubscriptionLinkType
except Exception:  # pragma: no cover - fallback definitions

    class SubscriptionLinkType(str, Enum):
        username_key = "username-key"
        key = "key"
        token = "token"

    class PanelSettingsService:  # type: ignore
        @staticmethod
        def get_settings(ensure_record: bool = True):
            class _Dummy:
                default_subscription_type = SubscriptionLinkType.key.value

            return _Dummy()


def build_subscription_links(
    user: UserResponse,
    *,
    preferred: Optional[str] = None,
) -> Dict[str, str]:
    """
    Build all available subscription URLs for a user and select primary based on preferred type.
    Does NOT generate credential keys; simply uses existing values.
    """
    salt = secrets.token_hex(8)
    try:
        from app.services.subscription_settings import SubscriptionSettingsService

        admin_obj = getattr(user, "admin", None)
        if admin_obj is None and getattr(user, "admin_id", None):
            try:
                from app.db.base import SessionLocal
                from app.db.models import Admin as AdminModel

                db = SessionLocal()
                admin_obj = db.query(AdminModel).filter(AdminModel.id == user.admin_id).first()
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
        path = XRAY_SUBSCRIPTION_PATH.strip("/") if XRAY_SUBSCRIPTION_PATH else "sub"
        url_prefix = f"/{path}"

    links: Dict[str, str] = {}
    if user.credential_key:
        links["username-key"] = f"{url_prefix}/{user.username}/{user.credential_key}"
        links["key"] = f"{url_prefix}/{user.credential_key}"

    token = create_subscription_token(user.username)
    links["token"] = f"{url_prefix}/{token}"

    has_key = bool(user.credential_key)
    if not has_key:
        # Always token for users without a key
        return {"primary": links["token"], **links}

    if preferred is None:
        try:
            settings = PanelSettingsService.get_settings(ensure_record=True)
            preferred = settings.default_subscription_type or SubscriptionLinkType.key.value
        except Exception:
            preferred = SubscriptionLinkType.key.value

    if preferred == SubscriptionLinkType.key.value:
        primary = links.get("key") or links["token"]
    elif preferred == SubscriptionLinkType.username_key.value:
        primary = links.get("username-key") or links["token"]
    elif preferred == SubscriptionLinkType.token.value:
        primary = links["token"]
    else:
        primary = links["token"]

    return {"primary": primary, **links}
