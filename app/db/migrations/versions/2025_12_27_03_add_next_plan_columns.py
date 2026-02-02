"""Add next_plan ordering and trigger columns for auto renew queue.

Revision ID: 6_add_next_plan_columns
Revises: 5_add_service_users_usage
Create Date: 2025-12-27 03:08:43.829135
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "6_add_next_plan_columns"
down_revision = "5_add_service_users_usage"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = [col["name"] for col in inspector.get_columns(table)]
    return column in cols


def upgrade():
    next_plan_table = "next_plans"
    if not _has_column(next_plan_table, "position"):
        op.add_column(
            next_plan_table,
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        )
    if not _has_column(next_plan_table, "increase_data_limit"):
        op.add_column(
            next_plan_table,
            sa.Column("increase_data_limit", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
    if not _has_column(next_plan_table, "start_on_first_connect"):
        op.add_column(
            next_plan_table,
            sa.Column("start_on_first_connect", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
    if not _has_column(next_plan_table, "trigger_on"):
        op.add_column(
            next_plan_table,
            sa.Column("trigger_on", sa.String(length=16), nullable=False, server_default="either"),
        )

    users_table = "users"
    if not _has_column(users_table, "telegram_id"):
        op.add_column(users_table, sa.Column("telegram_id", sa.String(length=128), nullable=True))
    if not _has_column(users_table, "contact_number"):
        op.add_column(users_table, sa.Column("contact_number", sa.String(length=64), nullable=True))


def downgrade():
    next_plan_table = "next_plans"
    if _has_column(next_plan_table, "trigger_on"):
        op.drop_column(next_plan_table, "trigger_on")
    if _has_column(next_plan_table, "start_on_first_connect"):
        op.drop_column(next_plan_table, "start_on_first_connect")
    if _has_column(next_plan_table, "increase_data_limit"):
        op.drop_column(next_plan_table, "increase_data_limit")
    if _has_column(next_plan_table, "position"):
        op.drop_column(next_plan_table, "position")

    users_table = "users"
    if _has_column(users_table, "contact_number"):
        op.drop_column(users_table, "contact_number")
    if _has_column(users_table, "telegram_id"):
        op.drop_column(users_table, "telegram_id")
