from unittest.mock import patch

from app.routers import core as core_router


class _FakeStdin:
    def write(self, _data: str) -> None:
        return

    def flush(self) -> None:
        return

    def close(self) -> None:
        return


class _FakeProcess:
    def __init__(self):
        self.stdin = _FakeStdin()
        self.stdout = None
        self.stderr = None
        self.returncode = None

    def poll(self):
        return None

    def communicate(self, timeout: float = 0):  # pragma: no cover - defensive for cleanup
        _ = timeout
        return ("", "")

    def terminate(self):  # pragma: no cover - defensive
        self.returncode = 0

    def wait(self, timeout: float = 0):  # pragma: no cover - defensive
        _ = timeout
        return 0

    def kill(self):  # pragma: no cover - defensive
        self.returncode = -9


def test_run_outbound_ping_test_success():
    outbound = {"tag": "proxy-test", "protocol": "vless"}
    all_outbounds = [outbound, {"tag": "direct", "protocol": "freedom"}]
    expected_result = {"success": True, "delay": 42, "statusCode": 204}
    fake_xray = type(
        "XrayMock",
        (),
        {
            "core": type(
                "CoreMock",
                (),
                {
                    "available": True,
                    "executable_path": "/tmp/xray",
                    "assets_path": "/tmp/assets",
                    "_env": {},
                },
            )()
        },
    )()

    with (
        patch.object(core_router, "xray", fake_xray),
        patch.object(core_router, "_find_available_test_port", return_value=12345),
        patch.object(core_router, "_wait_for_test_port", return_value=(True, "")),
        patch.object(core_router, "_measure_outbound_delay", return_value=(42, 204)),
        patch.object(core_router, "_stop_test_process"),
        patch.object(core_router.subprocess, "Popen", return_value=_FakeProcess()),
    ):
        result = core_router._run_outbound_ping_test(
            outbound_tag="proxy-test",
            all_outbounds=all_outbounds,
        )

    assert result == expected_result


def test_test_outbound_rejects_blackhole(auth_client):
    outbound = {"tag": "blocked", "protocol": "blackhole"}

    response = auth_client.post("/api/panel/xray/testOutbound", json={"outbound": outbound})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["obj"]["success"] is False
    assert "cannot be tested" in payload["obj"]["error"].lower()


def test_test_outbound_invalid_json_returns_400(auth_client):
    response = auth_client.post("/api/panel/xray/testOutbound", json={"outbound": "{invalid"})

    assert response.status_code == 400
    assert "Invalid outbound JSON" in response.json()["detail"]
