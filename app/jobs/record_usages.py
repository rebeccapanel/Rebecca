from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, UTC
from operator import attrgetter
from typing import Dict, Optional, Tuple, Union

from pymysql.err import OperationalError
from sqlalchemy import and_, bindparam, func, insert, select, update
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import Insert

from app.runtime import logger, scheduler, xray
from app.utils import report
from app.db import GetDB
from app.db.models import (
    Admin,
    AdminServiceLink,
    Node,
    NodeUsage,
    NodeUserUsage,
    Service,
    System,
    User,
)
from app.models.admin import Admin as AdminSchema, AdminStatus
from app.models.node import NodeStatus, NodeResponse
from config import (
    DISABLE_RECORDING_NODE_USAGE,
    JOB_RECORD_NODE_USAGES_INTERVAL,
    JOB_RECORD_USER_USAGES_INTERVAL,
)
from xray_api import XRay as XRayAPI
from xray_api import exc as xray_exc
from app.db import crud


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def safe_execute(db: Session, stmt, params=None):
    if db.bind.name == 'mysql':
        if isinstance(stmt, Insert):
            stmt = stmt.prefix_with('IGNORE')

        tries = 0
        done = False
        while not done:
            try:
                db.connection().execute(stmt, params)
                db.commit()
                done = True
            except OperationalError as err:
                if err.args[0] == 1213 and tries < 3:  # Deadlock
                    db.rollback()
                    tries += 1
                    continue
                raise err

    else:
        db.connection().execute(stmt, params)
        db.commit()


def record_user_stats(params: list, node_id: Union[int, None],
                      consumption_factor: int = 1):
    if not params:
        return

    created_at = datetime.fromisoformat(utcnow_naive().strftime('%Y-%m-%dT%H:00:00'))

    # Try to write to Redis first (only if Redis is enabled)
    from app.redis.cache import cache_user_usage_snapshot
    from app.redis.client import get_redis
    from app.redis.pending_backup import save_usage_snapshots_backup
    from config import REDIS_ENABLED
    
    redis_client = get_redis() if REDIS_ENABLED else None
    if redis_client:
        # Prepare snapshots for backup
        user_snapshots = []
        for p in params:
            uid = int(p['uid'])
            # Ensure value is a valid integer
            raw_value = p.get('value', 0)
            try:
                value = int(float(raw_value)) * consumption_factor
            except (ValueError, TypeError):
                logger.warning(f"Invalid usage value for user {uid}: {raw_value}")
                continue
            cache_user_usage_snapshot(uid, node_id, created_at, value)
            user_snapshots.append({
                'user_id': uid,
                'node_id': node_id,
                'created_at': created_at.isoformat(),
                'used_traffic': value
            })
        
        # Save backup to disk
        save_usage_snapshots_backup(user_snapshots, [])
    else:
        # Fallback to direct DB write if Redis is not available
        with GetDB() as db:
            # make user usage row if doesn't exist
            select_stmt = select(NodeUserUsage.user_id) \
                .where(and_(NodeUserUsage.node_id == node_id, NodeUserUsage.created_at == created_at))
            existings = [r[0] for r in db.execute(select_stmt).fetchall()]
            uids_to_insert = set()

            for p in params:
                uid = int(p['uid'])
                if uid in existings:
                    continue
                uids_to_insert.add(uid)

            if uids_to_insert:
                stmt = insert(NodeUserUsage).values(
                    user_id=bindparam('uid'),
                    created_at=created_at,
                    node_id=node_id,
                    used_traffic=0
                )
                safe_execute(db, stmt, [{'uid': uid} for uid in uids_to_insert])

            # record
            stmt = update(NodeUserUsage) \
                .values(used_traffic=NodeUserUsage.used_traffic + bindparam('value') * consumption_factor) \
                .where(and_(NodeUserUsage.user_id == bindparam('uid'),
                            NodeUserUsage.node_id == node_id,
                            NodeUserUsage.created_at == created_at))
            safe_execute(db, stmt, params)


