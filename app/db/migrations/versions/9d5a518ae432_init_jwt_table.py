"""init jwt table

Revision ID: 9d5a518ae432
Revises: 3cf36a5fde73
Create Date: 2022-11-24 21:02:44.278773

"""
import os
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9d5a518ae432'
down_revision = '3cf36a5fde73'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    if "jwt" not in set(inspector.get_table_names()):
        table = op.create_table(
            "jwt",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("secret_key", sa.String(length=64), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        table = sa.Table("jwt", sa.MetaData(), autoload_with=connection)

    has_seed = bool(connection.execute(sa.text("SELECT 1 FROM jwt WHERE id = 1 LIMIT 1")).first())
    if not has_seed:
        op.bulk_insert(table, [_build_jwt_seed_row(connection)])


def downgrade() -> None:
    op.drop_table("jwt")


def _build_jwt_seed_row(connection: sa.engine.Connection) -> dict[str, object]:
    row: dict[str, object] = {}
    columns = sa.inspect(connection).get_columns("jwt")

    for column in columns:
        name = column["name"]
        nullable = bool(column.get("nullable", True))

        if name == "id":
            row[name] = 1
            continue
        if name in {"secret_key", "subscription_secret_key", "admin_secret_key"}:
            row[name] = os.urandom(32).hex()
            continue
        if name in {"vmess_mask", "vless_mask"}:
            row[name] = os.urandom(16).hex()
            continue
        if nullable:
            continue
        row[name] = _fallback_not_null_value(column.get("type"))

    return row


def _fallback_not_null_value(column_type: object) -> object:
    type_name = str(column_type).lower()
    if "int" in type_name:
        return 0
    if any(token in type_name for token in ("float", "double", "real", "numeric", "decimal")):
        return 0
    if "bool" in type_name:
        return False
    if "json" in type_name:
        return "{}"
    if "date" in type_name or "time" in type_name:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return ""
