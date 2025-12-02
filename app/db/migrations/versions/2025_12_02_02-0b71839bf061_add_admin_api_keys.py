"""add admin api keys

Revision ID: 0b71839bf061
Revises: 2b5121ab2105
Create Date: 2025-12-02 02:44:51.584778
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0b71839bf061"
down_revision = "2b5121ab2105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_api_keys",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("admin_id", sa.Integer(), nullable=False, index=True),
        sa.Column("key_hash", sa.String(length=128), nullable=False, unique=True, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["admin_id"], ["admins.id"]),
    )


def downgrade() -> None:
    op.drop_table("admin_api_keys")
