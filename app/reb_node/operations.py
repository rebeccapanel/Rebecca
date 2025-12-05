from functools import lru_cache
from typing import TYPE_CHECKING, List

import logging
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload, selectinload

from app.reb_node import state
from app.db import GetDB, crud
from app.db.models import User, Service, Proxy
from app.models.node import NodeResponse, NodeStatus
from app.models.user import UserResponse
from app.utils import report
from app.utils.concurrency import threaded_function
from app.reb_node.node import XRayNode
from xray_api import XRay as XRayAPI
from xray_api import exceptions as xray_exceptions
from xray_api.types.account import Account
from app.utils.credentials import runtime_proxy_settings, UUID_PROTOCOLS
from app.models.proxy import ProxyTypes

logger = logging.getLogger("uvicorn.error")

if TYPE_CHECKING:
    from app.db import User as DBUser
    from app.db.models import Node as DBNode


@lru_cache(maxsize=None)
def get_tls():
    from app.db import GetDB, get_tls_certificate
    with GetDB() as db:
        tls = get_tls_certificate(db)
        return {
            "key": tls.key,
            "certificate": tls.certificate
        }


def _is_valid_uuid(uuid_value) -> bool:
    """
    Check if a value is a valid UUID.
    
    Args:
        uuid_value: The value to check (can be UUID object, string, None, etc.)
    
    Returns:
        True if uuid_value is a valid UUID, False otherwise
    """
    if uuid_value is None:
        return False
    
    if isinstance(uuid_value, uuid.UUID):
        return True
    
    if isinstance(uuid_value, str):
        # Check for empty string or "null" string
        if not uuid_value or uuid_value.lower() == "null":
            return False
        try:
            uuid.UUID(uuid_value)
            return True
        except (ValueError, AttributeError):
            return False
    
    return False


def _remove_inbound_user_attempts(api: XRayAPI, inbound_tag: str, email: str):
    for _ in range(2):
        try:
            api.remove_inbound_user(tag=inbound_tag, email=email, timeout=600)
        except (xray_exceptions.EmailNotFoundError, xray_exceptions.ConnectionError):
            break
        except Exception:
            continue


def _build_runtime_accounts(
    dbuser: "DBUser",
    user: UserResponse,
    proxy_type: ProxyTypes,
    settings_model,
    inbound: dict,
) -> List[Account]:
    email = f"{dbuser.id}.{dbuser.username}"
    accounts: List[Account] = []
    try:
        user_flow = getattr(dbuser, "flow", None)
        if user_flow:
            proxy_settings = runtime_proxy_settings(
                settings_model, proxy_type, user.credential_key, flow=user_flow
            )
        else:
            proxy_settings = runtime_proxy_settings(
                settings_model, proxy_type, user.credential_key
            )
    except Exception as exc:
        logger.warning(
            "Failed to build runtime credentials for user %s (%s) and proxy %s: %s",
            dbuser.id,
            dbuser.username,
            proxy_type,
            exc,
        )
        return accounts

    if proxy_type in UUID_PROTOCOLS:
        uuid_value = proxy_settings.get("id")
        if not _is_valid_uuid(uuid_value):
            logger.warning(
                "User %s (%s) has invalid UUID for %s - skipping account injection",
                dbuser.id,
                dbuser.username,
                proxy_type,
            )
            return accounts
        proxy_settings["id"] = str(uuid_value)

    try:
        accounts.append(proxy_type.account_model(email=email, **proxy_settings))
    except Exception as exc:
        logger.warning(
            "Failed to create account model for user %s (%s) and proxy %s: %s",
            dbuser.id,
            dbuser.username,
            proxy_type,
            exc,
        )

    return accounts


