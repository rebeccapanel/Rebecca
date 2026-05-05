from __future__ import annotations

import math
import tempfile
import threading
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import Iterator

import jdatetime
from telebot.formatting import escape_html

from app.runtime import logger
from app.services.rebecca_backup import RebeccaBackupError, RebeccaBackupService, _safe_unlink
from app.services.telegram_settings import TelegramSettingsData, TelegramSettingsService
from app.telegram import ensure_forum_topic, get_bot
from app.telegram.handlers.report import _send_with_retry
from app.utils.binary_control import is_binary_runtime


CATEGORY_BACKUP = "backup"
MAX_TELEGRAM_PART_SIZE = 49 * 1024 * 1024

_backup_lock = threading.Lock()


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _interval_delta(settings: TelegramSettingsData) -> timedelta:
    value = max(int(settings.backup_interval_value or 1), 1)
    unit = settings.backup_interval_unit or "hours"
    if unit == "minutes":
        return timedelta(minutes=value)
    if unit == "days":
        return timedelta(days=value)
    return timedelta(hours=value)


def _is_due(settings: TelegramSettingsData, *, now: datetime) -> bool:
    if not settings.backup_last_sent_at:
        return True
    last_sent = settings.backup_last_sent_at
    if last_sent.tzinfo is not None:
        last_sent = last_sent.astimezone(UTC).replace(tzinfo=None)
    return now >= last_sent + _interval_delta(settings)


def _format_backup_time(timestamp: datetime) -> tuple[str, str, str]:
    aware = timestamp.replace(tzinfo=UTC).astimezone()
    gregorian_date = aware.strftime("%Y-%m-%d")
    jalali = jdatetime.datetime.fromgregorian(datetime=aware)
    jalali_date = jalali.strftime("%Y-%m-%d")
    clock = aware.strftime("%H:%M:%S %Z").strip()
    return gregorian_date, jalali_date, clock


def _build_caption(
    *,
    filename: str,
    scope: str,
    timestamp: datetime,
    part_number: int,
    total_parts: int,
) -> str:
    gregorian_date, jalali_date, clock = _format_backup_time(timestamp)
    return "\n".join(
        [
            "<b>Rebecca backup</b>",
            f"File: <code>{escape_html(filename)}</code>",
            f"Scope: <code>{escape_html(scope)}</code>",
            f"Gregorian date: <code>{gregorian_date}</code>",
            f"Jalali date: <code>{jalali_date}</code>",
            f"Time: <code>{escape_html(clock)}</code>",
            f"Part: <code>{part_number}/{total_parts}</code>",
        ]
    )


def _build_finished_message(*, scope: str, timestamp: datetime, total_parts: int) -> str:
    gregorian_date, jalali_date, clock = _format_backup_time(timestamp)
    return "\n".join(
        [
            "<b>Rebecca backup finished</b>",
            f"Scope: <code>{escape_html(scope)}</code>",
            f"Gregorian date: <code>{gregorian_date}</code>",
            f"Jalali date: <code>{jalali_date}</code>",
            f"Time: <code>{escape_html(clock)}</code>",
            f"Parts: <code>{total_parts}</code>",
        ]
    )


def _part_paths(source: Path, filename: str, *, temp_dir: Path) -> list[Path]:
    size = source.stat().st_size
    total_parts = max(1, math.ceil(size / MAX_TELEGRAM_PART_SIZE))
    if total_parts <= 1:
        return [source]

    paths: list[Path] = []
    with source.open("rb") as reader:
        for index in range(1, total_parts + 1):
            part_path = temp_dir / f"{filename}.part{index:03d}-of-{total_parts:03d}"
            with part_path.open("wb") as writer:
                writer.write(reader.read(MAX_TELEGRAM_PART_SIZE))
            paths.append(part_path)
    return paths


