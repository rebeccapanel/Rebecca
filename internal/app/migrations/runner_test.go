package migrations

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	platformdb "github.com/rebeccapanel/rebecca/internal/platform/db"

	_ "github.com/mattn/go-sqlite3"
	_ "modernc.org/sqlite"
)

func openSQLiteTestDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "migrations.sqlite3")
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Ping(); err != nil {
		if strings.Contains(err.Error(), "go-sqlite3 requires cgo") {
			_ = db.Close()
			db, err = sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if pingErr := db.Ping(); pingErr != nil {
				t.Fatal(pingErr)
			}
		} else {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestRunMigrationsFreshSQLiteAndDoubleRun(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected version after first run: %#v", version)
	}
	assertTableColumns(t, ctx, db, "sqlite", "admins", []string{"id", "username", "role", "permissions", "status", "created_traffic", "delete_user_usage_limit"})
	assertTableColumns(t, ctx, db, "sqlite", "admin_api_keys", []string{"id", "admin_id", "key_hash", "created_at", "expires_at", "last_used_at"})
	assertTableColumns(t, ctx, db, "sqlite", "admin_usage_logs", []string{"admin_id", "used_traffic_at_reset", "created_traffic_at_reset", "reset_at"})
	assertTableColumns(t, ctx, db, "sqlite", "admin_created_traffic_logs", []string{"admin_id", "service_id", "amount", "action", "created_at"})
	assertTableColumns(t, ctx, db, "sqlite", "users", []string{"id", "username", "credential_key", "subadress", "flow", "sub_revoked_at", "sub_updated_at", "sub_last_user_agent", "ip_limit", "admin_disabled_at"})
	assertTableColumns(t, ctx, db, "sqlite", "next_plans", []string{"user_id", "position", "data_limit", "expire", "increase_data_limit", "start_on_first_connect", "trigger_on"})
	assertTableColumns(t, ctx, db, "sqlite", "user_usage_logs", []string{"user_id", "used_traffic_at_reset", "reset_at"})
	assertNoTable(t, ctx, db, "sqlite", "notification_reminders")
	assertNoTable(t, ctx, db, "sqlite", "user_templates")
	assertNoTable(t, ctx, db, "sqlite", "template_inbounds_association")
	assertNoTable(t, ctx, db, "sqlite", "exclude_inbounds_association")
	assertNoTable(t, ctx, db, "sqlite", "access_insights")
	assertTableColumns(t, ctx, db, "sqlite", "hosts", []string{"id", "remark", "inbound_tag", "noise_setting", "random_user_agent"})
	assertNoColumn(t, ctx, db, "sqlite", "hosts", "sort")
	assertTableColumns(t, ctx, db, "sqlite", "nodes", []string{"id", "name", "note", "certificate", "certificate_key", "xray_config_mode"})
	assertNoColumn(t, ctx, db, "sqlite", "nodes", "use_nobetci")
	assertNoColumn(t, ctx, db, "sqlite", "nodes", "nobetci_port")
	assertNoColumn(t, ctx, db, "sqlite", "panel_settings", "use_nobetci")
	assertTableColumns(t, ctx, db, "sqlite", "node_operations", []string{"operation_type", "status", "idempotency_key"})
	assertTableColumns(t, ctx, db, "sqlite", "pending_node_certificates", []string{"token", "certificate", "certificate_key", "expires_at"})
	assertTableColumns(t, ctx, db, "sqlite", "xray_config", []string{"id", "data", "created_at", "updated_at"})
	assertTableColumns(t, ctx, db, "sqlite", "outbound_traffic", []string{"outbound_id", "tag", "target_id", "node_id", "uplink", "downlink"})
	assertTableColumns(t, ctx, db, "sqlite", "services", []string{"id", "name", "description", "flow", "used_traffic", "lifetime_used_traffic", "users_usage"})
	assertTableColumns(t, ctx, db, "sqlite", "admins_services", []string{"admin_id", "service_id", "used_traffic", "lifetime_used_traffic", "created_traffic", "data_limit", "users_limit", "traffic_limit_mode", "show_user_traffic", "delete_user_usage_limit", "deleted_users_usage"})
	assertTableColumns(t, ctx, db, "sqlite", "service_hosts", []string{"service_id", "host_id", "sort", "created_at"})
	assertTableColumns(t, ctx, db, "sqlite", "settings", []string{"dashboard_path", "record_node_usage", "phpmyadmin_enabled", "phpmyadmin_port", "phpmyadmin_path", "phpmyadmin_public_url"})
	assertTableColumns(t, ctx, db, "sqlite", "subscription_settings", []string{"subscription_profile_title", "subscription_support_url", "subscription_aliases", "subscription_path", "subscription_ports"})
	assertTableColumns(t, ctx, db, "sqlite", "subscription_domains", []string{"domain", "admin_id", "email", "provider", "alt_names"})
	assertTableColumns(t, ctx, db, "sqlite", "telegram_settings", []string{"use_telegram", "event_toggles", "backup_enabled", "backup_scope", "backup_interval_value", "backup_chat_id", "backup_chat_is_forum", "last_sent_at", "last_error"})
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vmess_mask")
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vless_mask")
	assertIndex(t, ctx, db, "sqlite", "users", "ix_users_admin_status_created_id")
	assertIndex(t, ctx, db, "sqlite", "users", "ix_users_credential_key")
	assertIndex(t, ctx, db, "sqlite", "proxies", "ix_proxies_user_type")
	assertIndex(t, ctx, db, "sqlite", "node_user_usages", "ix_node_user_usages_user_created_node")
	assertNoIndex(t, ctx, db, "sqlite", "admin_api_keys", "ix_admin_api_keys_key_hash")
	assertNoIndex(t, ctx, db, "sqlite", "subscription_domains", "ix_subscription_domains_domain")
	assertNoIndex(t, ctx, db, "sqlite", "warp_accounts", "ix_warp_accounts_device_id")
	assertNoIndex(t, ctx, db, "sqlite", "hosts", "ix_hosts_inbound_tag_sort_id")
	assertIndex(t, ctx, db, "sqlite", "hosts", "ix_hosts_inbound_tag")
	assertTableColumns(t, ctx, db, "sqlite", "warp_accounts", []string{"device_id", "access_token", "license_key", "private_key", "public_key"})

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("second run migrations: %v", err)
	}
	second, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("second version: %v", err)
	}
	if second.GooseVersion != version.GooseVersion {
		t.Fatalf("goose version changed after idempotent run: %#v -> %#v", version, second)
	}
}