def _prepare_user_for_runtime(dbuser: "DBUser") -> "DBUser":
    """
    Ensure proxies/excluded_inbounds are loaded and attached before touching Xray.
    Background tasks may run after the original DB session is closed, so we
    reload the user if needed.
    """
    if dbuser is None:
        return dbuser

    user_id = getattr(dbuser, "id", None)
    try:
        # Try to access all relationships to ensure they're loaded
        _ = getattr(dbuser, "service", None)
        if dbuser.service:
            _ = list(dbuser.service.host_links)  # Ensure host_links are loaded
        _ = list(getattr(dbuser, "usage_logs", []))  # Ensure usage_logs are loaded
        _ = getattr(dbuser, "next_plan", None)  # Ensure next_plan is loaded
        for proxy in getattr(dbuser, "proxies", []) or []:
            _ = list(proxy.excluded_inbounds)
        return dbuser
    except Exception:
        pass

    if user_id is None:
        return dbuser

    try:
        with GetDB() as db:
            from app.db.models import NextPlan
            from app.db.crud.user import _next_plan_table_exists
            query = db.query(User).filter(User.id == user_id)
            # Eager load all relationships needed for UserResponse
            options = [
                joinedload(User.service).joinedload(Service.host_links),  # Load service and its host_links
                joinedload(User.admin),
                selectinload(User.proxies).selectinload(Proxy.excluded_inbounds),
                selectinload(User.usage_logs),  # For lifetime_used_traffic property
            ]
            # Add next_plan if table exists
            if _next_plan_table_exists(db):
                options.append(joinedload(User.next_plan))
            query = query.options(*options)
            fresh = query.first()
            if fresh:
                try:
                    # Ensure all relationships are loaded
                    _ = getattr(fresh, "service", None)
                    if fresh.service:
                        _ = list(fresh.service.host_links)  # Ensure host_links are loaded
                    _ = list(fresh.usage_logs)  # Ensure usage_logs are loaded for lifetime_used_traffic
                    _ = getattr(fresh, "next_plan", None)  # Ensure next_plan is loaded
                    for proxy in getattr(fresh, "proxies", []) or []:
                        _ = list(proxy.excluded_inbounds)
                except Exception:
                    pass
                return fresh
    except Exception as exc:
        logger.warning("Failed to reload user %s for Xray sync: %s", user_id, exc)

    return dbuser


@threaded_function
def _add_account_to_inbound(api: XRayAPI, inbound_tag: str, account: Account):
    """
    Add user account to Xray inbound. If user already exists, remove and re-add to ensure UUID is correct.
    """
    try:
        api.remove_inbound_user(tag=inbound_tag, email=account.email, timeout=600)
    except (xray_exceptions.EmailNotFoundError, xray_exceptions.ConnectionError):
        pass
    except Exception:
        pass  # Ignore other errors when removing
    
    try:
        api.add_inbound_user(tag=inbound_tag, user=account, timeout=600)
    except xray_exceptions.ConnectionError:
        pass
    except Exception as e:
        logger.error(f"Failed to add user {account.email} to {inbound_tag}: {e}")


def _add_accounts_to_inbound(api: XRayAPI, inbound_tag: str, accounts: List[Account]):
    for account in accounts:
        _add_account_to_inbound(api, inbound_tag, account)


@threaded_function
def _remove_user_from_inbound(api: XRayAPI, inbound_tag: str, email: str):
    _remove_inbound_user_attempts(api, inbound_tag, email)


def _alter_inbound_user(api: XRayAPI, inbound_tag: str, accounts: List[Account]):
    """
    Refresh user accounts in Xray inbound by removing existing entries and re-adding all current accounts.
    """
    if not accounts:
        return
    _remove_user_from_inbound(api, inbound_tag, accounts[0].email)
    for account in accounts:
        _add_account_to_inbound(api, inbound_tag, account)


