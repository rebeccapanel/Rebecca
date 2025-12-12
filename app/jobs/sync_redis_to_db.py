"""
Job to sync Redis usage updates and user data changes to database.
Reads pending usage updates and user changes from Redis and applies them to the database.
"""

import logging
import threading
import time
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, List, Tuple, Optional, Any

from sqlalchemy.exc import OperationalError, TimeoutError as SQLTimeoutError
from pymysql.err import OperationalError as PyMySQLOperationalError

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

# Lock to prevent concurrent sync operations (re-entrant so nested calls are safe)
_sync_lock = threading.RLock()


def sync_usage_updates_to_db():
    # Delegate to the service layer to keep jobs thin
    usage_service.sync_usage_updates_to_db()


def _sync_admin_usage_updates(redis_client):
    """Sync admin usage updates from Redis to DB. Returns True if synced successfully.

    If deadlock or connection pool errors occur, data is kept in Redis.
    """
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
            max_retries = 3
            retry_count = 0
            while retry_count < max_retries:
                try:
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
                    is_deadlock = _is_deadlock_error(e)
                    is_pool_error = _is_connection_pool_error(e)

                    if (is_deadlock or is_pool_error) and retry_count < max_retries - 1:
                        retry_count += 1
                        error_type = "deadlock" if is_deadlock else "connection pool"
                        logger.warning(
                            f"{error_type} detected in admin usage sync, "
                            f"retrying ({retry_count}/{max_retries})... Data kept in Redis."
                        )
                        time.sleep(0.1 * retry_count)
                        continue
                    else:
                        # Put data back to Redis for retry
                        for admin_id, value in admin_updates.items():
                            key = f"{REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING}{admin_id}"
                            update_data = json.dumps({"value": value})
                            redis_client.lpush(key, update_data)
                        logger.error(
                            f"Failed to sync admin usage updates after {retry_count + 1} attempts: {e}. Data kept in Redis."
                        )
                        return False
    except Exception as e:
        logger.error(f"Failed to sync admin usage updates: {e}", exc_info=True)
    return False


def _sync_service_usage_updates(redis_client):
    """Sync service usage updates from Redis to DB. Returns True if synced successfully.

    If deadlock or connection pool errors occur, data is kept in Redis.
    """
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
            max_retries = 3
            retry_count = 0
            while retry_count < max_retries:
                try:
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
                    is_deadlock = _is_deadlock_error(e)
                    is_pool_error = _is_connection_pool_error(e)

                    if (is_deadlock or is_pool_error) and retry_count < max_retries - 1:
                        retry_count += 1
                        error_type = "deadlock" if is_deadlock else "connection pool"
                        logger.warning(
                            f"{error_type} detected in service usage sync, "
                            f"retrying ({retry_count}/{max_retries})... Data kept in Redis."
                        )
                        time.sleep(0.1 * retry_count)
                        continue
                    else:
                        # Put data back to Redis for retry
                        for service_id, value in service_updates.items():
                            key = f"{REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING}{service_id}"
                            update_data = json.dumps({"value": value})
                            redis_client.lpush(key, update_data)
                        logger.error(
                            f"Failed to sync service usage updates after {retry_count + 1} attempts: {e}. Data kept in Redis."
                        )
                        return False
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


def _is_deadlock_error(e: Exception) -> bool:
    """Check if exception is a deadlock error."""
    if isinstance(e, OperationalError):
        orig_error = e.orig if hasattr(e, "orig") else None
        if orig_error:
            error_code = (
                getattr(orig_error, "args", [None])[0] if hasattr(orig_error, "args") and orig_error.args else None
            )
            if error_code == 1213:  # MySQL deadlock
                return True
    elif isinstance(e, PyMySQLOperationalError):
        if e.args[0] == 1213:  # MySQL deadlock
            return True
    return False


def _is_connection_pool_error(e: Exception) -> bool:
    """Check if exception is a connection pool timeout error."""
    if isinstance(e, SQLTimeoutError):
        return True
    if isinstance(e, OperationalError):
        error_msg = str(e).lower()
        if "queuepool" in error_msg or "connection timed out" in error_msg or "timeout" in error_msg:
            return True
    return False


