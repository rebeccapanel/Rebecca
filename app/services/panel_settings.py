from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.db.base import SessionLocal
from app.db.models import PanelSettings as PanelSettingsModel


@dataclass
class PanelSettingsData:
    use_nobetci: bool = False


class PanelSettingsService:
    """Manage high-level panel settings stored in the database."""

    @classmethod
    def _ensure_record(cls, db: Session) -> PanelSettingsModel:
        record = db.query(PanelSettingsModel).first()
        if record is None:
            record = PanelSettingsModel(use_nobetci=False)
            db.add(record)
            db.commit()
            db.refresh(record)
        return record

    @classmethod
    def _serialize(cls, record: Optional[PanelSettingsModel]) -> PanelSettingsData:
        if record is None:
            return PanelSettingsData()
        return PanelSettingsData(use_nobetci=bool(record.use_nobetci))

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
            record = db.query(PanelSettingsModel).first()
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
            record = cls._ensure_record(db)
            if "use_nobetci" in payload:
                incoming = payload.get("use_nobetci")
                if incoming is None:
                    record.use_nobetci = False
                else:
                    record.use_nobetci = bool(incoming)
            record.updated_at = datetime.utcnow()
            db.add(record)
            db.commit()
            db.refresh(record)
            return cls._serialize(record)
        finally:
            if close_db and db is not None:
                db.close()
