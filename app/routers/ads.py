from fastapi import APIRouter, Depends

from app.models.admin import Admin
from app.models.ads import AdsResponse
from app.utils.ads import get_cached_ads
from app.utils.responses import _401, _403

router = APIRouter(
    tags=["Ads"],
    prefix="/api",
    responses={401: _401, 403: _403},
)


@router.get("/ads", response_model=AdsResponse)
def read_ads(admin: Admin = Depends(Admin.get_current)):
    """
    Return the cached advertisement payload for any authenticated admin.
    """
    return get_cached_ads()
