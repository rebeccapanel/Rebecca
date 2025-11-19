import pytest
from unittest.mock import patch
from datetime import datetime
from app.models.user import (
    _normalize_ip_limit,
    User,
    UserCreate,
    UserModify,
    UserServiceCreate,
    UserResponse,
    ReminderType,
    UserStatus,
    AdvancedUserAction,
    UserStatusModify,
    UserStatusCreate,
    UserDataLimitResetStrategy,
    BulkUsersActionRequest,
    NextPlanModel,
    SubscriptionUserResponse,
    UsersResponse,
    UserUsageResponse,
    UserUsagesResponse,
    UsersUsagesResponse,
)


def test_normalize_ip_limit():
    # None
    assert _normalize_ip_limit(None) == 0

    # String numbers
    assert _normalize_ip_limit("10") == 10
    assert _normalize_ip_limit("0") == 0
    assert _normalize_ip_limit("-") == 0

    # Integers
    assert _normalize_ip_limit(10) == 10
    assert _normalize_ip_limit(0) == 0

    # Floats
    assert _normalize_ip_limit(10.5) == 10

    # Invalid strings
    with pytest.raises(ValueError, match="ip_limit must be a number"):
        _normalize_ip_limit("abc")

    # Non-finite floats
    with pytest.raises(ValueError, match="ip_limit must be a finite number"):
        _normalize_ip_limit(float("inf"))

    with pytest.raises(ValueError, match="ip_limit must be a finite number"):
        _normalize_ip_limit(float("nan"))


def test_user_validate_username():
    # Valid usernames
    User.validate_username("user123")
    User.validate_username("test_user")
    User.validate_username("user-123")
    User.validate_username("user@domain.com")
    User.validate_username("u" * 32)  # Max length

    # Invalid: too short
    with pytest.raises(ValueError, match="Username only can be 3 to 32 characters"):
        User.validate_username("us")

    # Invalid: too long
    with pytest.raises(ValueError, match="Username only can be 3 to 32 characters"):
        User.validate_username("u" * 33)

    # Invalid characters
    with pytest.raises(ValueError, match="Username only can be 3 to 32 characters"):
        User.validate_username("user space")

    with pytest.raises(ValueError, match="Username only can be 3 to 32 characters"):
        User.validate_username("user#123")


def test_user_validate_note():
    # Valid notes
    User.validate_note(None)
    User.validate_note("")
    User.validate_note("A note")
    User.validate_note("x" * 500)  # Max length

    # Invalid: too long
    with pytest.raises(ValueError, match="User's note can be a maximum of 500 character"):
        User.validate_note("x" * 501)


def test_user_data_limit_validator():
    # Valid
    user = User(data_limit=None)
    assert user.data_limit is None

    user = User(data_limit=100)
    assert user.data_limit == 100

    user = User(data_limit=100.5)
    assert user.data_limit == 100

    # Invalid
    with pytest.raises(ValueError, match="data_limit must be an integer or a float"):
        User(data_limit="100")


def test_user_proxies_validator():
    from app.models.proxy import ProxySettings

    # Valid dict
    proxies = {"vmess": {"id": "test"}}
    user = User(proxies=proxies)
    assert "vmess" in user.proxies

    # Empty
    user = User(proxies={})
    assert user.proxies == {}


def test_user_ip_limit_validator():
    # Valid
    user = User(ip_limit=10)
    assert user.ip_limit == 10

    user = User(ip_limit="10")
    assert user.ip_limit == 10

    user = User(ip_limit=0)
    assert user.ip_limit == 0

    user = User(ip_limit=None)
    assert user.ip_limit == 0


def test_user_on_hold_timeout_validator():
    # Valid: None
    user = User(on_hold_expire_duration=None, on_hold_timeout=None)
    assert user.on_hold_timeout is None

    # Valid: with duration
    user = User(on_hold_expire_duration=100, on_hold_timeout=datetime.now())
    assert user.on_hold_timeout is not None

    # Invalid: timeout without duration
    with pytest.raises(ValueError):
        User(on_hold_expire_duration=0, on_hold_timeout=datetime.now())


@patch("app.runtime.xray")
def test_user_create_excluded_inbounds(mock_xray):
    mock_xray.config.inbounds_by_protocol = {"vmess": [{"tag": "VMess TCP"}, {"tag": "VMess WS"}]}

    user_create = UserCreate(username="testuser", proxies={"vmess": {}}, inbounds={"vmess": ["VMess TCP"]})

    excluded = user_create.excluded_inbounds
    assert "vmess" in excluded
    assert "VMess WS" in excluded["vmess"]


