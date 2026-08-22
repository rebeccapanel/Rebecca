package nodecontroller

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
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

type RuntimeSessionCallback struct {
	URL    string `json:"url,omitempty"`
	Token  string `json:"token,omitempty"`
	NodeID int64  `json:"node_id,omitempty"`
}

type OperationRow struct {
	ID            int64
	OperationType string
	NodeID        sql.NullInt64
	UserID        sql.NullInt64
	Payload       json.RawMessage
	Attempts      int
}

const (
	pendingOperationsPerNodeCap = 200
	maxPendingOperationsLimit   = 10000
	operationRetryBackoff       = 5 * time.Minute
)

var runtimeProxyProtocolList = []string{"vmess", "vless", "trojan", "shadowsocks", "hysteria"}

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
FROM nodes WHERE id = ? AND LOWER(COALESCE(status, '')) <> 'deleted' LIMIT 1`, nodeID).Scan(
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
	return map[string][]byte{}, nil
}

func (r Repository) RuntimeUsers(ctx context.Context) ([]runtimeUserRow, error) {
	return r.runtimeUsers(ctx, 0, nil)
}

func (r Repository) RuntimeUsersByID(ctx context.Context, userID int64) ([]runtimeUserRow, error) {
	if userID <= 0 {
		return nil, nil
	}
	return r.runtimeUsers(ctx, userID, nil)
}

func (r Repository) RuntimeUsersForProtocols(ctx context.Context, protocols []string) ([]runtimeUserRow, error) {
	return r.runtimeUsers(ctx, 0, protocols)
}

func (r Repository) RuntimeUserIdentity(ctx context.Context, userID int64) (runtimeUserIdentity, error) {
	var row runtimeUserIdentity
	err := r.db.QueryRowContext(ctx, `SELECT id, username FROM users WHERE id = ? LIMIT 1`, userID).Scan(&row.ID, &row.Username)
	if err == sql.ErrNoRows {
		return runtimeUserIdentity{}, fmt.Errorf("user not found")
	}
	if err != nil {
		return runtimeUserIdentity{}, err
	}
	return row, nil
}

func (r Repository) RuntimeUserIDsForServices(ctx context.Context, serviceIDs []int64) ([]int64, error) {
	ids := uniquePositiveInt64(serviceIDs)
	if len(ids) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(ids))
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		parts = append(parts, "?")
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM users WHERE service_id IN (`+strings.Join(parts, ",")+`) AND status != 'deleted' ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func (r Repository) runtimeUsers(ctx context.Context, userID int64, protocols []string) ([]runtimeUserRow, error) {
	excludeVPNSessions, _ := r.tableExists(ctx, "vpn_user_sessions")
	protocolQuery := runtimeProtocolsQuery(protocols)
	if protocolQuery == "" {
		return nil, nil
	}
	vpnDeviceExpr := `
      CASE
        WHEN COALESCE(vus.client_ip, '') != '' THEN 'client:' || vus.client_ip
        WHEN COALESCE(vus.assigned_ip, '') != '' THEN 'assigned:' || vus.assigned_ip
        ELSE 'session:' || vus.session_id
      END`
	if r.dialect == "mysql" || r.dialect == "mariadb" {
		vpnDeviceExpr = `
      CASE
        WHEN COALESCE(vus.client_ip, '') != '' THEN CONCAT('client:', vus.client_ip)
        WHEN COALESCE(vus.assigned_ip, '') != '' THEN CONCAT('assigned:', vus.assigned_ip)
        ELSE CONCAT('session:', vus.session_id)
      END`
	}
	query := `
SELECT
	u.id,
	u.username,
	COALESCE(u.credential_key, ''),
	COALESCE(u.flow, ''),
	u.service_id,
	protocols.type,
	COALESCE(p.settings, '{}')
FROM users u
JOIN (` + protocolQuery + `) protocols
LEFT JOIN proxies p ON u.id = p.user_id AND LOWER(p.type) = protocols.type`
	if excludeVPNSessions {
		query += `
LEFT JOIN (
	SELECT user_id, COUNT(DISTINCT ` + vpnDeviceExpr + `) AS open_devices
	FROM vpn_user_sessions vus
	WHERE vus.ended_at IS NULL
	GROUP BY user_id
) vpn_devices ON vpn_devices.user_id = u.id`
	}
	query += `
