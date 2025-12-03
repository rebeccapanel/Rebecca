"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
import secrets
from hashlib import sha256
from copy import deepcopy
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from enum import Enum
import uuid
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple, Union, Literal
from types import SimpleNamespace

import sqlalchemy as sa
from sqlalchemy import and_, case, delete, exists, func, or_, inspect, select
from sqlalchemy.exc import DataError, IntegrityError, OperationalError
from sqlalchemy.orm import Query, Session, joinedload, selectinload
from sqlalchemy.sql.functions import coalesce
from app.db.models import (
    JWT,
    TLS,
    Admin,
    AdminServiceLink,
    AdminUsageLogs,
    AdminApiKey,
    NextPlan,
    MasterNodeState,
    Node,
    NodeUsage,
    NodeUserUsage,
    Proxy,
    ProxyHost,
    ProxyInbound,
    ProxyTypes,
    Service,
    ServiceHostLink,
    System,
    User,
    UserTemplate,
    UserUsageResetLogs,
    XrayConfig,
    excluded_inbounds_association,
    template_inbounds_association,
)
from app.models.admin import AdminRole, AdminStatus
from app.models.admin import AdminCreate, AdminModify, AdminPartialModify, ROLE_DEFAULT_PERMISSIONS
from app.utils.xray_defaults import apply_log_paths, load_legacy_xray_config
from app.utils.credentials import (
    generate_key,
    key_to_uuid,
    normalize_key,
    runtime_proxy_settings,
    serialize_proxy_settings,
    uuid_to_key,
    UUID_PROTOCOLS,
    PASSWORD_PROTOCOLS,
)
from app.models.node import GeoMode, NodeCreate, NodeModify, NodeStatus, NodeUsageResponse
from app.models.proxy import ProxyHost as ProxyHostModify, ProxySettings
from xray_api.types.account import XTLSFlows
from app.models.service import ServiceCreate, ServiceHostAssignment, ServiceModify
from app.models.user import (
    UserCreate,
    UserDataLimitResetStrategy,
    UserModify,
    UserResponse,
    UserStatus,
    UserUsageResponse,
)
from app.models.user_template import UserTemplateCreate, UserTemplateModify
from config import (
    SUB_PROFILE_TITLE,
    SUB_SUPPORT_URL,
    USERS_AUTODELETE_DAYS,
    XRAY_SUBSCRIPTION_PATH,
    XRAY_SUBSCRIPTION_URL_PREFIX,
)
# MasterSettingsService not available in current project structure
from app.db.exceptions import UsersLimitReachedError
MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


def get_node(db: Session, name: Optional[str] = None, node_id: Optional[int] = None) -> Optional[Node]:
    """Retrieves a node by its name or ID."""
    query = db.query(Node)
    if node_id is not None:
        return query.filter(Node.id == node_id).first()
    elif name:
        return query.filter(Node.name == name).first()
    return None

def get_node_by_id(db: Session, node_id: int) -> Optional[Node]:
    """Wrapper for backward compatibility."""
    return get_node(db, node_id=node_id)

def _ensure_master_state(db: Session, *, for_update: bool = False) -> MasterNodeState:
    """Retrieve or create the singleton master node state entry."""
    query = db.query(MasterNodeState)
    if for_update:
        query = query.with_for_update()

    state = query.first()
    if state:
        return state

    state = MasterNodeState(status=NodeStatus.connected)
    db.add(state)
    db.flush()
    db.refresh(state)
    return state

def get_master_node_state(db: Session) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=False)
    db.refresh(master_state)
    return master_state

def set_master_data_limit(db: Session, data_limit: Optional[int]) -> MasterNodeState:
    master_state = _ensure_master_state(db, for_update=True)
    normalized_limit = data_limit or None
    master_state.data_limit = normalized_limit

    total_usage = (master_state.uplink or 0) + (master_state.downlink or 0)
    limited = normalized_limit is not None and total_usage >= normalized_limit

    if limited:
        if master_state.status != NodeStatus.limited:
            master_state.status = NodeStatus.limited
            master_state.message = "Data limit reached"
    else:
        if master_state.status == NodeStatus.limited:
            master_state.status = NodeStatus.connected
            master_state.message = None

    master_state.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(master_state)
    return master_state

