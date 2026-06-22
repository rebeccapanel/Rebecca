package xrayconfig

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	MasterTargetID = "master"
	NodePrefix     = "node:"

	ConfigModeDefault = "default"
	ConfigModeCustom  = "custom"

	NodeOperationSyncConfig = "sync_config"
)

type Repository struct {
	db      *sql.DB
	dialect string
	options Options
}

type Target struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Name   string `json:"name"`
	NodeID *int64 `json:"node_id"`
	Mode   string `json:"mode"`
	Status string `json:"status,omitempty"`
}

type StoredConfig struct {
	TargetID string
	Config   map[string]any
}

func NewRepository(db *sql.DB, dialect string, options Options) Repository {
	if strings.TrimSpace(dialect) == "" {
		dialect = "sqlite"
	}
	return Repository{db: db, dialect: strings.ToLower(dialect), options: options}
}

func NodeTargetID(nodeID int64) string {
	return NodePrefix + strconv.FormatInt(nodeID, 10)
}

func ParseTargetID(targetID string) (string, *int64, error) {
	target := strings.TrimSpace(targetID)
	if target == "" || target == MasterTargetID {
		return MasterTargetID, nil, nil
	}
	if !strings.HasPrefix(target, NodePrefix) {
		return "", nil, fmt.Errorf("invalid Xray config target")
	}
	rawID := strings.TrimSpace(strings.TrimPrefix(target, NodePrefix))
	nodeID, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || nodeID <= 0 {
		return "", nil, fmt.Errorf("invalid Xray config target")
	}
	return strings.TrimSuffix(NodePrefix, ":"), &nodeID, nil
}

func (r Repository) GetTargetRawConfig(ctx context.Context, targetID string) (map[string]any, error) {
	kind, nodeID, err := ParseTargetID(targetID)
	if err != nil {
		return nil, err
	}
	master, err := r.MasterRawConfig(ctx)
	if err != nil {
		return nil, err
	}
	if kind == MasterTargetID {
		return master, nil
	}
	return r.NodeEffectiveRawConfig(ctx, *nodeID, master)
}

