import json
import re
from enum import Enum
from typing import Optional, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.utils.system import random_password
from xray_api.types.account import (
    ShadowsocksAccount,
    ShadowsocksMethods,
    TrojanAccount,
    VLESSAccount,
    VMessAccount,
    XTLSFlows,
)

FRAGMENT_PATTERN = re.compile(r'^((\d{1,4}-\d{1,4})|(\d{1,4})),((\d{1,3}-\d{1,3})|(\d{1,3})),(tlshello|\d|\d\-\d)$')

NOISE_PATTERN = re.compile(
    r'^(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?(&(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?)*$')


class ProxyTypes(str, Enum):
    # proxy_type = protocol

    VMess = "vmess"
    VLESS = "vless"
    Trojan = "trojan"
    Shadowsocks = "shadowsocks"

    @property
    def account_model(self):
        if self == self.VMess:
            return VMessAccount
        if self == self.VLESS:
            return VLESSAccount
        if self == self.Trojan:
            return TrojanAccount
        if self == self.Shadowsocks:
            return ShadowsocksAccount

    @property
    def settings_model(self):
        if self == self.VMess:
            return VMessSettings
        if self == self.VLESS:
            return VLESSSettings
        if self == self.Trojan:
            return TrojanSettings
        if self == self.Shadowsocks:
            return ShadowsocksSettings


class ProxySettings(BaseModel, use_enum_values=True):
    @classmethod
    def from_dict(cls, proxy_type: ProxyTypes, _dict: dict):
        model_cls = ProxyTypes(proxy_type).settings_model
        try:
            return model_cls.model_validate(_dict)
        except Exception:
            # Attempt to coerce bad UUID strings for UUID-based protocols
            if proxy_type in {ProxyTypes.VMess, ProxyTypes.VLESS}:
                cleaned = dict(_dict or {})
                raw_id = cleaned.get("id")
                if isinstance(raw_id, str):
                    normalized = re.sub(r"[^0-9a-fA-F-]", "", raw_id)
                    try:
                        cleaned["id"] = UUID(normalized)
                    except Exception:
                        cleaned["id"] = None
                else:
                    cleaned["id"] = None
                return model_cls.model_validate(cleaned)
            return model_cls.model_validate(_dict)

    def dict(self, *, no_obj=False, **kwargs):
        if no_obj:
            return json.loads(self.model_dump_json())
        return super().model_dump(**kwargs)


class VMessSettings(ProxySettings):
    id: Optional[UUID] = None

    def revoke(self):
        self.id = uuid4()


class VLESSSettings(ProxySettings):
    id: Optional[UUID] = None
    flow: XTLSFlows = XTLSFlows.NONE

    def revoke(self):
        self.id = uuid4()


class TrojanSettings(ProxySettings):
    password: Optional[str] = None
    flow: XTLSFlows = XTLSFlows.NONE

    def revoke(self):
        self.password = random_password()


class ShadowsocksSettings(ProxySettings):
    password: Optional[str] = None
    method: ShadowsocksMethods = ShadowsocksMethods.CHACHA20_POLY1305

    def revoke(self):
        self.password = random_password()


class ProxyHostSecurity(str, Enum):
    inbound_default = "inbound_default"
    none = "none"
    tls = "tls"


ProxyHostALPN = Enum(
    "ProxyHostALPN",
    {
        "none": "",
        "h3": "h3",
        "h2": "h2",
        "http/1.1": "http/1.1",
        "h3,h2,http/1.1": "h3,h2,http/1.1",
        "h3,h2": "h3,h2",
        "h2,http/1.1": "h2,http/1.1",
    },
)


ProxyHostFingerprint = Enum(
    "ProxyHostFingerprint",
    {
        "none": "",
        "chrome": "chrome",
        "firefox": "firefox",
        "safari": "safari",
        "ios": "ios",
        "android": "android",
        "edge": "edge",
        "360": "360",
        "qq": "qq",
        "random": "random",
        "randomized": "randomized",
    },
)


class FormatVariables(dict):
    def __missing__(self, key):
        return key.join("{}")


class ProxyHost(BaseModel):
    id: Optional[int] = None
    remark: str
    address: str
    port: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    sort: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    sni: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    host: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    path: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    security: ProxyHostSecurity = ProxyHostSecurity.inbound_default
    alpn: ProxyHostALPN = ProxyHostALPN.none
    fingerprint: ProxyHostFingerprint = ProxyHostFingerprint.none
    allowinsecure: Union[bool, None] = None
    is_disabled: Union[bool, None] = None
    mux_enable: Union[bool, None] = None
    fragment_setting: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    noise_setting: Optional[str] = Field(default=None, json_schema_extra={"nullable": True})
    random_user_agent: Union[bool, None] = None
    use_sni_as_host: Union[bool, None] = None
    model_config = ConfigDict(from_attributes=True)

    @field_validator("remark", mode="after")
    def validate_remark(cls, v):
        try:
            v.format_map(FormatVariables())
        except ValueError:
            raise ValueError("Invalid formatting variables")

        return v

    @field_validator("address", mode="after")
    def validate_address(cls, v):
        try:
            v.format_map(FormatVariables())
        except ValueError:
            raise ValueError("Invalid formatting variables")

        return v

    @field_validator("fragment_setting", check_fields=False)
    @classmethod
    def validate_fragment(cls, v):
        if v and not FRAGMENT_PATTERN.match(v):
            raise ValueError(
                "Fragment setting must be like this: length,interval,packet (10-100,100-200,tlshello)."
            )
        return v

    @field_validator("noise_setting", check_fields=False)
    @classmethod
    def validate_noise(cls, v):
        if v:
            if not NOISE_PATTERN.match(v):
                raise ValueError(
                    "Noise setting must be like this: packet,delay (rand:10-20,100-200)."
                )
            if len(v) > 2000:
                raise ValueError(
                    "Noise can't be longer that 2000 character"
                )
        return v


class ProxyInbound(BaseModel):
    tag: str
    protocol: ProxyTypes
    network: str
    tls: str
    port: Union[int, str]
