from concurrent.futures import ThreadPoolExecutor
from typing import Union

from sqlalchemy import and_, bindparam, insert, select, update

from app.db import GetDB, crud
from app.db.models import Node, NodeUsage, System
from app.jobs.usage.collectors import get_outbounds_stats
from app.jobs.usage.utils import hour_bucket, safe_execute, utcnow_naive
from app.models.node import NodeResponse, NodeStatus
from app.runtime import xray
from app.utils import report
from config import DISABLE_RECORDING_NODE_USAGE


"""Node and master usage pipeline: aggregate outbound stats, cache snapshots, enforce limits, and persist to DB."""

# region Limit helpers (node and master)


def _update_node_limits(db, dbnode: Node, total_up: int, total_down: int):
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

    db.commit()
    return limited_triggered, limit_cleared, status_change_payload


def _update_master_limits(db, total_up: int, total_down: int):
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

    db.commit()
    return limited_triggered, limit_cleared, status_change_payload


# endregion


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

    from app.redis.client import get_redis
    from app.redis.pending_backup import save_usage_snapshots_backup
    from config import REDIS_ENABLED

    redis_client = get_redis() if REDIS_ENABLED else None
    if redis_client:
        from app.redis.cache import cache_node_usage_snapshot

        cache_node_usage_snapshot(node_id, created_at, total_up, total_down)
        save_usage_snapshots_backup(
            [],
            [{"node_id": node_id, "created_at": created_at.isoformat(), "uplink": total_up, "downlink": total_down}],
        )

        if node_id is not None and (total_up or total_down):
            with GetDB() as db:
                dbnode = db.query(Node).filter(Node.id == node_id).with_for_update().first()
                if dbnode:
                    limited_triggered, limit_cleared, status_change_payload = _update_node_limits(
                        db, dbnode, total_up, total_down
                    )
        elif node_id is None and (total_up or total_down):
            with GetDB() as db:
                limited_triggered, limit_cleared, status_change_payload = _update_master_limits(
                    db, total_up, total_down
                )
    else:
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


# region Job entrypoint


def record_node_usages():
    api_instances = {}
    try:
        if getattr(xray.core, "available", False) and getattr(xray.core, "started", False):
            api_instances[None] = xray.api
    except Exception:
        # Skip master core if it's unavailable; still record from nodes
        pass
    for node_id, node in list(xray.nodes.items()):
        if node.connected and node.started:
            api_instances[node_id] = node.api

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {node_id: executor.submit(get_outbounds_stats, api) for node_id, api in api_instances.items()}
    api_params = {node_id: future.result() for node_id, future in futures.items()}

    total_up = 0
    total_down = 0
    for node_id, params in api_params.items():
        for param in params:
            total_up += param["up"]
            total_down += param["down"]

    if not (total_up or total_down):
        return

    with GetDB() as db:
        stmt = update(System).values(uplink=System.uplink + total_up, downlink=System.downlink + total_down)
        safe_execute(db, stmt)

    if DISABLE_RECORDING_NODE_USAGE:
        return

    for node_id, params in api_params.items():
        record_node_stats(params, node_id)


# endregion
