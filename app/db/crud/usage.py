"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Union, Literal

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Query, Session
from app.db.models import (
    Admin,
    AdminUsageLogs,
    MasterNodeState,
    Node,
    NodeUsage,
    NodeUserUsage,
    Service,
    User,
    UserUsageResetLogs,
)
from app.models.node import NodeStatus, NodeUsageResponse
from app.models.user import (
    UserStatus,
    UserUsageResponse,
)

# MasterSettingsService not available in current project structure
from .common import MASTER_NODE_NAME
from .node import _ensure_master_state
from .user import _status_to_str, _ensure_active_user_capacity, get_user_queryset
from .admin import _maybe_enable_admin_after_data_limit

# ============================================================================


def _get_usage_data(
    db: Session,
    entity_type: Literal["user", "admin", "node", "service", "all_nodes"],
    entity_id: Optional[int] = None,
    admin: Optional[Admin] = None,
    service: Optional[Service] = None,
    start: datetime = None,
    end: datetime = None,
    granularity: str = "day",
    group_by: Literal["node", "day", "admin", None] = None,
    format: Literal["timeseries", "aggregated", "by_nodes", "by_day"] = "aggregated",
    include_node_breakdown: bool = False,
) -> Union[List[Dict], List[UserUsageResponse], List[NodeUsageResponse]]:
    """Unified function for retrieving usage data across different entities."""
    if not start or not end:
        return []

    start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    target_tz = start_aware.tzinfo or timezone.utc

    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        granularity_value = "day"

    # Build base query filter
    user_ids = None
    node_filter = None
    service_filter = None
    admin_filter = None

    if entity_type == "user" and entity_id:
        user_ids = [entity_id]
    elif entity_type == "admin":
        if admin:
            entity_id = admin.id
        if entity_id:
            admin_filter = and_(User.admin_id == entity_id, User.status != UserStatus.deleted)
    elif entity_type == "service":
        if service:
            entity_id = service.id
        if entity_id:
            service_filter = and_(User.service_id == entity_id, User.status != UserStatus.deleted)
    elif entity_type == "node":
        if entity_id is not None:
            node_filter = (NodeUserUsage.node_id == entity_id) if entity_id != 0 else NodeUserUsage.node_id.is_(None)
    elif entity_type == "all_nodes":
        pass  # No specific filter

    # Try to get from Redis cache first
    from app.redis.cache import get_user_usages_from_cache
    from app.redis.client import get_redis
    from config import REDIS_ENABLED

    redis_client = get_redis() if REDIS_ENABLED else None
    use_redis_cache = redis_client is not None

    # Build query
    query = db.query(NodeUserUsage)
    if user_ids is not None:
        if not user_ids:
            return []
        query = query.filter(NodeUserUsage.user_id.in_(user_ids))
    if service_filter is not None:
        query = query.join(User, User.id == NodeUserUsage.user_id).filter(service_filter)
    if admin_filter is not None:
        query = query.join(User, User.id == NodeUserUsage.user_id).filter(admin_filter)
    if node_filter is not None:
        query = query.filter(node_filter)

    query = query.filter(NodeUserUsage.created_at >= start_aware, NodeUserUsage.created_at <= end_aware)

    # If using Redis and querying for specific users, try cache first
    if use_redis_cache and user_ids and len(user_ids) == 1 and entity_type == "user":
        # Try to get from cache for single user queries
        cached_usages = get_user_usages_from_cache(user_ids, None, start_aware, end_aware)
        if cached_usages:
            # Convert cached data to NodeUserUsage-like objects for processing
            # This is a simplified approach - full implementation would need to convert properly
            pass  # For now, fall through to DB query

    # Get node lookup
    _ensure_master_state(db, for_update=False)
    node_lookup: Dict[Optional[int], str] = {None: MASTER_NODE_NAME}
    for node_id, node_name in db.query(Node.id, Node.name).all():
        node_lookup[node_id] = node_name

    # Handle different formats
    if format == "timeseries":
        return _get_usage_timeseries(
            db,
            query,
            start_aware,
            end_aware,
            target_tz,
            granularity_value,
            node_lookup,
            include_node_breakdown,
        )
    elif format == "by_nodes":
        return _get_usage_by_nodes(query, node_lookup)
    elif format == "by_day":
        return _get_usage_by_day(query, start_aware, end_aware, granularity_value)
    else:  # aggregated
        return _get_usage_aggregated(query, node_lookup, entity_type == "all_nodes")


