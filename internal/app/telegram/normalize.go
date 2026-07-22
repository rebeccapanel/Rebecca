package telegram

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func rawStringDefault(raw json.RawMessage, fallback string) string {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	return fallback
}

func rawBoolDefault(raw json.RawMessage, fallback bool) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		switch strings.ToLower(strings.TrimSpace(asString)) {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	var asNumber int
	if err := json.Unmarshal(raw, &asNumber); err == nil {
		return asNumber != 0
	}
	return fallback
}

func rawInt64List(raw json.RawMessage) ([]int64, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var values []any
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	result := []int64{}
	seen := map[int64]bool{}
	for _, value := range values {
		parsed, err := anyInt64(value)
		if err != nil || parsed == 0 || seen[parsed] {
			continue
		}
		seen[parsed] = true
		result = append(result, parsed)
	}
	return result, nil
}

func rawNullableInt64(raw json.RawMessage) (*int64, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	parsed, err := anyInt64(value)
	if err != nil || parsed == 0 {
		return nil, err
	}
	return &parsed, nil
}

func rawPositiveInt(raw json.RawMessage, fallback int) (int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return fallback, err
	}
	parsed, err := anyInt64(value)
	if err != nil {
		return fallback, err
	}
	if parsed <= 0 {
		return fallback, fmt.Errorf("value must be positive")
	}
	return int(parsed), nil
}

func anyInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), nil
	case int:
		return int64(typed), nil
	case int64:
		return typed, nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, nil
		}
		return strconv.ParseInt(trimmed, 10, 64)
	default:
		return 0, fmt.Errorf("invalid integer")
	}
}

func parseStoredInt64List(raw string) ([]int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var values []any
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &values); err != nil {
			return nil, err
		}
	} else {
		for _, part := range strings.Split(raw, ",") {
			values = append(values, strings.TrimSpace(part))
		}
	}
	result := []int64{}
	seen := map[int64]bool{}
	for _, value := range values {
		parsed, err := anyInt64(value)
		if err != nil || parsed == 0 || seen[parsed] {
			continue
		}
		seen[parsed] = true
		result = append(result, parsed)
	}
	return result, nil
}

func tableExists(ctx context.Context, db *sql.DB, dialect string, table string) (bool, error) {
	var exists int
	switch strings.ToLower(dialect) {
	case "sqlite":
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&exists)
		return exists > 0, err
	case "mysql":
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, table).Scan(&exists)
		return exists > 0, err
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

func columnExists(ctx context.Context, db *sql.DB, dialect string, table string, column string) (bool, error) {
	switch strings.ToLower(dialect) {
	case "sqlite":
		rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
		if err != nil {
			return false, err
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, typ string
			var notNull int
			var defaultValue any
			var pk int
			if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
				return false, err
			}
			if strings.EqualFold(name, column) {
				return true, nil
			}
		}
		return false, rows.Err()
	case "mysql":
		var exists int
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&exists)
		return exists > 0, err
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}
