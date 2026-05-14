from types import SimpleNamespace

import app.runtime
from xray_api.stats import StatResponse

app.runtime.scheduler = SimpleNamespace(add_job=lambda *args, **kwargs: None)

from app.jobs.usage.collectors import get_outbounds_stats, get_users_stats
from app.jobs.usage.user_usage import _collect_user_stats


class FakeStatsAPI:
    def __init__(self, snapshots):
        self.snapshots = list(snapshots)
        self.calls = []

    def query_stats(self, pattern, reset=False, timeout=None):
        self.calls.append({"pattern": pattern, "reset": reset, "timeout": timeout})
        if not self.snapshots:
            return []
        return [
            StatResponse(type=stat_type, name=name, link=link, value=value)
            for stat_type, name, link, value in self.snapshots.pop(0)
        ]

    def get_users_stats(self, reset=False, timeout=None):
        return self.query_stats("user>>>", reset=reset, timeout=timeout)

    def get_outbounds_stats(self, reset=False, timeout=None):
        return self.query_stats("outbound>>>", reset=reset, timeout=timeout)


def test_user_stats_reset_xray_counters_like_marzban():
    api = FakeStatsAPI(
        [
            [
                ("user", "42.alice", "uplink", 100),
                ("user", "42.alice", "downlink", 300),
            ],
            [
                ("user", "42.alice", "uplink", 150),
                ("user", "42.alice", "downlink", 450),
            ],
        ]
    )

    assert get_users_stats(api) == [{"uid": "42", "value": 400}]
    assert get_users_stats(api) == [{"uid": "42", "value": 600}]
    assert [call["reset"] for call in api.calls] == [True, True]


def test_user_stats_records_each_reset_batch_without_in_memory_baseline():
    api = FakeStatsAPI(
        [
            [("user", "42.alice", "uplink", 100)],
            [("user", "42.alice", "uplink", 150)],
            [("user", "42.alice", "uplink", 20)],
            [("user", "42.alice", "uplink", 35)],
        ]
    )

    assert get_users_stats(api) == [{"uid": "42", "value": 100}]
    assert get_users_stats(api) == [{"uid": "42", "value": 150}]
    assert get_users_stats(api) == [{"uid": "42", "value": 20}]
    assert get_users_stats(api) == [{"uid": "42", "value": 35}]


def test_outbound_stats_reset_xray_counters_and_ignore_api_outbound():
    api = FakeStatsAPI(
        [
            [
                ("outbound", "proxy", "uplink", 10),
                ("outbound", "proxy", "downlink", 20),
                ("outbound", "api", "uplink", 100),
            ],
            [
                ("outbound", "proxy", "uplink", 17),
                ("outbound", "proxy", "downlink", 31),
                ("outbound", "api", "uplink", 120),
            ],
        ]
    )

    assert get_outbounds_stats(api) == [{"up": 10, "down": 20, "tag": "proxy"}]
    assert get_outbounds_stats(api) == [{"up": 17, "down": 31, "tag": "proxy"}]
    assert [call["reset"] for call in api.calls] == [True, True]


def test_node_user_collection_prefers_direct_stats_api_over_rest_batches():
    api = FakeStatsAPI(
        [
            [("user", "42.alice", "uplink", 10)],
            [("user", "42.alice", "uplink", 25)],
        ]
    )

    class NodeWithBothPaths:
        def __init__(self):
            self.api = api
            self.rest_called = False

        def collect_user_stats(self):
            self.rest_called = True
            return {"batch_id": "rest-batch", "stats": [{"uid": "42", "value": 999}]}

    node = NodeWithBothPaths()

    assert _collect_user_stats(node) == {"stats": [{"uid": "42", "value": 10}], "node_batch_id": ""}
    assert _collect_user_stats(node) == {"stats": [{"uid": "42", "value": 25}], "node_batch_id": ""}
    assert node.rest_called is False
