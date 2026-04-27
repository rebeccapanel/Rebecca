import time
import traceback

from app.runtime import app, logger, scheduler, xray
from app.db import GetDB, crud
from app.models.node import NodeStatus
from config import JOB_CORE_HEALTH_CHECK_INTERVAL
from xray_api import exc as xray_exc


_AUTO_RECONNECT_COOLDOWN_SECONDS = max(30, JOB_CORE_HEALTH_CHECK_INTERVAL * 3)
_last_auto_reconnect_attempt: dict[int, float] = {}


def core_health_check():
    config = None
    now = time.time()

    # main core: only attempt to (re)start when binary is available
    if xray.core.available:
        if not xray.core.started:
            if not config:
                config = xray.config.include_db_users()
            xray.core.restart(config)
    else:
        # Ensure we still have a config for node operations even if master core is missing
        if config is None:
            try:
                config = xray.config.include_db_users()
            except Exception:
                config = None

    # nodes' core
    node_status_map: dict[int, NodeStatus] = {}
    try:
        with GetDB() as db:
            for dbnode in crud.get_nodes(db):
                if dbnode.id is not None:
                    node_status_map[int(dbnode.id)] = dbnode.status
    except Exception:
        node_status_map = {}

    for node_id, node in list(xray.nodes.items()):
        connected, started = node.refresh_health(force=True)
        dbnode_status = node_status_map.get(node_id)
        health_error = None

        if dbnode_status == NodeStatus.connected and not connected:
            health_error = "Health check failed: node is disconnected"
        elif dbnode_status == NodeStatus.connected and connected and not started:
            health_error = "Health check failed: node core is not started"

        if health_error:
            try:
                xray.operations.register_node_runtime_error(node_id, health_error)
            except Exception:
                pass

        if dbnode_status in (NodeStatus.disabled, NodeStatus.limited):
            _last_auto_reconnect_attempt.pop(node_id, None)
            continue

        if dbnode_status == NodeStatus.error and not (connected and started):
            last_attempt = _last_auto_reconnect_attempt.get(node_id, 0)
            if now - last_attempt >= _AUTO_RECONNECT_COOLDOWN_SECONDS:
                if not config:
                    config = xray.config.include_db_users()
                _last_auto_reconnect_attempt[node_id] = now
                xray.operations.connect_node(node_id, config, force=True)
            continue

        _last_auto_reconnect_attempt.pop(node_id, None)
        if connected:
            try:
                assert started
                node.api.get_sys_stats(timeout=40)
                try:
                    with GetDB() as db:
                        dbnode = crud.get_node_by_id(db, node_id)
                        if dbnode and dbnode.status not in (NodeStatus.disabled, NodeStatus.limited):
                            if dbnode.status != NodeStatus.connected:
                                crud.update_node_status(
                                    db,
                                    dbnode,
                                    NodeStatus.connected,
                                    version=dbnode.xray_version,
                                )
                except Exception:
                    pass
            except (ConnectionError, xray_exc.XrayError, AssertionError):
                if not config:
                    config = xray.config.include_db_users()
                xray.operations.restart_node(node_id, config)

        if not connected:
            if not config:
                config = xray.config.include_db_users()
            xray.operations.connect_node(node_id, config)


def start_core():
    logger.info("Generating Xray core config")

    start_time = time.time()
    try:
        config = xray.config.include_db_users()
        logger.info(f"Xray core config generated in {(time.time() - start_time):.2f} seconds")
    except Exception as e:
        logger.error(f"Failed to generate Xray config: {e}")
        logger.warning("Panel will start without Xray core. Please fix the Xray configuration.")
        traceback.print_exc()
        return

    # main core
    if xray.core.available:
        if xray.core.started:
            logger.info("Main Xray core already running, skipping start")
        else:
            logger.info("Starting main Xray core")
            try:
                xray.core.start(config)
            except Exception as e:
                logger.error(f"Failed to start Xray core: {e}")
                logger.warning("Panel will continue running without Xray core. Please fix the Xray configuration.")
                traceback.print_exc()
            finally:
                if not xray.core.started:
                    logger.error("Master Xray core did not start successfully during startup.")
    else:
        logger.warning("XRay core is not available. Skipping local core startup but continuing with node connections.")

    # nodes' core
    logger.info("Starting nodes Xray core")
    try:
        with GetDB() as db:
            dbnodes = crud.get_nodes(db=db, enabled=True)
            node_ids = [dbnode.id for dbnode in dbnodes]
            for dbnode in dbnodes:
                crud.update_node_status(db, dbnode, NodeStatus.connecting)

        for node_id in node_ids:
            try:
                xray.operations.connect_node(node_id, config)
            except Exception as e:
                logger.error(f"Failed to connect to node {node_id}: {e}")
                traceback.print_exc()
    except Exception as e:
        logger.error(f"Failed to start nodes: {e}")
        traceback.print_exc()

    scheduler.add_job(
        core_health_check, "interval", seconds=JOB_CORE_HEALTH_CHECK_INTERVAL, coalesce=True, max_instances=1
    )


def app_shutdown():
    logger.info("Stopping main Xray core")
    xray.core.stop()

    logger.info("Stopping nodes Xray core")
    for node in list(xray.nodes.values()):
        try:
            node.disconnect()
        except Exception:
            pass


if app is not None:
    app.add_event_handler("startup", start_core)
    app.add_event_handler("shutdown", app_shutdown)
