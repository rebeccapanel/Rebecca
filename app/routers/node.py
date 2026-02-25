import asyncio
import time
from typing import List, Union

import requests

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, Body
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketDisconnect

from app.runtime import logger, xray
from app.db import Session, crud, get_db, GetDB
from app.dependencies import get_dbnode, validate_dates
from app.models.admin import Admin, AdminRole
from app.models.node import (
    MasterNodeResponse,
    MasterNodeUpdate,
    NodeCreate,
    NodeModify,
    NodeResponse,
    NodeSettings,
    NodeStatus,
    NodesUsageResponse,
)
from app.models.proxy import ProxyHost
from app.utils import responses, report
from app.db.models import MasterNodeState as DBMasterNodeState, Node as DBNode
from app.routers.core import GEO_TEMPLATES_INDEX_DEFAULT
from app.utils.xray_logs import normalize_log_chunk, sort_log_lines
from app.utils.crypto import (
    generate_certificate,
    generate_unique_cn,
    extract_public_key_from_certificate,
)
from uuid import uuid4

router = APIRouter(tags=["Node"], prefix="/api", responses={401: responses._401, 403: responses._403})

_PENDING_CERTS: dict[str, dict[str, str]] = {}


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


MASTER_NODE_NAME = "Master"


def _serialize_node_response(dbnode: Union[DBNode, NodeResponse]) -> NodeResponse:
    """Convert DB node rows to API responses enriched with runtime metadata."""
    node_response = dbnode if isinstance(dbnode, NodeResponse) else NodeResponse.model_validate(dbnode)
    runtime_node = xray.nodes.get(node_response.id)
    if runtime_node:
        node_response.node_service_version = getattr(runtime_node, "node_version", None)
    return node_response


def _augment_node_cert_fields(
    node_response: NodeResponse, dbnode: Union[DBNode, NodeResponse], default_cert: str | None
) -> NodeResponse:
    cert_value = getattr(dbnode, "certificate", None)
    normalized_default = default_cert.strip() if isinstance(default_cert, str) else None
    normalized_cert = cert_value.strip() if isinstance(cert_value, str) else None

    has_custom_cert = False
    uses_default_cert = True
    public_key = None

    if normalized_cert:
        if normalized_default and normalized_cert == normalized_default:
            uses_default_cert = True
        else:
            has_custom_cert = True
            uses_default_cert = False
            try:
                public_key = extract_public_key_from_certificate(cert_value)
            except Exception as exc:
                logger.warning("Failed to extract public key for node %s: %s", node_response.id, exc)

    updated = node_response.model_copy(
        update={
            "has_custom_certificate": has_custom_cert,
            "uses_default_certificate": uses_default_cert,
            "certificate_public_key": public_key,
            "node_certificate": cert_value if has_custom_cert else None,
        }
    )
    return updated


def _build_master_response(master: DBMasterNodeState) -> MasterNodeResponse:
    total_usage = (master.uplink or 0) + (master.downlink or 0)
    data_limit = master.data_limit
    remaining = max((data_limit or 0) - total_usage, 0) if data_limit is not None else None

    return MasterNodeResponse(
        id=master.id,
        name=MASTER_NODE_NAME,
        status=master.status,
        message=master.message,
        data_limit=data_limit,
        uplink=master.uplink or 0,
        downlink=master.downlink or 0,
        total_usage=total_usage,
        remaining_data=remaining,
        limit_exceeded=bool(data_limit is not None and total_usage >= data_limit),
        updated_at=master.updated_at,
    )


