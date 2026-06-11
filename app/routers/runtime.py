from fastapi import APIRouter, Depends, HTTPException, WebSocket, Body, BackgroundTasks, Request
from app.db import Session, get_db
from app.models.admin import Admin
from app.utils import responses

router = APIRouter(tags=["Runtime"], prefix="/api", responses={401: responses._401})

MASTER_TARGET_ID = "master"
# TODO(go-access-insights): rebuild Access Insights in Go with node gRPC log
# streaming, then remove these disabled compatibility endpoints.
ACCESS_INSIGHTS_DISABLED_DETAIL = (
    "Access Insights is temporarily disabled while it is rebuilt as a Go-native feature."
)


@router.websocket("/core/logs")
async def runtime_logs(websocket: WebSocket):
    await websocket.close(reason="Core logs are served by the Go gateway and Go Master API.", code=4400)


@router.get("/core/access/insights", responses={403: responses._403})
def get_access_insights(
    request: Request,
    admin: Admin = Depends(Admin.get_current),
):
    _ = request, admin
    raise HTTPException(status_code=410, detail=ACCESS_INSIGHTS_DISABLED_DETAIL)


@router.get("/core/access/insights/multi-node", responses={403: responses._403})
def get_multi_node_access_insights(
    request: Request,
    admin: Admin = Depends(Admin.get_current),
):
    _ = request, admin
    raise HTTPException(status_code=410, detail=ACCESS_INSIGHTS_DISABLED_DETAIL)


@router.get("/core/access/logs/raw", responses={403: responses._403})
def get_raw_access_logs(
    request: Request,
    admin: Admin = Depends(Admin.get_current),
):
    _ = request, admin
    raise HTTPException(status_code=410, detail=ACCESS_INSIGHTS_DISABLED_DETAIL)


@router.post("/core/access/operators", responses={403: responses._403})
def resolve_access_log_operators(
    ips: list[str] = Body(default_factory=list, embed=True),
    admin: Admin = Depends(Admin.get_current),
):
    _ = ips, admin
    raise HTTPException(status_code=410, detail=ACCESS_INSIGHTS_DISABLED_DETAIL)


@router.websocket("/core/access/logs/ws")
async def access_logs_ws(websocket: WebSocket):
    await websocket.close(reason=ACCESS_INSIGHTS_DISABLED_DETAIL, code=4404)


@router.get("/core")
def get_runtime_stats(
    admin: Admin = Depends(Admin.get_current),
):
    """Retrieve aggregate node runtime status."""
    _ = admin
    raise HTTPException(
        status_code=503,
        detail="Core runtime routes are handled by the native Go Master API",
    )


@router.get("/core/ips")
def get_server_ips(admin: Admin = Depends(Admin.get_current)):
    """Retrieve server's public IPv4 and IPv6 addresses."""
    raise HTTPException(
        status_code=503,
        detail="Server IP routes are handled by the native Go Master API",
    )


