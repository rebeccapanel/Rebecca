"""In-memory delivery buffer for usage samples until the database write succeeds."""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Optional


class UsageDeliveryBuffer:
    """Keep usage samples pending until the database write succeeds."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._users: dict[Optional[int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._outbounds: dict[Optional[int], dict[str, dict[str, int | str]]] = defaultdict(dict)
        self._user_batch_offsets: dict[Optional[int], tuple[str, dict[str, int]]] = {}
        self._user_batch_totals: dict[Optional[int], tuple[str, dict[str, int]]] = {}
        self._outbound_batch_offsets: dict[Optional[int], tuple[str, dict[str, dict[str, int | str]]]] = {}
        self._outbound_batch_totals: dict[Optional[int], tuple[str, dict[str, dict[str, int | str]]]] = {}

    @staticmethod
    def _normalize_user_samples(samples: list[dict] | None) -> dict[str, int]:
        bucket: dict[str, int] = defaultdict(int)
        for sample in samples or []:
            uid = str(sample.get("uid") or "").strip()
            if not uid:
                continue
            value = int(sample.get("value") or 0)
            if value:
                bucket[uid] += value
        return dict(bucket)

    @staticmethod
    def _normalize_outbound_samples(samples: list[dict] | None) -> dict[str, dict[str, int | str]]:
        bucket: dict[str, dict[str, int | str]] = {}
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
        return bucket

    def add_user_stats(self, node_id: Optional[int], samples: list[dict] | None) -> list[dict]:
        with self._lock:
            bucket = self._users[node_id]
            for uid, value in self._normalize_user_samples(samples).items():
                bucket[uid] += value
            return self.pending_user_stats(node_id)

    def replace_user_stats(
        self, node_id: Optional[int], samples: list[dict] | None, batch_id: Optional[str] = None
    ) -> list[dict]:
        with self._lock:
            bucket = self._normalize_user_samples(samples)
            batch_id = str(batch_id or "").strip()
            if batch_id:
                offset_batch_id, offsets = self._user_batch_offsets.get(node_id, ("", {}))
                if offset_batch_id != batch_id:
                    offsets = {}
                self._user_batch_totals[node_id] = (batch_id, bucket)
                bucket = {
                    uid: delta
                    for uid, value in bucket.items()
                    if (delta := value - int(offsets.get(uid) or 0)) > 0
                }
            if bucket:
                self._users[node_id] = bucket
            else:
                self._users.pop(node_id, None)
            return self.pending_user_stats(node_id)

    def pending_user_stats(self, node_id: Optional[int]) -> list[dict]:
        with self._lock:
            bucket = self._users.get(node_id, {})
            return [{"uid": uid, "value": value} for uid, value in bucket.items() if value]

    def ack_user_stats(self, node_id: Optional[int], batch_id: Optional[str] = None) -> None:
        with self._lock:
            batch_id = str(batch_id or "").strip()
            if batch_id:
                current = self._user_batch_totals.get(node_id)
                if current and current[0] == batch_id:
                    self._user_batch_offsets[node_id] = (batch_id, dict(current[1]))
                    self._user_batch_totals.pop(node_id, None)
            self._users.pop(node_id, None)

    def ack_user_stats_for(self, node_ids, batch_ids: Optional[dict] = None) -> None:
        for node_id in list(node_ids):
            batch_id = batch_ids.get(node_id) if batch_ids else None
            self.ack_user_stats(node_id, batch_id)

    def add_outbound_stats(self, node_id: Optional[int], samples: list[dict] | None) -> list[dict]:
        with self._lock:
            bucket = self._outbounds[node_id]
            for tag, sample in self._normalize_outbound_samples(samples).items():
                up = int(sample.get("up") or 0)
                down = int(sample.get("down") or 0)
                current = bucket.setdefault(tag, {"tag": tag, "up": 0, "down": 0})
                current["up"] = int(current.get("up") or 0) + up
                current["down"] = int(current.get("down") or 0) + down
            return self.pending_outbound_stats(node_id)

    def replace_outbound_stats(
        self, node_id: Optional[int], samples: list[dict] | None, batch_id: Optional[str] = None
    ) -> list[dict]:
        with self._lock:
            bucket = self._normalize_outbound_samples(samples)
            batch_id = str(batch_id or "").strip()
            if batch_id:
                offset_batch_id, offsets = self._outbound_batch_offsets.get(node_id, ("", {}))
                if offset_batch_id != batch_id:
                    offsets = {}
                self._outbound_batch_totals[node_id] = (batch_id, bucket)
                delta_bucket: dict[str, dict[str, int | str]] = {}
                for tag, values in bucket.items():
                    offset = offsets.get(tag, {})
                    up = max(int(values.get("up") or 0) - int(offset.get("up") or 0), 0)
                    down = max(int(values.get("down") or 0) - int(offset.get("down") or 0), 0)
                    if up or down:
                        delta_bucket[tag] = {"tag": tag, "up": up, "down": down}
                bucket = delta_bucket
            if bucket:
                self._outbounds[node_id] = bucket
            else:
                self._outbounds.pop(node_id, None)
            return self.pending_outbound_stats(node_id)

    def pending_outbound_stats(self, node_id: Optional[int]) -> list[dict]:
        with self._lock:
            bucket = self._outbounds.get(node_id, {})
            return [
                {"tag": tag, "up": int(values.get("up") or 0), "down": int(values.get("down") or 0)}
                for tag, values in bucket.items()
                if int(values.get("up") or 0) or int(values.get("down") or 0)
            ]

    def ack_outbound_stats(self, node_id: Optional[int], batch_id: Optional[str] = None) -> None:
        with self._lock:
            batch_id = str(batch_id or "").strip()
            if batch_id:
                current = self._outbound_batch_totals.get(node_id)
                if current and current[0] == batch_id:
                    self._outbound_batch_offsets[node_id] = (batch_id, dict(current[1]))
                    self._outbound_batch_totals.pop(node_id, None)
            self._outbounds.pop(node_id, None)

    def ack_outbound_stats_for(self, node_ids, batch_ids: Optional[dict] = None) -> None:
        for node_id in list(node_ids):
            batch_id = batch_ids.get(node_id) if batch_ids else None
            self.ack_outbound_stats(node_id, batch_id)

    def clear(self) -> None:
        with self._lock:
            self._users.clear()
            self._outbounds.clear()
            self._user_batch_offsets.clear()
            self._user_batch_totals.clear()
            self._outbound_batch_offsets.clear()
            self._outbound_batch_totals.clear()


usage_delivery_buffer = UsageDeliveryBuffer()