def _get_dialect_name(db: Optional[Session]) -> str:
    if db is None:
        return ""
    bind = db.get_bind()
    if not bind or not getattr(bind, "dialect", None):
        return ""
    return bind.dialect.name or ""


def _bucket_expr(db: Session, column, granularity: str):
    dialect = _get_dialect_name(db)
    if granularity == "hour":
        if dialect == "sqlite":
            return func.strftime("%Y-%m-%d %H:00", column)
        if dialect in {"mysql", "mariadb"}:
            return func.date_format(column, "%Y-%m-%d %H:00")
        if dialect == "postgresql":
            return func.date_trunc("hour", column)
        return func.date_trunc("hour", column)
    # day
    if dialect == "sqlite":
        return func.strftime("%Y-%m-%d", column)
    if dialect in {"mysql", "mariadb"}:
        return func.date_format(column, "%Y-%m-%d")
    if dialect == "postgresql":
        return func.date_trunc("day", column)
    return func.date_trunc("day", column)


def _bucket_label_expr(db: Session, column, granularity: str):
    dialect = _get_dialect_name(db)
    if granularity == "hour":
        if dialect == "postgresql":
            return func.to_char(func.date_trunc("hour", column), "YYYY-MM-DD HH24:00")
        if dialect in {"mysql", "mariadb"}:
            return func.date_format(column, "%Y-%m-%d %H:00")
        return func.strftime("%Y-%m-%d %H:00", column)
    if dialect == "postgresql":
        return func.to_char(func.date_trunc("day", column), "YYYY-MM-DD")
    if dialect in {"mysql", "mariadb"}:
        return func.date_format(column, "%Y-%m-%d")
    return func.strftime("%Y-%m-%d", column)


def _normalize_bucket_value(value, granularity: str, tz: timezone) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        bucket = value
    elif isinstance(value, str):
        text = value.strip()
        if granularity == "hour":
            if len(text) == 16:  # "YYYY-MM-DD HH:00"
                text = f"{text}:00"
            bucket = datetime.fromisoformat(text)
        else:
            bucket = datetime.fromisoformat(text)
    else:
        return None

    if bucket.tzinfo is None:
        bucket = bucket.replace(tzinfo=tz)
    else:
        bucket = bucket.astimezone(tz)

    if granularity == "hour":
        return bucket.replace(minute=0, second=0, microsecond=0)
    return bucket.replace(hour=0, minute=0, second=0, microsecond=0)


def _get_usage_timeseries(
    db: Session,
    query: Query,
    start: datetime,
    end: datetime,
    tz: timezone,
    granularity: str,
    node_lookup: Dict[Optional[int], str],
    include_node_breakdown: bool,
) -> List[Dict]:
    """Helper for timeseries format"""
    if granularity == "hour":
        current = start.replace(minute=0, second=0, microsecond=0)
        end_aligned = end.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
    else:
        current = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end_aligned = end.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)

    if current > end_aligned:
        return []

    usage_map: Dict[datetime, Dict] = {}
    cursor = current
    while cursor <= end_aligned:
        usage_map[cursor] = {"total": 0, "nodes": defaultdict(int)} if include_node_breakdown else {"total": 0}
        cursor += step

    bucket_expr = _bucket_expr(db, NodeUserUsage.created_at, granularity).label("bucket")
    rows = (
        query.with_entities(
            bucket_expr,
            NodeUserUsage.node_id,
            func.coalesce(func.sum(NodeUserUsage.used_traffic), 0).label("used_traffic"),
        )
        .group_by(bucket_expr, NodeUserUsage.node_id)
        .all()
    )

    for bucket_value, node_id, used_traffic in rows:
        bucket = _normalize_bucket_value(bucket_value, granularity, tz)
        if bucket is None:
            continue
        if bucket not in usage_map:
            usage_map[bucket] = {"total": 0, "nodes": defaultdict(int)} if include_node_breakdown else {"total": 0}
        usage_map[bucket]["total"] += int(used_traffic or 0)
        if include_node_breakdown:
            usage_map[bucket]["nodes"][node_id] += int(used_traffic or 0)

    result = []
    for bucket in sorted(usage_map.keys()):
        entry = {"timestamp": bucket, "used_traffic": usage_map[bucket]["total"]}
        if include_node_breakdown:
            node_entries = []
            for nid, usage in usage_map[bucket]["nodes"].items():
                if usage:
                    node_entries.append(
                        {
                            "node_id": nid if nid is not None else 0,
                            "node_name": node_lookup.get(nid, MASTER_NODE_NAME),
                            "used_traffic": int(usage),
                        }
                    )
            entry["nodes"] = node_entries
        result.append(entry)

    return result