def add_user(dbuser: "DBUser"):
    dbuser = _prepare_user_for_runtime(dbuser)
    if not dbuser:
        return
    user = UserResponse.model_validate(dbuser)

    for proxy_type, inbound_tags in user.inbounds.items():
        for inbound_tag in inbound_tags:
            inbound = state.config.inbounds_by_tag.get(inbound_tag)
            if not inbound:
                from app.db import GetDB, crud
                from app.reb_node.config import XRayConfig
                with GetDB() as db:
                    raw_config = crud.get_xray_config(db)
                state.config = XRayConfig(raw_config, api_port=state.config.api_port)
                inbound = state.config.inbounds_by_tag.get(inbound_tag, {})

            try:
                settings_model = user.proxies[proxy_type]
            except KeyError:
                continue


            accounts = _build_runtime_accounts(dbuser, user, proxy_type, settings_model, inbound)
            if accounts:
                _add_accounts_to_inbound(state.api, inbound_tag, accounts)
                for node in list(state.nodes.values()):
                    if node.connected and node.started:
                        _add_accounts_to_inbound(node.api, inbound_tag, accounts)
            else:
                logger.warning(f"User {dbuser.id} has no UUID and no credential_key for {proxy_type} - skipping")


def remove_user(dbuser: "DBUser"):
    dbuser = _prepare_user_for_runtime(dbuser)
    if not dbuser:
        return
    email = f"{dbuser.id}.{dbuser.username}"

    for inbound_tag in state.config.inbounds_by_tag:
        _remove_user_from_inbound(state.api, inbound_tag, email)
        for node in list(state.nodes.values()):
            if node.connected and node.started:
                _remove_user_from_inbound(node.api, inbound_tag, email)


def update_user(dbuser: "DBUser"):
    dbuser = _prepare_user_for_runtime(dbuser)
    if not dbuser:
        return
    if dbuser.proxies:
        for proxy in dbuser.proxies:
            _ = list(proxy.excluded_inbounds)
    
    user = UserResponse.model_validate(dbuser)
    email = f"{dbuser.id}.{dbuser.username}"
    active_inbounds = []
    
    if user.inbounds:
        for proxy_type, inbound_tags in user.inbounds.items():
            for inbound_tag in inbound_tags:
                if inbound_tag not in active_inbounds:
                    active_inbounds.append(inbound_tag)
    
    for inbound_tag in state.config.inbounds_by_tag:
        _remove_user_from_inbound(state.api, inbound_tag, email)
        for node in list(state.nodes.values()):
            if node.connected and node.started:
                _remove_user_from_inbound(node.api, inbound_tag, email)
    
    if not user.inbounds:
        logger.warning(
            f"User {dbuser.id} ({dbuser.username}) has no inbounds. "
            f"Service: {dbuser.service_id}, Proxies: {[p.type for p in dbuser.proxies]}, "
            f"Excluded inbounds: {[(p.type, [e.tag for e in p.excluded_inbounds]) for p in dbuser.proxies]}"
        )
        return
    
    for proxy_type, inbound_tags in user.inbounds.items():
        for inbound_tag in inbound_tags:
            inbound = state.config.inbounds_by_tag.get(inbound_tag)
            if not inbound:
                from app.db import GetDB, crud
                from app.reb_node.config import XRayConfig
                with GetDB() as db:
                    raw_config = crud.get_xray_config(db)
                state.config = XRayConfig(raw_config, api_port=state.config.api_port)
                inbound = state.config.inbounds_by_tag.get(inbound_tag, {})

            try:
                settings_model = user.proxies[proxy_type]
            except KeyError:
                continue

            accounts = _build_runtime_accounts(dbuser, user, proxy_type, settings_model, inbound)
            if accounts:
                _add_accounts_to_inbound(state.api, inbound_tag, accounts)
                for node in list(state.nodes.values()):
                    if node.connected and node.started:
                        _add_accounts_to_inbound(node.api, inbound_tag, accounts)
            else:
                logger.warning(f"User {dbuser.id} has no UUID and no credential_key for {proxy_type} - skipping")


