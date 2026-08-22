package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

const (
	recentActionSnapshotLifetime = 30 * 24 * time.Hour
	recentActionHistoryLifetime  = 90 * 24 * time.Hour
	recentActionSnapshotMaxSize  = 1 << 20
	recentActionPreviewMaxSize   = 128 << 10
	recentActionHistoryMaxRows   = 1000
	recentActionListChunkSize    = 100
	recentActionLegacyBatchGap   = 10 * time.Minute
)

type recentActionSnapshot struct {
	Before            xrayconfig.MutationSnapshot `json:"before"`
	After             xrayconfig.MutationSnapshot `json:"after"`
	ConfigPatches     []xrayconfig.ConfigPatch    `json:"config_patches,omitempty"`
	ConfigPreviews    []recentActionConfigPreview `json:"config_previews,omitempty"`
	Changes           []recentActionValueChange   `json:"changes,omitempty"`
	AffectedResources []string                    `json:"affected_resources,omitempty"`
}

type recentActionValueChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
	Delta  string `json:"delta,omitempty"`
}

type recentActionConfigPreview struct {
	TargetID     string   `json:"target_id"`
	Path         string   `json:"path"`
	ChangedPaths []string `json:"changed_paths"`
	Before       any      `json:"before,omitempty"`
	After        any      `json:"after,omitempty"`
	BeforeExists bool     `json:"before_exists"`
	AfterExists  bool     `json:"after_exists"`
}

type recentActionItem struct {
	ID                int64                `json:"id"`
	ActionType        string               `json:"action_type"`
	ResourceType      string               `json:"resource_type"`
	ResourceKey       string               `json:"resource_key"`
	ActorAdminID      *int64               `json:"actor_admin_id,omitempty"`
	ActorUsername     string               `json:"actor_username"`
	AuthSource        string               `json:"auth_source"`
	Summary           string               `json:"summary"`
	RollbackStatus    string               `json:"rollback_status"`
	CreatedAt         string               `json:"created_at"`
	SnapshotExpiresAt *string              `json:"snapshot_expires_at,omitempty"`
	UndoneAt          *string              `json:"undone_at,omitempty"`
	UndoneByAdminID   *int64               `json:"undone_by_admin_id,omitempty"`
	Preview           *recentActionPreview `json:"preview,omitempty"`
	AffectedResources []string             `json:"affected_resources,omitempty"`
	cursorID          int64
	batchID           string
	groupSummary      string
	groupTailAt       string
	groupResources    map[string]struct{}
}

type recentActionPreview struct {
	Field     string `json:"field,omitempty"`
	Before    string `json:"before,omitempty"`
	After     string `json:"after,omitempty"`
	Delta     string `json:"delta,omitempty"`
	Operation string `json:"operation,omitempty"`
	Resource  string `json:"resource,omitempty"`
}

type recentActionListFilter struct {
	Search        string
	ActionTypes   []string
	ResourceTypes []string
	Statuses      []string
	CreatedFrom   string
	CreatedBefore string
}

type recentActionStored struct {
	recentActionItem
	Snapshot  []byte
	AfterHash string
}

func (s *Server) recordXrayMutationTx(ctx context.Context, tx *sql.Tx, mutation xrayconfig.Mutation) error {
	return s.recordRecentActionTx(ctx, tx, mutation)
}

func (s *Server) recordRecentActionEventTx(ctx context.Context, tx *sql.Tx, actionType, resourceType, resourceKey, summary string) error {
	return s.recordRecentActionEventDetailsTx(ctx, tx, actionType, resourceType, resourceKey, summary, nil, nil)
}

func (s *Server) recordRecentActionEventDetailsTx(ctx context.Context, tx *sql.Tx, actionType, resourceType, resourceKey, summary string, changes []recentActionValueChange, resources []string) error {
	principal, ok := ctx.Value(adminContextKey).(adminPrincipal)
	if !ok || principal.ID <= 0 || strings.TrimSpace(actionType) == "" {
		return nil
	}
	resources = uniqueRecentActionResources(resources)
	var snapshot any
	if len(changes) > 0 || len(resources) > 0 {
		payload, err := encodeRecentActionSnapshot(recentActionSnapshot{
			Changes:           changes,
			AffectedResources: resources,
		})
		if err != nil {
			return err
		}
		snapshot = payload
	}
	now := time.Now().UTC()
	batchID, _ := ctx.Value(recentActionBatchContextKey).(string)
	_, err := tx.ExecContext(ctx, `INSERT INTO recent_actions (
		action_type, resource_type, resource_key, actor_admin_id, actor_username, auth_source,
		summary, snapshot, after_hash, rollback_status, created_at, snapshot_expires_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unsupported', ?, NULL)`,
		strings.TrimSpace(actionType),
		strings.TrimSpace(resourceType),
		strings.TrimSpace(resourceKey),
		principal.ID,
		strings.TrimSpace(principal.Username),
		fmt.Sprint(principal.Context.Source),
		strings.TrimSpace(summary),
		snapshot,
		batchID,
		dbTimestamp(now),
	)
	if err != nil {
		return err
	}
	return s.pruneRecentActionsTx(ctx, tx, now)
}

