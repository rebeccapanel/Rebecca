"""Add subscription settings tables and admin overrides.

Revision ID: 7_add_subscription_settings
Revises: 6_add_next_plan_columns
Create Date: 2025-12-29 01:15:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "7_add_subscription_settings"
down_revision = "6_add_next_plan_columns"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = [col["name"] for col in inspector.get_columns(table)]
    return column in cols


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return inspector.has_table(table)


def upgrade():
    if not _has_column("admins", "subscription_domain"):
        op.add_column("admins", sa.Column("subscription_domain", sa.String(length=255), nullable=True))
    if not _has_column("admins", "subscription_telegram_id"):
        op.add_column("admins", sa.Column("subscription_telegram_id", sa.BigInteger(), nullable=True))
    if not _has_column("admins", "subscription_settings"):
        op.add_column("admins", sa.Column("subscription_settings", sa.JSON(), nullable=True))

    if not _has_table("subscription_settings"):
        op.create_table(
            "subscription_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("subscription_url_prefix", sa.String(length=512), nullable=False, server_default=sa.text("''")),
            sa.Column("custom_templates_directory", sa.String(length=512), nullable=True),
            sa.Column("clash_subscription_template", sa.String(length=255), nullable=False, server_default="clash/default.yml"),
            sa.Column("clash_settings_template", sa.String(length=255), nullable=False, server_default="clash/settings.yml"),
            sa.Column("subscription_page_template", sa.String(length=255), nullable=False, server_default="subscription/index.html"),
            sa.Column("home_page_template", sa.String(length=255), nullable=False, server_default="home/index.html"),
            sa.Column("v2ray_subscription_template", sa.String(length=255), nullable=False, server_default="v2ray/default.json"),
            sa.Column("v2ray_settings_template", sa.String(length=255), nullable=False, server_default="v2ray/settings.json"),
            sa.Column("singbox_subscription_template", sa.String(length=255), nullable=False, server_default="singbox/default.json"),
            sa.Column("singbox_settings_template", sa.String(length=255), nullable=False, server_default="singbox/settings.json"),
            sa.Column("mux_template", sa.String(length=255), nullable=False, server_default="mux/default.json"),
            sa.Column("use_custom_json_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("use_custom_json_for_v2rayn", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("use_custom_json_for_v2rayng", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("use_custom_json_for_streisand", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("use_custom_json_for_happ", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )

    if not _has_table("subscription_domains"):
        op.create_table(
            "subscription_domains",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("domain", sa.String(length=255), nullable=False, index=True),
            sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("provider", sa.String(length=64), nullable=True),
            sa.Column("alt_names", sa.JSON(), nullable=True),
            sa.Column("last_issued_at", sa.DateTime(), nullable=True),
            sa.Column("last_renewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("domain", name="uq_subscription_domain"),
        )


def downgrade():
    if _has_table("subscription_domains"):
        op.drop_table("subscription_domains")

    if _has_table("subscription_settings"):
        op.drop_table("subscription_settings")

    if _has_column("admins", "subscription_settings"):
        op.drop_column("admins", "subscription_settings")
    if _has_column("admins", "subscription_telegram_id"):
        op.drop_column("admins", "subscription_telegram_id")
    if _has_column("admins", "subscription_domain"):
        op.drop_column("admins", "subscription_domain")
