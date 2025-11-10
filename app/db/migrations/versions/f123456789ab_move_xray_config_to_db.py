"""store xray config as a single JSON blob in the database

Revision ID: f123456789ab
Revises: e7b4d8f0a1c2
Create Date: 2025-11-10 00:00:00.000000

"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import commentjson
import sqlalchemy as sa
from alembic import op

from app.utils.xray_defaults import load_legacy_xray_config


# revision identifiers, used by Alembic.
revision = "f123456789ab"
down_revision = "e7b4d8f0a1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "xray_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    payload = _load_initial_payload()
    config_table = sa.table(
        "xray_config",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    op.bulk_insert(config_table, [{"id": 1, "data": payload}])

    config_path = _config_path()
    if config_path.exists():
        try:
            config_path.unlink()
        except OSError:
            pass


def downgrade() -> None:
    if op.get_bind().dialect.name == "mysql":
        op.execute("DROP TABLE IF EXISTS xray_config")
    else:
        op.drop_table("xray_config")


def _config_path() -> Path:
    return Path.cwd() / "xray_config.json"


def _load_initial_payload() -> Dict[str, Any]:
    config_path = _config_path()
    if config_path.exists():
        try:
            return commentjson.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return load_legacy_xray_config()