func TestRunMigrationsExternalDatabase(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("REBECCA_TEST_DATABASE_URL"))
	if url == "" {
		t.Skip("REBECCA_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := platformdb.Open(url)
	if err != nil {
		t.Fatalf("open external database: %v", err)
	}
	t.Cleanup(func() { _ = pool.DB.Close() })
	if err := RunMigrations(ctx, pool.DB, pool.Dialect); err != nil {
		t.Fatalf("run external migrations: %v", err)
	}
	version, err := Version(ctx, pool.DB, pool.Dialect)
	if err != nil {
		t.Fatalf("external version: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected external version: %#v", version)
	}
	for _, table := range []string{"admins", "users", "nodes", "services", "subscription_settings", "goose_db_version"} {
		hasTable, err := HasTable(ctx, pool.DB, pool.Dialect, table)
		if err != nil {
			t.Fatalf("has external table %s: %v", table, err)
		}
		if !hasTable {
			t.Fatalf("missing external table %s", table)
		}
	}
}

func TestDetectAlembicVersion(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO alembic_version (version_num) VALUES ('23_drop_access_insights')`); err != nil {
		t.Fatal(err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if !version.HasAlembic || version.AlembicRevision != "23_drop_access_insights" {
		t.Fatalf("unexpected alembic version: %#v", version)
	}
	if version.HasGoose {
		t.Fatalf("goose table should not exist yet: %#v", version)
	}
}

func TestKnownBadAlembicMergeRevisionIsBypassed(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO alembic_version (version_num) VALUES ('5g6h7i8j9k0l')`); err != nil {
		t.Fatal(err)
	}

	status, err := Status(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("status before migration: %v", err)
	}
	if !status.Version.LegacyRevisionKnownBad || !strings.Contains(status.Message, "known-bad legacy Alembic revision") {
		t.Fatalf("expected known-bad legacy status, got %#v", status)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations from broken merge revision: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version after migration: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected goose version after bypass: %#v", version)
	}
	if !version.LegacyRevisionKnownBad || !strings.Contains(version.LegacyRevisionHandling, "merge/no-op") {
		t.Fatalf("expected known-bad revision metadata to remain visible: %#v", version)
	}
	assertTableColumns(t, ctx, db, "sqlite", "admins", []string{"username", "role", "status"})
	assertTableColumns(t, ctx, db, "sqlite", "users", []string{"username", "credential_key"})
}

