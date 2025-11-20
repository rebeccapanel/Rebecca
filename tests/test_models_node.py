import pytest
from app.models.node import (
    NodeCreate,
    NodeModify,
    NodeResponse,
    NodeStatus,
    GeoMode,
    validate_address,
)


def test_validate_address():
    # Valid IP
    assert validate_address("192.168.1.1") == "192.168.1.1"
    assert validate_address("127.0.0.1") == "127.0.0.1"

    # Valid domain
    assert validate_address("example.com") == "example.com"
    assert validate_address("sub.example.com") == "sub.example.com"

    # Invalid empty
    with pytest.raises(ValueError, match="Address cannot be empty"):
        validate_address("")

    # Invalid IP
    with pytest.raises(ValueError, match="Address must be a valid IP address or domain name"):
        validate_address("999.999.999.999")

    # Invalid domain
    with pytest.raises(ValueError, match="Address must be a valid IP address or domain name"):
        validate_address("invalid..domain")


def test_node_create():
    node_data = {
        "name": "test node",
        "address": "192.168.1.1",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0,
    }
    node = NodeCreate(**node_data)
    assert node.name == "test node"
    assert node.address == "192.168.1.1"
    assert node.port == 62050
    assert node.api_port == 62051
    assert node.usage_coefficient == 1.0
    assert node.add_as_new_host is True
    assert node.geo_mode == GeoMode.default


def test_node_create_invalid_address():
    node_data = {
        "name": "test node",
        "address": "invalid",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0,
    }
    with pytest.raises(ValueError):
        NodeCreate(**node_data)


def test_node_modify():
    node_data = {
        "name": "modified node",
        "address": "example.com",
        "port": 62051,
    }
    node = NodeModify(**node_data)
    assert node.name == "modified node"
    assert node.address == "example.com"
    assert node.port == 62051


def test_node_response():
    node_data = {
        "id": 1,
        "name": "response node",
        "address": "127.0.0.1",
        "port": 62050,
        "api_port": 62051,
        "usage_coefficient": 1.0,
        "status": NodeStatus.connected,
        "geo_mode": GeoMode.default,
        "uplink": 100,
        "downlink": 200,
    }
    node = NodeResponse(**node_data)
    assert node.id == 1
    assert node.name == "response node"
    assert node.status == NodeStatus.connected
    assert node.uplink == 100
    assert node.downlink == 200
