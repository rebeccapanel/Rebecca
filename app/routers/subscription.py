import re
from packaging.version import Version as LooseVersion
from typing import Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from fastapi.responses import HTMLResponse

from app.db import Session, crud, get_db
from app.dependencies import (
    get_validated_sub,
    get_validated_sub_by_key,
    get_validated_sub_by_key_only,
    validate_dates,
)
from app.models.user import SubscriptionUserResponse, UserResponse
from app.subscription.share import encode_title, generate_subscription, is_credential_key
from app.services.subscription_settings import SubscriptionSettingsService
from app.templates import render_template
from app.utils.proxy_uuid import ensure_user_proxy_uuids

client_config = {
    "clash-meta": {
        "config_format": "clash-meta",
        "media_type": "text/yaml",
        "as_base64": False,
        "reverse": False,
    },
    "sing-box": {
        "config_format": "sing-box",
        "media_type": "application/json",
        "as_base64": False,
        "reverse": False,
    },
    "clash": {
        "config_format": "clash",
        "media_type": "text/yaml",
        "as_base64": False,
        "reverse": False,
    },
    "v2ray": {
        "config_format": "v2ray",
        "media_type": "text/plain",
        "as_base64": True,
        "reverse": False,
    },
    "outline": {
        "config_format": "outline",
        "media_type": "application/json",
        "as_base64": False,
        "reverse": False,
    },
    "v2ray-json": {
        "config_format": "v2ray-json",
        "media_type": "application/json",
        "as_base64": False,
        "reverse": False,
    },
}

router = APIRouter(tags=["Subscription"], prefix="/sub")


def _resolve_support_url(settings) -> str:
    support_url = (getattr(settings, "subscription_support_url", "") or "").strip()
    return support_url


def get_subscription_user_info(user: UserResponse) -> dict:
    """Retrieve user subscription information including upload, download, total data, and expiry."""
    used_traffic = int(getattr(user, "used_traffic", 0) or 0)
    total_limit = getattr(user, "data_limit", None)
    expire_ts = getattr(user, "expire", None)
    return {
        "upload": 0,
        "download": used_traffic,
        "total": total_limit if total_limit is not None else 0,
        "expire": expire_ts if expire_ts is not None else 0,
    }


