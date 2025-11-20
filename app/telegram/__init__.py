import importlib.util
from os.path import dirname
from threading import Lock, Thread
from typing import Optional, Tuple, Union

from app.runtime import logger
from app.services import TelegramSettingsService
from app.services.telegram_settings import TelegramSettingsData
from telebot import TeleBot, apihelper
from telebot.apihelper import ApiTelegramException


bot: Optional[TeleBot] = None
_handler_names = ["admin", "report", "user"]
_bot_lock = Lock()
_topic_lock = Lock()
_polling_thread: Optional[Thread] = None
_current_token: Optional[str] = None
_handlers_token: Optional[str] = None


def _apply_proxy(proxy_url: Optional[str]) -> None:
    if proxy_url:
        apihelper.proxy = {"http": proxy_url, "https": proxy_url}
    else:
        apihelper.proxy = {}


def _configure_bot(settings) -> Optional[TeleBot]:
    global bot, _current_token
    if not settings.use_telegram:
        return None
    token = settings.api_token
    if not token:
        return None

    with _bot_lock:
        if bot and _current_token == token:
            return bot

        _apply_proxy(settings.proxy_url)
        bot = TeleBot(token)
        _current_token = token
        return bot


def get_bot(with_settings: bool = False) -> Union[Optional[TeleBot], Tuple[Optional[TeleBot], TelegramSettingsData]]:
    settings = TelegramSettingsService.get_settings(ensure_record=True)
    bot_instance = _configure_bot(settings)
    if with_settings:
        return bot_instance, settings
    return bot_instance


def ensure_forum_topic(
    topic_key: str,
    *,
    bot_instance: Optional[TeleBot] = None,
    settings: Optional[TelegramSettingsData] = None,
) -> Optional[int]:
    if bot_instance is None or settings is None:
        bot_instance, settings = get_bot(with_settings=True)
    if not bot_instance or not settings.logs_chat_id or not settings.logs_chat_is_forum:
        return None

    topic = settings.forum_topics.get(topic_key)
    if topic and topic.topic_id:
        return topic.topic_id

    with _topic_lock:
        latest_settings = TelegramSettingsService.get_settings(ensure_record=True)
        topic = latest_settings.forum_topics.get(topic_key)
        if topic and topic.topic_id:
            return topic.topic_id

        topic_title = (
            topic.title
            if topic
            else TelegramSettingsService.DEFAULT_TOPIC_TITLES.get(topic_key, topic_key.title())
        )

        try:
            created_topic = bot_instance.create_forum_topic(
                chat_id=latest_settings.logs_chat_id,
                name=topic_title[:128],
            )
        except ApiTelegramException as exc:
            logger.error("Failed to create Telegram forum topic '%s': %s", topic_key, exc)
            return None

        message_thread_id = getattr(created_topic, "message_thread_id", None)
        if message_thread_id is None:
            logger.warning("Forum topic created without message_thread_id for key '%s'", topic_key)
            return None

        TelegramSettingsService.update_topic_id(topic_key, message_thread_id)
        return message_thread_id


def _load_handlers() -> None:
    handler_dir = dirname(__file__) + "/handlers/"
    for name in _handler_names:
        spec = importlib.util.spec_from_file_location(name, f"{handler_dir}{name}.py")
        if not spec or not spec.loader:
            logger.error("Unable to load Telegram handler module '%s'", name)
            continue
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)


def _prepare_handlers() -> None:
    global _handlers_token
    if not bot:
        return
    if _handlers_token == _current_token:
        return
    _load_handlers()

    from app.telegram import utils

    utils.setup()
    _handlers_token = _current_token


def _stop_polling(reset_token: bool = False) -> None:
    global bot, _polling_thread, _current_token, _handlers_token
    with _bot_lock:
        if bot:
            try:
                bot.stop_polling()
            except Exception:
                pass
        if _polling_thread and _polling_thread.is_alive():
            _polling_thread.join(timeout=1)
        _polling_thread = None
        if reset_token:
            bot = None
            _current_token = None
            _handlers_token = None


def _start_polling(bot_instance: TeleBot) -> None:
    global _polling_thread
    if _polling_thread and _polling_thread.is_alive():
        return
    _polling_thread = Thread(target=bot_instance.infinity_polling, daemon=True)
    _polling_thread.start()


def ensure_polling() -> None:
    bot_instance, settings = get_bot(with_settings=True)
    if not settings.use_telegram:
        logger.info("Telegram bot disabled; skipping bot polling")
        _stop_polling(reset_token=True)
        return
    if not bot_instance or not settings.api_token:
        logger.info("Telegram bot token not configured; skipping bot polling")
        _stop_polling(reset_token=not settings.api_token)
        return

    _prepare_handlers()
    _start_polling(bot_instance)


def reload_bot() -> None:
    settings = TelegramSettingsService.get_settings(ensure_record=True)
    if not settings.use_telegram or not settings.api_token:
        _stop_polling(reset_token=True)
        return

    _stop_polling(reset_token=True)
    bot_instance = _configure_bot(settings)
    if not bot_instance:
        logger.warning("Unable to configure Telegram bot with provided token")
        return

    _prepare_handlers()
    _start_polling(bot_instance)
def start_bot() -> None:
    ensure_polling()


def setup(app):
    app.add_event_handler("startup", start_bot)


from .handlers.report import (  # noqa
    report,
    report_admin_created,
    report_admin_updated,
    report_admin_deleted,
    report_admin_limit_reached,
    report_admin_usage_reset,
    report_login,
    report_node_created,
    report_node_deleted,
    report_node_error,
    report_node_status_change,
    report_node_usage_reset,
    report_status_change,
    report_user_data_reset_by_next,
    report_user_deletion,
    report_user_modification,
    report_user_subscription_revoked,
    report_user_usage_reset,
    report_new_user,
)

__all__ = [
    "bot",
    "get_bot",
    "ensure_polling",
    "ensure_forum_topic",
    "reload_bot",
    "report",
    "report_new_user",
    "report_user_modification",
    "report_user_deletion",
    "report_status_change",
    "report_user_usage_reset",
    "report_user_data_reset_by_next",
    "report_user_subscription_revoked",
    "report_login",
    "report_node_created",
    "report_node_deleted",
    "report_node_usage_reset",
    "report_node_status_change",
    "report_node_error",
    "report_admin_created",
    "report_admin_updated",
    "report_admin_deleted",
    "report_admin_usage_reset",
    "report_admin_limit_reached",
    "setup",
]



