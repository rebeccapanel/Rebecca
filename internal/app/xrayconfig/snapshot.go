package xrayconfig

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// MutationRecorder is invoked inside the same transaction as an Xray, inbound,
// or host mutation. Callers can leave it nil when no action history is needed.
type MutationRecorder func(context.Context, *sql.Tx, Mutation) error

// RollbackMarker updates the source action in the same transaction as its restore.
type RollbackMarker func(context.Context, *sql.Tx, int64) error

type Mutation struct {
	ActionType   string
	ResourceType string
	ResourceKey  string
	Summary      string
	Before       MutationSnapshot
	After        MutationSnapshot
}

// MutationSnapshot deliberately captures only the resources touched by one
// logical change. It is also the rollback boundary and concurrency-check scope.
type MutationSnapshot struct {
	Version      int                    `json:"version"`
	TargetStates []TargetState          `json:"target_states,omitempty"`
	InboundTag   string                 `json:"inbound_tag,omitempty"`
	Inbound      *InboundRecordSnapshot `json:"inbound,omitempty"`
	HostTags     []string               `json:"host_tags,omitempty"`
	Hosts        []HostSnapshot         `json:"hosts,omitempty"`
	ServiceHosts []ServiceHostSnapshot  `json:"service_hosts,omitempty"`
}

type TargetState struct {
	TargetID        string         `json:"target_id"`
	Mode            string         `json:"mode"`
	HasStoredConfig bool           `json:"has_stored_config"`
	StoredConfig    map[string]any `json:"stored_config,omitempty"`
}

type InboundRecordSnapshot struct {
	ID               int64   `json:"id"`
	Tag              string  `json:"tag"`
	Uplink           int64   `json:"uplink,omitempty"`
	Downlink         int64   `json:"downlink,omitempty"`
	UsageCoefficient float64 `json:"usage_coefficient,omitempty"`
}

type HostSnapshot struct {
	ID              int64   `json:"id"`
	InboundTag      string  `json:"inbound_tag"`
	Remark          string  `json:"remark"`
	Address         string  `json:"address"`
	DNSPrimary      string  `json:"dns_primary"`
	DNSSecondary    string  `json:"dns_secondary"`
	AddressOptions  *string `json:"address_options,omitempty"`
	AddressMode     string  `json:"address_selection_mode"`
	AddressTTL      *int64  `json:"address_ttl_seconds,omitempty"`
	Port            *int64  `json:"port,omitempty"`
	Path            *string `json:"path,omitempty"`
	SNI             *string `json:"sni,omitempty"`
	SNIOptions      *string `json:"sni_options,omitempty"`
	SNIMode         string  `json:"sni_selection_mode"`
	SNITTL          *int64  `json:"sni_ttl_seconds,omitempty"`
	Host            *string `json:"host,omitempty"`
	HostOptions     *string `json:"host_options,omitempty"`
	HostMode        string  `json:"host_selection_mode"`
	HostTTL         *int64  `json:"host_ttl_seconds,omitempty"`
	Security        string  `json:"security"`
	ALPN            string  `json:"alpn"`
	Fingerprint     string  `json:"fingerprint"`
	AllowInsecure   *bool   `json:"allowinsecure,omitempty"`
	IsDisabled      bool    `json:"is_disabled"`
	MuxEnable       bool    `json:"mux_enable"`
	FragmentSetting *string `json:"fragment_setting,omitempty"`
	NoiseSetting    *string `json:"noise_setting,omitempty"`
	FinalMask       *string `json:"finalmask,omitempty"`
	RandomUserAgent bool    `json:"random_user_agent"`
	UseSNIAsHost    bool    `json:"use_sni_as_host"`
}

type ServiceHostSnapshot struct {
	ServiceID int64 `json:"service_id"`
	HostID    int64 `json:"host_id"`
	Sort      int64 `json:"sort"`
}

type SnapshotScope struct {
	TargetIDs  []string
	InboundTag string
	HostTags   []string
}

var ErrRollbackConflict = errors.New("recent action is no longer the current state")

