"""
Unified Redis cache service for users and usage statistics.
Consolidates user_cache.py and usage_cache.py into a single module.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from collections import defaultdict

from app.redis.client import get_redis
from app.db.models import User, NodeUserUsage, NodeUsage, Proxy
from app.models.user import UserStatus, UserDataLimitResetStrategy
from sqlalchemy import func
from sqlalchemy.orm import selectinload, joinedload

logger = logging.getLogger(__name__)

# ============================================================================
# Key Prefixes
# ============================================================================

# User cache keys
REDIS_KEY_PREFIX_USER = "user:"
REDIS_KEY_PREFIX_USER_BY_ID = "user:id:"
REDIS_KEY_PREFIX_USER_LIST = "user:list:"
REDIS_KEY_PREFIX_USER_COUNT = "user:count:"

# Usage cache keys
REDIS_KEY_PREFIX_USER_USAGE = "usage:user:"
REDIS_KEY_PREFIX_NODE_USAGE = "usage:node:"
REDIS_KEY_PREFIX_USER_USAGE_PENDING = "usage:user:pending:"
REDIS_KEY_PREFIX_NODE_USAGE_PENDING = "usage:node:pending:"
REDIS_KEY_PREFIX_ADMIN_USAGE_PENDING = "usage:admin:pending:"
REDIS_KEY_PREFIX_SERVICE_USAGE_PENDING = "usage:service:pending:"
REDIS_KEY_PREFIX_ADMIN_SERVICE_USAGE_PENDING = "usage:admin_service:pending:"

# Service, Inbound, and Host cache keys
REDIS_KEY_PREFIX_SERVICE = "service:"
REDIS_KEY_PREFIX_SERVICE_LIST = "service:list"
REDIS_KEY_PREFIX_INBOUNDS = "inbounds:"
REDIS_KEY_PREFIX_HOSTS = "hosts:"
REDIS_KEY_PREFIX_SERVICE_HOST_MAP = "service_host_map:"

# TTLs
USER_CACHE_TTL = 86400  # 24 hours
USAGE_CACHE_TTL = 604800  # 7 days
SERVICE_CACHE_TTL = 86400  # 24 hours
INBOUNDS_CACHE_TTL = 86400  # 24 hours
HOSTS_CACHE_TTL = 86400  # 24 hours

# ============================================================================
# Helper Functions
# ============================================================================

def _get_user_key(username: str) -> str:
    """Get Redis key for user by username."""
    return f"{REDIS_KEY_PREFIX_USER}{username.lower()}"


def _get_user_id_key(user_id: int) -> str:
    """Get Redis key for user by ID."""
    return f"{REDIS_KEY_PREFIX_USER_BY_ID}{user_id}"


def _get_user_usage_key(user_id: int, node_id: Optional[int], created_at: datetime) -> str:
    """Get Redis key for user usage record."""
    created_at_str = created_at.strftime('%Y-%m-%dT%H:00:00')
    node_str = str(node_id) if node_id is not None else "master"
    return f"{REDIS_KEY_PREFIX_USER_USAGE}{user_id}:{node_str}:{created_at_str}"


def _get_node_usage_key(node_id: Optional[int], created_at: datetime) -> str:
    """Get Redis key for node usage record."""
    created_at_str = created_at.strftime('%Y-%m-%dT%H:00:00')
    node_str = str(node_id) if node_id is not None else "master"
    return f"{REDIS_KEY_PREFIX_NODE_USAGE}{node_str}:{created_at_str}"


def _serialize_value(value):
    """Recursively serialize value for JSON storage."""
    if isinstance(value, datetime):
        return value.isoformat() if value else None
    elif hasattr(value, 'value'):  # Enum
        return value.value
    elif hasattr(value, '__dict__'):  # Object with __dict__
        return {k: _serialize_value(v) for k, v in value.__dict__.items() if not k.startswith('_')}
    elif isinstance(value, list):
        return [_serialize_value(item) for item in value]
    elif isinstance(value, dict):
        return {k: _serialize_value(v) for k, v in value.items()}
    return value


# ============================================================================
# User Cache Functions
# ============================================================================

def _serialize_user(user: User) -> Dict[str, Any]:
    """Serialize user object to dictionary for Redis storage."""
    user_dict = {
        'id': user.id,
        'username': user.username,
        'status': user.status.value if user.status else None,
        'expire': user.expire,
        'data_limit': user.data_limit,
        'data_limit_reset_strategy': user.data_limit_reset_strategy.value if user.data_limit_reset_strategy else None,
        'note': user.note,
        'on_hold_timeout': _serialize_value(user.on_hold_timeout),
        'on_hold_expire_duration': user.on_hold_expire_duration,
        'auto_delete_in_days': user.auto_delete_in_days,
        'ip_limit': user.ip_limit,
        'flow': user.flow,
        'credential_key': user.credential_key,
        'created_at': _serialize_value(user.created_at),
        'edit_at': _serialize_value(user.edit_at),
        'last_status_change': _serialize_value(user.last_status_change),
        'online_at': _serialize_value(user.online_at),
        'sub_updated_at': _serialize_value(user.sub_updated_at),
        'used_traffic': user.used_traffic,
        'admin_id': user.admin_id,
        'service_id': user.service_id,
    }
    
    # Add proxies
    if user.proxies:
        user_dict['proxies'] = [
            {
                'type': proxy.type,
                'settings': proxy.settings if isinstance(proxy.settings, dict) else json.loads(proxy.settings) if isinstance(proxy.settings, str) else {},
                'excluded_inbounds': [inb.tag for inb in proxy.excluded_inbounds] if proxy.excluded_inbounds else []
            }
            for proxy in user.proxies
        ]
    
    # Add next_plan if exists
    if user.next_plan:
        user_dict['next_plan'] = {
            'data_limit': user.next_plan.data_limit,
            'expire': user.next_plan.expire,
            'add_remaining_traffic': user.next_plan.add_remaining_traffic,
            'fire_on_either': user.next_plan.fire_on_either,
        }
    
    return user_dict


def _deserialize_user(user_dict: Dict[str, Any], db: Optional[Any] = None) -> Optional[User]:
    """Deserialize user dictionary from Redis to User object.
    
    WARNING: This creates a detached User object (not attached to any session).
    Do NOT add this object to a session - it will cause duplicate key errors.
    Use it only for read-only operations like filtering and sorting.
    """
    if not user_dict:
        return None
    
    try:
        from app.db.models import Admin as AdminModel, Service as ServiceModel, NextPlan as NextPlanModel, Proxy as ProxyModel, ProxyInbound as InboundModel
        from sqlalchemy.inspection import inspect as sa_inspect
        
        user = User()
        user_id = user_dict.get('id')
        if user_id:
            user.id = user_id
        
        # Mark as detached/expired to prevent accidental session attachment
        # This ensures SQLAlchemy knows this is not a new object and won't try to INSERT it
        try:
            state = sa_inspect(user)
            if state:
                state.expired = True  # Mark as expired so SQLAlchemy won't try to INSERT
                state.detached = True  # Mark as detached
        except Exception:
            pass  # If inspection fails, object is already detached
        
        user.username = user_dict.get('username')
        if user_dict.get('status'):
            user.status = UserStatus(user_dict['status'])
        user.expire = user_dict.get('expire')
        user.data_limit = user_dict.get('data_limit')
        if user_dict.get('data_limit_reset_strategy'):
            user.data_limit_reset_strategy = UserDataLimitResetStrategy(user_dict['data_limit_reset_strategy'])
        user.note = user_dict.get('note')
        user.on_hold_timeout = datetime.fromisoformat(user_dict['on_hold_timeout'].replace('Z', '+00:00')) if user_dict.get('on_hold_timeout') else None
        user.on_hold_expire_duration = user_dict.get('on_hold_expire_duration')
        user.auto_delete_in_days = user_dict.get('auto_delete_in_days')
        user.ip_limit = user_dict.get('ip_limit', 0)
        user.flow = user_dict.get('flow')
        user.credential_key = user_dict.get('credential_key')
        user.used_traffic = user_dict.get('used_traffic', 0)
        user.sub_updated_at = datetime.fromisoformat(user_dict['sub_updated_at'].replace('Z', '+00:00')) if user_dict.get('sub_updated_at') else None
        
        # Parse datetime fields
        user.created_at = datetime.fromisoformat(user_dict['created_at'].replace('Z', '+00:00')) if user_dict.get('created_at') else None
        user.edit_at = datetime.fromisoformat(user_dict['edit_at'].replace('Z', '+00:00')) if user_dict.get('edit_at') else None
        user.last_status_change = datetime.fromisoformat(user_dict['last_status_change'].replace('Z', '+00:00')) if user_dict.get('last_status_change') else None
        user.online_at = datetime.fromisoformat(user_dict['online_at'].replace('Z', '+00:00')) if user_dict.get('online_at') else None
        
        # Handle relationships - DON'T load from DB here to avoid N+1 queries
        # Relationships will be loaded in batch after pagination
        # Just set the IDs for lazy loading if needed
        user.admin_id = user_dict.get('admin_id')
        user.service_id = user_dict.get('service_id')
        if user_dict.get('next_plan'):
            user.next_plan = NextPlanModel(**user_dict['next_plan'])
        
        # Deserialize proxies
        user.proxies = []
        for proxy_data in user_dict.get('proxies', []):
            proxy = ProxyModel(type=proxy_data['type'], settings=proxy_data['settings'])
            if proxy_data.get('excluded_inbounds'):
                proxy.excluded_inbounds = [InboundModel(tag=tag) for tag in proxy_data['excluded_inbounds']]
            user.proxies.append(proxy)

        return user
    except Exception as e:
        logger.error(f"Failed to deserialize user from Redis: {e}")
        return None


def cache_user(user: User) -> bool:
    """Cache a user's data in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        user_dict = _serialize_user(user)
        user_json = json.dumps(user_dict)
        
        redis_client.setex(_get_user_id_key(user.id), USER_CACHE_TTL, user_json)
        redis_client.setex(_get_user_key(user.username), USER_CACHE_TTL, user_json)
        return True
    except Exception as e:
        logger.warning(f"Failed to cache user in Redis: {e}")
        return False


