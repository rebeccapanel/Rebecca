import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import MagicMock
import sys
import os

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base import Base
from app.db import get_db, crud
from app import app as fastapi_app, runtime
from app.models.admin import AdminCreate, AdminRole

# Create an in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db():
    # Create the database tables
    Base.metadata.create_all(bind=engine)
    
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        # Drop the tables after the test
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = override_get_db
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()

@pytest.fixture(scope="function", autouse=True)
def mock_xray():
    # Create a comprehensive mock for xray
    mock_xray_obj = MagicMock()
    mock_xray_obj.core = MagicMock()
    mock_xray_obj.core.version = "1.0.0"
    mock_xray_obj.core.started = True
    mock_xray_obj.core.get_logs = MagicMock(return_value=MagicMock())
    mock_xray_obj.core.restart = MagicMock()
    mock_xray_obj.nodes = {}
    mock_xray_obj.operations = MagicMock()
    mock_xray_obj.operations.add_user = MagicMock()
    mock_xray_obj.operations.restart_node = MagicMock()
    
    # Mock config with proper structure
    # ProxyInbound needs: tag, protocol (ProxyTypes enum), network, tls, port
    from app.models.proxy import ProxyTypes
    mock_xray_obj.config = MagicMock()
    mock_xray_obj.config.inbounds_by_protocol = {
        ProxyTypes.VMess: [{"tag": "vmess_inbound", "protocol": ProxyTypes.VMess, "network": "tcp", "tls": "none", "port": 443}],
        ProxyTypes.VLESS: [{"tag": "vless_inbound", "protocol": ProxyTypes.VLESS, "network": "tcp", "tls": "tls", "port": 443}],
        ProxyTypes.Trojan: [{"tag": "trojan_inbound", "protocol": ProxyTypes.Trojan, "network": "tcp", "tls": "tls", "port": 443}],
        ProxyTypes.Shadowsocks: [{"tag": "ss_inbound", "protocol": ProxyTypes.Shadowsocks, "network": "tcp", "tls": "none", "port": 443}]
    }
    mock_xray_obj.config.include_db_users = MagicMock(return_value=mock_xray_obj.config)
    
    # Set the mock in runtime
    runtime.xray = mock_xray_obj
    
    # Also patch it in the router modules that import it at module level
    import app.routers.user as user_router
    import app.routers.core as core_router
    import app.routers.system as system_router
    user_router.xray = mock_xray_obj
    core_router.xray = mock_xray_obj
    system_router.xray = mock_xray_obj
    
    return mock_xray_obj

@pytest.fixture(scope="function")
def sudo_admin(db):
    # Create a sudo admin
    admin_data = AdminCreate(
        username="sudo_admin",
        password="password123",
        role=AdminRole.sudo
    )
    return crud.create_admin(db, admin_data)

@pytest.fixture(scope="function")
def admin_token(client, sudo_admin):
    response = client.post(
        "/api/admin/token",
        data={"username": "sudo_admin", "password": "password123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]

@pytest.fixture(scope="function")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
