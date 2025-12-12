"""add access insights toggle

Revision ID: 3_add_access_insights
Revises: 2_add_node_certs
Create Date: 2025-12-10 03:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '3_add_access_insights'
down_revision = '2_add_node_certs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("panel_settings")}
    if "access_insights_enabled" not in columns:
        op.add_column(
            "panel_settings",
            sa.Column("access_insights_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("panel_settings")}
    if "access_insights_enabled" in columns:
        op.drop_column("panel_settings", "access_insights_enabled")
