from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional

from fastapi import Request


subscription_request_origin: ContextVar[Optional[str]] = ContextVar(
    "subscription_request_origin",
    default=None,
)


def _first_header_value(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.split(",", 1)[0].strip() or None


def get_request_origin(request: Request) -> str:
    proto = _first_header_value(request.headers.get("x-forwarded-proto")) or request.url.scheme
    host = _first_header_value(request.headers.get("x-forwarded-host")) or request.headers.get("host")
    if not host:
        host = request.url.netloc
    return f"{proto}://{host}".rstrip("/")


def get_subscription_request_origin() -> Optional[str]:
    return subscription_request_origin.get()


async def capture_subscription_request_origin(request: Request):
    token = subscription_request_origin.set(get_request_origin(request))
    try:
        yield
    finally:
        subscription_request_origin.reset(token)


@contextmanager
def use_subscription_request_origin(request: Request):
    token = subscription_request_origin.set(get_request_origin(request))
    try:
        yield
    finally:
        subscription_request_origin.reset(token)
