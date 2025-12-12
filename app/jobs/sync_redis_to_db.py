"""
Job to sync Redis usage updates and user data changes to database.
Reads pending usage updates and user changes from Redis and applies them to the database.
"""

import logging
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, List, Tuple, Optional, Any

from app.runtime import logger, scheduler
from app.db import GetDB
from app.db.models import User, Admin
from app.redis.client import get_redis
from config import REDIS_SYNC_INTERVAL, REDIS_ENABLED
from app.services import usage_service
from app.redis.cache import (
    REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING,
    REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING,
    get_pending_usage_snapshots,
    get_pending_user_sync_ids,
    get_pending_user_sync_data,
    clear_user_sync_pending,
)


def sync_usage_updates_to_db():
    # Delegate to the service layer to keep jobs thin
    usage_service.sync_usage_updates_to_db()


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


def sync_user_changes_to_db():
    """Sync user data changes from Redis to database."""
    if not REDIS_ENABLED:
        return

    redis_client = get_redis()
    if not redis_client:
        return

    try:
        pending_user_ids = get_pending_user_sync_ids()
        if not pending_user_ids:
            return

        logger.info(f"Syncing {len(pending_user_ids)} user changes from Redis to database...")

        synced_count = 0
        with GetDB() as db:
            for user_id in pending_user_ids:
                try:
                    user_data = get_pending_user_sync_data(user_id)
                    if not user_data:
                        # User data not found, might have been deleted, clear the flag
                        clear_user_sync_pending(user_id)
                        continue

                    # Get user from database
                    db_user = db.query(User).filter(User.id == user_id).first()
                    if not db_user:
                        # User doesn't exist in DB, might have been deleted
                        clear_user_sync_pending(user_id)
                        continue

                    if "used_traffic" in user_data:
                        db_user.used_traffic = user_data.get("used_traffic", 0) or 0

                    if "online_at" in user_data and user_data.get("online_at"):
                        try:
                            online_at_str = user_data["online_at"]
                            if isinstance(online_at_str, str):
                                db_user.online_at = datetime.fromisoformat(online_at_str.replace("Z", "+00:00"))
                        except Exception:
                            pass

                    if "sub_updated_at" in user_data and user_data.get("sub_updated_at"):
                        try:
                            sub_updated_str = user_data["sub_updated_at"]
                            if isinstance(sub_updated_str, str):
                                db_user.sub_updated_at = datetime.fromisoformat(sub_updated_str.replace("Z", "+00:00"))
                        except Exception:
                            pass

                    # Sync status if it changed
                    if "status" in user_data and user_data.get("status"):
                        from app.models.user import UserStatus

                        try:
                            new_status = UserStatus(user_data["status"])
                            if db_user.status != new_status:
                                db_user.status = new_status
                                db_user.last_status_change = datetime.now(timezone.utc)
                        except Exception:
                            pass

                    # Sync expire if it changed
                    if "expire" in user_data:
                        db_user.expire = user_data.get("expire")

                    # Sync data_limit if it changed
                    if "data_limit" in user_data:
                        db_user.data_limit = user_data.get("data_limit")

                    # Sync lifetime_used_traffic if available
                    if "lifetime_used_traffic" in user_data:
                        try:
                            db_user.lifetime_used_traffic = user_data.get("lifetime_used_traffic", 0) or 0
                        except Exception:
                            pass

                    synced_count += 1
                    clear_user_sync_pending(user_id)

                except Exception as e:
                    logger.warning(f"Failed to sync user {user_id} to database: {e}", exc_info=True)
                    continue

            if synced_count > 0:
                db.commit()
                logger.info(f"Successfully synced {synced_count} user changes from Redis to database")

    except Exception as e:
        logger.error(f"Failed to sync user changes to database: {e}", exc_info=True)


def sync_all_to_db():
    """Sync both usage updates and user changes from Redis to database."""
    # Sync usage updates first
    sync_usage_updates_to_db()
    # Then sync user changes
    sync_user_changes_to_db()


if REDIS_ENABLED:
    scheduler.add_job(
        sync_all_to_db,
        "interval",
        seconds=REDIS_SYNC_INTERVAL,
        coalesce=True,
        max_instances=1,
        replace_existing=True,
    )
