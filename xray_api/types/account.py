from abc import ABC, abstractmethod 
from enum import Enum
from uuid import UUID

from pydantic import BaseModel

from ..proto.common.serial.typed_message_pb2 import TypedMessage
from ..proto.proxy.shadowsocks.config_pb2 import \
    Account as ShadowsocksAccountPb2
from ..proto.proxy.shadowsocks.config_pb2 import \
    CipherType as ShadowsocksCiphers
from ..proto.proxy.trojan.config_pb2 import Account as TrojanAccountPb2
from ..proto.proxy.vless.account_pb2 import Account as VLESSAccountPb2
from ..proto.proxy.vmess.account_pb2 import Account as VMessAccountPb2
from .message import Message


class Account(BaseModel, ABC):
    email: str
    level: int = 0

    @property
    @abstractmethod
    def message(self):
        pass

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} {self.email}>"


class VMessAccount(Account):
    id: UUID

    @property
    def message(self):
        return Message(VMessAccountPb2(id=str(self.id)))


class XTLSFlows(Enum):
    NONE = ''
    VISION = 'xtls-rprx-vision'


class VLESSAccount(Account):
    id: UUID
    flow: XTLSFlows = XTLSFlows.NONE

    @property
    def message(self):
        return Message(VLESSAccountPb2(id=str(self.id), flow=self.flow.value))


class TrojanAccount(Account):
    password: str
    flow: XTLSFlows = XTLSFlows.NONE

    @property
    def message(self):
        return Message(TrojanAccountPb2(password=self.password))


class ShadowsocksMethods(Enum):
    AES_128_GCM = 'aes-128-gcm'
    AES_256_GCM = 'aes-256-gcm'
    CHACHA20_POLY1305 = 'chacha20-ietf-poly1305'
    XCHACHA20_POLY1305 = 'xchacha20-ietf-poly1305'
    BLAKE3_AES_128_GCM = '2022-blake3-aes-128-gcm'
    BLAKE3_AES_256_GCM = '2022-blake3-aes-256-gcm'
    BLAKE3_CHACHA20_POLY1305 = '2022-blake3-chacha20-poly1305'


class ShadowsocksAccount(Account):
    password: str
    method: ShadowsocksMethods = ShadowsocksMethods.CHACHA20_POLY1305
    iv_check: bool = False

    @property
    def cipher_type_value(self):
        """
        Return the numeric cipher type understood by Xray protobuf.
        We intentionally fall back to raw integers for newer ciphers that may
        not yet exist in the generated enum to avoid runtime errors.
        """
        cipher_map = {
            ShadowsocksMethods.AES_128_GCM: getattr(ShadowsocksCiphers, "AES_128_GCM", 5),
            ShadowsocksMethods.AES_256_GCM: getattr(ShadowsocksCiphers, "AES_256_GCM", 6),
            ShadowsocksMethods.CHACHA20_POLY1305: getattr(ShadowsocksCiphers, "CHACHA20_POLY1305", 7),
            ShadowsocksMethods.XCHACHA20_POLY1305: getattr(ShadowsocksCiphers, "XCHACHA20_POLY1305", 8),
            ShadowsocksMethods.BLAKE3_AES_128_GCM: getattr(ShadowsocksCiphers, "BLAKE3_AES_128_GCM", 10),
            ShadowsocksMethods.BLAKE3_AES_256_GCM: getattr(ShadowsocksCiphers, "BLAKE3_AES_256_GCM", 11),
            ShadowsocksMethods.BLAKE3_CHACHA20_POLY1305: getattr(
                ShadowsocksCiphers, "BLAKE3_CHACHA20_POLY1305", 12
            ),
        }
        return cipher_map.get(self.method, getattr(ShadowsocksCiphers, "UNKNOWN", 0))

    @property
    def message(self):
        return Message(
            ShadowsocksAccountPb2(
                password=self.password,
                cipher_type=self.cipher_type_value,
                iv_check=self.iv_check,
            )
        )
