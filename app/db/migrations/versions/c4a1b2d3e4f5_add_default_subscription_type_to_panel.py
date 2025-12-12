"""Add default subscription type to panel settings

Revision ID: c4a1b2d3e4f5
Revises: e7b4d8f0a1c2
Create Date: 2025-12-02 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c4a1b2d3e4f5"
down_revision = "e7b4d8f0a1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = {t.lower() for t in inspector.get_table_names()}

    if "panel_settings" in tables:
        columns = {c["name"] for c in inspector.get_columns("panel_settings")}
        if "default_subscription_type" not in columns:
            with op.batch_alter_table("panel_settings") as batch_op:
                batch_op.add_column(
                    sa.Column(
                        "default_subscription_type",
                        sa.String(length=32),
                        nullable=False,
                        server_default=sa.text("'key'"),
                    )
                )
    else:
        op.create_table(
            "panel_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("use_nobetci", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column(
                "default_subscription_type",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'key'"),
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = {t.lower() for t in inspector.get_table_names()}

    if "panel_settings" in tables:
        columns = {c["name"] for c in inspector.get_columns("panel_settings")}
        if "default_subscription_type" in columns:
            with op.batch_alter_table("panel_settings") as batch_op:
                batch_op.drop_column("default_subscription_type")