def record_node_stats(params: dict, node_id: Union[int, None]):
    if not params:
        return

    total_up = sum(p.get("up", 0) for p in params)
    total_down = sum(p.get("down", 0) for p in params)
    limited_triggered = False
    limit_cleared = False

    created_at = datetime.fromisoformat(utcnow_naive().strftime('%Y-%m-%dT%H:00:00'))

    status_change_payload = None

    # Try to write to Redis first (only if Redis is enabled)
    from app.redis.cache import cache_node_usage_snapshot
    from app.redis.client import get_redis
    from app.redis.pending_backup import save_usage_snapshots_backup
    from config import REDIS_ENABLED
    
    redis_client = get_redis() if REDIS_ENABLED else None
    if redis_client:
        # Write to Redis
        cache_node_usage_snapshot(node_id, created_at, total_up, total_down)
        
        # Save backup to disk
        node_snapshots = [{
            'node_id': node_id,
            'created_at': created_at.isoformat(),
            'uplink': total_up,
            'downlink': total_down
        }]
        save_usage_snapshots_backup([], node_snapshots)
        
        # Still need to update node status in DB (this is critical for node management)
        if node_id is not None and (total_up or total_down):
            with GetDB() as db:
                dbnode = db.query(Node).filter(Node.id == node_id).with_for_update().first()
                if dbnode:
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
        elif node_id is None and (total_up or total_down):
            with GetDB() as db:
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
    else:
        # Fallback to direct DB write if Redis is not available
        with GetDB() as db:
            # make node usage row if doesn't exist
            select_stmt = select(NodeUsage.node_id). \
                where(and_(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at))
            notfound = db.execute(select_stmt).first() is None
            if notfound:
                stmt = insert(NodeUsage).values(created_at=created_at, node_id=node_id, uplink=0, downlink=0)
                safe_execute(db, stmt)

            # record
            stmt = update(NodeUsage). \
                values(uplink=NodeUsage.uplink + bindparam('up'), downlink=NodeUsage.downlink + bindparam('down')). \
                where(and_(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at))

            safe_execute(db, stmt, params)

            if node_id is not None and (total_up or total_down):
                dbnode = db.query(Node).filter(Node.id == node_id).with_for_update().first()
                if dbnode:
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
            elif node_id is None and (total_up or total_down):
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


def get_users_stats(api: XRayAPI):
    try:
        params = defaultdict(int)
        for stat in filter(attrgetter('value'), api.get_users_stats(reset=True, timeout=600)):
            params[stat.name.split('.', 1)[0]] += stat.value
        params = list({"uid": uid, "value": value} for uid, value in params.items())
        return params
    except xray_exc.XrayError:
        return []


def get_outbounds_stats(api: XRayAPI):
    try:
        params = [{"up": stat.value, "down": 0} if stat.link == "uplink" else {"up": 0, "down": stat.value}
                  for stat in filter(attrgetter('value'), api.get_outbounds_stats(reset=True, timeout=200))]
        return params
    except xray_exc.XrayError:
        return []


