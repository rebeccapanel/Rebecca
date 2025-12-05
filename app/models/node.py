from datetime import datetime
from enum import Enum
from typing import Optional
from ipaddress import ip_address
from re import match

from pydantic import ConfigDict, BaseModel, Field, field_validator


class NodeStatus(str, Enum):
    connected = "connected"
    connecting = "connecting"
    error = "error"
    disabled = "disabled"
    limited = "limited"


class GeoMode(str, Enum):
    default = "default"
    custom = "custom"


class NodeSettings(BaseModel):
    min_node_version: str = "v0.2.0"
    certificate: str


def validate_address(value: str) -> str:
    if not value:
        raise ValueError("Address cannot be empty")

    try:
        ip_address(value)
        return value
    except ValueError:
        pass
    # Check if it's a valid domain
    if match(r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$", value):
        return value
    raise ValueError("Address must be a valid IP address or domain name")


class Node(BaseModel):
    name: str
    address: str = Field(..., validate_default=True)
    port: int = 62050
    api_port: int = 62051
    usage_coefficient: float = Field(gt=0, default=1.0)
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit for the node in bytes (null = unlimited)",
        json_schema_extra={"example": 107374182400},
    )
    use_nobetci: bool = False
    nobetci_port: Optional[int] = Field(
        None,
        ge=1,
        le=65535,
        description="Port to use when Nobetci integration is enabled",
    )

    @field_validator("address")
    @classmethod
    def validate_address_field(cls, v):
        return validate_address(v)


class NodeCreate(Node):
    add_as_new_host: bool = True
    geo_mode: GeoMode = GeoMode.default
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "DE node",
                "address": "192.168.1.1",
                "port": 62050,
                "api_port": 62051,
                "add_as_new_host": True,
                "usage_coefficient": 1,
                "geo_mode": "default",
            }
        }
    )


class NodeModify(Node):
    name: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    address: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    port: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    api_port: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    status: Optional[NodeStatus] = Field(default=None, json_schema_extra={"nullable": True})
    usage_coefficient: Optional[float] = Field(default=None, json_schema_extra={"nullable": True})
    geo_mode: Optional[GeoMode] = Field(default=None, json_schema_extra={"nullable": True})
    data_limit: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    use_nobetci: Optional[bool] = Field(default=None, json_schema_extra={"nullable": True})
    nobetci_port: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "DE node",
                "address": "192.168.1.1",
                "port": 62050,
                "api_port": 62051,
                "status": "disabled",
                "usage_coefficient": 1.0,
                "geo_mode": "default",
            }
        }
    )


class NodeResponse(Node):
    id: int
    xray_version: Optional[str] = None
    node_service_version: Optional[str] = None
    status: NodeStatus
    message: Optional[str] = None
    geo_mode: GeoMode
    uplink: int = 0
    downlink: int = 0
    model_config = ConfigDict(from_attributes=True)


class NodeUsageResponse(BaseModel):
    node_id: Optional[int] = None
    node_name: str
    uplink: int
    downlink: int


class NodesUsageResponse(BaseModel):
    usages: list[NodeUsageResponse]


class MasterNodeResponse(BaseModel):
    id: int
    name: str = "Master"
    status: NodeStatus
    message: Optional[str] = None
    data_limit: Optional[int] = None
    uplink: int = 0
    downlink: int = 0
    total_usage: int = 0
    remaining_data: Optional[int] = None
    limit_exceeded: bool = False
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class MasterNodeUpdate(BaseModel):
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit for the master node in bytes (null = unlimited)",
        ge=0,
        json_schema_extra={"example": 107374182400},
    )
    model_config = ConfigDict(extra="forbid")
