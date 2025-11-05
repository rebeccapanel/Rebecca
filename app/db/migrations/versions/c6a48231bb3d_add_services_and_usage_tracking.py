"""add services and service usage tracking

Revision ID: c6a48231bb3d
Revises: b9e52f5491a6
Create Date: 2025-10-29 12:00:00.000000

"""
from datetime import datetime

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "c6a48231bb3d"
down_revision = "b9e52f5491a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    now = datetime.utcnow()

    services_data = []
    admins_services_data = []
    service_hosts_data = []
    users_service_links = []

    if "services" in existing_tables:
        service_columns = {col["name"] for col in inspector.get_columns("services")}
        select_cols = [
            col
            for col in (
                "id",
                "name",
                "description",
                "used_traffic",
                "lifetime_used_traffic",
                "created_at",
                "updated_at",
            )
            if col in service_columns
        ]
        if select_cols:
            rows = bind.execute(
                sa.text(f"SELECT {', '.join(select_cols)} FROM services")
            ).fetchall()
            for row in rows:
                record = dict(row._mapping)
                service_id = record.get("id")
                name = record.get("name")
                if service_id is None or not name:
                    continue
                used_traffic = int(record.get("used_traffic") or 0)
                lifetime_used_traffic = int(
                    record.get("lifetime_used_traffic")
                    if "lifetime_used_traffic" in record
                    and record.get("lifetime_used_traffic") is not None
                    else record.get("used_traffic") or 0
                )
                services_data.append(
                    {
                        "id": service_id,
                        "name": name,
                        "description": record.get("description"),
                        "used_traffic": used_traffic,
                        "lifetime_used_traffic": lifetime_used_traffic,
                        "created_at": record.get("created_at") or now,
                        "updated_at": record.get("updated_at") or now,
                    }
                )

    if "admins_services" in existing_tables:
        admin_service_columns = {
            col["name"] for col in inspector.get_columns("admins_services")
        }
        select_cols = [
            col
            for col in (
                "admin_id",
                "service_id",
                "used_traffic",
                "lifetime_used_traffic",
                "created_at",
                "updated_at",
            )
            if col in admin_service_columns
        ]
        if select_cols:
            rows = bind.execute(
                sa.text(f"SELECT {', '.join(select_cols)} FROM admins_services")
            ).fetchall()
            for row in rows:
                record = dict(row._mapping)
                admins_services_data.append(record)

    if "service_hosts" in existing_tables:
        service_host_columns = {
            col["name"] for col in inspector.get_columns("service_hosts")
        }
        select_cols = [
            col
            for col in ("service_id", "host_id", "sort", "created_at")
            if col in service_host_columns
        ]
        if select_cols:
            rows = bind.execute(
                sa.text(f"SELECT {', '.join(select_cols)} FROM service_hosts")
            ).fetchall()
            for row in rows:
                record = dict(row._mapping)
                service_hosts_data.append(record)

    if "users" in existing_tables:
        user_columns = {col["name"] for col in inspector.get_columns("users")}
        if "service_id" in user_columns:
            users_service_links = [
                dict(row._mapping)
                for row in bind.execute(
                    sa.text(
                        "SELECT id, service_id FROM users WHERE service_id IS NOT NULL"
                    )
                ).fetchall()
            ]
            fk_names = [
                fk["name"]
                for fk in inspector.get_foreign_keys("users")
                if fk.get("referred_table") == "services"
            ]
            index_names = [
                idx["name"]
                for idx in inspector.get_indexes("users")
                if idx.get("column_names") == ["service_id"]
            ]
            with op.batch_alter_table("users") as batch_op:
                for fk_name in fk_names:
                    if fk_name:
                        batch_op.drop_constraint(fk_name, type_="foreignkey")
                for index_name in index_names:
                    batch_op.drop_index(index_name)
                batch_op.drop_column("service_id")

    if "admins_services" in existing_tables:
        op.drop_table("admins_services")
    if "service_hosts" in existing_tables:
        op.drop_table("service_hosts")
    if "services" in existing_tables:
        op.drop_table("services")

    op.create_table(
        "services",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=256), nullable=True),
        sa.Column("used_traffic", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "lifetime_used_traffic",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
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
            "lifetime_used_traffic",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
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
            ["admin_id"],
            ["admins.id"],
            ondelete="CASCADE",
            name="fk_admins_services_admin_id",
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            ondelete="CASCADE",
            name="fk_admins_services_service_id",
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
            ["host_id"],
            ["hosts.id"],
            ondelete="CASCADE",
            name="fk_service_hosts_host_id",
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

    services_table = sa.table(
        "services",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String(length=128)),
        sa.column("description", sa.String(length=256)),
        sa.column("used_traffic", sa.BigInteger),
        sa.column("lifetime_used_traffic", sa.BigInteger),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )

    admins_services_table = sa.table(
        "admins_services",
        sa.column("admin_id", sa.Integer),
        sa.column("service_id", sa.Integer),
        sa.column("used_traffic", sa.BigInteger),
        sa.column("lifetime_used_traffic", sa.BigInteger),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )

    service_hosts_table = sa.table(
        "service_hosts",
        sa.column("service_id", sa.Integer),
        sa.column("host_id", sa.Integer),
        sa.column("sort", sa.Integer),
        sa.column("created_at", sa.DateTime),
    )

    unique_services = {}
    for record in services_data:
        unique_services[record["id"]] = record
    services_data = sorted(unique_services.values(), key=lambda item: item["id"])

    if services_data:
        op.bulk_insert(services_table, services_data)

        if bind.dialect.name == "postgresql":
            max_service_id = max(service["id"] for service in services_data)
            bind.execute(
                sa.text(
                    "SELECT setval(pg_get_serial_sequence('services', 'id'), :value)"
                ),
                {"value": max_service_id},
            )

    existing_service_ids = {service["id"] for service in services_data}

    unique_admin_links = {}
    for record in admins_services_data:
        admin_id = record.get("admin_id")
        service_id = record.get("service_id")
        if admin_id is None or service_id not in existing_service_ids:
            continue
        key = (admin_id, service_id)
        if key in unique_admin_links:
            continue
        used = int(record.get("used_traffic") or 0)
        lifetime_used = int(
            record.get("lifetime_used_traffic")
            if "lifetime_used_traffic" in record
            and record.get("lifetime_used_traffic") is not None
            else used
        )
        unique_admin_links[key] = {
            "admin_id": admin_id,
            "service_id": service_id,
            "used_traffic": used,
            "lifetime_used_traffic": lifetime_used,
            "created_at": record.get("created_at") or now,
            "updated_at": record.get("updated_at") or now,
        }

    if unique_admin_links:
        op.bulk_insert(admins_services_table, list(unique_admin_links.values()))

    unique_service_hosts = {}
    for record in service_hosts_data:
        service_id = record.get("service_id")
        host_id = record.get("host_id")
        if service_id not in existing_service_ids or host_id is None:
            continue
        key = (service_id, host_id)
        if key in unique_service_hosts:
            continue
        unique_service_hosts[key] = {
            "service_id": service_id,
            "host_id": host_id,
            "sort": int(record.get("sort") or 0),
            "created_at": record.get("created_at") or now,
        }

    if unique_service_hosts:
        op.bulk_insert(service_hosts_table, list(unique_service_hosts.values()))

    if users_service_links and existing_service_ids:
        update_stmt = sa.text(
            "UPDATE users SET service_id = :service_id WHERE id = :id"
        )
        for link in users_service_links:
            service_id = link.get("service_id")
            if service_id not in existing_service_ids:
                continue
            bind.execute(update_stmt, link)


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
