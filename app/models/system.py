from typing import List, Optional

from pydantic import BaseModel, Field


class UsageStats(BaseModel):
    current: int
    total: int
    percent: float


class HistoryEntry(BaseModel):
    timestamp: int
    value: float


class NetworkHistoryEntry(BaseModel):
    timestamp: int
    incoming: int
    outgoing: int


class PersonalUsageStats(BaseModel):
    total_users: int
    consumed_bytes: int
    built_bytes: int
    reset_bytes: int


class AdminOverviewStats(BaseModel):
    total_admins: int
    sudo_admins: int
    full_access_admins: int
    standard_admins: int
    top_admin_username: Optional[str] = None
    top_admin_usage: int = 0


class SystemStats(BaseModel):
    version: str
    cpu_cores: int
    cpu_usage: float
    total_user: int
    online_users: int
    users_active: int
    users_on_hold: int
    users_disabled: int
    users_expired: int
    users_limited: int
    incoming_bandwidth: int
    outgoing_bandwidth: int
    panel_total_bandwidth: int
    incoming_bandwidth_speed: int
    outgoing_bandwidth_speed: int
    memory: UsageStats
    swap: UsageStats
    disk: UsageStats
    load_avg: List[float] = Field(default_factory=list)
    uptime_seconds: int
    panel_uptime_seconds: int
    xray_uptime_seconds: int
    xray_running: bool
    xray_version: Optional[str] = None
    app_memory: int
    app_threads: int
    panel_cpu_percent: float
    panel_memory_percent: float
    cpu_history: List[HistoryEntry] = Field(default_factory=list)
    memory_history: List[HistoryEntry] = Field(default_factory=list)
    network_history: List[NetworkHistoryEntry] = Field(default_factory=list)
    panel_cpu_history: List[HistoryEntry] = Field(default_factory=list)
    panel_memory_history: List[HistoryEntry] = Field(default_factory=list)
    personal_usage: PersonalUsageStats
    admin_overview: AdminOverviewStats
