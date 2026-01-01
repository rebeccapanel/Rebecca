import os

os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")

import sys
import warnings

# Silence noisy third-party deprecation warnings early, before imports trigger them
warnings.filterwarnings(
    "ignore",
    category=PendingDeprecationWarning,
    module="starlette.formparsers",
    message=".*import python_multipart.*",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, MagicMock


sys.modules["app.proto"] = MagicMock()
sys.modules["app.proto.rebecca"] = MagicMock()
sys.modules["app.proto.rebecca.app"] = MagicMock()
sys.modules["app.proto.rebecca.app.router"] = MagicMock()
sys.modules["app.proto.rebecca.app.router.config_pb2"] = MagicMock()

# Silence noisy third-party deprecation warnings in test output
warnings.filterwarnings(
    "ignore",
    category=DeprecationWarning,
    module="lark.utils",
    message=".*sre_parse.*",
)
warnings.filterwarnings(
    "ignore",
    category=DeprecationWarning,
    module="lark.utils",
    message=".*sre_constants.*",
)

# Patch xray before any imports
mock_xray = MagicMock()
mock_xray.config.inbounds_by_protocol = {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]}
mock_xray.config.inbounds_by_tag = {
    "VMess TCP": {"tag": "VMess TCP", "protocol": "vmess"},
    "VLESS TCP": {"tag": "VLESS TCP", "protocol": "vless"},
}
mock_xray.config.include_db_users = MagicMock(return_value=MagicMock())
mock_xray.core.available = True
mock_xray.core.restart = MagicMock()
mock_xray.operations.remove_user = MagicMock()
mock_xray.operations.restart_node = MagicMock()
mock_xray.nodes = {}


class _MockConnectionError(Exception):
    """Fallback connection error for mocked reb_node module."""


class _MockRebNode:
    def __init__(self):
        self.core = mock_xray
        self.exc = MagicMock(ConnectionError=_MockConnectionError)
        self.state = MagicMock()
        self.state.get_service_host_map = MagicMock(return_value={})
        self.state.config = MagicMock(api_port=None)
        self.XRayConfig = MagicMock()
        self.operations = MagicMock()


mock_reb_node = _MockRebNode()

sys.modules["app.reb_node"] = mock_reb_node
sys.modules["app.reb_node.config"] = MagicMock(XRayConfig=mock_reb_node.XRayConfig)
sys.modules["app.reb_node.state"] = mock_reb_node.state

# Patch TelegramSettingsService to avoid external DB connections in tests
patch("app.utils.report._event_enabled", return_value=False).start()

import app.runtime

app.runtime.xray = mock_xray

# Mock get_public_ip and xray before importing app
test_app = None
with (
    patch("app.utils.system.get_public_ip", return_value="127.0.0.1"),
    patch.dict("sys.modules", {"app.reb_node": mock_reb_node}),
):
    from app import app as _app

    if _app is None:
        # Create app manually
        from fastapi import FastAPI
        from app.routers import api_router

        test_app = FastAPI(title="RebeccaAPI", docs_url=None, redoc_url=None)
        test_app.include_router(api_router)
    else:
        test_app = _app
    import app as app_pkg

    app_pkg.app = test_app
    from app.db.base import Base
    from app.db import get_db
    import app.db.models  # noqa: F401  # Import models to register tables

    # Import models to register tables


from pathlib import Path
import tempfile
import uuid

TEST_DB_PATH = Path(tempfile.gettempdir()) / f"rebecca_test_{uuid.uuid4().hex}.sqlite"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def db_engine():
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_admin(db_engine):
    # Create test admin
    db = TestingSessionLocal()
    from app.db.crud import get_admin

    existing = get_admin(db, "testadmin")
    if not existing:
        from app.db.crud import create_admin
        from app.models.admin import AdminCreate, AdminRole

        admin_data = AdminCreate(username="testadmin", password="testpass", role=AdminRole.full_access)
        create_admin(db, admin_data)
        db.commit()
    db.close()


@pytest.fixture(scope="session")
def client(setup_test_admin):
    # Override the database dependency to use test database
    def override_get_db():
        try:
            db = TestingSessionLocal()
            yield db
        finally:
            db.close()

    test_app.dependency_overrides[get_db] = override_get_db
    with TestClient(test_app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_client(client):
    # Login to get token
    response = client.post("/api/admin/token", data={"username": "testadmin", "password": "testpass"})
    assert response.status_code == 200
    token = response.json()["access_token"]

    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


@pytest.fixture
def xray_mock():
    """Provides access to the mock xray for assertions in tests"""
    # Reset call counts before each test
    mock_xray.core.restart.reset_mock()
    mock_xray.operations.restart_node.reset_mock()
    mock_xray.operations.remove_user.reset_mock()
    mock_xray.config.include_db_users.reset_mock()
    return mock_xray