def remove_node(node_id: int):
    if node_id in state.nodes:
        try:
            state.nodes[node_id].disconnect()
        except Exception:
            pass
        finally:
            try:
                del state.nodes[node_id]
            except KeyError:
                pass


def add_node(dbnode: "DBNode"):
    remove_node(dbnode.id)

    tls = get_tls()
    state.nodes[dbnode.id] = XRayNode(address=dbnode.address,
                                     port=dbnode.port,
                                     api_port=dbnode.api_port,
                                     ssl_key=tls['key'],
                                     ssl_cert=tls['certificate'],
                                     usage_coefficient=dbnode.usage_coefficient)

    return state.nodes[dbnode.id]


def _change_node_status(node_id: int, status: NodeStatus, message: str = None, version: str = None):
    with GetDB() as db:
        try:
            dbnode = crud.get_node_by_id(db, node_id)
            if not dbnode:
                return

            if dbnode.status == NodeStatus.disabled:
                remove_node(dbnode.id)
                return

            previous_status = dbnode.status
            updated_dbnode = crud.update_node_status(db, dbnode, status, message, version)
            report.node_status_change(NodeResponse.model_validate(updated_dbnode), previous_status=previous_status)
        except SQLAlchemyError:
            db.rollback()


global _connecting_nodes
_connecting_nodes = {}


@threaded_function
def connect_node(node_id, config=None):
    global _connecting_nodes

    if _connecting_nodes.get(node_id):
        return

    with GetDB() as db:
        dbnode = crud.get_node_by_id(db, node_id)

    if not dbnode:
        return

    if dbnode.status == NodeStatus.limited:
        logger.info("Skipping connect for limited node %s", dbnode.name)
        return

    try:
        node = state.nodes[dbnode.id]
        assert node.connected
    except (KeyError, AssertionError):
        node = add_node(dbnode)

    try:
        _connecting_nodes[node_id] = True

        _change_node_status(node_id, NodeStatus.connecting)
        logger.info(f"Connecting to \"{dbnode.name}\" node")

        if config is None:
            config = state.config.include_db_users()

        node.start(config)
        version = node.get_version()
        _change_node_status(node_id, NodeStatus.connected, version=version)
        logger.info(f"Connected to \"{dbnode.name}\" node, xray run on v{version}")

    except Exception as e:
        _change_node_status(node_id, NodeStatus.error, message=str(e))
        logger.info(f"Unable to connect to \"{dbnode.name}\" node")

    finally:
        try:
            del _connecting_nodes[node_id]
        except KeyError:
            pass


@threaded_function
def restart_node(node_id, config=None):
    with GetDB() as db:
        dbnode = crud.get_node_by_id(db, node_id)

    if not dbnode:
        return

    if dbnode.status == NodeStatus.limited:
        logger.info("Skipping restart for limited node %s", dbnode.name)
        return

    try:
        node = state.nodes[dbnode.id]
    except KeyError:
        node = add_node(dbnode)

    if not node.connected:
        return connect_node(node_id, config)

    try:
        logger.info(f"Restarting Xray core of \"{dbnode.name}\" node")

        if config is None:
            config = state.config.include_db_users()

        node.restart(config)
        logger.info(f"Xray core of \"{dbnode.name}\" node restarted")

        try:
            version = node.get_version()
        except Exception as version_err:
            logger.warning(
                "Unable to refresh Xray version for node %s after restart: %s",
                dbnode.name,
                version_err,
            )
        else:
            _change_node_status(node_id, NodeStatus.connected, version=version)
    except Exception as e:
        _change_node_status(node_id, NodeStatus.error, message=str(e))
        report.node_error(dbnode.name, str(e))
        logger.info(f"Unable to restart node {node_id}")
        try:
            node.disconnect()
        except Exception:
            pass


__all__ = [
    "add_user",
    "remove_user",
    "add_node",
    "remove_node",
    "connect_node",
    "restart_node",
]



