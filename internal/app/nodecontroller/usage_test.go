package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestUsageCollectionResetsXrayCountersByDefault(t *testing.T) {
	cases := []struct {
		name string
		req  CollectUsageRequest
		want bool
	}{
		{name: "empty request resets", req: CollectUsageRequest{}, want: true},
		{name: "worker request resets", req: CollectUsageRequest{Users: true, Outbound: true, Reset: true}, want: true},
		{name: "legacy false still resets safely", req: CollectUsageRequest{Users: true, Outbound: true, Reset: false}, want: true},
		{name: "explicit no reset disables reset", req: CollectUsageRequest{NoReset: true}, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := usageCollectionShouldReset(tc.req); got != tc.want {
				t.Fatalf("usageCollectionShouldReset() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCollectUsageFailureDoesNotMarkNodeError(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "usage-status.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE tls (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	`+"`key`"+` TEXT
);
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1,
	last_status_change DATETIME
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO tls (id, certificate, `+"`key`"+`) VALUES (1, 'invalid-cert', 'invalid-key');
INSERT INTO nodes (
	id, name, address, port, api_port, status, xray_version, message,
	certificate, certificate_key, xray_config_mode, xray_config, usage_coefficient
) VALUES (
	7, 'usage-node', '127.0.0.1', 62051, 62052, 'connected', '', '',
	'', '', 'default', '', 1
);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.CollectUsage(ctx, CollectUsageRequest{NodeID: 7, Users: true, Outbound: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Errors) == 0 {
		t.Fatal("expected usage collection error")
	}
	assertString(t, db, `SELECT status FROM nodes WHERE id = 7`, "connected")
	assertInt64(t, db, `SELECT COUNT(*) FROM node_operations`, 0)
}