func TestKnownBadAlembicSudoPromotionRevisionIsRepaired(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO alembic_version (version_num) VALUES ('ff05a3b7cdef')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	is_sudo INTEGER DEFAULT 0,
	role VARCHAR(32),
	permissions TEXT,
	status VARCHAR(32)
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO admins (id, username, hashed_password, is_sudo, role, permissions, status)
VALUES
	(1, 'role_sudo', 'hash', 0, 'sudo', NULL, 'active'),
	(2, 'flag_sudo', 'hash', 1, 'standard', '', 'active')`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations from broken sudo promotion revision: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version after migration: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected goose version after repair: %#v", version)
	}
	if !version.LegacyRevisionKnownBad || !strings.Contains(version.LegacyRevisionHandling, "admin role repair") {
		t.Fatalf("expected sudo repair metadata: %#v", version)
	}
	hasSudoColumn, err := HasColumn(ctx, db, "sqlite", "admins", "is_sudo")
	if err != nil {
		t.Fatalf("check is_sudo column: %v", err)
	}
	if hasSudoColumn {
		t.Fatal("legacy is_sudo column should be removed")
	}
	rows, err := db.QueryContext(ctx, `SELECT username, role, status, permissions FROM admins ORDER BY id`)
	if err != nil {
		t.Fatalf("query admins: %v", err)
	}
	defer rows.Close()
	roles := map[string]string{}
	statuses := map[string]string{}
	permissions := map[string]string{}
	for rows.Next() {
		var username, role, status, permission string
		if err := rows.Scan(&username, &role, &status, &permission); err != nil {
			t.Fatalf("scan admin: %v", err)
		}
		roles[username] = role
		statuses[username] = status
		permissions[username] = permission
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("admin rows: %v", err)
	}
	for _, username := range []string{"role_sudo", "flag_sudo"} {
		if roles[username] != "full_access" {
			t.Fatalf("%s role = %q, want full_access", username, roles[username])
		}
		if statuses[username] != "active" {
			t.Fatalf("%s status = %q, want active", username, statuses[username])
		}
		if strings.TrimSpace(permissions[username]) != "{}" {
			t.Fatalf("%s permissions = %q, want {}", username, permissions[username])
		}
	}
}

func TestFinalAlembicDatabaseIsBaselinedBeforeGoOnlyMigrations(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO alembic_version (version_num) VALUES ('23_drop_access_insights')`); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, username VARCHAR(34), role VARCHAR(32), permissions TEXT)`,
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username VARCHAR(34),
			credential_key VARCHAR(64),
			status VARCHAR(32),
			admin_id INTEGER,
			service_id INTEGER,
			created_at DATETIME,
			expire INTEGER,
			admin_disabled_at DATETIME
		)`,
		`CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type VARCHAR(32), settings TEXT)`,
		`CREATE TABLE hosts (id INTEGER PRIMARY KEY, inbound_tag VARCHAR(256), sort INTEGER)`,
		`CREATE TABLE service_hosts (service_id INTEGER, host_id INTEGER, sort INTEGER)`,
		`CREATE TABLE next_plans (id INTEGER PRIMARY KEY, user_id INTEGER, position INTEGER)`,
		`CREATE TABLE user_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER)`,
		`CREATE TABLE node_user_usages (id INTEGER PRIMARY KEY, user_id INTEGER, node_id INTEGER, created_at DATETIME)`,
		`CREATE TABLE node_usages (id INTEGER PRIMARY KEY, node_id INTEGER, created_at DATETIME)`,
		`CREATE TABLE services (id INTEGER PRIMARY KEY, name VARCHAR(64), users_usage BIGINT DEFAULT 0)`,
		`CREATE TABLE admins_services (admin_id INTEGER, service_id INTEGER, traffic_limit_mode VARCHAR(32))`,
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY, name VARCHAR(64), xray_config_mode VARCHAR(32))`,
		`CREATE TABLE node_operations (id INTEGER PRIMARY KEY, operation_type VARCHAR(32), idempotency_key VARCHAR(255))`,
		`CREATE TABLE xray_config (id INTEGER PRIMARY KEY, data TEXT)`,
		`CREATE TABLE subscription_settings (id INTEGER PRIMARY KEY, subscription_path VARCHAR(255))`,
		`CREATE TABLE telegram_settings (id INTEGER PRIMARY KEY, backup_scope VARCHAR(32))`,
		`CREATE TABLE jwt (
			id INTEGER PRIMARY KEY,
			secret_key VARCHAR(256),
			subscription_secret_key VARCHAR(256),
			admin_secret_key VARCHAR(256),
			vmess_mask VARCHAR(32),
			vless_mask VARCHAR(32)
		)`,
		`CREATE TABLE exclude_inbounds_association (proxy_id INTEGER, inbound_tag VARCHAR(256))`,
	} {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO jwt (id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
VALUES (1, 'secret', 'sub', 'admin', '00000000000000000000000000000000', '00000000000000000000000000000000')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, credential_key, status, admin_id, service_id, created_at, expire)
VALUES
	(1, 'dupe', '00112233445566778899aabbccddeeff', 'active', 1, 1, '2026-06-01 00:00:00', NULL),
	(2, 'DUPE', '11112233445566778899aabbccddeeff', 'active', 1, 1, '2026-06-01 00:00:00', NULL),
	(3, 'unique', '22112233445566778899aabbccddeeff', 'deactive', 1, 1, '2026-06-01 00:00:00', NULL)`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run final alembic baseline migrations: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version after baseline: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected goose version after final alembic baseline: %#v", version)
	}
	var appliedBeforeGoOnly int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM goose_db_version WHERE version_id BETWEEN 1 AND 16 AND is_applied = 1`).Scan(&appliedBeforeGoOnly); err != nil {
		t.Fatal(err)
	}
	if appliedBeforeGoOnly != int(legacyAlembicFinalBaseline) {
		t.Fatalf("legacy baseline did not seed versions 1..16, got %d", appliedBeforeGoOnly)
	}
	assertNoTable(t, ctx, db, "sqlite", "exclude_inbounds_association")
	assertNoColumn(t, ctx, db, "sqlite", "hosts", "sort")
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vmess_mask")
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vless_mask")
	assertTableColumns(t, ctx, db, "sqlite", "nodes", []string{"note"})
	assertDBStringMigration(t, db, `SELECT username FROM users WHERE id = 1`, "dupe_2")
	assertDBStringMigration(t, db, `SELECT username FROM users WHERE id = 2`, "DUPE")
	assertDBStringMigration(t, db, `SELECT status FROM users WHERE id = 3`, "disabled")
	var proxyRows int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM proxies WHERE user_id IN (1, 2, 3)`).Scan(&proxyRows); err != nil {
		t.Fatal(err)
	}
	if proxyRows != 6 {
		t.Fatalf("expected legacy VMess/VLESS proxy materialization for three users, got %d rows", proxyRows)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username) VALUES (99, 'DUPE')`); err == nil {
		t.Fatal("expected duplicate username insert to fail after legacy repair")
	}
}

func TestDetectGooseVersion(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected goose version: %#v", version)
	}
}

func TestRunMigrationsToSQLite(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if err := RunMigrationsTo(ctx, db, "sqlite", 3); err != nil {
		t.Fatalf("run migrations to checkpoint: %v", err)
	}
	version, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version after checkpoint: %v", err)
	}
	if !version.HasGoose || version.GooseVersion != 3 {
		t.Fatalf("unexpected checkpoint version: %#v", version)
	}
	assertTableColumns(t, ctx, db, "sqlite", "nodes", []string{"id", "name", "address", "port"})
	assertNoTable(t, ctx, db, "sqlite", "services")

	if err := RunMigrationsTo(ctx, db, "sqlite", latestGooseVersion); err != nil {
		t.Fatalf("run migrations to final checkpoint: %v", err)
	}
	finalVersion, err := Version(ctx, db, "sqlite")
	if err != nil {
		t.Fatalf("version after final checkpoint: %v", err)
	}
	if finalVersion.GooseVersion != latestGooseVersion {
		t.Fatalf("unexpected final version: %#v", finalVersion)
	}
	assertTableColumns(t, ctx, db, "sqlite", "services", []string{"id", "name", "used_traffic"})
}

func TestUnsupportedDowngrade(t *testing.T) {
	if err := UnsupportedDowngrade(); err == nil {
		t.Fatal("expected unsupported downgrade error")
	}
}

func TestHelpersSQLite(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	created, err := CreateTableIfMissing(ctx, db, "sqlite", "demo", `CREATE TABLE demo (id INTEGER PRIMARY KEY)`)
	if err != nil {
		t.Fatalf("create table: %v", err)
	}
	if !created {
		t.Fatal("expected table creation")
	}
	createdAgain, err := CreateTableIfMissing(ctx, db, "sqlite", "demo", `CREATE TABLE demo (id INTEGER PRIMARY KEY)`)
	if err != nil {
		t.Fatalf("create table again: %v", err)
	}
	if createdAgain {
		t.Fatal("expected existing table to be skipped")
	}

	hasTable, err := HasTable(ctx, db, "sqlite", "demo")
	if err != nil || !hasTable {
		t.Fatalf("has table=%v err=%v", hasTable, err)
	}
	hasID, err := HasColumn(ctx, db, "sqlite", "demo", "id")
	if err != nil || !hasID {
		t.Fatalf("has id=%v err=%v", hasID, err)
	}
	added, err := AddColumnIfMissing(ctx, db, "sqlite", "demo", "name", "TEXT")
	if err != nil || !added {
		t.Fatalf("add name=%v err=%v", added, err)
	}
	addedAgain, err := AddColumnIfMissing(ctx, db, "sqlite", "demo", "name", "TEXT")
	if err != nil {
		t.Fatalf("add name again: %v", err)
	}
	if addedAgain {
		t.Fatal("expected existing column to be skipped")
	}
	addedDescription, err := AddColumnIfMissing(ctx, db, "sqlite", "demo", "description", "TEXT")
	if err != nil || !addedDescription {
		t.Fatalf("add description=%v err=%v", addedDescription, err)
	}

	indexed, err := CreateIndexIfMissing(ctx, db, "sqlite", "demo", "idx_demo_name", []string{"name"}, false)
	if err != nil || !indexed {
		t.Fatalf("create index=%v err=%v", indexed, err)
	}
	hasIndex, err := HasIndex(ctx, db, "sqlite", "demo", "idx_demo_name")
	if err != nil || !hasIndex {
		t.Fatalf("has index=%v err=%v", hasIndex, err)
	}
	droppedIndex, err := DropIndexIfExists(ctx, db, "sqlite", "demo", "idx_demo_name")
	if err != nil || !droppedIndex {
		t.Fatalf("drop index=%v err=%v", droppedIndex, err)
	}
	droppedIndexAgain, err := DropIndexIfExists(ctx, db, "sqlite", "demo", "idx_demo_name")
	if err != nil {
		t.Fatalf("drop index again: %v", err)
	}
	if droppedIndexAgain {
		t.Fatal("expected missing index to be skipped")
	}
	if _, err := ExecDialect(ctx, db, "sqlite", `INSERT INTO demo (name) VALUES (?)`, ``, "pouria"); err != nil {
		t.Fatalf("exec dialect: %v", err)
	}
	dropped, err := DropColumnIfExists(ctx, db, "sqlite", "demo", "description")
	if err != nil {
		t.Fatalf("drop column: %v", err)
	}
	if !dropped {
		t.Fatal("expected description column drop")
	}
	droppedAgain, err := DropColumnIfExists(ctx, db, "sqlite", "demo", "description")
	if err != nil {
		t.Fatalf("drop column again: %v", err)
	}
	if droppedAgain {
		t.Fatal("expected missing column to be skipped")
	}
}

func TestAdminLegacyMigrationBackfillsAndPreservesState(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	is_sudo INTEGER NOT NULL DEFAULT 0,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	disabled_reason VARCHAR(512) NULL
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO admins (id, username, hashed_password, is_sudo, status, disabled_reason)
VALUES
	(1, 'legacy_sudo', 'x', 1, 'active', NULL),
	(2, 'legacy_deleted', 'x', 0, 'deleted', NULL),
	(3, 'legacy_disabled', 'x', 0, 'disabled', 'manual')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	admin_id INTEGER,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	data_limit BIGINT NULL
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, admin_id, status, data_limit)
VALUES
	(10, 'u1', 1, 'active', 100),
	(11, 'u2', 1, 'deleted', 200),
	(12, 'u3', 2, 'active', 300),
	(13, 'u4', 3, 'active', NULL)`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	assertNoColumn(t, ctx, db, "sqlite", "admins", "is_sudo")
	assertAdminRow(t, db, 1, "full_access", "active", "", 100)
	assertAdminRow(t, db, 2, "standard", "deleted", "", 300)
	assertAdminRow(t, db, 3, "standard", "disabled", "manual", 0)
	assertTableColumns(t, ctx, db, "sqlite", "admin_api_keys", []string{"admin_id", "key_hash"})
	assertTableColumns(t, ctx, db, "sqlite", "admins", []string{"users_usage", "lifetime_usage", "created_traffic", "deleted_users_usage", "data_limit", "users_limit", "delete_user_usage_limit"})

	var permissions string
	if err := db.QueryRowContext(ctx, `SELECT permissions FROM admins WHERE id = 1`).Scan(&permissions); err != nil {
		t.Fatal(err)
	}
	if permissions != "{}" {
		t.Fatalf("expected default permissions '{}', got %q", permissions)
	}
	var logs int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_created_traffic_logs WHERE action = 'migration_backfill'`).Scan(&logs); err != nil {
		t.Fatal(err)
	}
	if logs != 2 {
		t.Fatalf("expected two created traffic backfill logs, got %d", logs)
	}
}

func TestUserLifecycleCredentialAndUsernameMigration(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO admins (id, username, hashed_password) VALUES (1, 'owner', 'x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE jwt (
	id INTEGER PRIMARY KEY,
	secret_key VARCHAR(64),
	subscription_secret_key VARCHAR(64) NOT NULL DEFAULT 'sub',
	admin_secret_key VARCHAR(64) NOT NULL DEFAULT 'admin',
	vmess_mask VARCHAR(32) NOT NULL DEFAULT '00000000000000000000000000000000',
	vless_mask VARCHAR(32) NOT NULL DEFAULT '00000000000000000000000000000000'
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO jwt (id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
VALUES (1, 'legacy', 'sub', 'admin', '00000000000000000000000000000000', '00000000000000000000000000000000')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	status VARCHAR(32),
	used_traffic BIGINT,
	data_limit BIGINT,
	expire INTEGER,
	admin_id INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, status, used_traffic, data_limit, expire, admin_id)
VALUES
	(1, 'Alice', 'deactive', 0, 100, NULL, 1),
	(2, 'alice', 'active', 0, 100, NULL, 1),
	(3, 'expired_user', 'expired', 0, 100, 1700000000, 1),
	(4, 'limited_user', 'limited', 0, 100, NULL, 1),
	(5, 'random_key_user', 'active', 0, 100, NULL, 1),
	(6, 'bob', 'active', 0, 100, NULL, 1),
	(7, 'bob', 'active', 0, 100, NULL, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE proxies (
	id INTEGER PRIMARY KEY,
	user_id INTEGER,
	type VARCHAR(32) NOT NULL,
	settings TEXT NOT NULL
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO proxies (id, user_id, type, settings)
VALUES
	(1, 1, 'vless', '{"id":"11111111-1111-4111-8111-111111111111","flow":"xtls-rprx-vision"}'),
	(2, 2, 'vmess', '{"id":"22222222-2222-4222-8222-222222222222"}')`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	assertUserRow(t, db, 1, "Alice_2", "disabled", "11111111111141118111111111111111", "xtls-rprx-vision")
	assertUserRow(t, db, 2, "alice", "active", "22222222222242228222222222222222", "")
	assertUserStatus(t, db, 3, "expired")
	assertUserStatus(t, db, 4, "limited")
	assertCredentialKeyNull(t, db, 5)
	assertUserName(t, db, 6, "bob_2_6")
	assertUserName(t, db, 7, "bob")
	assertTableColumns(t, ctx, db, "sqlite", "next_plans", []string{"position", "increase_data_limit", "start_on_first_connect", "trigger_on"})

	var proxySettings string
	if err := db.QueryRowContext(ctx, `SELECT settings FROM proxies WHERE id = 1`).Scan(&proxySettings); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(proxySettings, "flow") {
		t.Fatalf("expected flow to be removed from proxy settings, got %s", proxySettings)
	}
	var subadress string
	if err := db.QueryRowContext(ctx, `SELECT subadress FROM users WHERE id = 1`).Scan(&subadress); err != nil {
		t.Fatal(err)
	}
	if subadress != "" {
		t.Fatalf("expected empty subadress default, got %q", subadress)
	}
	var lastStatus sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT last_status_change FROM users WHERE id = 3`).Scan(&lastStatus); err != nil {
		t.Fatal(err)
	}
	if !lastStatus.Valid || lastStatus.String == "" {
		t.Fatal("expected expired user last_status_change backfill")
	}
}

func TestLegacyMaskedCredentialMaterializedBeforeMaskDrop(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE jwt (
	id INTEGER PRIMARY KEY,
	secret_key VARCHAR(64),
	subscription_secret_key VARCHAR(64) NOT NULL DEFAULT 'sub',
	admin_secret_key VARCHAR(64) NOT NULL DEFAULT 'admin',
	vmess_mask VARCHAR(32) NOT NULL DEFAULT '00000000000000000000000000000000',
	vless_mask VARCHAR(32) NOT NULL DEFAULT '11111111111111111111111111111111'
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO jwt (id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
VALUES (1, 'legacy', 'sub', 'admin', '00000000000000000000000000000000', '11111111111111111111111111111111')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	credential_key VARCHAR(64),
	status VARCHAR(32),
	used_traffic BIGINT,
	data_limit BIGINT,
	admin_id INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, credential_key, status, used_traffic, data_limit, admin_id)
VALUES (1, 'legacy_user', '00000000000000000000000000000000', 'deleted', 0, 100, NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type VARCHAR(32) NOT NULL, settings TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vmess_mask")
	assertNoColumn(t, ctx, db, "sqlite", "jwt", "vless_mask")

	rows, err := db.QueryContext(ctx, `SELECT type, settings FROM proxies WHERE user_id = 1 ORDER BY type`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	ids := map[string]string{}
	for rows.Next() {
		var protocol string
		var raw any
		if err := rows.Scan(&protocol, &raw); err != nil {
			t.Fatal(err)
		}
		ids[protocol] = stringValue(decodeJSONMap(raw)["id"])
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if ids["vmess"] != "00000000-0000-0000-0000-000000000000" {
		t.Fatalf("vmess id = %q", ids["vmess"])
	}
	if ids["vless"] != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("vless id = %q", ids["vless"])
	}
}

func TestLegacyMaskedCredentialMaterializesMissingProtocolWhenOtherProxyExists(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE jwt (
	id INTEGER PRIMARY KEY,
	secret_key VARCHAR(64),
	subscription_secret_key VARCHAR(64) NOT NULL DEFAULT 'sub',
	admin_secret_key VARCHAR(64) NOT NULL DEFAULT 'admin',
	vmess_mask VARCHAR(32) NOT NULL DEFAULT '00000000000000000000000000000000',
	vless_mask VARCHAR(32) NOT NULL DEFAULT '11111111111111111111111111111111'
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO jwt (id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
VALUES (1, 'legacy', 'sub', 'admin', '00000000000000000000000000000000', '11111111111111111111111111111111')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	credential_key VARCHAR(64),
	status VARCHAR(32),
	used_traffic BIGINT,
	data_limit BIGINT,
	admin_id INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, credential_key, status, used_traffic, data_limit, admin_id)
VALUES (1, 'legacy_user', '00000000000000000000000000000000', 'active', 0, 100, NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type VARCHAR(32) NOT NULL, settings TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO proxies (user_id, type, settings)
VALUES
	(1, 'vless', '{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'),
	(1, 'trojan', '{"password":"legacy-password"}')`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	rows, err := db.QueryContext(ctx, `SELECT type, settings FROM proxies WHERE user_id = 1 ORDER BY type`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	ids := map[string]string{}
	for rows.Next() {
		var protocol string
		var raw any
		if err := rows.Scan(&protocol, &raw); err != nil {
			t.Fatal(err)
		}
		ids[protocol] = stringValue(decodeJSONMap(raw)["id"])
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if ids["vmess"] != "00000000-0000-0000-0000-000000000000" {
		t.Fatalf("vmess id = %q", ids["vmess"])
	}
	if ids["vless"] != "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" {
		t.Fatalf("existing vless id was overwritten: %q", ids["vless"])
	}
	if _, ok := ids["trojan"]; !ok {
		t.Fatal("expected existing trojan proxy to be preserved")
	}
}

func TestServiceMigrationPreservesLinksHostsAndUsage(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO admins (id, username, hashed_password) VALUES (1, 'owner', 'x'), (2, 'seller', 'x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	status VARCHAR(32),
	used_traffic BIGINT,
	data_limit BIGINT,
	admin_id INTEGER,
	service_id INTEGER
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, status, used_traffic, data_limit, admin_id, service_id) VALUES (10, 'svc-user', 'active', 12, 100, 2, 7)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE services (
	id INTEGER PRIMARY KEY,
	name VARCHAR(128) NOT NULL,
	description VARCHAR(256),
	used_traffic BIGINT DEFAULT 0
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO services (id, name, description, used_traffic) VALUES (7, 'legacy-svc', 'old', 500)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins_services (
	admin_id INTEGER NOT NULL,
	service_id INTEGER NOT NULL,
	used_traffic BIGINT DEFAULT 0,
	PRIMARY KEY (admin_id, service_id)
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO admins_services (admin_id, service_id, used_traffic) VALUES (2, 7, 250)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE hosts (
	id INTEGER PRIMARY KEY,
	remark VARCHAR(256) NOT NULL,
	address VARCHAR(256) NOT NULL,
	inbound_tag VARCHAR(256) NOT NULL
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO hosts (id, remark, address, inbound_tag) VALUES (5, 'h1', 'example.com', 'in'), (6, 'h2', 'example.org', 'in')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE service_hosts (
	service_id INTEGER NOT NULL,
	host_id INTEGER NOT NULL,
	sort INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (service_id, host_id)
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO service_hosts (service_id, host_id, sort) VALUES (7, 5, 20), (7, 6, 10)`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	assertTableColumns(t, ctx, db, "sqlite", "services", []string{"flow", "users_usage", "lifetime_used_traffic"})
	assertTableColumns(t, ctx, db, "sqlite", "admins_services", []string{"lifetime_used_traffic", "created_traffic", "deleted_users_usage", "data_limit", "traffic_limit_mode", "show_user_traffic", "users_limit", "delete_user_usage_limit_enabled", "delete_user_usage_limit"})
	assertDBInt64Migration(t, db, `SELECT service_id FROM users WHERE id = 10`, 7)
	assertDBInt64Migration(t, db, `SELECT lifetime_used_traffic FROM services WHERE id = 7`, 500)
	assertDBInt64Migration(t, db, `SELECT lifetime_used_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 7`, 250)
	assertDBInt64Migration(t, db, `SELECT sort FROM service_hosts WHERE service_id = 7 AND host_id = 5`, 20)
	assertDBInt64Migration(t, db, `SELECT sort FROM service_hosts WHERE service_id = 7 AND host_id = 6`, 10)
	assertDBStringMigration(t, db, `SELECT traffic_limit_mode FROM admins_services WHERE admin_id = 2 AND service_id = 7`, "used_traffic")
	assertDBInt64Migration(t, db, `SELECT show_user_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 7`, 1)
}

func TestXrayConfigMigrationLoadsLegacyFileAndDefault(t *testing.T) {
	ctx := context.Background()
	legacyPath := filepath.Join(t.TempDir(), "xray_config.json")
	legacyConfig := `{
		// commentjson-style comment from legacy deployments
		"log": {"loglevel": "debug",},
		"inbounds": [],
		"outbounds": [{"protocol": "freedom", "tag": "LEGACY_DIRECT",},],
	}`
	if err := os.WriteFile(legacyPath, []byte(legacyConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XRAY_JSON", legacyPath)
	db := openSQLiteTestDB(t)
	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations with legacy file: %v", err)
	}
	var data string
	if err := db.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1`).Scan(&data); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(data, "LEGACY_DIRECT") {
		t.Fatalf("legacy xray config was not loaded into DB: %s", data)
	}
	if _, err := os.Stat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("expected legacy xray config file to be removed, stat err=%v", err)
	}

	t.Setenv("XRAY_JSON", filepath.Join(t.TempDir(), "missing.json"))
	defaultDB := openSQLiteTestDB(t)
	if err := RunMigrations(ctx, defaultDB, "sqlite"); err != nil {
		t.Fatalf("run migrations with missing file: %v", err)
	}
	if err := defaultDB.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1`).Scan(&data); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(data, "Shadowsocks TCP") || !strings.Contains(data, "DIRECT") {
		t.Fatalf("default xray config is not valid expected payload: %s", data)
	}
}

func TestNodeXrayUsageMigrationPreservesLegacyRows(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO admins (id, username, hashed_password) VALUES (1, 'owner', 'x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	status VARCHAR(32),
	used_traffic BIGINT,
	data_limit BIGINT,
	admin_id INTEGER
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, status, used_traffic, data_limit, admin_id) VALUES (10, 'legacy_user', 'active', 0, 100, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name VARCHAR(256),
	address VARCHAR(256),
	port INTEGER NOT NULL,
	api_port INTEGER NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'connected',
	geo_mode VARCHAR(32),
	usage_coefficient REAL,
	uplink BIGINT,
	downlink BIGINT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO nodes (id, name, address, port, api_port, status, geo_mode, usage_coefficient, uplink, downlink)
VALUES (2, 'node-a', '10.0.0.2', 443, 62051, 'limited', 'invalid', NULL, 11, 22)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE node_usages (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	node_id INTEGER,
	uplink BIGINT,
	downlink BIGINT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_usages (id, created_at, node_id, uplink, downlink) VALUES (1, '2026-06-01 00:00:00', 2, 1000, 2000)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE node_user_usages (
	id INTEGER PRIMARY KEY,
	user_username VARCHAR(34),
	node_id INTEGER,
	used_traffic BIGINT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_user_usages (id, user_username, node_id, used_traffic) VALUES (1, 'legacy_user', 2, 333)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE outbound_traffic (
	id INTEGER PRIMARY KEY,
	outbound_id VARCHAR(256) NOT NULL,
	tag VARCHAR(256),
	protocol VARCHAR(64),
	address VARCHAR(256),
	port INTEGER,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE UNIQUE INDEX ix_outbound_traffic_outbound_id ON outbound_traffic (outbound_id)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO outbound_traffic (id, outbound_id, tag, protocol, address, port, uplink, downlink) VALUES (1, 'tag_DIRECT', 'DIRECT', 'freedom', NULL, NULL, 44, 55)`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	assertTableColumns(t, ctx, db, "sqlite", "nodes", []string{"note", "certificate", "certificate_key", "xray_config_mode", "xray_config", "data_limit", "proxy_enabled"})
	assertDBStringMigration(t, db, `SELECT geo_mode FROM nodes WHERE id = 2`, "default")
	assertDBStringMigration(t, db, `SELECT xray_config_mode FROM nodes WHERE id = 2`, "default")
	assertDBInt64Migration(t, db, `SELECT uplink FROM node_usages WHERE id = 1`, 1000)
	assertDBInt64Migration(t, db, `SELECT downlink FROM node_usages WHERE id = 1`, 2000)
	assertLegacyNodeUserUsageBackfill(t, db, 1, 10)
	assertDBInt64Migration(t, db, `SELECT used_traffic FROM node_user_usages WHERE id = 1`, 333)
	assertDBStringMigration(t, db, `SELECT target_id FROM outbound_traffic WHERE id = 1`, "master")
	assertDBInt64Migration(t, db, `SELECT uplink FROM outbound_traffic WHERE id = 1`, 44)
	assertDBInt64Migration(t, db, `SELECT downlink FROM outbound_traffic WHERE id = 1`, 55)
	assertTableColumns(t, ctx, db, "sqlite", "node_operations", []string{"operation_type", "payload", "status", "idempotency_key"})
	assertTableColumns(t, ctx, db, "sqlite", "pending_node_certificates", []string{"token", "certificate", "certificate_key", "expires_at"})
}

func TestSettingsWarpTelegramMigrationPreservesLegacyRows(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	subscription_domain VARCHAR(255),
	subscription_settings TEXT,
	discord_webhook VARCHAR(1024)
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO admins (id, username, hashed_password, subscription_domain, subscription_settings, discord_webhook)
VALUES (1, 'owner', 'x', 'sub.example.com', '{"subscription_path":"seller"}', 'https://discord.example/hook')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE panel_settings (
	id INTEGER PRIMARY KEY,
	use_nobetci INTEGER NOT NULL DEFAULT 0,
	default_subscription_type VARCHAR(32) NOT NULL DEFAULT 'token'
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO panel_settings (id, use_nobetci, default_subscription_type) VALUES (1, 1, 'token')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE subscription_settings (
	id INTEGER PRIMARY KEY,
	subscription_url_prefix VARCHAR(512) NOT NULL DEFAULT '',
	custom_templates_directory VARCHAR(512),
	clash_subscription_template VARCHAR(255) NOT NULL DEFAULT 'legacy/clash.yml'
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO subscription_settings (id, subscription_url_prefix, custom_templates_directory, clash_subscription_template)
VALUES (1, 'https://subs.example', '/custom/templates', 'legacy/clash.yml')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE subscription_domains (
	id INTEGER PRIMARY KEY,
	domain VARCHAR(255) NOT NULL,
	admin_id INTEGER,
	email VARCHAR(255),
	provider VARCHAR(64),
	alt_names TEXT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO subscription_domains (id, domain, admin_id, email, provider, alt_names)
VALUES (1, 'sub.example.com', 1, 'admin@example.com', 'letsencrypt', '["www.sub.example.com"]')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE telegram_settings (
	id INTEGER PRIMARY KEY,
	api_token VARCHAR(512),
	admin_chat_ids TEXT,
	event_toggles TEXT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO telegram_settings (id, api_token, admin_chat_ids, event_toggles)
VALUES (1, 'token', '[123]', '{"users":true}')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE warp_accounts (
	id INTEGER PRIMARY KEY,
	device_id VARCHAR(64) NOT NULL,
	access_token VARCHAR(255) NOT NULL,
	private_key VARCHAR(128) NOT NULL
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO warp_accounts (id, device_id, access_token, private_key)
VALUES (1, 'device-legacy', 'access-legacy', 'private-legacy')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE notification_reminders (id INTEGER PRIMARY KEY, type VARCHAR(32))`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	assertNoColumn(t, ctx, db, "sqlite", "admins", "discord_webhook")
	assertNoTable(t, ctx, db, "sqlite", "notification_reminders")
	assertDBStringMigration(t, db, `SELECT subscription_domain FROM admins WHERE id = 1`, "sub.example.com")
	assertDBStringMigration(t, db, `SELECT subscription_settings FROM admins WHERE id = 1`, `{"subscription_path":"seller"}`)
	assertDBStringMigration(t, db, `SELECT default_subscription_type FROM panel_settings WHERE id = 1`, "token")
	assertNoColumn(t, ctx, db, "sqlite", "panel_settings", "use_nobetci")
	assertDBInt64Migration(t, db, `SELECT backup_enabled FROM panel_settings WHERE id = 1`, 0)
	assertDBStringMigration(t, db, `SELECT subscription_url_prefix FROM subscription_settings WHERE id = 1`, "https://subs.example")
	assertDBStringMigration(t, db, `SELECT clash_subscription_template FROM subscription_settings WHERE id = 1`, "legacy/clash.yml")
	assertDBStringMigration(t, db, `SELECT subscription_profile_title FROM subscription_settings WHERE id = 1`, "Subscription")
	assertDBStringMigration(t, db, `SELECT subscription_path FROM subscription_settings WHERE id = 1`, "sub")
	assertDBStringMigration(t, db, `SELECT subscription_aliases FROM subscription_settings WHERE id = 1`, "[]")
	assertDBStringMigration(t, db, `SELECT subscription_ports FROM subscription_settings WHERE id = 1`, "[]")
	assertDBStringMigration(t, db, `SELECT alt_names FROM subscription_domains WHERE id = 1`, `["www.sub.example.com"]`)
	assertDBStringMigration(t, db, `SELECT api_token FROM telegram_settings WHERE id = 1`, "token")
	assertDBInt64Migration(t, db, `SELECT use_telegram FROM telegram_settings WHERE id = 1`, 1)
	assertDBStringMigration(t, db, `SELECT backup_scope FROM telegram_settings WHERE id = 1`, "database")
	assertDBInt64Migration(t, db, `SELECT backup_chat_is_forum FROM telegram_settings WHERE id = 1`, 0)
	assertDBStringMigration(t, db, `SELECT device_id FROM warp_accounts WHERE id = 1`, "device-legacy")
	assertDBStringMigration(t, db, `SELECT access_token FROM warp_accounts WHERE id = 1`, "access-legacy")
	assertTableColumns(t, ctx, db, "sqlite", "warp_accounts", []string{"license_key", "public_key", "created_at", "updated_at"})
}

func TestRemovedFeaturesCleanupMigrationDropsLegacyObjects(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO admins (id, username, hashed_password) VALUES (1, 'owner', 'x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE panel_settings (
	id INTEGER PRIMARY KEY,
	use_nobetci INTEGER NOT NULL DEFAULT 0,
	access_insights_enabled INTEGER NOT NULL DEFAULT 1
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO panel_settings (id, use_nobetci, access_insights_enabled) VALUES (1, 0, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE user_templates (
	id INTEGER PRIMARY KEY,
	name VARCHAR(64) NOT NULL,
	data_limit BIGINT,
	expire_duration BIGINT
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO user_templates (id, name, data_limit, expire_duration) VALUES (1, 'legacy', 100, 86400)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE template_inbounds_association (
	user_template_id INTEGER,
	inbound_tag VARCHAR(256)
)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO template_inbounds_association (user_template_id, inbound_tag) VALUES (1, 'in')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE access_insights (id INTEGER PRIMARY KEY, payload TEXT)`); err != nil {
		t.Fatal(err)
	}

	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	assertNoTable(t, ctx, db, "sqlite", "template_inbounds_association")
	assertNoTable(t, ctx, db, "sqlite", "user_templates")
	assertNoTable(t, ctx, db, "sqlite", "access_insights")
	assertNoColumn(t, ctx, db, "sqlite", "panel_settings", "access_insights_enabled")
	assertNoColumn(t, ctx, db, "sqlite", "panel_settings", "use_nobetci")
	assertTableColumns(t, ctx, db, "sqlite", "panel_settings", []string{"default_subscription_type", "backup_enabled"})
}

func TestSQLiteRebuildTable(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `CREATE TABLE demo (id INTEGER PRIMARY KEY, old_name TEXT, keep TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO demo (id, old_name, keep) VALUES (1, 'old', 'same')`); err != nil {
		t.Fatal(err)
	}
	err := RebuildSQLiteTable(ctx, db, SQLiteRebuildSpec{
		Table:         "demo",
		CreateSQL:     `CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT, keep TEXT)`,
		Columns:       []string{"id", "name", "keep"},
		SelectColumns: []string{"id", "old_name", "keep"},
	})
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	var name, keep string
	if err := db.QueryRowContext(ctx, `SELECT name, keep FROM demo WHERE id = 1`).Scan(&name, &keep); err != nil {
		t.Fatal(err)
	}
	if name != "old" || keep != "same" {
		t.Fatalf("unexpected rebuilt row: name=%q keep=%q", name, keep)
	}
}

func TestUnknownDialect(t *testing.T) {
	db := openSQLiteTestDB(t)
	err := RunMigrations(context.Background(), db, "postgres")
	if err == nil {
		t.Fatal("expected unsupported dialect")
	}
}

func assertNoColumn(t *testing.T, ctx context.Context, db *sql.DB, dialect string, table string, column string) {
	t.Helper()
	hasColumn, err := HasColumn(ctx, db, dialect, table, column)
	if err != nil {
		t.Fatalf("has column %s.%s: %v", table, column, err)
	}
	if hasColumn {
		t.Fatalf("unexpected column %s.%s", table, column)
	}
}

func assertNoTable(t *testing.T, ctx context.Context, db *sql.DB, dialect string, table string) {
	t.Helper()
	hasTable, err := HasTable(ctx, db, dialect, table)
	if err != nil {
		t.Fatalf("has table %s: %v", table, err)
	}
	if hasTable {
		t.Fatalf("unexpected table %s", table)
	}
}

func assertAdminRow(t *testing.T, db *sql.DB, id int64, role string, status string, disabledReason string, createdTraffic int64) {
	t.Helper()
	var gotRole, gotStatus string
	var gotReason sql.NullString
	var gotTraffic int64
	if err := db.QueryRow(`SELECT role, status, disabled_reason, created_traffic FROM admins WHERE id = ?`, id).Scan(&gotRole, &gotStatus, &gotReason, &gotTraffic); err != nil {
		t.Fatal(err)
	}
	if gotRole != role || gotStatus != status || gotTraffic != createdTraffic || gotReason.String != disabledReason {
		t.Fatalf("admin %d mismatch: role=%q status=%q reason=%q traffic=%d", id, gotRole, gotStatus, gotReason.String, gotTraffic)
	}
}

func assertUserRow(t *testing.T, db *sql.DB, id int64, username string, status string, credentialKey string, flow string) {
	t.Helper()
	var gotUsername, gotStatus, gotKey string
	var gotFlow sql.NullString
	if err := db.QueryRow(`SELECT username, status, credential_key, flow FROM users WHERE id = ?`, id).Scan(&gotUsername, &gotStatus, &gotKey, &gotFlow); err != nil {
		t.Fatal(err)
	}
	if gotUsername != username || gotStatus != status || gotKey != credentialKey || gotFlow.String != flow {
		t.Fatalf("user %d mismatch: username=%q status=%q key=%q flow=%q", id, gotUsername, gotStatus, gotKey, gotFlow.String)
	}
}

func assertUserStatus(t *testing.T, db *sql.DB, id int64, status string) {
	t.Helper()
	var got string
	if err := db.QueryRow(`SELECT status FROM users WHERE id = ?`, id).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != status {
		t.Fatalf("user %d status=%q, want %q", id, got, status)
	}
}

func assertUserName(t *testing.T, db *sql.DB, id int64, username string) {
	t.Helper()
	var got string
	if err := db.QueryRow(`SELECT username FROM users WHERE id = ?`, id).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != username {
		t.Fatalf("user %d username=%q, want %q", id, got, username)
	}
}

func assertCredentialKeyNull(t *testing.T, db *sql.DB, id int64) {
	t.Helper()
	var key sql.NullString
	if err := db.QueryRow(`SELECT credential_key FROM users WHERE id = ?`, id).Scan(&key); err != nil {
		t.Fatal(err)
	}
	if key.Valid {
		t.Fatalf("user %d credential key=%q, want NULL", id, key.String)
	}
}

func assertDBInt64Migration(t *testing.T, db *sql.DB, query string, expected int64) {
	t.Helper()
	var got int64
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != expected {
		t.Fatalf("query %q = %d, want %d", query, got, expected)
	}
}

func assertDBStringMigration(t *testing.T, db *sql.DB, query string, expected string) {
	t.Helper()
	var got string
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != expected {
		t.Fatalf("query %q = %q, want %q", query, got, expected)
	}
}

func assertLegacyNodeUserUsageBackfill(t *testing.T, db *sql.DB, usageID int64, expectedUserID int64) {
	t.Helper()
	var userID sql.NullInt64
	if err := db.QueryRow(`SELECT user_id FROM node_user_usages WHERE id = ?`, usageID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if userID.Valid && userID.Int64 == expectedUserID {
		if hasColumn, err := HasColumn(context.Background(), db, "sqlite", "node_user_usages", "user_username"); err != nil {
			t.Fatal(err)
		} else if hasColumn {
			t.Fatal("legacy node_user_usages.user_username column was not removed")
		}
		return
	}
	rows, err := db.Query(`SELECT id, username FROM users ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var users []string
	for rows.Next() {
		var id int64
		var value sql.NullString
		if err := rows.Scan(&id, &value); err != nil {
			t.Fatal(err)
		}
		users = append(users, value.String)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	t.Fatalf("node_user_usages %d user_id=%v, want %d; users=%v", usageID, userID, expectedUserID, users)
}

func assertTableColumns(t *testing.T, ctx context.Context, db *sql.DB, dialect string, table string, columns []string) {
	t.Helper()
	hasTable, err := HasTable(ctx, db, dialect, table)
	if err != nil {
		t.Fatalf("has table %s: %v", table, err)
	}
	if !hasTable {
		t.Fatalf("missing table %s", table)
	}
	for _, column := range columns {
		hasColumn, err := HasColumn(ctx, db, dialect, table, column)
		if err != nil {
			t.Fatalf("has column %s.%s: %v", table, column, err)
		}
		if !hasColumn {
			t.Fatalf("missing column %s.%s", table, column)
		}
	}
}

func assertIndex(t *testing.T, ctx context.Context, db *sql.DB, dialect string, table string, index string) {
	t.Helper()
	has, err := HasIndex(ctx, db, dialect, table, index)
	if err != nil {
		t.Fatalf("has index %s.%s: %v", table, index, err)
	}
	if !has {
		t.Fatalf("expected index %s on %s", index, table)
	}
}

func assertNoIndex(t *testing.T, ctx context.Context, db *sql.DB, dialect string, table string, index string) {
	t.Helper()
	has, err := HasIndex(ctx, db, dialect, table, index)
	if err != nil {
		t.Fatalf("has index %s.%s: %v", table, index, err)
	}
	if has {
		t.Fatalf("did not expect index %s on %s", index, table)
	}
}
