from unittest.mock import patch
from app.utils.jwt import create_admin_token, get_admin_payload, create_subscription_token, get_subscription_payload


@patch('app.utils.jwt.get_admin_secret_key')
def test_create_admin_token(mock_get_key):
    mock_get_key.return_value = 'secret'
    token = create_admin_token('testuser', 'admin')
    assert isinstance(token, str)
    assert len(token) > 0


@patch('app.utils.jwt.get_admin_secret_key')
def test_get_admin_payload_valid(mock_get_key):
    mock_get_key.return_value = 'secret'
    token = create_admin_token('testuser', 'admin')
    payload = get_admin_payload(token)
    assert payload['sub'] == 'testuser'
    assert payload['role'] == 'admin'


@patch('app.utils.jwt.get_admin_secret_key')
def test_get_admin_payload_invalid(mock_get_key):
    mock_get_key.return_value = 'secret'
    payload = get_admin_payload('invalid_token')
    assert payload is None


@patch('app.utils.jwt.get_subscription_secret_key')
def test_create_subscription_token(mock_get_key):
    mock_get_key.return_value = 'sub_secret'
    token = create_subscription_token('user123')
    assert isinstance(token, str)


@patch('app.utils.jwt.get_subscription_secret_key')
def test_get_subscription_payload(mock_get_key):
    mock_get_key.return_value = 'sub_secret'
    token = create_subscription_token('user123')
    payload = get_subscription_payload(token)
    assert payload['sub'] == 'user123'