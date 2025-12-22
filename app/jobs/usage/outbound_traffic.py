"""Job to record outbound traffic statistics."""

import logging
from concurrent.futures import ThreadPoolExecutor

from app.db import GetDB
from app.db.models import OutboundTraffic
from app.jobs.usage.collectors import get_outbounds_stats
from app.runtime import xray
from app.utils.outbound import extract_outbound_metadata, generate_outbound_id

logger = logging.getLogger(__name__)


def record_outbound_traffic():
    """Record outbound traffic statistics to database."""
    try:
        # Collect API instances (master core + nodes)
        api_instances = {}
        try:
            if getattr(xray.core, "available", False) and getattr(xray.core, "started", False):
                api_instances[None] = xray.api
        except Exception:
            # Skip master core if it's unavailable; still record from nodes
            pass

        # Add node API instances
        for node_id, node in list(xray.nodes.items()):
            if node.connected and node.started:
                api_instances[node_id] = node.api

        if not api_instances:
            logger.debug("No Xray API instances available for outbound traffic recording")
            return

        # Get outbound stats from all API instances in parallel
        all_stats = []
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {node_id: executor.submit(get_outbounds_stats, api) for node_id, api in api_instances.items()}
            for node_id, future in futures.items():
                try:
                    stats_list = future.result()
                    if stats_list:
                        all_stats.extend(stats_list)
                except Exception as e:
                    logger.warning(f"Failed to get outbound stats from {'master' if node_id is None else f'node {node_id}'}: {e}")

        if not all_stats:
            logger.debug("No outbound stats collected")
            return

        # Get current outbound configs to extract metadata
        try:
            outbounds_config = xray.config.get("outbounds", [])
        except Exception:
            logger.warning("Failed to get outbound configs from xray.config")
            outbounds_config = []

        outbounds_by_tag = {outbound.get("tag", ""): outbound for outbound in outbounds_config if isinstance(outbound, dict)}

        # Aggregate stats by tag (in case same tag appears from multiple nodes)
        stats_by_tag = {}
        for stat in all_stats:
            tag = stat.get("tag", "")
            if not tag:
                continue
            if tag not in stats_by_tag:
                stats_by_tag[tag] = {"up": 0, "down": 0, "tag": tag}
            stats_by_tag[tag]["up"] += stat.get("up", 0)
            stats_by_tag[tag]["down"] += stat.get("down", 0)

        if not stats_by_tag:
            logger.debug("No valid outbound stats with tags found")
            return

        # Save to database - exactly like 3x-ui: save by tag directly
        with GetDB() as db:
            records_updated = 0
            records_created = 0

            for tag, stat in stats_by_tag.items():
                # Skip if no traffic
                if not stat.get("up", 0) and not stat.get("down", 0):
                    continue
                
                # Find or create outbound traffic record by tag (like 3x-ui)
                existing = db.query(OutboundTraffic).filter(OutboundTraffic.tag == tag).first()
                
                if existing:
                    # Update existing record - add traffic (like 3x-ui: outbound.Up = outbound.Up + traffic.Up)
                    existing.uplink += stat.get("up", 0)
                    existing.downlink += stat.get("down", 0)
                    
                    # Update metadata if outbound config exists
                    outbound_config = outbounds_by_tag.get(tag)
                    if outbound_config:
                        metadata = extract_outbound_metadata(outbound_config)
                        if metadata.get("protocol") is not None:
                            existing.protocol = metadata["protocol"]
                        if metadata.get("address") is not None:
                            existing.address = metadata["address"]
                        if metadata.get("port") is not None:
                            existing.port = metadata["port"]
                        # Update outbound_id if config exists
                        outbound_id = generate_outbound_id(outbound_config)
                        if existing.outbound_id != outbound_id:
                            existing.outbound_id = outbound_id
                    records_updated += 1
                else:
                    # Create new record
                    outbound_config = outbounds_by_tag.get(tag)
                    if outbound_config:
                        # Extract metadata from config
                        metadata = extract_outbound_metadata(outbound_config)
                        outbound_id = generate_outbound_id(outbound_config)
                    else:
                        # No config found, use tag as fallback
                        metadata = {"tag": tag, "protocol": None, "address": None, "port": None}
                        outbound_id = None
                    
                    new_record = OutboundTraffic(
                        outbound_id=outbound_id or f"tag_{tag}",
                        tag=tag,
                        protocol=metadata.get("protocol"),
                        address=metadata.get("address"),
                        port=metadata.get("port"),
                        uplink=stat.get("up", 0),
                        downlink=stat.get("down", 0),
                    )
                    db.add(new_record)
                    records_created += 1

            db.commit()
            if records_updated > 0 or records_created > 0:
                logger.info(f"Recorded outbound traffic: {records_updated} updated, {records_created} created, {len(stats_by_tag)} outbounds")

    except Exception as e:
        logger.error(f"Failed to record outbound traffic: {e}", exc_info=True)


