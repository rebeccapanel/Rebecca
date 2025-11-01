import asyncio
import time
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, Body
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketDisconnect

from app import logger, xray
from app.db import Session, crud, get_db
from app.dependencies import get_dbnode, validate_dates
from app.models.admin import Admin
from app.models.node import (
    NodeCreate,
    NodeModify,
    NodeResponse,
    NodeSettings,
    NodeStatus,
    NodesUsageResponse,
)
from app.models.proxy import ProxyHost
from app.utils import responses, report
from app.db.models import Node as DBNode

router = APIRouter(
    tags=["Node"], prefix="/api", responses={401: responses._401, 403: responses._403}
)


def add_host_if_needed(new_node: NodeCreate, db: Session):
    """Add a host if specified in the new node settings."""
    if new_node.add_as_new_host:
        host = ProxyHost(
            remark=f"{new_node.name} ({{USERNAME}}) [{{PROTOCOL}} - {{TRANSPORT}}]",
            address=new_node.address,
        )
        for inbound_tag in xray.config.inbounds_by_tag:
            crud.add_host(db, inbound_tag, host)
        xray.hosts.update()


@router.get("/node/settings", response_model=NodeSettings)
def get_node_settings(
    db: Session = Depends(get_db), admin: Admin = Depends(Admin.check_sudo_admin)
):
    """Retrieve the current node settings, including TLS certificate."""
    tls = crud.get_tls_certificate(db)
    return NodeSettings(certificate=tls.certificate)


