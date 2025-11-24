import logging
import os
import sys

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from config import ALLOWED_ORIGINS, DOCS, XRAY_SUBSCRIPTION_PATH
from app import runtime
from app.utils.system import register_scheduler_jobs

__version__ = "0.0.13"

IS_RUNNING_ALEMBIC = any("alembic" in (arg or "").lower() for arg in sys.argv)
if IS_RUNNING_ALEMBIC:
    os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")

SKIP_RUNTIME_INIT = (
    os.getenv("REBECCA_SKIP_RUNTIME_INIT") == "1" or IS_RUNNING_ALEMBIC
)
runtime.scheduler = None
runtime.app = None

logger = logging.getLogger("uvicorn.error")
runtime.logger = logger

xray = None
if not SKIP_RUNTIME_INIT:
    from . import reb_node as xray  # noqa: F401
runtime.xray = xray

if SKIP_RUNTIME_INIT:
    app = None  # type: ignore[assignment]
    scheduler = None  # type: ignore[assignment]
else:
    app = FastAPI(
        title="RebeccaAPI",
        description="Unified GUI Censorship Resistant Solution Powered by Xray",
        version=__version__,
        docs_url="/docs" if DOCS else None,
        redoc_url="/redoc" if DOCS else None,
    )

    scheduler = BackgroundScheduler(
        {"apscheduler.job_defaults.max_instances": 20}, timezone="UTC"
    )
    register_scheduler_jobs(scheduler)
    runtime.scheduler = scheduler

    runtime.app = app
    from app.db.schema import ensure_core_schema
    ensure_core_schema()
    allowed_origins = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]
    if not allowed_origins:
        allowed_origins = ["*"]

    allow_credentials = True
    if "*" in allowed_origins:
        allowed_origins = ["*"]
        allow_credentials = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    import dashboard  # noqa: F401
    from app import jobs, routers, telegram  # noqa
    from app.routers import api_router  # noqa

    runtime.telegram = telegram

    app.include_router(api_router)


def use_route_names_as_operation_ids(app: FastAPI) -> None:
    for route in app.routes:
        if isinstance(route, APIRoute):
            route.operation_id = route.name


if not SKIP_RUNTIME_INIT:
    use_route_names_as_operation_ids(app)


if not SKIP_RUNTIME_INIT:
    @app.on_event("startup")
    def on_startup():
        paths = [f"{r.path}/" for r in app.routes]
        paths.append("/api/")
        if f"/{XRAY_SUBSCRIPTION_PATH}/" in paths:
            raise ValueError(
                f"you can't use /{XRAY_SUBSCRIPTION_PATH}/ as subscription path it reserved for {app.title}"
            )
        scheduler.start()


    @app.on_event("shutdown")
    def on_shutdown():
        scheduler.shutdown()


    @app.exception_handler(RequestValidationError)
    def validation_exception_handler(request: Request, exc: RequestValidationError):
        details = {}
        for error in exc.errors():
            details[error["loc"][-1]] = error.get("msg")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=jsonable_encoder({"detail": details}),
        )
