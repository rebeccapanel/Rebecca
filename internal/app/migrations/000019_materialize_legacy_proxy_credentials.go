package migrations

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000019_materialize_legacy_proxy_credentials.go", up000019MaterializeLegacyProxyCredentials, emptyDown)
}

func up000019MaterializeLegacyProxyCredentials(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := materializeLegacyProxyCredentials(ctx, tx, dialect); err != nil {
		return err
	}
	for _, column := range []string{"vmess_mask", "vless_mask"} {
		if _, err := DropColumnIfExists(ctx, tx, dialect, "jwt", column); err != nil {
			return err
		}
	}
	return nil
}

func materializeLegacyProxyCredentials(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	hasProxies, err := HasTable(ctx, tx, dialect, "proxies")
	if err != nil || !hasProxies {
		return err
	}
	hasCredentialKey, err := HasColumn(ctx, tx, dialect, "users", "credential_key")
	if err != nil || !hasCredentialKey {
		return err
	}

	masks, err := migrationUUIDMasks(ctx, tx, dialect)
	if err != nil {
		return err
	}

	rows, err := tx.QueryContext(ctx, `SELECT id, credential_key FROM users`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type userKey struct {
		id  int64
		key string
	}
	users := []userKey{}
	for rows.Next() {
		var row userKey
		var key sql.NullString
		if err := rows.Scan(&row.id, &key); err != nil {
			return err
		}
		normalized, ok := normalizeMigrationCredentialKey(key.String)
		if !key.Valid || !ok {
			continue
		}
		row.key = normalized
		users = append(users, row)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, row := range users {
		for _, protocol := range []string{"vmess", "vless"} {
			var count int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM proxies WHERE user_id = ? AND LOWER(type) = ?`, row.id, protocol).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			id, err := migrationKeyToUUID(row.key, masks[protocol])
			if err != nil {
				return err
			}
			settings, err := json.Marshal(map[string]any{"id": id})
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO proxies (user_id, type, settings) VALUES (?, ?, ?)`, row.id, protocol, string(settings)); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrationKeyToUUID(key string, mask []byte) (string, error) {
	cleaned := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(key, "-", "")))
	bytes, err := hex.DecodeString(cleaned)
	if err != nil {
		return "", err
	}
	if len(mask) == len(bytes) {
		for i := range bytes {
			bytes[i] = bytes[i] ^ mask[i]
		}
	}
	parsed, err := uuid.FromBytes(bytes)
	if err != nil {
		return "", err
	}
	return parsed.String(), nil
}
