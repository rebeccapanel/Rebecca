from __future__ import annotations

import os
import time
from typing import Any

import requests

GITHUB_API_BASE = "https://api.github.com"
GITHUB_CACHE_TTL = 300

_CACHE: dict[str, tuple[float, Any]] = {}


def infer_update_channel(tag: str | None) -> str:
    normalized = str(tag or "").strip().lower()
    if normalized.startswith("dev-"):
        return "dev"
    if normalized:
        return "latest"
    return "unknown"


def normalize_version_tag(tag: str | None) -> str:
    normalized = str(tag or "").strip().lower()
    if normalized.startswith("refs/tags/"):
        normalized = normalized.removeprefix("refs/tags/")
    if normalized.startswith("v") and len(normalized) > 1 and normalized[1].isdigit():
        normalized = normalized[1:]
    return normalized


def is_different_version(current: str | None, target: str | None) -> bool:
    current_normalized = normalize_version_tag(current)
    target_normalized = normalize_version_tag(target)
    return bool(current_normalized and target_normalized and current_normalized != target_normalized)


def _github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Rebecca-update-check",
    }
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get_json(path: str) -> Any:
    key = path
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < GITHUB_CACHE_TTL:
        return cached[1]

    response = requests.get(f"{GITHUB_API_BASE}{path}", headers=_github_headers(), timeout=8)
    response.raise_for_status()
    data = response.json()
    _CACHE[key] = (now, data)
    return data


def _latest_release(repo: str) -> dict[str, Any] | None:
    data = _get_json(f"/repos/{repo}/releases/latest")
    if not isinstance(data, dict):
        return None
    tag = data.get("tag_name") or data.get("name")
    if not tag:
        return None
    return {
        "tag": str(tag),
        "name": data.get("name"),
        "published_at": data.get("published_at"),
        "html_url": data.get("html_url"),
    }


def _latest_dev_build(
    repo: str,
    *,
    branch: str = "dev",
    workflow_path: str = ".github/workflows/binary-build.yml",
) -> dict[str, Any] | None:
    data = _get_json(f"/repos/{repo}/actions/runs?per_page=50")
    runs = data.get("workflow_runs") if isinstance(data, dict) else None
    if not isinstance(runs, list):
        return None

    for run in runs:
        if not isinstance(run, dict):
            continue
        if run.get("head_branch") != branch:
            continue
        if run.get("conclusion") != "success":
            continue
        if run.get("status") and run.get("status") != "completed":
            continue
        if workflow_path and run.get("path") != workflow_path:
            continue
        sha = str(run.get("head_sha") or "").strip()
        if not sha:
            continue
        return {
            "tag": f"dev-{sha[:7]}",
            "sha": sha,
            "branch": branch,
            "created_at": run.get("created_at"),
            "updated_at": run.get("updated_at"),
            "html_url": run.get("html_url"),
        }
    return None


def get_binary_update_status(repo: str, current_tag: str | None, *, channel: str | None = None) -> dict[str, Any]:
    current_channel = (channel or infer_update_channel(current_tag)).strip().lower() or "unknown"
    status: dict[str, Any] = {
        "repo": repo,
        "current": current_tag,
        "channel": current_channel,
        "available": False,
        "target": None,
        "latest_release": None,
        "latest_dev": None,
        "checked_at": int(time.time()),
    }

    try:
        latest_release = _latest_release(repo)
        latest_dev = _latest_dev_build(repo)
    except Exception as exc:
        status["error"] = str(exc)
        return status

    status["latest_release"] = latest_release
    status["latest_dev"] = latest_dev

    target = latest_dev if current_channel == "dev" else latest_release
    target_tag = target.get("tag") if isinstance(target, dict) else None
    status["target"] = target_tag
    status["available"] = is_different_version(current_tag, target_tag)
    return status
