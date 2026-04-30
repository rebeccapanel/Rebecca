from app.db.models import SubscriptionSettings
from app.services import subscription_settings
from app.services.subscription_settings import SubscriptionSettingsService
from tests.conftest import TestingSessionLocal


def test_subscription_template_creator_uses_persistent_directory_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(subscription_settings, "REBECCA_DATA_DIR", tmp_path)
    monkeypatch.setattr(subscription_settings, "PERSISTENT_TEMPLATE_BASE_PATH", tmp_path / "templates")

    db = TestingSessionLocal()
    try:
        db.query(SubscriptionSettings).delete()
        db.commit()

        content = "<html><body>persisted template</body></html>"
        result = SubscriptionSettingsService.write_template_content(
            "subscription_page_template",
            content,
            db=db,
        )

        expected_directory = str((tmp_path / "templates").resolve())
        assert result["custom_directory"] == expected_directory
        assert result["resolved_path"] == str((tmp_path / "templates" / "subscription" / "index.html").resolve())
        assert result["content"] == content

        db.expire_all()
        settings = SubscriptionSettingsService.get_settings(db=db)
        assert settings.custom_templates_directory == expected_directory

        reloaded = SubscriptionSettingsService.read_template_content(
            "subscription_page_template",
            db=db,
        )
        assert reloaded["content"] == content
        assert reloaded["resolved_path"] == result["resolved_path"]
    finally:
        db.close()
