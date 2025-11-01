from telebot import types
from telebot.custom_filters import AdvancedCustomFilter

from app import logger
from app.services import TelegramSettingsService
from app.telegram import get_bot


class IsAdminFilter(AdvancedCustomFilter):
    key = 'is_admin'

    def check(self, message, text):
        """
        :meta private:
        """
        settings = TelegramSettingsService.get_settings()
        admin_ids = set(settings.admin_chat_ids or [])
        if isinstance(message, types.CallbackQuery):
            return message.from_user.id in admin_ids
        return message.chat.id in admin_ids


def cb_query_equals(text: str):
    return lambda query: query.data == text


def cb_query_startswith(text: str):
    return lambda query: query.data.startswith(text)



def setup() -> None:
    bot_instance = get_bot()
    if not bot_instance:
        logger.info("Telegram bot not available; skipping admin filter registration")
        return
    bot_instance.add_custom_filter(IsAdminFilter())
