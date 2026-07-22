package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000013_outbound_usage_accounting.go", up000013OutboundUsageAccounting, emptyDown)
}

func up000013OutboundUsageAccounting(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensureNodeUsageTables(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureOutboundTrafficTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureNodeOperationsTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensurePendingNodeCertificatesTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := backfillNodeUserUsageIDsInGo(ctx, tx); err != nil {
		return err
	}
	return backfillSingleUserLegacyNodeUsage(ctx, tx)
}

func ensureNodeUsageTables(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "node_usages", `
CREATE TABLE node_usages (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	node_id INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE(created_at, node_id)
)`, `
CREATE TABLE node_usages (
	id INTEGER NOT NULL AUTO_INCREMENT,
	created_at DATETIME NOT NULL,
	node_id INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE KEY uq_node_usages_created_node (created_at, node_id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"created_at", "DATETIME NULL", ""},
		{"node_id", "INTEGER NULL", ""},
		{"uplink", "BIGINT DEFAULT 0", ""},
		{"downlink", "BIGINT DEFAULT 0", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "node_usages", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if err := createTable(ctx, tx, dialect, "node_user_usages", `
CREATE TABLE node_user_usages (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	user_id INTEGER NULL,
	node_id INTEGER NULL,
	used_traffic BIGINT DEFAULT 0,
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE(created_at, user_id, node_id)
)`, `
CREATE TABLE node_user_usages (
	id INTEGER NOT NULL AUTO_INCREMENT,
	created_at DATETIME NOT NULL,
	user_id INTEGER NULL,
	node_id INTEGER NULL,
	used_traffic BIGINT DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE KEY uq_node_user_usages_created_user_node (created_at, user_id, node_id)
)`); err != nil {
		return err
	}
	if _, err := DropIndexIfExists(ctx, tx, dialect, "node_user_usages", "ix_node_user_usages_user_id"); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"created_at", "DATETIME NULL", ""},
		{"user_id", "INTEGER NULL", ""},
		{"node_id", "INTEGER NULL", ""},
		{"used_traffic", "BIGINT DEFAULT 0", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "node_user_usages", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if err := backfillNodeUserUsageIDs(ctx, tx); err != nil {
		return err
	}
	return nil
}

func backfillNodeUserUsageIDs(ctx context.Context, tx *sql.Tx) error {
	hasUsers, err := HasTable(ctx, tx, activeDialect(), "users")
	if err != nil || !hasUsers {
		return err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE node_user_usages AS n
SET user_id = (
	SELECT users.id
	FROM users
	WHERE LOWER(TRIM(users.username)) = LOWER(TRIM(n.user_username))
	ORDER BY users.id
	LIMIT 1
)
WHERE user_id IS NULL
  AND user_username IS NOT NULL
  AND TRIM(user_username) != ''`)
	if err != nil {
		if isMissingLegacyUserUsernameColumn(err) {
			return nil
		}
		return err
	}
	fallbackSQL := `
UPDATE node_user_usages AS n
SET user_id = (
	SELECT users.id
	FROM users
	WHERE LOWER(TRIM(users.username)) LIKE LOWER(TRIM(n.user_username)) || '\_%' ESCAPE '\'
	ORDER BY users.id
	LIMIT 1
)
WHERE user_id IS NULL
  AND user_username IS NOT NULL
  AND TRIM(user_username) != ''`
	if NormalizeDialect(activeDialect()) == "mysql" {
		fallbackSQL = `
UPDATE node_user_usages AS n
SET user_id = (
	SELECT users.id
	FROM users
	WHERE LOWER(TRIM(users.username)) LIKE CONCAT(LOWER(TRIM(n.user_username)), '\\_%') ESCAPE '\\'
	ORDER BY users.id
	LIMIT 1
)
WHERE user_id IS NULL
  AND user_username IS NOT NULL
  AND TRIM(user_username) != ''`
	}
	if _, err = tx.ExecContext(ctx, fallbackSQL); err != nil {
		if isMissingLegacyUserUsernameColumn(err) {
			return nil
		}
		return err
	}
	return backfillNodeUserUsageIDsInGo(ctx, tx)
}

