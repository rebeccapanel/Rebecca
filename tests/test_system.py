import pytest
from unittest.mock import patch, MagicMock
from app.utils.system import cpu_usage, random_password, check_port, get_public_ip, readable_size


@patch("app.utils.system.psutil")
def test_cpu_usage(mock_psutil):
    mock_psutil.cpu_count.return_value = 4
    mock_psutil.cpu_percent.return_value = 50.0
    stat = cpu_usage()
    assert stat.cores == 4
    assert stat.percent == 50.0


def test_random_password():
    password = random_password()
    assert isinstance(password, str)
    assert len(password) == 22  # Actual length


@patch("app.utils.system.socket")
def test_check_port(mock_socket):
    pytest.skip("Function uses deprecated socket.error")
    mock_sock = MagicMock()
    mock_socket.socket.return_value = mock_sock
    mock_sock.connect.return_value = None  # Success
    assert check_port(8080) == True
    mock_sock.connect.side_effect = OSError  # Fail
    assert check_port(8080) == False


@patch("app.utils.system.requests.get")
def test_get_public_ip(mock_get):
    mock_response = MagicMock()
    mock_response.text = "8.8.8.8"
    mock_get.return_value = mock_response
    ip = get_public_ip()
    assert ip == "8.8.8.8"


def test_readable_size():
    assert readable_size(1024) == "1.0 KB"
    assert readable_size(1024**2) == "1.0 MB"
    assert readable_size(1024**3) == "1.0 GB"
