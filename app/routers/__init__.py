from fastapi import APIRouter
from . import (
    ads,
    admin,
    core,
    node,
    subscription,
    subscription_alias,
    system,
    user_template,
    user,
    home,
    service,
    settings,
    myaccount,
)

api_router = APIRouter()

routers = [
    ads.router,
    admin.router,
    core.router,
    node.router,
    subscription.router,
    system.router,
    user_template.router,
    user.router,
    home.router,
    service.router,
    settings.router,
    myaccount.router,
    subscription_alias.router,
]

for router in routers:
    api_router.include_router(router)

__all__ = ["api_router"]
