import json
from typing import Optional

import requests
from fastapi import HTTPException

from config import MAINTENANCE_API_BASE_URL


def _format_base_url(base_url: Optional[str]) -> str:
    base = (base_url or MAINTENANCE_API_BASE_URL).strip()
    if base.endswith("/"):
        base = base[:-1]
    return base


def maintenance_request(
    method: str,
    path: str,
    *,
    base_url: Optional[str] = None,
    timeout: int = 900,
    stream: bool = False,
    **kwargs,
) -> requests.Response:
    url = _format_base_url(base_url) + (path if path.startswith("/") else f"/{path}")
    try:
        response = requests.request(
            method=method.upper(),
            url=url,
            timeout=timeout,
            stream=stream,
            **kwargs,
        )
    except requests.RequestException as exc:  # pragma: no cover - network failure
        raise HTTPException(status_code=502, detail=f"Maintenance service unavailable: {exc}") from exc

    if response.status_code >= 400:
        detail = _extract_detail(response)
        raise HTTPException(status_code=response.status_code, detail=detail)

    return response


def _extract_detail(response: requests.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            detail = data.get("detail")
            if isinstance(detail, (str, list, dict)):
                return json.dumps(detail) if isinstance(detail, (list, dict)) else detail
        return json.dumps(data)
    except Exception:
        return response.text or "Maintenance service error"