def sync_user_changes_to_db():
    """Sync user data changes from Redis to database.

    If deadlock or connection pool errors occur, data is kept in Redis
    and will be retried in the next sync cycle.
    """
    if not REDIS_ENABLED:
        return

    redis_client = get_redis()
    if not redis_client:
        return

    # Use lock to prevent concurrent sync operations
    if not _sync_lock.acquire(blocking=False):
        logger.debug("Sync job skipped because a previous run is still in progress")
        return

    try:
        pending_user_ids = get_pending_user_sync_ids()
        if not pending_user_ids:
            return

        logger.info(f"Syncing {len(pending_user_ids)} user changes from Redis to database...")

        synced_count = 0
        failed_user_ids = []
        max_retries = 3
        retry_delay = 0.1

        for user_id in pending_user_ids:
            retry_count = 0
            success = False

            while retry_count < max_retries and not success:
                try:
                    with GetDB() as db:
                        user_data = get_pending_user_sync_data(user_id)
                        if not user_data:
                            # User data not found, might have been deleted, clear the flag
                            clear_user_sync_pending(user_id)
                            success = True
                            continue

                        # Get user from database
                        db_user = db.query(User).filter(User.id == user_id).first()
                        if not db_user:
                            # User doesn't exist in DB, might have been deleted
                            clear_user_sync_pending(user_id)
                            success = True
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
                                    db_user.sub_updated_at = datetime.fromisoformat(
                                        sub_updated_str.replace("Z", "+00:00")
                                    )
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

                        db.commit()
                        clear_user_sync_pending(user_id)
                        synced_count += 1
                        success = True

                except Exception as e:
                    is_deadlock = _is_deadlock_error(e)
                    is_pool_error = _is_connection_pool_error(e)

                    if (is_deadlock or is_pool_error) and retry_count < max_retries - 1:
                        retry_count += 1
                        error_type = "deadlock" if is_deadlock else "connection pool"
                        logger.warning(
                            f"{error_type} detected while syncing user {user_id}, "
                            f"retrying ({retry_count}/{max_retries})... Data kept in Redis."
                        )
                        time.sleep(retry_delay * retry_count)
                        continue
                    else:
                        # Keep data in Redis for next sync cycle
                        logger.warning(
                            f"Failed to sync user {user_id} to database after {retry_count + 1} attempts: {e}. "
                            f"Data will be kept in Redis and retried in next sync cycle."
                        )
                        failed_user_ids.append(user_id)
                        break

        if synced_count > 0:
            logger.info(f"Successfully synced {synced_count} user changes from Redis to database")

        if failed_user_ids:
            logger.warning(
                f"Failed to sync {len(failed_user_ids)} users. Data kept in Redis for retry in next sync cycle."
            )

    except Exception as e:
        logger.error(f"Failed to sync user changes to database: {e}", exc_info=True)
    finally:
        _sync_lock.release()


def sync_all_to_db():
    """Sync both usage updates and user changes from Redis to database.

    Uses lock to prevent concurrent execution and ensure priority.
    If deadlock or connection pool errors occur, data is kept in Redis
    and will be retried in the next sync cycle.
    """
    if not REDIS_ENABLED:
        return

    # Use lock to prevent concurrent sync operations and give priority to sync
    if not _sync_lock.acquire(blocking=False):
        logger.debug("Sync job skipped because a previous run is still in progress")
        return

    try:
        # Sync usage updates first (higher priority)
        sync_usage_updates_to_db()
        # Then sync user changes
        sync_user_changes_to_db()
    finally:
        _sync_lock.release()


if REDIS_ENABLED:
    # Add sync job with higher priority (lower misfire_grace_time means higher priority)
    # This ensures sync operations get priority over other jobs
    scheduler.add_job(
        sync_all_to_db,
        "interval",
        seconds=REDIS_SYNC_INTERVAL,
        coalesce=True,
        max_instances=1,
        replace_existing=True,
        misfire_grace_time=REDIS_SYNC_INTERVAL * 2,  # Allow longer grace time for sync
        id="redis_sync_all_to_db",  # Unique ID for easier management
    )
