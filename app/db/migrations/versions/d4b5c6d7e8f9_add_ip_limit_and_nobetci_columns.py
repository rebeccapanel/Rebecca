"""Add ip_limit to users and nobetci settings to nodes

Revision ID: d4b5c6d7e8f9
Revises: b6c1e4cf1a2b
Create Date: 2025-11-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4b5c6d7e8f9"
down_revision = "b6c1e4cf1a2b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(
            sa.Column(
                "use_nobetci",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch.add_column(
            sa.Column(
                "nobetci_port",
                sa.Integer(),
                nullable=True,
            )
        )

    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "ip_limit",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("ip_limit")

    with op.batch_alter_table("nodes") as batch:
        batch.drop_column("nobetci_port")
        batch.drop_column("use_nobetci")
