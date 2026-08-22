//go:build cgo

package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func createRecentActionsTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE recent_actions (
		id INTEGER PRIMARY KEY, action_type TEXT NOT NULL, resource_type TEXT NOT NULL, resource_key TEXT NOT NULL,
		actor_admin_id INTEGER NULL, actor_username TEXT NOT NULL, auth_source TEXT NOT NULL, summary TEXT NOT NULL,
		snapshot BLOB NULL, after_hash TEXT NOT NULL, rollback_status TEXT NOT NULL, created_at DATETIME NOT NULL,
		snapshot_expires_at DATETIME NULL, undone_at DATETIME NULL, undone_by_admin_id INTEGER NULL
	)`); err != nil {
		t.Fatal(err)
	}
}

func TestRecordRecentActionStoresCompressedBeforeAndAfter(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	principal := adminPrincipal{ID: 9, Username: "operator"}
	ctx := context.WithValue(context.Background(), adminContextKey, principal)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	before := xrayconfig.MutationSnapshot{Version: 1}
	after := xrayconfig.MutationSnapshot{Version: 1, InboundTag: "cdn"}
	if err := server.recordRecentActionTx(ctx, tx, xrayconfig.Mutation{
		ActionType: "inbound.create", ResourceType: "inbound", ResourceKey: "cdn", Summary: "Created inbound", Before: before, After: after,
	}); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	action, err := server.loadRecentAction(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if action.ActorUsername != "operator" || action.RollbackStatus != "available" || len(action.Snapshot) == 0 {
		t.Fatalf("unexpected action: %#v", action)
	}
	snapshot, err := decodeRecentActionSnapshot(action.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Before.Version != 1 || snapshot.After.InboundTag != "cdn" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}

func TestRecordRecentActionEventStoresHistoryOnly(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.WithValue(context.Background(), adminContextKey, adminPrincipal{ID: 9, Username: "operator"})
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.recordRecentActionEventTx(ctx, tx, "admin.disable", "admin", "seller", "Disabled admin"); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	action, err := server.loadRecentAction(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if action.ResourceType != "admin" || action.RollbackStatus != "unsupported" || len(action.Snapshot) != 0 {
		t.Fatalf("unexpected action: %#v", action)
	}
	items, err := server.listRecentActions(ctx, 0, 10, false, recentActionListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("non-full-access list exposed admin activity: %#v", items)
	}
}

func TestRecordRecentActionEventDetailsStoresPreviewAndResources(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.WithValue(context.Background(), adminContextKey, adminPrincipal{ID: 9, Username: "operator"})
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	err = server.recordRecentActionEventDetailsTx(ctx, tx, "admin.update", "admin", "seller", "Updated admin", []recentActionValueChange{{
		Field: "data_limit", Before: "100 GB", After: "200 GB", Delta: "+100 GB",
	}}, []string{"de-2", "de-1", "de-2"})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	items, err := server.listRecentActions(ctx, 0, 10, true, recentActionListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Preview == nil || items[0].Preview.Delta != "+100 GB" {
		t.Fatalf("unexpected preview: %#v", items)
	}
	action, err := server.loadRecentAction(ctx, items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := decodeRecentActionSnapshot(action.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Changes) != 1 || len(snapshot.AffectedResources) != 2 || snapshot.AffectedResources[0] != "de-1" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}

func TestListRecentActionsGroupsNodeBatches(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.WithValue(context.Background(), adminContextKey, adminPrincipal{ID: 9, Username: "operator"})
	batchCtx := context.WithValue(ctx, recentActionBatchContextKey, "batch-1")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"de-1", "de-2", "de-3"} {
		if err := server.recordRecentActionEventTx(batchCtx, tx, "node.host_reboot", "node", name, "Rebooted node host"); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	for _, name := range []string{"fr-1", "fr-2"} {
		if err := server.recordRecentActionEventTx(ctx, tx, "node.host_reboot", "node", name, "Rebooted node host"); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE recent_actions SET created_at = ? WHERE resource_key = 'fr-1'`, "2026-08-02 12:01:00.000000"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE recent_actions SET created_at = ? WHERE resource_key = 'fr-2'`, "2026-08-02 12:00:00.000000"); err != nil {
		t.Fatal(err)
	}

	items, err := server.listRecentActions(ctx, 0, 3, true, recentActionListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || len(items[0].AffectedResources) != 2 || len(items[1].AffectedResources) != 3 {
		t.Fatalf("unexpected grouped node actions: %#v", items)
	}
	if items[0].ResourceKey != "2 nodes" || items[1].ResourceKey != "3 nodes" {
		t.Fatalf("unexpected grouped resource keys: %#v", items)
	}
}

func TestMergeRecentNodeActionAcceptsMySQLTimestamp(t *testing.T) {
	group := recentActionItem{
		ID: 2, ActionType: "node.host_reboot", ResourceType: "node", ResourceKey: "de-2",
		ActorUsername: "operator", AuthSource: "session", Summary: "Rebooted node host",
		RollbackStatus: "unsupported", CreatedAt: "2026-08-02T12:00:02Z",
	}
	item := recentActionItem{
		ID: 1, ActionType: "node.host_reboot", ResourceType: "node", ResourceKey: "de-1",
		ActorUsername: "operator", AuthSource: "session", Summary: "Rebooted node host",
		RollbackStatus: "unsupported", CreatedAt: "2026-08-02T12:00:01Z",
	}
	prepareRecentActionGroup(&group)
	prepareRecentActionGroup(&item)
	if !mergeRecentNodeAction(&group, item) || len(group.AffectedResources) != 2 {
		t.Fatalf("MySQL timestamps were not grouped: %#v", group)
	}
}

func TestListRecentActionsAppliesServerFilters(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.WithValue(context.Background(), adminContextKey, adminPrincipal{ID: 9, Username: "operator"})
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []struct{ actionType, resourceType, resourceKey, summary string }{
		{"node.host_reboot", "node", "de-1", "Rebooted node host"},
		{"node.service_restart", "node", "fr-1", "Restarted node service"},
		{"admin.update", "admin", "seller", "Updated admin"},
	} {
		if err := server.recordRecentActionEventTx(ctx, tx, action.actionType, action.resourceType, action.resourceKey, action.summary); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	items, err := server.listRecentActions(ctx, 0, 10, true, recentActionListFilter{
		Search: "fr-1", ActionTypes: []string{"node.service_restart"},
		ResourceTypes: []string{"node"}, Statuses: []string{"unsupported"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ResourceKey != "fr-1" {
		t.Fatalf("unexpected filtered actions: %#v", items)
	}
}

func TestListRecentActionsPagesAndFiltersByDay(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	for id, action := range []struct {
		actionType, resourceType, resourceKey, summary, createdAt string
	}{
		{"host.update", "host", "previous-day", "Updated host", "2026-08-01 23:59:59.000000"},
		{"host.update", "host", "day-host", "Updated host", "2026-08-02 08:00:00.000000"},
		{"node.host_reboot", "node", "de-1", "Rebooted node host", "2026-08-02 09:00:00.000000"},
		{"node.host_reboot", "node", "de-2", "Rebooted node host", "2026-08-02 09:01:00.000000"},
		{"host.update", "host", "latest-host", "Updated host", "2026-08-02 10:00:00.000000"},
	} {
		_, err := db.Exec(`INSERT INTO recent_actions (
			id, action_type, resource_type, resource_key, actor_username, auth_source, summary,
			after_hash, rollback_status, created_at
		) VALUES (?, ?, ?, ?, 'operator', 'session', ?, '', 'unsupported', ?)`,
			id+1, action.actionType, action.resourceType, action.resourceKey, action.summary, action.createdAt)
		if err != nil {
			t.Fatal(err)
		}
	}
	filterRequest := httptest.NewRequest("GET", "/api/core/recent-actions?day=2026-08-02", nil)
	filter, err := recentActionListFilterFromRequest(filterRequest)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{db: db}
	items, total, err := server.listRecentActionsPage(context.Background(), 1, 2, true, filter)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(items) != 2 || items[0].ID != 4 || items[1].ID != 2 || len(items[0].AffectedResources) != 2 {
		t.Fatalf("unexpected filtered page: total=%d items=%#v", total, items)
	}

	type listResponse struct {
		Actions      []recentActionItem `json:"actions"`
		Total        *int               `json:"total"`
		NextBeforeID *int64             `json:"next_before_id"`
	}
	performRequest := func(path string) (*httptest.ResponseRecorder, listResponse) {
		t.Helper()
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		server.handleRecentActionsRoot(recorder, req)
		var response listResponse
		if recorder.Code == http.StatusOK {
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
		}
		return recorder, response
	}

	legacy, legacyResponse := performRequest("/api/core/recent-actions?limit=2")
	if legacy.Code != http.StatusOK || legacyResponse.Total != nil || len(legacyResponse.Actions) != 2 || legacyResponse.NextBeforeID == nil {
		t.Fatalf("legacy cursor response changed: code=%d response=%#v", legacy.Code, legacyResponse)
	}
	numbered, numberedResponse := performRequest("/api/core/recent-actions?day=2026-08-02&limit=100&offset=0")
	if numbered.Code != http.StatusOK || numberedResponse.Total == nil || *numberedResponse.Total != 3 || len(numberedResponse.Actions) != 3 || numberedResponse.NextBeforeID != nil {
		t.Fatalf("numbered response mismatch: code=%d response=%#v", numbered.Code, numberedResponse)
	}
	for _, path := range []string{
		"/api/core/recent-actions?before_id=4&offset=0",
		"/api/core/recent-actions?day=2026-02-30&offset=0",
		"/api/core/recent-actions?limit=101&offset=0",
	} {
		if recorder, _ := performRequest(path); recorder.Code != http.StatusBadRequest {
			t.Fatalf("invalid recent-actions query %q returned %d", path, recorder.Code)
		}
	}
}

func TestRecentActionSnapshotPreviewShowsHostRename(t *testing.T) {
	preview := recentActionSnapshotPreview(recentActionSnapshot{
		Before: xrayconfig.MutationSnapshot{Hosts: []xrayconfig.HostSnapshot{{ID: 1, Remark: "name"}}},
		After:  xrayconfig.MutationSnapshot{Hosts: []xrayconfig.HostSnapshot{{ID: 1, Remark: "newname"}}},
	}, "host.bulk_update", "host")
	if preview == nil || preview.Field != "name" || preview.Before != "name" || preview.After != "newname" {
		t.Fatalf("unexpected preview: %#v", preview)
	}
}

func TestRecentActionSnapshotPreviewUsesLifecycleTemplate(t *testing.T) {
	preview := recentActionSnapshotPreview(recentActionSnapshot{
		Before: xrayconfig.MutationSnapshot{Hosts: []xrayconfig.HostSnapshot{{ID: 1, Remark: "Turkey"}}},
		After:  xrayconfig.MutationSnapshot{},
	}, "host.bulk_update", "host")
	if preview == nil || preview.Operation != "deleted" || preview.Resource != "host" {
		t.Fatalf("unexpected host preview: %#v", preview)
	}
	preview = recentActionSnapshotPreview(recentActionSnapshot{
		After: xrayconfig.MutationSnapshot{Hosts: []xrayconfig.HostSnapshot{{ID: 2, Remark: "Netherlands"}}},
	}, "host.bulk_update", "host")
	if preview == nil || preview.Operation != "created" || preview.Resource != "host" {
		t.Fatalf("unexpected created host preview: %#v", preview)
	}
	preview = recentActionSnapshotPreview(recentActionSnapshot{
		Before: xrayconfig.MutationSnapshot{Hosts: []xrayconfig.HostSnapshot{{ID: 1, Remark: "Turkey"}}},
	}, "inbound.delete", "inbound")
	if preview == nil || preview.Operation != "deleted" || preview.Resource != "inbound" {
		t.Fatalf("unexpected inbound preview: %#v", preview)
	}

	preview = recentActionSnapshotPreview(recentActionSnapshot{ConfigPatches: []xrayconfig.ConfigPatch{{
		Changes: []xrayconfig.ConfigPatchChange{{
			Path: "/outbounds/@tag=proxy", Before: map[string]any{"tag": "proxy"}, BeforeExists: true,
		}},
	}}}, "xray.config.update", "xray_config")
	if preview == nil || preview.Operation != "deleted" || preview.Resource != "outbound" {
		t.Fatalf("unexpected outbound preview: %#v", preview)
	}
}

func TestRecentActionConfigPreviewsKeepChangedResource(t *testing.T) {
	before := xrayconfig.TargetState{
		TargetID: "master", HasStoredConfig: true,
		StoredConfig: map[string]any{"outbounds": []any{map[string]any{
			"tag": "tor-de", "settings": map[string]any{"servers": []any{map[string]any{"port": 9050}}},
		}}},
	}
	after := xrayconfig.TargetState{
		TargetID: "master", HasStoredConfig: true,
		StoredConfig: map[string]any{"outbounds": []any{map[string]any{
			"tag": "tor-de", "settings": map[string]any{"servers": []any{map[string]any{"port": 9051}}},
		}}},
	}
	patches, err := xrayconfig.BuildConfigPatches([]xrayconfig.TargetState{before}, []xrayconfig.TargetState{after})
	if err != nil {
		t.Fatal(err)
	}
	previews := recentActionConfigPreviews(patches, []xrayconfig.TargetState{before}, []xrayconfig.TargetState{after})
	if len(previews) != 1 || previews[0].Path != "/outbounds/@tag=tor-de" {
		t.Fatalf("unexpected previews: %#v", previews)
	}
	if got := previews[0].ChangedPaths; len(got) != 1 || got[0] != "/outbounds/@tag=tor-de/settings/servers/0/port" {
		t.Fatalf("unexpected changed paths: %#v", got)
	}
	beforeOutbound, ok := previews[0].Before.(map[string]any)
	if !ok || beforeOutbound["tag"] != "tor-de" {
		t.Fatalf("expected complete outbound before change, got %#v", previews[0].Before)
	}
	afterOutbound, ok := previews[0].After.(map[string]any)
	if !ok || afterOutbound["tag"] != "tor-de" {
		t.Fatalf("expected complete outbound after change, got %#v", previews[0].After)
	}
}

func TestRecoverRecentActionConfigPreviewsUsesCurrentConfig(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE xray_config (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	beforeConfig := map[string]any{"outbounds": []any{map[string]any{
		"tag": "tor-de", "settings": map[string]any{"servers": []any{map[string]any{"port": 9050}}},
	}}}
	afterConfig := map[string]any{"outbounds": []any{map[string]any{
		"tag": "tor-de", "settings": map[string]any{"servers": []any{map[string]any{"port": 9051}}},
	}}}
	if _, err := db.Exec(`INSERT INTO xray_config (id, data) VALUES (1, ?)`, `{"outbounds":[{"tag":"tor-de","settings":{"servers":[{"port":9051}]}}]}`); err != nil {
		t.Fatal(err)
	}
	before := xrayconfig.TargetState{TargetID: "master", Mode: xrayconfig.ConfigModeCustom, HasStoredConfig: true, StoredConfig: beforeConfig}
	after := xrayconfig.TargetState{TargetID: "master", Mode: xrayconfig.ConfigModeCustom, HasStoredConfig: true, StoredConfig: afterConfig}
	patches, err := xrayconfig.BuildConfigPatches([]xrayconfig.TargetState{before}, []xrayconfig.TargetState{after})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{configRepo: xrayconfig.NewRepository(db, "sqlite", xrayconfig.Options{})}
	previews := server.recoverRecentActionConfigPreviews(context.Background(), patches)
	if len(previews) != 1 || previews[0].Path != "/outbounds/@tag=tor-de" {
		t.Fatalf("unexpected previews: %#v", previews)
	}
	beforeOutbound, ok := previews[0].Before.(map[string]any)
	if !ok || beforeOutbound["tag"] != "tor-de" {
		t.Fatalf("expected complete outbound before change, got %#v", previews[0].Before)
	}
}

func TestRecentActionConfigResourceCoversXraySections(t *testing.T) {
	for path, expected := range map[string]string{
		"/routing/balancers/@tag=edge": "balancer",
		"/routing/rules/0":             "routing_rule",
		"/reverse/bridges/0":           "reverse_proxy",
		"/fakedns/0":                   "fake_dns",
		"/burstObservatory/subject":    "burst_observatory",
		"/observatory/subjectSelector": "observatory",
		"/policy/levels":               "policy",
		"/transport/grpc":              "transport",
	} {
		if actual := recentActionConfigResource(path); actual != expected {
			t.Fatalf("resource for %s = %q, want %q", path, actual, expected)
		}
	}
}

func TestRecentActionConfigPreviewScopeKeepsFullChangedResource(t *testing.T) {
	for path, expected := range map[string]string{
		"/inbounds/@tag=vless/streamSettings/security":   "/inbounds/@tag=vless",
		"/outbounds/@tag=direct/settings/servers/0/port": "/outbounds/@tag=direct",
		"/routing/rules/0/outboundTag":                   "/routing/rules/0",
		"/routing/balancers/@tag=edge/fallbackTag":       "/routing/balancers/@tag=edge",
		"/reverse/bridges/0/tag":                         "/reverse/bridges/0",
		"/fakedns/0/ipPool":                              "/fakedns/0",
		"/dns/servers/0/address":                         "/dns/servers/0",
		"/observatory/subjectSelector":                   "/observatory",
		"/burstObservatory/subjectSelector":              "/burstObservatory",
		"/policy/levels":                                 "/policy",
		"/transport/grpc":                                "/transport",
		"/log/loglevel":                                  "/log",
	} {
		if actual := recentActionConfigPreviewScope(path); actual != expected {
			t.Fatalf("scope for %s = %q, want %q", path, actual, expected)
		}
	}
}

func TestRecentActionHostPreviewsKeepFullChangedHost(t *testing.T) {
	before := xrayconfig.HostSnapshot{ID: 1, Remark: "old", Address: "192.0.2.1"}
	after := before
	after.Remark = "new"
	previews := recentActionHostPreviews([]xrayconfig.HostSnapshot{before}, []xrayconfig.HostSnapshot{after})
	if len(previews) != 1 || previews[0].Before != before || previews[0].After != after {
		t.Fatalf("unexpected host previews: %#v", previews)
	}
}
