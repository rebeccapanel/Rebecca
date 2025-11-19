from uuid import UUID
from app.utils.credentials import generate_key, normalize_key, key_to_uuid, uuid_to_key, key_to_password


def test_generate_key():
    key = generate_key()
    assert len(key) == 32  # 16 bytes hex
    assert all(c in "0123456789abcdef" for c in key)


def test_normalize_key():
    key = "1234567890abcdef1234567890abcdef"
    assert normalize_key(key) == key
    assert normalize_key("  1234567890ABCDEF1234567890ABCDEF  ") == key.lower()


def test_key_to_uuid():
    key = "1234567890abcdef1234567890abcdef"
    uuid_obj = key_to_uuid(key)
    assert isinstance(uuid_obj, UUID)


def test_uuid_to_key():
    import uuid

    u = uuid.uuid4()
    key = uuid_to_key(u)
    assert len(key) == 32
    assert all(c in "0123456789abcdef" for c in key)


def test_key_to_password():
    key = "1234567890abcdef1234567890abcdef"
    password = key_to_password(key, "test")
    assert isinstance(password, str)
    assert len(password) > 0
