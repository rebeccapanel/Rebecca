"""Add users_usage column to services

Revision ID: 5_add_service_users_usage
Revises: 4_add_outbound_traffic_table
Create Date: 2025-12-15 01:47:03.616559
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5_add_service_users_usage"
down_revision = "4_add_outbound_traffic_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("services")}
    if "users_usage" not in columns:
        op.add_column("services", sa.Column("users_usage", sa.BigInteger(), nullable=False, server_default="0"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("services")}
    if "users_usage" in columns:
        op.drop_column("services", "users_usage")
