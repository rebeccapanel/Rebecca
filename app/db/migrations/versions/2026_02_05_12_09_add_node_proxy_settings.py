"""Add proxy settings to nodes.

Revision ID: 9_add_node_proxy_settings
Revises: 8_subscription_settings_profile
Create Date: 2026-02-05 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "9_add_node_proxy_settings"
down_revision = "8_subscription_settings_profile"
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
    if _has_table("nodes"):
        with op.batch_alter_table("nodes") as batch:
            if not _has_column("nodes", "proxy_enabled"):
                batch.add_column(
                    sa.Column("proxy_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0"))
                )
            if not _has_column("nodes", "proxy_type"):
                batch.add_column(sa.Column("proxy_type", sa.String(length=16), nullable=True))
            if not _has_column("nodes", "proxy_host"):
                batch.add_column(sa.Column("proxy_host", sa.String(length=255), nullable=True))
            if not _has_column("nodes", "proxy_port"):
                batch.add_column(sa.Column("proxy_port", sa.Integer(), nullable=True))
            if not _has_column("nodes", "proxy_username"):
                batch.add_column(sa.Column("proxy_username", sa.String(length=255), nullable=True))
            if not _has_column("nodes", "proxy_password"):
                batch.add_column(sa.Column("proxy_password", sa.String(length=255), nullable=True))


def downgrade():
    if _has_table("nodes"):
        with op.batch_alter_table("nodes") as batch:
            if _has_column("nodes", "proxy_password"):
                batch.drop_column("proxy_password")
            if _has_column("nodes", "proxy_username"):
                batch.drop_column("proxy_username")
            if _has_column("nodes", "proxy_port"):
                batch.drop_column("proxy_port")
            if _has_column("nodes", "proxy_host"):
                batch.drop_column("proxy_host")
            if _has_column("nodes", "proxy_type"):
                batch.drop_column("proxy_type")
            if _has_column("nodes", "proxy_enabled"):
                batch.drop_column("proxy_enabled")