def record_user_usages():
    api_instances = {None: xray.api}
    usage_coefficient = {None: 1}  # default usage coefficient for the main api instance

    for node_id, node in list(xray.nodes.items()):
        if node.connected and node.started:
            api_instances[node_id] = node.api
            usage_coefficient[node_id] = node.usage_coefficient  # fetch the usage coefficient

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {node_id: executor.submit(get_users_stats, api) for node_id, api in api_instances.items()}
    # Add timeout to prevent hanging
    api_params = {}
    for node_id, future in futures.items():
        try:
            api_params[node_id] = future.result(timeout=30)  # 30 second timeout per node
        except Exception as e:
            logger.warning(f"Failed to get stats from node {node_id}: {e}")
            api_params[node_id] = []

    users_usage = defaultdict(int)
    for node_id, params in api_params.items():
        coefficient = usage_coefficient.get(node_id, 1)  # get the usage coefficient for the node
        for param in params:
            users_usage[param['uid']] += int(param['value'] * coefficient)  # apply the usage coefficient
    users_usage = [
        {"uid": uid, "value": value} for uid, value in users_usage.items()
    ]
    if not users_usage:
        return

    user_ids = [int(entry["uid"]) for entry in users_usage]

    with GetDB() as db:
        mapping_rows = (
            db.query(User.id, User.admin_id, User.service_id)
            .filter(User.id.in_(user_ids))
            .all()
        )

    user_to_admin_service: Dict[int, Tuple[Optional[int], Optional[int]]] = {
        row[0]: (row[1], row[2]) for row in mapping_rows
    }

    admin_usage = defaultdict(int)
    service_usage = defaultdict(int)
    admin_service_usage = defaultdict(int)
    for user_usage in users_usage:
        admin_id, service_id = user_to_admin_service.get(
            int(user_usage["uid"]), (None, None)
        )
        value = user_usage["value"]
        if admin_id:
            admin_usage[admin_id] += value
        if service_id:
            service_usage[service_id] += value
            if admin_id:
                admin_service_usage[(admin_id, service_id)] += value

    # record users usage
    admin_limit_events = []
    
    from app.redis.cache import cache_user_usage_update, warmup_user_usages
    from app.redis.client import get_redis
    from app.redis.pending_backup import save_user_usage_backup, save_admin_usage_backup, save_service_usage_backup
    
    redis_client = get_redis()
    if redis_client:
        online_at = utcnow_naive()
        
        # Prepare user usage updates for backup
        user_usage_backup = []
        for usage in users_usage:
            user_id = int(usage['uid'])
            # Ensure value is a valid integer
            raw_value = usage.get('value', 0)
            try:
                value = int(float(raw_value))
            except (ValueError, TypeError):
                logger.warning(f"Invalid usage value for user {user_id}: {raw_value}")
                continue
            cache_user_usage_update(user_id, value, online_at)
            user_usage_backup.append({
                'user_id': user_id,
                'used_traffic_delta': value,
                'online_at': online_at.isoformat()
            })
            
            # Warmup usage cache for this user when they become online (in background to avoid blocking)
            # Don't block the main job - warmup can happen asynchronously
            # warmup_user_usages(user_id)  # Disabled to prevent job hanging
        
        # Save backup to disk
        save_user_usage_backup(user_usage_backup)
        save_admin_usage_backup(admin_usage)
        save_service_usage_backup(service_usage)
        
    else:
        with GetDB() as db:
            stmt = update(User). \
                where(User.id == bindparam('uid')). \
                values(
                    used_traffic=User.used_traffic + bindparam('value'),
                    online_at=utcnow_naive()
            )

            safe_execute(db, stmt, users_usage)
            
            admin_data = [{"admin_id": admin_id, "value": value} for admin_id, value in admin_usage.items()]
        if admin_data:
            increments = {entry["admin_id"]: entry["value"] for entry in admin_data}
            admin_rows = (
                db.query(Admin)
                .filter(Admin.id.in_(increments.keys()))
                .all()
            )
            for admin_row in admin_rows:
                limit = admin_row.data_limit
                if limit:
                    previous_usage = admin_row.users_usage or 0
                    new_usage = previous_usage + increments.get(admin_row.id, 0)
                    if previous_usage < limit <= new_usage:
                        admin_limit_events.append(
                            {
                                "admin_id": admin_row.id,
                                "admin": AdminSchema.model_validate(admin_row),
                                "limit": limit,
                                "current": new_usage,
                            }
                        )

            admin_update_stmt = (
                update(Admin)
                .where(Admin.id == bindparam("b_admin_id"))
                .values(
                    users_usage=Admin.users_usage + bindparam("value"),
                    lifetime_usage=Admin.lifetime_usage + bindparam("value"),
                )
            )
            safe_execute(
                db,
                admin_update_stmt,
                [
                    {"b_admin_id": entry["admin_id"], "value": entry["value"]}
                    for entry in admin_data
                ],
            )

        if service_usage:
            service_update_stmt = (
                update(Service)
                .where(Service.id == bindparam("b_service_id"))
                .values(
                    used_traffic=Service.used_traffic + bindparam("value"),
                    lifetime_used_traffic=Service.lifetime_used_traffic + bindparam("value"),
                    updated_at=func.now(),
                )
            )
            service_params = [
                {"b_service_id": sid, "value": value}
                for sid, value in service_usage.items()
            ]
            safe_execute(db, service_update_stmt, service_params)

        if admin_service_usage:
            admin_service_update_stmt = (
                update(AdminServiceLink)
                .where(
                    and_(
                        AdminServiceLink.admin_id == bindparam("b_admin_id"),
                        AdminServiceLink.service_id == bindparam("b_service_id"),
                    )
                )
                .values(
                    used_traffic=AdminServiceLink.used_traffic + bindparam("value"),
                    lifetime_used_traffic=AdminServiceLink.lifetime_used_traffic + bindparam("value"),
                    updated_at=func.now(),
                )
            )
            admin_service_params = [
                {
                    "b_admin_id": admin_id,
                    "b_service_id": service_id,
                    "value": value,
                }
                for (admin_id, service_id), value in admin_service_usage.items()
            ]
            safe_execute(db, admin_service_update_stmt, admin_service_params)

        admin_ids_to_disable = {
            event["admin_id"]
            for event in admin_limit_events
            if event.get("admin_id") is not None
        }
        for admin_id in admin_ids_to_disable:
            dbadmin = db.query(Admin).filter(Admin.id == admin_id).first()
            if not dbadmin:
                continue
            crud.enforce_admin_data_limit(db, dbadmin)

    for event in admin_limit_events:
        report.admin_data_limit_reached(event["admin"], event["limit"], event["current"])

    if DISABLE_RECORDING_NODE_USAGE:
        return

    for node_id, params in api_params.items():
        record_user_stats(params, node_id, usage_coefficient[node_id])


def record_node_usages():
    api_instances = {None: xray.api}
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
            total_up += param['up']
            total_down += param['down']
    if not (total_up or total_down):
        return

    # record nodes usage
    with GetDB() as db:
        stmt = update(System).values(
            uplink=System.uplink + total_up,
            downlink=System.downlink + total_down
        )
        safe_execute(db, stmt)

    if DISABLE_RECORDING_NODE_USAGE:
        return

    for node_id, params in api_params.items():
        record_node_stats(params, node_id)


scheduler.add_job(record_user_usages, 'interval',
                  seconds=JOB_RECORD_USER_USAGES_INTERVAL,
                  coalesce=True, max_instances=1)
scheduler.add_job(record_node_usages, 'interval',
                  seconds=JOB_RECORD_NODE_USAGES_INTERVAL,
                  coalesce=True, max_instances=1)