func uniqueRecentActionResources(resources []string) []string {
	seen := make(map[string]struct{}, len(resources))
	result := make([]string, 0, len(resources))
	for _, resource := range resources {
		resource = strings.TrimSpace(resource)
		if resource == "" {
			continue
		}
		if _, exists := seen[resource]; exists {
			continue
		}
		seen[resource] = struct{}{}
		result = append(result, resource)
	}
	sort.Strings(result)
	return result
}

func (s *Server) recordRecentActionTx(ctx context.Context, tx *sql.Tx, mutation xrayconfig.Mutation) error {
	principal, ok := ctx.Value(adminContextKey).(adminPrincipal)
	if !ok || principal.ID <= 0 || strings.TrimSpace(mutation.ActionType) == "" {
		return nil
	}
	configPatches, err := xrayconfig.BuildConfigPatches(mutation.Before.TargetStates, mutation.After.TargetStates)
	if err != nil {
		return err
	}
	before := withoutConfigTargetStates(mutation.Before)
	after := withoutConfigTargetStates(mutation.After)
	beforeHash, err := xrayconfig.SnapshotHash(before)
	if err != nil {
		return err
	}
	afterHash, err := xrayconfig.SnapshotHash(after)
	if err != nil {
		return err
	}
	if beforeHash == afterHash && len(configPatches) == 0 {
		return nil
	}
	snapshot := recentActionSnapshot{
		Before:         before,
		After:          after,
		ConfigPatches:  configPatches,
		ConfigPreviews: recentActionConfigPreviews(configPatches, mutation.Before.TargetStates, mutation.After.TargetStates),
	}
	payload, err := encodeRecentActionSnapshot(snapshot)
	if err != nil {
		return err
	}
	if len(payload) > recentActionSnapshotMaxSize && len(snapshot.ConfigPreviews) > 0 {
		snapshot.ConfigPreviews = nil
		payload, err = encodeRecentActionSnapshot(snapshot)
		if err != nil {
			return err
		}
	}
	if len(payload) > recentActionSnapshotMaxSize {
		return fmt.Errorf("recent action snapshot exceeds the 1 MiB safety limit")
	}
	now := time.Now().UTC()
	status := "available"
	if strings.HasPrefix(mutation.ActionType, "recent_action.rollback") {
		status = "unsupported"
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO recent_actions (
		action_type, resource_type, resource_key, actor_admin_id, actor_username, auth_source,
		summary, snapshot, after_hash, rollback_status, created_at, snapshot_expires_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		strings.TrimSpace(mutation.ActionType),
		strings.TrimSpace(mutation.ResourceType),
		strings.TrimSpace(mutation.ResourceKey),
		principal.ID,
		strings.TrimSpace(principal.Username),
		fmt.Sprint(principal.Context.Source),
		strings.TrimSpace(mutation.Summary),
		payload,
		afterHash,
		status,
		dbTimestamp(now),
		dbTimestamp(now.Add(recentActionSnapshotLifetime)),
	)
	if err != nil {
		return err
	}
	return s.pruneRecentActionsTx(ctx, tx, now)
}

func (s *Server) markRecentActionUndoneTx(ctx context.Context, tx *sql.Tx, actionID int64) error {
	principal, ok := ctx.Value(adminContextKey).(adminPrincipal)
	if !ok || principal.ID <= 0 {
		return errors.New("missing admin context")
	}
	result, err := tx.ExecContext(ctx, `UPDATE recent_actions
SET rollback_status = 'undone', undone_at = ?, undone_by_admin_id = ?
WHERE id = ? AND rollback_status = 'available'`, dbTimestamp(time.Now().UTC()), principal.ID, actionID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated != 1 {
		return xrayconfig.ErrRollbackConflict
	}
	return nil
}

func (s *Server) pruneRecentActionsTx(ctx context.Context, tx *sql.Tx, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE recent_actions
SET snapshot = NULL, rollback_status = 'expired'
WHERE snapshot IS NOT NULL AND rollback_status = 'available' AND snapshot_expires_at IS NOT NULL AND snapshot_expires_at <= ?`, dbTimestamp(now)); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM recent_actions WHERE created_at < ?`, dbTimestamp(now.Add(-recentActionHistoryLifetime)))
	if err != nil {
		return err
	}
	for {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM recent_actions ORDER BY id DESC LIMIT 250 OFFSET ?`, recentActionHistoryMaxRows)
		if err != nil {
			return err
		}
		ids := make([]int64, 0, 250)
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		args := make([]any, len(ids))
		markers := make([]string, len(ids))
		for i, id := range ids {
			args[i] = id
			markers[i] = "?"
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM recent_actions WHERE id IN (`+strings.Join(markers, ",")+`)`, args...); err != nil {
			return err
		}
		if len(ids) < 250 {
			return nil
		}
	}
}

