from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, UTC
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session
from sqlalchemy import inspect, text

from app.db.base import SessionLocal
from app.db.models import PanelSettings as PanelSettingsModel


@dataclass
class PanelSettingsData:
    use_nobetci: bool = False
    default_subscription_type: str = "key"
    access_insights_enabled: bool = False


class PanelSettingsService:
    """Manage high-level panel settings stored in the database."""

    @staticmethod
    def _ensure_subscription_type_column(db: Session) -> None:
        """
        Ensure the default_subscription_type column exists at runtime for legacy databases
        where migration has not been applied. This is a lightweight guard to prevent
        silent fallback to 'key'.
        """
        try:
            inspector = inspect(db.get_bind())
            columns = {col["name"] for col in inspector.get_columns("panel_settings")}
            if "default_subscription_type" not in columns:
                db.execute(
                    text(
                        "ALTER TABLE panel_settings "
                        "ADD COLUMN default_subscription_type VARCHAR(32) NOT NULL DEFAULT 'key'"
                    )
                )
                db.commit()
        except Exception:
            # If inspection/alter fails, leave as-is; higher layers will fallback to 'key'
            db.rollback()
            return

    @staticmethod
    def _ensure_access_insights_column(db: Session) -> None:
        """
        Ensure the access_insights_enabled column exists for legacy databases.
        """
        try:
            inspector = inspect(db.get_bind())
            columns = {col["name"] for col in inspector.get_columns("panel_settings")}
            if "access_insights_enabled" not in columns:
                db.execute(
                    text("ALTER TABLE panel_settings ADD COLUMN access_insights_enabled BOOLEAN NOT NULL DEFAULT 0")
                )
                db.commit()
        except Exception:
            db.rollback()
            return

    @classmethod
    def _ensure_record(cls, db: Session) -> PanelSettingsModel:
        cls._ensure_subscription_type_column(db)
        cls._ensure_access_insights_column(db)
        record = db.query(PanelSettingsModel).order_by(PanelSettingsModel.id.desc()).first()
        if record is None:
            record = PanelSettingsModel(
                use_nobetci=False,
                default_subscription_type="key",
                access_insights_enabled=False,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
        else:
            # Backward compatibility: older schemas may lack the column; ensure attribute exists
            if not hasattr(record, "default_subscription_type"):
                try:
                    record.default_subscription_type = "key"
                    db.add(record)
                    db.commit()
                    db.refresh(record)
                except Exception:
                    pass
            else:
                if not record.default_subscription_type:
                    record.default_subscription_type = "key"
                    db.add(record)
                    db.commit()
                    db.refresh(record)
            if not hasattr(record, "access_insights_enabled"):
                try:
                    record.access_insights_enabled = False
                    db.add(record)
                    db.commit()
                    db.refresh(record)
                except Exception:
                    pass
            else:
                if record.access_insights_enabled is None:
                    try:
                        record.access_insights_enabled = False
                        db.add(record)
                        db.commit()
                        db.refresh(record)
                    except Exception:
                        pass
        return record

    @classmethod
    def _serialize(cls, record: Optional[PanelSettingsModel]) -> PanelSettingsData:
        if record is None:
            return PanelSettingsData()
        return PanelSettingsData(
            use_nobetci=bool(record.use_nobetci),
            default_subscription_type=getattr(record, "default_subscription_type", None) or "key",
            access_insights_enabled=bool(getattr(record, "access_insights_enabled", False)),
        )

    @classmethod
    def get_settings(
        cls,
        *,
        ensure_record: bool = True,
        db: Optional[Session] = None,
    ) -> PanelSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            cls._ensure_access_insights_column(db)
            record = db.query(PanelSettingsModel).order_by(PanelSettingsModel.id.desc()).first()
            if record is None and ensure_record:
                record = cls._ensure_record(db)
            return cls._serialize(record)
        finally:
            if close_db and db is not None:
                db.close()

    @classmethod
    def update_settings(
        cls,
        payload: Dict[str, Any],
        *,
        db: Optional[Session] = None,
    ) -> PanelSettingsData:
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True
        try:
            cls._ensure_access_insights_column(db)
            record = cls._ensure_record(db)
            if "use_nobetci" in payload:
                incoming = payload.get("use_nobetci")
                if incoming is None:
                    record.use_nobetci = False
                else:
                    record.use_nobetci = bool(incoming)
            if "default_subscription_type" in payload:
                incoming_type = payload.get("default_subscription_type")
                # Accept both Enum and plain strings
                if hasattr(incoming_type, "value"):
                    incoming_type = incoming_type.value
                allowed = {"username-key", "key", "token"}
                if incoming_type in allowed:
                    try:
                        record.default_subscription_type = incoming_type
                    except Exception:
                        # If column is missing in legacy schema, ignore silently
                        pass
            if "access_insights_enabled" in payload:
                incoming = payload.get("access_insights_enabled")
                value = False if incoming is None else bool(incoming)
                record.access_insights_enabled = value
            record.updated_at = datetime.now(UTC).replace(tzinfo=None)
            db.add(record)
            db.commit()
            db.refresh(record)
            return cls._serialize(record)
        except Exception:
            db.rollback()
            raise
        finally:
            if close_db and db is not None:
                db.close()
