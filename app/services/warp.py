from __future__ import annotations

import socket
from datetime import datetime, UTC
from typing import Optional, Tuple

import requests
from sqlalchemy.orm import Session

from app.db.models import WarpAccount

API_BASE = "https://api.cloudflareclient.com/v0a2158"
CLIENT_VERSION = "a-7.21-0721"
REQUEST_TIMEOUT = 30


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class WarpServiceError(RuntimeError):
    """Raised when Cloudflare WARP API returns an unexpected response."""


class WarpAccountNotFound(WarpServiceError):
    """Raised when an operation requires an existing account but none is stored."""


class WarpService:
    def __init__(self, db: Session):
        self.db = db

    def get_account(self) -> Optional[WarpAccount]:
        return self.db.query(WarpAccount).order_by(WarpAccount.id.asc()).first()

    def register(self, private_key: str, public_key: str) -> Tuple[WarpAccount, dict]:
        if not private_key or not public_key:
            raise WarpServiceError("Both private and public keys are required for registration.")

        payload = {
            "key": public_key,
            "tos": utcnow_naive().strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "type": "PC",
            "model": "rebeca-panel",
            "name": socket.gethostname() or "rebeca-panel",
        }

        response = self._request("POST", "/reg", json=payload)
        device_id = response.get("id")
        access_token = response.get("token")
        account_info = response.get("account") or {}
        license_key = account_info.get("license")
        if not device_id or not access_token:
            raise WarpServiceError("Cloudflare response is missing device id or access token.")

        account = self.get_account()
        if account is None:
            account = WarpAccount(
                device_id=device_id,
                access_token=access_token,
                license_key=license_key,
                private_key=private_key,
                public_key=public_key,
                created_at=utcnow_naive(),
                updated_at=utcnow_naive(),
            )
            self.db.add(account)
        else:
            account.device_id = device_id
            account.access_token = access_token
            account.license_key = license_key
            account.private_key = private_key
            account.public_key = public_key
            account.updated_at = utcnow_naive()

        self.db.commit()
        self.db.refresh(account)
        return account, response

    def delete(self) -> None:
        account = self.get_account()
        if not account:
            return
        self.db.delete(account)
        self.db.commit()

    def update_license(self, license_key: str) -> WarpAccount:
        account = self._require_account()
        payload = {"license": license_key}
        response = self._request(
            "PUT",
            f"/reg/{account.device_id}/account",
            json=payload,
            token=account.access_token,
        )

        if isinstance(response, dict) and response.get("success") is False:
            errors = response.get("errors") or []
            if errors:
                message = errors[0].get("message") or "Failed to update WARP license"
                raise WarpServiceError(message)
            raise WarpServiceError("Failed to update WARP license")

        account.license_key = license_key
        account.updated_at = utcnow_naive()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return account

    def get_remote_config(self) -> dict:
        account = self._require_account()
        return self._request("GET", f"/reg/{account.device_id}", token=account.access_token)

    def serialize_account(self, account: WarpAccount) -> dict:
        return {
            "device_id": account.device_id,
            "access_token": account.access_token,
            "license_key": account.license_key,
            "private_key": account.private_key,
            "public_key": account.public_key,
            "created_at": account.created_at.isoformat() if account.created_at else None,
            "updated_at": account.updated_at.isoformat() if account.updated_at else None,
        }

    def _require_account(self) -> WarpAccount:
        account = self.get_account()
        if account is None:
            raise WarpAccountNotFound("No WARP account is registered yet.")
        return account

    def _request(self, method: str, path: str, token: Optional[str] = None, **kwargs) -> dict:
        headers = kwargs.pop("headers", {})
        headers.setdefault("CF-Client-Version", CLIENT_VERSION)
        headers.setdefault("User-Agent", "okhttp/3.12.1")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        url = f"{API_BASE}{path}"
        try:
            response = requests.request(
                method,
                url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                **kwargs,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise WarpServiceError(str(exc)) from exc

        try:
            return response.json()
        except ValueError as exc:
            raise WarpServiceError("Cloudflare returned an invalid JSON response.") from exc