def get_cached_user(username: Optional[str] = None, user_id: Optional[int] = None, db: Optional[Any] = None) -> Optional[User]:
    """Get a single user from Redis cache by username or ID."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    user_json = None
    if user_id:
        user_json = redis_client.get(_get_user_id_key(user_id))
    elif username:
        user_json = redis_client.get(_get_user_key(username))
    
    if user_json:
        user_dict = json.loads(user_json)
        user = _deserialize_user(user_dict, db)
        if user:
            return user
    
    # Fallback to DB if not found in cache (avoid recursive cache calls)
    if db:
        query = db.query(User)
        if user_id is not None:
            query = query.filter(User.id == user_id)
        elif username:
            query = query.filter(func.lower(User.username) == username.lower())
        else:
            return None

        # Lightweight eager-load to make returned object safe for use
        from app.db.models import Service
        from app.db.crud.user import _next_plan_table_exists
        options = [
            joinedload(User.service).joinedload(Service.host_links),  # many-to-one: one service per user, with host_links for service_host_orders
            joinedload(User.admin),  # many-to-one: one admin per user
            selectinload(User.proxies).selectinload(Proxy.excluded_inbounds),
            selectinload(User.usage_logs),  # For lifetime_used_traffic property
        ]
        if _next_plan_table_exists(db):
            options.append(joinedload(User.next_plan))
        query = query.options(*options)

        db_user = query.first()
        if db_user:
            cache_user(db_user)
        return db_user

    return None


def invalidate_user_cache(username: Optional[str] = None, user_id: Optional[int] = None) -> bool:
    """Invalidate a user's cache entries in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        keys_to_delete = []
        if user_id:
            keys_to_delete.append(_get_user_id_key(user_id))
        if username:
            keys_to_delete.append(_get_user_key(username))
        
        if keys_to_delete:
            redis_client.delete(*keys_to_delete)
        
        # Also invalidate list caches
        pattern = f"{REDIS_KEY_PREFIX_USER_LIST}*"
        for key in redis_client.scan_iter(match=pattern):
            redis_client.delete(key)
        
        # Invalidate count caches
        pattern = f"{REDIS_KEY_PREFIX_USER_COUNT}*"
        for key in redis_client.scan_iter(match=pattern):
            redis_client.delete(key)
        
        return True
    except Exception as e:
        logger.warning(f"Failed to invalidate user cache: {e}")
        return False


