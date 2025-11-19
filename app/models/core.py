from pydantic import BaseModel


class CoreStats(BaseModel):
    version: str | None
    started: bool
    logs_websocket: str


class ServerIPs(BaseModel):
    ipv4: str
    ipv6: str
