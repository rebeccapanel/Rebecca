from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db import crud
from app.db.models import Node as DBNode
from app.models.node import XrayConfigMode
from app.reb_node.config import XRayConfig
from app.utils.xray_defaults import apply_log_paths


MASTER_TARGET_ID = "master"
NODE_TARGET_PREFIX = "node:"


def node_target_id(node_id: int) -> str:
    return f"{NODE_TARGET_PREFIX}{int(node_id)}"


def parse_target_id(target_id: str | None) -> tuple[str, int | None]:
    target = (target_id or MASTER_TARGET_ID).strip()
    if target == MASTER_TARGET_ID:
        return MASTER_TARGET_ID, None
    if target.startswith(NODE_TARGET_PREFIX):
        raw_id = target[len(NODE_TARGET_PREFIX) :]
        try:
            return NODE_TARGET_PREFIX.rstrip(":"), int(raw_id)
        except (TypeError, ValueError):
            pass
    raise HTTPException(status_code=400, detail="Invalid Xray config target")


def normalize_config_payload(payload: dict | None) -> dict:
    return apply_log_paths(deepcopy(payload or {}))


def node_config_mode(dbnode: DBNode) -> XrayConfigMode:
    value = getattr(dbnode, "xray_config_mode", XrayConfigMode.default)
    try:
        return XrayConfigMode(value)
    except ValueError:
        return XrayConfigMode.default


def node_uses_custom_config(dbnode: DBNode) -> bool:
    return node_config_mode(dbnode) == XrayConfigMode.custom


def get_node_effective_raw_config(
    dbnode: DBNode,
    master_config: dict | None = None,
) -> dict:
    if node_uses_custom_config(dbnode) and isinstance(getattr(dbnode, "xray_config", None), dict):
        return normalize_config_payload(dbnode.xray_config)
    return normalize_config_payload(master_config or {})


def get_node_runtime_config(
    db: Session,
    dbnode: DBNode,
    *,
    api_port: int,
    master_config: dict | None = None,
) -> XRayConfig:
    master = master_config if master_config is not None else crud.get_xray_config(db)
    return XRayConfig(get_node_effective_raw_config(dbnode, master), api_port=api_port)


def get_target_raw_config(db: Session, target_id: str | None = None) -> dict:
    kind, node_id = parse_target_id(target_id)
    master_config = crud.get_xray_config(db)
    if kind == MASTER_TARGET_ID:
        return normalize_config_payload(master_config)

    dbnode = crud.get_node_by_id(db, node_id)
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")
    return get_node_effective_raw_config(dbnode, master_config)


def get_target_runtime_config(db: Session, target_id: str | None, *, api_port: int) -> XRayConfig:
    return XRayConfig(get_target_raw_config(db, target_id), api_port=api_port)


def _ensure_node_custom_config(dbnode: DBNode, master_config: dict) -> None:
    if not node_uses_custom_config(dbnode) or not isinstance(getattr(dbnode, "xray_config", None), dict):
        dbnode.xray_config = normalize_config_payload(master_config)
    dbnode.xray_config_mode = XrayConfigMode.custom


def save_target_raw_config(db: Session, target_id: str | None, payload: dict) -> dict:
    kind, node_id = parse_target_id(target_id)
    normalized = normalize_config_payload(payload)
    if kind == MASTER_TARGET_ID:
        return crud.save_xray_config(db, normalized)

    dbnode = crud.get_node_by_id(db, node_id)
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")

    dbnode.xray_config_mode = XrayConfigMode.custom
    dbnode.xray_config = normalized
    db.add(dbnode)
    db.commit()
    db.refresh(dbnode)
    return normalize_config_payload(dbnode.xray_config)


def set_node_xray_config_mode(db: Session, node_id: int, mode: XrayConfigMode) -> DBNode:
    dbnode = crud.get_node_by_id(db, node_id)
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")

    if mode == XrayConfigMode.custom:
        _ensure_node_custom_config(dbnode, crud.get_xray_config(db))
    else:
        dbnode.xray_config_mode = XrayConfigMode.default
        dbnode.xray_config = None

    db.add(dbnode)
    db.commit()
    db.refresh(dbnode)
    return dbnode


def ensure_target_configs_for_mutation(db: Session, target_ids: Iterable[str]) -> dict[str, dict]:
    master_config = crud.get_xray_config(db)
    configs: dict[str, dict] = {}
    for target_id in target_ids:
        kind, node_id = parse_target_id(target_id)
        if kind == MASTER_TARGET_ID:
            configs[MASTER_TARGET_ID] = normalize_config_payload(master_config)
            continue

        dbnode = crud.get_node_by_id(db, node_id)
        if not dbnode:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        _ensure_node_custom_config(dbnode, master_config)
        configs[node_target_id(node_id)] = normalize_config_payload(dbnode.xray_config)
    return configs


def persist_mutated_target_configs(db: Session, configs: dict[str, dict]) -> None:
    for target_id, config in configs.items():
        kind, node_id = parse_target_id(target_id)
        if kind == MASTER_TARGET_ID:
            crud.save_xray_config(db, config)
            continue

        dbnode = crud.get_node_by_id(db, node_id)
        if not dbnode:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        dbnode.xray_config_mode = XrayConfigMode.custom
        dbnode.xray_config = normalize_config_payload(config)
        db.add(dbnode)
    db.commit()


def list_config_targets(db: Session) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = [
        {
            "id": MASTER_TARGET_ID,
            "type": "master",
            "name": "Master",
            "node_id": None,
            "mode": "custom",
        }
    ]
    for node in crud.get_nodes(db):
        targets.append(
            {
                "id": node_target_id(node.id),
                "type": "node",
                "name": node.name,
                "node_id": node.id,
                "mode": node_config_mode(node).value,
                "status": getattr(getattr(node, "status", None), "value", getattr(node, "status", None)),
            }
        )
    return targets


def iter_stored_raw_configs(db: Session) -> list[tuple[str, dict]]:
    configs: list[tuple[str, dict]] = [(MASTER_TARGET_ID, crud.get_xray_config(db))]
    for node in crud.get_nodes(db):
        if node_uses_custom_config(node) and isinstance(getattr(node, "xray_config", None), dict):
            configs.append((node_target_id(node.id), node.xray_config))
    return [(target_id, normalize_config_payload(config)) for target_id, config in configs]


def collect_all_inbound_tags(db: Session) -> set[str]:
    tags: set[str] = set()
    for _, config in iter_stored_raw_configs(db):
        for inbound in config.get("inbounds") or []:
            if isinstance(inbound, dict) and inbound.get("tag"):
                tags.add(str(inbound["tag"]))
    return tags


def collect_all_manageable_inbounds(db: Session, is_manageable) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for _, config in iter_stored_raw_configs(db):
        for inbound in config.get("inbounds") or []:
            if isinstance(inbound, dict) and is_manageable(inbound):
                result.setdefault(str(inbound["tag"]), deepcopy(inbound))
    return result
