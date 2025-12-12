"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional, Union

from sqlalchemy.orm import Session
from app.db.models import (
    MasterNodeState,
    Node,
    NodeUsage,
    NodeUserUsage,
)
from app.models.node import NodeCreate, NodeModify, NodeStatus

# MasterSettingsService not available in current project structure
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


def get_nodes(
    db: Session, status: Optional[Union[NodeStatus, list]] = None, enabled: bool = None, include_master: bool = False
) -> List[Node]:
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
    from app.utils.crypto import generate_certificate, generate_unique_cn

    dbnode = Node(
        name=node.name,
        address=node.address,
        port=node.port,
        api_port=node.api_port,
        usage_coefficient=node.usage_coefficient if getattr(node, "usage_coefficient", None) else 1,
        data_limit=node.data_limit if getattr(node, "data_limit", None) is not None else None,
        geo_mode=node.geo_mode,
        use_nobetci=bool(getattr(node, "use_nobetci", False)),
        nobetci_port=getattr(node, "nobetci_port", None) or None,
    )
    db.add(dbnode)
    db.flush()

    # Use provided certificate when available (from fresh node-settings), otherwise generate a unique one
    provided_cert = getattr(node, "certificate", None)
    provided_key = getattr(node, "certificate_key", None)
    if provided_cert and provided_key:
        dbnode.certificate = provided_cert
        dbnode.certificate_key = provided_key
    else:
        unique_cn = generate_unique_cn(node_id=dbnode.id, node_name=node.name)
        cert_data = generate_certificate(cn=unique_cn)
        dbnode.certificate = cert_data["cert"]
        dbnode.certificate_key = cert_data["key"]

    db.commit()
    db.refresh(dbnode)
    return dbnode


def regenerate_node_certificate(db: Session, dbnode: Node) -> Node:
    """
    Generate and persist a new unique certificate for an existing node.
    """
    from app.utils.crypto import generate_certificate, generate_unique_cn

    unique_cn = generate_unique_cn(node_id=dbnode.id, node_name=dbnode.name)
    cert_data = generate_certificate(cn=unique_cn)
    dbnode.certificate = cert_data["cert"]
    dbnode.certificate_key = cert_data["key"]
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
    if modify.name is not None:
        dbnode.name = modify.name
    if modify.address is not None:
        dbnode.address = modify.address
    if modify.port is not None:
        dbnode.port = modify.port
    if modify.api_port is not None:
        dbnode.api_port = modify.api_port
    if modify.status is not None:
        if modify.status is NodeStatus.disabled:
            dbnode.status, dbnode.xray_version, dbnode.message = modify.status, None, None
        elif modify.status is NodeStatus.limited:
            dbnode.status, dbnode.message = NodeStatus.limited, "Data limit reached"
        else:
            dbnode.status = NodeStatus.connecting
    elif dbnode.status not in {NodeStatus.disabled, NodeStatus.limited}:
        dbnode.status = NodeStatus.connecting
    if modify.usage_coefficient is not None:
        dbnode.usage_coefficient = modify.usage_coefficient
    data_limit_updated = False
    if modify.data_limit is not None:
        dbnode.data_limit, data_limit_updated = modify.data_limit, True
    if getattr(modify, "use_nobetci", None) is not None:
        dbnode.use_nobetci = bool(modify.use_nobetci)
        if not dbnode.use_nobetci:
            dbnode.nobetci_port = None
    if getattr(modify, "nobetci_port", None) is not None:
        dbnode.nobetci_port = modify.nobetci_port or None
        if dbnode.nobetci_port and not dbnode.use_nobetci:
            dbnode.use_nobetci = True
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
    dbnode.status, dbnode.message, dbnode.xray_version, dbnode.last_status_change = (
        status,
        message,
        version,
        datetime.now(timezone.utc),
    )
    db.commit()
    db.refresh(dbnode)
    return dbnode
