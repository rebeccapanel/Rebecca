from unittest.mock import patch, MagicMock
from datetime import datetime, timezone
from app.utils.ads import refresh_ads, _should_refresh, _ads_state
from app.models.ads import AdsResponse


@patch("app.utils.ads.requests.get")
def test_refresh_ads_success(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = {"default": {"header": [], "sidebar": []}, "locales": {}}
    mock_get.return_value = mock_response

    result = refresh_ads(force=True)
    assert isinstance(result, AdsResponse)


@patch("app.utils.ads.requests.get")
def test_refresh_ads_failure(mock_get):
    mock_get.side_effect = Exception("Network error")

    result = refresh_ads(force=True)
    assert isinstance(result, AdsResponse)  # Returns default


def test_should_refresh_force():
    assert _should_refresh(True) == True


def test_should_refresh_no_last_refresh():
    original = _ads_state.last_refresh
    _ads_state.last_refresh = None
    try:
        assert _should_refresh(False) == True
    finally:
        _ads_state.last_refresh = original


def test_should_refresh_no_last_refresh():
    original_refresh = _ads_state.last_refresh
    original_attempt = _ads_state.last_attempt
    original_error = _ads_state.last_error
    _ads_state.last_refresh = None
    _ads_state.last_attempt = None
    _ads_state.last_error = None
    try:
        assert _should_refresh(False) == True
    finally:
        _ads_state.last_refresh = original_refresh
        _ads_state.last_attempt = original_attempt
        _ads_state.last_error = original_error


@patch("app.utils.ads.ADS_CACHE_TTL_SECONDS", 1)
def test_should_refresh_expired():
    original_refresh = _ads_state.last_refresh
    original_attempt = _ads_state.last_attempt
    original_error = _ads_state.last_error
    _ads_state.last_refresh = datetime(2023, 1, 1, tzinfo=timezone.utc)
    _ads_state.last_attempt = None
    _ads_state.last_error = None
    try:
        with patch("app.utils.ads._now", return_value=datetime(2023, 1, 2, tzinfo=timezone.utc)):
            assert _should_refresh(False) == True
    finally:
        _ads_state.last_refresh = original_refresh
        _ads_state.last_attempt = original_attempt
        _ads_state.last_error = original_error
