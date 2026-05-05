from sqlalchemy import delete

from app.db.base import SessionLocal
from app.db.models import TelegramSettings
from app.services.rebecca_backup import BackupExportResult
from app.services.telegram_backup import run_periodic_telegram_backup
from app.services.telegram_settings import TelegramSettingsService


class FakeBot:
    def __init__(self):
        self.documents = []
        self.messages = []

    def send_document(self, chat_id, handle, **kwargs):
        self.documents.append(
            {
                "chat_id": chat_id,
                "content": handle.read(),
                "caption": kwargs.get("caption"),
                "thread_id": kwargs.get("message_thread_id"),
                "parse_mode": kwargs.get("parse_mode"),
            }
        )

    def send_message(self, chat_id, text, **kwargs):
        self.messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "thread_id": kwargs.get("message_thread_id"),
                "parse_mode": kwargs.get("parse_mode"),
            }
        )


def _reset_telegram_settings():
    with SessionLocal() as db:
        db.execute(delete(TelegramSettings))
        db.commit()


def test_periodic_telegram_backup_splits_large_files_and_sends_finish_message(tmp_path, monkeypatch):
    _reset_telegram_settings()
    backup_path = tmp_path / "telegram-backup.rbbackup"
    backup_path.write_bytes(b"abcdefghijklmnopqrstuvwxyz")
    bot = FakeBot()
    created_topics = []

    class FakeBackupService:
        def export_backup(self, scope):
            return BackupExportResult(path=backup_path, filename=backup_path.name, scope=scope)

    TelegramSettingsService.update_settings(
        {
            "use_telegram": True,
            "api_token": "123456:token",
            "logs_chat_id": -100123,
            "logs_chat_is_forum": True,
            "backup_enabled": True,
            "backup_scope": "full",
            "backup_interval_value": 1,
            "backup_interval_unit": "minutes",
        }
    )

    def fake_get_bot(with_settings=False):
        settings = TelegramSettingsService.get_settings(ensure_record=True)
        return (bot, settings) if with_settings else bot

    def fake_ensure_forum_topic(topic_key, *, bot_instance=None, settings=None):
        created_topics.append(topic_key)
        return 77

    monkeypatch.setattr("app.services.telegram_backup.MAX_TELEGRAM_PART_SIZE", 10)
    monkeypatch.setattr("app.services.telegram_backup.RebeccaBackupService", lambda: FakeBackupService())
    monkeypatch.setattr("app.services.telegram_backup.is_binary_runtime", lambda: True)
    monkeypatch.setattr("app.services.telegram_backup.get_bot", fake_get_bot)
    monkeypatch.setattr("app.services.telegram_backup.ensure_forum_topic", fake_ensure_forum_topic)

    assert run_periodic_telegram_backup(force=True) is True

    assert created_topics == ["backup"]
    assert len(bot.documents) == 3
    assert [part["content"] for part in bot.documents] == [b"abcdefghij", b"klmnopqrst", b"uvwxyz"]
    assert "Part: <code>1/3</code>" in bot.documents[0]["caption"]
    assert "Gregorian date:" in bot.documents[0]["caption"]
    assert "Jalali date:" in bot.documents[0]["caption"]
    assert bot.documents[0]["thread_id"] == 77
    assert len(bot.messages) == 1
    assert "Rebecca backup finished" in bot.messages[0]["text"]
    assert "Parts: <code>3</code>" in bot.messages[0]["text"]

    settings = TelegramSettingsService.get_settings()
    assert settings.backup_last_sent_at is not None
    assert settings.backup_last_error is None


def test_periodic_telegram_backup_is_binary_only(monkeypatch):
    _reset_telegram_settings()
    TelegramSettingsService.update_settings(
        {
            "use_telegram": True,
            "api_token": "123456:token",
            "admin_chat_ids": [123],
            "backup_enabled": True,
            "backup_scope": "database",
            "backup_interval_value": 1,
            "backup_interval_unit": "minutes",
        }
    )

    monkeypatch.setattr("app.services.telegram_backup.is_binary_runtime", lambda: False)

    assert run_periodic_telegram_backup(force=True) is False

    settings = TelegramSettingsService.get_settings()
    assert "binary installations" in (settings.backup_last_error or "")


def test_telegram_settings_include_backup_topic():
    _reset_telegram_settings()

    settings = TelegramSettingsService.get_settings(ensure_record=True)

    assert settings.forum_topics["backup"].title == "Backup"
