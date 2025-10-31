"""add services and service usage tracking

Revision ID: c6a48231bb3d
Revises: b9e52f5491a6
Create Date: 2025-10-29 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c6a48231bb3d"
down_revision = "b9e52f5491a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "services",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=256), nullable=True),
        sa.Column("used_traffic", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "lifetime_used_traffic", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "admins_services",
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("used_traffic", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "lifetime_used_traffic", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["admin_id"], ["admins.id"], ondelete="CASCADE", name="fk_admins_services_admin_id"
        ),
        sa.ForeignKeyConstraint(
            ["service_id"], ["services.id"], ondelete="CASCADE", name="fk_admins_services_service_id"
        ),
        sa.PrimaryKeyConstraint("admin_id", "service_id"),
    )
    op.create_index(
        "ix_admins_services_service_id", "admins_services", ["service_id"]
    )
    op.create_index("ix_admins_services_admin_id", "admins_services", ["admin_id"])

    op.create_table(
        "service_hosts",
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("host_id", sa.Integer(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["host_id"], ["hosts.id"], ondelete="CASCADE", name="fk_service_hosts_host_id"
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            ondelete="CASCADE",
            name="fk_service_hosts_service_id",
        ),
        sa.PrimaryKeyConstraint("service_id", "host_id"),
    )
    op.create_index("ix_service_hosts_host_id", "service_hosts", ["host_id"])

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("service_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_users_service_id",
            "services",
            ["service_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_users_service_id", ["service_id"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_service_id")
        batch_op.drop_constraint("fk_users_service_id", type_="foreignkey")
        batch_op.drop_column("service_id")

    op.drop_index("ix_service_hosts_host_id", table_name="service_hosts")
    op.drop_table("service_hosts")

    op.drop_index("ix_admins_services_admin_id", table_name="admins_services")
    op.drop_index("ix_admins_services_service_id", table_name="admins_services")
    op.drop_table("admins_services")

    op.drop_table("services")