func backfillNodeUserUsageIDsInGo(ctx context.Context, tx *sql.Tx) error {
	userRows, err := tx.QueryContext(ctx, `SELECT id, username FROM users WHERE username IS NOT NULL`)
	if err != nil {
		return err
	}
	users := map[string]int64{}
	for userRows.Next() {
		var id int64
		var username string
		if err := userRows.Scan(&id, &username); err != nil {
			userRows.Close()
			return err
		}
		key := strings.ToLower(strings.TrimSpace(username))
		if key != "" {
			if _, exists := users[key]; !exists {
				users[key] = id
			}
		}
	}
	if err := userRows.Err(); err != nil {
		userRows.Close()
		return err
	}
	userRows.Close()

	usageRows, err := tx.QueryContext(ctx, `SELECT id, user_username FROM node_user_usages WHERE user_id IS NULL AND user_username IS NOT NULL`)
	if err != nil {
		if isMissingLegacyUserUsernameColumn(err) {
			return nil
		}
		return err
	}
	type usageMatch struct {
		id       int64
		username string
	}
	var usages []usageMatch
	for usageRows.Next() {
		var item usageMatch
		if err := usageRows.Scan(&item.id, &item.username); err != nil {
			usageRows.Close()
			return err
		}
		usages = append(usages, item)
	}
	if err := usageRows.Err(); err != nil {
		usageRows.Close()
		return err
	}
	usageRows.Close()

	for _, usage := range usages {
		key := strings.ToLower(strings.TrimSpace(usage.username))
		userID, ok := users[key]
		if !ok {
			prefix := key + "_"
			for username, id := range users {
				if strings.HasPrefix(username, prefix) {
					userID = id
					ok = true
					break
				}
			}
		}
		if !ok {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE node_user_usages SET user_id = ? WHERE id = ?`, userID, usage.id); err != nil {
			return err
		}
	}
	if len(users) == 1 {
		var onlyUserID int64
		for _, id := range users {
			onlyUserID = id
		}
		if _, err := tx.ExecContext(ctx, `UPDATE node_user_usages SET user_id = ? WHERE user_id IS NULL`, onlyUserID); err != nil {
			return err
		}
	}
	return nil
}

func isMissingLegacyUserUsernameColumn(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "user_username") && (strings.Contains(text, "no such column") || strings.Contains(text, "unknown column"))
}

func backfillSingleUserLegacyNodeUsage(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `
UPDATE node_user_usages
SET user_id = (SELECT MIN(id) FROM users WHERE username IS NOT NULL)
WHERE user_id IS NULL
  AND user_username IS NOT NULL
  AND (SELECT COUNT(1) FROM users WHERE username IS NOT NULL) = 1`)
	if err != nil && isMissingLegacyUserUsernameColumn(err) {
		return nil
	}
	return err
}

func ensureOutboundTrafficTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "outbound_traffic", `
CREATE TABLE outbound_traffic (
	id INTEGER PRIMARY KEY,
	outbound_id VARCHAR(256) NOT NULL,
	tag VARCHAR(256) NULL,
	protocol VARCHAR(64) NULL,
	address VARCHAR(256) NULL,
	port INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	target_id VARCHAR(64) NOT NULL DEFAULT 'master',
	node_id INTEGER NULL,
	UNIQUE(target_id, outbound_id)
)`, `
CREATE TABLE outbound_traffic (
	id INTEGER NOT NULL AUTO_INCREMENT,
	outbound_id VARCHAR(256) NOT NULL,
	tag VARCHAR(256) NULL,
	protocol VARCHAR(64) NULL,
	address VARCHAR(256) NULL,
	port INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	target_id VARCHAR(64) NOT NULL DEFAULT 'master',
	node_id INTEGER NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_outbound_traffic_target_outbound (target_id, outbound_id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"outbound_id", "VARCHAR(256) NULL", ""},
		{"tag", "VARCHAR(256) NULL", ""},
		{"protocol", "VARCHAR(64) NULL", ""},
		{"address", "VARCHAR(256) NULL", ""},
		{"port", "INTEGER NULL", ""},
		{"uplink", "BIGINT DEFAULT 0", ""},
		{"downlink", "BIGINT DEFAULT 0", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
		{"target_id", "VARCHAR(64) NOT NULL DEFAULT 'master'", ""},
		{"node_id", "INTEGER NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "outbound_traffic", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE outbound_traffic SET target_id = 'master' WHERE target_id IS NULL OR TRIM(target_id) = ''`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0 WHERE uplink IS NULL`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE outbound_traffic SET downlink = 0 WHERE downlink IS NULL`); err != nil {
		return err
	}
	if _, err := DropIndexIfExists(ctx, tx, dialect, "outbound_traffic", "ix_outbound_traffic_outbound_id"); err != nil {
		return err
	}
	if _, err := DropIndexIfExists(ctx, tx, dialect, "outbound_traffic", "ix_outbound_traffic_tag"); err != nil {
		return err
	}
	for _, index := range []struct {
		name    string
		columns []string
		unique  bool
	}{
		{"ix_outbound_traffic_outbound_id", []string{"outbound_id"}, false},
		{"ix_outbound_traffic_target_id", []string{"target_id"}, false},
		{"ix_outbound_traffic_node_id", []string{"node_id"}, false},
	} {
		if err := createIndex(ctx, tx, dialect, "outbound_traffic", index.name, index.columns, index.unique); err != nil {
			return err
		}
	}
	return seedOutboundTrafficFromXrayConfig(ctx, tx, dialect)
}

func seedOutboundTrafficFromXrayConfig(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasXrayConfig, err := HasTable(ctx, tx, dialect, "xray_config")
	if err != nil || !hasXrayConfig {
		return err
	}
	hasOutboundTraffic, err := HasTable(ctx, tx, dialect, "outbound_traffic")
	if err != nil || !hasOutboundTraffic {
		return err
	}

	var raw string
	if err := tx.QueryRowContext(ctx, `SELECT data FROM xray_config LIMIT 1`).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	outbounds, _ := payload["outbounds"].([]any)
	if len(outbounds) == 0 {
		return nil
	}

	rows, err := tx.QueryContext(ctx, `SELECT outbound_id FROM outbound_traffic`)
	if err != nil {
		return err
	}
	existing := map[string]struct{}{}
	for rows.Next() {
		var outboundID sql.NullString
		if err := rows.Scan(&outboundID); err != nil {
			rows.Close()
			return err
		}
		if outboundID.Valid {
			existing[outboundID.String] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for _, item := range outbounds {
		outbound, ok := item.(map[string]any)
		if !ok {
			continue
		}
		outboundID := migrationOutboundID(outbound)
		if outboundID == "" {
			continue
		}
		if _, ok := existing[outboundID]; ok {
			continue
		}
		meta := migrationOutboundMetadata(outbound)
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO outbound_traffic (target_id, outbound_id, tag, protocol, address, port) VALUES ('master', ?, ?, ?, ?, ?)`,
			outboundID,
			meta.tag,
			meta.protocol,
			meta.address,
			meta.port,
		); err != nil {
			return err
		}
		existing[outboundID] = struct{}{}
	}
	return nil
}

func migrationOutboundID(outbound map[string]any) string {
	normalized := map[string]any{}
	for key, value := range outbound {
		if key == "tag" {
			continue
		}
		normalized[key] = value
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return jsonHex(sum[:])[:16]
}

type migrationOutboundMeta struct {
	tag      any
	protocol any
	address  any
	port     any
}

func migrationOutboundMetadata(outbound map[string]any) migrationOutboundMeta {
	meta := migrationOutboundMeta{tag: outbound["tag"], protocol: outbound["protocol"]}
	protocol, _ := outbound["protocol"].(string)
	settings, _ := outbound["settings"].(map[string]any)
	switch protocol {
	case "vmess", "vless":
		if first := firstMap(settings["vnext"]); first != nil {
			meta.address = first["address"]
			meta.port = first["port"]
		}
	case "trojan", "shadowsocks", "socks", "http":
		if first := firstMap(settings["servers"]); first != nil {
			meta.address = first["address"]
			meta.port = first["port"]
		}
	}
	return meta
}

func firstMap(value any) map[string]any {
	values, ok := value.([]any)
	if !ok || len(values) == 0 {
		return nil
	}
	first, _ := values[0].(map[string]any)
	return first
}

func jsonHex(data []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, len(data)*2)
	for i, b := range data {
		out[i*2] = alphabet[b>>4]
		out[i*2+1] = alphabet[b&0x0f]
	}
	return string(out)
}

func ensureNodeOperationsTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "node_operations", `
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY,
	operation_type VARCHAR(32) NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(idempotency_key)
)`, `
CREATE TABLE node_operations (
	id INTEGER NOT NULL AUTO_INCREMENT,
	operation_type VARCHAR(32) NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload JSON NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_node_operations_idempotency_key (idempotency_key)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"operation_type", "VARCHAR(32) NULL", ""},
		{"node_id", "INTEGER NULL", ""},
		{"user_id", "INTEGER NULL", ""},
		{"payload", "TEXT NULL", "JSON NULL"},
		{"status", "VARCHAR(16) NOT NULL DEFAULT 'pending'", ""},
		{"attempts", "INTEGER NOT NULL DEFAULT 0", ""},
		{"last_error", "TEXT NULL", ""},
		{"idempotency_key", "VARCHAR(128) NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "node_operations", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	for _, query := range []string{
		`UPDATE node_operations SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''`,
		`UPDATE node_operations SET attempts = 0 WHERE attempts IS NULL`,
		`UPDATE node_operations SET payload = '{}' WHERE payload IS NULL OR TRIM(payload) = ''`,
	} {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	for _, index := range []struct {
		name    string
		columns []string
	}{
		{"ix_node_operations_status_id", []string{"status", "id"}},
		{"ix_node_operations_node_status_id", []string{"node_id", "status", "id"}},
		{"ix_node_operations_user_id", []string{"user_id"}},
	} {
		if err := createIndex(ctx, tx, dialect, "node_operations", index.name, index.columns, false); err != nil {
			return err
		}
	}
	return nil
}

func ensurePendingNodeCertificatesTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "pending_node_certificates", `
CREATE TABLE pending_node_certificates (
	id INTEGER PRIMARY KEY,
	token VARCHAR(64) NOT NULL,
	certificate TEXT NOT NULL,
	certificate_key TEXT NOT NULL,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(token)
)`, `
CREATE TABLE pending_node_certificates (
	id INTEGER NOT NULL AUTO_INCREMENT,
	token VARCHAR(64) NOT NULL,
	certificate TEXT NOT NULL,
	certificate_key TEXT NOT NULL,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_pending_node_certificates_token (token)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"token", "VARCHAR(64) NULL", ""},
		{"certificate", "TEXT NULL", ""},
		{"certificate_key", "TEXT NULL", ""},
		{"expires_at", "DATETIME NULL", ""},
		{"created_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "pending_node_certificates", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return createIndex(ctx, tx, dialect, "pending_node_certificates", "ix_pending_node_certificates_expires_at", []string{"expires_at"}, false)
}
