"""Helpers and job entrypoint for recording outbound traffic statistics."""

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from app.db import GetDB
from app.db.models import OutboundTraffic
from app.jobs.usage.collectors import get_outbounds_stats
from app.jobs.usage.delivery_buffer import usage_delivery_buffer
from app.runtime import xray
from app.utils.outbound import extract_outbound_metadata, generate_outbound_id

logger = logging.getLogger(__name__)


def _load_outbound_configs() -> dict[str, dict]:
    try:
        outbounds_config = xray.config.get("outbounds", [])
    except Exception:
        logger.warning("Failed to get outbound configs from xray.config")
        outbounds_config = []

    return {outbound.get("tag", ""): outbound for outbound in outbounds_config if isinstance(outbound, dict)}


def _aggregate_by_tag(api_params: dict) -> dict[str, dict]:
    stats_by_tag: dict[str, dict] = {}
    for params in api_params.values():
        for stat in params or []:
            tag = str(stat.get("tag") or "").strip()
            if not tag:
                continue
            item = stats_by_tag.setdefault(tag, {"up": 0, "down": 0, "tag": tag})
            item["up"] += int(stat.get("up") or 0)
            item["down"] += int(stat.get("down") or 0)
    return stats_by_tag


def _apply_metadata(record: OutboundTraffic, outbound_config: dict | None, tag: str) -> None:
    if not outbound_config:
        if not record.tag:
            record.tag = tag
        return

    metadata = extract_outbound_metadata(outbound_config)
    record.tag = metadata.get("tag") or tag
    if metadata.get("protocol") is not None:
        record.protocol = metadata["protocol"]
    if metadata.get("address") is not None:
        record.address = metadata["address"]
    if metadata.get("port") is not None:
        record.port = metadata["port"]


def _persist_outbound_traffic(db, api_params: dict) -> tuple[int, int, int]:
    stats_by_tag = _aggregate_by_tag(api_params)
    if not stats_by_tag:
        return 0, 0, 0

    outbounds_by_tag = _load_outbound_configs()
    records_updated = 0
    records_created = 0

    for tag, stat in stats_by_tag.items():
        up = int(stat.get("up") or 0)
        down = int(stat.get("down") or 0)
        if not (up or down):
            continue

        outbound_config = outbounds_by_tag.get(tag)
        outbound_id = generate_outbound_id(outbound_config) if outbound_config else f"tag_{tag}"
        existing = db.query(OutboundTraffic).filter(OutboundTraffic.outbound_id == outbound_id).first()
        if existing is None:
            existing = db.query(OutboundTraffic).filter(OutboundTraffic.tag == tag).first()

        if existing:
            existing.uplink = int(existing.uplink or 0) + up
            existing.downlink = int(existing.downlink or 0) + down
            existing.outbound_id = outbound_id
            _apply_metadata(existing, outbound_config, tag)
            records_updated += 1
            continue

        metadata = extract_outbound_metadata(outbound_config) if outbound_config else {}
        db.add(
            OutboundTraffic(
                outbound_id=outbound_id,
                tag=metadata.get("tag") or tag,
                protocol=metadata.get("protocol"),
                address=metadata.get("address"),
                port=metadata.get("port"),
                uplink=up,
                downlink=down,
            )
        )
        records_created += 1

    return records_updated, records_created, len(stats_by_tag)


def record_outbound_traffic_from_params(api_params: dict) -> None:
    """Persist already-collected outbound stats without querying/resetting Xray again."""
    if not any(api_params.values()):
        logger.debug("No valid outbound stats with tags found")
        return

    with GetDB() as db:
        records_updated, records_created, stats_count = _persist_outbound_traffic(db, api_params)
        db.commit()

    if records_updated > 0 or records_created > 0:
        logger.info(
            "Recorded outbound traffic: %s updated, %s created, %s outbounds",
            records_updated,
            records_created,
            stats_count,
        )


def _is_missing_node_usage_endpoint(exc: Exception) -> bool:
    return getattr(exc, "status_code", None) in (404, 405)


def _collect_node_outbound_stats(node):
    if not hasattr(node, "collect_outbound_stats"):
        return {"stats": get_outbounds_stats(node.api), "node_batch_id": ""}
    try:
        payload = node.collect_outbound_stats()
        return {
            "stats": payload.get("stats") or [],
            "node_batch_id": payload.get("batch_id") or "",
        }
    except Exception as exc:
        if not _is_missing_node_usage_endpoint(exc):
            raise

    return {"stats": get_outbounds_stats(node.api), "node_batch_id": ""}


def _ack_node_outbound_batches(node_batches: dict[int, str]) -> None:
    for node_id, batch_id in node_batches.items():
        if not batch_id:
            continue
        node = xray.nodes.get(node_id)
        if not node:
            continue
        try:
            node.ack_outbound_stats(batch_id)
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning("Failed to ack outbound usage batch %s for node %s: %s", batch_id, node_id, exc)


def record_outbound_traffic():
    """Record outbound traffic statistics to database."""
    try:
        # Collect API instances (master core + nodes)
        collectors = {}
        try:
            if getattr(xray.core, "available", False) and getattr(xray.core, "started", False):
                collectors[None] = partial(get_outbounds_stats, xray.api)
        except Exception:
            # Skip master core if it's unavailable; still record from nodes
            pass

        # Add node API instances
        for node_id, node in list(xray.nodes.items()):
            if node.connected and node.started:
                collectors[node_id] = partial(_collect_node_outbound_stats, node)

        if not collectors:
            logger.debug("No Xray API instances available for outbound traffic recording")
            return

        # Get outbound stats from all API instances in parallel
        api_params = {}
        node_batches = {}
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {node_id: executor.submit(collector) for node_id, collector in collectors.items()}
            for node_id, future in futures.items():
                try:
                    result = future.result()
                    if isinstance(result, dict):
                        node_batches[node_id] = result.get("node_batch_id") or ""
                        result = result.get("stats") or []
                    api_params[node_id] = usage_delivery_buffer.add_outbound_stats(node_id, result)
                except Exception as e:
                    logger.warning(
                        f"Failed to get outbound stats from {'master' if node_id is None else f'node {node_id}'}: {e}"
                    )
                    api_params[node_id] = usage_delivery_buffer.pending_outbound_stats(node_id)

        if not any(api_params.values()):
            logger.debug("No outbound stats collected")
            return

        record_outbound_traffic_from_params(api_params)
        usage_delivery_buffer.ack_outbound_stats_for(api_params.keys())
        _ack_node_outbound_batches(node_batches)

    except Exception as e:
        logger.error(f"Failed to record outbound traffic: {e}", exc_info=True)