@router.post("/node", response_model=NodeResponse, responses={409: responses._409})
def add_node(
    new_node: NodeCreate,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Add a new node to the database and optionally add it as a host."""
    try:
        dbnode = crud.create_node(db, new_node)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail=f'Node "{new_node.name}" already exists'
        )

    bg.add_task(xray.operations.connect_node, node_id=dbnode.id)
    bg.add_task(add_host_if_needed, new_node, db)

    report.node_created(dbnode, admin)

    logger.info(f'New node "{dbnode.name}" added')
    return dbnode


@router.get("/node/{node_id}", response_model=NodeResponse)
def get_node(
    dbnode: NodeResponse = Depends(get_dbnode),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Retrieve details of a specific node by its ID."""
    return dbnode


@router.websocket("/node/{node_id}/logs")
async def node_logs(node_id: int, websocket: WebSocket, db: Session = Depends(get_db)):
    token = websocket.query_params.get("token") or websocket.headers.get(
        "Authorization", ""
    ).removeprefix("Bearer ")
    admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if not admin.is_sudo:
        return await websocket.close(reason="You're not allowed", code=4403)

    if not xray.nodes.get(node_id):
        return await websocket.close(reason="Node not found", code=4404)

    if not xray.nodes[node_id].connected:
        return await websocket.close(reason="Node is not connected", code=4400)

    interval = websocket.query_params.get("interval")
    if interval:
        try:
            interval = float(interval)
        except ValueError:
            return await websocket.close(reason="Invalid interval value", code=4400)
        if interval > 10:
            return await websocket.close(
                reason="Interval must be more than 0 and at most 10 seconds", code=4400
            )

    await websocket.accept()

    cache = ""
    last_sent_ts = 0
    node = xray.nodes[node_id]
    with node.get_logs() as logs:
        while True:
            if not node == xray.nodes[node_id]:
                break

            if interval and time.time() - last_sent_ts >= interval and cache:
                try:
                    await websocket.send_text(cache)
                except (WebSocketDisconnect, RuntimeError):
                    break
                cache = ""
                last_sent_ts = time.time()

            if not logs:
                try:
                    await asyncio.wait_for(websocket.receive(), timeout=4)
                    continue
                except asyncio.TimeoutError:
                    continue
                except (WebSocketDisconnect, RuntimeError):
                    break

            log = logs.popleft()

            if interval:
                cache += f"{log}\n"
                continue

            try:
                await websocket.send_text(log)
            except (WebSocketDisconnect, RuntimeError):
                break


@router.get("/nodes", response_model=List[NodeResponse])
def get_nodes(
    db: Session = Depends(get_db), _: Admin = Depends(Admin.check_sudo_admin)
):
    """Retrieve a list of all nodes. Accessible only to sudo admins."""
    return crud.get_nodes(db)


@router.put("/node/{node_id}", response_model=NodeResponse)
def modify_node(
    modified_node: NodeModify,
    bg: BackgroundTasks,
    dbnode: NodeResponse = Depends(get_node),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Update a node's details. Only accessible to sudo admins."""
    previous_status = dbnode.status
    updated_node = crud.update_node(db, dbnode, modified_node)
    updated_node_resp = NodeResponse.model_validate(updated_node)

    if modified_node.status is not None and updated_node_resp.status != previous_status:
        report.node_status_change(updated_node_resp, previous_status=previous_status)

    xray.operations.remove_node(updated_node.id)
    if updated_node.status not in {NodeStatus.disabled, NodeStatus.limited}:
        bg.add_task(xray.operations.connect_node, node_id=updated_node.id)

    logger.info(f'Node "{dbnode.name}" modified')
    return updated_node_resp


@router.post("/node/{node_id}/usage/reset", response_model=NodeResponse)
def reset_node_usage(
    bg: BackgroundTasks,
    dbnode: NodeResponse = Depends(get_node),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Reset the tracked data usage of a node."""
    updated_node = crud.reset_node_usage(db, dbnode)
    bg.add_task(xray.operations.connect_node, node_id=updated_node.id)
    report.node_usage_reset(updated_node, admin)
    logger.info(f'Node "{dbnode.name}" usage reset')
    return updated_node


@router.post("/node/{node_id}/reconnect")
def reconnect_node(
    bg: BackgroundTasks,
    dbnode: NodeResponse = Depends(get_node),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Trigger a reconnection for the specified node. Only accessible to sudo admins."""
    bg.add_task(xray.operations.connect_node, node_id=dbnode.id)
    return {"detail": "Reconnection task scheduled"}


@router.delete("/node/{node_id}")
def remove_node(
    bg: BackgroundTasks,
    dbnode: DBNode = Depends(get_dbnode),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Delete a node and schedule xray cleanup in the background."""
    crud.remove_node(db, dbnode)
    bg.add_task(xray.operations.remove_node, dbnode.id)

    report.node_deleted(dbnode, admin)

    logger.info(f'Node "{dbnode.name}" deleted')
    return {}


@router.get("/nodes/usage", response_model=NodesUsageResponse)
def get_usage(
    db: Session = Depends(get_db),
    start: str = "",
    end: str = "",
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Retrieve usage statistics for nodes within a specified date range."""
    start, end = validate_dates(start, end)

    usages = crud.get_nodes_usage(db, start, end)

    return {"usages": usages}


@router.get("/node/{node_id}/usage/daily", responses={403: responses._403, 404: responses._404})
def get_node_usage_daily(
    node_id: int,
    start: str = "",
    end: str = "",
    granularity: str = "day",
    db: Session = Depends(get_db),
    _: Admin = Depends(Admin.check_sudo_admin)
):
    """
    Get usage for a specific node, regardless of admin.
    Supports daily (default) or hourly granularity.
    """
    start, end = validate_dates(start, end)
    granularity = (granularity or "day").lower()
    if granularity not in {"day", "hour"}:
        raise HTTPException(status_code=400, detail="Invalid granularity. Use 'day' or 'hour'.")

    dbnode = db.query(DBNode).filter(DBNode.id == node_id).first()
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")
    
    usages = crud.get_node_usage_by_day(db, node_id, start, end, granularity)
    return {
        "node_id": node_id,
        "node_name": dbnode.name,
        "usages": usages
    }


@router.post("/node/{node_id}/xray/update", responses={403: responses._403, 404: responses._404})
def update_node_core(
    node_id: int,
    payload: dict = Body(..., example={"version": "v1.8.11"}),
    dbnode: NodeResponse = Depends(get_node),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Ask a node to update/switch its Xray-core to a specific version, then restart node core."""
    version = payload.get("version")
    if not version or not isinstance(version, str):
        raise HTTPException(status_code=422, detail="version is required")

    node = xray.nodes.get(node_id)
    if not node:
        raise HTTPException(404, detail="Node not connected")

    try:
        node.update_core(version=version)
        startup_config = xray.config.include_db_users()
        xray.operations.restart_node(node_id, startup_config)
    except Exception as e:
        raise HTTPException(502, detail=f"Update failed: {e}")

    return {"detail": f"Node {dbnode.name} switched to {version}"}


@router.post("/node/{node_id}/geo/update", responses={403: responses._403, 404: responses._404})
def update_node_geo(
    node_id: int,
    payload: dict = Body(..., example={
        "files": [{"name": "geosite.dat", "url": "https://.../geosite.dat"},
                  {"name": "geoip.dat", "url": "https://.../geoip.dat"}],
        "template_index_url": "https://.../index.json",
        "template_name": "standard"
    }),
    dbnode: NodeResponse = Depends(get_node),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """
    Download and install geo assets on a specific node (custom mode).
    Supports direct files list or template selection.
    """
    files = payload.get("files") or []
    template_index_url = payload.get("template_index_url") or ""
    template_name = payload.get("template_name") or ""

    if not files and (template_index_url and template_name):
        try:
            r = requests.get(template_index_url, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            raise HTTPException(502, detail=f"Failed to fetch template index: {e}")
        candidates = data.get("templates", data if isinstance(data, list) else [])
        found = None
        for t in candidates:
            if t.get("name") == template_name:
                found = t
                break
        if not found:
            raise HTTPException(404, detail="Template not found in index.")
        links = found.get("links") or {}
        files = [{"name": k, "url": v} for k, v in links.items()]

    if not files or not isinstance(files, list):
        raise HTTPException(422, detail="'files' must be a non-empty list of {name,url}.")

    node = xray.nodes.get(node_id)
    if not node:
        raise HTTPException(404, detail="Node not connected")

    try:
        node.update_geo(files=files)
        startup_config = xray.config.include_db_users()
        xray.operations.restart_node(node_id, startup_config)
    except Exception as e:
        raise HTTPException(502, detail=f"Geo update failed: {e}")

    return {"detail": f"Geo assets updated on node {dbnode.name}"}