def _serve_subscription_response(
    request: Request,
    token_identifier: str,
    db: Session,
    dbuser: UserResponse,
    user_agent: str,
):
    ensure_user_proxy_uuids(db, dbuser)
    user: UserResponse = UserResponse.model_validate(dbuser)
    admin = getattr(user, "admin", None)
    if admin is None and getattr(user, "admin_id", None):
        admin = crud.get_admin_by_id(db, user.admin_id)
    settings = SubscriptionSettingsService.get_effective_settings(admin)

    accept_header = request.headers.get("Accept", "")
    if "text/html" in accept_header:
        raw_path = request.url.path
        base_path = raw_path.rstrip("/") if raw_path.endswith("/") else raw_path
        if not base_path:
            base_path = "/"
        usage_url = "/usage" if base_path == "/" else f"{base_path}/usage"
        support_url = _resolve_support_url(settings)
        return HTMLResponse(
            render_template(
                settings.subscription_page_template,
                {
                    "user": user,
                    "usage_url": usage_url,
                    "token": token_identifier,
                    "support_url": support_url,
                },
                custom_directory=settings.custom_templates_directory,
            )
        )

    crud.update_user_sub(db, dbuser, user_agent)
    support_url = _resolve_support_url(settings)
    response_headers = {
        "content-disposition": f'attachment; filename="{user.username}"',
        "profile-web-page-url": str(request.url),
        "support-url": support_url,
        "profile-title": encode_title(settings.subscription_profile_title),
        "profile-update-interval": settings.subscription_update_interval,
        "subscription-userinfo": "; ".join(f"{key}={val}" for key, val in get_subscription_user_info(user).items()),
    }

    if re.match(r"^([Cc]lash-verge|[Cc]lash[-\.]?[Mm]eta|[Ff][Ll][Cc]lash|[Mm]ihomo)", user_agent):
        conf = generate_subscription(
            user=user, config_format="clash-meta", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="text/yaml", headers=response_headers)

    if re.match(r"^([Cc]lash|[Ss]tash)", user_agent):
        conf = generate_subscription(
            user=user, config_format="clash", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="text/yaml", headers=response_headers)

    if re.match(r"^(SFA|SFI|SFM|SFT|[Kk]aring|[Hh]iddify[Nn]ext)", user_agent):
        conf = generate_subscription(
            user=user, config_format="sing-box", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="application/json", headers=response_headers)

    if re.match(r"^(SS|SSR|SSD|SSS|Outline|Shadowsocks|SSconf)", user_agent):
        conf = generate_subscription(
            user=user, config_format="outline", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="application/json", headers=response_headers)

    if (settings.use_custom_json_default or settings.use_custom_json_for_v2rayn) and re.match(
        r"^v2rayN/(\d+\.\d+)", user_agent
    ):
        version_str = re.match(r"^v2rayN/(\d+\.\d+)", user_agent).group(1)
        if LooseVersion(version_str) >= LooseVersion("6.40"):
            conf = generate_subscription(
                user=user, config_format="v2ray-json", as_base64=False, reverse=False, settings=settings
            )
            return Response(content=conf, media_type="application/json", headers=response_headers)
        conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False, settings=settings)
        return Response(content=conf, media_type="text/plain", headers=response_headers)

    if (settings.use_custom_json_default or settings.use_custom_json_for_v2rayng) and re.match(
        r"^v2rayng/(\d+\.\d+)", user_agent, re.IGNORECASE
    ):
        conf = generate_subscription(
            user=user, config_format="v2ray-json", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="application/json", headers=response_headers)

    if (settings.use_custom_json_default or settings.use_custom_json_for_happ) and re.match(
        r"^Happ/(\d+\.\d+\.\d+)", user_agent
    ):
        version_str = re.match(r"^Happ/(\d+\.\d+\.\d+)", user_agent).group(1)
        if LooseVersion(version_str) >= LooseVersion("1.63.1"):
            conf = generate_subscription(
                user=user, config_format="v2ray-json", as_base64=False, reverse=False, settings=settings
            )
            return Response(content=conf, media_type="application/json", headers=response_headers)
        conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False, settings=settings)
        return Response(content=conf, media_type="text/plain", headers=response_headers)

    if (settings.use_custom_json_default or settings.use_custom_json_for_streisand) and re.match(
        r"^Streisand", user_agent
    ):
        conf = generate_subscription(
            user=user, config_format="v2ray-json", as_base64=False, reverse=False, settings=settings
        )
        return Response(content=conf, media_type="application/json", headers=response_headers)

    conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False, settings=settings)
    return Response(content=conf, media_type="text/plain", headers=response_headers)


def _subscription_with_client_type(request: Request, dbuser: UserResponse, client_type: str, db: Session):
    ensure_user_proxy_uuids(db, dbuser)
    user: UserResponse = UserResponse.model_validate(dbuser)
    admin = getattr(user, "admin", None)
    if admin is None and getattr(user, "admin_id", None):
        admin = crud.get_admin_by_id(db, user.admin_id)
    settings = SubscriptionSettingsService.get_effective_settings(admin)
    support_url = _resolve_support_url(settings)
    response_headers = {
        "content-disposition": f'attachment; filename="{user.username}"',
        "profile-web-page-url": str(request.url),
        "support-url": support_url,
        "profile-title": encode_title(settings.subscription_profile_title),
        "profile-update-interval": settings.subscription_update_interval,
        "subscription-userinfo": "; ".join(f"{key}={val}" for key, val in get_subscription_user_info(user).items()),
    }
    config = client_config.get(client_type)
    conf = generate_subscription(
        user=user,
        config_format=config["config_format"],
        as_base64=config["as_base64"],
        reverse=config["reverse"],
        settings=settings,
    )
    return Response(content=conf, media_type=config["media_type"], headers=response_headers)