@router.get("/node/master", response_model=MasterNodeResponse, responses={403: responses._403})
def get_master_node_state(
    db: Session = Depends(get_db),
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Retrieve the current usage and limits for the master node."""
    master_state = crud.get_master_node_state(db)
    return _build_master_response(master_state)


@router.put("/node/master", response_model=MasterNodeResponse, responses={403: responses._403})
def update_master_node_state(
    payload: MasterNodeUpdate,
    db: Session = Depends(get_db),
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Update master node settings such as data limit."""
    master_state = crud.set_master_data_limit(db, payload.data_limit)
    return _build_master_response(master_state)


@router.post("/node/master/usage/reset", response_model=MasterNodeResponse, responses={403: responses._403})
def reset_master_node_usage(
    db: Session = Depends(get_db),
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Reset usage counters for the master node."""
    master_state = crud.reset_master_usage(db)
    logger.info("Master usage reset")
    return _build_master_response(master_state)


@router.get("/node/settings", response_model=NodeSettings)
def get_node_settings(db: Session = Depends(get_db), admin: Admin = Depends(Admin.check_sudo_admin)):
    """Retrieve the current node settings, including the shared TLS certificate (legacy)."""
    tls = crud.get_tls_certificate(db)
    return NodeSettings(
        certificate=tls.certificate,
        node_certificate=None,
        node_certificate_key=None,
    )


@router.post("/node/certificate/new")
def issue_node_certificate(
    admin: Admin = Depends(Admin.check_sudo_admin),
) -> dict:
    """
    Generate a brand new certificate/key pair for a node creation flow.
    """
    unique_cn = generate_unique_cn()
    cert_pair = generate_certificate(cn=unique_cn)
    token = uuid4().hex
    _PENDING_CERTS[token] = {
        "certificate": cert_pair.get("cert"),
        "certificate_key": cert_pair.get("key"),
    }
    return {
        "certificate": cert_pair.get("cert"),
        "certificate_token": token,
    }


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
        raise HTTPException(status_code=409, detail=f'Node "{new_node.name}" already exists')

    bg.add_task(xray.operations.connect_node, node_id=dbnode.id)
    bg.add_task(add_host_if_needed, new_node, db)
    bg.add_task(
        report.node_created,
        NodeResponse.model_validate(dbnode),
        getattr(admin, "username", str(admin)),
    )

    logger.info(f'New node "{dbnode.name}" added')
    default_cert = crud.get_tls_certificate(db).certificate
    resp = _augment_node_cert_fields(_serialize_node_response(dbnode), dbnode, default_cert)
    return resp.model_copy(
        update={
            "node_certificate": dbnode.certificate,
        }
    )


@router.get("/node/{node_id}", response_model=NodeResponse)
def get_node(
    dbnode: NodeResponse = Depends(get_dbnode),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Retrieve details of a specific node by its ID."""
    with GetDB() as db:
        default_cert = crud.get_tls_certificate(db).certificate
    return _augment_node_cert_fields(_serialize_node_response(dbnode), dbnode, default_cert)


@router.post("/node/{node_id}/certificate/regenerate", response_model=NodeResponse)
def regenerate_node_certificate(
    node_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Regenerate a unique certificate for an existing node and return it."""
    dbnode = crud.get_node_by_id(db, node_id)
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")

    updated = crud.regenerate_node_certificate(db, dbnode)

    # Clear cached TLS so new cert is used immediately
    try:
        from app.reb_node.operations import get_tls

        get_tls.cache_clear()
    except Exception:
        pass

    default_cert = crud.get_tls_certificate(db).certificate
    resp = _augment_node_cert_fields(_serialize_node_response(updated), updated, default_cert)
    return resp.model_copy(
        update={
            "node_certificate": updated.certificate,
        }
    )


@router.websocket("/node/{node_id}/logs")
async def node_logs(node_id: int, websocket: WebSocket):
    token = websocket.query_params.get("token") or websocket.headers.get("Authorization", "").removeprefix("Bearer ")
    with GetDB() as db:
        admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if admin.role not in (AdminRole.sudo, AdminRole.full_access):
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
            return await websocket.close(reason="Interval must be more than 0 and at most 10 seconds", code=4400)

    await websocket.accept()

    cache: list[str] = []
    last_sent_ts = 0
    node = xray.nodes[node_id]

    async def _flush_cache() -> bool:
        nonlocal cache, last_sent_ts
        if not cache:
            return True
        try:
            for line in sort_log_lines(cache):
                await websocket.send_text(line)
        except (WebSocketDisconnect, RuntimeError):
            return False
        cache = []
        last_sent_ts = time.time()
        return True

    with node.get_logs() as logs:
        while True:
            if not node == xray.nodes[node_id]:
                break

            if interval and time.time() - last_sent_ts >= interval and cache:
                if not await _flush_cache():
                    break

            if not logs:
                try:
                    await asyncio.wait_for(websocket.receive(), timeout=4)
                    continue
                except asyncio.TimeoutError:
                    continue
                except (WebSocketDisconnect, RuntimeError):
                    break

            log_chunk = str(logs.popleft())
            lines = normalize_log_chunk(log_chunk)

            if interval:
                cache.extend(lines)
                continue

            send_failed = False
            for line in sort_log_lines(lines):
                try:
                    await websocket.send_text(line)
                except (WebSocketDisconnect, RuntimeError):
                    send_failed = True
                    break
            if send_failed:
                break


@router.get("/nodes", response_model=List[NodeResponse])
def get_nodes(db: Session = Depends(get_db), _: Admin = Depends(Admin.check_sudo_admin)):
    """Retrieve a list of all nodes. Accessible only to sudo admins."""
    nodes = crud.get_nodes(db)
    default_cert = crud.get_tls_certificate(db).certificate
    return [_augment_node_cert_fields(_serialize_node_response(node), node, default_cert) for node in nodes]


@router.put("/node/{node_id}", response_model=NodeResponse)
def modify_node(
    modified_node: NodeModify,
    bg: BackgroundTasks,
    dbnode: DBNode = Depends(get_dbnode),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Update a node's details. Only accessible to sudo admins."""
    previous_status = dbnode.status
    updated_node = crud.update_node(db, dbnode, modified_node)
    updated_node_resp = NodeResponse.model_validate(updated_node)

    if modified_node.status is not None and updated_node_resp.status != previous_status:
        bg.add_task(report.node_status_change, updated_node_resp, previous_status=previous_status)

    bg.add_task(xray.operations.remove_node, updated_node.id)
    if updated_node.status not in {NodeStatus.disabled, NodeStatus.limited}:
        bg.add_task(xray.operations.connect_node, node_id=updated_node.id)

    logger.info(f'Node "{dbnode.name}" modified')
    default_cert = crud.get_tls_certificate(db).certificate
    return _augment_node_cert_fields(_serialize_node_response(updated_node_resp), updated_node_resp, default_cert)


@router.post("/node/{node_id}/usage/reset", response_model=NodeResponse)
def reset_node_usage(
    bg: BackgroundTasks,
    dbnode: DBNode = Depends(get_dbnode),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Reset the tracked data usage of a node."""
    updated_node = crud.reset_node_usage(db, dbnode)
    bg.add_task(xray.operations.connect_node, node_id=updated_node.id)
    report.node_usage_reset(updated_node, admin)
    logger.info(f'Node "{dbnode.name}" usage reset')
    default_cert = crud.get_tls_certificate(db).certificate
    return _augment_node_cert_fields(_serialize_node_response(updated_node), updated_node, default_cert)


@router.post("/node/{node_id}/reconnect")
def reconnect_node(
    bg: BackgroundTasks,
    dbnode: DBNode = Depends(get_dbnode),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Force a reconnection for the specified node (disconnect + reconnect)."""
    if dbnode.status in {NodeStatus.disabled, NodeStatus.limited}:
        raise HTTPException(status_code=400, detail="Node is disabled or limited")

    bg.add_task(xray.operations.connect_node, node_id=dbnode.id, force=True)
    return {"detail": "Reconnection task scheduled", "node_id": dbnode.id}


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
    _: Admin = Depends(Admin.check_sudo_admin),
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
    return {"node_id": node_id, "node_name": dbnode.name, "usages": usages}


@router.post("/node/{node_id}/xray/update", responses={403: responses._403, 404: responses._404})
def update_node_core(
    node_id: int,
    payload: dict = Body(..., examples={"default": {"version": "v1.8.11"}}),
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

    _node_operation_or_raise(
        node_id=node_id,
        node_name=dbnode.name,
        action=lambda: node.update_core(version=version),
        failure_message=f"Unable to update node core for {dbnode.name}",
    )
    startup_config = xray.config.include_db_users()
    xray.operations.restart_node(node_id, startup_config)
    xray.operations.schedule_node_reconnect(node_id, config=startup_config, delay_seconds=8)

    return {"detail": f"Node {dbnode.name} switched to {version}"}


@router.post("/node/{node_id}/geo/update", responses={403: responses._403, 404: responses._404})
def update_node_geo(
    node_id: int,
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "files": [
                    {"name": "geosite.dat", "url": "https://.../geosite.dat"},
                    {"name": "geoip.dat", "url": "https://.../geoip.dat"},
                ],
                "template_index_url": "https://.../index.json",
                "template_name": "standard",
            }
        },
    ),
    dbnode: NodeResponse = Depends(get_node),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """
    Download and install geo assets on a specific node (custom mode).
    Supports direct files list or template selection.
    """
    files = payload.get("files") or []
    mode = (payload.get("mode") or "").strip().lower()
    template_index_url = (
        payload.get("template_index_url") or payload.get("templateIndexUrl") or GEO_TEMPLATES_INDEX_DEFAULT
    ).strip()
    template_name = (payload.get("template_name") or payload.get("templateName") or "").strip()

    if not files and (mode == "template" or template_name):
        try:
            r = requests.get(template_index_url, timeout=60)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            raise HTTPException(502, detail=f"Failed to fetch template index: {e}")
        candidates = data.get("templates", data if isinstance(data, list) else [])
        if not isinstance(candidates, list) or not candidates:
            raise HTTPException(404, detail="No templates found in index.")

        target_name = template_name or candidates[0].get("name") or ""
        found = next((t for t in candidates if t.get("name") == target_name), None)
        if not found:
            raise HTTPException(404, detail="Template not found in index.")

        links = found.get("links") or {}
        files = found.get("files") or [{"name": k, "url": v} for k, v in links.items()]

    if not files or not isinstance(files, list):
        raise HTTPException(422, detail="'files' must be a non-empty list of {name,url}.")

    node = xray.nodes.get(node_id)
    if not node:
        raise HTTPException(404, detail="Node not connected")

    _node_operation_or_raise(
        node_id=node_id,
        node_name=dbnode.name,
        action=lambda: node.update_geo(files=files),
        failure_message=f"Unable to update geo assets for {dbnode.name}",
    )
    startup_config = xray.config.include_db_users()
    xray.operations.restart_node(node_id, startup_config)

    return {"detail": f"Geo assets updated on node {dbnode.name}"}


def _node_operation_or_raise(node_id: int, node_name: str, action, failure_message: str):
    try:
        return action()
    except Exception as exc:
        logger.exception(failure_message)
        detail = getattr(exc, "detail", None) or str(exc) or "Unknown node error"
        try:
            xray.operations.register_node_runtime_error(node_id, detail, fallback_name=node_name)
        except Exception:
            pass
        status_code = getattr(exc, "status_code", None) or 502
        if not isinstance(status_code, int) or status_code < 400:
            status_code = 502
        raise HTTPException(status_code, detail=f'Node "{node_name}" has problem: {detail}') from exc


@router.post("/node/{node_id}/service/restart", responses={403: responses._403, 404: responses._404})
def restart_node_service(
    node_id: int,
    dbnode: NodeResponse = Depends(get_node),
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Trigger the Rebecca-node maintenance service to restart containers on a node."""
    node = xray.nodes.get(node_id)
    if not node:
        raise HTTPException(404, detail="Node not connected")

    _node_operation_or_raise(
        node_id=node_id,
        node_name=dbnode.name,
        action=node.restart_host_service,
        failure_message=f"Unable to restart node service for {dbnode.name}",
    )
    startup_config = xray.config.include_db_users()
    xray.operations.schedule_node_reconnect(node_id, config=startup_config, delay_seconds=10)
    return {"detail": f"Restart requested for node {dbnode.name}"}


@router.post("/node/{node_id}/service/update", responses={403: responses._403, 404: responses._404})
def update_node_service(
    node_id: int,
    dbnode: NodeResponse = Depends(get_node),
    _: Admin = Depends(Admin.check_sudo_admin),
):
    """Trigger the Rebecca-node maintenance service to update node containers."""
    node = xray.nodes.get(node_id)
    if not node:
        raise HTTPException(404, detail="Node not connected")

    _node_operation_or_raise(
        node_id=node_id,
        node_name=dbnode.name,
        action=node.update_host_service,
        failure_message=f"Unable to update Rebecca-node service for {dbnode.name}",
    )
    startup_config = xray.config.include_db_users()
    xray.operations.schedule_node_reconnect(node_id, config=startup_config, delay_seconds=20)
    return {"detail": f"Update requested for node {dbnode.name}"}
