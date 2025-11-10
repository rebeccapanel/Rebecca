from typing import Dict, Any

from fastapi import HTTPException

from app.db import GetDB, crud
from app.reb_node import XRayConfig
from app.runtime import xray


def apply_config_and_restart(payload: Dict[str, Any]) -> None:
    """
    Persist a new Xray configuration, restart the master core and refresh nodes.
    """
    try:
        config = XRayConfig(payload, api_port=xray.config.api_port)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    xray.config = config
    with GetDB() as db:
        crud.save_xray_config(db, payload)

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)

    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    xray.hosts.update()