def _build_usage_payload(
    dbuser: UserResponse,
    start: str,
    end: str,
    db: Session,
):
    try:
        start_dt, end_dt = validate_dates(start, end)
    except HTTPException:
        # bubble FastAPI-friendly errors
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid date range or format") from exc

    try:
        timeline_daily = crud.get_user_usage_timeseries(db, dbuser, start_dt, end_dt, granularity="day")
        daily_usages = [
            {
                "date": entry["timestamp"].date().isoformat(),
                "used_traffic": int(entry["total"] or 0),
            }
            for entry in timeline_daily
        ]

        hourly_usages: List[Dict[str, Union[str, int]]] = []
        if start_dt.date() == end_dt.date():
            timeline_hourly = crud.get_user_usage_timeseries(db, dbuser, start_dt, end_dt, granularity="hour")
            hourly_usages = [
                {
                    "timestamp": entry["timestamp"].isoformat(),
                    "used_traffic": int(entry["total"] or 0),
                }
                for entry in timeline_hourly
            ]

        node_usages = crud.get_user_usage_by_nodes(db, dbuser, start_dt, end_dt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to load usage data") from exc

    return {
        "username": dbuser.username,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "usages": daily_usages,
        "hourly_usages": hourly_usages,
        "node_usages": node_usages,
    }


def _candidate_identifiers(identifier: str) -> list[str]:
    raw = (identifier or "").strip()
    if not raw:
        return []
    out: list[str] = [raw]

    # support legacy packed forms like "username+key" / "username:key"
    for sep in ("+", ":", "|", " "):
        if sep in raw:
            tail = raw.rsplit(sep, 1)[-1].strip()
            if tail and tail not in out:
                out.append(tail)

    return out


def _get_user_by_identifier(identifier: str, db: Session) -> UserResponse:
    """
    Resolve a subscription identifier which may be token, credential key,
    or packed forms like username+key.
    """
    token_error: Optional[HTTPException] = None

    for candidate in _candidate_identifiers(identifier):
        try:
            return get_validated_sub(token=candidate, db=db)
        except HTTPException as exc:
            if exc.status_code not in (400, 404):
                raise
            token_error = exc

        if is_credential_key(candidate):
            try:
                return get_validated_sub_by_key_only(credential_key=candidate, db=db)
            except HTTPException as exc:
                if exc.status_code not in (400, 404):
                    raise
                if token_error is None:
                    token_error = exc

    if token_error:
        raise token_error
    raise HTTPException(status_code=404, detail="Not Found")


@router.get("/{identifier}/")
@router.get("/{identifier}", include_in_schema=False)
def user_subscription(
    request: Request,
    identifier: str,
    db: Session = Depends(get_db),
    user_agent: str = Header(default=""),
):
    """Provides a subscription link based on the identifier (credential key or token)."""
    dbuser = _get_user_by_identifier(identifier, db)
    return _serve_subscription_response(request, identifier, db, dbuser, user_agent)


@router.get("/{identifier}/info", response_model=SubscriptionUserResponse)
def user_subscription_info(
    identifier: str,
    db: Session = Depends(get_db),
):
    """Retrieves detailed information about the user's subscription."""
    dbuser = _get_user_by_identifier(identifier, db)
    return dbuser


@router.get("/{identifier}/usage")
def user_get_usage(
    identifier: str,
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
):
    """Fetches the usage statistics for the user within a specified date range."""
    dbuser = _get_user_by_identifier(identifier, db)
    return _build_usage_payload(dbuser, start, end, db)


@router.get("/{username}/{credential_key}/")
@router.get("/{username}/{credential_key}", include_in_schema=False)
def user_subscription_by_key(
    request: Request,
    username: str,
    credential_key: str = Path(...),
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    user_agent: str = Header(default=""),
):
    """Subscription endpoint that validates credential keys instead of tokens."""
    token_hint = f"{username}/{credential_key}"
    return _serve_subscription_response(request, token_hint, db, dbuser, user_agent)


@router.get("/{username}/{credential_key}/info", response_model=SubscriptionUserResponse)
def user_subscription_info_by_key(
    credential_key: str = Path(...),
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
):
    """Key-based variant of the subscription info endpoint."""
    return dbuser


@router.get("/{username}/{credential_key}/usage")
def user_get_usage_by_key(
    username: str,
    credential_key: str = Path(...),
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
):
    """Key-based variant of the usage endpoint."""
    return _build_usage_payload(dbuser, start, end, db)


def _validate_client_type(client_type: str) -> str:
    if client_type not in client_config:
        raise HTTPException(status_code=404, detail="Unsupported client type")
    return client_type


@router.get("/{username}/{credential_key}/{client_type}")
def user_subscription_with_client_type_by_key(
    request: Request,
    username: str,
    credential_key: str = Path(...),
    client_type: str = Path(...),
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    db: Session = Depends(get_db),
):
    _validate_client_type(client_type)
    return _subscription_with_client_type(request, dbuser, client_type, db)


@router.get("/{identifier}/{client_type}")
def user_subscription_with_client_type(
    request: Request,
    identifier: str,
    client_type: str = Path(...),
    db: Session = Depends(get_db),
):
    dbuser = _get_user_by_identifier(identifier, db)
    _validate_client_type(client_type)
    return _subscription_with_client_type(request, dbuser, client_type, db)
