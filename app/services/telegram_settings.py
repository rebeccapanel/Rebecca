from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

from sqlalchemy.orm import Session

from app.db.base import SessionLocal
from app.db.models import TelegramSettings as TelegramSettingsModel
from config import (
    TELEGRAM_ADMIN_ID,
    TELEGRAM_API_TOKEN,
    TELEGRAM_DEFAULT_VLESS_FLOW,
    TELEGRAM_LOGGER_CHANNEL_ID,
    TELEGRAM_PROXY_URL,
)


@dataclass
class TelegramTopic:
    title: str
    topic_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Optional[Union[str, int]]]:
        return {"title": self.title, "topic_id": self.topic_id}


@dataclass
class TelegramSettingsData:
    api_token: Optional[str]
    proxy_url: Optional[str]
    admin_chat_ids: List[int] = field(default_factory=list)
    logs_chat_id: Optional[int] = None
    logs_chat_is_forum: bool = False
    default_vless_flow: Optional[str] = None
    forum_topics: Dict[str, TelegramTopic] = field(default_factory=dict)
    event_toggles: Dict[str, bool] = field(default_factory=dict)
    record_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Union[Optional[str], List[int], bool, Dict[str, Dict[str, Optional[Union[str, int]]]], Dict[str, bool]]]:
        payload: Dict[str, Union[Optional[str], List[int], bool, Dict[str, Dict[str, Optional[Union[str, int]]]], Dict[str, bool]]] = {
            "id": self.record_id,
            "api_token": self.api_token,
            "proxy_url": self.proxy_url,
            "admin_chat_ids": self.admin_chat_ids,
            "logs_chat_id": self.logs_chat_id,
            "logs_chat_is_forum": self.logs_chat_is_forum,
            "default_vless_flow": self.default_vless_flow,
            "forum_topics": {key: topic.to_dict() for key, topic in self.forum_topics.items()},
            "event_toggles": self.event_toggles,
        }
        return payload


