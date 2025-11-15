"""update jwt table with masks and separate keys

Revision ID: 2a3b4c5d6e7f
Revises: 0a1b2c3d4e5f
Create Date: 2025-11-11 10:00:00.000000

"""
import os
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2a3b4c5d6e7f"
down_revision = "0a1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    dialect = connection.dialect.name

    current_secret_key = None
    try:
        result = connection.execute(sa.text("SELECT secret_key FROM jwt WHERE id = 1"))
        row = result.fetchone()
        if row and row[0]:
            current_secret_key = row[0]
    except Exception:
        current_secret_key = None

    new_admin_key = os.urandom(32).hex()
    new_vmess_mask = os.urandom(16).hex()
    new_vless_mask = os.urandom(16).hex()

    inspector = sa.inspect(connection)
    column_names = {col["name"] for col in inspector.get_columns("jwt")}

    # Add columns only if they don't already exist to make the migration idempotent.
    if "subscription_secret_key" not in column_names:
        op.add_column(
            "jwt",
            sa.Column("subscription_secret_key", sa.String(length=64), nullable=True),
        )
    if "admin_secret_key" not in column_names:
        op.add_column(
            "jwt",
            sa.Column("admin_secret_key", sa.String(length=64), nullable=True),
        )
    if "vmess_mask" not in column_names:
        op.add_column("jwt", sa.Column("vmess_mask", sa.String(length=32), nullable=True))
    if "vless_mask" not in column_names:
        op.add_column("jwt", sa.Column("vless_mask", sa.String(length=32), nullable=True))

    try:
        count_res = connection.execute(sa.text("SELECT COUNT(*) FROM jwt"))
        total_rows = (count_res.scalar() or 0)
    except Exception:
        total_rows = 0

    if total_rows == 0:
        connection.execute(
            sa.text(
                """
                INSERT INTO jwt (id, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
                VALUES (1, :sub_key, :admin_key, :vm, :vl)
                """
            ),
            {
                "sub_key": current_secret_key or os.urandom(32).hex(),
                "admin_key": new_admin_key,
                "vm": new_vmess_mask,
                "vl": new_vless_mask,
            },
        )
    else:
        connection.execute(
            sa.text(
                """
                UPDATE jwt 
                SET subscription_secret_key = COALESCE(subscription_secret_key, :sub_key),
                    admin_secret_key = COALESCE(admin_secret_key, :admin_key),
                    vmess_mask = COALESCE(vmess_mask, :vm),
                    vless_mask = COALESCE(vless_mask, :vl)
                WHERE id = 1
                """
            ),
            {
                "sub_key": (current_secret_key or os.urandom(32).hex()),
                "admin_key": new_admin_key,
                "vm": new_vmess_mask,
                "vl": new_vless_mask,
            },
        )

    # Alter column nullability safely only if the column exists.
    if "subscription_secret_key" in column_names:
        op.alter_column(
            "jwt",
            "subscription_secret_key",
            existing_type=sa.String(length=64),
            nullable=False,
        )
    if "admin_secret_key" in column_names:
        op.alter_column(
            "jwt",
            "admin_secret_key",
            existing_type=sa.String(length=64),
            nullable=False,
        )
    if "vmess_mask" in column_names:
        op.alter_column(
            "jwt",
            "vmess_mask",
            existing_type=sa.String(length=32),
            nullable=False,
        )
    if "vless_mask" in column_names:
        op.alter_column(
            "jwt",
            "vless_mask",
            existing_type=sa.String(length=32),
            nullable=False,
        )


def downgrade() -> None:
    # Remove new columns only if they exist
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    column_names = {col["name"] for col in inspector.get_columns("jwt")}

    if "vless_mask" in column_names:
        op.drop_column("jwt", "vless_mask")
    if "vmess_mask" in column_names:
        op.drop_column("jwt", "vmess_mask")
    if "admin_secret_key" in column_names:
        op.drop_column("jwt", "admin_secret_key")
    if "subscription_secret_key" in column_names:
        op.drop_column("jwt", "subscription_secret_key")

