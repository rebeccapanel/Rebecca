from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.models.admin import Admin
from app.models.settings import (
    PanelSettingsResponse,
    PanelSettingsUpdate,
    SubscriptionCertificate,
    SubscriptionCertificateIssueRequest,
    SubscriptionCertificateRenewRequest,
    SubscriptionSettingsBundle,
    SubscriptionTemplateSettings,
    SubscriptionTemplateSettingsUpdate,
    AdminSubscriptionSettingsUpdate,
    AdminSubscriptionSettingsResponse,
    SubscriptionTemplateContentResponse,
    SubscriptionTemplateContentUpdate,
    TelegramSettingsResponse,
    TelegramSettingsUpdate,
    TelegramTopicSettings,
)
from app.services.panel_settings import PanelSettingsService
from app.services.subscription_settings import SubscriptionCertificateService, SubscriptionSettingsService
from app.services.telegram_settings import TelegramSettingsService
from app.db import crud, get_db, Session
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


@router.get("/subscriptions", response_model=SubscriptionSettingsBundle, responses={403: responses._403})
def get_subscription_settings(
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Retrieve subscription template/json settings along with admin overrides and certificate records."""
    settings = SubscriptionSettingsService.get_settings(ensure_record=True, db=db)
    admin_rows = crud.get_admins(db).get("admins", [])
    admins_payload = [
        AdminSubscriptionSettingsResponse(
            id=adm.id,
            username=adm.username,
            subscription_domain=getattr(adm, "subscription_domain", None),
            subscription_telegram_id=getattr(adm, "subscription_telegram_id", None),
            subscription_settings=dict(getattr(adm, "subscription_settings", {}) or {}),
        )
        for adm in admin_rows
    ]
    certs = SubscriptionCertificateService.list_certificates(db=db)
    return SubscriptionSettingsBundle(
        settings=SubscriptionTemplateSettings(**settings.__dict__),
        admins=admins_payload,
        certificates=[SubscriptionCertificate(**vars(cert)) for cert in certs],
    )


@router.put("/subscriptions", response_model=SubscriptionTemplateSettings, responses={403: responses._403})
def update_subscription_settings(
    payload: SubscriptionTemplateSettingsUpdate,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Update global subscription template and JSON settings."""
    settings = SubscriptionSettingsService.update_settings(payload.model_dump(exclude_unset=True), db=db)
    return SubscriptionTemplateSettings(**settings.__dict__)


@router.put(
    "/subscriptions/admins/{admin_id}",
    response_model=AdminSubscriptionSettingsResponse,
    responses={403: responses._403, 404: responses._404},
)
def update_admin_subscription_settings(
    admin_id: int,
    payload: AdminSubscriptionSettingsUpdate,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    dbadmin = crud.get_admin_by_id(db, admin_id)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    data = payload.model_dump(exclude_unset=True)
    if "subscription_domain" in data:
        domain = data.get("subscription_domain")
        dbadmin.subscription_domain = domain.strip() if domain else None
    if "subscription_telegram_id" in data:
        dbadmin.subscription_telegram_id = data.get("subscription_telegram_id")
    if "subscription_settings" in data:
        overrides = data.get("subscription_settings") or {}
        if hasattr(overrides, "model_dump"):
            overrides = overrides.model_dump(exclude_unset=True)
        dbadmin.subscription_settings = overrides

    db.add(dbadmin)
    db.commit()
    db.refresh(dbadmin)
    return AdminSubscriptionSettingsResponse(
        id=dbadmin.id,
        username=dbadmin.username,
        subscription_domain=dbadmin.subscription_domain,
        subscription_telegram_id=dbadmin.subscription_telegram_id,
        subscription_settings=dict(dbadmin.subscription_settings or {}),
    )


@router.get(
    "/subscriptions/templates/{template_key}",
    response_model=SubscriptionTemplateContentResponse,
    responses={403: responses._403, 404: responses._404},
)
def get_subscription_template_content(
    template_key: str,
    admin_id: Optional[int] = None,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    admin = None
    if admin_id is not None:
        admin = crud.get_admin_by_id(db, admin_id)
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin not found")

    try:
        payload = SubscriptionSettingsService.read_template_content(template_key, admin=admin, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SubscriptionTemplateContentResponse(**payload)


@router.put(
    "/subscriptions/templates/{template_key}",
    response_model=SubscriptionTemplateContentResponse,
    responses={403: responses._403, 404: responses._404},
)
def update_subscription_template_content(
    template_key: str,
    payload: SubscriptionTemplateContentUpdate,
    admin_id: Optional[int] = None,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    admin = None
    if admin_id is not None:
        admin = crud.get_admin_by_id(db, admin_id)
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin not found")

    try:
        result = SubscriptionSettingsService.write_template_content(
            template_key,
            payload.content,
            admin=admin,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SubscriptionTemplateContentResponse(**result)


@router.post(
    "/subscriptions/certificates/issue",
    response_model=SubscriptionCertificate,
    responses={403: responses._403},
)
def issue_certificate(
    payload: SubscriptionCertificateIssueRequest,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    if payload.admin_id is not None:
        admin = crud.get_admin_by_id(db, payload.admin_id)
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin not found")
    try:
        cert = SubscriptionCertificateService.issue_certificate(
            email=payload.email,
            domains=payload.domains,
            admin_id=payload.admin_id,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SubscriptionCertificate(**vars(cert))


@router.post(
    "/subscriptions/certificates/renew",
    response_model=SubscriptionCertificate | None,
    responses={403: responses._403},
)
def renew_certificate(
    payload: SubscriptionCertificateRenewRequest,
    _: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    try:
        cert = SubscriptionCertificateService.renew_certificate(domain=payload.domain, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SubscriptionCertificate(**vars(cert)) if cert else None
