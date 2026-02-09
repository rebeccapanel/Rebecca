import logging
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message="pkg_resources is deprecated", category=UserWarning)
from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from config import ALLOWED_ORIGINS, DOCS, XRAY_SUBSCRIPTION_PATH

_PROTO_ROOT = Path(__file__).resolve().parent / "proto"
if _PROTO_ROOT.exists():
    sys.path.append(str(_PROTO_ROOT))
from app import runtime
from app.db import GetDB, crud
from app.utils.system import register_scheduler_jobs

__version__ = "0.0.33"

IS_RUNNING_TESTS = "PYTEST_CURRENT_TEST" in os.environ
IS_RUNNING_ALEMBIC = any("alembic" in (arg or "").lower() for arg in sys.argv)
if IS_RUNNING_ALEMBIC:
    os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")

SKIP_RUNTIME_INIT = os.getenv("REBECCA_SKIP_RUNTIME_INIT") == "1" or IS_RUNNING_ALEMBIC
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

    from apscheduler.schedulers.background import BackgroundScheduler

    scheduler = BackgroundScheduler({"apscheduler.job_defaults.max_instances": 20}, timezone="UTC")
    runtime.scheduler = scheduler
    register_scheduler_jobs(scheduler)

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
    from app.redis import init_redis, get_redis
    from app.redis.subscription import warmup_subscription_cache
    from app.utils.system import start_redis_if_configured

    def _trigger_node_autoconnect(config=None):
        """
        Fire-and-forget connect requests for all enabled nodes.
        Runs on startup to make sure nodes attempt connection even if main core is absent.
        """
        if not xray:
            return

        try:
            if config is None:
                config = xray.config.include_db_users()
        except Exception as e:
            logger.error(f"Failed to build Xray config for node auto-connect: {e}", exc_info=True)
            config = None

        try:
            from app.models.node import NodeStatus

            with GetDB() as db:
                dbnodes = crud.get_nodes(db=db, enabled=True)
                node_ids = []
                for dbnode in dbnodes:
                    if dbnode.status in (NodeStatus.disabled, NodeStatus.limited):
                        continue
                    node_ids.append(dbnode.id)
                    if dbnode.status not in (NodeStatus.connecting, NodeStatus.connected):
                        crud.update_node_status(db, dbnode, NodeStatus.connecting)

            for node_id in node_ids:
                try:
                    if node_id in xray.nodes and getattr(xray.nodes[node_id], "connected", False):
                        continue
                    xray.operations.connect_node(node_id, config)
                except Exception as e:
                    logger.error(f"Failed to schedule connect for node {node_id}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Failed to enqueue node auto-connect: {e}", exc_info=True)

    def _bootstrap_master_core_and_nodes():
        """
        Build runtime config, start master core when available, then trigger node connects.
        This is invoked on startup in addition to the legacy job hook to guarantee ordering.
        """
        if not xray:
            return

        try:
            config = xray.config.include_db_users()
        except Exception as e:
            logger.error(f"Failed to generate Xray config on startup: {e}", exc_info=True)
            config = None

        if config and getattr(xray, "core", None):
            if xray.core.available and not xray.core.started:
                try:
                    xray.core.start(config)
                except Exception as e:
                    logger.error(f"Failed to start master Xray core on startup: {e}", exc_info=True)
            if xray.core.available and not xray.core.started:
                logger.error("Master Xray core failed to start; check binary path/config.")

        _trigger_node_autoconnect(config=config)

    def on_startup():
        if IS_RUNNING_TESTS:
            return
        paths = [f"{r.path}/" for r in app.routes]
        paths.append("/api/")
        if f"/{XRAY_SUBSCRIPTION_PATH}/" in paths:
            raise ValueError(
                f"you can't use /{XRAY_SUBSCRIPTION_PATH}/ as subscription path it reserved for {app.title}"
            )

        # Start Redis if configured to do so
        start_redis_if_configured()

        # Initialize Redis connection
        init_redis()

        # Start scheduler first (so server can start quickly)
        scheduler.start()

        # Warm up caches if Redis is available
        redis_client = get_redis()
        if redis_client:
            logger.info("Redis is available, warming up caches...")

            # Restore pending backups to Redis first
            try:
                from app.redis.pending_backup import restore_all_backups_to_redis

                restore_all_backups_to_redis()
            except Exception as e:
                logger.warning(f"Failed to restore backups to Redis: {e}", exc_info=True)

            try:
                from app.redis.cache import warmup_users_cache

                logger.info("Warming up users cache (this may take a moment)...")
                total, cached = warmup_users_cache()
                logger.info(f"Users cache warmup completed: {cached}/{total} users cached")
            except Exception as e:
                logger.error(f"Failed to warmup users cache: {e}", exc_info=True)

            # Warm up other caches in background (non-critical)
            def warmup_caches_async():
                try:
                    total, cached = warmup_subscription_cache()
                    logger.info(f"Subscription cache warmup completed: {cached}/{total} users cached")
                except Exception as e:
                    logger.warning(f"Failed to warmup subscription cache: {e}", exc_info=True)

                # Warmup usage cache gradually (to avoid DB overload)
                try:
                    from app.redis.cache import warmup_all_usages_gradually

                    total, cached = warmup_all_usages_gradually()
                    logger.info(f"Usage cache warmup completed: {cached}/{total} records cached")
                except Exception as e:
                    logger.warning(f"Failed to warmup usage cache: {e}", exc_info=True)

                # Warmup services, inbounds, and hosts cache
                try:
                    from app.redis.cache import warmup_services_inbounds_hosts_cache

                    services_count, inbounds_count, hosts_count = warmup_services_inbounds_hosts_cache()
                    logger.info(
                        f"Services/inbounds/hosts cache warmup completed: {services_count} services, {inbounds_count} inbounds, {hosts_count} hosts"
                    )
                except Exception as e:
                    logger.warning(f"Failed to warmup services/inbounds/hosts cache: {e}", exc_info=True)

            # Run non-critical warmup in background thread
            import threading

            warmup_thread = threading.Thread(target=warmup_caches_async, daemon=True)
            warmup_thread.start()
        else:
            logger.info("Redis is not available, validation will use database only")

        # Ensure config is generated, master core is started (when available), and nodes attempt to connect.
        try:
            _bootstrap_master_core_and_nodes()
        except Exception as e:
            logger.error(f"Failed to bootstrap Xray runtime on startup: {e}", exc_info=True)

    def on_shutdown():
        if IS_RUNNING_TESTS:
            return
        if scheduler:
            scheduler.shutdown()

    app.add_event_handler("startup", on_startup)
    app.add_event_handler("shutdown", on_shutdown)

    @app.exception_handler(RequestValidationError)
    def validation_exception_handler(request: Request, exc: RequestValidationError):
        details = {}
        for error in exc.errors():
            details[error["loc"][-1]] = error.get("msg")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=jsonable_encoder({"detail": details}),
        )
