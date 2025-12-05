# os.environ.setdefault("REBECCA_SKIP_RUNTIME_INIT", "1")

import warnings

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, MagicMock

# Silence upstream lark deprecation noise during tests
warnings.filterwarnings(
    "ignore",
    message=r"module 'sre_(parse|constants)' is deprecated",
    category=DeprecationWarning,
    module=r"lark\.utils",
)

# Patch xray before any imports
mock_xray = MagicMock()
mock_xray.config.inbounds_by_protocol = {"vmess": [{"tag": "VMess TCP"}], "vless": [{"tag": "VLESS TCP"}]}
mock_xray.config.inbounds_by_tag = {"VMess TCP": {"tag": "VMess TCP"}, "VLESS TCP": {"tag": "VLESS TCP"}}
mock_xray.core.available = True
mock_xray.core.restart = MagicMock()
mock_xray.operations.remove_user = MagicMock()
mock_xray.operations.restart_node = MagicMock()
mock_xray.nodes = {}
patch("app.reb_node.core", mock_xray).start()

# Patch TelegramSettingsService to avoid external DB connections in tests
patch("app.utils.report._event_enabled", return_value=False).start()

# Mock get_public_ip and xray before importing app
app = None
with (
    patch("app.utils.system.get_public_ip", return_value="127.0.0.1"),
    patch.dict("sys.modules", {"app.reb_node": MagicMock()}),
):
    from app import app as _app

    if _app is None:
        # Create app manually
        from fastapi import FastAPI
        from app.routers import api_router

        app = FastAPI(title="RebeccaAPI", docs_url=None, redoc_url=None)
        app.include_router(api_router)
    else:
        app = _app
    from app.db.base import Base
    from app.db import get_db

    # Import models to register tables


TEST_DATABASE_URL = "sqlite:///./test.db"

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

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_client(client):
    # Login to get token
    response = client.post("/api/admin/token", data={"username": "testadmin", "password": "testpass"})
    assert response.status_code == 200
    token = response.json()["access_token"]

    client.headers.update({"Authorization": f"Bearer {token}"})
    return client
