package nodecontroller

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Repository struct {
	db      *sql.DB
	dialect string
}

type NodeRow struct {
	ID               int64
	Name             string
	Address          string
	Port             int
	APIPort          int
	Status           string
	XrayVersion      string
	Message          string
	Certificate      string
	CertificateKey   string
	XrayConfigMode   string
	XrayConfig       json.RawMessage
	UsageCoefficient float64
}

type TLSRow struct {
	Certificate string
	Key         string
}

type OperationRow struct {
	ID            int64
	OperationType string
	NodeID        sql.NullInt64
	UserID        sql.NullInt64
	Payload       json.RawMessage
	Attempts      int
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) Node(ctx context.Context, nodeID int64) (NodeRow, error) {
	var row NodeRow
	var xrayVersion, message, cert, key, mode sql.NullString
	var rawConfig sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT
	id,
	COALESCE(name, ''),
	address,
	port,
	api_port,
	status,
	xray_version,
	message,
	certificate,
	certificate_key,
	xray_config_mode,
	xray_config,
	usage_coefficient
FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(
		&row.ID,
		&row.Name,
		&row.Address,
		&row.Port,
		&row.APIPort,
		&row.Status,
		&xrayVersion,
		&message,
		&cert,
		&key,
		&mode,
		&rawConfig,
		&row.UsageCoefficient,
	)
	if err == sql.ErrNoRows {
		return NodeRow{}, fmt.Errorf("node not found")
	}
	if err != nil {
		return NodeRow{}, err
	}
	row.XrayVersion = xrayVersion.String
	row.Message = message.String
	row.Certificate = cert.String
	row.CertificateKey = key.String
	row.XrayConfigMode = mode.String
	if rawConfig.Valid && strings.TrimSpace(rawConfig.String) != "" {
		row.XrayConfig = json.RawMessage(rawConfig.String)
	}
	return row, nil
}

func (r Repository) TLS(ctx context.Context) (TLSRow, error) {
	var row TLSRow
	err := r.db.QueryRowContext(ctx, `SELECT certificate, `+"`key`"+` FROM tls ORDER BY id LIMIT 1`).Scan(&row.Certificate, &row.Key)
	if err != nil {
		return TLSRow{}, err
	}
	return row, nil
}

func (r Repository) NodeRawConfig(ctx context.Context, node NodeRow) (map[string]any, error) {
	if node.XrayConfigMode == "custom" && len(node.XrayConfig) > 0 {
		if parsed := jsonMap(node.XrayConfig); len(parsed) > 0 {
			return parsed, nil
		}
	}
	var raw any
	err := r.db.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1 LIMIT 1`).Scan(&raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return jsonMap(raw), nil
}

func (r Repository) UUIDMasks(ctx context.Context) (map[string][]byte, error) {
	var vmessMask, vlessMask sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT vmess_mask, vless_mask FROM jwt ORDER BY id LIMIT 1`).Scan(&vmessMask, &vlessMask)
	if err != nil {
		if err == sql.ErrNoRows {
			return map[string][]byte{}, nil
		}
		return nil, err
	}
	result := map[string][]byte{}
	for protocol, value := range map[string]sql.NullString{"vmess": vmessMask, "vless": vlessMask} {
		if !value.Valid || strings.TrimSpace(value.String) == "" {
			continue
		}
		decoded, err := hex.DecodeString(value.String)
		if err != nil {
			return nil, fmt.Errorf("invalid %s mask: %w", protocol, err)
		}
		result[protocol] = decoded
	}
	return result, nil
}

