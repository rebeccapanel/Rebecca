from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from enum import Enum


class SubscriptionLinkType(str, Enum):
    username_key = "username-key"
    key = "key"
    token = "token"


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
    default_subscription_type: SubscriptionLinkType = SubscriptionLinkType.key
    access_insights_enabled: bool = False


class PanelSettingsUpdate(BaseModel):
    use_nobetci: Optional[bool] = None
    default_subscription_type: Optional[SubscriptionLinkType] = None
    access_insights_enabled: Optional[bool] = None


class SubscriptionTemplateSettings(BaseModel):
    subscription_url_prefix: str = ""
    subscription_profile_title: str = "Subscription"
    subscription_support_url: str = "https://t.me/"
    subscription_update_interval: str = "12"
    custom_templates_directory: Optional[str] = None
    clash_subscription_template: str = "clash/default.yml"
    clash_settings_template: str = "clash/settings.yml"
    subscription_page_template: str = "subscription/index.html"
    home_page_template: str = "home/index.html"
    v2ray_subscription_template: str = "v2ray/default.json"
    v2ray_settings_template: str = "v2ray/settings.json"
    singbox_subscription_template: str = "singbox/default.json"
    singbox_settings_template: str = "singbox/settings.json"
    mux_template: str = "mux/default.json"
    use_custom_json_default: bool = False
    use_custom_json_for_v2rayn: bool = False
    use_custom_json_for_v2rayng: bool = False
    use_custom_json_for_streisand: bool = False
    use_custom_json_for_happ: bool = False
    subscription_path: str = "sub"
    subscription_aliases: List[str] = Field(default_factory=list)
    subscription_ports: List[int] = Field(default_factory=list)


class SubscriptionTemplateSettingsUpdate(BaseModel):
    subscription_url_prefix: Optional[str] = None
    subscription_profile_title: Optional[str] = None
    subscription_support_url: Optional[str] = None
    subscription_update_interval: Optional[str] = None
    custom_templates_directory: Optional[str] = None
    clash_subscription_template: Optional[str] = None
    clash_settings_template: Optional[str] = None
    subscription_page_template: Optional[str] = None
    home_page_template: Optional[str] = None
    v2ray_subscription_template: Optional[str] = None
    v2ray_settings_template: Optional[str] = None
    singbox_subscription_template: Optional[str] = None
    singbox_settings_template: Optional[str] = None
    mux_template: Optional[str] = None
    use_custom_json_default: Optional[bool] = None
    use_custom_json_for_v2rayn: Optional[bool] = None
    use_custom_json_for_v2rayng: Optional[bool] = None
    use_custom_json_for_streisand: Optional[bool] = None
    use_custom_json_for_happ: Optional[bool] = None
    subscription_path: Optional[str] = None
    subscription_aliases: Optional[List[str]] = None
    subscription_ports: Optional[List[int]] = None


class AdminSubscriptionOverrides(SubscriptionTemplateSettingsUpdate):
    pass


class AdminSubscriptionSettingsResponse(BaseModel):
    id: int
    username: str
    subscription_domain: Optional[str] = None
    subscription_settings: Dict[str, Any] = Field(default_factory=dict)


class AdminSubscriptionSettingsUpdate(BaseModel):
    subscription_domain: Optional[str] = None
    subscription_settings: Optional[AdminSubscriptionOverrides] = None


class SubscriptionCertificate(BaseModel):
    id: Optional[int] = None
    domain: str
    admin_id: Optional[int] = None
    email: Optional[str] = None
    provider: Optional[str] = None
    alt_names: List[str] = Field(default_factory=list)
    last_issued_at: Optional[datetime] = None
    last_renewed_at: Optional[datetime] = None
    path: str


class SubscriptionSettingsBundle(BaseModel):
    settings: SubscriptionTemplateSettings
    admins: List[AdminSubscriptionSettingsResponse] = Field(default_factory=list)
    certificates: List[SubscriptionCertificate] = Field(default_factory=list)


class SubscriptionTemplateContentResponse(BaseModel):
    template_key: str
    template_name: str
    custom_directory: Optional[str] = None
    resolved_path: Optional[str] = None
    admin_id: Optional[int] = None
    content: str


class SubscriptionTemplateContentUpdate(BaseModel):
    content: str


class SubscriptionCertificateIssueRequest(BaseModel):
    email: str
    domains: List[str]
    admin_id: Optional[int] = None


class SubscriptionCertificateRenewRequest(BaseModel):
    domain: Optional[str] = None