func encodeRecentActionSnapshot(snapshot recentActionSnapshot) ([]byte, error) {
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(raw); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return compressed.Bytes(), nil
}

func decodeRecentActionSnapshot(raw []byte) (recentActionSnapshot, error) {
	reader, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return recentActionSnapshot{}, err
	}
	defer reader.Close()
	decoded, err := io.ReadAll(io.LimitReader(reader, 8<<20))
	if err != nil {
		return recentActionSnapshot{}, err
	}
	var snapshot recentActionSnapshot
	if err := json.Unmarshal(decoded, &snapshot); err != nil {
		return recentActionSnapshot{}, err
	}
	hasEventDetails := len(snapshot.Changes) > 0 || len(snapshot.AffectedResources) > 0
	if !hasEventDetails && (snapshot.Before.Version != 1 || snapshot.After.Version != 1) {
		return recentActionSnapshot{}, errors.New("unsupported recent action snapshot")
	}
	for _, patch := range snapshot.ConfigPatches {
		if !patch.Valid() {
			return recentActionSnapshot{}, errors.New("unsupported Xray config patch")
		}
	}
	return snapshot, nil
}

func withoutConfigTargetStates(snapshot xrayconfig.MutationSnapshot) xrayconfig.MutationSnapshot {
	result := snapshot
	result.TargetStates = nil
	return result
}

func recentActionConfigPreviews(patches []xrayconfig.ConfigPatch, before, after []xrayconfig.TargetState) []recentActionConfigPreview {
	beforeByTarget := recentActionTargetStates(before)
	afterByTarget := recentActionTargetStates(after)
	previews := []recentActionConfigPreview{}
	for _, patch := range patches {
		for _, change := range patch.Changes {
			scope := recentActionConfigPreviewScope(change.Path)
			if scope == "" {
				continue
			}
			found := false
			for index := range previews {
				if previews[index].TargetID == patch.TargetID && previews[index].Path == scope {
					previews[index].ChangedPaths = append(previews[index].ChangedPaths, change.Path)
					found = true
					break
				}
			}
			if found {
				continue
			}
			beforeValue, beforeExists := recentActionConfigPreviewValue(beforeByTarget[patch.TargetID], scope)
			afterValue, afterExists := recentActionConfigPreviewValue(afterByTarget[patch.TargetID], scope)
			previews = append(previews, recentActionConfigPreview{
				TargetID: patch.TargetID, Path: scope, ChangedPaths: []string{change.Path},
				Before: beforeValue, After: afterValue, BeforeExists: beforeExists, AfterExists: afterExists,
			})
		}
	}
	return previews
}

func recentActionTargetStates(states []xrayconfig.TargetState) map[string]xrayconfig.TargetState {
	result := make(map[string]xrayconfig.TargetState, len(states))
	for _, state := range states {
		result[state.TargetID] = state
	}
	return result
}

func recentActionConfigPreviewValue(state xrayconfig.TargetState, path string) (any, bool) {
	if !state.HasStoredConfig {
		return nil, false
	}
	value, exists, err := xrayconfig.ConfigPathValue(state.StoredConfig, path)
	if err != nil {
		return nil, false
	}
	return value, exists
}

func recentActionConfigPreviewScope(path string) string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return "/"
	}
	parts := strings.Split(trimmed, "/")
	scope := []string{parts[0]}
	for _, part := range parts[1:] {
		scope = append(scope, part)
		if strings.HasPrefix(part, "@tag=") {
			return "/" + strings.Join(scope, "/")
		}
		if _, err := strconv.Atoi(part); err == nil {
			return "/" + strings.Join(scope, "/")
		}
	}
	return "/" + parts[0]
}

