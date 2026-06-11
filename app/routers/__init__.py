from fastapi import APIRouter, Depends
from app.utils.request_context import capture_subscription_request_origin
from . import (
    ads,
    home,
)

api_router = APIRouter()

routers = [
    ads.router,
    home.router,
]

for router in routers:
    api_router.include_router(router, dependencies=[Depends(capture_subscription_request_origin)])

__all__ = ["api_router"]
