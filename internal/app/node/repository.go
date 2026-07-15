package node

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const DefaultPendingCertificateTTL = 30 * time.Minute
const (
	MaxNodeNameLength = 120
	MaxNodeNoteLength = 500
)

type Repository struct {
	db      *sql.DB
	dialect string
	now     func() time.Time
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect, now: func() time.Time { return time.Now().UTC() }}
}

func (r Repository) WithNow(now func() time.Time) Repository {
	r.now = now
	return r
}

func (r Repository) Settings(ctx context.Context) (NodeSettings, error) {
	tls, err := r.tls(ctx)
	if err != nil {
		return NodeSettings{}, err
	}
	return NodeSettings{
		MinNodeVersion: "v0.2.0",
		Certificate:    tls.Certificate,
	}, nil
}

func (r Repository) CreatePendingCertificate(ctx context.Context, ttl time.Duration) (PendingNodeCertificate, error) {
	if ttl <= 0 {
		ttl = DefaultPendingCertificateTTL
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	defer rollbackQuiet(tx)
	pending, err := r.createPendingCertificateTx(ctx, tx, ttl)
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	if err := tx.Commit(); err != nil {
		return PendingNodeCertificate{}, err
	}
	return pending, nil
}

func (r Repository) CreateNode(ctx context.Context, payload NodeCreate) (NodeResponse, error) {
	if err := validateNodeCreate(payload); err != nil {
		return NodeResponse{}, err
	}
	if err := r.DeleteExpiredPendingCertificates(ctx); err != nil {
		return NodeResponse{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeResponse{}, err
	}
	defer rollbackQuiet(tx)

	if err := r.ensureNodeNameAvailableTx(ctx, tx, payload.Name, 0); err != nil {
		return NodeResponse{}, err
	}

	geoMode := defaultString(payload.GeoMode, GeoModeDefault)
	configMode := defaultString(payload.XrayConfigMode, XrayConfigModeDefault)
	if configMode != XrayConfigModeCustom {
		payload.XrayConfig = nil
	}
	now := r.now().UTC()
	res, err := tx.ExecContext(ctx, `
INSERT INTO nodes (
	name, note, address, port, api_port, status, last_status_change, created_at,
	uplink, downlink, usage_coefficient, geo_mode, data_limit,
	proxy_enabled, proxy_type, proxy_host, proxy_port,
	proxy_username, proxy_password, xray_config_mode, xray_config
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		strings.TrimSpace(payload.Name),
		nullableStringPtr(payload.Note, true),
		strings.TrimSpace(payload.Address),
		defaultInt(payload.Port, 62050),
		defaultInt(payload.APIPort, 62051),
		StatusConnecting,
		dbTimestamp(now),
		dbTimestamp(now),
		defaultFloat(payload.UsageCoefficient, 1),
		geoMode,
		nullableInt64Ptr(payload.DataLimit),
		boolInt(payload.ProxyEnabled),
		nullableProxyType(payload.ProxyType, payload.ProxyEnabled),
		nullableStringPtr(payload.ProxyHost, payload.ProxyEnabled),
		nullableInt64PtrIf(payload.ProxyPort, payload.ProxyEnabled),
		nullableStringPtr(payload.ProxyUsername, payload.ProxyEnabled),
		nullableStringPtr(payload.ProxyPassword, payload.ProxyEnabled),
		configMode,
		nullableJSON(payload.XrayConfig),
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return NodeResponse{}, typedError(ErrorConflict, fmt.Sprintf(`Node "%s" already exists`, payload.Name))
		}
		return NodeResponse{}, err
	}
	nodeID, err := res.LastInsertId()
	if err != nil || nodeID == 0 {
		if scanErr := tx.QueryRowContext(ctx, `SELECT id FROM nodes WHERE name = ? ORDER BY id DESC LIMIT 1`, payload.Name).Scan(&nodeID); scanErr != nil {
			return NodeResponse{}, errors.Join(err, scanErr)
		}
	}

	cert, key, err := r.certificateForCreateTx(ctx, tx, nodeID, payload)
	if err != nil {
		return NodeResponse{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET certificate = ?, certificate_key = ? WHERE id = ?`, cert, key, nodeID); err != nil {
		return NodeResponse{}, err
	}
	if err := r.enqueueNodeOperationTx(ctx, tx, NodeOperationSyncConfig, &nodeID, nil, map[string]any{"node_id": nodeID}, now); err != nil {
		return NodeResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeResponse{}, err
	}
	node, err := r.GetNode(ctx, nodeID)
	if err != nil {
		return NodeResponse{}, err
	}
	node.NodeCertificateKey = &key
	return node, nil
}

func (r Repository) GetNode(ctx context.Context, nodeID int64) (NodeResponse, error) {
	defaultCert := ""
	if tls, err := r.tls(ctx); err == nil {
		defaultCert = tls.Certificate
	}
	return r.getNode(ctx, r.db, nodeID, defaultCert)
}

func (r Repository) UpdateNode(ctx context.Context, nodeID int64, payload NodeModify) (NodeResponse, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeResponse{}, err
	}
	defer rollbackQuiet(tx)

	current, err := r.getNode(ctx, tx, nodeID, "")
	if err != nil {
		return NodeResponse{}, err
	}
	if payload.Name != nil {
		name := strings.TrimSpace(*payload.Name)
		if name == "" {
			return NodeResponse{}, wrapInvalid("name is required")
		}
		if len([]rune(name)) > MaxNodeNameLength {
			return NodeResponse{}, wrapInvalid("name can be a maximum of %d characters", MaxNodeNameLength)
		}
		if err := r.ensureNodeNameAvailableTx(ctx, tx, name, nodeID); err != nil {
			return NodeResponse{}, err
		}
	}
	updates := []string{}
	args := []any{}
	add := func(column string, value any) {
		updates = append(updates, column+" = ?")
		args = append(args, value)
	}
	if payload.Name != nil {
		add("name", strings.TrimSpace(*payload.Name))
	}
	if payload.Note != nil {
		note := strings.TrimSpace(*payload.Note)
		if len([]rune(note)) > MaxNodeNoteLength {
			return NodeResponse{}, wrapInvalid("note can be a maximum of %d characters", MaxNodeNoteLength)
		}
		add("note", emptyStringAsNil(note))
	}
	connectionChanged := false
	markConnectionChanged := func() {
		connectionChanged = true
	}
	if payload.Address != nil {
		address := strings.TrimSpace(*payload.Address)
		if address == "" {
			return NodeResponse{}, wrapInvalid("address is required")
		}
		add("address", address)
		if address != current.Address {
			markConnectionChanged()
		}
	}
	if payload.Port != nil {
		add("port", *payload.Port)
		if *payload.Port != current.Port {
			markConnectionChanged()
		}
	}
	if payload.APIPort != nil {
		add("api_port", *payload.APIPort)
		if *payload.APIPort != current.APIPort {
			markConnectionChanged()
		}
	}
	finalStatus := current.Status
	statusReconnectRequested := false
	if payload.Status != nil {
		status := strings.TrimSpace(*payload.Status)
		switch status {
		case StatusDisabled:
			if status != current.Status {
				add("status", StatusDisabled)
				add("xray_version", nil)
				add("message", nil)
				add("last_status_change", dbTimestamp(r.now().UTC()))
				finalStatus = StatusDisabled
			}
		case StatusLimited:
			if status != current.Status {
				add("status", StatusLimited)
				add("message", "Data limit reached")
				add("last_status_change", dbTimestamp(r.now().UTC()))
				finalStatus = StatusLimited
			}
		case StatusConnected, StatusConnecting, StatusError:
			if status != current.Status {
				add("status", StatusConnecting)
				add("message", nil)
				add("last_status_change", dbTimestamp(r.now().UTC()))
				finalStatus = StatusConnecting
				statusReconnectRequested = true
			}
		default:
			return NodeResponse{}, wrapInvalid("invalid node status")
		}
	}
	if payload.UsageCoefficient != nil {
		if *payload.UsageCoefficient <= 0 {
			return NodeResponse{}, wrapInvalid("usage_coefficient must be greater than zero")
		}
		add("usage_coefficient", *payload.UsageCoefficient)
	}
	if payload.GeoMode != nil {
		add("geo_mode", defaultString(*payload.GeoMode, GeoModeDefault))
	}
	if len(payload.XrayConfig) > 0 {
		add("xray_config", string(payload.XrayConfig))
		add("xray_config_mode", XrayConfigModeCustom)
		markConnectionChanged()
	} else if payload.XrayConfigMode != nil {
		currentHasStoredConfig, err := r.nodeStoredXrayConfigExistsTx(ctx, tx, nodeID)
		if err != nil {
			return NodeResponse{}, err
		}
		mode := defaultString(*payload.XrayConfigMode, XrayConfigModeDefault)
		switch mode {
		case XrayConfigModeCustom:
			if current.XrayConfigMode != XrayConfigModeCustom {
				add("xray_config_mode", XrayConfigModeCustom)
				markConnectionChanged()
			}
		case XrayConfigModeDefault:
			if current.XrayConfigMode != XrayConfigModeCustom || !currentHasStoredConfig {
				add("xray_config_mode", XrayConfigModeDefault)
				add("xray_config", nil)
				markConnectionChanged()
			}
		default:
			return NodeResponse{}, wrapInvalid("invalid xray_config_mode")
		}
	}
	if payload.DataLimit != nil {
		add("data_limit", nullableInt64Ptr(payload.DataLimit))
		usageTotal := current.Uplink + current.Downlink
		if current.Status == StatusLimited && (*payload.DataLimit == 0 || usageTotal < *payload.DataLimit) && payload.Status == nil {
			add("status", StatusConnecting)
			add("message", nil)
		}
	}
	if payload.ProxyEnabled != nil {
		add("proxy_enabled", boolInt(*payload.ProxyEnabled))
		if *payload.ProxyEnabled != current.ProxyEnabled {
			markConnectionChanged()
		}
		if !*payload.ProxyEnabled {
			add("proxy_type", nil)
			add("proxy_host", nil)
			add("proxy_port", nil)
			add("proxy_username", nil)
			add("proxy_password", nil)
		}
	}
	if payload.ProxyType != nil {
		add("proxy_type", strings.TrimSpace(string(*payload.ProxyType)))
		if current.ProxyType == nil || strings.TrimSpace(*current.ProxyType) != strings.TrimSpace(string(*payload.ProxyType)) {
			markConnectionChanged()
		}
	}
	if payload.ProxyHost != nil {
		add("proxy_host", emptyStringAsNil(*payload.ProxyHost))
		if stringPtrValue(current.ProxyHost) != strings.TrimSpace(*payload.ProxyHost) {
			markConnectionChanged()
		}
	}
	if payload.ProxyPort != nil {
		add("proxy_port", nullableInt64Ptr(payload.ProxyPort))
		if current.ProxyPort == nil || *current.ProxyPort != *payload.ProxyPort {
			markConnectionChanged()
		}
	}
	if payload.ProxyUsername != nil {
		add("proxy_username", emptyStringAsNil(*payload.ProxyUsername))
		if stringPtrValue(current.ProxyUsername) != strings.TrimSpace(*payload.ProxyUsername) {
			markConnectionChanged()
		}
	}
	if payload.ProxyPassword != nil {
		add("proxy_password", emptyStringAsNil(*payload.ProxyPassword))
		if stringPtrValue(current.ProxyPassword) != strings.TrimSpace(*payload.ProxyPassword) {
			markConnectionChanged()
		}
	}
	if connectionChanged && !statusReconnectRequested && current.Status != StatusDisabled && current.Status != StatusLimited && finalStatus != StatusDisabled && finalStatus != StatusLimited {
		add("status", StatusConnecting)
		add("message", nil)
		add("last_status_change", dbTimestamp(r.now().UTC()))
		finalStatus = StatusConnecting
	}
	if len(updates) > 0 {
		args = append(args, nodeID)
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET `+strings.Join(updates, ", ")+` WHERE id = ?`, args...); err != nil {
			if isUniqueConstraint(err) {
				return NodeResponse{}, typedError(ErrorConflict, "Node name already exists")
			}
			return NodeResponse{}, err
		}
	}
	if (connectionChanged || statusReconnectRequested) && finalStatus != StatusDisabled && finalStatus != StatusLimited {
		if err := r.enqueueNodeOperationTx(ctx, tx, NodeOperationSyncConfig, &nodeID, nil, map[string]any{"node_id": nodeID}, r.now().UTC()); err != nil {
			return NodeResponse{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return NodeResponse{}, err
	}
	node, err := r.GetNode(ctx, nodeID)
	if err != nil {
		return NodeResponse{}, err
	}
	return node, nil
}

func (r Repository) DeleteNode(ctx context.Context, nodeID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer rollbackQuiet(tx)
	if _, err := r.getNode(ctx, tx, nodeID, ""); err != nil {
		return err
	}
	for _, stmt := range []string{
		`DELETE FROM node_operations WHERE node_id = ?`,
		`DELETE FROM node_usage_user_queue WHERE node_id = ?`,
		`DELETE FROM node_usage_outbound_queue WHERE node_id = ?`,
		`DELETE FROM vpn_user_sessions WHERE node_id = ?`,
		`DELETE FROM user_online_ips WHERE node_id = ?`,
		`DELETE FROM node_usages WHERE node_id = ?`,
		`DELETE FROM node_user_usages WHERE node_id = ?`,
		`DELETE FROM outbound_traffic WHERE node_id = ?`,
		`DELETE FROM nodes WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, stmt, nodeID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r Repository) ResetNodeUsage(ctx context.Context, nodeID int64) (NodeResponse, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeResponse{}, err
	}
	defer rollbackQuiet(tx)
	if _, err := r.getNode(ctx, tx, nodeID, ""); err != nil {
		return NodeResponse{}, err
	}
	for _, stmt := range []string{
		`DELETE FROM node_usages WHERE node_id = ?`,
		`DELETE FROM node_user_usages WHERE node_id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, stmt, nodeID); err != nil {
			return NodeResponse{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET uplink = 0, downlink = 0, status = ?, message = NULL WHERE id = ?`, StatusConnected, nodeID); err != nil {
		return NodeResponse{}, err
	}
	if err := r.enqueueNodeOperationTx(ctx, tx, NodeOperationSyncConfig, &nodeID, nil, map[string]any{"node_id": nodeID, "usage_reset": true}, r.now().UTC()); err != nil {
		return NodeResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeResponse{}, err
	}
	node, err := r.GetNode(ctx, nodeID)
	if err != nil {
		return NodeResponse{}, err
	}
	return node, nil
}

func (r Repository) RegenerateNodeCertificate(ctx context.Context, nodeID int64) (NodeResponse, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeResponse{}, err
	}
	defer rollbackQuiet(tx)
	if _, err := r.getNode(ctx, tx, nodeID, ""); err != nil {
		return NodeResponse{}, err
	}
	cn, err := GenerateUniqueCN()
	if err != nil {
		return NodeResponse{}, err
	}
	cert, key, err := GenerateCertificate(cn)
	if err != nil {
		return NodeResponse{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET certificate = ?, certificate_key = ? WHERE id = ?`, cert, key, nodeID); err != nil {
		return NodeResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeResponse{}, err
	}
	node, err := r.GetNode(ctx, nodeID)
	if err != nil {
		return NodeResponse{}, err
	}
	node.NodeCertificateKey = &key
	return node, nil
}

func (r Repository) DeleteExpiredPendingCertificates(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM pending_node_certificates WHERE expires_at <= ?`, dbTimestamp(r.now().UTC()))
	return err
}

func (r Repository) createPendingCertificateTx(ctx context.Context, tx *sql.Tx, ttl time.Duration) (PendingNodeCertificate, error) {
	now := r.now().UTC()
	if _, err := tx.ExecContext(ctx, `DELETE FROM pending_node_certificates WHERE expires_at <= ?`, dbTimestamp(now)); err != nil {
		return PendingNodeCertificate{}, err
	}
	token, err := randomToken()
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	cn, err := GenerateUniqueCN()
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	cert, key, err := GenerateCertificate(cn)
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	expiresAt := now.Add(ttl)
	res, err := tx.ExecContext(
		ctx,
		`INSERT INTO pending_node_certificates (token, certificate, certificate_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		token,
		cert,
		key,
		dbTimestamp(expiresAt),
		dbTimestamp(now),
	)
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	id, _ := res.LastInsertId()
	return PendingNodeCertificate{ID: id, Token: token, Certificate: cert, CertificateKey: key, ExpiresAt: expiresAt, CreatedAt: now}, nil
}

func (r Repository) certificateForCreateTx(ctx context.Context, tx *sql.Tx, nodeID int64, payload NodeCreate) (string, string, error) {
	if payload.CertificateToken != nil && strings.TrimSpace(*payload.CertificateToken) != "" {
		pending, err := r.consumePendingCertificateTx(ctx, tx, strings.TrimSpace(*payload.CertificateToken))
		if err != nil {
			return "", "", err
		}
		return pending.Certificate, pending.CertificateKey, nil
	}
	if payload.Certificate != nil && strings.TrimSpace(*payload.Certificate) != "" && payload.CertificateKey != nil && strings.TrimSpace(*payload.CertificateKey) != "" {
		return strings.TrimSpace(*payload.Certificate), strings.TrimSpace(*payload.CertificateKey), nil
	}
	cn, err := GenerateUniqueCN()
	if err != nil {
		return "", "", err
	}
	return GenerateCertificate(cn)
}

func (r Repository) consumePendingCertificateTx(ctx context.Context, tx *sql.Tx, token string) (PendingNodeCertificate, error) {
	now := r.now().UTC()
	if _, err := tx.ExecContext(ctx, `DELETE FROM pending_node_certificates WHERE expires_at <= ?`, dbTimestamp(now)); err != nil {
		return PendingNodeCertificate{}, err
	}
	var row PendingNodeCertificate
	var expiresAt, createdAt string
	err := tx.QueryRowContext(
		ctx,
		`SELECT id, token, certificate, certificate_key, expires_at, created_at FROM pending_node_certificates WHERE token = ? LIMIT 1`,
		token,
	).Scan(&row.ID, &row.Token, &row.Certificate, &row.CertificateKey, &expiresAt, &createdAt)
	if err == sql.ErrNoRows {
		return PendingNodeCertificate{}, typedError(ErrorExpired, "certificate token expired or not found")
	}
	if err != nil {
		return PendingNodeCertificate{}, err
	}
	if parsed, err := parseDBTime(expiresAt); err == nil {
		row.ExpiresAt = parsed
		if !parsed.After(now) {
			return PendingNodeCertificate{}, typedError(ErrorExpired, "certificate token expired")
		}
	}
	if parsed, err := parseDBTime(createdAt); err == nil {
		row.CreatedAt = parsed
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM pending_node_certificates WHERE id = ?`, row.ID); err != nil {
		return PendingNodeCertificate{}, err
	}
	return row, nil
}

func (r Repository) nodeStoredXrayConfigExistsTx(ctx context.Context, tx *sql.Tx, nodeID int64) (bool, error) {
	var raw sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT xray_config FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&raw)
	if err == nil {
		return raw.Valid && strings.TrimSpace(raw.String) != "", nil
	}
	if isMissingColumnError(err) {
		return false, nil
	}
	return false, err
}
func (r Repository) getNode(ctx context.Context, q queryer, nodeID int64, defaultCert string) (NodeResponse, error) {
	var row NodeResponse
	var dataLimit, proxyPort sql.NullInt64
	var note, proxyType, proxyHost, proxyUsername, proxyPassword, message, xrayVersion, cert sql.NullString
	var proxyEnabled bool
	err := q.QueryRowContext(ctx, `SELECT
	id, COALESCE(name, ''), note, address, port, api_port, usage_coefficient, data_limit,
	proxy_enabled, proxy_type, proxy_host, proxy_port,
	proxy_username, proxy_password, status, message, xray_version,
	COALESCE(geo_mode, 'default'), COALESCE(xray_config_mode, 'default'),
	COALESCE(uplink, 0), COALESCE(downlink, 0), certificate
FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(
		&row.ID, &row.Name, &note, &row.Address, &row.Port, &row.APIPort, &row.UsageCoefficient, &dataLimit,
		&proxyEnabled, &proxyType, &proxyHost, &proxyPort,
		&proxyUsername, &proxyPassword, &row.Status, &message, &xrayVersion,
		&row.GeoMode, &row.XrayConfigMode, &row.Uplink, &row.Downlink, &cert,
	)
	if err == sql.ErrNoRows {
		return NodeResponse{}, typedError(ErrorNotFound, "Node not found")
	}
	if err != nil {
		return NodeResponse{}, err
	}
	if row.UsageCoefficient <= 0 {
		row.UsageCoefficient = 1
	}
	row.Note = stringPtrFromNull(note)
	row.DataLimit = int64PtrFromNull(dataLimit)
	row.ProxyEnabled = proxyEnabled
	row.ProxyType = stringPtrFromNull(proxyType)
	row.ProxyHost = stringPtrFromNull(proxyHost)
	row.ProxyPort = int64PtrFromNull(proxyPort)
	row.ProxyUsername = stringPtrFromNull(proxyUsername)
	row.ProxyPassword = stringPtrFromNull(proxyPassword)
	row.Message = stringPtrFromNull(message)
	row.XrayVersion = stringPtrFromNull(xrayVersion)
	if cert.Valid && strings.TrimSpace(cert.String) != "" {
		certValue := strings.TrimSpace(cert.String)
		row.NodeCertificate = &certValue
		if strings.TrimSpace(defaultCert) != "" && strings.TrimSpace(defaultCert) == certValue {
			row.UsesDefaultCertificate = true
		} else {
			row.HasCustomCertificate = true
			if publicKey, err := ExtractPublicKeyFromCertificate(certValue); err == nil {
				row.CertificatePublicKey = &publicKey
			}
		}
	} else {
		row.UsesDefaultCertificate = true
	}
	return row, nil
}

func (r Repository) tls(ctx context.Context) (tlsRow, error) {
	var row tlsRow
	err := r.db.QueryRowContext(ctx, `SELECT certificate, `+"`key`"+` FROM tls ORDER BY id LIMIT 1`).Scan(&row.Certificate, &row.Key)
	return row, err
}

func (r Repository) ensureNodeNameAvailableTx(ctx context.Context, tx *sql.Tx, name string, exceptID int64) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return wrapInvalid("name is required")
	}
	var existing int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM nodes WHERE name = ? LIMIT 1`, name).Scan(&existing)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if exceptID > 0 && existing == exceptID {
		return nil
	}
	return typedError(ErrorConflict, fmt.Sprintf(`Node "%s" already exists`, name))
}

