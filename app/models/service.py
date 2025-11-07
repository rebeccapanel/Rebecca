from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ServiceHostAssignment(BaseModel):
    host_id: int
    sort: Optional[int] = Field(default=None, ge=0)


class ServiceCreate(BaseModel):
    name: str = Field(..., max_length=128)
    description: Optional[str] = Field(None, max_length=256)
    hosts: List[ServiceHostAssignment] = Field(default_factory=list)
    admin_ids: List[int] = Field(default_factory=list)

    @field_validator("hosts")
    @classmethod
    def ensure_unique_hosts(cls, value: List[ServiceHostAssignment]):
        ids = [assignment.host_id for assignment in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate host ids are not allowed in a service")
        return value


class ServiceModify(BaseModel):
    name: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = Field(None, max_length=256)
    hosts: Optional[List[ServiceHostAssignment]] = None
    admin_ids: Optional[List[int]] = None

    @field_validator("hosts")
    @classmethod
    def ensure_unique_hosts(cls, value: Optional[List[ServiceHostAssignment]]):
        if value is None:
            return value
        ids = [assignment.host_id for assignment in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate host ids are not allowed in a service")
        return value


class ServiceHost(BaseModel):
    id: int
    remark: str
    inbound_tag: str
    inbound_protocol: str
    sort: int
    address: str
    port: Optional[int]
    model_config = ConfigDict(from_attributes=True)


class ServiceAdmin(BaseModel):
    id: int
    username: str
    used_traffic: int
    lifetime_used_traffic: int
    model_config = ConfigDict(from_attributes=True)


class ServiceBase(BaseModel):
    id: int
    name: str
    description: Optional[str]
    used_traffic: int = 0
    lifetime_used_traffic: int = 0
    host_count: int = 0
    user_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class ServiceDetail(ServiceBase):
    admins: List[ServiceAdmin] = Field(default_factory=list)
    hosts: List[ServiceHost] = Field(default_factory=list)
    admin_ids: List[int] = Field(default_factory=list)
    host_ids: List[int] = Field(default_factory=list)


class ServiceListResponse(BaseModel):
    services: List[ServiceBase]
    total: int


class ServiceUsageResetResponse(BaseModel):
    id: int
    used_traffic: int
    lifetime_used_traffic: int
    model_config = ConfigDict(from_attributes=True)


class ServiceUsagePoint(BaseModel):
    timestamp: datetime
    used_traffic: int


class ServiceUsageTimeseries(BaseModel):
    service_id: int
    start: datetime
    end: datetime
    granularity: Literal["day", "hour"]
    points: List[ServiceUsagePoint]


class ServiceAdminUsage(BaseModel):
    admin_id: Optional[int]
    username: str
    used_traffic: int


class ServiceAdminUsageResponse(BaseModel):
    service_id: int
    start: datetime
    end: datetime
    admins: List[ServiceAdminUsage]


class ServiceAdminTimeseries(BaseModel):
    service_id: int
    admin_id: Optional[int]
    username: str
    start: datetime
    end: datetime
    granularity: Literal["day", "hour"]
    points: List[ServiceUsagePoint]


class ServiceDeletePayload(BaseModel):
    mode: Literal["delete_users", "transfer_users"] = "delete_users"
    target_service_id: Optional[int] = None
    unlink_admins: bool = False

    @model_validator(mode="after")
    def validate_target(self):
        if self.mode == "transfer_users" and self.target_service_id is None:
            raise ValueError("target_service_id is required when transferring users")
        return self