def get_all_users_from_cache(db: Optional[Any] = None) -> List[User]:
    """Get all users from Redis cache using optimized batch reading."""
    redis_client = get_redis()
    if not redis_client:
        return []
    
    try:
        user_id_keys = []
        pattern = f"{REDIS_KEY_PREFIX_USER_BY_ID}*"
        # Use SCAN with cursor for better performance and timeout prevention
        cursor = 0
        max_iterations = 10000  # Safety limit
        iteration = 0
        while iteration < max_iterations:
            cursor, keys = redis_client.scan(cursor, match=pattern, count=1000)
            user_id_keys.extend(keys)
            if cursor == 0:
                break
            iteration += 1
        
        if not user_id_keys:
            if db:
                logger.info("No users found in Redis cache, loading from database")
                try:
                    from app.db.crud import get_user_queryset
                    # Load without eager loading first to avoid timeout
                    query = get_user_queryset(db, eager_load=False)
                    db_users = query.all()
                    # Cache users in background (don't block)
                    try:
                        for db_user in db_users:
                            cache_user(db_user)
                    except Exception as e:
                        logger.warning(f"Failed to cache some users: {e}")
                    return db_users
                except Exception as e:
                    logger.error(f"Failed to load users from database: {e}")
                    return []
            return []
        
        users = []
        seen_user_ids = set()
        batch_size = 1000
        
        for i in range(0, len(user_id_keys), batch_size):
            batch_keys = user_id_keys[i:i + batch_size]
            pipe = redis_client.pipeline()
            for key in batch_keys:
                pipe.get(key)
            results = pipe.execute()
            
            for user_json in results:
                if not user_json:
                    continue
                try:
                    user_dict = json.loads(user_json)
                    user_id = user_dict.get('id')
                    if user_id and user_id not in seen_user_ids:
                        seen_user_ids.add(user_id)
                        user = _deserialize_user(user_dict, db)
                        if user:
                            users.append(user)
                except Exception as e:
                    logger.debug(f"Failed to deserialize user: {e}")
                    continue
        
        if users:
            logger.debug(f"Loaded {len(users)} users from Redis cache")
            return users
        
        if db:
            logger.info("No users found in Redis cache, loading from database")
            try:
                from app.db.crud import get_user_queryset
                # Load without eager loading first to avoid timeout
                query = get_user_queryset(db, eager_load=False)
                db_users = query.all()
                # Cache users in background (don't block)
                try:
                    for db_user in db_users:
                        cache_user(db_user)
                except Exception as e:
                    logger.warning(f"Failed to cache some users: {e}")
                return db_users
            except Exception as e:
                logger.error(f"Failed to load users from database: {e}")
                return []
        
        return []
    except Exception as e:
        logger.error(f"Failed to get all users from cache: {e}")
        if db:
            from app.db.crud import get_user_queryset
            return get_user_queryset(db, eager_load=True).all()
        return []


