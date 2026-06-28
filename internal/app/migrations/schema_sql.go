package migrations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"strings"
)

func createTable(ctx context.Context, tx *sql.Tx, dialect string, name string, sqliteSQL string, mysqlSQL string) error {
	_, err := CreateTableIfMissing(ctx, tx, dialect, name, sqlForDialect(dialect, sqliteSQL, mysqlSQL))
	return err
}

func createIndex(ctx context.Context, tx *sql.Tx, dialect string, table string, name string, columns []string, unique bool) error {
	_, err := CreateIndexIfMissing(ctx, tx, dialect, table, name, columns, unique)
	return err
}

func addColumn(ctx context.Context, tx *sql.Tx, dialect string, table string, column string, sqliteDefinition string, mysqlDefinition string) error {
	_, err := AddColumnIfMissing(ctx, tx, dialect, table, column, definitionForDialect(dialect, sqliteDefinition, mysqlDefinition))
	return err
}

func sqlForDialect(dialect string, sqliteSQL string, mysqlSQL string) string {
	if NormalizeDialect(dialect) == "mysql" && mysqlSQL != "" {
		return mysqlSQL
	}
	return sqliteSQL
}

func definitionForDialect(dialect string, sqliteDefinition string, mysqlDefinition string) string {
	if NormalizeDialect(dialect) == "mysql" && mysqlDefinition != "" {
		return mysqlDefinition
	}
	return sqliteDefinition
}

func nowDefault(dialect string) string {
	if NormalizeDialect(dialect) == "mysql" {
		return "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
	}
	return "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
}

func nullableNowDefault(dialect string) string {
	if NormalizeDialect(dialect) == "mysql" {
		return "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
	}
	return "DATETIME DEFAULT CURRENT_TIMESTAMP"
}

func jsonType(dialect string) string {
	if NormalizeDialect(dialect) == "mysql" {
		return "JSON"
	}
	return "TEXT"
}

func boolType(dialect string) string {
	if NormalizeDialect(dialect) == "mysql" {
		return "BOOLEAN"
	}
	return "INTEGER"
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func seedJWT(ctx context.Context, tx *sql.Tx) error {
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM jwt WHERE id = 1`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	secret, err := randomHex(32)
	if err != nil {
		return err
	}
	subSecret, err := randomHex(32)
	if err != nil {
		return err
	}
	adminSecret, err := randomHex(32)
	if err != nil {
		return err
	}
	vmessMask, err := randomHex(16)
	if err != nil {
		return err
	}
	vlessMask, err := randomHex(16)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO jwt (id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask)
VALUES (?, ?, ?, ?, ?, ?)`, 1, secret, subSecret, adminSecret, vmessMask, vlessMask)
	return err
}

func backfillJWTSecrets(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT id, secret_key, subscription_secret_key, admin_secret_key, vmess_mask, vless_mask FROM jwt`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type jwtRow struct {
		id                 int64
		secretKey          sql.NullString
		subscriptionSecret sql.NullString
		adminSecret        sql.NullString
		vmessMask          sql.NullString
		vlessMask          sql.NullString
	}
	var records []jwtRow
	for rows.Next() {
		var record jwtRow
		if err := rows.Scan(
			&record.id,
			&record.secretKey,
			&record.subscriptionSecret,
			&record.adminSecret,
			&record.vmessMask,
			&record.vlessMask,
		); err != nil {
			return err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, record := range records {
		baseSecret := strings.TrimSpace(record.secretKey.String)
		if !record.secretKey.Valid || baseSecret == "" {
			generated, err := randomHex(32)
			if err != nil {
				return err
			}
			baseSecret = generated
		}
		subscriptionSecret := strings.TrimSpace(record.subscriptionSecret.String)
		if !record.subscriptionSecret.Valid || subscriptionSecret == "" {
			subscriptionSecret = baseSecret
		}
		adminSecret := strings.TrimSpace(record.adminSecret.String)
		if !record.adminSecret.Valid || adminSecret == "" {
			generated, err := randomHex(32)
			if err != nil {
				return err
			}
			adminSecret = generated
		}
		vmessMask := strings.TrimSpace(record.vmessMask.String)
		if !record.vmessMask.Valid || vmessMask == "" {
			generated, err := randomHex(16)
			if err != nil {
				return err
			}
			vmessMask = generated
		}
		vlessMask := strings.TrimSpace(record.vlessMask.String)
		if !record.vlessMask.Valid || vlessMask == "" {
			generated, err := randomHex(16)
			if err != nil {
				return err
			}
			vlessMask = generated
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE jwt
SET secret_key = ?, subscription_secret_key = ?, admin_secret_key = ?, vmess_mask = ?, vless_mask = ?
WHERE id = ?`, baseSecret, subscriptionSecret, adminSecret, vmessMask, vlessMask, record.id); err != nil {
			return err
		}
	}
	return nil
}

func normalizeJWTSecretSchema(ctx context.Context, tx *sql.Tx, dialect string) error {
	switch NormalizeDialect(dialect) {
	case "sqlite":
		notNull := true
		return RewriteSQLiteTableColumns(ctx, tx, "jwt", map[string]SQLiteColumnRewrite{
			"subscription_secret_key": {Type: "VARCHAR(64)", NotNull: &notNull, DropDefault: true},
			"admin_secret_key":        {Type: "VARCHAR(64)", NotNull: &notNull, DropDefault: true},
			"vmess_mask":              {Type: "VARCHAR(32)", NotNull: &notNull, DropDefault: true},
			"vless_mask":              {Type: "VARCHAR(32)", NotNull: &notNull, DropDefault: true},
		})
	case "mysql":
		for _, query := range []string{
			`ALTER TABLE jwt MODIFY COLUMN subscription_secret_key VARCHAR(64) NOT NULL`,
			`ALTER TABLE jwt MODIFY COLUMN admin_secret_key VARCHAR(64) NOT NULL`,
			`ALTER TABLE jwt MODIFY COLUMN vmess_mask VARCHAR(32) NOT NULL`,
			`ALTER TABLE jwt MODIFY COLUMN vless_mask VARCHAR(32) NOT NULL`,
		} {
			if _, err := tx.ExecContext(ctx, query); err != nil {
				return err
			}
		}
	}
	return nil
}

func seedSystem(ctx context.Context, tx *sql.Tx, dialect string) error {
	var exists int
	table := "system"
	if NormalizeDialect(dialect) == "mysql" {
		table = "`system`"
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM `+table+` WHERE id = 1`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO `+table+` (id, uplink, downlink) VALUES (1, 0, 0)`)
	return err
}

func seedPanelSettings(ctx context.Context, tx *sql.Tx) error {
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM panel_settings WHERE id = 1`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO panel_settings (id, default_subscription_type) VALUES (1, 'key')`)
	return err
}

func emptyDown(_ context.Context, _ *sql.Tx) error {
	return UnsupportedDowngrade()
}
