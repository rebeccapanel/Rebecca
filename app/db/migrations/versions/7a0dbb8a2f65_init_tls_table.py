"""init tls table

Revision ID: 7a0dbb8a2f65
Revises: 77c86a261126
Create Date: 2023-10-22 13:58:12.431246

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '7a0dbb8a2f65'
down_revision = '77c86a261126'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    if "tls" not in set(inspector.get_table_names()):
        table = op.create_table(
            "tls",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("key", sa.String(length=4096), nullable=False),
            sa.Column("certificate", sa.String(length=2048), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        table = sa.Table("tls", sa.MetaData(), autoload_with=connection)

    # INSERT DEFAULT ROW
    from app.utils.crypto import generate_certificate

    has_seed = bool(connection.execute(sa.text("SELECT 1 FROM tls WHERE id = 1 LIMIT 1")).first())
    if not has_seed:
        tls = generate_certificate()
        op.bulk_insert(table, [{"id": 1, "key": tls["key"], "certificate": tls["cert"]}])


def downgrade() -> None:
    op.drop_table("tls")