def warmup_users_cache() -> Tuple[int, int]:
    """Warm up Redis cache with all users' data."""
    redis_client = get_redis()
    if not redis_client:
        logger.info("Redis not available, skipping users cache warmup")
        return (0, 0)
    
    try:
        from app.db import GetDB
        from app.db.crud import get_user_queryset
        
        logger.info("Starting users cache warmup...")
        
        cached_count = 0
        total_count = 0
        with GetDB() as db:
            all_users = get_user_queryset(db, eager_load=True).all()
            total_count = len(all_users)
            
            pipe = redis_client.pipeline()
            for user in all_users:
                user_dict = _serialize_user(user)
                user_json = json.dumps(user_dict)
                pipe.setex(_get_user_id_key(user.id), USER_CACHE_TTL, user_json)
                pipe.setex(_get_user_key(user.username), USER_CACHE_TTL, user_json)
                cached_count += 1
            pipe.execute()
        
        return (total_count, cached_count)
    except Exception as e:
        logger.error(f"Failed to warmup users cache: {e}", exc_info=True)
        return (0, 0)


# ============================================================================
# Usage Cache Functions
# ============================================================================

def cache_user_usage_update(user_id: int, used_traffic_delta: int, online_at: Optional[datetime] = None) -> bool:
    """Update user usage in Redis cache (for record_usages)."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        usage_key = f"user:usage:{user_id}"
        usage_data = {
            'user_id': user_id,
            'used_traffic_delta': used_traffic_delta,
            'online_at': online_at.isoformat() if online_at else None,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }
        redis_client.lpush(usage_key, json.dumps(usage_data))
        redis_client.expire(usage_key, 3600)
        return True
    except Exception as e:
        logger.warning(f"Failed to cache user usage update: {e}")
        return False


def get_pending_usage_updates(max_items: Optional[int] = None) -> List[Dict[str, Any]]:
    """Get pending usage updates from Redis.
    
    Args:
        max_items: Maximum number of updates to retrieve (None = all)
    """
    redis_client = get_redis()
    if not redis_client:
        return []
    
    try:
        updates = []
        pattern = "user:usage:*"
        item_count = 0
        
        for key in redis_client.scan_iter(match=pattern, count=1000):
            if max_items and item_count >= max_items:
                break
            while True:
                if max_items and item_count >= max_items:
                    break
                update_json = redis_client.rpop(key)
                if not update_json:
                    break
                try:
                    update_data = json.loads(update_json)
                    updates.append(update_data)
                    item_count += 1
                except json.JSONDecodeError:
                    continue
        return updates
    except Exception as e:
        logger.error(f"Failed to get pending usage updates: {e}")
        return []


def cache_user_usage(user_id: int, node_id: Optional[int], created_at: datetime, used_traffic: int, increment: bool = False) -> bool:
    """Cache user usage in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        # Ensure used_traffic is a valid integer within Redis range
        if not isinstance(used_traffic, int):
            used_traffic = int(used_traffic)
        # Redis incrby supports -2^63 to 2^63-1, but we'll cap at reasonable values
        if used_traffic < -9223372036854775808:
            used_traffic = -9223372036854775808
        elif used_traffic > 9223372036854775807:
            used_traffic = 9223372036854775807
        
        key = _get_user_usage_key(user_id, node_id, created_at)
        if increment:
            redis_client.incrby(key, used_traffic)
        else:
            redis_client.setex(key, USAGE_CACHE_TTL, str(used_traffic))
        return True
    except (ValueError, OverflowError) as e:
        logger.warning(f"Failed to cache user usage: invalid value {used_traffic}: {e}")
        return False
    except Exception as e:
        logger.warning(f"Failed to cache user usage: {e}")
        return False


