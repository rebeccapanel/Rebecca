from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import re
from typing import Iterable, List, Optional

# Xray log timestamp format:
# 2026/01/27 18:38:07.652022 [Info] ...
_TS_RE = re.compile(
    r"^(?P<date>\d{4}/\d{2}/\d{2})\s+"
    r"(?P<time>\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<frac>\d{1,6}))?"
    r"\s+"
)


@dataclass(frozen=True)
class ParsedLogLine:
    line: str
    index: int
    timestamp: Optional[datetime]
    anchor_timestamp: Optional[datetime]


def _parse_timestamp(line: str) -> Optional[datetime]:
    """
    Parse the leading Xray timestamp when present.

    Returns None for lines without a recognizable timestamp.
    """
    match = _TS_RE.match(line)
    if not match:
        return None

    date_part = match.group("date")
    time_part = match.group("time")
    frac_part = match.group("frac")

    try:
        base = datetime.strptime(f"{date_part} {time_part}", "%Y/%m/%d %H:%M:%S")
    except ValueError:
        return None

    if not frac_part:
        return base

    # Normalize fractional seconds to microseconds.
    frac = (frac_part[:6]).ljust(6, "0")
    try:
        micros = int(frac)
    except ValueError:
        return base

    return base.replace(microsecond=micros)


def normalize_log_chunk(chunk: str) -> List[str]:
    """
    Split a websocket log chunk into individual non-empty lines.
    """
    if not chunk:
        return []
    return [line.strip() for line in chunk.splitlines() if line and line.strip()]


def _parse_with_anchors(lines: Iterable[str]) -> List[ParsedLogLine]:
    parsed: List[ParsedLogLine] = []
    last_ts: Optional[datetime] = None

    for index, line in enumerate(lines):
        ts = _parse_timestamp(line)
        if ts is not None:
            last_ts = ts
        parsed.append(
            ParsedLogLine(
                line=line,
                index=index,
                timestamp=ts,
                anchor_timestamp=last_ts,
            )
        )

    return parsed


def sort_log_lines(lines: List[str]) -> List[str]:
    """
    Sort log lines chronologically when they include Xray timestamps.

    We use the last seen timestamp as an anchor for non-timestamp lines so
    that banner/startup lines stay close to their surrounding timestamps.
    """
    if len(lines) < 2:
        return lines

    parsed = _parse_with_anchors(lines)
    timestamps = [item.timestamp for item in parsed if item.timestamp is not None]
    if not timestamps:
        return lines

    earliest = min(timestamps)
    before_all = earliest - timedelta(microseconds=1)

    def _key(item: ParsedLogLine):
        anchor = item.anchor_timestamp or before_all
        # When anchor ties, keep timestamped lines before untimestamped lines,
        # then preserve original order for stability.
        return (anchor, item.timestamp is None, item.index)

    ordered = sorted(parsed, key=_key)
    return [item.line for item in ordered]
