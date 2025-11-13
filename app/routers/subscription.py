import re
import string
from distutils.version import LooseVersion
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
from app.subscription.share import encode_title, generate_subscription
from app.templates import render_template
from config import (
    SUB_PROFILE_TITLE,
    SUB_SUPPORT_URL,
    SUB_UPDATE_INTERVAL,
    SUBSCRIPTION_PAGE_TEMPLATE,
    USE_CUSTOM_JSON_DEFAULT,
    USE_CUSTOM_JSON_FOR_HAPP,
    USE_CUSTOM_JSON_FOR_V2RAYN,
    XRAY_SUBSCRIPTION_PATH,
)

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

router = APIRouter(tags=["Subscription"], prefix=f"/{XRAY_SUBSCRIPTION_PATH}")


def get_subscription_user_info(user: UserResponse) -> dict:
    """Retrieve user subscription information including upload, download, total data, and expiry."""
    return {
        "upload": 0,
        "download": user.used_traffic,
        "total": user.data_limit if user.data_limit is not None else 0,
        "expire": user.expire if user.expire is not None else 0,
    }


def _serve_subscription_response(
    request: Request,
    token_identifier: str,
    db: Session,
    dbuser: UserResponse,
    user_agent: str,
):
    user: UserResponse = UserResponse.model_validate(dbuser)

    accept_header = request.headers.get("Accept", "")
    if "text/html" in accept_header:
        raw_path = request.url.path
        base_path = raw_path.rstrip("/") if raw_path.endswith("/") else raw_path
        if not base_path:
            base_path = "/"
        usage_url = "/usage" if base_path == "/" else f"{base_path}/usage"
        return HTMLResponse(
            render_template(
                SUBSCRIPTION_PAGE_TEMPLATE,
                {"user": user, "usage_url": usage_url, "token": token_identifier},
            )
        )

    crud.update_user_sub(db, dbuser, user_agent)
    response_headers = {
        "content-disposition": f'attachment; filename="{user.username}"',
        "profile-web-page-url": str(request.url),
        "support-url": SUB_SUPPORT_URL,
        "profile-title": encode_title(SUB_PROFILE_TITLE),
        "profile-update-interval": SUB_UPDATE_INTERVAL,
        "subscription-userinfo": "; ".join(
            f"{key}={val}" for key, val in get_subscription_user_info(user).items()
        ),
    }

    if re.match(r"^([Cc]lash-verge|[Cc]lash[-\.]?[Mm]eta|[Ff][Ll][Cc]lash|[Mm]ihomo)", user_agent):
        conf = generate_subscription(user=user, config_format="clash-meta", as_base64=False, reverse=False)
        return Response(content=conf, media_type="text/yaml", headers=response_headers)

    if re.match(r"^([Cc]lash|[Ss]tash)", user_agent):
        conf = generate_subscription(user=user, config_format="clash", as_base64=False, reverse=False)
        return Response(content=conf, media_type="text/yaml", headers=response_headers)

    if re.match(r"^(SFA|SFI|SFM|SFT|[Kk]aring|[Hh]iddify[Nn]ext)", user_agent):
        conf = generate_subscription(user=user, config_format="sing-box", as_base64=False, reverse=False)
        return Response(content=conf, media_type="application/json", headers=response_headers)

    if re.match(r"^(SS|SSR|SSD|SSS|Outline|Shadowsocks|SSconf)", user_agent):
        conf = generate_subscription(user=user, config_format="outline", as_base64=False, reverse=False)
        return Response(content=conf, media_type="application/json", headers=response_headers)

    if (USE_CUSTOM_JSON_DEFAULT or USE_CUSTOM_JSON_FOR_V2RAYN) and re.match(r"^v2rayN/(\d+\.\d+)", user_agent):
        version_str = re.match(r"^v2rayN/(\d+\.\d+)", user_agent).group(1)
        if LooseVersion(version_str) >= LooseVersion("6.40"):
            conf = generate_subscription(user=user, config_format="v2ray-json", as_base64=False, reverse=False)
            return Response(content=conf, media_type="application/json", headers=response_headers)
        conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False)
        return Response(content=conf, media_type="text/plain", headers=response_headers)

    if (USE_CUSTOM_JSON_DEFAULT or USE_CUSTOM_JSON_FOR_HAPP) and re.match(r"^Happ/(\d+\.\d+\.\d+)", user_agent):
        version_str = re.match(r"^Happ/(\d+\.\d+\.\d+)", user_agent).group(1)
        if LooseVersion(version_str) >= LooseVersion("1.63.1"):
            conf = generate_subscription(user=user, config_format="v2ray-json", as_base64=False, reverse=False)
            return Response(content=conf, media_type="application/json", headers=response_headers)
        conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False)
        return Response(content=conf, media_type="text/plain", headers=response_headers)

    conf = generate_subscription(user=user, config_format="v2ray", as_base64=True, reverse=False)
    return Response(content=conf, media_type="text/plain", headers=response_headers)


