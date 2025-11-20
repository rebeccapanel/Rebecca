"""Add backup schedule fields to panel_settings

Revision ID: backup_schedule_panel
Revises: e7b4d8f0a1c2
Create Date: 2025-11-20 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "backup_schedule_panel"
down_revision = "e7b4d8f0a1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "panel_settings" in tables:
        panel_columns = {
            column["name"] for column in inspector.get_columns("panel_settings")
        }
        
        if "backup_enabled" not in panel_columns:
            op.add_column(
                "panel_settings",
                sa.Column("backup_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0"))
            )
        
        if "backup_cron_schedule" not in panel_columns:
            op.add_column(
                "panel_settings",
                sa.Column("backup_cron_schedule", sa.String(255), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "panel_settings" in tables:
        panel_columns = {
            column["name"] for column in inspector.get_columns("panel_settings")
        }
        
        if "backup_enabled" in panel_columns:
            op.drop_column("panel_settings", "backup_enabled")
        
        if "backup_cron_schedule" in panel_columns:
            op.drop_column("panel_settings", "backup_cron_schedule")