def _get_usage_by_nodes(query: Query, node_lookup: Dict[Optional[int], str]) -> List[Dict]:
    """Helper for by_nodes format"""
    node_usage: Dict[Optional[int], int] = defaultdict(int)

    rows = (
        query.with_entities(NodeUserUsage.node_id, func.coalesce(func.sum(NodeUserUsage.used_traffic), 0))
        .group_by(NodeUserUsage.node_id)
        .all()
    )

    for node_id, traffic in rows:
        node_usage[node_id] += int(traffic or 0)

    result = []
    for node_id in sorted(node_usage.keys(), key=lambda x: (x is None, x or -1)):
        result.append(
            {
                "node_id": node_id,
                "node_name": node_lookup.get(node_id, MASTER_NODE_NAME),
                "used_traffic": node_usage[node_id],
            }
        )

    return result


def _get_usage_by_day(query: Query, start: datetime, end: datetime, granularity: str) -> List[Dict]:
    """Helper for by_day format"""
    if granularity == "hour":
        fmt = "%Y-%m-%d %H:00"
    else:
        fmt = "%Y-%m-%d"

    bucket_expr = _bucket_label_expr(query.session, NodeUserUsage.created_at, granularity).label("bucket")
    rows = (
        query.with_entities(bucket_expr, func.coalesce(func.sum(NodeUserUsage.used_traffic), 0).label("used_traffic"))
        .group_by(bucket_expr)
        .all()
    )

    results = []
    for bucket_label, used_traffic in rows:
        if used_traffic:
            if isinstance(bucket_label, datetime):
                label = bucket_label.strftime(fmt)
            else:
                label = str(bucket_label)
            results.append({"date": label, "used_traffic": int(used_traffic or 0)})

    return sorted(results, key=lambda item: item["date"])


def _get_usage_aggregated(
    query: Query, node_lookup: Dict[Optional[int], str], is_node_usage: bool = False
) -> Union[List[UserUsageResponse], List[NodeUsageResponse]]:
    """Helper for aggregated format"""
    if is_node_usage:
        # For NodeUsage (not NodeUserUsage)
        usages: Dict[Optional[int], NodeUsageResponse] = {
            None: NodeUsageResponse(node_id=None, node_name=MASTER_NODE_NAME, uplink=0, downlink=0)
        }
        # This would need NodeUsage table, handled separately
        return list(usages.values())
    else:
        usages: Dict[Optional[int], UserUsageResponse] = {
            None: UserUsageResponse(node_id=None, node_name=MASTER_NODE_NAME, used_traffic=0)
        }
        for node_id in node_lookup.keys():
            if node_id is not None:
                usages[node_id] = UserUsageResponse(node_id=node_id, node_name=node_lookup[node_id], used_traffic=0)

        rows = (
            query.with_entities(
                NodeUserUsage.node_id,
                func.coalesce(func.sum(NodeUserUsage.used_traffic), 0).label("used_traffic"),
            )
            .group_by(NodeUserUsage.node_id)
            .all()
        )
        for node_id, used_traffic in rows:
            node_key = node_id if node_id is not None else None
            if node_key in usages:
                usages[node_key].used_traffic += int(used_traffic or 0)

        return list(usages.values())


