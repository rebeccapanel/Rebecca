"""add user flow column and backfill from proxies

Revision ID: 1_add_user_flow
Revises: 1f2e3d4c5b6a
Create Date: 2025-12-03 01:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

# revision identifiers, used by Alembic.
revision = "1_add_user_flow"
down_revision = "1f2e3d4c5b6a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch_alter_table for SQLite compatibility (DROP/ADD handled safely)
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("flow", sa.String(length=128), nullable=True))

    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "mysql":
        # Fast path using MySQL JSON functions
        # 1) Backfill users.flow from proxies.settings.flow (any matching proxy per user is fine)
        op.execute(
            """
            UPDATE users u
            JOIN (
                SELECT
                    p.user_id,
                    MIN(JSON_UNQUOTE(JSON_EXTRACT(p.settings, '$.flow'))) AS flow_val
                FROM proxies p
                WHERE JSON_EXTRACT(p.settings, '$.flow') IS NOT NULL
                GROUP BY p.user_id
            ) AS src ON src.user_id = u.id
            SET u.flow = src.flow_val
            WHERE u.flow IS NULL
            """
        )

        # 2) Remove flow key from proxies.settings
        op.execute(
            """
            UPDATE proxies
            SET settings = JSON_REMOVE(settings, '$.flow')
            WHERE JSON_EXTRACT(settings, '$.flow') IS NOT NULL
            """
        )
    else:
        # Fallback: small loop using raw queries to avoid model mismatches on SQLite
        session = Session(bind=bind)
        update_proxy_settings_stmt = sa.text(
            "UPDATE proxies SET settings = :settings WHERE id = :pid"
        ).bindparams(sa.bindparam("settings", type_=sa.JSON()))
        try:
            results = session.execute(sa.text("SELECT id, user_id, settings FROM proxies")).fetchall()
            for row in results:
                settings = row.settings or {}
                if isinstance(settings, str):
                    import json
                    settings = json.loads(settings)
                proxy_flow = settings.pop("flow", None)
                if proxy_flow:
                    session.execute(
                        sa.text(
                            "UPDATE users SET flow = :flow WHERE id = :uid AND (flow IS NULL OR flow = '')"
                        ),
                        {"flow": proxy_flow, "uid": row.user_id},
                    )
                session.execute(
                    update_proxy_settings_stmt,
                    {"settings": settings, "pid": row.id},
                )
            session.commit()
        finally:
            session.close()


def downgrade() -> None:
    # Flow values will not be restored to proxies on downgrade.
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("flow")
