package migrations

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000007_user_credentials_subscription_keys.go", up000007UserCredentialsSubscriptionKeys, emptyDown)
}

func up000007UserCredentialsSubscriptionKeys(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"credential_key", "VARCHAR(64) NULL", ""},
		{"subadress", "VARCHAR(255) NOT NULL DEFAULT ''", ""},
		{"flow", "VARCHAR(128) NULL", ""},
		{"sub_revoked_at", "DATETIME NULL", ""},
		{"sub_updated_at", "DATETIME NULL", ""},
		{"sub_last_user_agent", "VARCHAR(512) NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "users", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if NormalizeDialect(dialect) == "mysql" {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE users MODIFY COLUMN sub_last_user_agent VARCHAR(512) NULL`); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET subadress = '' WHERE subadress IS NULL`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "users", "ix_users_subadress", []string{"subadress"}, false); err != nil {
		return err
	}
	if err := backfillUserFlowFromProxies(ctx, tx, dialect); err != nil {
		return err
	}
	return backfillUserCredentialKeys(ctx, tx, dialect)
}

func backfillUserFlowFromProxies(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasProxies, err := HasTable(ctx, tx, dialect, "proxies")
	if err != nil || !hasProxies {
		return err
	}
	for _, column := range []string{"id", "user_id", "settings"} {
		has, err := HasColumn(ctx, tx, dialect, "proxies", column)
		if err != nil || !has {
			return err
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, user_id, settings FROM proxies`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type proxyFlowUpdate struct {
		id       int64
		userID   int64
		flow     string
		settings string
	}
	var updates []proxyFlowUpdate
	for rows.Next() {
		var id, userID int64
		var raw any
		if err := rows.Scan(&id, &userID, &raw); err != nil {
			return err
		}
		settings := decodeJSONMap(raw)
		flow := strings.TrimSpace(stringValue(settings["flow"]))
		if _, ok := settings["flow"]; ok {
			delete(settings, "flow")
			encoded, err := json.Marshal(settings)
			if err != nil {
				return err
			}
			updates = append(updates, proxyFlowUpdate{id: id, userID: userID, flow: flow, settings: string(encoded)})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range updates {
		if item.flow != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE users SET flow = ? WHERE id = ? AND (flow IS NULL OR flow = '')`, item.flow, item.userID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE proxies SET settings = ? WHERE id = ?`, item.settings, item.id); err != nil {
			return err
		}
	}
	return nil
}

func backfillUserCredentialKeys(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasID, err := HasColumn(ctx, tx, dialect, "users", "id")
	if err != nil || !hasID {
		return err
	}
	masks, err := migrationUUIDMasks(ctx, tx, dialect)
	if err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, credential_key FROM users ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type userKeyRow struct {
		id  int64
		key string
	}
	var users []userKeyRow
	used := map[string]struct{}{}
	for rows.Next() {
		var row userKeyRow
		var key sql.NullString
		if err := rows.Scan(&row.id, &key); err != nil {
			return err
		}
		if key.Valid {
			if normalized, ok := normalizeMigrationCredentialKey(key.String); ok {
				row.key = normalized
				if _, exists := used[normalized]; !exists {
					used[normalized] = struct{}{}
				} else {
					row.key = ""
				}
			}
		}
		users = append(users, row)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, row := range users {
		key := row.key
		if key == "" {
			derived, err := deriveCredentialKeyFromProxies(ctx, tx, dialect, row.id, masks)
			if err != nil {
				return err
			}
			if _, exists := used[derived]; derived != "" && !exists {
				key = derived
			}
		}
		if key == "" {
			continue
		}
		used[key] = struct{}{}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET credential_key = ? WHERE id = ?`, key, row.id); err != nil {
			return err
		}
	}
	return nil
}

func migrationUUIDMasks(ctx context.Context, tx *sql.Tx, dialect string) (map[string][]byte, error) {
	masks := map[string][]byte{}
	hasJWT, err := HasTable(ctx, tx, dialect, "jwt")
	if err != nil || !hasJWT {
		return masks, err
	}
	var vmess, vless sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT vmess_mask, vless_mask FROM jwt ORDER BY id LIMIT 1`).Scan(&vmess, &vless)
	if err == sql.ErrNoRows {
		return masks, nil
	}
	if err != nil {
		return nil, err
	}
	for protocol, value := range map[string]sql.NullString{"vmess": vmess, "vless": vless} {
		if !value.Valid {
			continue
		}
		decoded, err := hex.DecodeString(strings.TrimSpace(value.String))
		if err == nil && len(decoded) == 16 {
			masks[protocol] = decoded
		}
	}
	return masks, nil
}

func deriveCredentialKeyFromProxies(ctx context.Context, tx *sql.Tx, dialect string, userID int64, masks map[string][]byte) (string, error) {
	hasProxies, err := HasTable(ctx, tx, dialect, "proxies")
	if err != nil || !hasProxies {
		return "", err
	}
	rows, err := tx.QueryContext(ctx, `SELECT type, settings FROM proxies WHERE user_id = ?`, userID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	candidate := ""
	for rows.Next() {
		var protocolRaw string
		var raw any
		if err := rows.Scan(&protocolRaw, &raw); err != nil {
			return "", err
		}
		protocol := strings.ToLower(strings.TrimSpace(protocolRaw))
		if protocol != "vmess" && protocol != "vless" {
			continue
		}
		settings := decodeJSONMap(raw)
		uuidText := strings.TrimSpace(firstString(settings["id"], settings["uuid"]))
		if uuidText == "" {
			continue
		}
		derived, err := migrationUUIDToKey(uuidText, masks[protocol])
		if err != nil {
			continue
		}
		if candidate != "" && candidate != derived {
			return "", nil
		}
		candidate = derived
	}
	return candidate, rows.Err()
}

func migrationUUIDToKey(value string, mask []byte) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	data := parsed
	bytes := data[:]
	if len(mask) == len(bytes) {
		for i := range bytes {
			bytes[i] = bytes[i] ^ mask[i]
		}
	}
	return hex.EncodeToString(bytes), nil
}

func normalizeMigrationCredentialKey(value string) (string, bool) {
	cleaned := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
	if len(cleaned) != 32 {
		return "", false
	}
	for _, ch := range cleaned {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return "", false
		}
	}
	return cleaned, true
}

func decodeJSONMap(raw any) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	var data []byte
	switch typed := raw.(type) {
	case []byte:
		data = typed
	case string:
		data = []byte(typed)
	default:
		data = []byte(fmt.Sprint(typed))
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func firstString(values ...any) string {
	for _, value := range values {
		if text := stringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}
