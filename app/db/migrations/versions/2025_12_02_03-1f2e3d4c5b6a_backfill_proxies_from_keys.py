"""backfill proxies from credential keys

Revision ID: 1f2e3d4c5b6a
Revises: 0b71839bf061
Create Date: 2025-12-02 03:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.proxy import ProxyTypes
from app.utils.credentials import runtime_proxy_settings

# revision identifiers, used by Alembic.
revision = "1f2e3d4c5b6a"
down_revision = "0b71839bf061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    metadata.reflect(bind=bind, only=("users", "proxies"))

    users_table = metadata.tables.get("users")
    proxies_table = metadata.tables.get("proxies")
    if users_table is None or proxies_table is None:
        return

    session = Session(bind=bind)
    try:
        keyed_users = session.execute(
            sa.select(
                users_table.c.id,
                users_table.c.credential_key,
            ).where(users_table.c.credential_key.isnot(None))
        ).all()

        for user_row in keyed_users:
            user_id = user_row.id
            credential_key = user_row.credential_key
            if not credential_key:
                continue

            proxy_rows = session.execute(
                sa.select(
                    proxies_table.c.id,
                    proxies_table.c.type,
                    proxies_table.c.settings,
                ).where(proxies_table.c.user_id == user_id)
            ).all()

            for proxy_row in proxy_rows:
                proxy_type_val = proxy_row.type
                try:
                    proxy_type = proxy_type_val if isinstance(proxy_type_val, ProxyTypes) else ProxyTypes(proxy_type_val)
                except Exception:
                    continue

                settings_data = dict(proxy_row.settings or {})
                for cred_key in ("id", "uuid", "password"):
                    settings_data.pop(cred_key, None)

                try:
                    runtime_settings = runtime_proxy_settings(
                        settings_data, proxy_type, credential_key
                    )
                except Exception:
                    continue

                session.execute(
                    proxies_table.update()
                    .where(proxies_table.c.id == proxy_row.id)
                    .values(settings=runtime_settings)
                )
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    # Data backfill; not easily reversible
    pass
