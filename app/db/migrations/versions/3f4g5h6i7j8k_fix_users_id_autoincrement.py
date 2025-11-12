"""Fix users id autoincrement

Revision ID: 3f4g5h6i7j8k
Revises: 2a3b4c5d6e7f
Create Date: 2025-11-11 17:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "3f4g5h6i7j8k"
down_revision = "2a3b4c5d6e7f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    dialect_name = connection.dialect.name

    if "users" not in inspector.get_table_names():
        return

    columns = inspector.get_columns("users")
    id_column = next((col for col in columns if col["name"] == "id"), None)
    
    if not id_column:
        return

    if dialect_name in ("mysql", "mariadb"):
        try:
            result = connection.execute(
                sa.text(
                    """
                    SELECT COLUMN_TYPE, EXTRA
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'users' 
                    AND COLUMN_NAME = 'id'
                    """
                )
            )
            row = result.fetchone()
            
            has_auto_increment = False
            if row:
                column_type = row[0] if row[0] else ""
                extra = row[1] if len(row) > 1 and row[1] else ""
                has_auto_increment = (
                    "auto_increment" in column_type.lower() or
                    "auto_increment" in extra.lower()
                )
            
            if not has_auto_increment:
                op.execute(
                    sa.text("ALTER TABLE users MODIFY COLUMN id INTEGER NOT NULL AUTO_INCREMENT")
                )
        except Exception:
            try:
                op.execute(
                    sa.text("ALTER TABLE users MODIFY COLUMN id INTEGER NOT NULL AUTO_INCREMENT")
                )
            except Exception:
                pass

    try:
        if "nodes" in inspector.get_table_names():
            nodes_columns = inspector.get_columns("nodes")
            column_names = {col["name"] for col in nodes_columns}
            
            if "geo_mode" not in column_names:
                if dialect_name == "sqlite":
                    op.add_column('nodes', sa.Column('geo_mode', sa.String(10), nullable=False, server_default='default'))
                elif dialect_name == "postgresql":
                    connection.execute(
                        sa.text("DO $$ BEGIN CREATE TYPE geomode AS ENUM ('default', 'custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;")
                    )
                    connection.execute(
                        sa.text("ALTER TABLE nodes ADD COLUMN geo_mode geomode NOT NULL DEFAULT 'default'")
                    )
                elif dialect_name in ("mysql", "mariadb"):
                    op.add_column('nodes', sa.Column('geo_mode', sa.Enum('default', 'custom', name='geomode'), nullable=False, server_default='default'))
    except Exception:
        pass


def downgrade() -> None:
    pass

