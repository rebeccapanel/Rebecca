from fastapi import APIRouter
from . import (
    ads,
    admin, 
    core, 
    node, 
    subscription, 
    system, 
    user_template, 
    user,
    home,
    service_v2,
    user_v2,
    settings,
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
    service_v2.router,
    user_v2.router,
    settings.router,
]

for router in routers:
    api_router.include_router(router)

__all__ = ["api_router"]


