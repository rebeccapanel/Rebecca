from unittest.mock import Mock


def test_subscription_read_only_skips_access_metadata_update(monkeypatch):
    from app.routers import subscription

    update_user_sub = Mock()
    monkeypatch.setattr(subscription, "SUBSCRIPTION_READ_ONLY", True)
    monkeypatch.setattr(subscription.crud, "update_user_sub", update_user_sub)

    subscription._update_subscription_access_if_enabled(Mock(), Mock(), "test-agent")

    update_user_sub.assert_not_called()


def test_subscription_access_metadata_updates_by_default(monkeypatch):
    from app.routers import subscription

    update_user_sub = Mock()
    db = Mock()
    dbuser = Mock()
    monkeypatch.setattr(subscription, "SUBSCRIPTION_READ_ONLY", False)
    monkeypatch.setattr(subscription.crud, "update_user_sub", update_user_sub)

    subscription._update_subscription_access_if_enabled(db, dbuser, "test-agent")

    update_user_sub.assert_called_once_with(db, dbuser, "test-agent")


def test_user_list_links_flag_can_disable_requested_links(monkeypatch):
    from app.routers import user

    monkeypatch.setattr(user, "USERS_LIST_LINKS_ENABLED", False)

    assert user._should_include_user_config_links(True) is False


def test_user_list_links_flag_preserves_default_behavior(monkeypatch):
    from app.routers import user

    monkeypatch.setattr(user, "USERS_LIST_LINKS_ENABLED", True)

    assert user._should_include_user_config_links(True) is True
    assert user._should_include_user_config_links(False) is False