def get_user_usage(user_id: int, node_id: Optional[int], created_at: datetime) -> Optional[int]:
    """Get user usage from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        key = _get_user_usage_key(user_id, node_id, created_at)
        value = redis_client.get(key)
        return int(value) if value else None
    except Exception as e:
        logger.debug(f"Failed to get user usage from cache: {e}")
        return None


def cache_node_usage(node_id: Optional[int], created_at: datetime, uplink: int, downlink: int, increment: bool = False) -> bool:
    """Cache node usage in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        key = _get_node_usage_key(node_id, created_at)
        usage_data = {'uplink': uplink, 'downlink': downlink}
        if increment:
            existing = redis_client.get(key)
            if existing:
                existing_data = json.loads(existing)
                usage_data['uplink'] = existing_data.get('uplink', 0) + uplink
                usage_data['downlink'] = existing_data.get('downlink', 0) + downlink
        
        redis_client.setex(key, USAGE_CACHE_TTL, json.dumps(usage_data))
        return True
    except Exception as e:
        logger.warning(f"Failed to cache node usage: {e}")
        return False


def get_node_usage(node_id: Optional[int], created_at: datetime) -> Optional[Dict[str, int]]:
    """Get node usage from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        key = _get_node_usage_key(node_id, created_at)
        value = redis_client.get(key)
        if value:
            return json.loads(value)
        return None
    except Exception as e:
        logger.debug(f"Failed to get node usage from cache: {e}")
        return None


def cache_user_usage_snapshot(user_id: int, node_id: Optional[int], created_at: datetime, used_traffic: int) -> bool:
    """Cache user usage snapshot (for hourly snapshots used in charts)."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        pending_key = f"{REDIS_KEY_PREFIX_USER_USAGE_PENDING}{user_id}:{node_id or 'master'}:{created_at.isoformat()}"
        usage_data = {
            'user_id': user_id,
            'node_id': node_id,
            'created_at': created_at.isoformat(),
            'used_traffic': used_traffic,
        }
        redis_client.lpush(pending_key, json.dumps(usage_data))
        redis_client.expire(pending_key, 3600)
        cache_user_usage(user_id, node_id, created_at, used_traffic, increment=True)
        return True
    except Exception as e:
        logger.warning(f"Failed to cache user usage snapshot: {e}")
        return False


def cache_node_usage_snapshot(node_id: Optional[int], created_at: datetime, uplink: int, downlink: int) -> bool:
    """Cache node usage snapshot (for hourly snapshots used in charts)."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        pending_key = f"{REDIS_KEY_PREFIX_NODE_USAGE_PENDING}{node_id or 'master'}:{created_at.isoformat()}"
        usage_data = {
            'node_id': node_id,
            'created_at': created_at.isoformat(),
            'uplink': uplink,
            'downlink': downlink,
        }
        redis_client.lpush(pending_key, json.dumps(usage_data))
        redis_client.expire(pending_key, 3600)
        cache_node_usage(node_id, created_at, uplink, downlink, increment=True)
        return True
    except Exception as e:
        logger.warning(f"Failed to cache node usage snapshot: {e}")
        return False


def get_user_usages_from_cache(user_ids: List[int], node_id: Optional[int], start: datetime, end: datetime) -> Dict[Tuple[int, datetime], int]:
    """Get multiple user usages from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return {}
    
    try:
        results = {}
        current = start.replace(minute=0, second=0, microsecond=0)
        
        while current <= end:
            for user_id in user_ids:
                key = _get_user_usage_key(user_id, node_id, current)
                value = redis_client.get(key)
                if value:
                    results[(user_id, current)] = int(value)
            current += timedelta(hours=1)
        
        return results
    except Exception as e:
        logger.error(f"Failed to get user usages from cache: {e}")
        return {}