WHERE u.status IN ('active', 'on_hold') AND u.service_id IS NOT NULL AND u.service_id > 0`
	args := []any{}
	if excludeVPNSessions {
		query += `
  AND (
    COALESCE(u.ip_limit, 0) <= 0
    OR COALESCE(vpn_devices.open_devices, 0) < COALESCE(u.ip_limit, 0)
  )`
	}
	if userID > 0 {
		query += ` AND u.id = ?`
		args = append(args, userID)
	}
	query += ` ORDER BY u.id, COALESCE(p.id, 0), protocols.type`
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []runtimeUserRow{}
	for rows.Next() {
		var row runtimeUserRow
		var credentialKey, flow sql.NullString
		var settings any
		if err := rows.Scan(
			&row.ID,
			&row.Username,
			&credentialKey,
			&flow,
			&row.ServiceID,
			&row.Protocol,
			&settings,
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
		result = append(result, row)
	}
	return result, rows.Err()
}

func runtimeProtocolsQuery(protocols []string) string {
	allowed := map[string]bool{}
	for _, protocol := range protocols {
		protocol = strings.ToLower(strings.TrimSpace(protocol))
		if _, ok := proxyProtocols[protocol]; ok {
			allowed[protocol] = true
		}
	}
	if len(allowed) == 0 && len(protocols) == 0 {
		for _, protocol := range runtimeProxyProtocolList {
			allowed[protocol] = true
		}
	}
	parts := []string{}
	for _, protocol := range runtimeProxyProtocolList {
		if !allowed[protocol] {
			continue
		}
		if len(parts) == 0 {
			parts = append(parts, "SELECT '"+protocol+"' AS type")
		} else {
			parts = append(parts, "UNION ALL SELECT '"+protocol+"'")
		}
	}
	return strings.Join(parts, "\n\t")
}

func (r Repository) RuntimeSessionCallback(ctx context.Context, node NodeRow) (RuntimeSessionCallback, error) {
	if node.ID > 0 && strings.TrimSpace(node.Certificate) == "" {
		full, err := r.Node(ctx, node.ID)
		if err != nil {
			return RuntimeSessionCallback{}, err
		}
		node = full
	}
	base := strings.TrimSpace(os.Getenv("REBECCA_NODE_SESSION_CALLBACK_URL"))
	if base == "" {
		base = strings.TrimSpace(os.Getenv("REBECCA_PUBLIC_URL"))
	}
	if base == "" {
		base = strings.TrimSpace(os.Getenv("PUBLIC_URL"))
	}
	if base == "" && r.tableExistsSilent(ctx, "subscription_settings") {
		var prefix sql.NullString
		_ = r.db.QueryRowContext(ctx, `SELECT subscription_url_prefix FROM subscription_settings ORDER BY id LIMIT 1`).Scan(&prefix)
		base = strings.TrimSpace(prefix.String)
	}
	if base == "" {
		return RuntimeSessionCallback{}, nil
	}
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(base, "/internal/node/session-event") {
		base = strings.TrimSuffix(base, "/internal/node/session-event")
	}
	secret, err := r.callbackSecret(ctx)
	if err != nil {
		return RuntimeSessionCallback{}, err
	}
	if secret == "" || strings.TrimSpace(node.Certificate) == "" {
		return RuntimeSessionCallback{}, nil
	}
	return RuntimeSessionCallback{
		URL:    base + "/internal/node/session-event",
		Token:  NodeSessionEventToken(secret, node.ID, node.Certificate),
		NodeID: node.ID,
	}, nil
}

func (r Repository) callbackSecret(ctx context.Context) (string, error) {
	if !r.tableExistsSilent(ctx, "jwt") {
		return "", nil
	}
	var adminSecret, legacySecret sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT admin_secret_key, secret_key FROM jwt ORDER BY id LIMIT 1`).Scan(&adminSecret, &legacySecret)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if value := strings.TrimSpace(adminSecret.String); value != "" {
		return value, nil
	}
	return strings.TrimSpace(legacySecret.String), nil
}

func NodeSessionEventToken(secret string, nodeID int64, certificate string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	_, _ = mac.Write([]byte(fmt.Sprintf("node-session:%d:%s", nodeID, strings.TrimSpace(certificate))))
	return hex.EncodeToString(mac.Sum(nil))
}