func (s *Server) handleRecentActionsRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	offset := 0
	offsetProvided := false
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = parsed
		offsetProvided = true
	}
	var beforeID int64
	if raw := strings.TrimSpace(r.URL.Query().Get("before_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid before_id")
			return
		}
		beforeID = parsed
	}
	if beforeID > 0 && offsetProvided {
		writeError(w, http.StatusBadRequest, "before_id and offset cannot be used together")
		return
	}
	filter, err := recentActionListFilterFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	includeAdmin := principal.Context.Admin.HasFullAccess()
	var items []recentActionItem
	var total int
	var nextBeforeID *int64
	useCursor := beforeID > 0 || !offsetProvided
	if useCursor {
		items, err = s.listRecentActions(r.Context(), beforeID, limit+1, includeAdmin, filter)
		if len(items) > limit {
			items = items[:limit]
			cursor := items[len(items)-1].cursorID
			nextBeforeID = &cursor
		}
	} else {
		items, total, err = s.listRecentActionsPage(r.Context(), offset, limit, includeAdmin, filter)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	actionTypes, resourceTypes, err := s.recentActionFilterOptions(r.Context(), includeAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	response := map[string]any{
		"actions": items, "next_before_id": nextBeforeID,
		"action_types": actionTypes, "resource_types": resourceTypes,
	}
	if !useCursor {
		response["total"] = total
	}
	writeJSON(w, http.StatusOK, response)
}

func recentActionListFilterFromRequest(r *http.Request) (recentActionListFilter, error) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if len(search) > 256 {
		return recentActionListFilter{}, fmt.Errorf("search must not exceed 256 characters")
	}
	parse := func(key string) ([]string, error) {
		values := make([]string, 0)
		for _, raw := range r.URL.Query()[key] {
			for _, value := range strings.Split(raw, ",") {
				value = strings.TrimSpace(value)
				if value == "" {
					continue
				}
				if len(value) > 96 || len(values) >= 50 {
					return nil, fmt.Errorf("invalid %s filter", key)
				}
				values = append(values, value)
			}
		}
		return uniqueRecentActionResources(values), nil
	}
	actionTypes, err := parse("action_type")
	if err != nil {
		return recentActionListFilter{}, err
	}
	resourceTypes, err := parse("resource_type")
	if err != nil {
		return recentActionListFilter{}, err
	}
	statuses, err := parse("status")
	if err != nil {
		return recentActionListFilter{}, err
	}
	var createdFrom, createdBefore string
	if raw := strings.TrimSpace(r.URL.Query().Get("day")); raw != "" {
		day, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return recentActionListFilter{}, fmt.Errorf("day must use YYYY-MM-DD format")
		}
		createdFrom = dbTimestamp(day)
		createdBefore = dbTimestamp(day.AddDate(0, 0, 1))
	}
	return recentActionListFilter{
		Search: search, ActionTypes: actionTypes,
		ResourceTypes: resourceTypes, Statuses: statuses,
		CreatedFrom: createdFrom, CreatedBefore: createdBefore,
	}, nil
}