def get_node_usages_from_cache(node_id: Optional[int], start: datetime, end: datetime) -> Dict[datetime, Dict[str, int]]:
    """Get multiple node usages from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return {}
    
    try:
        results = {}
        current = start.replace(minute=0, second=0, microsecond=0)
        
        while current <= end:
            key = _get_node_usage_key(node_id, current)
            value = redis_client.get(key)
            if value:
                results[current] = json.loads(value)
            current += timedelta(hours=1)
        
        return results
    except Exception as e:
        logger.error(f"Failed to get node usages from cache: {e}")
        return {}


def warmup_user_usages(user_id: int) -> Tuple[int, int]:
    """Warm up Redis cache with all usage data for a specific user."""
    redis_client = get_redis()
    if not redis_client:
        return (0, 0)
    
    try:
        from app.db import GetDB
        
        logger.debug(f"Warming up usage cache for user {user_id}...")
        
        cached_count = 0
        total_count = 0
        
        with GetDB() as db:
            usages = db.query(NodeUserUsage).filter(NodeUserUsage.user_id == user_id).all()
            total_count = len(usages)
            
            pipe = redis_client.pipeline()
            batch_size = 100
            batch_count = 0
            
            for usage in usages:
                try:
                    key = _get_user_usage_key(usage.user_id, usage.node_id, usage.created_at)
                    pipe.setex(key, USAGE_CACHE_TTL, str(usage.used_traffic or 0))
                    batch_count += 1
                    
                    if batch_count >= batch_size:
                        try:
                            pipe.execute()
                            cached_count += batch_count
                            batch_count = 0
                            pipe = redis_client.pipeline()
                        except Exception as e:
                            logger.warning(f"Error during batch usage cache warmup: {e}")
                            pipe = redis_client.pipeline()
                            batch_count = 0
                except Exception as e:
                    logger.warning(f"Failed to cache usage for user {user_id}: {e}")
                    continue
            
            if batch_count > 0:
                try:
                    pipe.execute()
                    cached_count += batch_count
                except Exception as e:
                    logger.warning(f"Error during final batch usage cache warmup: {e}")
        
        logger.debug(f"Usage cache warmup for user {user_id} completed: {cached_count}/{total_count} records cached")
        return (total_count, cached_count)
    except Exception as e:
        logger.error(f"Failed to warmup usage cache for user {user_id}: {e}", exc_info=True)
        return (0, 0)


def warmup_all_usages_gradually() -> Tuple[int, int]:
    """Warm up Redis cache with all usage data gradually."""
    redis_client = get_redis()
    if not redis_client:
        return (0, 0)
    
    try:
        from app.db import GetDB
        import time
        
        logger.info("Starting gradual usage cache warmup...")
        
        cached_user_count = 0
        cached_node_count = 0
        total_user_count = 0
        total_node_count = 0
        
        with GetDB() as db:
            # Warm up user_node_usage in batches
            batch_size = 1000
            offset = 0
            
            while True:
                usages = db.query(NodeUserUsage).offset(offset).limit(batch_size).all()
                if not usages:
                    break
                
                total_user_count += len(usages)
                pipe = redis_client.pipeline()
                
                for usage in usages:
                    try:
                        key = _get_user_usage_key(usage.user_id, usage.node_id, usage.created_at)
                        pipe.setex(key, USAGE_CACHE_TTL, str(usage.used_traffic or 0))
                    except Exception as e:
                        logger.warning(f"Failed to cache user usage: {e}")
                        continue
                
                try:
                    pipe.execute()
                    cached_user_count += len(usages)
                except Exception as e:
                    logger.warning(f"Error during user usage batch cache: {e}")
                
                offset += batch_size
                time.sleep(0.1)
            
            # Warm up node_usage in batches
            offset = 0
            while True:
                node_usages = db.query(NodeUsage).offset(offset).limit(batch_size).all()
                if not node_usages:
                    break
                
                total_node_count += len(node_usages)
                pipe = redis_client.pipeline()
                
                for usage in node_usages:
                    try:
                        key = _get_node_usage_key(usage.node_id, usage.created_at)
                        usage_data = {'uplink': usage.uplink or 0, 'downlink': usage.downlink or 0}
                        pipe.setex(key, USAGE_CACHE_TTL, json.dumps(usage_data))
                    except Exception as e:
                        logger.warning(f"Failed to cache node usage: {e}")
                        continue
                
                try:
                    pipe.execute()
                    cached_node_count += len(node_usages)
                except Exception as e:
                    logger.warning(f"Error during node usage batch cache: {e}")
                
                offset += batch_size
                time.sleep(0.1)
        
        total_count = total_user_count + total_node_count
        cached_count = cached_user_count + cached_node_count
        
        logger.info(f"Gradual usage cache warmup completed: {cached_count}/{total_count} records cached")
        return (total_count, cached_count)
    except Exception as e:
        logger.error(f"Failed to warmup usage cache: {e}", exc_info=True)
        return (0, 0)


def get_pending_usage_snapshots(max_items: Optional[int] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Get pending usage snapshots from Redis.
    
    Args:
        max_items: Maximum number of snapshots to retrieve per type (None = all)
    """
    redis_client = get_redis()
    if not redis_client:
        return ([], [])
    
    try:
        user_snapshots = []
        node_snapshots = []
        user_count = 0
        node_count = 0
        
        pattern = f"{REDIS_KEY_PREFIX_USER_USAGE_PENDING}*"
        for key in redis_client.scan_iter(match=pattern, count=1000):
            if max_items and user_count >= max_items:
                break
            while True:
                if max_items and user_count >= max_items:
                    break
                snapshot_json = redis_client.rpop(key)
                if not snapshot_json:
                    break
                try:
                    snapshot = json.loads(snapshot_json)
                    user_snapshots.append(snapshot)
                    user_count += 1
                except json.JSONDecodeError:
                    continue
        
        pattern = f"{REDIS_KEY_PREFIX_NODE_USAGE_PENDING}*"
        for key in redis_client.scan_iter(match=pattern, count=1000):
            if max_items and node_count >= max_items:
                break
            while True:
                if max_items and node_count >= max_items:
                    break
                snapshot_json = redis_client.rpop(key)
                if not snapshot_json:
                    break
                try:
                    snapshot = json.loads(snapshot_json)
                    node_snapshots.append(snapshot)
                    node_count += 1
                except json.JSONDecodeError:
                    continue
        
        return (user_snapshots, node_snapshots)
    except Exception as e:
        logger.error(f"Failed to get pending usage snapshots: {e}")
        return ([], [])