func (r Repository) tableExistsSilent(ctx context.Context, table string) bool {
	ok, err := r.tableExists(ctx, table)
	return err == nil && ok
}

func (r Repository) tableExists(ctx context.Context, table string) (bool, error) {
	table = strings.TrimSpace(table)
	if table == "" {
		return false, nil
	}
	var count int
	if r.dialect == "mysql" || r.dialect == "mariadb" {
		err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, table).Scan(&count)
		return count > 0, err
	}
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count)
	return count > 0, err
}

func uniquePositiveInt64(values []int64) []int64 {
	if len(values) == 0 {
		return nil
	}
	seen := map[int64]struct{}{}
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
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
	_, err := r.updateStatus(ctx, nodeID, "connecting", "", "")
	return err
}

func (r Repository) SetConnected(ctx context.Context, nodeID int64, version string, message string) error {
	if len(message) > 1024 {
		message = message[:1024]
	}
	_, err := r.updateStatus(ctx, nodeID, "connected", message, version)
	return err
}

func (r Repository) SetError(ctx context.Context, nodeID int64, message string) error {
	if len(message) > 1024 {
		message = message[:1024]
	}
	if ctx.Err() == context.Canceled {
		return nil
	}
	statusCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, err := r.updateStatus(statusCtx, nodeID, "error", message, "")
	return err
}

const nodeRecoveryMinAge = 45 * time.Second

