package nodecontroller

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func TestAddUserWithoutMatchingServiceInboundIsNoOp(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "no-matching-inbound.db")+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username TEXT,
	credential_key TEXT,
	flow TEXT,
	service_id INTEGER,
	status TEXT
);
CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, settings TEXT);
CREATE TABLE service_hosts (service_id INTEGER, host_id INTEGER);
CREATE TABLE hosts (id INTEGER PRIMARY KEY, inbound_tag TEXT, is_disabled BOOLEAN DEFAULT 0);
INSERT INTO users (id, username, credential_key, service_id, status)
VALUES (42, 'user-42', 'key-42', 10, 'active');
INSERT INTO proxies (id, user_id, type, settings) VALUES (1, 42, 'vless', '{}');
INSERT INTO hosts (id, inbound_tag, is_disabled) VALUES (1, 'service-vless', 0);
INSERT INTO service_hosts (service_id, host_id) VALUES (10, 1);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	err = controller.grpcAddUserToNode(
		ctx,
		nil,
		NodeRow{
			ID:             7,
			XrayConfigMode: "custom",
			XrayConfig:     json.RawMessage(`{"inbounds":[{"tag":"other-vless","protocol":"vless","settings":{"clients":[]}}]}`),
		},
		OperationRow{OperationType: "add_user", UserID: sql.NullInt64{Int64: 42, Valid: true}},
		"42.user",
		true,
	)
	if err != nil {
		t.Fatalf("missing service inbound must be a no-op: %v", err)
	}
}

func TestUpdateUserOperationUsesRuntimeConfigReconciliation(t *testing.T) {
	controller := Controller{}
	requiresSync, err := controller.userOperationRequiresConfigSync(
		context.Background(),
		NodeRow{},
		OperationRow{
			OperationType: "update_user",
			UserID:        sql.NullInt64{Int64: 42, Valid: true},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !requiresSync {
		t.Fatal("update_user must use runtime config reconciliation")
	}
}

func TestRuntimeHasCapability(t *testing.T) {
	state := &nodev1.RuntimeState{Capabilities: []string{"safe_user_reconciliation"}}
	if !runtimeHasCapability(state, "safe_user_reconciliation") {
		t.Fatal("expected advertised capability")
	}
	if runtimeHasCapability(&nodev1.RuntimeState{}, "safe_user_reconciliation") {
		t.Fatal("legacy nodes must not advertise safe reconciliation")
	}
}

func TestPreparedRuntimeConfigKeepsUserSyncDecisionPerNode(t *testing.T) {
	prepared := &preparedRuntimeConfig{nodeID: 7, userSyncDecided: true, userSyncRequired: false}
	if required, decided := prepared.userSyncDecision(7); !decided || required {
		t.Fatalf("decision = (%v, %v), want (false, true)", required, decided)
	}
	if _, decided := prepared.userSyncDecision(8); decided {
		t.Fatal("decision must not be reused for another node")
	}
}
