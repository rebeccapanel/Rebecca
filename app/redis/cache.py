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
from app.db.models import User, NodeUserUsage, NodeUsage
from app.models.user import UserStatus, UserDataLimitResetStrategy

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

# TTLs
USER_CACHE_TTL = 86400  # 24 hours
USAGE_CACHE_TTL = 604800  # 7 days

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
    """Deserialize user dictionary from Redis to User object."""
    if not user_dict:
        return None
    
    try:
        from app.db.models import Admin as AdminModel, Service as ServiceModel, NextPlan as NextPlanModel, Proxy as ProxyModel, ProxyInbound as InboundModel
        user = User()
        user.id = user_dict.get('id')
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
        
        # Handle relationships
        if user_dict.get('admin_id') and db:
            user.admin = db.query(AdminModel).filter(AdminModel.id == user_dict['admin_id']).first()
        if user_dict.get('service_id') and db:
            user.service = db.query(ServiceModel).filter(ServiceModel.id == user_dict['service_id']).first()
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
    
    # Fallback to DB if not found in cache
    if db:
        from app.db.crud import get_user
        db_user = get_user(db, username=username, user_id=user_id)
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
        for key in redis_client.scan_iter(match=pattern, count=1000):
            user_id_keys.append(key)
        
        if not user_id_keys:
            if db:
                logger.info("No users found in Redis cache, loading from database")
                from app.db.crud import get_user_queryset
                db_users = get_user_queryset(db, eager_load=True).all()
                for db_user in db_users:
                    cache_user(db_user)
                return db_users
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
            from app.db.crud import get_user_queryset
            db_users = get_user_queryset(db, eager_load=True).all()
            for db_user in db_users:
                cache_user(db_user)
            return db_users
        
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


def get_pending_usage_updates() -> List[Dict[str, Any]]:
    """Get all pending usage updates from Redis."""
    redis_client = get_redis()
    if not redis_client:
        return []
    
    try:
        updates = []
        pattern = "user:usage:*"
        for key in redis_client.scan_iter(match=pattern):
            while True:
                update_json = redis_client.rpop(key)
                if not update_json:
                    break
                try:
                    update_data = json.loads(update_json)
                    updates.append(update_data)
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
        key = _get_user_usage_key(user_id, node_id, created_at)
        if increment:
            redis_client.incrby(key, used_traffic)
        else:
            redis_client.setex(key, USAGE_CACHE_TTL, str(used_traffic))
        return True
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


def get_pending_usage_snapshots() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Get all pending usage snapshots from Redis."""
    redis_client = get_redis()
    if not redis_client:
        return ([], [])
    
    try:
        user_snapshots = []
        node_snapshots = []
        
        pattern = f"{REDIS_KEY_PREFIX_USER_USAGE_PENDING}*"
        for key in redis_client.scan_iter(match=pattern):
            while True:
                snapshot_json = redis_client.rpop(key)
                if not snapshot_json:
                    break
                try:
                    snapshot = json.loads(snapshot_json)
                    user_snapshots.append(snapshot)
                except json.JSONDecodeError:
                    continue
        
        pattern = f"{REDIS_KEY_PREFIX_NODE_USAGE_PENDING}*"
        for key in redis_client.scan_iter(match=pattern):
            while True:
                snapshot_json = redis_client.rpop(key)
                if not snapshot_json:
                    break
                try:
                    snapshot = json.loads(snapshot_json)
                    node_snapshots.append(snapshot)
                except json.JSONDecodeError:
                    continue
        
        return (user_snapshots, node_snapshots)
    except Exception as e:
        logger.error(f"Failed to get pending usage snapshots: {e}")
        return ([], [])