func SnapshotHash(snapshot MutationSnapshot) (string, error) {
	hashable := snapshot
	if snapshot.Inbound != nil {
		inbound := *snapshot.Inbound
		inbound.Uplink = 0
		inbound.Downlink = 0
		hashable.Inbound = &inbound
	}
	raw, err := json.Marshal(hashable)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (r Repository) CaptureMutationSnapshotTx(ctx context.Context, tx *sql.Tx, scope SnapshotScope) (MutationSnapshot, error) {
	scope = normalizeSnapshotScope(scope)
	snapshot := MutationSnapshot{
		Version:    1,
		InboundTag: scope.InboundTag,
		HostTags:   scope.HostTags,
	}
	for _, targetID := range scope.TargetIDs {
		state, err := r.targetStateTx(ctx, tx, targetID)
		if err != nil {
			return MutationSnapshot{}, err
		}
		snapshot.TargetStates = append(snapshot.TargetStates, state)
	}
	if scope.InboundTag != "" {
		var record InboundRecordSnapshot
		err := tx.QueryRowContext(ctx, `SELECT id, tag, uplink, downlink, COALESCE(usage_coefficient, 1) FROM inbounds WHERE tag = ? LIMIT 1`, scope.InboundTag).Scan(&record.ID, &record.Tag, &record.Uplink, &record.Downlink, &record.UsageCoefficient)
		switch {
		case err == nil:
			snapshot.Inbound = &record
		case errors.Is(err, sql.ErrNoRows):
		default:
			return MutationSnapshot{}, err
		}
	}
	if len(scope.HostTags) == 0 {
		return snapshot, nil
	}
	placeholders := sqlPlaceholders(len(scope.HostTags))
	args := stringSliceToAny(scope.HostTags)
	rows, err := tx.QueryContext(ctx, `SELECT id, inbound_tag, remark, address, COALESCE(dns_primary, ''), COALESCE(dns_secondary, ''),
		address_options, COALESCE(address_selection_mode, 'random'), address_ttl_seconds, port, 0,
		path, sni, sni_options, COALESCE(sni_selection_mode, 'random'), sni_ttl_seconds,
		host, host_options, COALESCE(host_selection_mode, 'random'), host_ttl_seconds,
		COALESCE(security, 'inbound_default'), COALESCE(alpn, 'none'), COALESCE(fingerprint, 'none'),
		allowinsecure, COALESCE(is_disabled, 0), COALESCE(mux_enable, 0), fragment_setting, noise_setting, finalmask,
		COALESCE(random_user_agent, 0), COALESCE(use_sni_as_host, 0)
		FROM hosts WHERE inbound_tag IN (`+placeholders+`) ORDER BY inbound_tag ASC, id ASC`, args...)
	if err != nil {
		return MutationSnapshot{}, err
	}
	defer rows.Close()
	for rows.Next() {
		host, err := scanHostSnapshot(rows)
		if err != nil {
			return MutationSnapshot{}, err
		}
		snapshot.Hosts = append(snapshot.Hosts, host)
	}
	if err := rows.Err(); err != nil {
		return MutationSnapshot{}, err
	}
	if len(snapshot.Hosts) == 0 {
		return snapshot, nil
	}
	hostIDs := make([]int64, 0, len(snapshot.Hosts))
	for _, host := range snapshot.Hosts {
		hostIDs = append(hostIDs, host.ID)
	}
	serviceRows, err := tx.QueryContext(ctx, `SELECT service_id, host_id, COALESCE(sort, 0) FROM service_hosts WHERE host_id IN (`+sqlPlaceholders(len(hostIDs))+`) ORDER BY service_id ASC, host_id ASC`, int64SliceToAny(hostIDs)...)
	if err != nil {
		return MutationSnapshot{}, err
	}
	defer serviceRows.Close()
	for serviceRows.Next() {
		var link ServiceHostSnapshot
		if err := serviceRows.Scan(&link.ServiceID, &link.HostID, &link.Sort); err != nil {
			return MutationSnapshot{}, err
		}
		snapshot.ServiceHosts = append(snapshot.ServiceHosts, link)
	}
	return snapshot, serviceRows.Err()
}

func (r Repository) captureMutationForRecordTx(ctx context.Context, tx *sql.Tx, scope SnapshotScope) (MutationSnapshot, error) {
	if r.options.MutationRecorder == nil {
		return MutationSnapshot{}, nil
	}
	return r.CaptureMutationSnapshotTx(ctx, tx, scope)
}

func (r Repository) RestoreMutationSnapshot(ctx context.Context, originalActionID int64, expectedAfterHash string, before MutationSnapshot, configPatches []ConfigPatch) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer rollbackQuietly(tx)
	current, err := r.CaptureMutationSnapshotTx(ctx, tx, snapshotScopeFromSnapshot(before))
	if err != nil {
		return err
	}
	currentHash, err := SnapshotHash(current)
	if err != nil {
		return err
	}
	if currentHash != expectedAfterHash {
		return ErrRollbackConflict
	}
	targetIDs := []string{}
	if len(configPatches) > 0 {
		targetIDs, err = r.restoreConfigPatchesTx(ctx, tx, configPatches)
	} else {
		targetIDs, err = r.restoreLegacyTargetStatesTx(ctx, tx, before.TargetStates)
	}
	if err != nil {
		return err
	}
	if err := r.restoreMutationSnapshotTx(ctx, tx, before, current, targetIDs); err != nil {
		return err
	}
	if r.options.RollbackMarker != nil {
		if err := r.options.RollbackMarker(ctx, tx, originalActionID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r Repository) recordMutationTx(ctx context.Context, tx *sql.Tx, mutation Mutation) error {
	if r.options.MutationRecorder == nil {
		return nil
	}
	beforeHash, err := SnapshotHash(mutation.Before)
	if err != nil {
		return err
	}
	afterHash, err := SnapshotHash(mutation.After)
	if err != nil {
		return err
	}
	if beforeHash == afterHash {
		return nil
	}
	return r.options.MutationRecorder(ctx, tx, mutation)
}

func (r Repository) targetStateTx(ctx context.Context, tx *sql.Tx, targetID string) (TargetState, error) {
	kind, nodeID, err := ParseTargetID(targetID)
	if err != nil {
		return TargetState{}, err
	}
	if kind == MasterTargetID {
		config, err := r.masterRawConfigTx(ctx, tx)
		if err != nil {
			return TargetState{}, err
		}
		return TargetState{TargetID: MasterTargetID, Mode: ConfigModeCustom, HasStoredConfig: true, StoredConfig: NormalizePayload(config)}, nil
	}
	if nodeID == nil {
		return TargetState{}, ErrInvalidTarget
	}
	var raw any
	var mode string
	if err := tx.QueryRowContext(ctx, `SELECT xray_config, COALESCE(xray_config_mode, 'default') FROM nodes WHERE id = ? AND LOWER(COALESCE(status, '')) <> 'deleted' LIMIT 1`, *nodeID).Scan(&raw, &mode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return TargetState{}, fmt.Errorf("node not found")
		}
		return TargetState{}, err
	}
	state := TargetState{TargetID: NodeTargetID(*nodeID), Mode: normalizeConfigMode(mode), HasStoredConfig: raw != nil}
	if state.HasStoredConfig {
		state.StoredConfig = NormalizePayload(jsonMap(raw))
	}
	return state, nil
}

func (r Repository) restoreLegacyTargetStatesTx(ctx context.Context, tx *sql.Tx, targets []TargetState) ([]string, error) {
	targetIDs := make([]string, 0, len(targets))
	for _, target := range targets {
		kind, nodeID, err := ParseTargetID(target.TargetID)
		if err != nil {
			return nil, err
		}
		if kind == MasterTargetID {
			if err := r.saveMasterRawConfigTx(ctx, tx, target.StoredConfig); err != nil {
				return nil, err
			}
			targetIDs = append(targetIDs, target.TargetID)
			continue
		}
		if nodeID == nil {
			return nil, ErrInvalidTarget
		}
		if err := r.ensureNodeExistsTx(ctx, tx, *nodeID); err != nil {
			return nil, err
		}
		var raw any
		if target.HasStoredConfig {
			encoded, err := json.Marshal(NormalizePayload(target.StoredConfig))
			if err != nil {
				return nil, err
			}
			raw = string(encoded)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET xray_config_mode = ?, xray_config = ? WHERE id = ? AND LOWER(COALESCE(status, '')) <> 'deleted'`, normalizeConfigMode(target.Mode), raw, *nodeID); err != nil {
			return nil, err
		}
		targetIDs = append(targetIDs, target.TargetID)
	}
	return uniqueSortedStrings(targetIDs), nil
}

func (r Repository) restoreConfigPatchesTx(ctx context.Context, tx *sql.Tx, patches []ConfigPatch) ([]string, error) {
	targetIDs := make([]string, 0, len(patches))
	states := make([]TargetState, 0, len(patches))
	for _, patch := range patches {
		if !patch.Valid() {
			return nil, errors.New("unsupported Xray config patch")
		}
		current, err := r.targetStateTx(ctx, tx, patch.TargetID)
		if err != nil {
			return nil, err
		}
		restored, err := ApplyConfigPatch(current, patch)
		if err != nil {
			return nil, err
		}
		if restored.HasStoredConfig {
			if _, err := Parse(restored.StoredConfig, r.options); err != nil {
				return nil, &RollbackValidationError{Err: err}
			}
			if err := ValidateCertificateFiles(restored.StoredConfig); err != nil {
				return nil, &RollbackValidationError{Err: err}
			}
		}
		states = append(states, restored)
	}
	for _, target := range states {
		kind, nodeID, err := ParseTargetID(target.TargetID)
		if err != nil {
			return nil, err
		}
		if kind == MasterTargetID {
			if !target.HasStoredConfig {
				return nil, errors.New("master Xray config cannot be empty")
			}
			if err := r.saveMasterRawConfigTx(ctx, tx, target.StoredConfig); err != nil {
				return nil, err
			}
			targetIDs = append(targetIDs, target.TargetID)
			continue
		}
		if nodeID == nil {
			return nil, ErrInvalidTarget
		}
		if err := r.ensureNodeExistsTx(ctx, tx, *nodeID); err != nil {
			return nil, err
		}
		var raw any
		if target.HasStoredConfig {
			encoded, err := json.Marshal(NormalizePayload(target.StoredConfig))
			if err != nil {
				return nil, err
			}
			raw = string(encoded)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE nodes SET xray_config_mode = ?, xray_config = ? WHERE id = ? AND LOWER(COALESCE(status, '')) <> 'deleted'`, normalizeConfigMode(target.Mode), raw, *nodeID); err != nil {
			return nil, err
		}
		targetIDs = append(targetIDs, target.TargetID)
	}
	return uniqueSortedStrings(targetIDs), nil
}

func (r Repository) restoreMutationSnapshotTx(ctx context.Context, tx *sql.Tx, snapshot MutationSnapshot, current MutationSnapshot, targetIDs []string) error {
	if err := restoreInboundHostsTx(ctx, tx, snapshot, current); err != nil {
		return err
	}
	if len(targetIDs) > 0 {
		if err := r.enqueueSyncForTargetsTx(ctx, tx, targetIDs); err != nil {
			return err
		}
	}
	serviceIDs := snapshotServiceIDs(append(append([]ServiceHostSnapshot(nil), snapshot.ServiceHosts...), current.ServiceHosts...))
	if len(serviceIDs) > 0 {
		if err := r.enqueueAffectedServiceUsersTx(ctx, tx, serviceIDs); err != nil {
			return err
		}
	}
	return nil
}

func restoreInboundHostsTx(ctx context.Context, tx *sql.Tx, snapshot MutationSnapshot, current MutationSnapshot) error {
	if len(snapshot.HostTags) == 0 && snapshot.InboundTag == "" {
		return nil
	}
	tags := append([]string(nil), snapshot.HostTags...)
	if snapshot.InboundTag != "" {
		tags = append(tags, snapshot.InboundTag)
	}
	tags = uniqueSortedStrings(tags)
	placeholders := sqlPlaceholders(len(tags))
	args := stringSliceToAny(tags)
	if _, err := tx.ExecContext(ctx, `DELETE FROM service_hosts WHERE host_id IN (SELECT id FROM hosts WHERE inbound_tag IN (`+placeholders+`))`, args...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM hosts WHERE inbound_tag IN (`+placeholders+`)`, args...); err != nil {
		return err
	}
	if snapshot.InboundTag != "" {
		if _, err := tx.ExecContext(ctx, `DELETE FROM inbounds WHERE tag = ?`, snapshot.InboundTag); err != nil {
			return err
		}
		if snapshot.Inbound != nil {
			uplink, downlink := snapshot.Inbound.Uplink, snapshot.Inbound.Downlink
			if current.Inbound != nil {
				uplink, downlink = current.Inbound.Uplink, current.Inbound.Downlink
			}
			coefficient := normalizedInboundUsageCoefficient(snapshot.Inbound.UsageCoefficient)
			if _, err := tx.ExecContext(ctx, `INSERT INTO inbounds (id, tag, uplink, downlink, usage_coefficient) VALUES (?, ?, ?, ?, ?)`, snapshot.Inbound.ID, snapshot.Inbound.Tag, uplink, downlink, coefficient); err != nil {
				return err
			}
		}
	}
	for _, host := range snapshot.Hosts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO hosts (
			id, inbound_tag, remark, address, dns_primary, dns_secondary, address_options, address_selection_mode, address_ttl_seconds,
			port, path, sni, sni_options, sni_selection_mode, sni_ttl_seconds, host, host_options, host_selection_mode,
			host_ttl_seconds, security, alpn, fingerprint, allowinsecure, is_disabled, mux_enable, fragment_setting, noise_setting, finalmask,
			random_user_agent, use_sni_as_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			host.ID, host.InboundTag, host.Remark, host.Address, host.DNSPrimary, host.DNSSecondary, nullableString(host.AddressOptions), host.AddressMode, nullableInt64(host.AddressTTL), nullableInt64(host.Port), nullableString(host.Path), nullableString(host.SNI), nullableString(host.SNIOptions), host.SNIMode, nullableInt64(host.SNITTL), nullableString(host.Host), nullableString(host.HostOptions), host.HostMode, nullableInt64(host.HostTTL), host.Security, host.ALPN, host.Fingerprint, nullableBool(host.AllowInsecure), boolToDB(host.IsDisabled), boolToDB(host.MuxEnable), nullableString(host.FragmentSetting), nullableString(host.NoiseSetting), nullableString(host.FinalMask), boolToDB(host.RandomUserAgent), boolToDB(host.UseSNIAsHost)); err != nil {
			return err
		}
	}
	for _, link := range snapshot.ServiceHosts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO service_hosts (service_id, host_id, sort) VALUES (?, ?, ?)`, link.ServiceID, link.HostID, link.Sort); err != nil {
			return err
		}
	}
	return nil
}