@router.post("/core/restart", responses={403: responses._403})
def queue_runtime_restart(
    target: str | None = None,
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Restart the selected runtime target."""
    _ = target, admin
    raise HTTPException(
        status_code=503,
        detail="Core restart routes are handled by the native Go Master API",
    )


@router.get("/core/config", responses={403: responses._403})
def get_runtime_config(
    target: str = MASTER_TARGET_ID,
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Get the current runtime configuration."""
    raise HTTPException(
        status_code=503,
        detail="Xray config routes are handled by the native Go Master API",
    )


@router.put("/core/config", responses={403: responses._403})
def modify_runtime_config(
    payload: dict,
    target: str = MASTER_TARGET_ID,
    admin: Admin = Depends(Admin.check_sudo_admin),
) -> dict:
    """Modify the runtime configuration and restart the target runtime."""
    raise HTTPException(
        status_code=503,
        detail="Xray config routes are handled by the native Go Master API",
    )


@router.get("/core/config/targets", responses={403: responses._403})
def get_runtime_config_targets(
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=503,
        detail="Xray config target routes are handled by the native Go Master API",
    )


@router.put("/core/config/targets/{node_id}/mode", responses={403: responses._403})
def modify_node_config_mode(
    node_id: int,
    bg: BackgroundTasks,
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=503,
        detail="Xray config target routes are handled by the native Go Master API",
    )


@router.get("/core/xray/releases", responses={403: responses._403})
def list_xray_releases(limit: int = 10, admin: Admin = Depends(Admin.check_sudo_admin)):
    """List latest Xray-core tags for node update workflows."""
    _ = limit, admin
    raise HTTPException(
        status_code=503,
        detail="Xray release routes are handled by the native Go Master API",
    )


@router.post("/core/xray/update", responses={403: responses._403})
def update_node_runtime_version(
    payload: dict = Body(..., examples={"default": {"version": "v1.8.11", "persist_env": True}}),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Deprecated: master no longer owns a local runtime."""
    raise HTTPException(status_code=410, detail="Master runtime is node-only; update nodes instead.")


@router.get("/core/geo/templates", responses={403: responses._403})
def list_geo_templates(index_url: str = "", admin: Admin = Depends(Admin.check_sudo_admin)):
    """Fetch and list geo templates."""
    _ = index_url, admin
    raise HTTPException(
        status_code=503,
        detail="Geo template routes are handled by the native Go Master API",
    )


@router.post("/core/geo/apply", responses={403: responses._403})
def apply_geo_assets(
    request: Request,
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "mode": "default",
                "files": [
                    {"name": "geosite.dat", "url": "https://.../geosite.dat"},
                    {"name": "geoip.dat", "url": "https://.../geoip.dat"},
                ],
                "persist_env": True,
                "apply_to_nodes": True,
                "skip_node_ids": [],
            }
        },
    ),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Download and apply geo assets."""
    _ = request, payload, admin, db
    raise HTTPException(
        status_code=503,
        detail="Geo update routes are handled by the native Go Master API",
    )


@router.post("/core/geo/update", responses={403: responses._403})
def update_geo_assets(
    request: Request,
    payload: dict = Body(
        ...,
        examples={
            "default": {
                "mode": "template",
                "templateIndexUrl": "",
                "templateName": "standard",
                "files": [],
                "persistEnv": True,
                "applyToNodes": True,
                "skipNodeIds": [],
            }
        },
    ),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """
    Backward-compatible alias used by the dashboard to update geo files on the master (and optionally nodes).
    Accepts camelCase keys from the frontend and forwards to the main handler.
    """
    _ = request, payload, admin, db
    raise HTTPException(
        status_code=503,
        detail="Geo update routes are handled by the native Go Master API",
    )


@router.get("/core/warp", responses={403: responses._403})
def get_warp_account(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Return the stored Cloudflare WARP account (if any)."""
    raise HTTPException(status_code=503, detail="WARP routes are served by the Go Master API")


@router.post(
    "/core/warp/register",
    responses={403: responses._403},
)
def register_warp_account(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Register a new WARP device via Cloudflare and persist credentials."""
    raise HTTPException(status_code=503, detail="WARP routes are served by the Go Master API")


@router.post(
    "/core/warp/license",
    responses={403: responses._403},
)
def update_warp_license(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Update the stored license key on Cloudflare WARP."""
    raise HTTPException(status_code=503, detail="WARP routes are served by the Go Master API")


@router.get(
    "/core/warp/config",
    responses={403: responses._403},
)
def get_warp_config(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Fetch the latest device+account info from Cloudflare."""
    raise HTTPException(status_code=503, detail="WARP routes are served by the Go Master API")


@router.delete("/core/warp", responses={403: responses._403})
def delete_warp_account(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Remove the locally stored WARP credentials."""
    raise HTTPException(status_code=503, detail="WARP routes are served by the Go Master API")


@router.post("/panel/xray/testOutbound", responses={403: responses._403})
def test_outbound(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    _ = payload, admin
    raise HTTPException(
        status_code=503,
        detail="Outbound test routes are handled by the native Go Master API",
    )


@router.get("/panel/xray/getOutboundsTraffic", responses={403: responses._403})
def get_outbounds_traffic(admin: Admin = Depends(Admin.check_sudo_admin), db: Session = Depends(get_db)):
    """Get outbound traffic statistics from database."""
    _ = admin, db
    raise HTTPException(status_code=503, detail="Outbound traffic routes are served by the Go Master API")


@router.post("/panel/xray/resetOutboundsTraffic", responses={403: responses._403})
def reset_outbounds_traffic(
    payload: dict = Body(...),
    admin: Admin = Depends(Admin.check_sudo_admin),
    db: Session = Depends(get_db),
):
    """Reset outbound traffic statistics."""
    _ = payload, admin, db
    raise HTTPException(status_code=503, detail="Outbound traffic routes are served by the Go Master API")
