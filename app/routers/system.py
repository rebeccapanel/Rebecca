import logging
import os
import time
from collections import deque

import psutil
from fastapi import APIRouter, Body, Depends

from app import __version__
from app.db import Session, crud, get_db
from app.models.admin import Admin, AdminRole
from app.services import go_dashboard
from app.models.system import (
    AdminOverviewStats,
    PersonalUsageStats,
    SystemStats,
    UsageStats,
)
from app.utils import responses
from app.utils.binary_control import (
    build_rebecca_update_args,
    get_binary_runtime_info,
    require_binary_runtime,
    schedule_rebecca_cli,
)
from app.utils.update_check import get_binary_update_status
from app.utils.system import cpu_usage, realtime_bandwidth

router = APIRouter(tags=["System"], prefix="/api", responses={401: responses._401})
logger = logging.getLogger(__name__)

HISTORY_MAX_ENTRIES = 6000
_system_history = {
    "cpu": deque(maxlen=HISTORY_MAX_ENTRIES),
    "memory": deque(maxlen=HISTORY_MAX_ENTRIES),
    "network": deque(maxlen=HISTORY_MAX_ENTRIES),
}

_panel_history = {
    "cpu": deque(maxlen=HISTORY_MAX_ENTRIES),
    "memory": deque(maxlen=HISTORY_MAX_ENTRIES),
}

_PANEL_PROCESS = psutil.Process(os.getpid())
_PANEL_PROCESS.cpu_percent(interval=None)


@router.get("/system", response_model=SystemStats)
def get_system_stats(
    admin: Admin = Depends(Admin.get_current),
    db: Session = Depends(get_db),
):
    """Fetch system stats including CPU and user metrics."""
    cpu = cpu_usage()
    dashboard_summary = go_dashboard.get_system_summary(admin)
    total_user = int(dashboard_summary.get("total_user") or 0)
    users_active = int(dashboard_summary.get("users_active") or 0)
    users_disabled = int(dashboard_summary.get("users_disabled") or 0)
    users_on_hold = int(dashboard_summary.get("users_on_hold") or 0)
    users_expired = int(dashboard_summary.get("users_expired") or 0)
    users_limited = int(dashboard_summary.get("users_limited") or 0)
    online_users = int(dashboard_summary.get("online_users") or 0)
    incoming_bandwidth = int(dashboard_summary.get("incoming_bandwidth") or 0)
    outgoing_bandwidth = int(dashboard_summary.get("outgoing_bandwidth") or 0)
    panel_total_bandwidth = int(
        dashboard_summary.get("panel_total_bandwidth") or incoming_bandwidth + outgoing_bandwidth
    )
    realtime_bandwidth_stats = realtime_bandwidth()
    now = time.time()
    system_memory = psutil.virtual_memory()
    system_swap = psutil.swap_memory()
    system_disk = psutil.disk_usage(os.path.abspath(os.sep))
    load_avg: list[float] = []
    try:
        load_avg = list(psutil.getloadavg())
    except (AttributeError, OSError):
        load_avg = []

    uptime_seconds = max(0, int(now - psutil.boot_time()))
    current_process = _PANEL_PROCESS
    panel_cpu_percent = float(current_process.cpu_percent(interval=None))
    panel_memory_percent = float(current_process.memory_percent())
    panel_uptime_seconds = max(0, int(now - current_process.create_time()))
    app_memory = current_process.memory_info().rss
    app_threads = current_process.num_threads()

    xray_running = False
    xray_uptime_seconds = 0
    xray_version = None
    last_xray_error = None
    try:
        for node in crud.get_nodes(db):
            status_raw = getattr(node, "status", "")
            status_value = str(getattr(status_raw, "value", status_raw)).lower()
            if status_value == "connected":
                xray_running = True
                xray_version = getattr(node, "xray_version", None) or xray_version
                break
    except Exception:
        pass

    timestamp = int(now)
    _system_history["cpu"].append({"timestamp": timestamp, "value": float(cpu.percent)})
    _system_history["memory"].append({"timestamp": timestamp, "value": float(system_memory.percent)})
    _system_history["network"].append(
        {
            "timestamp": timestamp,
            "incoming": realtime_bandwidth_stats.incoming_bytes,
            "outgoing": realtime_bandwidth_stats.outgoing_bytes,
        }
    )
    _panel_history["cpu"].append({"timestamp": timestamp, "value": panel_cpu_percent})
    _panel_history["memory"].append({"timestamp": timestamp, "value": panel_memory_percent})

    personal_payload = dashboard_summary.get("personal_usage") or {}
    personal_usage = PersonalUsageStats(
        total_users=int(personal_payload.get("total_users") or 0),
        consumed_bytes=int(personal_payload.get("consumed_bytes") or 0),
        built_bytes=int(personal_payload.get("built_bytes") or 0),
        reset_bytes=int(personal_payload.get("reset_bytes") or 0),
    )

    admin_overview_payload = dashboard_summary.get("admin_overview") or {}
    admin_overview = AdminOverviewStats(
        total_admins=int(admin_overview_payload.get("total_admins") or 0),
        sudo_admins=int(admin_overview_payload.get("sudo_admins") or 0),
        full_access_admins=int(admin_overview_payload.get("full_access_admins") or 0),
        standard_admins=int(admin_overview_payload.get("standard_admins") or 0),
        top_admin_username=admin_overview_payload.get("top_admin_username"),
        top_admin_usage=int(admin_overview_payload.get("top_admin_usage") or 0),
    )

    # Get last Telegram error (only for sudo/full_access admins)
    last_telegram_error = None
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        try:
            from app.telegram.handlers.report import get_last_telegram_error

            telegram_error = get_last_telegram_error()
            if telegram_error:
                error_code = telegram_error.get("error_code")
                description = telegram_error.get("description", telegram_error.get("error", ""))
                category = telegram_error.get("category", "unknown")
                target = telegram_error.get("target", "unknown")
                if error_code:
                    last_telegram_error = f"Error {error_code}: {description} (Category: {category}, Target: {target})"
                else:
                    last_telegram_error = f"{description} (Category: {category}, Target: {target})"
        except Exception:
            pass

    return SystemStats(
        version=__version__,
        cpu_cores=cpu.cores,
        cpu_usage=cpu.percent,
        total_user=total_user,
        online_users=online_users,
        users_active=users_active,
        users_disabled=users_disabled,
        users_expired=users_expired,
        users_limited=users_limited,
        users_on_hold=users_on_hold,
        incoming_bandwidth=incoming_bandwidth,
        outgoing_bandwidth=outgoing_bandwidth,
        panel_total_bandwidth=panel_total_bandwidth,
        incoming_bandwidth_speed=realtime_bandwidth_stats.incoming_bytes,
        outgoing_bandwidth_speed=realtime_bandwidth_stats.outgoing_bytes,
        memory=UsageStats(
            current=system_memory.used,
            total=system_memory.total,
            percent=float(system_memory.percent),
        ),
        swap=UsageStats(
            current=system_swap.used,
            total=system_swap.total,
            percent=float(system_swap.percent),
        ),
        disk=UsageStats(
            current=system_disk.used,
            total=system_disk.total,
            percent=float(system_disk.percent),
        ),
        load_avg=load_avg,
        uptime_seconds=uptime_seconds,
        panel_uptime_seconds=panel_uptime_seconds,
        xray_uptime_seconds=xray_uptime_seconds,
        xray_running=xray_running,
        xray_version=xray_version,
        app_memory=app_memory,
        app_threads=app_threads,
        panel_cpu_percent=panel_cpu_percent,
        panel_memory_percent=panel_memory_percent,
        cpu_history=list(_system_history["cpu"]),
        memory_history=list(_system_history["memory"]),
        network_history=list(_system_history["network"]),
        panel_cpu_history=list(_panel_history["cpu"]),
        panel_memory_history=list(_panel_history["memory"]),
        personal_usage=personal_usage,
        admin_overview=admin_overview,
        last_xray_error=last_xray_error,
        last_telegram_error=last_telegram_error,
    )


