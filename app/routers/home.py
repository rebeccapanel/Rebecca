from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.services.subscription_settings import SubscriptionSettingsService
from app.templates import render_template

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
def base():
    settings = SubscriptionSettingsService.get_settings(ensure_record=True)
    return render_template(
        settings.home_page_template,
        custom_directory=settings.custom_templates_directory,
    )
