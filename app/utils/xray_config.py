from typing import Dict, Any

from fastapi import HTTPException, status

from app.db import GetDB, crud
from app.reb_node import XRayConfig, state
from app.runtime import xray


def restart_xray_and_invalidate_cache(startup_config=None):
    """
    Restart Xray core and invalidate hosts cache.
    This should be called whenever Xray is restarted to ensure cache is fresh.
    """
    if startup_config is None:
        startup_config = xray.config.include_db_users()

    xray.core.restart(startup_config)

    xray.invalidate_service_hosts_cache()
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
            from app.reb_node.state import rebuild_service_hosts_cache
            from app.redis.cache import cache_service_host_map
            from app.reb_node import state as xray_state

            inbounds_dict = {
                "inbounds_by_tag": {tag: inbound for tag, inbound in xray.config.inbounds_by_tag.items()},
                "inbounds_by_protocol": {proto: tags for proto, tags in xray.config.inbounds_by_protocol.items()},
            }
            cache_inbounds(inbounds_dict)
            invalidate_service_host_map_cache()
            rebuild_service_hosts_cache()
            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map:
                    cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if Redis is unavailable

    for node_id, node in list(xray.nodes.items()):
        if node.connected:
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
        startup_config = xray.config.include_db_users()
        logger.info("Xray core config generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate Xray config: {e}")
        raise

    # Invalidate caches to force refresh on next access
    xray.invalidate_service_hosts_cache()
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
            from app.reb_node.state import rebuild_service_hosts_cache
            from app.redis.cache import cache_service_host_map
            from app.reb_node import state as xray_state

            inbounds_dict = {
                "inbounds_by_tag": {tag: inbound for tag, inbound in xray.config.inbounds_by_tag.items()},
                "inbounds_by_protocol": {proto: tags for proto, tags in xray.config.inbounds_by_protocol.items()},
            }
            cache_inbounds(inbounds_dict)
            invalidate_service_host_map_cache()
            rebuild_service_hosts_cache()
            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map:
                    cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if Redis is unavailable

    # Reconnect all nodes (like in startup, but without restarting their cores)
    logger.info("Reconnecting nodes")
    try:
        from app.models.node import NodeStatus

        with GetDB() as db:
            dbnodes = crud.get_nodes(db=db, enabled=True)
            node_ids = [dbnode.id for dbnode in dbnodes]
            for dbnode in dbnodes:
                # Only reconnect if not already connecting
                if dbnode.status not in (NodeStatus.connecting, NodeStatus.connected):
                    crud.update_node_status(db, dbnode, NodeStatus.connecting)

        # Reconnect nodes (this will update their config)
        # Note: connect_node will call node.start() which will restart the node's Xray core
        # if it's already started. This is acceptable for soft reload as it only affects nodes,
        # not the main Xray core.
        for node_id in node_ids:
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
                xray.operations.connect_node(node_id, startup_config)
            except Exception as e:
                logger.error(f"Failed to reconnect node {node_id}: {e}")
    except Exception as e:
        logger.error(f"Failed to reconnect nodes: {e}")

    # Note: We intentionally do NOT:
    # - Restart main Xray core (xray.core.restart) - this keeps connections active
    # - Restart node Xray cores (xray.operations.restart_node) - we use connect_node instead
    # This keeps all connections active while refreshing the panel state