@router.get("/maintenance/info", responses={403: responses._403})
def get_maintenance_info(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Return local binary/runtime information for host-installed panels."""
    panel = get_binary_runtime_info()
    panel["update"] = get_binary_update_status(
        "rebeccapanel/Rebecca",
        panel.get("tag"),
        channel=panel.get("channel"),
    )
    return {
        "panel": panel,
        "node": None,
        "node_update": get_binary_update_status("rebeccapanel/Rebecca-node", None),
    }


@router.post("/maintenance/update", responses={403: responses._403})
def update_panel_from_maintenance(
    payload: dict | None = Body(default=None),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Schedule an on-host Rebecca update via the installed CLI."""
    require_binary_runtime()
    payload = payload or {}
    schedule_rebecca_cli(
        build_rebecca_update_args(
            channel=payload.get("channel"),
            version=payload.get("version"),
        )
    )
    return {"status": "accepted"}


@router.post("/maintenance/restart", responses={403: responses._403})
def restart_panel_from_maintenance(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Schedule an on-host Rebecca restart via the installed CLI."""
    require_binary_runtime()
    schedule_rebecca_cli(["restart", "-n"])
    return {"status": "accepted"}


@router.post("/maintenance/soft-reload", responses={403: responses._403})
def soft_reload_panel_from_maintenance(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Soft reload the panel without restarting node runtimes.

    Config/runtime state is Go-native now; this endpoint is kept as a
    compatibility no-op for callers that only need a lightweight refresh.
    """
    del admin
    return {"status": "ok", "message": "Panel soft reloaded successfully"}
