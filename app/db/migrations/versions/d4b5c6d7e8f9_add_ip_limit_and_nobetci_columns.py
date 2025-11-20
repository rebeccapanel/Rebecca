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
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    node_columns = {column["name"] for column in inspector.get_columns("nodes")}
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    needs_use_nobetci = "use_nobetci" not in node_columns
    needs_nobetci_port = "nobetci_port" not in node_columns

    if needs_use_nobetci or needs_nobetci_port:
        with op.batch_alter_table("nodes") as batch:
            if needs_use_nobetci:
                batch.add_column(
                    sa.Column(
                        "use_nobetci",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.text("0"),
                    )
                )
            if needs_nobetci_port:
                batch.add_column(
                    sa.Column(
                        "nobetci_port",
                        sa.Integer(),
                        nullable=True,
                    )
                )

    if "ip_limit" not in user_columns:
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
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "ip_limit" in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("ip_limit")

    node_columns = {column["name"] for column in inspector.get_columns("nodes")}
    needs_drop_nobetci_port = "nobetci_port" in node_columns
    needs_drop_use_nobetci = "use_nobetci" in node_columns

    if needs_drop_nobetci_port or needs_drop_use_nobetci:
        with op.batch_alter_table("nodes") as batch:
            if needs_drop_nobetci_port:
                batch.drop_column("nobetci_port")
            if needs_drop_use_nobetci:
                batch.drop_column("use_nobetci")
