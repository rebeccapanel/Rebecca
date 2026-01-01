# Services package exports (lazy to avoid circular imports during module init)
from typing import TYPE_CHECKING

__all__ = [
    "PanelSettingsService",
    "TelegramSettingsService",
    "SubscriptionSettingsService",
    "SubscriptionCertificateService",
]


def __getattr__(name):
    if name == "PanelSettingsService":
        from .panel_settings import PanelSettingsService

        return PanelSettingsService
    if name == "TelegramSettingsService":
        from .telegram_settings import TelegramSettingsService

        return TelegramSettingsService
    if name == "SubscriptionSettingsService":
        from .subscription_settings import SubscriptionSettingsService

        return SubscriptionSettingsService
    if name == "SubscriptionCertificateService":
        from .subscription_settings import SubscriptionCertificateService

        return SubscriptionCertificateService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from .panel_settings import PanelSettingsService
    from .telegram_settings import TelegramSettingsService
    from .subscription_settings import SubscriptionSettingsService, SubscriptionCertificateService