func snapshotScopeFromSnapshot(snapshot MutationSnapshot) SnapshotScope {
	scope := SnapshotScope{InboundTag: snapshot.InboundTag, HostTags: append([]string(nil), snapshot.HostTags...)}
	for _, target := range snapshot.TargetStates {
		scope.TargetIDs = append(scope.TargetIDs, target.TargetID)
	}
	return normalizeSnapshotScope(scope)
}

func normalizeSnapshotScope(scope SnapshotScope) SnapshotScope {
	scope.TargetIDs = uniqueSortedStrings(scope.TargetIDs)
	scope.HostTags = uniqueSortedStrings(scope.HostTags)
	scope.InboundTag = strings.TrimSpace(scope.InboundTag)
	return scope
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func snapshotServiceIDs(links []ServiceHostSnapshot) []int64 {
	set := make(map[int64]struct{}, len(links))
	for _, link := range links {
		if link.ServiceID > 0 {
			set[link.ServiceID] = struct{}{}
		}
	}
	result := make([]int64, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func scanHostSnapshot(scanner interface{ Scan(...any) error }) (HostSnapshot, error) {
	var host HostSnapshot
	var addressOptions, path, sni, sniOptions, hostValue, hostOptions, fragment, noise, finalMask sql.NullString
	var addressTTL, port, ignoredSort, sniTTL, hostTTL sql.NullInt64
	var allowInsecure sql.NullInt64
	var disabled, muxEnable, randomUA, useSNI int64
	err := scanner.Scan(&host.ID, &host.InboundTag, &host.Remark, &host.Address, &host.DNSPrimary, &host.DNSSecondary,
		&addressOptions, &host.AddressMode, &addressTTL, &port, &ignoredSort,
		&path, &sni, &sniOptions, &host.SNIMode, &sniTTL,
		&hostValue, &hostOptions, &host.HostMode, &hostTTL,
		&host.Security, &host.ALPN, &host.Fingerprint, &allowInsecure,
		&disabled, &muxEnable, &fragment, &noise, &finalMask, &randomUA, &useSNI)
	if err != nil {
		return HostSnapshot{}, err
	}
	host.AddressOptions = nullStringPtr(addressOptions)
	host.AddressTTL = nullInt64Ptr(addressTTL)
	host.Port = nullInt64Ptr(port)
	host.Path = nullStringPtr(path)
	host.SNI = nullStringPtr(sni)
	host.SNIOptions = nullStringPtr(sniOptions)
	host.SNITTL = nullInt64Ptr(sniTTL)
	host.Host = nullStringPtr(hostValue)
	host.HostOptions = nullStringPtr(hostOptions)
	host.HostTTL = nullInt64Ptr(hostTTL)
	host.FragmentSetting = nullStringPtr(fragment)
	host.NoiseSetting = nullStringPtr(noise)
	host.FinalMask = nullStringPtr(finalMask)
	if allowInsecure.Valid {
		value := allowInsecure.Int64 != 0
		host.AllowInsecure = &value
	}
	host.IsDisabled = disabled != 0
	host.MuxEnable = muxEnable != 0
	host.RandomUserAgent = randomUA != 0
	host.UseSNIAsHost = useSNI != 0
	return host, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func nullInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableBool(value *bool) any {
	if value == nil {
		return nil
	}
	return boolToDB(*value)
}

func boolToDB(value bool) int {
	if value {
		return 1
	}
	return 0
}

func stringSliceToAny(values []string) []any {
	result := make([]any, len(values))
	for i, value := range values {
		result[i] = value
	}
	return result
}
