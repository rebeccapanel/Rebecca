from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class WarpRegisterRequest(BaseModel):
    private_key: str = Field(..., min_length=16)
    public_key: str = Field(..., min_length=16)


class WarpLicenseUpdate(BaseModel):
    license_key: str = Field(..., min_length=10)


class WarpAccountPayload(BaseModel):
    device_id: str
    access_token: str
    license_key: Optional[str] = None
    private_key: str
    public_key: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WarpRegisterResponse(BaseModel):
    account: WarpAccountPayload
    config: dict


class WarpConfigResponse(BaseModel):
    config: dict


class WarpAccountResponse(BaseModel):
    account: Optional[WarpAccountPayload]