# ============================================================================
# Service, Inbound, and Host Cache Functions
# ============================================================================

def cache_service(service: Any) -> bool:
    """Cache a service in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        service_dict = {
            'id': service.id,
            'name': service.name,
            'description': getattr(service, "description", None),
            'flow': getattr(service, "flow", None),
            'used_traffic': getattr(service, "used_traffic", None),
            'lifetime_used_traffic': getattr(service, "lifetime_used_traffic", None),
            'created_at': service.created_at.isoformat() if hasattr(service, "created_at") and service.created_at else None,
            'updated_at': service.updated_at.isoformat() if hasattr(service, "updated_at") and service.updated_at else None,
        }
        service_json = json.dumps(service_dict)
        redis_client.setex(f"{REDIS_KEY_PREFIX_SERVICE}{service.id}", SERVICE_CACHE_TTL, service_json)
        return True
    except Exception as e:
        logger.error(f"Failed to cache service {service.id}: {e}")
        return False


def get_cached_service(service_id: int) -> Optional[Dict[str, Any]]:
    """Get a service from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        service_json = redis_client.get(f"{REDIS_KEY_PREFIX_SERVICE}{service_id}")
        if service_json:
            return json.loads(service_json)
    except Exception as e:
        logger.error(f"Failed to get cached service {service_id}: {e}")
    return None


def cache_services_list(services: List[Any]) -> bool:
    """Cache list of all services in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        services_list = []
        for service in services:
            service_dict = {
                'id': service.id,
                'name': service.name,
                'description': getattr(service, "description", None),
                'flow': getattr(service, "flow", None),
                'used_traffic': getattr(service, "used_traffic", None),
                'lifetime_used_traffic': getattr(service, "lifetime_used_traffic", None),
            }
            services_list.append(service_dict)
        
        services_json = json.dumps(services_list)
        redis_client.setex(REDIS_KEY_PREFIX_SERVICE_LIST, SERVICE_CACHE_TTL, services_json)
        return True
    except Exception as e:
        logger.error(f"Failed to cache services list: {e}")
        return False


def get_cached_services_list() -> Optional[List[Dict[str, Any]]]:
    """Get list of all services from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        services_json = redis_client.get(REDIS_KEY_PREFIX_SERVICE_LIST)
        if services_json:
            return json.loads(services_json)
    except Exception as e:
        logger.error(f"Failed to get cached services list: {e}")
    return None