def _subscription_with_client_type(request: Request, dbuser: UserResponse, client_type: str):
    user: UserResponse = UserResponse.model_validate(dbuser)
    response_headers = {
        "content-disposition": f'attachment; filename="{user.username}"',
        "profile-web-page-url": str(request.url),
        "support-url": SUB_SUPPORT_URL,
        "profile-title": encode_title(SUB_PROFILE_TITLE),
        "profile-update-interval": SUB_UPDATE_INTERVAL,
        "subscription-userinfo": "; ".join(
            f"{key}={val}" for key, val in get_subscription_user_info(user).items()
        ),
    }
    config = client_config.get(client_type)
    conf = generate_subscription(
        user=user,
        config_format=config["config_format"],
        as_base64=config["as_base64"],
        reverse=config["reverse"],
    )
    return Response(content=conf, media_type=config["media_type"], headers=response_headers)


def _build_usage_payload(
    dbuser: UserResponse,
    start: str,
    end: str,
    db: Session,
):
    start_dt, end_dt = validate_dates(start, end)
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

    return {
        "username": dbuser.username,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "usages": daily_usages,
        "hourly_usages": hourly_usages,
        "node_usages": node_usages,
    }


def _get_user_by_identifier(identifier: str, db: Session) -> UserResponse:
    """
    Resolve a subscription identifier which may be either a token or a credential key.
    We prefer token validation first because legacy tokens can look like hex keys too.
    """
    token_error: Optional[HTTPException] = None
    try:
        return get_validated_sub(token=identifier, db=db)
    except HTTPException as exc:
        if exc.status_code not in (400, 404):
            raise
        token_error = exc

    looks_like_key = len(identifier) == 32 and all(ch in string.hexdigits for ch in identifier)
    if looks_like_key:
        try:
            return get_validated_sub_by_key_only(credential_key=identifier, db=db)
        except HTTPException as exc:
            if exc.status_code not in (400, 404):
                raise
            if token_error is None:
                token_error = exc

    if token_error:
        raise token_error
    raise HTTPException(status_code=404, detail="Not Found")


@router.get("/{username}/{credential_key}/")
@router.get("/{username}/{credential_key}", include_in_schema=False)
def user_subscription_by_key(
    request: Request,
    username: str,
    credential_key: str,
    db: Session = Depends(get_db),
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    user_agent: str = Header(default=""),
):
    """Subscription endpoint that validates credential keys instead of tokens."""
    token_hint = f"{username}/{credential_key}"
    return _serve_subscription_response(request, token_hint, db, dbuser, user_agent)


@router.get("/{username}/{credential_key}/info", response_model=SubscriptionUserResponse)
def user_subscription_info_by_key(
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
):
    """Key-based variant of the subscription info endpoint."""
    return dbuser


@router.get("/{username}/{credential_key}/usage")
def user_get_usage_by_key(
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
):
    """Key-based variant of the usage endpoint."""
    return _build_usage_payload(dbuser, start, end, db)


@router.get("/{username}/{credential_key}/{client_type}")
def user_subscription_with_client_type_by_key(
    request: Request,
    dbuser: UserResponse = Depends(get_validated_sub_by_key),
    client_type: str = Path(..., regex="sing-box|clash-meta|clash|outline|v2ray|v2ray-json"),
):
    """Key-based variant for client specific subscription links."""
    return _subscription_with_client_type(request, dbuser, client_type)


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


@router.get("/{identifier}/{client_type}")
def user_subscription_with_client_type(
    request: Request,
    identifier: str,
    db: Session = Depends(get_db),
    client_type: str = Path(..., regex="sing-box|clash-meta|clash|outline|v2ray|v2ray-json"),
):
    """Provides a subscription link based on the specified client type (e.g., Clash, V2Ray)."""
    dbuser = _get_user_by_identifier(identifier, db)
    return _subscription_with_client_type(request, dbuser, client_type)
