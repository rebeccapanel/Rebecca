"""Move subscription settings to DB defaults and allow profile/support overrides.

Revision ID: 8_subscription_settings_profile
Revises: 7_add_subscription_settings
Create Date: 2026-01-05 01:25:34.584778
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "8_subscription_settings_profile"
down_revision = "7_add_subscription_settings"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return inspector.has_table(table)


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(table):
        return False
    cols = [col["name"] for col in inspector.get_columns(table)]
    return column in cols


def upgrade():
    if _has_table("subscription_settings"):
        with op.batch_alter_table("subscription_settings") as batch:
            if not _has_column("subscription_settings", "subscription_profile_title"):
                batch.add_column(
                    sa.Column(
                        "subscription_profile_title",
                        sa.String(length=255),
                        nullable=False,
                        server_default="Subscription",
                    )
                )
            if not _has_column("subscription_settings", "subscription_support_url"):
                batch.add_column(
                    sa.Column(
                        "subscription_support_url",
                        sa.String(length=512),
                        nullable=False,
                        server_default="https://t.me/",
                    )
                )
            if not _has_column("subscription_settings", "subscription_update_interval"):
                batch.add_column(
                    sa.Column(
                        "subscription_update_interval",
                        sa.String(length=32),
                        nullable=False,
                        server_default="12",
                    )
                )

    if _has_column("admins", "subscription_telegram_id"):
        with op.batch_alter_table("admins") as batch:
            batch.drop_column("subscription_telegram_id")


def downgrade():
    if _has_table("admins") and not _has_column("admins", "subscription_telegram_id"):
        with op.batch_alter_table("admins") as batch:
            batch.add_column(sa.Column("subscription_telegram_id", sa.BigInteger(), nullable=True))

    if _has_table("subscription_settings"):
        with op.batch_alter_table("subscription_settings") as batch:
            if _has_column("subscription_settings", "subscription_update_interval"):
                batch.drop_column("subscription_update_interval")
            if _has_column("subscription_settings", "subscription_support_url"):
                batch.drop_column("subscription_support_url")
            if _has_column("subscription_settings", "subscription_profile_title"):
                batch.drop_column("subscription_profile_title")
