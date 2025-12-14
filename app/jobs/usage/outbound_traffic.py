"""Job to record outbound traffic statistics."""

import logging

from app.db import GetDB
from app.db.models import OutboundTraffic
from app.jobs.usage.collectors import get_outbounds_stats
from app.runtime import xray
from app.utils.outbound import extract_outbound_metadata, generate_outbound_id

logger = logging.getLogger(__name__)


def record_outbound_traffic():
    """Record outbound traffic statistics to database."""
    try:
        # Get outbound stats from Xray API
        stats_list = get_outbounds_stats(xray.api)
        if not stats_list:
            return

        # Get current outbound configs to extract metadata
        outbounds_config = xray.config.get("outbounds", [])
        outbounds_by_tag = {outbound.get("tag", ""): outbound for outbound in outbounds_config}

        with GetDB() as db:
            for stat in stats_list:
                tag = stat.get("tag", "")
                if not tag:
                    continue

                # Find the outbound config for this tag
                outbound_config = outbounds_by_tag.get(tag)
                if not outbound_config:
                    # Outbound not found in config, skip
                    continue

                # Generate unique ID for this outbound (stable even if tag changes)
                outbound_id = generate_outbound_id(outbound_config)

                # Extract metadata
                metadata = extract_outbound_metadata(outbound_config)

                # Check if outbound traffic record exists
                existing = db.query(OutboundTraffic).filter(OutboundTraffic.outbound_id == outbound_id).first()

                if not existing and metadata.get("tag"):
                    # Migrate legacy rows saved by tag to the new outbound_id-based key
                    legacy = db.query(OutboundTraffic).filter(OutboundTraffic.tag == metadata["tag"]).first()
                    if legacy:
                        existing = legacy
                        existing.outbound_id = outbound_id

                if existing:
                    # Update existing record
                    existing.uplink += stat.get("up", 0)
                    existing.downlink += stat.get("down", 0)
                    # Update metadata in case it changed
                    if metadata.get("tag") is not None:
                        existing.tag = metadata["tag"]
                    if metadata.get("protocol") is not None:
                        existing.protocol = metadata["protocol"]
                    if metadata.get("address") is not None:
                        existing.address = metadata["address"]
                    if metadata.get("port") is not None:
                        existing.port = metadata["port"]
                else:
                    # Create new record
                    new_record = OutboundTraffic(
                        outbound_id=outbound_id,
                        tag=metadata.get("tag"),
                        protocol=metadata.get("protocol"),
                        address=metadata.get("address"),
                        port=metadata.get("port"),
                        uplink=stat.get("up", 0),
                        downlink=stat.get("down", 0),
                    )
                    db.add(new_record)

            db.commit()
            logger.debug(f"Recorded traffic for {len(stats_list)} outbounds")

    except Exception as e:
        logger.error(f"Failed to record outbound traffic: {e}", exc_info=True)
