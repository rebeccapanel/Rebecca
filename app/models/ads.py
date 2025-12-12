from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class Advertisement(BaseModel):
    """
    Basic advertisement unit that can render as either text or image.
    """

    id: str
    type: Literal["text", "image"] = "text"
    title: Optional[str] = None
    text: Optional[str] = None
    image_url: Optional[HttpUrl] = None
    link: Optional[HttpUrl] = None
    cta: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _normalize_urls(cls, values: Any) -> Any:
        """Normalize empty strings to None for URL fields."""
        if isinstance(values, dict):
            if "image_url" in values and values["image_url"] == "":
                values["image_url"] = None
            if "link" in values and values["link"] == "":
                values["link"] = None
        return values


class PlacementAds(BaseModel):
    header: List[Advertisement] = Field(default_factory=list)
    sidebar: List[Advertisement] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class AdsResponse(BaseModel):
    default: PlacementAds = Field(default_factory=PlacementAds)
    locales: Dict[str, PlacementAds] = Field(default_factory=dict)
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    def _normalize(cls, values):
        normalized = dict(values or {})
        header = normalized.pop("header", None)
        sidebar = normalized.pop("sidebar", None)
        default_payload = normalized.get("default")
        if isinstance(default_payload, PlacementAds):
            default_payload = default_payload.model_dump()

        if header is not None or sidebar is not None:
            default_payload = default_payload or {}
            if header is not None:
                default_payload["header"] = header
            if sidebar is not None:
                default_payload["sidebar"] = sidebar
        if default_payload is not None:
            normalized["default"] = default_payload

        if "locales" not in normalized:
            normalized["locales"] = {}

        return normalized
