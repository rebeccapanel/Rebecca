package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000009_services_schema.go", up000009ServicesSchema, emptyDown)
}

func up000009ServicesSchema(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createServicesTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := createAdminsServicesBase(ctx, tx, dialect); err != nil {
		return err
	}
	if err := createServiceHosts(ctx, tx, dialect); err != nil {
		return err
	}
	return addUserServiceID(ctx, tx, dialect)
}

func createServicesTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "services", `
CREATE TABLE services (
	id INTEGER PRIMARY KEY,
	name VARCHAR(128) NOT NULL,
	description VARCHAR(256) NULL,
	flow VARCHAR(255) NULL,
	used_traffic BIGINT NOT NULL DEFAULT 0,
	lifetime_used_traffic BIGINT NOT NULL DEFAULT 0,
	users_usage BIGINT NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(name)
)`, `
CREATE TABLE services (
	id INTEGER NOT NULL AUTO_INCREMENT,
	name VARCHAR(128) NOT NULL,
	description VARCHAR(256) NULL,
	flow VARCHAR(255) NULL,
	used_traffic BIGINT NOT NULL DEFAULT 0,
	lifetime_used_traffic BIGINT NOT NULL DEFAULT 0,
	users_usage BIGINT NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_services_name (name)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"description", "VARCHAR(256) NULL", ""},
		{"flow", "VARCHAR(255) NULL", ""},
		{"used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "services", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE services SET lifetime_used_traffic = COALESCE(NULLIF(lifetime_used_traffic, 0), COALESCE(used_traffic, 0)) WHERE COALESCE(lifetime_used_traffic, 0) = 0 AND COALESCE(used_traffic, 0) > 0`); err != nil {
		return err
	}
	return nil
}

func createAdminsServicesBase(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "admins_services", `
CREATE TABLE admins_services (
	admin_id INTEGER NOT NULL,
	service_id INTEGER NOT NULL,
	used_traffic BIGINT NOT NULL DEFAULT 0,
	lifetime_used_traffic BIGINT NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (admin_id, service_id),
	FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE,
	FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
)`, `
CREATE TABLE admins_services (
	admin_id INTEGER NOT NULL,
	service_id INTEGER NOT NULL,
	used_traffic BIGINT NOT NULL DEFAULT 0,
	lifetime_used_traffic BIGINT NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (admin_id, service_id),
	FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE,
	FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "admins_services", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE admins_services SET lifetime_used_traffic = COALESCE(NULLIF(lifetime_used_traffic, 0), COALESCE(used_traffic, 0)) WHERE COALESCE(lifetime_used_traffic, 0) = 0 AND COALESCE(used_traffic, 0) > 0`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admins_services", "ix_admins_services_service_id", []string{"service_id"}, false); err != nil {
		return err
	}
	return nil
}

func createServiceHosts(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "service_hosts", `
CREATE TABLE service_hosts (
	service_id INTEGER NOT NULL,
	host_id INTEGER NOT NULL,
	sort INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (service_id, host_id),
	FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE,
	FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE
)`, `
CREATE TABLE service_hosts (
	service_id INTEGER NOT NULL,
	host_id INTEGER NOT NULL,
	sort INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (service_id, host_id),
	FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE,
	FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE
)`); err != nil {
		return err
	}
	for _, item := range []struct{ column, definition string }{
		{"sort", "INTEGER NOT NULL DEFAULT 0"},
		{"created_at", "DATETIME NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "service_hosts", item.column, item.definition, item.definition); err != nil {
			return err
		}
	}
	return createIndex(ctx, tx, dialect, "service_hosts", "ix_service_hosts_host_id", []string{"host_id"}, false)
}

func addUserServiceID(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "users", "service_id", "INTEGER NULL", ""); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "users", "ix_users_service_id", []string{"service_id"}, false)
}
