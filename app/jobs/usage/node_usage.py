from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Union

from sqlalchemy import and_, bindparam, insert, select, update
from sqlalchemy.exc import OperationalError, TimeoutError as SQLTimeoutError

from app.db import GetDB, crud
from app.db.models import Node, NodeUsage, System
from app.jobs.usage.collectors import get_outbounds_stats, resolve_stats_api
from app.jobs.usage.delivery_buffer import usage_delivery_buffer
from app.jobs.usage.outbound_traffic import _persist_outbound_traffic
from app.jobs.usage.utils import hour_bucket, is_retryable_db_error, retry_delay, safe_execute, utcnow_naive
from app.models.node import NodeResponse, NodeStatus
from app.runtime import logger, xray
from app.utils import report
from config import DISABLE_RECORDING_NODE_USAGE


"""Node and master usage pipeline: aggregate outbound stats, enforce limits, and persist to DB."""

# region Limit helpers (node and master)


def _update_node_limits(db, dbnode: Node, total_up: int, total_down: int, *, commit: bool = True):
    limited_triggered = False
    limit_cleared = False
    status_change_payload = None

    dbnode.uplink = (dbnode.uplink or 0) + total_up
    dbnode.downlink = (dbnode.downlink or 0) + total_down

    current_usage = (dbnode.uplink or 0) + (dbnode.downlink or 0)
    limit = dbnode.data_limit

    if limit is not None and current_usage >= limit:
        if dbnode.status != NodeStatus.limited:
            previous_status = dbnode.status
            dbnode.status = NodeStatus.limited
            dbnode.message = "Data limit reached"
            dbnode.xray_version = None
            dbnode.last_status_change = utcnow_naive()
            limited_triggered = True
            status_change_payload = (NodeResponse.model_validate(dbnode), previous_status)
    else:
        if dbnode.status == NodeStatus.limited:
            previous_status = dbnode.status
            dbnode.status = NodeStatus.connecting
            dbnode.message = None
            dbnode.xray_version = None
            dbnode.last_status_change = utcnow_naive()
            limit_cleared = True
            status_change_payload = (NodeResponse.model_validate(dbnode), previous_status)

    if commit:
        db.commit()
    return limited_triggered, limit_cleared, status_change_payload


def _update_master_limits(db, total_up: int, total_down: int, *, commit: bool = True):
    limited_triggered = False
    limit_cleared = False
    status_change_payload = None

    master_record = crud._ensure_master_state(db, for_update=True)
    master_record.uplink = (master_record.uplink or 0) + total_up
    master_record.downlink = (master_record.downlink or 0) + total_down

    limit = master_record.data_limit
    current_usage = (master_record.uplink or 0) + (master_record.downlink or 0)

    if limit is not None and current_usage >= limit:
        if master_record.status != NodeStatus.limited:
            master_record.status = NodeStatus.limited
            master_record.message = "Data limit reached"
            master_record.updated_at = utcnow_naive()
    else:
        if master_record.status == NodeStatus.limited:
            master_record.status = NodeStatus.connected
            master_record.message = None
            master_record.updated_at = utcnow_naive()

    if commit:
        db.commit()
    return limited_triggered, limit_cleared, status_change_payload


# endregion


def _is_missing_node_usage_endpoint(exc: Exception) -> bool:
    return getattr(exc, "status_code", None) in (404, 405)


def _collect_node_outbound_stats(node):
    api = resolve_stats_api(node)
    if api is not None:
        return {"stats": get_outbounds_stats(api), "node_batch_id": ""}

    if not hasattr(node, "collect_outbound_stats"):
        return {"stats": get_outbounds_stats(node.api), "node_batch_id": ""}
    try:
        payload = node.collect_outbound_stats()
        return {
            "stats": payload.get("stats") or [],
            "node_batch_id": payload.get("batch_id") or "",
        }
    except Exception as exc:
        if not _is_missing_node_usage_endpoint(exc):
            raise

    return {"stats": get_outbounds_stats(node.api), "node_batch_id": ""}


def _ack_node_outbound_batches(node_batches: dict[int, str]) -> None:
    for node_id, batch_id in node_batches.items():
        if not batch_id:
            continue
        node = xray.nodes.get(node_id)
        if not node:
            continue
        try:
            node.ack_outbound_stats(batch_id)
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning(f"Failed to ack outbound usage batch {batch_id} for node {node_id}: {exc}")


# region Per-node/master snapshots and persistence