class TelegramSettingsService:
    """Utility helpers for managing Telegram settings stored in database."""

    DEFAULT_TOPIC_TITLES: Dict[str, str] = {
        "users": "Users",
        "admins": "Admins",
        "nodes": "Nodes",
        "login": "Login",
        "errors": "Errors",
    }

    DEFAULT_EVENT_TOGGLES: Dict[str, bool] = {
        "user.created": True,
        "user.updated": True,
        "user.deleted": True,
        "user.status_change": True,
        "user.usage_reset": True,
        "user.auto_reset": True,
        "user.subscription_revoked": True,
        "admin.created": True,
        "admin.updated": True,
        "admin.deleted": True,
        "admin.usage_reset": True,
        "admin.limit.data": True,
        "admin.limit.users": True,
        "node.created": True,
        "node.deleted": True,
        "node.usage_reset": True,
        "node.status.connected": True,
        "node.status.connecting": True,
        "node.status.error": True,
        "node.status.disabled": True,
        "node.status.limited": True,
        "login": True,
        "errors.node": True,
    }

    ENV_FALLBACKS = {
        "api_token": TELEGRAM_API_TOKEN or None,
        "proxy_url": TELEGRAM_PROXY_URL or None,
        "logs_chat_id": TELEGRAM_LOGGER_CHANNEL_ID or None,
        "default_vless_flow": TELEGRAM_DEFAULT_VLESS_FLOW or None,
        "admin_chat_ids": TELEGRAM_ADMIN_ID or [],
    }

    @classmethod
    def _coerce_int(cls, value: Optional[Union[str, int]]) -> Optional[int]:
        if value in (None, "", 0):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid integer value: {value}")

    @classmethod
    def _coerce_bool(cls, value: Union[bool, str, int, None]) -> bool:
        if isinstance(value, bool):
            return value
        if value in (None, ""):
            return False
        if isinstance(value, int):
            return value != 0
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "on"}:
                return True
            if lowered in {"false", "0", "no", "off"}:
                return False
        raise ValueError(f"Invalid boolean value: {value}")

    @classmethod
    def _coerce_admin_ids(cls, value: Union[str, Iterable[Union[str, int]], None]) -> List[int]:
        if value is None:
            return []
        if isinstance(value, str):
            tokens = [token.strip() for token in value.split(",") if token.strip()]
        else:
            tokens = list(value)

        result: List[int] = []
        for token in tokens:
            if token in ("", None):
                continue
            try:
                result.append(int(token))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid admin chat id: {token}") from exc

        return result

    @classmethod
    def _prepare_forum_topics(
        cls, raw_topics: Optional[Dict[str, Dict[str, Optional[Union[str, int]]]]]
    ) -> Tuple[Dict[str, TelegramTopic], bool]:
        topics: Dict[str, TelegramTopic] = {}
        mutated = False
        source = raw_topics or {}

        for key, default_title in cls.DEFAULT_TOPIC_TITLES.items():
            payload = source.get(key) or {}
            title = payload.get("title") or default_title
            topic_id_value = payload.get("topic_id")
            topic_id: Optional[int] = None
            if topic_id_value not in (None, "", 0):
                try:
                    topic_id = int(topic_id_value)
                except (TypeError, ValueError):
                    topic_id = None
                    mutated = True
            topics[key] = TelegramTopic(title=title, topic_id=topic_id)

            if key not in source:
                mutated = True
            elif payload.get("title") != title:
                mutated = True

        if source.keys() - cls.DEFAULT_TOPIC_TITLES.keys():
            # preserve extra topics in case they've been stored previously
            for extra_key in source.keys() - cls.DEFAULT_TOPIC_TITLES.keys():
                payload = source.get(extra_key) or {}
                title = payload.get("title") or extra_key.title()
                topic_id_value = payload.get("topic_id")
                try:
                    topic_id = (
                        None if topic_id_value in (None, "", 0) else int(topic_id_value)
                    )
                except (TypeError, ValueError):
                    topic_id = None
                    mutated = True
                topics[extra_key] = TelegramTopic(title=title, topic_id=topic_id)

        return topics, mutated

    @classmethod
    def _prepare_event_toggles(
        cls, raw_toggles: Optional[Dict[str, Any]]
    ) -> Tuple[Dict[str, bool], bool]:
        toggles: Dict[str, bool] = {}
        mutated = False
        source = raw_toggles or {}

        for key, default_value in cls.DEFAULT_EVENT_TOGGLES.items():
            value = source.get(key, default_value)
            try:
                toggles[key] = cls._coerce_bool(value)
            except ValueError:
                toggles[key] = default_value
                mutated = True
            else:
                if key not in source:
                    mutated = True

        for extra_key, value in source.items():
            if extra_key in toggles:
                continue
            try:
                toggles[extra_key] = cls._coerce_bool(value)
            except ValueError:
                toggles[extra_key] = True
                mutated = True

        if len(toggles) != len(source):
            mutated = True

        return toggles, mutated

    @classmethod
    def _merge_with_env(
        cls, record: Optional[TelegramSettingsModel]
    ) -> TelegramSettingsData:
        api_token = (record.api_token if record and record.api_token else None) or cls.ENV_FALLBACKS["api_token"]
        proxy_url = (record.proxy_url if record and record.proxy_url else None) or cls.ENV_FALLBACKS["proxy_url"]
        logs_chat_id = cls._coerce_int(
            record.logs_chat_id if record else cls.ENV_FALLBACKS["logs_chat_id"]
        )
        admin_chat_ids = (
            cls._coerce_admin_ids(record.admin_chat_ids)
            if record and record.admin_chat_ids
            else cls._coerce_admin_ids(cls.ENV_FALLBACKS["admin_chat_ids"])
        )
        default_vless_flow = (
            record.default_vless_flow if record and record.default_vless_flow else cls.ENV_FALLBACKS["default_vless_flow"]
        )
        logs_chat_is_forum = (
            cls._coerce_bool(record.logs_chat_is_forum) if record else False
        )
        topics_dict, _ = cls._prepare_forum_topics(
            record.forum_topics if record else None
        )
        event_toggles, _ = cls._prepare_event_toggles(
            record.event_toggles if record and record.event_toggles else None
        )

        return TelegramSettingsData(
            api_token=api_token or None,
            proxy_url=proxy_url or None,
            admin_chat_ids=admin_chat_ids,
            logs_chat_id=logs_chat_id,
            logs_chat_is_forum=logs_chat_is_forum,
            default_vless_flow=default_vless_flow or None,
            forum_topics=topics_dict,
            event_toggles=event_toggles,
            record_id=record.id if record else None,
        )

    @classmethod
    def get_settings(cls, db: Optional[Session] = None, ensure_record: bool = False) -> TelegramSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            record = db.query(TelegramSettingsModel).first()
            if record is None and ensure_record:
                record = TelegramSettingsModel(
                    forum_topics={
                        key: {"title": title, "topic_id": None}
                        for key, title in cls.DEFAULT_TOPIC_TITLES.items()
                    },
                    event_toggles=cls.DEFAULT_EVENT_TOGGLES.copy(),
                    admin_chat_ids=cls._coerce_admin_ids(cls.ENV_FALLBACKS["admin_chat_ids"]),
                )
                db.add(record)
                db.commit()
                db.refresh(record)

            if record:
                topics, mutated_topics = cls._prepare_forum_topics(record.forum_topics)
                toggles, mutated_toggles = cls._prepare_event_toggles(
                    record.event_toggles
                )
                if mutated_topics or mutated_toggles or record.event_toggles is None:
                    record.forum_topics = {
                        key: topic.to_dict() for key, topic in topics.items()
                    }
                    record.event_toggles = toggles
                    record.updated_at = datetime.utcnow()
                    db.add(record)
                    db.commit()
                    db.refresh(record)

            return cls._merge_with_env(record)
        finally:
            if close_db:
                db.close()

    @classmethod
    def update_settings(
        cls,
        payload: Dict[str, Any],
        db: Optional[Session] = None,
    ) -> TelegramSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            record = db.query(TelegramSettingsModel).first()
            if record is None:
                record = TelegramSettingsModel(
                    forum_topics={
                        key: {"title": title, "topic_id": None}
                        for key, title in cls.DEFAULT_TOPIC_TITLES.items()
                    },
                    event_toggles=cls.DEFAULT_EVENT_TOGGLES.copy(),
                    admin_chat_ids=cls._coerce_admin_ids(cls.ENV_FALLBACKS["admin_chat_ids"]),
                )
                db.add(record)
                db.flush()

            should_reload = False

            if "api_token" in payload:
                new_token = payload["api_token"] or None
                if new_token != record.api_token:
                    record.api_token = new_token
                    should_reload = True

            if "proxy_url" in payload:
                new_proxy = payload["proxy_url"] or None
                if new_proxy != record.proxy_url:
                    record.proxy_url = new_proxy
                    should_reload = True

            if "logs_chat_id" in payload:
                new_chat_id = cls._coerce_int(payload["logs_chat_id"])
                if new_chat_id != record.logs_chat_id:
                    record.logs_chat_id = new_chat_id
                    should_reload = True

            if "logs_chat_is_forum" in payload:
                new_forum_flag = cls._coerce_bool(payload["logs_chat_is_forum"])
                if new_forum_flag != record.logs_chat_is_forum:
                    record.logs_chat_is_forum = new_forum_flag
                    should_reload = True

            if "default_vless_flow" in payload:
                flow = payload["default_vless_flow"] or None
                record.default_vless_flow = flow if flow else None

            if "admin_chat_ids" in payload:
                admin_ids = cls._coerce_admin_ids(payload["admin_chat_ids"])
                record.admin_chat_ids = admin_ids or None

            if "forum_topics" in payload:
                topics, _ = cls._prepare_forum_topics(
                    payload.get("forum_topics")  # type: ignore[arg-type]
                )
                record.forum_topics = {
                    key: topic.to_dict() for key, topic in topics.items()
                }

            if "event_toggles" in payload:
                incoming_raw = payload.get("event_toggles") or {}
                if not isinstance(incoming_raw, dict):
                    incoming_raw = {}
                existing = record.event_toggles or {}
                merged_source = {**cls.DEFAULT_EVENT_TOGGLES, **existing, **incoming_raw}
                toggles, _ = cls._prepare_event_toggles(merged_source)
                record.event_toggles = toggles

            record.updated_at = datetime.utcnow()
            db.add(record)
            db.commit()
            db.refresh(record)

            if should_reload:
                cls._trigger_reload()

            return cls._merge_with_env(record)
        finally:
            if close_db:
                db.close()

    @classmethod
    def is_event_enabled(cls, event_key: str) -> bool:
        settings = cls.get_settings(ensure_record=True)
        toggles = settings.event_toggles or {}
        if event_key in toggles:
            return bool(toggles[event_key])
        return cls.DEFAULT_EVENT_TOGGLES.get(event_key, True)

    @classmethod
    def _trigger_reload(cls) -> None:
        try:
            from app.telegram import reload_bot

            reload_bot()
        except Exception:
            # avoid crashing settings update due to reload issues
            pass

    @classmethod
    def update_topic_id(
        cls,
        topic_key: str,
        topic_id: int,
        db: Optional[Session] = None,
    ) -> TelegramSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            record = db.query(TelegramSettingsModel).first()
            if record is None:
                record = TelegramSettingsModel(
                    forum_topics={
                        key: {"title": title, "topic_id": None}
                        for key, title in cls.DEFAULT_TOPIC_TITLES.items()
                    },
                    event_toggles=cls.DEFAULT_EVENT_TOGGLES.copy(),
                )
                db.add(record)
                db.flush()

            topics, _ = cls._prepare_forum_topics(record.forum_topics)
            topic = topics.get(topic_key)
            if topic is None:
                topic = TelegramTopic(
                    title=cls.DEFAULT_TOPIC_TITLES.get(topic_key, topic_key.title()),
                    topic_id=topic_id,
                )
            else:
                topic.topic_id = topic_id
            topics[topic_key] = topic

            record.forum_topics = {
                key: value.to_dict() for key, value in topics.items()
            }
            record.updated_at = datetime.utcnow()
            db.add(record)
            db.commit()
            db.refresh(record)

            return cls._merge_with_env(record)
        finally:
            if close_db:
                db.close()
