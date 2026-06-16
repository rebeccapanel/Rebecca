package nodecontroller

import (
	"context"
	"database/sql"
	"strings"

	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
)

func (r Repository) ListNodeItems(ctx context.Context, nodeID int64) ([]NodeListItem, string, string, error) {
	defaultCert := ""
	defaultKey := ""
	var defaultCertNull, defaultKeyNull sql.NullString
	if err := r.db.QueryRowContext(ctx, `SELECT certificate, `+"`key`"+` FROM tls ORDER BY id LIMIT 1`).Scan(&defaultCertNull, &defaultKeyNull); err == nil && defaultCertNull.Valid {
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
	use_nobetci,
	nobetci_port,
	proxy_enabled,
	proxy_type,
	proxy_host,
	proxy_port,
	proxy_username,
	proxy_password,
	status,
	message,
	xray_version,
	COALESCE(geo_mode, 'default'),
	COALESCE(xray_config_mode, 'default'),
	COALESCE(uplink, 0),
	COALESCE(downlink, 0),
	certificate,
	certificate_key
FROM nodes`
	args := []any{}
	if nodeID > 0 {
		query += ` WHERE id = ?`
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
		var dataLimit, nobetciPort, proxyPort sql.NullInt64
		var note, proxyType, proxyHost, proxyUsername, proxyPassword, message, xrayVersion, certificate, certificateKey sql.NullString
		var useNobetci, proxyEnabled bool
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&note,
			&item.Address,
			&item.Port,
			&item.APIPort,
			&item.UsageCoefficient,
			&dataLimit,
			&useNobetci,
			&nobetciPort,
			&proxyEnabled,
			&proxyType,
			&proxyHost,
			&proxyPort,
			&proxyUsername,
			&proxyPassword,
			&item.Status,
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
		item.UseNobetci = useNobetci
		item.NobetciPort = int64PtrFromNull(nobetciPort)
		item.ProxyEnabled = proxyEnabled
		item.ProxyType = stringPtrFromNull(proxyType)
		item.ProxyHost = stringPtrFromNull(proxyHost)
		item.ProxyPort = int64PtrFromNull(proxyPort)
		item.ProxyUsername = stringPtrFromNull(proxyUsername)
		item.ProxyPassword = stringPtrFromNull(proxyPassword)
		item.Message = stringPtrFromNull(message)
		item.XrayVersion = stringPtrFromNull(xrayVersion)
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
	return result, defaultCert, defaultKey, rows.Err()
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