def get_user_usage_timeseries(
    db: Session,
    dbuser: User,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int, List[Dict[str, Union[int, str, int]]]]]]:
    """Return usage timeline buckets for a user with optional per-node breakdown."""
    result = _get_usage_data(
        db=db,
        entity_type="user",
        entity_id=dbuser.id,
        start=start,
        end=end,
        granularity=granularity,
        format="timeseries",
        include_node_breakdown=True,
    )
    # Convert to expected format with 'total' field
    master = _ensure_master_state(db, for_update=False)
    node_lookup: Dict[Optional[int], str] = {None: MASTER_NODE_NAME}
    for node_id, node_name in db.query(Node.id, Node.name).all():
        node_lookup[node_id] = node_name

    timeline = []
    for entry in result:
        node_entries = []
        for node_info in entry.get("nodes", []):
            nid = node_info["node_id"]
            resolved_id = 0 if nid == master.id else nid
            node_entries.append(
                {
                    "node_id": resolved_id,
                    "node_name": node_lookup.get(nid) or node_lookup.get(None, "Master"),
                    "used_traffic": node_info["used_traffic"],
                }
            )
        timeline.append({"timestamp": entry["timestamp"], "total": entry["used_traffic"], "nodes": node_entries})
    return timeline


def get_user_usage_by_nodes(
    db: Session,
    dbuser: User,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Union[Optional[int], str, int]]]:
    """Aggregate total usage per node (downlink) for a user within a date range."""
    result = _get_usage_data(db=db, entity_type="user", entity_id=dbuser.id, start=start, end=end, format="by_nodes")
    # Convert to expected format with uplink/downlink
    node_lookup: Dict[Optional[int], Dict] = {}
    for node in db.query(Node).all():
        node_lookup[node.id] = {"node_id": node.id, "node_name": node.name, "uplink": 0, "downlink": 0}
    node_lookup[None] = {"node_id": None, "node_name": MASTER_NODE_NAME, "uplink": 0, "downlink": 0}

    for entry in result:
        nid = entry["node_id"]
        if nid not in node_lookup:
            node_lookup[nid] = {
                "node_id": nid,
                "node_name": MASTER_NODE_NAME if nid is None else f"Node {nid}",
                "uplink": 0,
                "downlink": 0,
            }
        node_lookup[nid]["downlink"] += entry["used_traffic"]

    return sorted(node_lookup.values(), key=lambda e: (e["node_id"] is not None, e["node_id"] or -1))


def get_user_usages(db: Session, dbuser: User, start: datetime, end: datetime) -> List[UserUsageResponse]:
    """
    Retrieves user usages within a specified date range.

    Args:
        db (Session): Database session.
        dbuser (User): The user object.
        start (datetime): Start date for usage retrieval.
        end (datetime): End date for usage retrieval.

    Returns:
        List[UserUsageResponse]: List of user usage responses.
    """
    return _get_usage_data(db=db, entity_type="user", entity_id=dbuser.id, start=start, end=end, format="aggregated")


def reset_user_data_usage(db: Session, dbuser: User) -> User:
    """
    Resets the data usage of a user and logs the reset.

    Args:
        db (Session): Database session.
        dbuser (User): The user object whose data usage is to be reset.

    Returns:
        User: The updated user object.
    """
    # Ensure user is in session - merge if detached or transient
    from sqlalchemy.inspection import inspect

    user_state = inspect(dbuser)
    if user_state.detached or user_state.transient:
        dbuser = db.merge(dbuser)
        user_state = inspect(dbuser)

    # Refresh user state to ensure we have latest data
    if user_state.persistent:
        db.refresh(dbuser, ["used_traffic", "status", "node_usages"])

    usage_log = UserUsageResetLogs(
        user=dbuser,
        used_traffic_at_reset=dbuser.used_traffic,
    )
    db.add(usage_log)

    dbuser.used_traffic = 0
    dbuser.node_usages.clear()
    current_status_value = _status_to_str(dbuser.status)
    should_activate = current_status_value not in (
        UserStatus.expired.value,
        UserStatus.disabled.value,
    )
    if should_activate:
        if current_status_value != UserStatus.active.value:
            _ensure_active_user_capacity(
                db,
                dbuser.admin,
                exclude_user_ids=(dbuser.id,),
            )
        dbuser.status = UserStatus.active.value

    if dbuser.next_plan:
        db.delete(dbuser.next_plan)
        dbuser.next_plan = None

    db.commit()
    db.refresh(dbuser)

    # Update user in Redis cache and mark for sync
    try:
        from app.redis.cache import cache_user
        import logging

        logger = logging.getLogger(__name__)
        cache_user(dbuser, mark_for_sync=True)
    except Exception as e:
        import logging

        logger = logging.getLogger(__name__)
        logger.warning(f"Failed to update user in Redis cache: {e}")

    return dbuser


