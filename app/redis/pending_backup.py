"""
Physical backup system for pending Redis data.
Stores pending usage updates to disk before writing to Redis,
and removes them after successful sync to database.
"""

import json
import logging
import os
from datetime import datetime, UTC
from pathlib import Path
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

# Backup file paths
BACKUP_DIR = Path(os.getenv("REDIS_BACKUP_DIR", "data/redis_backup"))
BACKUP_FILES = {
    "user_usage": BACKUP_DIR / "pending_user_usage.json",
    "admin_usage": BACKUP_DIR / "pending_admin_usage.json",
    "service_usage": BACKUP_DIR / "pending_service_usage.json",
    "user_snapshots": BACKUP_DIR / "pending_user_snapshots.json",
    "node_snapshots": BACKUP_DIR / "pending_node_snapshots.json",
}


def _naive_utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def ensure_backup_dir():
    """Ensure backup directory exists."""
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.warning(f"Failed to create backup directory {BACKUP_DIR}: {e}")


def _load_backup(file_key: str) -> Any:
    """Generic function to load backup file."""
    file_path = BACKUP_FILES.get(file_key)
    if not file_path or not file_path.exists():
        return [] if "snapshot" in file_key else {}

    try:
        with open(file_path, "r") as f:
            data = json.load(f)
            # Convert string keys to int for dict backups
            if isinstance(data, dict) and file_key in ("admin_usage", "service_usage"):
                return {int(k): v for k, v in data.items()}
            return data
    except Exception as e:
        logger.warning(f"Failed to load {file_key} backup: {e}")
        return [] if "snapshot" in file_key else {}


def _save_backup(file_key: str, data: Any) -> bool:
    """Generic function to save backup file."""
    file_path = BACKUP_FILES.get(file_key)
    if not file_path:
        return False

    try:
        ensure_backup_dir()
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        return True
    except Exception as e:
        logger.error(f"Failed to save {file_key} backup: {e}")
        return False


def _clear_backup(file_key: str) -> bool:
    """Generic function to clear backup file."""
    file_path = BACKUP_FILES.get(file_key)
    if not file_path or not file_path.exists():
        return True

    try:
        file_path.unlink()
        return True
    except Exception as e:
        logger.warning(f"Failed to clear {file_key} backup: {e}")
        return False


def save_user_usage_backup(updates: List[Dict[str, Any]]) -> bool:
    """Save pending user usage updates to backup file."""
    if not updates:
        return True

    existing = _load_backup("user_usage")
    merged = {}

    # Merge existing
    for update in existing:
        user_id = update.get("user_id")
        if user_id:
            key = str(user_id)
            if key not in merged:
                merged[key] = {"user_id": user_id, "used_traffic_delta": 0, "online_at": update.get("online_at")}
            merged[key]["used_traffic_delta"] += update.get("used_traffic_delta", 0)
            if update.get("online_at") and (
                not merged[key]["online_at"] or update["online_at"] > merged[key]["online_at"]
            ):
                merged[key]["online_at"] = update["online_at"]

    # Merge new
    for update in updates:
        user_id = update.get("user_id")
        if user_id:
            key = str(user_id)
            if key not in merged:
                merged[key] = {"user_id": user_id, "used_traffic_delta": 0, "online_at": update.get("online_at")}
            merged[key]["used_traffic_delta"] += update.get("used_traffic_delta", 0)
            if update.get("online_at") and (
                not merged[key]["online_at"] or update["online_at"] > merged[key]["online_at"]
            ):
                merged[key]["online_at"] = update["online_at"]

    return _save_backup("user_usage", list(merged.values()))


def load_user_usage_backup() -> List[Dict[str, Any]]:
    """Load pending user usage updates from backup file."""
    return _load_backup("user_usage")


def clear_user_usage_backup() -> bool:
    """Remove user usage backup file after successful sync."""
    return _clear_backup("user_usage")


def save_admin_usage_backup(updates: Dict[int, int]) -> bool:
    """Save pending admin usage updates to backup file."""
    if not updates:
        return True

    existing = _load_backup("admin_usage")
    merged = existing.copy()
    for admin_id, value in updates.items():
        merged[admin_id] = merged.get(admin_id, 0) + value

    return _save_backup("admin_usage", merged)


def load_admin_usage_backup() -> Dict[int, int]:
    """Load pending admin usage updates from backup file."""
    return _load_backup("admin_usage")


def clear_admin_usage_backup() -> bool:
    """Remove admin usage backup file after successful sync."""
    return _clear_backup("admin_usage")


def save_service_usage_backup(updates: Dict[int, int]) -> bool:
    """Save pending service usage updates to backup file."""
    if not updates:
        return True

    existing = _load_backup("service_usage")
    merged = existing.copy()
    for service_id, value in updates.items():
        merged[service_id] = merged.get(service_id, 0) + value

    return _save_backup("service_usage", merged)


def load_service_usage_backup() -> Dict[int, int]:
    """Load pending service usage updates from backup file."""
    return _load_backup("service_usage")


def clear_service_usage_backup() -> bool:
    """Remove service usage backup file after successful sync."""
    return _clear_backup("service_usage")