func (r Repository) enqueueNodeOperationTx(ctx context.Context, tx *sql.Tx, operationType string, nodeID *int64, userID *int64, payload any, now time.Time) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	key, err := randomToken()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nullableInt64Ptr(nodeID),
		nullableInt64Ptr(userID),
		string(payloadBytes),
		key,
		dbTimestamp(now),
		dbTimestamp(now),
	)
	return err
}

type tlsRow struct {
	Certificate string
	Key         string
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func validateNodeCreate(payload NodeCreate) error {
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		return wrapInvalid("name is required")
	}
	if len([]rune(name)) > MaxNodeNameLength {
		return wrapInvalid("name can be a maximum of %d characters", MaxNodeNameLength)
	}
	if payload.Note != nil && len([]rune(strings.TrimSpace(*payload.Note))) > MaxNodeNoteLength {
		return wrapInvalid("note can be a maximum of %d characters", MaxNodeNoteLength)
	}
	if strings.TrimSpace(payload.Address) == "" {
		return wrapInvalid("address is required")
	}
	if payload.Port <= 0 {
		payload.Port = 62050
	}
	if payload.APIPort <= 0 {
		payload.APIPort = 62051
	}
	if payload.UsageCoefficient < 0 {
		return wrapInvalid("usage_coefficient must be greater than zero")
	}
	if payload.ProxyEnabled {
		if payload.ProxyType == nil || strings.TrimSpace(string(*payload.ProxyType)) == "" {
			return wrapInvalid("proxy_type is required when proxy is enabled")
		}
		if payload.ProxyHost == nil || strings.TrimSpace(*payload.ProxyHost) == "" {
			return wrapInvalid("proxy_host is required when proxy is enabled")
		}
		if payload.ProxyPort == nil || *payload.ProxyPort <= 0 || *payload.ProxyPort > 65535 {
			return wrapInvalid("proxy_port must be between 1 and 65535")
		}
	}
	return nil
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func dbTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05.999999")
}

func parseDBTime(value string) (time.Time, error) {
	for _, layout := range []string{
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid timestamp")
}

func rollbackQuiet(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func defaultInt(value int, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func defaultFloat(value float64, fallback float64) float64 {
	if value <= 0 {
		return fallback
	}
	return value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableInt64Ptr(value *int64) any {
	if value == nil || *value == 0 {
		return nil
	}
	return *value
}

func nullableInt64PtrIf(value *int64, ok bool) any {
	if !ok {
		return nil
	}
	return nullableInt64Ptr(value)
}

func nullableStringPtr(value *string, ok bool) any {
	if !ok || value == nil {
		return nil
	}
	return emptyStringAsNil(*value)
}

func nullableProxyType(value *NodeProxyType, ok bool) any {
	if !ok || value == nil {
		return nil
	}
	return emptyStringAsNil(string(*value))
}

func emptyStringAsNil(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 || strings.TrimSpace(string(value)) == "" || strings.TrimSpace(string(value)) == "null" {
		return nil
	}
	return string(value)
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

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func int64PtrFromNull(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func isMissingColumnError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "no such column") || strings.Contains(lower, "unknown column")
}
func isUniqueConstraint(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "unique") || strings.Contains(lower, "duplicate")
}