func (s *Server) handleRecentActionsPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/core/recent-actions/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	actionID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || actionID <= 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		s.handleRecentActionDetail(w, r, actionID)
		return
	}
	if len(parts) == 2 && parts[1] == "rollback" && r.Method == http.MethodPost {
		s.handleRecentActionRollback(w, r, actionID)
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func (s *Server) listRecentActions(ctx context.Context, beforeID int64, limit int, includeAdmin bool, filter recentActionListFilter) ([]recentActionItem, error) {
	items := []recentActionItem{}
	cursor := beforeID
	for {
		clauses := []string{"(? = 0 OR id < ?)", "(? = 1 OR resource_type <> 'admin')"}
		args := []any{cursor, cursor, includeAdmin}
		if filter.Search != "" {
			term := "%" + strings.ToLower(filter.Search) + "%"
			clauses = append(clauses, `(LOWER(summary) LIKE ? OR LOWER(action_type) LIKE ? OR LOWER(resource_type) LIKE ? OR LOWER(resource_key) LIKE ? OR LOWER(actor_username) LIKE ?)`)
			for range 5 {
				args = append(args, term)
			}
		}
		addRecentActionListFilter(&clauses, &args, "action_type", filter.ActionTypes)
		addRecentActionListFilter(&clauses, &args, "resource_type", filter.ResourceTypes)
		addRecentActionListFilter(&clauses, &args, "rollback_status", filter.Statuses)
		if filter.CreatedFrom != "" && filter.CreatedBefore != "" {
			clauses = append(clauses, "created_at >= ? AND created_at < ?")
			args = append(args, filter.CreatedFrom, filter.CreatedBefore)
		}
		args = append(args, recentActionListChunkSize)
		rows, err := s.db.QueryContext(ctx, `SELECT id, action_type, resource_type, resource_key, actor_admin_id, actor_username, auth_source,
			summary, rollback_status, created_at, snapshot_expires_at, undone_at, undone_by_admin_id, after_hash, snapshot
			FROM recent_actions WHERE `+strings.Join(clauses, " AND ")+` ORDER BY id DESC LIMIT ?`, args...)
		if err != nil {
			return nil, err
		}
		read := 0
		lastID := cursor
		for rows.Next() {
			item, snapshot, err := scanRecentActionListItem(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			read++
			lastID = item.ID
			item.Preview = recentActionPreviewFromSnapshot(snapshot, item.ActionType, item.ResourceType)
			prepareRecentActionGroup(&item)
			if len(items) > 0 && mergeRecentNodeAction(&items[len(items)-1], item) {
				continue
			}
			if len(items) >= limit {
				rows.Close()
				return items, nil
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if read < recentActionListChunkSize {
			return items, nil
		}
		cursor = lastID
	}
}

func (s *Server) listRecentActionsPage(ctx context.Context, offset, limit int, includeAdmin bool, filter recentActionListFilter) ([]recentActionItem, int, error) {
	all, err := s.listRecentActions(ctx, 0, recentActionHistoryMaxRows+1, includeAdmin, filter)
	if err != nil {
		return nil, 0, err
	}
	total := len(all)
	if offset >= total {
		return []recentActionItem{}, total, nil
	}
	end := min(offset+limit, total)
	return all[offset:end], total, nil
}

func addRecentActionListFilter(clauses *[]string, args *[]any, column string, values []string) {
	if len(values) == 0 {
		return
	}
	markers := make([]string, len(values))
	for index, value := range values {
		markers[index] = "?"
		*args = append(*args, value)
	}
	*clauses = append(*clauses, column+" IN ("+strings.Join(markers, ",")+")")
}

func (s *Server) recentActionFilterOptions(ctx context.Context, includeAdmin bool) ([]string, []string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT action_type, resource_type FROM recent_actions WHERE (? = 1 OR resource_type <> 'admin')`, includeAdmin)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	actionSet := map[string]struct{}{}
	resourceSet := map[string]struct{}{}
	for rows.Next() {
		var actionType, resourceType string
		if err := rows.Scan(&actionType, &resourceType); err != nil {
			return nil, nil, err
		}
		actionSet[actionType] = struct{}{}
		resourceSet[resourceType] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	actionTypes := make([]string, 0, len(actionSet))
	for value := range actionSet {
		actionTypes = append(actionTypes, value)
	}
	resourceTypes := make([]string, 0, len(resourceSet))
	for value := range resourceSet {
		resourceTypes = append(resourceTypes, value)
	}
	sort.Strings(actionTypes)
	sort.Strings(resourceTypes)
	return actionTypes, resourceTypes, nil
}

func prepareRecentActionGroup(item *recentActionItem) {
	item.cursorID = item.ID
	item.groupSummary = item.Summary
	item.groupTailAt = item.CreatedAt
	if item.ResourceType == "node" && item.RollbackStatus == "unsupported" {
		item.AffectedResources = []string{item.ResourceKey}
		item.groupResources = map[string]struct{}{item.ResourceKey: {}}
	}
}

func mergeRecentNodeAction(group *recentActionItem, item recentActionItem) bool {
	if group.ResourceType != "node" || item.ResourceType != "node" ||
		group.RollbackStatus != "unsupported" || item.RollbackStatus != "unsupported" ||
		group.ActionType != item.ActionType || group.ActorUsername != item.ActorUsername ||
		group.AuthSource != item.AuthSource || group.groupSummary != item.Summary {
		return false
	}
	if group.batchID != "" || item.batchID != "" {
		if group.batchID == "" || group.batchID != item.batchID {
			return false
		}
	} else {
		newer := parseDBTime(group.groupTailAt)
		older := parseDBTime(item.CreatedAt)
		if newer == nil || older == nil || newer.Sub(*older) < 0 || newer.Sub(*older) > recentActionLegacyBatchGap {
			return false
		}
		if _, duplicate := group.groupResources[item.ResourceKey]; duplicate {
			return false
		}
	}
	group.cursorID = item.ID
	group.groupTailAt = item.CreatedAt
	if _, duplicate := group.groupResources[item.ResourceKey]; !duplicate {
		group.groupResources[item.ResourceKey] = struct{}{}
		group.AffectedResources = append(group.AffectedResources, item.ResourceKey)
	}
	group.ResourceKey = fmt.Sprintf("%d nodes", len(group.AffectedResources))
	group.Summary = fmt.Sprintf("%s · %d nodes", group.groupSummary, len(group.AffectedResources))
	return true
}

func (s *Server) loadRecentAction(ctx context.Context, actionID int64) (recentActionStored, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, action_type, resource_type, resource_key, actor_admin_id, actor_username, auth_source,
		summary, rollback_status, created_at, snapshot_expires_at, undone_at, undone_by_admin_id, snapshot, after_hash
		FROM recent_actions WHERE id = ? LIMIT 1`, actionID)
	return scanRecentActionStored(row)
}

func (s *Server) handleRecentActionDetail(w http.ResponseWriter, r *http.Request, actionID int64) {
	action, err := s.loadRecentAction(r.Context(), actionID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "recent action not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if action.ResourceType == "admin" && !principal.Context.Admin.HasFullAccess() {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	response := map[string]any{"snapshot_available": len(action.Snapshot) > 0}
	if len(action.Snapshot) > 0 {
		snapshot, err := decodeRecentActionSnapshot(action.Snapshot)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not read recent action snapshot")
			return
		}
		action.Preview = recentActionSnapshotPreview(snapshot, action.ActionType, action.ResourceType)
		if len(snapshot.Changes) > 0 {
			response["changes"] = snapshot.Changes
		}
		if len(snapshot.AffectedResources) > 0 {
			response["affected_resources"] = snapshot.AffectedResources
		}
		if snapshot.Before.Version == 1 && snapshot.After.Version == 1 {
			response["before"] = redactRecentActionSnapshot(snapshot.Before)
			response["after"] = redactRecentActionSnapshot(snapshot.After)
			if len(snapshot.ConfigPatches) > 0 {
				response["config_changes"] = redactRecentActionConfigChanges(snapshot.ConfigPatches)
			}
			previews := snapshot.ConfigPreviews
			if len(previews) == 0 {
				previews = s.recoverRecentActionConfigPreviews(r.Context(), snapshot.ConfigPatches)
			}
			previews = append(previews, recentActionHostPreviews(snapshot.Before.Hosts, snapshot.After.Hosts)...)
			if len(previews) > 0 {
				response["config_previews"] = redactRecentActionConfigPreviews(previews)
			}
		}
	}
	response["action"] = action.recentActionItem
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleRecentActionRollback(w http.ResponseWriter, r *http.Request, actionID int64) {
	action, err := s.loadRecentAction(r.Context(), actionID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "recent action not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if action.RollbackStatus != "available" || len(action.Snapshot) == 0 || (action.SnapshotExpiresAt != nil && *action.SnapshotExpiresAt <= dbTimestamp(time.Now().UTC())) {
		writeError(w, http.StatusConflict, "rollback is not available for this action")
		return
	}
	snapshot, err := decodeRecentActionSnapshot(action.Snapshot)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read recent action snapshot")
		return
	}
	if err := s.configRepo.RestoreMutationSnapshot(r.Context(), actionID, action.AfterHash, snapshot.Before, snapshot.ConfigPatches); err != nil {
		if errors.Is(err, xrayconfig.ErrRollbackConflict) {
			var conflict *xrayconfig.RollbackConflictError
			if errors.As(err, &conflict) && len(conflict.Paths) > 0 {
				writeJSON(w, http.StatusConflict, map[string]any{
					"detail":         "rollback conflict: the same configuration path changed after this action",
					"conflict_paths": conflict.Paths,
				})
				return
			}
			writeError(w, http.StatusConflict, "rollback conflict: the affected resources changed after this action")
			return
		}
		var validation *xrayconfig.RollbackValidationError
		if errors.As(err, &validation) {
			writeError(w, http.StatusUnprocessableEntity, validation.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "recent action rolled back"})
}

func redactRecentActionConfigChanges(patches []xrayconfig.ConfigPatch) []map[string]any {
	changes := make([]map[string]any, 0)
	for _, patch := range patches {
		for _, change := range patch.Changes {
			changes = append(changes, map[string]any{
				"target_id":     patch.TargetID,
				"path":          change.Path,
				"kind":          change.Kind,
				"before":        redactRecentActionSnapshot(change.Before),
				"after":         redactRecentActionSnapshot(change.After),
				"before_exists": change.BeforeExists,
				"after_exists":  change.AfterExists,
			})
		}
	}
	return changes
}

func redactRecentActionConfigPreviews(previews []recentActionConfigPreview) []recentActionConfigPreview {
	result := append([]recentActionConfigPreview(nil), previews...)
	for index := range result {
		result[index].Before = redactRecentActionSnapshot(result[index].Before)
		result[index].After = redactRecentActionSnapshot(result[index].After)
	}
	return result
}

func (s *Server) recoverRecentActionConfigPreviews(ctx context.Context, patches []xrayconfig.ConfigPatch) []recentActionConfigPreview {
	before := make([]xrayconfig.TargetState, 0, len(patches))
	after := make([]xrayconfig.TargetState, 0, len(patches))
	for _, patch := range patches {
		current, err := s.configRepo.GetTargetState(ctx, patch.TargetID)
		if err != nil {
			return nil
		}
		restored, err := xrayconfig.ApplyConfigPatch(current, patch)
		if err != nil {
			return nil
		}
		before = append(before, restored)
		after = append(after, current)
	}
	return recentActionConfigPreviews(patches, before, after)
}

func recentActionHostPreviews(before, after []xrayconfig.HostSnapshot) []recentActionConfigPreview {
	afterByID := make(map[int64]xrayconfig.HostSnapshot, len(after))
	for _, host := range after {
		afterByID[host.ID] = host
	}
	previews := make([]recentActionConfigPreview, 0, len(before)+len(after))
	seen := make(map[int64]bool, len(before))
	for _, host := range before {
		next, exists := afterByID[host.ID]
		if exists && reflect.DeepEqual(host, next) {
			seen[host.ID] = true
			continue
		}
		previews = append(previews, recentActionConfigPreview{
			TargetID: "host", Path: fmt.Sprintf("/hosts/@id=%d", host.ID),
			Before: host, After: next, BeforeExists: true, AfterExists: exists,
		})
		seen[host.ID] = true
	}
	for _, host := range after {
		if seen[host.ID] {
			continue
		}
		previews = append(previews, recentActionConfigPreview{
			TargetID: "host", Path: fmt.Sprintf("/hosts/@id=%d", host.ID),
			After: host, AfterExists: true,
		})
	}
	return previews
}

type rowScanner interface{ Scan(...any) error }

func scanRecentActionListItem(scanner rowScanner) (recentActionItem, []byte, error) {
	var item recentActionItem
	var actorID, undoneBy sql.NullInt64
	var expiresAt, undoneAt sql.NullString
	var snapshot []byte
	err := scanner.Scan(&item.ID, &item.ActionType, &item.ResourceType, &item.ResourceKey, &actorID, &item.ActorUsername, &item.AuthSource,
		&item.Summary, &item.RollbackStatus, &item.CreatedAt, &expiresAt, &undoneAt, &undoneBy, &item.batchID, &snapshot)
	if err != nil {
		return recentActionItem{}, nil, err
	}
	if actorID.Valid {
		value := actorID.Int64
		item.ActorAdminID = &value
	}
	if expiresAt.Valid {
		value := expiresAt.String
		item.SnapshotExpiresAt = &value
	}
	if undoneAt.Valid {
		value := undoneAt.String
		item.UndoneAt = &value
	}
	if undoneBy.Valid {
		value := undoneBy.Int64
		item.UndoneByAdminID = &value
	}
	return item, snapshot, nil
}

func recentActionPreviewFromSnapshot(raw []byte, actionType, resourceType string) *recentActionPreview {
	if len(raw) == 0 || len(raw) > recentActionPreviewMaxSize {
		return nil
	}
	snapshot, err := decodeRecentActionSnapshot(raw)
	if err != nil {
		return nil
	}
	return recentActionSnapshotPreview(snapshot, actionType, resourceType)
}

func recentActionSnapshotPreview(snapshot recentActionSnapshot, actionType, resourceType string) *recentActionPreview {
	if len(snapshot.Changes) > 0 {
		change := snapshot.Changes[0]
		return &recentActionPreview{Field: change.Field, Before: change.Before, After: change.After, Delta: change.Delta}
	}
	if operation := recentActionOperation(actionType); operation != "" {
		return &recentActionPreview{Operation: operation, Resource: resourceType}
	}
	if preview := recentActionHostPreview(snapshot.Before.Hosts, snapshot.After.Hosts); preview != nil {
		return preview
	}
	for _, patch := range snapshot.ConfigPatches {
		for _, change := range patch.Changes {
			if change.Kind == "keyed_order" {
				continue
			}
			field := strings.TrimPrefix(change.Path, "/")
			if field == "" {
				field = "configuration"
			}
			preview := &recentActionPreview{
				Field:  field,
				Before: recentActionPreviewValue(change.Before, change.BeforeExists),
				After:  recentActionPreviewValue(change.After, change.AfterExists),
			}
			if resource := recentActionConfigResource(change.Path); resource != "" {
				preview.Resource = resource
			}
			if operation, resource := recentActionConfigOperation(change); operation != "" {
				preview.Operation = operation
				preview.Resource = resource
			}
			return preview
		}
	}
	return nil
}

func recentActionOperation(actionType string) string {
	if strings.Contains(actionType, ".create") {
		return "created"
	}
	if strings.Contains(actionType, ".delete") {
		return "deleted"
	}
	return ""
}

func recentActionConfigOperation(change xrayconfig.ConfigPatchChange) (string, string) {
	parts := strings.Split(strings.Trim(change.Path, "/"), "/")
	if len(parts) == 0 || change.BeforeExists == change.AfterExists {
		return "", ""
	}
	resource := recentActionConfigResource(change.Path)
	if resource == "" || (len(parts) > 1 && !strings.HasPrefix(parts[len(parts)-1], "@tag=")) {
		return "", ""
	}
	if change.AfterExists {
		return "created", resource
	}
	return "deleted", resource
}

func recentActionConfigResource(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	switch parts[0] {
	case "inbounds":
		return "inbound"
	case "outbounds":
		return "outbound"
	case "routing":
		if len(parts) > 1 && parts[1] == "rules" {
			return "routing_rule"
		}
		if len(parts) > 1 && parts[1] == "balancers" {
			return "balancer"
		}
		return "routing"
	case "dns":
		if len(parts) > 1 && parts[1] == "servers" {
			return "dns_server"
		}
		if len(parts) > 1 && parts[1] == "hosts" {
			return "dns_host"
		}
		return "dns"
	case "log", "api", "policy", "stats", "transport", "metrics", "observatory", "services":
		return parts[0]
	case "reverse":
		return "reverse_proxy"
	case "burstObservatory":
		return "burst_observatory"
	case "fakedns":
		return "fake_dns"
	}
	return ""
}

func recentActionHostPreview(before, after []xrayconfig.HostSnapshot) *recentActionPreview {
	beforeByID := make(map[int64]xrayconfig.HostSnapshot, len(before))
	afterByID := make(map[int64]xrayconfig.HostSnapshot, len(after))
	for _, host := range before {
		beforeByID[host.ID] = host
	}
	for _, host := range after {
		afterByID[host.ID] = host
		if previous, ok := beforeByID[host.ID]; ok {
			for _, change := range []struct {
				field  string
				before string
				after  string
			}{
				{"name", previous.Remark, host.Remark},
				{"address", previous.Address, host.Address},
				{"host", stringValue(previous.Host), stringValue(host.Host)},
				{"sni", stringValue(previous.SNI), stringValue(host.SNI)},
				{"path", stringValue(previous.Path), stringValue(host.Path)},
			} {
				if change.before != change.after {
					return &recentActionPreview{Field: change.field, Before: recentActionPreviewValue(change.before, true), After: recentActionPreviewValue(change.after, true)}
				}
			}
		}
	}
	for _, host := range after {
		if _, ok := beforeByID[host.ID]; !ok {
			return &recentActionPreview{Operation: "created", Resource: "host"}
		}
	}
	for _, host := range before {
		if _, ok := afterByID[host.ID]; !ok {
			return &recentActionPreview{Operation: "deleted", Resource: "host"}
		}
	}
	return nil
}

func recentActionPreviewValue(value any, exists bool) string {
	if !exists {
		return "—"
	}
	value = redactRecentActionSnapshot(value)
	if text, ok := value.(string); ok {
		return truncateRecentActionPreview(text)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "—"
	}
	return truncateRecentActionPreview(string(raw))
}

func truncateRecentActionPreview(value string) string {
	const limit = 96
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func scanRecentActionStored(scanner rowScanner) (recentActionStored, error) {
	var stored recentActionStored
	var actorID, undoneBy sql.NullInt64
	var expiresAt, undoneAt sql.NullString
	err := scanner.Scan(&stored.ID, &stored.ActionType, &stored.ResourceType, &stored.ResourceKey, &actorID, &stored.ActorUsername, &stored.AuthSource,
		&stored.Summary, &stored.RollbackStatus, &stored.CreatedAt, &expiresAt, &undoneAt, &undoneBy, &stored.Snapshot, &stored.AfterHash)
	if err != nil {
		return recentActionStored{}, err
	}
	if actorID.Valid {
		value := actorID.Int64
		stored.ActorAdminID = &value
	}
	if expiresAt.Valid {
		value := expiresAt.String
		stored.SnapshotExpiresAt = &value
	}
	if undoneAt.Valid {
		value := undoneAt.String
		stored.UndoneAt = &value
	}
	if undoneBy.Valid {
		value := undoneBy.Int64
		stored.UndoneByAdminID = &value
	}
	return stored, nil
}

func redactRecentActionSnapshot(value any) any {
	switch typed := value.(type) {
	case nil, string, bool, float64, float32, int, int64, int32, uint, uint64:
		return typed
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if isRecentActionSecretKey(key) {
				result[key] = "[redacted]"
				continue
			}
			result[key] = redactRecentActionSnapshot(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for i, item := range typed {
			result[i] = redactRecentActionSnapshot(item)
		}
		return result
	default:
		raw, err := json.Marshal(value)
		if err != nil {
			return value
		}
		var normalized any
		if err := json.Unmarshal(raw, &normalized); err != nil {
			return value
		}
		return redactRecentActionSnapshot(normalized)
	}
}

func isRecentActionSecretKey(key string) bool {
	key = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(key), "_", ""), "-", ""))
	for _, marker := range []string{"password", "private", "secret", "token", "certificate", "seed", "apikey", "uuid"} {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return key == "key" || strings.HasSuffix(key, "key")
}