func (r Repository) SaveTargetRawConfig(ctx context.Context, targetID string, payload map[string]any) (map[string]any, error) {
	kind, nodeID, err := ParseTargetID(targetID)
	if err != nil {
		return nil, err
	}
	normalized := NormalizePayload(payload)
	if _, err := Parse(normalized, r.options); err != nil {
		return nil, err
	}
	if err := ValidateCertificateFiles(normalized); err != nil {
		return nil, err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer rollbackQuietly(tx)

	if kind == MasterTargetID {
		if err := r.saveMasterRawConfigTx(ctx, tx, normalized); err != nil {
			return nil, err
		}
		if err := r.enqueueSyncConfigTx(ctx, tx, nil, map[string]any{"target_id": MasterTargetID}); err != nil {
			return nil, err
		}
	} else {
		if err := r.ensureNodeExistsTx(ctx, tx, *nodeID); err != nil {
			return nil, err
		}
		if err := r.saveNodeRawConfigTx(ctx, tx, *nodeID, normalized); err != nil {
			return nil, err
		}
		if err := r.enqueueSyncConfigTx(ctx, tx, nodeID, map[string]any{"target_id": NodeTargetID(*nodeID)}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return NormalizePayload(normalized), nil
}

func (r Repository) SetNodeConfigMode(ctx context.Context, nodeID int64, mode string) error {
	normalizedMode := strings.ToLower(strings.TrimSpace(mode))
	if normalizedMode != ConfigModeDefault && normalizedMode != ConfigModeCustom {
		return fmt.Errorf("invalid Xray config mode")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer rollbackQuietly(tx)

	if err := r.ensureNodeExistsTx(ctx, tx, nodeID); err != nil {
		return err
	}
	if normalizedMode == ConfigModeCustom {
		master, err := r.masterRawConfigTx(ctx, tx)
		if err != nil {
			return err
		}
		raw, mode, err := r.nodeConfigFieldsTx(ctx, tx, nodeID)
		if err != nil {
			return err
		}
		if mode != ConfigModeCustom || len(raw) == 0 {
			if err := r.saveNodeRawConfigTx(ctx, tx, nodeID, master); err != nil {
				return err
			}
		} else if err := r.setNodeModeTx(ctx, tx, nodeID, ConfigModeCustom); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET xray_config_mode = ?, xray_config = NULL WHERE id = ?`, ConfigModeDefault, nodeID); err != nil {
			return err
		}
	}
	if err := r.enqueueSyncConfigTx(ctx, tx, &nodeID, map[string]any{"target_id": NodeTargetID(nodeID), "mode": normalizedMode}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r Repository) MasterRawConfig(ctx context.Context) (map[string]any, error) {
	var raw any
	err := r.db.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1 LIMIT 1`).Scan(&raw)
	if err == sql.ErrNoRows {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	return NormalizePayload(jsonMap(raw)), nil
}

func (r Repository) NodeEffectiveRawConfig(ctx context.Context, nodeID int64, masterConfig map[string]any) (map[string]any, error) {
	raw, mode, err := r.nodeConfigFields(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	if mode == ConfigModeCustom && len(raw) > 0 {
		return NormalizePayload(raw), nil
	}
	return NormalizePayload(masterConfig), nil
}

func (r Repository) ListConfigTargets(ctx context.Context) ([]Target, error) {
	targets := []Target{{
		ID:   MasterTargetID,
		Type: "master",
		Name: "Master",
		Mode: ConfigModeCustom,
	}}
	rows, err := r.db.QueryContext(ctx, `SELECT id, COALESCE(name, ''), COALESCE(xray_config_mode, 'default'), COALESCE(status, '') FROM nodes ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var nodeID int64
		var name, mode, status string
		if err := rows.Scan(&nodeID, &name, &mode, &status); err != nil {
			return nil, err
		}
		id := nodeID
		targets = append(targets, Target{
			ID:     NodeTargetID(nodeID),
			Type:   "node",
			Name:   name,
			NodeID: &id,
			Mode:   normalizeConfigMode(mode),
			Status: status,
		})
	}
	return targets, rows.Err()
}

func (r Repository) IterStoredConfigs(ctx context.Context) ([]StoredConfig, error) {
	master, err := r.MasterRawConfig(ctx)
	if err != nil {
		return nil, err
	}
	result := []StoredConfig{{TargetID: MasterTargetID, Config: master}}
	rows, err := r.db.QueryContext(ctx, `SELECT id, xray_config FROM nodes WHERE xray_config_mode = 'custom' AND xray_config IS NOT NULL ORDER BY id`)
	if err != nil {
		return result, nil
	}
	defer rows.Close()
	for rows.Next() {
		var nodeID int64
		var raw any
		if err := rows.Scan(&nodeID, &raw); err != nil {
			return nil, err
		}
		parsed := NormalizePayload(jsonMap(raw))
		if len(parsed) > 0 {
			result = append(result, StoredConfig{TargetID: NodeTargetID(nodeID), Config: parsed})
		}
	}
	return result, rows.Err()
}

func (r Repository) CollectInboundTags(ctx context.Context) (map[string]struct{}, error) {
	configs, err := r.IterStoredConfigs(ctx)
	if err != nil {
		return nil, err
	}
	result := map[string]struct{}{}
	for _, config := range configs {
		for _, inbound := range listOfMaps(config.Config["inbounds"]) {
			if tag := stringValue(inbound["tag"]); tag != "" {
				result[tag] = struct{}{}
			}
		}
	}
	return result, nil
}

func (r Repository) CollectManageableInbounds(ctx context.Context) (map[string]ResolvedInbound, error) {
	configs, err := r.IterStoredConfigs(ctx)
	if err != nil {
		return nil, err
	}
	result := map[string]ResolvedInbound{}
	for _, item := range configs {
		cfg, err := Parse(item.Config, r.manageableParseOptions())
		if err != nil {
			return nil, err
		}
		for tag, inbound := range cfg.InboundsByTag() {
			if _, exists := result[tag]; !exists {
				result[tag] = inbound
			}
		}
	}
	return result, nil
}

func (r Repository) masterRawConfigTx(ctx context.Context, tx *sql.Tx) (map[string]any, error) {
	var raw any
	err := tx.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1 LIMIT 1`).Scan(&raw)
	if err == sql.ErrNoRows {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	return NormalizePayload(jsonMap(raw)), nil
}

func (r Repository) saveMasterRawConfigTx(ctx context.Context, tx *sql.Tx, payload map[string]any) error {
	raw, err := json.Marshal(NormalizePayload(payload))
	if err != nil {
		return err
	}
	now := dbTimestamp(time.Now().UTC())
	if r.dialect == "sqlite" {
		_, err = tx.ExecContext(ctx, `INSERT INTO xray_config (id, data, created_at, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, string(raw), now, now)
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO xray_config (id, data, created_at, updated_at) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`, string(raw), now, now)
	return err
}

func (r Repository) saveNodeRawConfigTx(ctx context.Context, tx *sql.Tx, nodeID int64, payload map[string]any) error {
	raw, err := json.Marshal(NormalizePayload(payload))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET xray_config_mode = ?, xray_config = ? WHERE id = ?`, ConfigModeCustom, string(raw), nodeID)
	return err
}

func (r Repository) setNodeModeTx(ctx context.Context, tx *sql.Tx, nodeID int64, mode string) error {
	_, err := tx.ExecContext(ctx, `UPDATE nodes SET xray_config_mode = ? WHERE id = ?`, mode, nodeID)
	return err
}

func (r Repository) ensureNodeExistsTx(ctx context.Context, tx *sql.Tx, nodeID int64) error {
	var existing int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&existing)
	if err == sql.ErrNoRows {
		return fmt.Errorf("node not found")
	}
	return err
}

func (r Repository) nodeConfigFields(ctx context.Context, nodeID int64) (map[string]any, string, error) {
	var raw any
	var mode string
	err := r.db.QueryRowContext(ctx, `SELECT xray_config, COALESCE(xray_config_mode, 'default') FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&raw, &mode)
	if err == sql.ErrNoRows {
		return nil, "", fmt.Errorf("node not found")
	}
	if err != nil {
		return nil, "", err
	}
	return jsonMap(raw), normalizeConfigMode(mode), nil
}

func (r Repository) nodeConfigFieldsTx(ctx context.Context, tx *sql.Tx, nodeID int64) (map[string]any, string, error) {
	var raw any
	var mode string
	err := tx.QueryRowContext(ctx, `SELECT xray_config, COALESCE(xray_config_mode, 'default') FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&raw, &mode)
	if err == sql.ErrNoRows {
		return nil, "", fmt.Errorf("node not found")
	}
	if err != nil {
		return nil, "", err
	}
	return jsonMap(raw), normalizeConfigMode(mode), nil
}

func (r Repository) enqueueSyncConfigTx(ctx context.Context, tx *sql.Tx, nodeID *int64, payload any) error {
	return enqueueNodeOperationTx(ctx, tx, NodeOperationSyncConfig, nodeID, nil, payload)
}

func enqueueNodeOperationTx(ctx context.Context, tx *sql.Tx, operationType string, nodeID *int64, userID *int64, payload any) error {
	nowTime := time.Now().UTC()
	if nodeID == nil && userID != nil && operationType != NodeOperationSyncConfig {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM nodes WHERE COALESCE(status, '') NOT IN ('disabled', 'limited') ORDER BY id`)
		if err != nil {
			return err
		}
		nodeIDs := []int64{}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			nodeIDs = append(nodeIDs, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if len(nodeIDs) > 0 {
			for _, id := range nodeIDs {
				targetNodeID := id
				if err := enqueueNodeOperationTx(ctx, tx, operationType, &targetNodeID, userID, payload); err != nil {
					return err
				}
			}
			return nil
		}
	}
	payload = operationPayloadWithQueuedAt(payload, nowTime)
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	keySource := fmt.Sprintf("%s:%s:%s:%s", operationType, ptrInt64Text(nodeID), ptrInt64Text(userID), string(payloadJSON))
	sum := sha256.Sum256([]byte(keySource))
	key := hex.EncodeToString(sum[:])
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, key).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	now := dbTimestamp(nowTime)
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nullableInt64(nodeID),
		nullableInt64(userID),
		string(payloadJSON),
		key,
		now,
		now,
	)
	return err
}

func operationPayloadWithQueuedAt(payload any, now time.Time) any {
	queuedAt := now.Format(time.RFC3339Nano)
	if payload == nil {
		return map[string]any{"queued_at": queuedAt}
	}
	mapped, ok := payload.(map[string]any)
	if !ok {
		return payload
	}
	cloned := make(map[string]any, len(mapped)+1)
	for key, value := range mapped {
		cloned[key] = value
	}
	if _, exists := cloned["queued_at"]; !exists {
		cloned["queued_at"] = queuedAt
	}
	return cloned
}

func jsonMap(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return map[string]any{}
	case []byte:
		return jsonMapBytes(typed)
	case string:
		return jsonMapBytes([]byte(typed))
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return map[string]any{}
		}
		return jsonMapBytes(raw)
	}
}

func jsonMapBytes(raw []byte) map[string]any {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func normalizeConfigMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case ConfigModeCustom:
		return ConfigModeCustom
	default:
		return ConfigModeDefault
	}
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func ptrInt64Text(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

func dbTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}

func rollbackQuietly(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}

func IsNodeNotFound(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "node not found")
}

var ErrInvalidTarget = errors.New("invalid Xray config target")