def _target_kwargs(settings: TelegramSettingsData, bot_instance) -> Iterator[tuple[int, dict, str]]:
    if settings.logs_chat_id:
        kwargs = {"parse_mode": "HTML"}
        if settings.logs_chat_is_forum:
            thread_id = ensure_forum_topic(CATEGORY_BACKUP, bot_instance=bot_instance, settings=settings)
            if thread_id:
                kwargs["message_thread_id"] = thread_id
        yield settings.logs_chat_id, kwargs, f"logs chat {settings.logs_chat_id}"
        return

    for admin_id in settings.admin_chat_ids or []:
        yield admin_id, {"parse_mode": "HTML"}, f"admin chat {admin_id}"


def _send_backup_to_telegram(
    *,
    settings: TelegramSettingsData,
    backup_path: Path,
    filename: str,
    scope: str,
    timestamp: datetime,
) -> int:
    bot_instance, current_settings = get_bot(with_settings=True)
    settings = current_settings or settings
    if not bot_instance:
        raise RebeccaBackupError("Telegram bot is not configured")

    targets = list(_target_kwargs(settings, bot_instance))
    if not targets:
        raise RebeccaBackupError("Telegram backup has no target chat configured")

    with tempfile.TemporaryDirectory(prefix="rebecca-telegram-backup-parts-") as temp_dir_name:
        parts = _part_paths(backup_path, filename, temp_dir=Path(temp_dir_name))
        total_parts = len(parts)
        for target_chat_id, base_kwargs, target_desc in targets:
            for index, part_path in enumerate(parts, start=1):
                part_name = filename if total_parts == 1 else part_path.name
                caption = _build_caption(
                    filename=part_name,
                    scope=scope,
                    timestamp=timestamp,
                    part_number=index,
                    total_parts=total_parts,
                )

                def _send_document() -> None:
                    with part_path.open("rb") as handle:
                        bot_instance.send_document(
                            target_chat_id,
                            handle,
                            caption=caption,
                            **base_kwargs,
                        )

                if not _send_with_retry(
                    _send_document,
                    category=CATEGORY_BACKUP,
                    target_desc=target_desc,
                ):
                    raise RebeccaBackupError(f"Failed to send backup part {index}/{total_parts} to {target_desc}")

            final_message = _build_finished_message(scope=scope, timestamp=timestamp, total_parts=total_parts)

            def _send_finished() -> None:
                bot_instance.send_message(target_chat_id, final_message, **base_kwargs)

            if not _send_with_retry(
                _send_finished,
                category=CATEGORY_BACKUP,
                target_desc=target_desc,
            ):
                raise RebeccaBackupError(f"Failed to send backup finished message to {target_desc}")

        return total_parts


def run_periodic_telegram_backup(*, force: bool = False) -> bool:
    if not _backup_lock.acquire(blocking=False):
        logger.info("Telegram backup job is already running; skipping this tick")
        return False

    export_path: Path | None = None
    try:
        settings = TelegramSettingsService.get_settings(ensure_record=True)
        if not settings.backup_enabled:
            return False

        now = _utc_now()
        if not force and not _is_due(settings, now=now):
            return False

        if not is_binary_runtime():
            error = "Periodic Telegram backups are available only on binary installations"
            TelegramSettingsService.update_backup_status(error=error)
            logger.warning(error)
            return False

        export = RebeccaBackupService().export_backup(settings.backup_scope)
        export_path = export.path
        sent_parts = _send_backup_to_telegram(
            settings=settings,
            backup_path=export.path,
            filename=export.filename,
            scope=export.scope,
            timestamp=now,
        )
        TelegramSettingsService.update_backup_status(sent_at=now)
        logger.info("Telegram backup sent successfully with %s part(s)", sent_parts)
        return True
    except Exception as exc:
        error = str(exc) or exc.__class__.__name__
        TelegramSettingsService.update_backup_status(error=error)
        logger.exception("Periodic Telegram backup failed: %s", error)
        return False
    finally:
        if export_path:
            _safe_unlink(export_path)
        _backup_lock.release()