def record_node_stats(params: dict, node_id: Union[int, None]):
    if not params:
        return

    total_up = sum(item.get("up", 0) for item in params)
    total_down = sum(item.get("down", 0) for item in params)

    limited_triggered = False
    limit_cleared = False
    status_change_payload = None
    created_at = hour_bucket()

    with GetDB() as db:
        select_stmt = select(NodeUsage.node_id).where(
            and_(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at)
        )
        notfound = db.execute(select_stmt).first() is None
        if notfound:
            stmt = insert(NodeUsage).values(created_at=created_at, node_id=node_id, uplink=0, downlink=0)
            safe_execute(db, stmt)

        stmt = (
            update(NodeUsage)
            .values(uplink=NodeUsage.uplink + bindparam("up"), downlink=NodeUsage.downlink + bindparam("down"))
            .where(and_(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at))
        )
        safe_execute(db, stmt, params)

        if node_id is not None and (total_up or total_down):
            dbnode = db.query(Node).filter(Node.id == node_id).with_for_update().first()
            if dbnode:
                limited_triggered, limit_cleared, status_change_payload = _update_node_limits(
                    db, dbnode, total_up, total_down
                )
        elif node_id is None and (total_up or total_down):
            limited_triggered, limit_cleared, status_change_payload = _update_master_limits(
                db, total_up, total_down
            )

    if status_change_payload:
        node_resp, prev_status = status_change_payload
        report.node_status_change(node_resp, previous_status=prev_status)

    if limited_triggered:
        try:
            xray.operations.remove_node(node_id)
        except Exception:
            pass
    elif limit_cleared:
        xray.operations.connect_node(node_id)


# endregion


def _persist_node_stats_in_session(db, params: list, node_id: Union[int, None], created_at):
    if not params:
        return False, False, None

    total_up = sum(item.get("up", 0) for item in params)
    total_down = sum(item.get("down", 0) for item in params)

    usage_query = db.query(NodeUsage).filter(
        and_(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at)
    )
    usage_row = usage_query.with_for_update().first()
    if usage_row is None:
        usage_row = NodeUsage(created_at=created_at, node_id=node_id, uplink=0, downlink=0)
        db.add(usage_row)
        db.flush()

    usage_row.uplink = int(usage_row.uplink or 0) + total_up
    usage_row.downlink = int(usage_row.downlink or 0) + total_down

    if node_id is not None and (total_up or total_down):
        dbnode = db.query(Node).filter(Node.id == node_id).with_for_update().first()
        if dbnode:
            return _update_node_limits(db, dbnode, total_up, total_down, commit=False)
    elif node_id is None and (total_up or total_down):
        return _update_master_limits(db, total_up, total_down, commit=False)

    return False, False, None


def _persist_node_usage_batch(api_params: dict, total_up: int, total_down: int):
    max_retries = 8
    tries = 0
    while True:
        created_at = hour_bucket()
        status_events = []
        try:
            with GetDB() as db:
                stmt = update(System).values(uplink=System.uplink + total_up, downlink=System.downlink + total_down)
                db.execute(stmt)

                _persist_outbound_traffic(db, api_params)

                if not DISABLE_RECORDING_NODE_USAGE:
                    for node_id, params in api_params.items():
                        limited, cleared, payload = _persist_node_stats_in_session(db, params, node_id, created_at)
                        if limited or cleared or payload:
                            status_events.append((node_id, limited, cleared, payload))

                db.commit()

            return status_events
        except (OperationalError, SQLTimeoutError) as exc:
            tries += 1
            if not is_retryable_db_error(exc) or tries >= max_retries:
                raise
            logger.warning("Retryable database error while recording node usage, retrying (%s/%s)...", tries, max_retries)
            retry_delay(tries)


def _dispatch_node_limit_events(status_events):
    for node_id, limited_triggered, limit_cleared, status_change_payload in status_events:
        if status_change_payload:
            node_resp, prev_status = status_change_payload
            report.node_status_change(node_resp, previous_status=prev_status)

        if limited_triggered:
            try:
                xray.operations.remove_node(node_id)
            except Exception:
                pass
        elif limit_cleared:
            xray.operations.connect_node(node_id)


# region Job entrypoint


def record_node_usages():
    collectors = {}
    try:
        if getattr(xray.core, "available", False) and getattr(xray.core, "started", False):
            collectors[None] = partial(get_outbounds_stats, xray.api)
    except Exception:
        # Skip master core if it's unavailable; still record from nodes
        pass
    for node_id, node in list(xray.nodes.items()):
        if node.connected and node.started:
            collectors[node_id] = partial(_collect_node_outbound_stats, node)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {node_id: executor.submit(collector) for node_id, collector in collectors.items()}
    api_params = {}
    node_batches = {}
    for node_id, future in futures.items():
        try:
            result = future.result()
            node_batch_id = ""
            if isinstance(result, dict):
                node_batch_id = result.get("node_batch_id") or ""
                node_batches[node_id] = node_batch_id
                result = result.get("stats") or []
            if node_batch_id:
                api_params[node_id] = usage_delivery_buffer.replace_outbound_stats(node_id, result, node_batch_id)
            else:
                api_params[node_id] = usage_delivery_buffer.add_outbound_stats(node_id, result)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(f"Failed to get outbound stats from node {node_id}: {exc}")
            api_params[node_id] = usage_delivery_buffer.pending_outbound_stats(node_id)

    total_up = 0
    total_down = 0
    for node_id, params in api_params.items():
        for param in params:
            total_up += param["up"]
            total_down += param["down"]

    if not (total_up or total_down):
        usage_delivery_buffer.ack_outbound_stats_for(api_params.keys(), node_batches)
        _ack_node_outbound_batches(node_batches)
        return

    status_events = _persist_node_usage_batch(api_params, total_up, total_down)
    usage_delivery_buffer.ack_outbound_stats_for(api_params.keys(), node_batches)
    _ack_node_outbound_batches(node_batches)
    _dispatch_node_limit_events(status_events)


# endregion
