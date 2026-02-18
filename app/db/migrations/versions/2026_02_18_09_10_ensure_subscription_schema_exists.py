"""Ensure subscription schema exists for admins and settings.

Revision ID: 10_ensure_subscription_schema
Revises: 9_add_node_proxy_settings
Create Date: 2026-02-18 13:20:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "10_ensure_subscription_schema"
down_revision = "9_add_node_proxy_settings"
branch_labels = None
depends_on = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {col["name"] for col in _inspector().get_columns(table)}


def _has_index(table: str, index_name: str) -> bool:
    if not _has_table(table):
        return False
    return any(idx.get("name") == index_name for idx in _inspector().get_indexes(table))


def _ensure_admin_subscription_columns() -> None:
    if not _has_table("admins"):
        return
    with op.batch_alter_table("admins") as batch:
        if not _has_column("admins", "subscription_domain"):
            batch.add_column(sa.Column("subscription_domain", sa.String(length=255), nullable=True))
        if not _has_column("admins", "subscription_settings"):
            batch.add_column(sa.Column("subscription_settings", sa.JSON(), nullable=True))


def _ensure_subscription_settings_table() -> None:
    if not _has_table("subscription_settings"):
        op.create_table(
            "subscription_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("subscription_url_prefix", sa.String(length=512), nullable=False, server_default=sa.text("''")),
            sa.Column("subscription_profile_title", sa.String(length=255), nullable=False, server_default="Subscription"),
            sa.Column(
                "subscription_support_url",
                sa.String(length=512),
                nullable=False,
                server_default="https://t.me/",
            ),
            sa.Column("subscription_update_interval", sa.String(length=32), nullable=False, server_default="12"),
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
        return

    with op.batch_alter_table("subscription_settings") as batch:
        if not _has_column("subscription_settings", "subscription_url_prefix"):
            batch.add_column(sa.Column("subscription_url_prefix", sa.String(length=512), nullable=False, server_default=sa.text("''")))
        if not _has_column("subscription_settings", "subscription_profile_title"):
            batch.add_column(sa.Column("subscription_profile_title", sa.String(length=255), nullable=False, server_default="Subscription"))
        if not _has_column("subscription_settings", "subscription_support_url"):
            batch.add_column(
                sa.Column("subscription_support_url", sa.String(length=512), nullable=False, server_default="https://t.me/")
            )
        if not _has_column("subscription_settings", "subscription_update_interval"):
            batch.add_column(sa.Column("subscription_update_interval", sa.String(length=32), nullable=False, server_default="12"))
        if not _has_column("subscription_settings", "custom_templates_directory"):
            batch.add_column(sa.Column("custom_templates_directory", sa.String(length=512), nullable=True))
        if not _has_column("subscription_settings", "clash_subscription_template"):
            batch.add_column(
                sa.Column("clash_subscription_template", sa.String(length=255), nullable=False, server_default="clash/default.yml")
            )
        if not _has_column("subscription_settings", "clash_settings_template"):
            batch.add_column(
                sa.Column("clash_settings_template", sa.String(length=255), nullable=False, server_default="clash/settings.yml")
            )
        if not _has_column("subscription_settings", "subscription_page_template"):
            batch.add_column(
                sa.Column("subscription_page_template", sa.String(length=255), nullable=False, server_default="subscription/index.html")
            )
        if not _has_column("subscription_settings", "home_page_template"):
            batch.add_column(sa.Column("home_page_template", sa.String(length=255), nullable=False, server_default="home/index.html"))
        if not _has_column("subscription_settings", "v2ray_subscription_template"):
            batch.add_column(
                sa.Column("v2ray_subscription_template", sa.String(length=255), nullable=False, server_default="v2ray/default.json")
            )
        if not _has_column("subscription_settings", "v2ray_settings_template"):
            batch.add_column(
                sa.Column("v2ray_settings_template", sa.String(length=255), nullable=False, server_default="v2ray/settings.json")
            )
        if not _has_column("subscription_settings", "singbox_subscription_template"):
            batch.add_column(
                sa.Column("singbox_subscription_template", sa.String(length=255), nullable=False, server_default="singbox/default.json")
            )
        if not _has_column("subscription_settings", "singbox_settings_template"):
            batch.add_column(
                sa.Column("singbox_settings_template", sa.String(length=255), nullable=False, server_default="singbox/settings.json")
            )
        if not _has_column("subscription_settings", "mux_template"):
            batch.add_column(sa.Column("mux_template", sa.String(length=255), nullable=False, server_default="mux/default.json"))
        if not _has_column("subscription_settings", "use_custom_json_default"):
            batch.add_column(sa.Column("use_custom_json_default", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if not _has_column("subscription_settings", "use_custom_json_for_v2rayn"):
            batch.add_column(sa.Column("use_custom_json_for_v2rayn", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if not _has_column("subscription_settings", "use_custom_json_for_v2rayng"):
            batch.add_column(sa.Column("use_custom_json_for_v2rayng", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if not _has_column("subscription_settings", "use_custom_json_for_streisand"):
            batch.add_column(
                sa.Column("use_custom_json_for_streisand", sa.Boolean(), nullable=False, server_default=sa.text("0"))
            )
        if not _has_column("subscription_settings", "use_custom_json_for_happ"):
            batch.add_column(sa.Column("use_custom_json_for_happ", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if not _has_column("subscription_settings", "created_at"):
            batch.add_column(sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
        if not _has_column("subscription_settings", "updated_at"):
            batch.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))


def _ensure_subscription_domains_table() -> None:
    if not _has_table("subscription_domains"):
        op.create_table(
            "subscription_domains",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("domain", sa.String(length=255), nullable=False),
            sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("provider", sa.String(length=64), nullable=True),
            sa.Column("alt_names", sa.JSON(), nullable=True),
            sa.Column("last_issued_at", sa.DateTime(), nullable=True),
            sa.Column("last_renewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("domain", name="uq_subscription_domain"),
        )
    else:
        with op.batch_alter_table("subscription_domains") as batch:
            if not _has_column("subscription_domains", "domain"):
                batch.add_column(sa.Column("domain", sa.String(length=255), nullable=False, server_default=sa.text("''")))
            if not _has_column("subscription_domains", "admin_id"):
                batch.add_column(sa.Column("admin_id", sa.Integer(), nullable=True))
            if not _has_column("subscription_domains", "email"):
                batch.add_column(sa.Column("email", sa.String(length=255), nullable=True))
            if not _has_column("subscription_domains", "provider"):
                batch.add_column(sa.Column("provider", sa.String(length=64), nullable=True))
            if not _has_column("subscription_domains", "alt_names"):
                batch.add_column(sa.Column("alt_names", sa.JSON(), nullable=True))
            if not _has_column("subscription_domains", "last_issued_at"):
                batch.add_column(sa.Column("last_issued_at", sa.DateTime(), nullable=True))
            if not _has_column("subscription_domains", "last_renewed_at"):
                batch.add_column(sa.Column("last_renewed_at", sa.DateTime(), nullable=True))
            if not _has_column("subscription_domains", "created_at"):
                batch.add_column(sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
            if not _has_column("subscription_domains", "updated_at"):
                batch.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))

    if _has_table("subscription_domains"):
        if not _has_index("subscription_domains", "ix_subscription_domains_domain"):
            op.create_index("ix_subscription_domains_domain", "subscription_domains", ["domain"], unique=False)
        if not _has_index("subscription_domains", "ix_subscription_domains_admin_id"):
            op.create_index("ix_subscription_domains_admin_id", "subscription_domains", ["admin_id"], unique=False)


def upgrade():
    _ensure_admin_subscription_columns()
    _ensure_subscription_settings_table()
    _ensure_subscription_domains_table()


def downgrade():
    if _has_table("subscription_domains"):
        if _has_index("subscription_domains", "ix_subscription_domains_admin_id"):
            op.drop_index("ix_subscription_domains_admin_id", table_name="subscription_domains")
        if _has_index("subscription_domains", "ix_subscription_domains_domain"):
            op.drop_index("ix_subscription_domains_domain", table_name="subscription_domains")
        op.drop_table("subscription_domains")

    if _has_table("subscription_settings"):
        op.drop_table("subscription_settings")

    if _has_table("admins"):
        with op.batch_alter_table("admins") as batch:
            if _has_column("admins", "subscription_settings"):
                batch.drop_column("subscription_settings")
            if _has_column("admins", "subscription_domain"):
                batch.drop_column("subscription_domain")
