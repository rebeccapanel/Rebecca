from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class TelegramTopicSettings(BaseModel):
    title: str = Field(..., description="Display title for the forum topic")
    topic_id: Optional[int] = Field(
        None,
        description="Existing Telegram topic id. Leave empty to let the bot create it.",
    )


class TelegramSettingsResponse(BaseModel):
    api_token: Optional[str] = None
    use_telegram: bool = True
    proxy_url: Optional[str] = None
    admin_chat_ids: List[int] = Field(default_factory=list)
    logs_chat_id: Optional[int] = None
    logs_chat_is_forum: bool = False
    default_vless_flow: Optional[str] = None
    forum_topics: Dict[str, TelegramTopicSettings] = Field(default_factory=dict)
    event_toggles: Dict[str, bool] = Field(default_factory=dict)


class TelegramSettingsUpdate(BaseModel):
    api_token: Optional[str] = Field(default=None, description="Telegram bot API token")
    use_telegram: Optional[bool] = Field(
        default=None,
        description="Enable or disable the Telegram bot regardless of token presence",
    )
    proxy_url: Optional[str] = Field(default=None, description="Proxy URL for bot connections")
    admin_chat_ids: Optional[List[int]] = Field(
        default=None, description="List of admin Telegram chat ids for direct notifications"
    )
    logs_chat_id: Optional[int] = Field(
        default=None,
        description="Target chat id (group/channel) for log messages",
    )
    logs_chat_is_forum: Optional[bool] = Field(
        default=None,
        description="Indicates whether the log chat is a forum-enabled group",
    )
    default_vless_flow: Optional[str] = Field(
        default=None,
        description="Optional default flow for VLESS proxies",
    )
    forum_topics: Optional[Dict[str, TelegramTopicSettings]] = Field(
        default=None,
        description="Optional mapping of topic keys to settings (title/topic id)",
    )
    event_toggles: Optional[Dict[str, bool]] = Field(
        default=None,
        description="Optional mapping of log event keys to enable/disable notifications",
    )


class PanelSettingsResponse(BaseModel):
    use_nobetci: bool = False


class PanelSettingsUpdate(BaseModel):
    use_nobetci: Optional[bool] = None