def reset_all_users_data_usage(db: Session, admin: Optional[Admin] = None):
    """
    Resets the data usage for all users or users under a specific admin.

    Args:
        db (Session): Database session.
        admin (Optional[Admin]): Admin to filter users by, if any.
    """
    query = get_user_queryset(db)

    if admin:
        query = query.filter(User.admin == admin)

    for dbuser in query.all():
        dbuser.used_traffic = 0
        current_status_value = _status_to_str(dbuser.status)
        should_activate = current_status_value not in (
            UserStatus.on_hold.value,
            UserStatus.expired.value,
            UserStatus.disabled.value,
        )
        if should_activate:
            if current_status_value != UserStatus.active.value:
                _ensure_active_user_capacity(
                    db,
                    dbuser.admin,
                    exclude_user_ids=(dbuser.id,),
                )
            dbuser.status = UserStatus.active
        dbuser.usage_logs.clear()
        dbuser.node_usages.clear()
        if dbuser.next_plan:
            db.delete(dbuser.next_plan)
            dbuser.next_plan = None
        db.add(dbuser)

    db.commit()


def get_all_users_usages(db: Session, admin: Admin, start: datetime, end: datetime) -> List[UserUsageResponse]:
    """
    Retrieves usage data for all users associated with an admin within a specified time range.

    This function calculates the total traffic used by users across different nodes,
    including a "Master" node that represents the main core.

    Args:
        db (Session): Database session for querying.
        admin (Admin): The admin user for which to retrieve user usage data.
        start (datetime): The start date and time of the period to consider.
        end (datetime): The end date and time of the period to consider.

    Returns:
        List[UserUsageResponse]: A list of UserUsageResponse objects, each representing
        the usage data for a specific node or the main core.
    """
    return _get_usage_data(db=db, entity_type="admin", admin=admin, start=start, end=end, format="aggregated")


def reset_admin_usage(db: Session, dbadmin: Admin) -> int:
    """
    Retrieves an admin's usage by their username.
    Args:
        db (Session): Database session.
        dbadmin (Admin): The admin object to be updated.
    Returns:
        Admin: The updated admin.
    """
    if dbadmin.users_usage == 0:
        return dbadmin

    usage_log = AdminUsageLogs(admin=dbadmin, used_traffic_at_reset=dbadmin.users_usage)
    db.add(usage_log)
    dbadmin.users_usage = 0
    _maybe_enable_admin_after_data_limit(db, dbadmin)

    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def reset_master_usage(db: Session) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=True)

    db.query(NodeUsage).filter(or_(NodeUsage.node_id.is_(None), NodeUsage.node_id == master_state.id)).delete(
        synchronize_session=False
    )
    db.query(NodeUserUsage).filter(
        or_(NodeUserUsage.node_id.is_(None), NodeUserUsage.node_id == master_state.id)
    ).delete(synchronize_session=False)

    master_state.uplink = 0
    master_state.downlink = 0
    master_state.status = NodeStatus.connected
    master_state.message = None
    master_state.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(master_state)
    return master_state


def get_nodes_usage(db: Session, start: datetime, end: datetime) -> List[NodeUsageResponse]:
    """
    Retrieves usage data for all nodes within a specified time range.

    Args:
        db (Session): The database session.
        start (datetime): The start time of the usage period.
        end (datetime): The end time of the usage period.

    Returns:
        List[NodeUsageResponse]: A list of NodeUsageResponse objects containing usage data.
    """
    _ensure_master_state(db, for_update=False)

    usages: Dict[Optional[int], NodeUsageResponse] = {
        None: NodeUsageResponse(
            node_id=None,
            node_name=MASTER_NODE_NAME,
            uplink=0,
            downlink=0,
        )
    }

    for node in db.query(Node).all():
        usages[node.id] = NodeUsageResponse(
            node_id=node.id,
            node_name=node.name,
            uplink=0,
            downlink=0,
        )

    cond = and_(NodeUsage.created_at >= start, NodeUsage.created_at <= end)
    rows = (
        db.query(
            NodeUsage.node_id,
            func.coalesce(func.sum(NodeUsage.uplink), 0).label("uplink"),
            func.coalesce(func.sum(NodeUsage.downlink), 0).label("downlink"),
        )
        .filter(cond)
        .group_by(NodeUsage.node_id)
        .all()
    )

    for node_id, uplink, downlink in rows:
        target_id = node_id
        if target_id not in usages:
            usages[target_id] = NodeUsageResponse(
                node_id=target_id,
                node_name=MASTER_NODE_NAME if target_id is None else f"Node {target_id}",
                uplink=0,
                downlink=0,
            )
        usages[target_id].uplink += int(uplink or 0)
        usages[target_id].downlink += int(downlink or 0)

    return list(usages.values())