def save_usage_snapshots_backup(user_snapshots: List[Dict[str, Any]], node_snapshots: List[Dict[str, Any]]) -> bool:
    """Save pending usage snapshots to backup file."""
    existing_user, existing_node = load_usage_snapshots_backup()

    # Merge user snapshots
    merged_user = {}
    for snapshot in existing_user + user_snapshots:
        key = f"{snapshot.get('user_id')}:{snapshot.get('node_id')}:{snapshot.get('created_at')}"
        if key not in merged_user:
            merged_user[key] = snapshot.copy()
        else:
            merged_user[key]["used_traffic"] = merged_user[key].get("used_traffic", 0) + snapshot.get("used_traffic", 0)

    # Merge node snapshots
    merged_node = {}
    for snapshot in existing_node + node_snapshots:
        key = f"{snapshot.get('node_id')}:{snapshot.get('created_at')}"
        if key not in merged_node:
            merged_node[key] = snapshot.copy()
        else:
            merged_node[key]["uplink"] = merged_node[key].get("uplink", 0) + snapshot.get("uplink", 0)
            merged_node[key]["downlink"] = merged_node[key].get("downlink", 0) + snapshot.get("downlink", 0)

    _save_backup("user_snapshots", list(merged_user.values()))
    _save_backup("node_snapshots", list(merged_node.values()))
    return True


def load_usage_snapshots_backup() -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Load pending usage snapshots from backup files."""
    return (_load_backup("user_snapshots"), _load_backup("node_snapshots"))


def clear_usage_snapshots_backup() -> bool:
    """Remove usage snapshots backup files after successful sync."""
    return _clear_backup("user_snapshots") and _clear_backup("node_snapshots")


def restore_all_backups_to_redis():
    """Restore all pending backups to Redis on startup."""
    from app.redis.cache import cache_user_usage_update
    from app.redis.client import get_redis
    from app.redis.cache import (
        REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING,
        REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING,
        REDIS_KEY_PREFIX_USER_USAGE_PENDING,
        REDIS_KEY_PREFIX_NODE_USAGE_PENDING,
    )

    redis_client = get_redis()
    if not redis_client:
        logger.warning("Redis not available, cannot restore backups")
        return

    restored_count = 0

    try:
        # Restore user usage updates
        user_updates = load_user_usage_backup()
        if user_updates:
            for update in user_updates:
                user_id = update.get("user_id")
                if user_id:
                    cache_user_usage_update(
                        user_id,
                        update.get("used_traffic_delta", 0),
                        datetime.fromisoformat(update["online_at"]) if update.get("online_at") else None,
                    )
            restored_count += len(user_updates)
            logger.info(f"Restored {len(user_updates)} user usage updates from backup")

        # Restore admin usage updates
        admin_updates = load_admin_usage_backup()
        if admin_updates:
            for admin_id, value in admin_updates.items():
                admin_key = f"{REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING}{admin_id}"
                admin_data = {"admin_id": admin_id, "value": value, "timestamp": _naive_utcnow().isoformat()}
                redis_client.lpush(admin_key, json.dumps(admin_data))
                redis_client.expire(admin_key, 3600)
            restored_count += len(admin_updates)
            logger.info(f"Restored {len(admin_updates)} admin usage updates from backup")

        # Restore service usage updates
        service_updates = load_service_usage_backup()
        if service_updates:
            for service_id, value in service_updates.items():
                service_key = f"{REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING}{service_id}"
                service_data = {"service_id": service_id, "value": value, "timestamp": _naive_utcnow().isoformat()}
                redis_client.lpush(service_key, json.dumps(service_data))
                redis_client.expire(service_key, 3600)
            restored_count += len(service_updates)
            logger.info(f"Restored {len(service_updates)} service usage updates from backup")

        # Restore usage snapshots
        user_snapshots, node_snapshots = load_usage_snapshots_backup()
        if user_snapshots or node_snapshots:
            for snapshot in user_snapshots:
                user_id = snapshot.get("user_id")
                node_id = snapshot.get("node_id")
                created_at_str = snapshot.get("created_at")
                if user_id and created_at_str:
                    pending_key = (
                        f"{REDIS_KEY_PREFIX_USER_USAGE_PENDING}{user_id}:{node_id or 'master'}:{created_at_str}"
                    )
                    redis_client.lpush(pending_key, json.dumps(snapshot))
                    redis_client.expire(pending_key, 3600)

            for snapshot in node_snapshots:
                node_id = snapshot.get("node_id")
                created_at_str = snapshot.get("created_at")
                if created_at_str:
                    pending_key = f"{REDIS_KEY_PREFIX_NODE_USAGE_PENDING}{node_id or 'master'}:{created_at_str}"
                    redis_client.lpush(pending_key, json.dumps(snapshot))
                    redis_client.expire(pending_key, 3600)

            restored_count += len(user_snapshots) + len(node_snapshots)
            logger.info(
                f"Restored {len(user_snapshots)} user snapshots and {len(node_snapshots)} node snapshots from backup"
            )

        if restored_count > 0:
            logger.info(f"Total {restored_count} pending updates restored from backup to Redis")

    except Exception as e:
        logger.error(f"Failed to restore backups to Redis: {e}", exc_info=True)