def invalidate_service_cache(service_id: Optional[int] = None) -> bool:
    """Invalidate service cache."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        if service_id:
            redis_client.delete(f"{REDIS_KEY_PREFIX_SERVICE}{service_id}")
        else:
            # Invalidate all services
            pattern = f"{REDIS_KEY_PREFIX_SERVICE}*"
            for key in redis_client.scan_iter(match=pattern):
                redis_client.delete(key)
        redis_client.delete(REDIS_KEY_PREFIX_SERVICE_LIST)
        return True
    except Exception as e:
        logger.error(f"Failed to invalidate service cache: {e}")
        return False


def cache_inbounds(inbounds: Dict[str, Any]) -> bool:
    """Cache inbounds configuration in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        inbounds_json = json.dumps(inbounds)
        redis_client.setex(REDIS_KEY_PREFIX_INBOUNDS, INBOUNDS_CACHE_TTL, inbounds_json)
        return True
    except Exception as e:
        logger.error(f"Failed to cache inbounds: {e}")
        return False


def get_cached_inbounds() -> Optional[Dict[str, Any]]:
    """Get inbounds configuration from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        inbounds_json = redis_client.get(REDIS_KEY_PREFIX_INBOUNDS)
        if inbounds_json:
            return json.loads(inbounds_json)
    except Exception as e:
        logger.error(f"Failed to get cached inbounds: {e}")
    return None


def invalidate_inbounds_cache() -> bool:
    """Invalidate inbounds cache."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        redis_client.delete(REDIS_KEY_PREFIX_INBOUNDS)
        return True
    except Exception as e:
        logger.error(f"Failed to invalidate inbounds cache: {e}")
        return False


def cache_service_host_map(service_id: Optional[int], host_map: Dict[str, List[Dict[str, Any]]]) -> bool:
    """Cache service host map in Redis."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        key = f"{REDIS_KEY_PREFIX_SERVICE_HOST_MAP}{service_id if service_id is not None else 'none'}"
        host_map_json = json.dumps(host_map)
        redis_client.setex(key, HOSTS_CACHE_TTL, host_map_json)
        return True
    except Exception as e:
        logger.error(f"Failed to cache service host map for service {service_id}: {e}")
        return False


def get_cached_service_host_map(service_id: Optional[int]) -> Optional[Dict[str, List[Dict[str, Any]]]]:
    """Get service host map from Redis cache."""
    redis_client = get_redis()
    if not redis_client:
        return None
    
    try:
        key = f"{REDIS_KEY_PREFIX_SERVICE_HOST_MAP}{service_id if service_id is not None else 'none'}"
        host_map_json = redis_client.get(key)
        if host_map_json:
            return json.loads(host_map_json)
    except Exception as e:
        logger.error(f"Failed to get cached service host map for service {service_id}: {e}")
    return None


def invalidate_service_host_map_cache() -> bool:
    """Invalidate all service host map caches."""
    redis_client = get_redis()
    if not redis_client:
        return False
    
    try:
        pattern = f"{REDIS_KEY_PREFIX_SERVICE_HOST_MAP}*"
        for key in redis_client.scan_iter(match=pattern):
            redis_client.delete(key)
        return True
    except Exception as e:
        logger.error(f"Failed to invalidate service host map cache: {e}")
        return False


def warmup_services_inbounds_hosts_cache() -> Tuple[int, int, int]:
    """Warm up Redis cache with services, inbounds, and hosts data."""
    redis_client = get_redis()
    if not redis_client:
        logger.info("Redis not available, skipping services/inbounds/hosts cache warmup")
        return (0, 0, 0)
    
    try:
        from app.db import GetDB
        from app.db import crud
        from app.reb_node import state as xray_state
        
        services_count = 0
        inbounds_count = 0
        hosts_count = 0
        
        with GetDB() as db:
            # Cache services
            services = crud.list_services(db, limit=10000)['services']
            for service in services:
                if cache_service(service):
                    services_count += 1
            cache_services_list(services)
            
            # Cache inbounds (from xray config)
            from app.reb_node.config import XRayConfig
            raw_config = crud.get_xray_config(db)
            xray_config = XRayConfig(raw_config, api_port=xray_state.config.api_port)
            inbounds_dict = {
                'inbounds_by_tag': {tag: inbound for tag, inbound in xray_config.inbounds_by_tag.items()},
                'inbounds_by_protocol': {proto: tags for proto, tags in xray_config.inbounds_by_protocol.items()},
            }
            if cache_inbounds(inbounds_dict):
                inbounds_count = len(xray_config.inbounds_by_tag)
            
            # Cache service host maps
            xray_state.rebuild_service_hosts_cache()
            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map and cache_service_host_map(service_id, host_map):
                    hosts_count += len([h for hosts in host_map.values() for h in hosts])
        
        logger.info(f"Warmed up cache: {services_count} services, {inbounds_count} inbounds, {hosts_count} hosts")
        return (services_count, inbounds_count, hosts_count)
    except Exception as e:
        logger.error(f"Failed to warmup services/inbounds/hosts cache: {e}", exc_info=True)
        return (0, 0, 0)
