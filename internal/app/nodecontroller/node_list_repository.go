package nodecontroller

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
)

func (r Repository) ListNodeItems(ctx context.Context, nodeID int64) ([]NodeListItem, string, string, error) {
	defaultCert := ""
	defaultKey := ""
	var defaultCertNull, defaultKeyNull sql.NullString
	if err := r.db.QueryRowContext(ctx, `SELECT certificate, private_key FROM default_certificates ORDER BY id LIMIT 1`).Scan(&defaultCertNull, &defaultKeyNull); err == nil && defaultCertNull.Valid {
		defaultCert = defaultCertNull.String
		if defaultKeyNull.Valid {
			defaultKey = defaultKeyNull.String
		}
	}

	query := `SELECT
	id,
	COALESCE(name, ''),
	note,
	address,
	port,
	api_port,
	usage_coefficient,
	data_limit,
	proxy_enabled,
	proxy_type,
	proxy_host,
	proxy_port,
	proxy_username,
	proxy_password,
	status,
	COALESCE(agent_status, 'unknown'),
	COALESCE(xray_status, 'unknown'),
	COALESCE(desired_revision, 0),
	COALESCE(applied_revision, 0),
	node_capabilities,
	message,
	xray_version,
	COALESCE(geo_mode, 'default'),
	COALESCE(xray_config_mode, 'default'),
	COALESCE(uplink, 0),
	COALESCE(downlink, 0),
	certificate,
	certificate_key
FROM nodes
WHERE LOWER(COALESCE(status, '')) <> 'deleted'`
	args := []any{}
	if nodeID > 0 {
		query += ` AND id = ?`
		args = append(args, nodeID)
	}
	query += ` ORDER BY id`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, defaultCert, defaultKey, err
	}
	defer rows.Close()

	result := []NodeListItem{}
	for rows.Next() {
		var item NodeListItem
		var dataLimit, proxyPort sql.NullInt64
		var note, proxyType, proxyHost, proxyUsername, proxyPassword, capabilities, message, xrayVersion, certificate, certificateKey sql.NullString
		var proxyEnabled bool
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&note,
			&item.Address,
			&item.Port,
			&item.APIPort,
			&item.UsageCoefficient,
			&dataLimit,
			&proxyEnabled,
			&proxyType,
			&proxyHost,
			&proxyPort,
			&proxyUsername,
			&proxyPassword,
			&item.Status,
			&item.AgentStatus,
			&item.XrayStatus,
			&item.DesiredRevision,
			&item.AppliedRevision,
			&capabilities,
			&message,
			&xrayVersion,
			&item.GeoMode,
			&item.XrayConfigMode,
			&item.Uplink,
			&item.Downlink,
			&certificate,
			&certificateKey,
		); err != nil {
			return nil, defaultCert, defaultKey, err
		}
		item.DataLimit = int64PtrFromNull(dataLimit)
		item.Note = stringPtrFromNull(note)
		item.ProxyEnabled = proxyEnabled
		item.ProxyType = stringPtrFromNull(proxyType)
		item.ProxyHost = stringPtrFromNull(proxyHost)
		item.ProxyPort = int64PtrFromNull(proxyPort)
		item.ProxyUsername = stringPtrFromNull(proxyUsername)
		item.ProxyPassword = stringPtrFromNull(proxyPassword)
		item.Message = stringPtrFromNull(message)
		item.XrayVersion = stringPtrFromNull(xrayVersion)
		if capabilities.Valid {
			_ = json.Unmarshal([]byte(capabilities.String), &item.Capabilities)
		}
		item.Status = normalizeNodeListStatus(item.Status)
		if certificate.Valid && strings.TrimSpace(certificate.String) != "" {
			certValue := strings.TrimSpace(certificate.String)
			item.NodeCertificate = &certValue
		}
		if certificateKey.Valid && strings.TrimSpace(certificateKey.String) != "" {
			keyValue := strings.TrimSpace(certificateKey.String)
			item.NodeCertificateKey = &keyValue
		}
		if item.UsageCoefficient <= 0 {
			item.UsageCoefficient = 1
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return result, defaultCert, defaultKey, err
	}
	rows.Close()
	r.attachSyncErrors(ctx, result, nodeID)
	return result, defaultCert, defaultKey, nil
}

const syncErrorDetailLimit = 6000

func (r Repository) attachSyncErrors(ctx context.Context, items []NodeListItem, nodeID int64) {
	if len(items) == 0 {
		return
	}
	query := `SELECT node_id, attempts, COALESCE(last_error, '')
FROM node_operations
WHERE operation_type = 'sync_config'
  AND node_id IS NOT NULL
  AND status IN ('retrying', 'pending', 'running')
  AND COALESCE(last_error, '') <> ''`
	args := []any{}
	if nodeID > 0 {
		query += ` AND node_id = ?`
		args = append(args, nodeID)
	}
	query += ` ORDER BY id`
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return
	}
	defer rows.Close()
	type failure struct {
		attempts int
		detail   string
	}
	latest := map[int64]failure{}
	for rows.Next() {
		var id int64
		var f failure
		if err := rows.Scan(&id, &f.attempts, &f.detail); err != nil {
			return
		}
		latest[id] = f
	}
	for index := range items {
		f, ok := latest[items[index].ID]
		if !ok {
			continue
		}
		summary := summarizeSyncError(f.detail)
		detail := strings.TrimSpace(f.detail)
		if len(detail) > syncErrorDetailLimit {
			detail = detail[:syncErrorDetailLimit] + "..."
		}
		items[index].SyncError = &summary
		items[index].SyncErrorDetail = &detail
		items[index].SyncErrorAttempts = f.attempts
	}
}

func summarizeSyncError(raw string) string {
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	chosen := ""
	for _, line := range lines {
		if strings.Contains(line, "Failed to start:") {
			chosen = line
		}
	}
	if chosen == "" {
		for i := len(lines) - 1; i >= 0; i-- {
			if strings.TrimSpace(lines[i]) != "" {
				chosen = lines[i]
				break
			}
		}
	}
	chosen = strings.TrimSpace(chosen)
	if index := strings.Index(chosen, "Failed to start:"); index >= 0 {
		chosen = strings.TrimSpace(chosen[index+len("Failed to start:"):])
	}
	chosen = strings.TrimPrefix(chosen, "rpc error: code = Unavailable desc = ")
	chosen = strings.ReplaceAll(chosen, "main: failed to load config files: [stdin:] > ", "")
	chosen = strings.ReplaceAll(chosen, "infra/conf: ", "")
	if len(chosen) > 500 {
		chosen = chosen[:500] + "..."
	}
	return chosen
}

func normalizeNodeListStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case nodeapp.StatusConnected:
		return nodeapp.StatusConnected
	case nodeapp.StatusConnecting:
		return nodeapp.StatusConnecting
	case nodeapp.StatusError:
		return nodeapp.StatusError
	case nodeapp.StatusDisabled:
		return nodeapp.StatusDisabled
	case nodeapp.StatusLimited:
		return nodeapp.StatusLimited
	default:
		return nodeapp.StatusConnecting
	}
}

func stringPtrFromNull(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func int64PtrFromNull(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}
