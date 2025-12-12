from typing import Dict

from fastapi import APIRouter, Depends

from app.models.admin import Admin
from app.models.settings import (
    PanelSettingsResponse,
    PanelSettingsUpdate,
    TelegramSettingsResponse,
    TelegramSettingsUpdate,
    TelegramTopicSettings,
)
from app.services.panel_settings import PanelSettingsService
from app.services.telegram_settings import TelegramSettingsService
from app.utils import responses

router = APIRouter(
    prefix="/api/settings",
    tags=["Settings"],
    responses={401: responses._401, 403: responses._403},
)


def _to_response_payload(settings) -> TelegramSettingsResponse:
    topics: Dict[str, TelegramTopicSettings] = {
        key: TelegramTopicSettings(title=topic.title, topic_id=topic.topic_id)
        for key, topic in settings.forum_topics.items()
    }
    return TelegramSettingsResponse(
        api_token=settings.api_token,
        use_telegram=settings.use_telegram,
        proxy_url=settings.proxy_url,
        admin_chat_ids=settings.admin_chat_ids,
        logs_chat_id=settings.logs_chat_id,
        logs_chat_is_forum=settings.logs_chat_is_forum,
        default_vless_flow=settings.default_vless_flow,
        forum_topics=topics,
        event_toggles=dict(settings.event_toggles or {}),
    )


@router.get("/telegram", response_model=TelegramSettingsResponse, responses={403: responses._403})
def get_telegram_settings(_: Admin = Depends(Admin.check_sudo_admin)):
    """Retrieve telegram integration settings."""
    settings = TelegramSettingsService.get_settings(ensure_record=True)
    return _to_response_payload(settings)


@router.put("/telegram", response_model=TelegramSettingsResponse, responses={403: responses._403})
def update_telegram_settings(
    payload: TelegramSettingsUpdate,
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Update telegram integration settings."""
    data = payload.model_dump(exclude_unset=True)
    forum_topics = data.get("forum_topics")
    if forum_topics is not None:
        normalized = {}
        for key, value in forum_topics.items():
            if isinstance(value, dict):
                normalized[key] = {k: v for k, v in value.items() if v is not None}
            else:
                normalized[key] = value.model_dump(exclude_none=True)  # type: ignore[attr-defined]
        data["forum_topics"] = normalized
    settings = TelegramSettingsService.update_settings(data)
    return _to_response_payload(settings)


@router.get("/panel", response_model=PanelSettingsResponse, responses={403: responses._403})
def get_panel_settings(_: Admin = Depends(Admin.require_active)):
    """Retrieve general panel settings."""
    settings = PanelSettingsService.get_settings(ensure_record=True)
    return PanelSettingsResponse(
        use_nobetci=settings.use_nobetci,
        default_subscription_type=settings.default_subscription_type,
        access_insights_enabled=settings.access_insights_enabled,
    )


@router.put("/panel", response_model=PanelSettingsResponse, responses={403: responses._403})
def update_panel_settings(
    payload: PanelSettingsUpdate,
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Update general panel settings."""
    settings = PanelSettingsService.update_settings(payload.model_dump(exclude_unset=True))
    return PanelSettingsResponse(
        use_nobetci=settings.use_nobetci,
        default_subscription_type=settings.default_subscription_type,
        access_insights_enabled=settings.access_insights_enabled,
    )