def reset_node_usage(db: Session, dbnode: Node) -> Node:
    """
    Resets the stored data usage metrics for a node.

    Args:
        db (Session): The database session.
        dbnode (Node): The node whose usage should be reset.

    Returns:
        Node: The updated node object.
    """
    db.query(NodeUsage).filter(NodeUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.query(NodeUserUsage).filter(NodeUserUsage.node_id == dbnode.id).delete(synchronize_session=False)

    dbnode.uplink = 0
    dbnode.downlink = 0
    dbnode.status = NodeStatus.connected
    dbnode.message = None
    db.commit()
    db.refresh(dbnode)
    return dbnode


def get_admin_usages(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[UserUsageResponse]:
    """
    Retrieves total usage for all users under a specific admin within a date range.
    Returns data grouped by node.
    """
    return _get_usage_data(db=db, entity_type="admin", admin=dbadmin, start=start, end=end, format="aggregated")


def get_admin_daily_usages(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[dict]:
    """
    Retrieves daily usage for all users under a specific admin, aggregated over all nodes.
    Returns a list of dictionaries with date and total used_traffic.
    """
    return _get_usage_data(
        db=db, entity_type="admin", admin=dbadmin, start=start, end=end, granularity="day", format="by_day"
    )


def get_admin_usages_by_day(
    db: Session,
    dbadmin: Admin,
    start: datetime,
    end: datetime,
    node_id: Optional[int] = None,
    granularity: str = "day",
) -> List[dict]:
    """
    Retrieves usage for all users under a specific admin, optionally filtered by node_id.
    Supports daily (default) or hourly granularity.
    """
    query = (
        db.query(NodeUserUsage)
        .join(User, User.id == NodeUserUsage.user_id)
        .filter(
            User.admin_id == dbadmin.id,
            User.status != UserStatus.deleted,
            NodeUserUsage.created_at >= start,
            NodeUserUsage.created_at <= end,
        )
    )
    if node_id is not None:
        if node_id == 0:
            query = query.filter(NodeUserUsage.node_id.is_(None))
        else:
            query = query.filter(NodeUserUsage.node_id == node_id)

    return _get_usage_by_day(query, start, end, granularity)


def get_node_usage_by_day(
    db: Session,
    node_id: int,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[dict]:
    """
    Retrieves usage for a specific node from NodeUserUsage.
    Granularity can be "day" (default) or "hour".
    """
    return _get_usage_data(
        db=db, entity_type="node", entity_id=node_id, start=start, end=end, granularity=granularity, format="by_day"
    )


def get_admin_usage_by_nodes(db: Session, dbadmin: Admin, start: datetime, end: datetime) -> List[dict]:
    """
    Retrieves uplink and downlink usage for all users under a specific admin within a date range,
    grouped by node. Returns a list of dictionaries with node_id, node_name, uplink, and downlink.
    """
    result = _get_usage_data(db=db, entity_type="admin", admin=dbadmin, start=start, end=end, format="by_nodes")
    # Convert to expected format with uplink/downlink
    node_lookup: Dict[Optional[int], Dict] = {}
    for node in db.query(Node).all():
        node_lookup[node.id] = {"node_id": node.id, "node_name": node.name, "uplink": 0, "downlink": 0}
    node_lookup[None] = {"node_id": None, "node_name": "Master", "uplink": 0, "downlink": 0}

    for entry in result:
        nid = entry["node_id"]
        if nid not in node_lookup:
            node_lookup[nid] = {
                "node_id": nid,
                "node_name": "Master" if nid is None else f"Node {nid}",
                "uplink": 0,
                "downlink": 0,
            }
        node_lookup[nid]["downlink"] += entry["used_traffic"]

    return sorted(
        [e for e in node_lookup.values() if e["uplink"] > 0 or e["downlink"] > 0], key=lambda x: x["node_id"] or 0
    )