def get_nodes(db: Session, status: Optional[Union[NodeStatus, list]] = None,
              enabled: bool = None, include_master: bool = False) -> List[Node]:
    """Retrieves nodes based on optional status and enabled filters."""
    query = db.query(Node)

    if status:
        if isinstance(status, list):
            query = query.filter(Node.status.in_(status))
        else:
            query = query.filter(Node.status == status)
    if enabled:
        query = query.filter(Node.status.notin_([NodeStatus.disabled, NodeStatus.limited]))

    return query.all()

def create_node(db: Session, node: NodeCreate) -> Node:
    """Creates a new node in the database."""
    dbnode = Node(name=node.name, address=node.address, port=node.port, api_port=node.api_port,
                  usage_coefficient=node.usage_coefficient if getattr(node, "usage_coefficient", None) else 1,
                  data_limit=node.data_limit if getattr(node, "data_limit", None) is not None else None,
                  geo_mode=node.geo_mode, use_nobetci=bool(getattr(node, "use_nobetci", False)),
                  nobetci_port=getattr(node, "nobetci_port", None) or None)
    db.add(dbnode)
    db.commit()
    db.refresh(dbnode)
    return dbnode

def remove_node(db: Session, dbnode: Node) -> Node:
    """Removes a node from the database."""
    db.query(NodeUsage).filter(NodeUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.query(NodeUserUsage).filter(NodeUserUsage.node_id == dbnode.id).delete(synchronize_session=False)
    db.delete(dbnode)
    db.commit()
    return dbnode

def update_node(db: Session, dbnode: Node, modify: NodeModify) -> Node:
    """Updates an existing node with new information."""
    if modify.name is not None: dbnode.name = modify.name
    if modify.address is not None: dbnode.address = modify.address
    if modify.port is not None: dbnode.port = modify.port
    if modify.api_port is not None: dbnode.api_port = modify.api_port
    if modify.status is not None:
        if modify.status is NodeStatus.disabled:
            dbnode.status, dbnode.xray_version, dbnode.message = modify.status, None, None
        elif modify.status is NodeStatus.limited:
            dbnode.status, dbnode.message = NodeStatus.limited, "Data limit reached"
        else:
            dbnode.status = NodeStatus.connecting
    elif dbnode.status not in {NodeStatus.disabled, NodeStatus.limited}:
        dbnode.status = NodeStatus.connecting
    if modify.usage_coefficient is not None: dbnode.usage_coefficient = modify.usage_coefficient
    data_limit_updated = False
    if modify.data_limit is not None:
        dbnode.data_limit, data_limit_updated = modify.data_limit, True
    if getattr(modify, "use_nobetci", None) is not None:
        dbnode.use_nobetci = bool(modify.use_nobetci)
        if not dbnode.use_nobetci: dbnode.nobetci_port = None
    if getattr(modify, "nobetci_port", None) is not None:
        dbnode.nobetci_port = modify.nobetci_port or None
        if dbnode.nobetci_port and not dbnode.use_nobetci: dbnode.use_nobetci = True
    if data_limit_updated:
        usage_total = (dbnode.uplink or 0) + (dbnode.downlink or 0)
        if dbnode.data_limit is None or usage_total < dbnode.data_limit:
            if modify.status is None and dbnode.status == NodeStatus.limited:
                dbnode.status, dbnode.message = NodeStatus.connecting, None
    db.commit()
    db.refresh(dbnode)
    return dbnode

def update_node_status(db: Session, dbnode: Node, status: NodeStatus, message: str = None, version: str = None) -> Node:
    """Updates the status of a node."""
    dbnode.status, dbnode.message, dbnode.xray_version, dbnode.last_status_change = status, message, version, datetime.now(timezone.utc)
    db.commit()
    db.refresh(dbnode)
    return dbnode

