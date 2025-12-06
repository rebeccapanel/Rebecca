"""
Job to sync Redis usage updates to database.
Reads pending usage updates from Redis and applies them to the database.
"""

import logging
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, List, Tuple, Optional, Any

from app.runtime import logger, scheduler
from app.db import GetDB
from app.db.models import User, Admin
from app.redis.cache import (
    get_pending_usage_updates,
    get_pending_usage_snapshots,
    REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING,
    REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING,
    REDIS_KEY_PREFIX_ADMIN_SERVICE_USAGE_PENDING,
)
from app.redis.client import get_redis
from config import REDIS_SYNC_INTERVAL, REDIS_ENABLED
from sqlalchemy import update, bindparam, insert


def sync_usage_updates_to_db():
    """
    Sync pending usage updates from Redis to database.
    This job runs periodically to batch update user usage statistics.
    Limits the amount of data processed per run to prevent timeout.
    """
    if not REDIS_ENABLED:
        return

    redis_client = get_redis()
    if not redis_client:
        return

    try:
        # Limit processing to prevent job from taking too long
        # Process in batches to ensure job completes within interval
        MAX_UPDATES_PER_RUN = 10000  # Limit updates per sync
        MAX_SNAPSHOTS_PER_RUN = 5000  # Limit snapshots per sync

        # Get pending usage updates from Redis (limited)
        pending_updates = get_pending_usage_updates(max_items=MAX_UPDATES_PER_RUN)

        if not pending_updates:
            return

        # Group updates by user_id
        user_updates: Dict[int, Dict[str, Any]] = defaultdict(
            lambda: {
                "used_traffic_delta": 0,
                "online_at": None,
            }
        )

        for update_data in pending_updates:
            user_id = update_data.get("user_id")
            if not user_id:
                continue

            user_updates[user_id]["used_traffic_delta"] += update_data.get("used_traffic_delta", 0)

            # Keep the most recent online_at
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

        # Apply updates to database
        with GetDB() as db:
            # Prepare batch update data
            users_usage = []
            for user_id, update_info in user_updates.items():
                if update_info["used_traffic_delta"] > 0:
                    users_usage.append(
                        {
                            "uid": user_id,
                            "value": update_info["used_traffic_delta"],
                        }
                    )

            if not users_usage:
                return

            # Fetch current values and prepare updates
            user_ids = [u["uid"] for u in users_usage]
            current_users = db.query(User).filter(User.id.in_(user_ids)).all()
            user_dict = {u.id: u for u in current_users}

            # Update each user individually to ensure proper SQLAlchemy handling
            for usage in users_usage:
                user_id = usage["uid"]
                user = user_dict.get(user_id)
                if user:
                    user.used_traffic = (user.used_traffic or 0) + usage["value"]
                    user.online_at = user_updates[user_id]["online_at"] or datetime.now(timezone.utc)

            db.commit()

            # Update admin usage statistics
            user_ids = [u["uid"] for u in users_usage]
            mapping_rows = db.query(User.id, User.admin_id, User.service_id).filter(User.id.in_(user_ids)).all()

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

            # Update admin usage - fetch and update individually to avoid primary key issues
            if admin_usage:
                admin_ids = list(admin_usage.keys())
                current_admins = db.query(Admin).filter(Admin.id.in_(admin_ids)).all()
                admin_dict = {a.id: a for a in current_admins}

                for admin_id, value in admin_usage.items():
                    admin = admin_dict.get(admin_id)
                    if admin:
                        admin.users_usage = (admin.users_usage or 0) + value
                        admin.lifetime_usage = (admin.lifetime_usage or 0) + value

            # Update service usage (if needed)
            # TODO: Add service usage updates if service usage tracking is needed

            db.commit()

            logger.info(f"Synced {len(users_usage)} user usage updates from Redis to database")

            # Clear backup after successful sync
            from app.redis.pending_backup import clear_user_usage_backup

            clear_user_usage_backup()

        # Sync admin usage updates
        admin_synced = _sync_admin_usage_updates(redis_client)
        if admin_synced:
            from app.redis.pending_backup import clear_admin_usage_backup

            clear_admin_usage_backup()

        # Sync service usage updates
        service_synced = _sync_service_usage_updates(redis_client)
        if service_synced:
            from app.redis.pending_backup import clear_service_usage_backup

            clear_service_usage_backup()

        # Sync usage snapshots (user_node_usage and node_usage) - limited batch
        snapshots_synced = _sync_usage_snapshots(redis_client, max_snapshots=MAX_SNAPSHOTS_PER_RUN)
        if snapshots_synced:
            from app.redis.pending_backup import clear_usage_snapshots_backup

            clear_usage_snapshots_backup()

    except Exception as e:
        logger.error(f"Failed to sync usage updates from Redis to database: {e}", exc_info=True)


def _sync_admin_usage_updates(redis_client):
    """Sync admin usage updates from Redis to DB. Returns True if synced successfully."""
    try:
        from app.db.models import Admin
        import json

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


def _sync_service_usage_updates(redis_client):
    """Sync service usage updates from Redis to DB. Returns True if synced successfully."""
    try:
        from app.db.models import Service
        import json

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


def _sync_usage_snapshots(redis_client, max_snapshots: Optional[int] = None):
    """Sync usage snapshots (user_node_usage and node_usage) from Redis to DB. Returns True if synced successfully.

    Args:
        max_snapshots: Maximum number of snapshots to process per type (None = all)
    """
    try:
        from app.db.models import NodeUserUsage, NodeUsage
        from datetime import datetime
        import json

        user_snapshots, node_snapshots = get_pending_usage_snapshots(max_items=max_snapshots)

        if user_snapshots or node_snapshots:
            with GetDB() as db:
                # Group user snapshots by (user_id, node_id, created_at)
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

                # Insert/update user_node_usage in batch using bulk operations
                if user_snapshot_groups:
                    # Fetch existing records in batch
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

                    # Update existing or insert new
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

                # Group node snapshots by (node_id, created_at)
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

                # Insert/update node_usage in batch
                if node_snapshot_groups:
                    # Fetch existing records in batch
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

                    # Update existing or insert new
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


if REDIS_ENABLED:
    scheduler.add_job(
        sync_usage_updates_to_db,
        "interval",
        seconds=REDIS_SYNC_INTERVAL,
        coalesce=True,
        max_instances=1,
        replace_existing=True,
    )
