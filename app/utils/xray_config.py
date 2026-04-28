from typing import Dict, Any

from fastapi import HTTPException, status

from app.db import GetDB, crud
from app.reb_node import XRayConfig, state
from app.runtime import xray
from app.models.node import XrayConfigMode
from app.utils.xray_targets import (
    MASTER_TARGET_ID,
    get_node_runtime_config,
    node_target_id,
    parse_target_id,
    save_target_raw_config,
)


def restart_xray_and_invalidate_cache(startup_config=None):
    """
    Restart Xray core and invalidate hosts cache.
    This should be called whenever Xray is restarted to ensure cache is fresh.
    """
    if startup_config is None:
        restart_xray_targets()
        return

    xray.core.restart(startup_config)
    xray.invalidate_service_hosts_cache()
    xray.hosts.update()

    with GetDB() as db:
        dbnodes = crud.get_nodes(db=db, enabled=True)
        default_node_ids = [
            dbnode.id
            for dbnode in dbnodes
            if getattr(dbnode, "xray_config_mode", XrayConfigMode.default) == XrayConfigMode.default
        ]

    for node_id in default_node_ids:
        node = xray.nodes.get(node_id)
        if node and node.connected:
            xray.operations.restart_node(node_id, startup_config)


def _refresh_master_runtime_config(raw_config: dict | None = None) -> XRayConfig:
    if raw_config is None:
        with GetDB() as db:
            raw_config = crud.get_xray_config(db)
    config = XRayConfig(raw_config, api_port=xray.config.api_port)
    xray.config = config
    state.config = config
    return config


def restart_xray_targets(target_ids: set[str] | list[str] | tuple[str, ...] | None = None) -> None:
    """
    Restart master/default/custom targets with their own effective configs.
    None means restart every runtime target.
    """
    normalized_targets = set(target_ids or [])
    restart_all = not normalized_targets
    restart_master = restart_all or MASTER_TARGET_ID in normalized_targets

    with GetDB() as db:
        master_raw = crud.get_xray_config(db)
        master_config = _refresh_master_runtime_config(master_raw)
        dbnodes = crud.get_nodes(db=db, enabled=True)

        node_config_map: dict[int, XRayConfig] = {}
        for dbnode in dbnodes:
            target_id = node_target_id(dbnode.id)
            mode = getattr(dbnode, "xray_config_mode", XrayConfigMode.default)
            uses_default = mode == XrayConfigMode.default
            if restart_all or target_id in normalized_targets or (restart_master and uses_default):
                node_config_map[dbnode.id] = get_node_runtime_config(
                    db,
                    dbnode,
                    api_port=xray.config.api_port,
                    master_config=master_raw,
                ).include_db_users()

        master_startup_config = master_config.include_db_users() if restart_master else None

    if restart_master and master_startup_config is not None:
        xray.core.restart(master_startup_config)
        xray.invalidate_service_hosts_cache()
        xray.hosts.update()

    for node_id, startup_config in node_config_map.items():
        node = xray.nodes.get(node_id)
        if node and node.connected:
            xray.operations.restart_node(node_id, startup_config)


def apply_config(payload: Dict[str, Any]) -> XRayConfig:
    """
    Persist a new Xray configuration without restarting the core.
    """
    try:
        config = XRayConfig(payload, api_port=xray.config.api_port)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    if not xray.core.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="XRay core is not available in this environment. Please install XRay before applying a configuration.",
        )

    xray.config = config
    state.config = config
    with GetDB() as db:
        crud.save_xray_config(db, payload)

    return config


def apply_config_and_restart(payload: Dict[str, Any]) -> None:
    """
    Persist a new Xray configuration, restart the master core and refresh nodes.
    """
    config = apply_config(payload)
    startup_config = config.include_db_users()
    restart_xray_and_invalidate_cache(startup_config)


def apply_target_config_and_restart(target_id: str, payload: Dict[str, Any]) -> None:
    """
    Persist a target config. Master updates refresh xray.config; node updates switch that node to custom.
    """
    try:
        config = XRayConfig(payload, api_port=xray.config.api_port)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    kind, _ = parse_target_id(target_id)
    with GetDB() as db:
        save_target_raw_config(db, target_id, payload)

    if kind == MASTER_TARGET_ID:
        xray.config = config
        state.config = config

    restart_xray_targets({target_id})


def soft_reload_panel():
    """
    Soft reload the panel without restarting Xray core.
    This performs a full reload similar to startup:
    - Reloads config from database
    - Refreshes users in config
    - Reconnects all nodes (without restarting their Xray cores)
    - Invalidates caches
    But keeps the main Xray core running (does not stop/restart it).
    """
    import logging

    logger = logging.getLogger("uvicorn.error")

    logger.info("Generating Xray core config")

    # Reload config from database
    with GetDB() as db:
        raw_config = crud.get_xray_config(db)

    # Update config
    new_config = XRayConfig(raw_config, api_port=xray.config.api_port)
    xray.config = new_config
    state.config = new_config

    # Generate config with users (like in startup)
    try:
        xray.config.include_db_users()
        logger.info("Xray core config generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate Xray config: {e}")
        raise

    # Invalidate caches to force refresh on next access
    xray.invalidate_service_hosts_cache()
    xray.hosts.update()

    # Reconnect all nodes (like in startup, but without restarting their cores)
    logger.info("Reconnecting nodes")
    try:
        from app.models.node import NodeStatus

        with GetDB() as db:
            master_raw = crud.get_xray_config(db)
            dbnodes = crud.get_nodes(db=db, enabled=True)
            node_configs = {
                dbnode.id: get_node_runtime_config(
                    db,
                    dbnode,
                    api_port=xray.config.api_port,
                    master_config=master_raw,
                ).include_db_users()
                for dbnode in dbnodes
            }
            for dbnode in dbnodes:
                # Only reconnect if not already connecting
                if dbnode.status not in (NodeStatus.connecting, NodeStatus.connected):
                    crud.update_node_status(db, dbnode, NodeStatus.connecting)

        # Reconnect nodes (this will update their config)
        # Note: connect_node will call node.start() which will restart the node's Xray core
        # if it's already started. This is acceptable for soft reload as it only affects nodes,
        # not the main Xray core.
        for node_id, node_config in node_configs.items():
            try:
                # Disconnect first if connected, then reconnect with new config
                if node_id in xray.nodes:
                    node = xray.nodes[node_id]
                    if node.connected:
                        try:
                            node.disconnect()
                        except Exception:
                            pass

                # Reconnect with new config (this will start/restart the node's Xray core)
                xray.operations.connect_node(node_id, node_config)
            except Exception as e:
                logger.error(f"Failed to reconnect node {node_id}: {e}")
    except Exception as e:
        logger.error(f"Failed to reconnect nodes: {e}")

    # Note: We intentionally do NOT:
    # - Restart main Xray core (xray.core.restart) - this keeps connections active
    # - Restart node Xray cores (xray.operations.restart_node) - we use connect_node instead
    # This keeps all connections active while refreshing the panel state