func (r Repository) RecoverableNodeIDs(ctx context.Context, limit int) ([]int64, error) {
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id
FROM nodes
WHERE LOWER(COALESCE(status, '')) IN ('error', 'connecting')
  AND (last_status_change IS NULL OR last_status_change <= ?)
ORDER BY
	CASE WHEN last_status_change IS NULL THEN 1 ELSE 0 END,
	last_status_change,
	id
LIMIT ?`, r.timeArg(time.Now().UTC().Add(-nodeRecoveryMinAge)), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]int64, 0, limit)
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		result = append(result, nodeID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r Repository) ConnectedNodeIDs(ctx context.Context) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id
FROM nodes
WHERE LOWER(COALESCE(status, '')) = 'connected'
ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodeIDs := make([]int64, 0)
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		nodeIDs = append(nodeIDs, nodeID)
	}
	return nodeIDs, rows.Err()
}

func (r Repository) PendingOperations(ctx context.Context, nodeID int64, limit int) ([]OperationRow, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > maxPendingOperationsLimit {
		limit = maxPendingOperationsLimit
	}
	if nodeID <= 0 {
		return r.pendingOperationsFair(ctx, limit)
	}
	retryCutoff := r.timeArg(time.Now().UTC().Add(-operationRetryBackoff))
	query := `SELECT id, operation_type, node_id, user_id, payload, attempts
FROM node_operations no
WHERE (
	status = 'pending'
	OR (status = 'retrying' AND updated_at <= ?)
)
AND NOT EXISTS (
	SELECT 1 FROM nodes n
	WHERE n.id = no.node_id AND LOWER(COALESCE(n.status, '')) = 'deleted'
)`
	args := []any{retryCutoff}
	query += ` AND node_id = ?`
	args = append(args, nodeID)
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

func (r Repository) PendingRuntimeUserOperations(ctx context.Context, userID int64, limit int) ([]OperationRow, error) {
	if userID <= 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = 1000
	}
	if limit > maxPendingOperationsLimit {
		limit = maxPendingOperationsLimit
	}
	retryCutoff := r.timeArg(time.Now().UTC().Add(-operationRetryBackoff))
	query := `
SELECT no.id, no.operation_type, no.node_id, no.user_id, no.payload, no.attempts
FROM node_operations no
JOIN nodes n ON n.id = no.node_id
WHERE (
    no.status = 'pending'
    OR (no.status = 'retrying' AND no.updated_at <= ?)
  )
  AND no.user_id = ?
  AND no.node_id IS NOT NULL
  AND no.operation_type IN ('add_user', 'update_user', 'remove_user', 'disable_user', 'enable_user')
  AND LOWER(COALESCE(n.status, '')) = 'connected'
ORDER BY
  CASE
    WHEN no.operation_type = 'add_user' THEN 0
    WHEN no.operation_type IN ('update_user', 'enable_user') THEN 1
    WHEN no.operation_type IN ('remove_user', 'disable_user') THEN 2
    ELSE 3
  END,
  no.node_id,
  no.id
LIMIT ?`
	rows, err := r.db.QueryContext(ctx, query, retryCutoff, userID, limit)
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

func (r Repository) pendingOperationsFair(ctx context.Context, limit int) ([]OperationRow, error) {
	perNodeCap := pendingOperationsPerNodeCap
	if limit < perNodeCap {
		perNodeCap = limit
	}
	retryCutoff := r.timeArg(time.Now().UTC().Add(-operationRetryBackoff))
	query := `WITH ranked_operations AS (
	SELECT
		no.id,
		no.operation_type,
		no.node_id,
		no.user_id,
		no.payload,
		no.attempts,
		CASE
			WHEN no.operation_type = 'sync_config' THEN 0
			WHEN no.operation_type = 'add_user' THEN 1
			WHEN no.operation_type IN ('update_user', 'enable_user') THEN 2
			WHEN no.operation_type IN ('remove_user', 'disable_user') THEN 3
			ELSE 3
		END AS operation_priority,
		ROW_NUMBER() OVER (
			PARTITION BY COALESCE(no.node_id, -1)
			ORDER BY
				CASE
					WHEN no.operation_type = 'sync_config' THEN 0
					WHEN no.operation_type = 'add_user' THEN 1
					WHEN no.operation_type IN ('update_user', 'enable_user') THEN 2
					WHEN no.operation_type IN ('remove_user', 'disable_user') THEN 3
				ELSE 3
				END,
				CASE WHEN no.operation_type = 'add_user' THEN -no.id ELSE no.id END
		) AS node_rank,
		CASE
			WHEN no.node_id IS NULL THEN 0
			WHEN LOWER(COALESCE(n.status, '')) = 'connected' THEN 1
			WHEN LOWER(COALESCE(n.status, '')) IN ('disabled', 'limited') THEN 3
			ELSE 2
		END AS priority
	FROM node_operations no
	LEFT JOIN nodes n ON n.id = no.node_id
	WHERE (
		no.status = 'pending'
		OR (no.status = 'retrying' AND no.updated_at <= ?)
	)
	AND (no.node_id IS NULL OR LOWER(COALESCE(n.status, '')) <> 'deleted')
)
SELECT id, operation_type, node_id, user_id, payload, attempts
FROM ranked_operations
WHERE node_rank <= ?
ORDER BY priority, node_rank, operation_priority, COALESCE(node_id, -1), id
LIMIT ?`
	rows, err := r.db.QueryContext(ctx, query, retryCutoff, perNodeCap, limit)
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

func (r Repository) RecoverStaleOperations(ctx context.Context, olderThan time.Duration) error {
	if olderThan <= 0 {
		olderThan = 2 * time.Minute
	}
	cutoff := time.Now().UTC().Add(-olderThan)
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations
SET status = 'retrying', attempts = attempts + 1, last_error = ?, updated_at = ?
WHERE status = 'running' AND updated_at < ?
  AND NOT EXISTS (
	SELECT 1 FROM nodes n
	WHERE n.id = node_operations.node_id AND LOWER(COALESCE(n.status, '')) = 'deleted'
  )`,
		"operation was left running and will be retried",
		r.timeArg(time.Now().UTC()),
		r.timeArg(cutoff),
	)
	return err
}