func (r Repository) RuntimeUsers(ctx context.Context) ([]runtimeUserRow, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT
	u.id,
	u.username,
	COALESCE(u.credential_key, ''),
	COALESCE(u.flow, ''),
	u.service_id,
	LOWER(p.type),
	p.settings,
	GROUP_CONCAT(e.inbound_tag)
FROM users u
JOIN proxies p ON u.id = p.user_id
LEFT JOIN exclude_inbounds_association e ON p.id = e.proxy_id
WHERE u.status IN ('active', 'on_hold')
GROUP BY u.id, u.username, u.credential_key, u.flow, u.service_id, LOWER(p.type), p.settings
ORDER BY u.id, p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []runtimeUserRow{}
	for rows.Next() {
		var row runtimeUserRow
		var credentialKey, flow sql.NullString
		var settings any
		var excluded sql.NullString
		if err := rows.Scan(
			&row.ID,
			&row.Username,
			&credentialKey,
			&flow,
			&row.ServiceID,
			&row.Protocol,
			&settings,
			&excluded,
		); err != nil {
			return nil, err
		}
		if credentialKey.Valid {
			row.CredentialKey = credentialKey.String
		}
		if flow.Valid {
			row.Flow = flow.String
		}
		row.Protocol = strings.ToLower(row.Protocol)
		row.Settings = jsonMap(settings)
		if excluded.Valid && excluded.String != "" {
			row.ExcludedTags = splitComma(excluded.String)
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (r Repository) ServiceAllowedTags(ctx context.Context) (map[int64]map[string]bool, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT sh.service_id, h.inbound_tag
FROM service_hosts sh
JOIN hosts h ON h.id = sh.host_id
WHERE COALESCE(h.is_disabled, 0) = 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[int64]map[string]bool{}
	for rows.Next() {
		var serviceID int64
		var tag string
		if err := rows.Scan(&serviceID, &tag); err != nil {
			return nil, err
		}
		if result[serviceID] == nil {
			result[serviceID] = map[string]bool{}
		}
		result[serviceID][tag] = true
	}
	return result, rows.Err()
}

func (r Repository) SetConnecting(ctx context.Context, nodeID int64) error {
	return r.updateStatus(ctx, nodeID, "connecting", "", "")
}

func (r Repository) SetConnected(ctx context.Context, nodeID int64, version string, message string) error {
	return r.updateStatus(ctx, nodeID, "connected", message, version)
}

func (r Repository) SetError(ctx context.Context, nodeID int64, message string) error {
	if len(message) > 1024 {
		message = message[:1024]
	}
	return r.updateStatus(ctx, nodeID, "error", message, "")
}

func (r Repository) PendingOperations(ctx context.Context, nodeID int64, limit int) ([]OperationRow, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	query := `SELECT id, operation_type, node_id, user_id, payload, attempts
FROM node_operations
WHERE status IN ('pending', 'retrying')`
	args := []any{}
	if nodeID > 0 {
		query += ` AND node_id = ?`
		args = append(args, nodeID)
	}
	query += ` ORDER BY id LIMIT ?`
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]OperationRow, 0, limit)
	for rows.Next() {
		var row OperationRow
		var payload []byte
		if err := rows.Scan(&row.ID, &row.OperationType, &row.NodeID, &row.UserID, &payload, &row.Attempts); err != nil {
			return nil, err
		}
		row.Payload = append(row.Payload[:0], payload...)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r Repository) MarkOperationRunning(ctx context.Context, id int64) (bool, error) {
	res, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('pending', 'retrying')`,
		r.timeArg(time.Now().UTC()),
		id,
	)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return true, nil
	}
	return affected > 0, nil
}

func (r Repository) MarkOperationDone(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`,
		r.timeArg(time.Now().UTC()),
		id,
	)
	return err
}

func (r Repository) MarkOperationRetrying(ctx context.Context, id int64, message string) error {
	if len(message) > 4096 {
		message = message[:4096]
	}
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations SET status = 'retrying', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`,
		message,
		r.timeArg(time.Now().UTC()),
		id,
	)
	return err
}

func (r Repository) MarkOperationFailed(ctx context.Context, id int64, message string) error {
	if len(message) > 4096 {
		message = message[:4096]
	}
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`,
		message,
		r.timeArg(time.Now().UTC()),
		id,
	)
	return err
}

func (r Repository) updateStatus(ctx context.Context, nodeID int64, status string, message string, version string) error {
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE nodes SET status = ?, message = ?, xray_version = COALESCE(NULLIF(?, ''), xray_version), last_status_change = ? WHERE id = ?`,
		status,
		nullableString(message),
		version,
		r.timeArg(time.Now().UTC()),
		nodeID,
	)
	return err
}

func (r Repository) timeArg(value time.Time) any {
	if r.dialect == "sqlite" {
		return value.UTC().Format("2006-01-02 15:04:05.000000")
	}
	return value.UTC()
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func splitComma(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
