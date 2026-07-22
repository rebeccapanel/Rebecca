package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"regexp"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000011_xray_config_targets.go", up000011XrayConfigTargets, emptyDown)
}

func up000011XrayConfigTargets(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensureXrayConfigTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := seedXrayConfigFromLegacyFile(ctx, tx); err != nil {
		return err
	}
	return ensureNodeConfigTargetColumns(ctx, tx, dialect)
}

func ensureXrayConfigTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "xray_config", `
CREATE TABLE xray_config (
	id INTEGER PRIMARY KEY,
	data TEXT NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE xray_config (
	id INTEGER NOT NULL AUTO_INCREMENT,
	data JSON NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"data", "TEXT NOT NULL", "JSON NOT NULL"},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "xray_config", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return nil
}

func seedXrayConfigFromLegacyFile(ctx context.Context, tx *sql.Tx) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM xray_config`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	payload := defaultXrayConfigJSON()
	legacyPath := legacyXrayConfigPath()
	if legacyPath != "" {
		if raw, err := os.ReadFile(legacyPath); err == nil {
			if normalized, ok := normalizeLegacyXrayJSON(raw); ok {
				payload = normalized
				_ = os.Remove(legacyPath)
			}
		}
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO xray_config (id, data) VALUES (?, ?)`, 1, payload)
	return err
}

func ensureNodeConfigTargetColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasNodes, err := HasTable(ctx, tx, dialect, "nodes")
	if err != nil || !hasNodes {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"xray_config_mode", "VARCHAR(32) NOT NULL DEFAULT 'default'", ""},
		{"xray_config", "TEXT NULL", "JSON NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "nodes", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `
UPDATE nodes
SET xray_config_mode = 'default'
WHERE xray_config_mode IS NULL
   OR TRIM(xray_config_mode) = ''
   OR xray_config_mode NOT IN ('default', 'custom')`)
	return err
}

func legacyXrayConfigPath() string {
	if value := strings.TrimSpace(os.Getenv("XRAY_JSON")); value != "" {
		return value
	}
	return "/var/lib/rebecca/xray_config.json"
}

func normalizeLegacyXrayJSON(raw []byte) (string, bool) {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return "", false
	}
	cleaned := removeTrailingJSONCommas(stripJSONComments(text))
	var payload any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return "", false
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

func stripJSONComments(input string) string {
	var out strings.Builder
	inString := false
	escaped := false
	for i := 0; i < len(input); i++ {
		ch := input[i]
		if inString {
			out.WriteByte(ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			out.WriteByte(ch)
			continue
		}
		if ch == '/' && i+1 < len(input) {
			switch input[i+1] {
			case '/':
				i += 2
				for i < len(input) && input[i] != '\n' && input[i] != '\r' {
					i++
				}
				if i < len(input) {
					out.WriteByte(input[i])
				}
				continue
			case '*':
				i += 2
				for i+1 < len(input) && !(input[i] == '*' && input[i+1] == '/') {
					i++
				}
				i++
				continue
			}
		}
		out.WriteByte(ch)
	}
	return out.String()
}

func removeTrailingJSONCommas(input string) string {
	re := regexp.MustCompile(`,\s*([}\]])`)
	previous := ""
	output := input
	for previous != output {
		previous = output
		output = re.ReplaceAllString(output, "$1")
	}
	return output
}

func defaultXrayConfigJSON() string {
	return `{"log":{"loglevel":"warning"},"routing":{"rules":[{"ip":["geoip:private"],"outboundTag":"BLOCK","type":"field"}]},"inbounds":[{"tag":"Shadowsocks TCP","listen":"0.0.0.0","port":1080,"protocol":"shadowsocks","settings":{"clients":[],"network":"tcp,udp"}}],"outbounds":[{"protocol":"freedom","tag":"DIRECT"},{"protocol":"blackhole","tag":"BLOCK"}]}`
}
