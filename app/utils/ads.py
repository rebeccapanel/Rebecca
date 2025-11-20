from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import requests

from app.runtime import logger
from app.models.ads import AdsResponse
from config import (
    ADS_CACHE_TTL_SECONDS,
    ADS_FETCH_TIMEOUT_SECONDS,
    ADS_SOURCE_URL,
)


@dataclass
class AdsState:
    payload: AdsResponse = field(default_factory=AdsResponse)
    last_refresh: Optional[datetime] = None
    last_attempt: Optional[datetime] = None
    last_error: Optional[str] = None


_ads_state = AdsState()


def _now() -> datetime:
    return datetime.now(timezone.utc)


_MIN_RETRY_DELAY_SECONDS = min(300, max(30, ADS_CACHE_TTL_SECONDS))


def _should_refresh(force: bool) -> bool:
    if force:
        return True

    now = _now()
    if _ads_state.last_error and _ads_state.last_attempt:
        elapsed_since_failure = (now - _ads_state.last_attempt).total_seconds()
        if elapsed_since_failure < _MIN_RETRY_DELAY_SECONDS:
            return False

    if not _ads_state.last_refresh:
        return True

    return (now - _ads_state.last_refresh).total_seconds() >= ADS_CACHE_TTL_SECONDS


def refresh_ads(force: bool = False) -> AdsResponse:
    """
    Fetch the latest ads payload and update the cache. This is safe to call
    from background jobs or on-demand.
    """
    if not _should_refresh(force):
        return _ads_state.payload

    try:
        response = requests.get(ADS_SOURCE_URL, timeout=ADS_FETCH_TIMEOUT_SECONDS)
        response.raise_for_status()

        payload = AdsResponse.model_validate(response.json())
        now = _now()
        _ads_state.payload = payload
        _ads_state.last_refresh = now
        _ads_state.last_attempt = now
        _ads_state.last_error = None
        logger.debug("Advertisements cache refreshed")
    except Exception as exc:  # pragma: no cover - external dependencies
        _ads_state.last_attempt = _now()
        _ads_state.last_error = str(exc)
        logger.warning(
            "Unable to load advertisements from %s: %s", ADS_SOURCE_URL, exc
        )

    return _ads_state.payload


def get_cached_ads() -> AdsResponse:
    """
    Return the cached ads payload, triggering a refresh whenever it is stale.
    """
    refresh_ads()
    return _ads_state.payload
