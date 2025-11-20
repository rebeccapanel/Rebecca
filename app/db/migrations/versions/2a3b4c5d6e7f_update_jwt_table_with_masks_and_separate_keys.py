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

    inspector = sa.inspect(connection)
    jwt_columns = {column["name"] for column in inspector.get_columns("jwt")}

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

    def _ensure_column(column: sa.Column) -> None:
        if column.name not in jwt_columns:
            op.add_column("jwt", column)
            jwt_columns.add(column.name)

    _ensure_column(sa.Column("subscription_secret_key", sa.String(length=64), nullable=True))
    _ensure_column(sa.Column("admin_secret_key", sa.String(length=64), nullable=True))
    _ensure_column(sa.Column("vmess_mask", sa.String(length=32), nullable=True))
    _ensure_column(sa.Column("vless_mask", sa.String(length=32), nullable=True))

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
                """,
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
                """,
            ),
            {
                "sub_key": (current_secret_key or os.urandom(32).hex()),
                "admin_key": new_admin_key,
                "vm": new_vmess_mask,
                "vl": new_vless_mask,
            },
        )

    def _set_not_null(column_name: str, length: int) -> None:
        if dialect == "sqlite":
            return
        op.alter_column(
            "jwt",
            column_name,
            existing_type=sa.String(length=length),
            nullable=False,
        )

    _set_not_null("subscription_secret_key", 64)
    _set_not_null("admin_secret_key", 64)
    _set_not_null("vmess_mask", 32)
    _set_not_null("vless_mask", 32)


def downgrade() -> None:
    # Remove new columns
    op.drop_column("jwt", "vless_mask")
    op.drop_column("jwt", "vmess_mask")
    op.drop_column("jwt", "admin_secret_key")
    op.drop_column("jwt", "subscription_secret_key")
