# Services package exports (lazy to avoid circular imports during module init)
from typing import TYPE_CHECKING

__all__ = [
    "SubscriptionSettingsService",
]


def __getattr__(name):
    if name == "SubscriptionSettingsService":
        from .subscription_settings import SubscriptionSettingsService

        return SubscriptionSettingsService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from .subscription_settings import SubscriptionSettingsService
