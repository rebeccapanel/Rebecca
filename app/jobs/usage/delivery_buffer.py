"""In-memory delivery buffer for usage samples collected with Xray reset=True."""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Optional


class UsageDeliveryBuffer:
    """Keep reset Xray samples pending until the database write succeeds."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._users: dict[Optional[int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._outbounds: dict[Optional[int], dict[str, dict[str, int | str]]] = defaultdict(dict)

    def add_user_stats(self, node_id: Optional[int], samples: list[dict] | None) -> list[dict]:
        with self._lock:
            bucket = self._users[node_id]
            for sample in samples or []:
                uid = str(sample.get("uid") or "").strip()
                if not uid:
                    continue
                value = int(sample.get("value") or 0)
                if value:
                    bucket[uid] += value
            return self.pending_user_stats(node_id)

    def pending_user_stats(self, node_id: Optional[int]) -> list[dict]:
        with self._lock:
            bucket = self._users.get(node_id, {})
            return [{"uid": uid, "value": value} for uid, value in bucket.items() if value]

    def ack_user_stats(self, node_id: Optional[int]) -> None:
        with self._lock:
            self._users.pop(node_id, None)

    def ack_user_stats_for(self, node_ids) -> None:
        for node_id in list(node_ids):
            self.ack_user_stats(node_id)

    def add_outbound_stats(self, node_id: Optional[int], samples: list[dict] | None) -> list[dict]:
        with self._lock:
            bucket = self._outbounds[node_id]
            for sample in samples or []:
                tag = str(sample.get("tag") or "").strip()
                if not tag:
                    continue
                up = int(sample.get("up") or 0)
                down = int(sample.get("down") or 0)
                if not (up or down):
                    continue
                current = bucket.setdefault(tag, {"tag": tag, "up": 0, "down": 0})
                current["up"] = int(current.get("up") or 0) + up
                current["down"] = int(current.get("down") or 0) + down
            return self.pending_outbound_stats(node_id)

    def pending_outbound_stats(self, node_id: Optional[int]) -> list[dict]:
        with self._lock:
            bucket = self._outbounds.get(node_id, {})
            return [
                {"tag": tag, "up": int(values.get("up") or 0), "down": int(values.get("down") or 0)}
                for tag, values in bucket.items()
                if int(values.get("up") or 0) or int(values.get("down") or 0)
            ]

    def ack_outbound_stats(self, node_id: Optional[int]) -> None:
        with self._lock:
            self._outbounds.pop(node_id, None)

    def ack_outbound_stats_for(self, node_ids) -> None:
        for node_id in list(node_ids):
            self.ack_outbound_stats(node_id)

    def clear(self) -> None:
        with self._lock:
            self._users.clear()
            self._outbounds.clear()


usage_delivery_buffer = UsageDeliveryBuffer()
