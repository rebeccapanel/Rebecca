import sqlalchemy
from app import xray
from app.db import get_users, get_db, engine, User
from app.models.user import UserResponse, UserStatus
from app.xray import INBOUND_TAGS
from app.utils.credentials import runtime_proxy_settings, UUID_PROTOCOLS
from app.runtime import logger


def _add_user_accounts_to_api(dbuser):
    user = UserResponse.from_orm(dbuser)
    email = f"{dbuser.id}.{dbuser.username}"
    for proxy_type, inbound_tags in user.inbounds.items():
        for inbound_tag in inbound_tags:
            # proxy_type could be Enum or string key
            try:
                settings_model = user.proxies.get(proxy_type) or user.proxies.get(getattr(proxy_type, 'value', proxy_type))
            except Exception:
                continue

            # build account similar to other operations
            existing_id = getattr(settings_model, 'id', None)
            # ensure proxy_type is an enum
            from app.models.proxy import ProxyTypes as _ProxyTypes
            resolved_proxy_type = proxy_type if isinstance(proxy_type, _ProxyTypes) else _ProxyTypes(proxy_type)
            account_to_add = None

            if existing_id and resolved_proxy_type in UUID_PROTOCOLS:
                account_to_add = resolved_proxy_type.account_model(email=email, id=str(existing_id))
            elif user.credential_key and resolved_proxy_type in UUID_PROTOCOLS:
                try:
                    proxy_settings = runtime_proxy_settings(settings_model, resolved_proxy_type, user.credential_key)
                    proxy_settings.pop('flow', None)
                    account_to_add = resolved_proxy_type.account_model(email=email, **proxy_settings)
                except Exception:
                    account_to_add = None

            if account_to_add:
                try:
                    xray.api.add_inbound_user(inbound_tag, account_to_add)
                except xray.exc.EmailExistsError:
                    pass
                except xray.exc.ConnectionError as e:
                    logger.warning("Could not add user %s to inbound %s - xray API connection error: %s", email, inbound_tag, e.details)
                    # don't raise to avoid breaking import time execution
                    continue


if sqlalchemy.inspect(engine).has_table(User.__tablename__):
    if not getattr(xray, 'core', None) or not getattr(xray.core, 'started', False):
        # Core not started yet, users will be loaded via config generation during startup
        pass
    else:
        for db in get_db():
            for dbuser in get_users(db, status=UserStatus.active):
                try:
                    _add_user_accounts_to_api(dbuser)
                except xray.exc.ConnectionError:
                    # If nodes or XRay core are not reachable at startup, just warn and continue
                    logger.warning("Xray API not available at startup. Add user to inbounds will be retried by runtime processes when available.")
                    break
