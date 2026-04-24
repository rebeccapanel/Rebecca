import re
from urllib.parse import parse_qs, urlsplit
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.db import Session, get_db
from app.dependencies import get_validated_sub_by_key
from app.models.user import UserResponse
from app.routers.subscription import (
    _build_usage_payload,
    _get_user_by_identifier,
    _serve_subscription_response,
    _subscription_with_client_type,
    _validate_client_type,
    client_config,
)
from app.services.subscription_settings import SubscriptionSettingsService

router = APIRouter(tags=["Subscription"])


def _resolve_identifier(token: Optional[str], key: Optional[str], identifier: Optional[str]) -> str:
    resolved = token or key or identifier
    if not resolved:
        raise HTTPException(status_code=400, detail="Provide token, key, or identifier")
    return resolved


def _match_path_alias(alias: str, path: str) -> Optional[str]:
    # supports both templated and plain aliases:
    # /mypath/{identifier}  OR  /mypath/
    parsed = urlsplit(alias)
    alias_path = parsed.path.strip()
    if not alias_path:
        return None

    if "{" in alias_path:
        regex = re.escape(alias_path)
        regex = regex.replace(re.escape("{identifier}"), r"(?P<identifier>[^/]+)")
        regex = regex.replace(re.escape("{token}"), r"(?P<identifier>[^/]+)")
        regex = regex.replace(re.escape("{key}"), r"(?P<identifier>[^/]+)")
        match = re.match(rf"^{regex}/?$", path)
        if not match:
            return None
        return match.groupdict().get("identifier")

    # plain form: /mypath/ => capture first segment after prefix
    prefix = alias_path if alias_path.endswith("/") else f"{alias_path}/"
    if not path.startswith(prefix):
        return None
    tail = path[len(prefix):].strip("/")
    if not tail:
        return None
    return tail.split("/", 1)[0]


def _match_query_alias(alias: str, request: Request) -> Optional[str]:
    # supports /api/v1/client/subscribe?token={identifier}
    # also supports wildcard forms like /api/v1/client/subscribe?token=
    parsed = urlsplit(alias)
    if not parsed.query:
        return None
    if request.url.path.rstrip("/") != parsed.path.rstrip("/"):
        return None

    template_qs = parse_qs(parsed.query, keep_blank_values=True)
    req_qs = dict(request.query_params)

    for key, values in template_qs.items():
        expected = values[0] if values else ""
        actual = req_qs.get(key)

        if expected in {"{identifier}", "{token}", "{key}"}:
            if actual:
                return actual
            return None

        # blank value in template means "accept any value"
        if expected == "":
            if actual:
                return actual
            return None

        if actual != expected:
            return None

    # fallback if template matched fixed params and identifier param exists
    for k in ("token", "key", "identifier"):
        if req_qs.get(k):
            return req_qs[k]
    return None


def _resolve_prefixed_route(path: str, prefix: str) -> Optional[dict]:
    if not path.startswith(prefix):
        return None

    tail = path[len(prefix):].strip("/")
    if not tail:
        return None

    segments = [segment for segment in tail.split("/") if segment]
    if not segments:
        return None

    if len(segments) == 1:
        return {"kind": "identifier", "identifier": segments[0]}

    if len(segments) == 2:
        identifier, suffix = segments
        if suffix == "info":
            return {"kind": "identifier-info", "identifier": identifier}
        if suffix == "usage":
            return {"kind": "identifier-usage", "identifier": identifier}
        if suffix in client_config:
            return {"kind": "identifier-client", "identifier": identifier, "client_type": suffix}
        return {"kind": "key", "username": identifier, "credential_key": suffix}

    if len(segments) == 3:
        username, credential_key, suffix = segments
        if suffix == "info":
            return {"kind": "key-info", "username": username, "credential_key": credential_key}
        if suffix == "usage":
            return {"kind": "key-usage", "username": username, "credential_key": credential_key}
        if suffix in client_config:
            return {
                "kind": "key-client",
                "username": username,
                "credential_key": credential_key,
                "client_type": suffix,
            }
    return None


def _resolve_alias_route(request: Request, aliases: list[str], primary_path: str) -> Optional[dict]:
    path = request.url.path

    # Always support /sub/... as stable default fallback and mirror the configured primary path.
    for fixed_prefix in ("/sub/", f"/{(primary_path or 'sub').strip('/')}/"):
        resolved = _resolve_prefixed_route(path, fixed_prefix)
        if resolved:
            return resolved

    for alias in aliases:
        alias = (alias or "").strip()
        if not alias:
            continue
        identifier = _match_query_alias(alias, request)
        if identifier:
            return {"kind": "identifier", "identifier": identifier}
        identifier = _match_path_alias(alias, path)
        if identifier:
            return {"kind": "identifier", "identifier": identifier}
    return None


@router.get("/api/v1/client/subscribe")
def subscribe_query_style(
    request: Request,
    token: Optional[str] = Query(default=None),
    key: Optional[str] = Query(default=None),
    identifier: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user_agent: str = Header(default=""),
):
    resolved = _resolve_identifier(token, key, identifier)
    dbuser: UserResponse = _get_user_by_identifier(resolved, db)
    return _serve_subscription_response(request, resolved, db, dbuser, user_agent)


@router.get("/api/v1/client/subscribe/{identifier}")
def subscribe_path_style(
    request: Request,
    identifier: str,
    db: Session = Depends(get_db),
    user_agent: str = Header(default=""),
):
    dbuser: UserResponse = _get_user_by_identifier(identifier, db)
    return _serve_subscription_response(request, identifier, db, dbuser, user_agent)


@router.get("/{alias_path:path}", include_in_schema=False)
def subscribe_custom_alias(
    request: Request,
    alias_path: str,
    start: str = Query(default=""),
    end: str = Query(default=""),
    db: Session = Depends(get_db),
    user_agent: str = Header(default=""),
):
    settings = SubscriptionSettingsService.get_settings(ensure_record=True, db=db)
    aliases = settings.subscription_aliases or []
    route = _resolve_alias_route(request, aliases, settings.subscription_path)
    if not route:
        raise HTTPException(status_code=404, detail="Not Found")

    kind = route["kind"]
    if kind.startswith("identifier"):
        identifier = route["identifier"]
        dbuser: UserResponse = _get_user_by_identifier(identifier, db)
        if kind == "identifier":
            return _serve_subscription_response(request, identifier, db, dbuser, user_agent)
        if kind == "identifier-info":
            return dbuser
        if kind == "identifier-usage":
            return _build_usage_payload(dbuser, start, end, db)
        if kind == "identifier-client":
            client_type = _validate_client_type(route["client_type"])
            return _subscription_with_client_type(request, dbuser, client_type, db)

    if kind.startswith("key"):
        username = route["username"]
        credential_key = route["credential_key"]
        dbuser = get_validated_sub_by_key(username=username, credential_key=credential_key, db=db)
        token_hint = f"{username}/{credential_key}"
        if kind == "key":
            return _serve_subscription_response(request, token_hint, db, dbuser, user_agent)
        if kind == "key-info":
            return dbuser
        if kind == "key-usage":
            return _build_usage_payload(dbuser, start, end, db)
        if kind == "key-client":
            client_type = _validate_client_type(route["client_type"])
            return _subscription_with_client_type(request, dbuser, client_type, db)

    raise HTTPException(status_code=404, detail="Not Found")
