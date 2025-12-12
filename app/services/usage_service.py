"""
Usage service.

Owns the logic for syncing pending Redis usage deltas/snapshots back to the DB.
Routers and jobs should call into this module instead of touching Redis/DB directly.
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from app.db import GetDB
from app.db.models import User, Admin
from app.redis.cache import (
    get_pending_usage_updates,
    get_pending_usage_snapshots,
    REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING,
    REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING,
    REDIS_KEY_PREFIX_ADMIN_SERVICE_USAGE_PENDING,
    REDIS_KEY_USER_PENDING_TOTAL,
    REDIS_KEY_USER_PENDING_ONLINE,
)
from app.redis.client import get_redis
from config import REDIS_ENABLED

logger = logging.getLogger(__name__)


def sync_usage_updates_to_db() -> None:
    """
    Sync pending usage updates from Redis to database.
    This function is idempotent for processed items and keeps Redis/DB aligned.
    """
    if not REDIS_ENABLED:
        return

    redis_client = get_redis()
    if not redis_client:
        return

    try:
        MAX_UPDATES_PER_RUN = 10000
        MAX_SNAPSHOTS_PER_RUN = 5000

        pending_updates = get_pending_usage_updates(max_items=MAX_UPDATES_PER_RUN)
        if not pending_updates:
            return

        user_updates: Dict[int, Dict[str, Any]] = defaultdict(lambda: {"used_traffic_delta": 0, "online_at": None})
        for update_data in pending_updates:
            user_id = update_data.get("user_id")
            if not user_id:
                continue
            user_updates[user_id]["used_traffic_delta"] += update_data.get("used_traffic_delta", 0)
            update_online_at = update_data.get("online_at")
            if update_online_at:
                try:
                    update_dt = datetime.fromisoformat(update_online_at.replace("Z", "+00:00"))
                    current_online_at = user_updates[user_id]["online_at"]
                    if not current_online_at or update_dt > current_online_at:
                        user_updates[user_id]["online_at"] = update_dt
                except Exception:
                    pass

        if not user_updates:
            return

        BATCH_SIZE = 20
        user_ids_list = list(user_updates.keys())

        user_ids_list.sort()

        total_synced = 0
        for batch_start in range(0, len(user_ids_list), BATCH_SIZE):
            batch_user_ids = user_ids_list[batch_start : batch_start + BATCH_SIZE]
            batch_updates = {uid: user_updates[uid] for uid in batch_user_ids}

            max_retries = 3
            retry_count = 0
            success = False

            while retry_count < max_retries and not success:
                try:
                    with GetDB() as db:
                        users_usage = []
                        for user_id, update_info in batch_updates.items():
                            if update_info["used_traffic_delta"] > 0:
                                users_usage.append({"uid": user_id, "value": update_info["used_traffic_delta"]})

                        if not users_usage:
                            success = True
                            continue

                        current_users = (
                            db.query(User).with_for_update().filter(User.id.in_(batch_user_ids)).order_by(User.id).all()
                        )
                        user_dict = {u.id: u for u in current_users}

                        for usage in users_usage:
                            user_id = usage["uid"]
                            user = user_dict.get(user_id)
                            if user:
                                user.used_traffic = (user.used_traffic or 0) + usage["value"]
                                user.online_at = batch_updates[user_id]["online_at"] or datetime.now(timezone.utc)

                        mapping_rows = (
                            db.query(User.id, User.admin_id, User.service_id).filter(User.id.in_(batch_user_ids)).all()
                        )
                        user_to_admin_service: Dict[int, Tuple[Optional[int], Optional[int]]] = {
                            row[0]: (row[1], row[2]) for row in mapping_rows
                        }

                        admin_usage = defaultdict(int)
                        service_usage = defaultdict(int)
                        admin_service_usage = defaultdict(int)

                        for usage in users_usage:
                            user_id = usage["uid"]
                            value = usage["value"]
                            admin_id, service_id = user_to_admin_service.get(user_id, (None, None))
                            if admin_id:
                                admin_usage[admin_id] += value
                            if service_id:
                                service_usage[service_id] += value
                                if admin_id:
                                    admin_service_usage[(admin_id, service_id)] += value

                        if admin_usage:
                            admin_ids = list(admin_usage.keys())
                            current_admins = db.query(Admin).filter(Admin.id.in_(admin_ids)).order_by(Admin.id).all()
                            admin_dict = {a.id: a for a in current_admins}

                            for admin_id, value in admin_usage.items():
                                admin = admin_dict.get(admin_id)
                                if admin:
                                    admin.users_usage = (admin.users_usage or 0) + value
                                    admin.lifetime_usage = (admin.lifetime_usage or 0) + value

                        # TODO: add service usage persistence when/if required

                        db.commit()
                        total_synced += len(users_usage)
                        success = True

                except Exception as e:
                    from sqlalchemy.exc import OperationalError
                    from pymysql.err import OperationalError as PyMySQLOperationalError

                    is_deadlock = False
                    if isinstance(e, OperationalError):
                        orig_error = e.orig if hasattr(e, "orig") else None
                        if orig_error:
                            error_code = (
                                getattr(orig_error, "args", [None])[0]
                                if hasattr(orig_error, "args") and orig_error.args
                                else None
                            )
                            if error_code == 1213:
                                is_deadlock = True
                    elif isinstance(e, PyMySQLOperationalError):
                        if e.args[0] == 1213:
                            is_deadlock = True

                    if is_deadlock and retry_count < max_retries - 1:
                        retry_count += 1
                        import time

                        time.sleep(0.1 * retry_count)
                        logger.warning(
                            f"Deadlock detected in sync_usage_updates_to_db, retrying ({retry_count}/{max_retries})..."
                        )
                        continue
                    else:
                        raise

        if total_synced > 0:
            logger.info(f"Synced {total_synced} user usage updates from Redis to database")

            from app.redis.pending_backup import clear_user_usage_backup

            clear_user_usage_backup()

        try:
            pipe = redis_client.pipeline()
            for user_id in user_updates.keys():
                pipe.delete(f"{REDIS_KEY_USER_PENDING_TOTAL}{user_id}")
                pipe.delete(f"{REDIS_KEY_USER_PENDING_ONLINE}{user_id}")
            pipe.execute()
        except Exception as exc:
            logger.debug(f"Failed to clear pending usage total keys: {exc}")

        admin_synced = _sync_admin_usage_updates(redis_client)
        if admin_synced:
            from app.redis.pending_backup import clear_admin_usage_backup

            clear_admin_usage_backup()

        service_synced = _sync_service_usage_updates(redis_client)
        if service_synced:
            from app.redis.pending_backup import clear_service_usage_backup

            clear_service_usage_backup()

        snapshots_synced = _sync_usage_snapshots(redis_client, max_snapshots=MAX_SNAPSHOTS_PER_RUN)
        if snapshots_synced:
            from app.redis.pending_backup import clear_usage_snapshots_backup

            clear_usage_snapshots_backup()

    except Exception as e:
        logger.error(f"Failed to sync usage updates from Redis to database: {e}", exc_info=True)


def _sync_admin_usage_updates(redis_client) -> bool:
    """Sync admin usage updates from Redis to DB. Returns True if synced successfully."""
    try:
        from app.db.models import Admin

        admin_updates = defaultdict(int)
        pattern = f"{REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING}*"

        for key in redis_client.scan_iter(match=pattern):
            admin_id = int(key.split(":")[-1])
            while True:
                update_json = redis_client.rpop(key)
                if not update_json:
                    break
                try:
                    update_data = json.loads(update_json)
                    admin_updates[admin_id] += update_data.get("value", 0)
                except json.JSONDecodeError:
                    continue

        if admin_updates:
            with GetDB() as db:
                admin_ids = list(admin_updates.keys())
                current_admins = db.query(Admin).filter(Admin.id.in_(admin_ids)).all()
                admin_dict = {a.id: a for a in current_admins}

                for admin_id, value in admin_updates.items():
                    admin = admin_dict.get(admin_id)
                    if admin:
                        admin.users_usage = (admin.users_usage or 0) + value
                        admin.lifetime_usage = (admin.lifetime_usage or 0) + value

                db.commit()
                logger.info(f"Synced {len(admin_updates)} admin usage updates from Redis to database")
                return True
    except Exception as e:
        logger.error(f"Failed to sync admin usage updates: {e}", exc_info=True)
    return False


def _sync_service_usage_updates(redis_client) -> bool:
    """Sync service usage updates from Redis to DB. Returns True if synced successfully."""
    try:
        from app.db.models import Service

        service_updates = defaultdict(int)
        pattern = f"{REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING}*"

        for key in redis_client.scan_iter(match=pattern):
            service_id = int(key.split(":")[-1])
            while True:
                update_json = redis_client.rpop(key)
                if not update_json:
                    break
                try:
                    update_data = json.loads(update_json)
                    service_updates[service_id] += update_data.get("value", 0)
                except json.JSONDecodeError:
                    continue

        if service_updates:
            with GetDB() as db:
                service_ids = list(service_updates.keys())
                current_services = db.query(Service).filter(Service.id.in_(service_ids)).all()
                service_dict = {s.id: s for s in current_services}

                for service_id, value in service_updates.items():
                    service = service_dict.get(service_id)
                    if service:
                        service.users_usage = (service.users_usage or 0) + value

                db.commit()
                logger.info(f"Synced {len(service_updates)} service usage updates from Redis to database")
                return True
    except Exception as e:
        logger.error(f"Failed to sync service usage updates: {e}", exc_info=True)
    return False


def _sync_usage_snapshots(redis_client, max_snapshots: Optional[int] = None) -> bool:
    """Sync usage snapshots (user_node_usage and node_usage) from Redis to DB. Returns True if synced successfully."""
    try:
        from app.db.models import NodeUserUsage, NodeUsage

        user_snapshots, node_snapshots = get_pending_usage_snapshots(max_items=max_snapshots)

        if user_snapshots or node_snapshots:
            with GetDB() as db:
                user_snapshot_groups = defaultdict(int)
                for snapshot in user_snapshots:
                    user_id = snapshot.get("user_id")
                    node_id = snapshot.get("node_id")
                    created_at_str = snapshot.get("created_at")
                    used_traffic = snapshot.get("used_traffic", 0)
                    if user_id and created_at_str:
                        try:
                            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                            key = (user_id, node_id, created_at)
                            user_snapshot_groups[key] += used_traffic
                        except Exception:
                            continue

                if user_snapshot_groups:
                    snapshot_keys = list(user_snapshot_groups.keys())
                    existing_records = {}
                    for user_id, node_id, created_at in snapshot_keys:
                        existing = (
                            db.query(NodeUserUsage)
                            .filter(
                                NodeUserUsage.user_id == user_id,
                                NodeUserUsage.node_id == node_id,
                                NodeUserUsage.created_at == created_at,
                            )
                            .first()
                        )
                        if existing:
                            existing_records[(user_id, node_id, created_at)] = existing

                    for (user_id, node_id, created_at), total_traffic in user_snapshot_groups.items():
                        key = (user_id, node_id, created_at)
                        if key in existing_records:
                            existing_records[key].used_traffic = (
                                existing_records[key].used_traffic or 0
                            ) + total_traffic
                        else:
                            db.add(
                                NodeUserUsage(
                                    user_id=user_id, node_id=node_id, created_at=created_at, used_traffic=total_traffic
                                )
                            )

                node_snapshot_groups = defaultdict(lambda: {"uplink": 0, "downlink": 0})
                for snapshot in node_snapshots:
                    node_id = snapshot.get("node_id")
                    created_at_str = snapshot.get("created_at")
                    uplink = snapshot.get("uplink", 0)
                    downlink = snapshot.get("downlink", 0)
                    if created_at_str:
                        try:
                            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                            key = (node_id, created_at)
                            node_snapshot_groups[key]["uplink"] += uplink
                            node_snapshot_groups[key]["downlink"] += downlink
                        except Exception:
                            continue

                if node_snapshot_groups:
                    node_keys = list(node_snapshot_groups.keys())
                    existing_node_records = {}
                    for node_id, created_at in node_keys:
                        existing = (
                            db.query(NodeUsage)
                            .filter(NodeUsage.node_id == node_id, NodeUsage.created_at == created_at)
                            .first()
                        )
                        if existing:
                            existing_node_records[(node_id, created_at)] = existing

                    for (node_id, created_at), traffic in node_snapshot_groups.items():
                        key = (node_id, created_at)
                        if key in existing_node_records:
                            existing_node_records[key].uplink = (existing_node_records[key].uplink or 0) + traffic[
                                "uplink"
                            ]
                            existing_node_records[key].downlink = (existing_node_records[key].downlink or 0) + traffic[
                                "downlink"
                            ]
                        else:
                            db.add(
                                NodeUsage(
                                    node_id=node_id,
                                    created_at=created_at,
                                    uplink=traffic["uplink"],
                                    downlink=traffic["downlink"],
                                )
                            )

                db.commit()
                logger.info(
                    f"Synced {len(user_snapshot_groups)} user usage snapshots and {len(node_snapshot_groups)} node usage snapshots from Redis to database"
                )
                return True
    except Exception as e:
        logger.error(f"Failed to sync usage snapshots: {e}", exc_info=True)
    return False
