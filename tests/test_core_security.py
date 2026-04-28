import io
import socket
import zipfile

import pytest
from fastapi import HTTPException

from app.routers.core import _install_xray_zip, _safe_geo_filename, _validate_download_url


def test_install_xray_zip_rejects_zip_slip(tmp_path):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../escape.txt", "owned")
        zf.writestr("xray", "binary")

    with pytest.raises(HTTPException) as exc:
        _install_xray_zip(archive.getvalue(), tmp_path / "xray-core")

    assert exc.value.status_code == 400
    assert not (tmp_path / "escape.txt").exists()


def test_safe_geo_filename_only_allows_expected_assets():
    assert _safe_geo_filename("geoip.dat") == "geoip.dat"
    assert _safe_geo_filename("nested/geosite.dat") == "geosite.dat"

    with pytest.raises(HTTPException) as exc:
        _safe_geo_filename("../../authorized_keys")

    assert exc.value.status_code == 422


def test_validate_download_url_rejects_private_resolved_addresses(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    )

    with pytest.raises(HTTPException) as exc:
        _validate_download_url("https://example.com/file.dat")

    assert exc.value.status_code == 422