func (r Repository) MarkOperationRunning(ctx context.Context, id int64) (bool, error) {
	res, err := r.db.ExecContext(
		ctx,
		`UPDATE node_operations
SET status = 'running', updated_at = ?
WHERE id = ? AND status IN ('pending', 'retrying')
  AND (
	node_id IS NULL
	OR EXISTS (
		SELECT 1 FROM nodes n
		WHERE n.id = node_operations.node_id AND LOWER(COALESCE(n.status, '')) <> 'deleted'
	)
  )`,
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

func (r Repository) CoalescibleOperationIDsForTarget(ctx context.Context, representative OperationRow) ([]int64, error) {
	query := `SELECT id, operation_type, node_id, user_id, payload, attempts
FROM node_operations
WHERE status IN ('pending', 'retrying', 'running')
  AND operation_type IN ('sync_config', 'add_user', 'update_user', 'remove_user', 'disable_user', 'enable_user')`
	args := []any{}
	if representative.NodeID.Valid {
		query += ` AND node_id = ?`
		args = append(args, representative.NodeID.Int64)
	} else {
		query += ` AND node_id IS NULL`
	}
	query += ` ORDER BY id`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var row OperationRow
		var payload []byte
		if err := rows.Scan(&row.ID, &row.OperationType, &row.NodeID, &row.UserID, &payload, &row.Attempts); err != nil {
			return nil, err
		}
		row.Payload = append(row.Payload[:0], payload...)
		if canCoalesceRuntimeSyncOperation(row) {
			ids = append(ids, row.ID)
			continue
		}
		if canCoalesceRuntimeSyncOperation(representative) && isRuntimeUserOperation(row.OperationType) && row.ID <= representative.ID {
			ids = append(ids, row.ID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func (r Repository) MarkOperationsDone(ctx context.Context, ids []int64) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	now := r.timeArg(time.Now().UTC())
	affectedTotal := 0
	for start := 0; start < len(ids); start += 500 {
		end := start + 500
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		args := []any{now}
		args = append(args, int64Args(chunk)...)
		res, err := r.db.ExecContext(
			ctx,
			`UPDATE node_operations
SET status = 'done', last_error = NULL, updated_at = ?
WHERE status IN ('pending', 'retrying', 'running') AND id IN (`+placeholders(len(chunk))+`)`,
			args...,
		)
		if err != nil {
			return affectedTotal, err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			affectedTotal += len(chunk)
			continue
		}
		affectedTotal += int(affected)
	}
	return affectedTotal, nil
}

func (r Repository) ReplaceOpenQueueWithFullSync(ctx context.Context) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	timeArg := r.timeArg(now)
	res, err := tx.ExecContext(ctx, `UPDATE node_operations
SET status = 'done', last_error = NULL, updated_at = ?
WHERE status IN ('pending', 'retrying', 'running')`, timeArg)
	if err != nil {
		return 0, err
	}
	cleared := rowsAffectedOrDefault(res, 0)
	sum := sha256.Sum256([]byte(fmt.Sprintf("startup-sync:%d", now.UnixNano())))
	if _, err := tx.ExecContext(ctx, `INSERT INTO node_operations
(operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{}', 'pending', 0, ?, ?, ?)`, hex.EncodeToString(sum[:]), timeArg, timeArg); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return cleared, nil
}

func rowsAffectedOrDefault(res sql.Result, fallback int) int {
	if res == nil {
		return fallback
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fallback
	}
	return int(affected)
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

func (r Repository) FirstConnectedNode(ctx context.Context) (NodeRow, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `SELECT id FROM nodes WHERE LOWER(COALESCE(status, '')) = 'connected' ORDER BY id LIMIT 1`).Scan(&id)
	if err == sql.ErrNoRows {
		return NodeRow{}, fmt.Errorf("no connected node is available")
	}
	if err != nil {
		return NodeRow{}, err
	}
	return r.Node(ctx, id)
}

func (r Repository) QueueSyncConfig(ctx context.Context, nodeID *int64, payload any) error {
	now := time.Now().UTC()
	payloadJSON := []byte("{}")
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		payloadJSON = encoded
	}
	if canCoalesceRuntimeSyncOperation(OperationRow{OperationType: "sync_config", Payload: payloadJSON}) {
		existing, err := r.coalescePendingSyncConfig(ctx, nodeID, now)
		if err != nil || existing {
			return err
		}
	}
	return r.enqueueSyncConfig(ctx, nodeID, payloadJSON, now)
}

func (r Repository) enqueueSyncConfig(ctx context.Context, nodeID *int64, payloadJSON []byte, now time.Time) error {
	idempotencySource := fmt.Sprintf("sync_config:%s:%d", string(payloadJSON), now.UnixNano())
	if nodeID != nil {
		idempotencySource = fmt.Sprintf("sync_config:%d:%s:%d", *nodeID, string(payloadJSON), now.UnixNano())
	}
	sum := sha256.Sum256([]byte(idempotencySource))
	key := hex.EncodeToString(sum[:])
	_, err := r.db.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('sync_config', ?, NULL, ?, 'pending', 0, ?, ?, ?)`,
		nullableInt64Ptr(nodeID),
		string(payloadJSON),
		key,
		r.timeArg(now),
		r.timeArg(now),
	)
	return err
}

func (r Repository) coalescePendingSyncConfig(ctx context.Context, nodeID *int64, now time.Time) (bool, error) {
	where := `operation_type = 'sync_config'
  AND status IN ('pending', 'retrying')
  AND LOWER(COALESCE(payload, '')) NOT LIKE '%"config_json"%'`
	args := []any{}
	if nodeID != nil {
		where += ` AND node_id = ?`
		args = append(args, *nodeID)
	} else {
		where += ` AND node_id IS NULL`
	}

	var keep sql.NullInt64
	if err := r.db.QueryRowContext(ctx, `SELECT MAX(id) FROM node_operations WHERE `+where, args...).Scan(&keep); err != nil {
		return false, err
	}
	if !keep.Valid {
		return false, nil
	}

	updateArgs := []any{r.timeArg(now)}
	updateArgs = append(updateArgs, args...)
	updateArgs = append(updateArgs, keep.Int64)
	_, err := r.db.ExecContext(ctx, `UPDATE node_operations
SET status = 'done', last_error = NULL, updated_at = ?
WHERE `+where+` AND id <> ?`, updateArgs...)
	return true, err
}

func (r Repository) QueueNodeSpecificRetry(ctx context.Context, nodeID int64, operation OperationRow) error {
	if nodeID <= 0 {
		return fmt.Errorf("node_id is required")
	}
	var status string
	err := r.db.QueryRowContext(ctx, `SELECT LOWER(COALESCE(status, '')) FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&status)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if status == "deleted" || (isRuntimeUserOperation(operation.OperationType) && status != "connected") {
		return nil
	}
	operationType := strings.TrimSpace(operation.OperationType)
	if operationType == "" {
		return fmt.Errorf("operation_type is required")
	}
	payloadJSON := []byte("{}")
	if len(operation.Payload) > 0 {
		payloadJSON = append(payloadJSON[:0], operation.Payload...)
	}
	userID := any(nil)
	userIDForKey := int64(0)
	if operation.UserID.Valid {
		userID = operation.UserID.Int64
		userIDForKey = operation.UserID.Int64
	}
	keySource := fmt.Sprintf("node_retry:%d:%s:%d:%d:%s", operation.ID, operationType, nodeID, userIDForKey, string(payloadJSON))
	sum := sha256.Sum256([]byte(keySource))
	key := hex.EncodeToString(sum[:])

	var existing int64
	err = r.db.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, key).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	now := time.Now().UTC()
	_, err = r.db.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nodeID,
		userID,
		string(payloadJSON),
		key,
		r.timeArg(now),
		r.timeArg(now),
	)
	if isNodeOperationUniqueConstraint(err) {
		return nil
	}
	return err
}

func isMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		strings.Contains(message, "doesn't exist") ||
		strings.Contains(message, "unknown table")
}

func isNodeOperationUniqueConstraint(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint failed") ||
		strings.Contains(message, "duplicate entry") ||
		strings.Contains(message, "constraint failed")
}

func (r Repository) updateStatus(ctx context.Context, nodeID int64, status string, message string, version string) (bool, error) {
	result, err := r.db.ExecContext(
		ctx,
		`UPDATE nodes
SET last_status_change = CASE WHEN COALESCE(status, '') <> ? THEN ? ELSE last_status_change END,
    status = ?,
    message = ?,
    xray_version = COALESCE(NULLIF(?, ''), xray_version)
WHERE id = ?
  AND LOWER(COALESCE(status, '')) NOT IN ('disabled', 'limited', 'deleted')
  AND (
    COALESCE(status, '') <> ?
    OR COALESCE(message, '') <> ?
    OR (? <> '' AND COALESCE(xray_version, '') <> ?)
  )`,
		status,
		r.timeArg(time.Now().UTC()),
		status,
		nullableString(message),
		version,
		nodeID,
		status,
		strings.TrimSpace(message),
		version,
		version,
	)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (r Repository) timeArg(value time.Time) any {
	if r.dialect == "sqlite" {
		return value.UTC().Format("2006-01-02 15:04:05.000000")
	}
	return value.UTC()
}

func nullableInt64Ptr(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