@patch("app.runtime.xray")
def test_user_create_validate_inbounds(mock_xray):
    mock_xray.config.inbounds_by_protocol = {"vmess": [{"tag": "VMess TCP"}]}
    mock_xray.config.inbounds_by_tag = {"VMess TCP": {}}

    # Valid
    user_create = UserCreate(username="testuser", proxies={"vmess": {}}, inbounds={"vmess": ["VMess TCP"]})
    assert user_create.inbounds == {"vmess": ["VMess TCP"]}

    # Invalid inbound tag
    with pytest.raises(ValueError, match="Inbound .* doesn't exist"):
        UserCreate(username="testuser", proxies={"vmess": {}}, inbounds={"vmess": ["Invalid Tag"]})


def test_user_create_ensure_proxies():
    # Valid: with proxies
    user_create = UserCreate(username="testuser", proxies={"vmess": {}})
    assert user_create.proxies == {"vmess": {}}

    # Invalid: no proxies
    with pytest.raises(ValueError, match="Each user needs at least one proxy"):
        UserCreate(username="testuser", proxies={})


@patch("app.runtime.xray")
def test_user_create_validate_status(mock_xray):
    mock_xray.config.inbounds_by_protocol = {"vmess": [{"tag": "VMess TCP"}]}
    mock_xray.config.inbounds_by_tag = {"VMess TCP": {}}

    # Valid: active
    user_create = UserCreate(username="testuser", proxies={"vmess": {}}, status=UserStatusCreate.active)
    assert user_create.status == UserStatusCreate.active

    # Valid: on_hold with duration
    user_create = UserCreate(
        username="testuser", proxies={"vmess": {}}, status=UserStatusCreate.on_hold, on_hold_expire_duration=100
    )
    assert user_create.status == UserStatusCreate.on_hold

    # Invalid: on_hold without duration
    with pytest.raises(ValueError, match="User cannot be on hold without a valid on_hold_expire_duration"):
        UserCreate(
            username="testuser", proxies={"vmess": {}}, status=UserStatusCreate.on_hold, on_hold_expire_duration=0
        )

    # Invalid: on_hold with expire
    with pytest.raises(ValueError, match="User cannot be on hold with specified expire"):
        UserCreate(
            username="testuser",
            proxies={"vmess": {}},
            status=UserStatusCreate.on_hold,
            on_hold_expire_duration=100,
            expire=100,
        )


def test_bulk_users_action_request_validator():
    # Valid: extend_expire
    request = BulkUsersActionRequest(action=AdvancedUserAction.extend_expire, days=10, statuses=[UserStatus.expired])
    assert request.days == 10

    # Invalid: extend_expire without days
    with pytest.raises(ValueError, match="days must be a positive integer"):
        BulkUsersActionRequest(action=AdvancedUserAction.extend_expire, statuses=[UserStatus.expired])

    # Invalid: extend_expire with negative days
    with pytest.raises(ValueError, match="days must be a positive integer"):
        BulkUsersActionRequest(action=AdvancedUserAction.extend_expire, days=-1, statuses=[UserStatus.expired])

    # Valid: increase_traffic
    request = BulkUsersActionRequest(action=AdvancedUserAction.increase_traffic, gigabytes=1.5)
    assert request.gigabytes == 1.5

    # Invalid: increase_traffic without gigabytes
    with pytest.raises(ValueError, match="gigabytes must be a positive number"):
        BulkUsersActionRequest(action=AdvancedUserAction.increase_traffic)

    # Valid: cleanup_status
    request = BulkUsersActionRequest(
        action=AdvancedUserAction.cleanup_status, days=5, statuses=[UserStatus.expired, UserStatus.limited]
    )
    assert request.statuses == [UserStatus.expired, UserStatus.limited]

    # Invalid: cleanup_status with invalid status
    with pytest.raises(ValueError, match="cleanup_status only accepts expired or limited"):
        BulkUsersActionRequest(action=AdvancedUserAction.cleanup_status, days=5, statuses=[UserStatus.active])


def test_user_response_cast_to_int():
    # Valid
    response = UserUsageResponse(node_name="test", used_traffic=100.5)
    assert response.used_traffic == 100

    response = UserUsageResponse(node_name="test", used_traffic="100")
    assert response.used_traffic == 100

    response = UserUsageResponse(node_name="test", used_traffic=100)
    assert response.used_traffic == 100

    # Invalid
    with pytest.raises(ValueError, match="must be an integer or a float"):
        UserUsageResponse(node_name="test", used_traffic="abc")


# Add more tests for other classes as needed
