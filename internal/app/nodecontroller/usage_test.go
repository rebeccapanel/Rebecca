package nodecontroller

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestUsageRPCsReceiveIndependentDeadlines(t *testing.T) {
	first, cancelFirst := withUsageRPCTimeout(context.Background())
	cancelFirst()
	<-first.Done()

	second, cancelSecond := withUsageRPCTimeout(context.Background())
	defer cancelSecond()
	select {
	case <-second.Done():
		t.Fatal("a completed RPC must not cancel the next RPC")
	default:
	}
	deadline, ok := second.Deadline()
	if !ok || time.Until(deadline) < 40*time.Second {
		t.Fatal("usage RPC deadline is too short for node-side collection")
	}
}

func TestRetryTransientUsageWriteRetriesDeadlock(t *testing.T) {
	attempts := 0
	err := retryTransientUsageWrite(context.Background(), func() error {
		attempts++
		if attempts < 3 {
			return errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}

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

func TestCollectUsageDialFailureDoesNotChangeNodeHealth(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "usage-status.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE default_certificates (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	private_key TEXT
);
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	agent_status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT,
	last_status_change DATETIME
);
CREATE TABLE inbounds (
	id INTEGER PRIMARY KEY,
	tag TEXT NOT NULL UNIQUE,
	usage_coefficient REAL NOT NULL DEFAULT 1
);
CREATE TABLE users (id INTEGER PRIMARY KEY, ip_limit INTEGER NULL);
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
INSERT INTO default_certificates (id, certificate, private_key) VALUES (1, 'invalid-cert', 'invalid-key');
INSERT INTO nodes (
	id, name, address, port, api_port, status, agent_status, xray_version, message,
	certificate, certificate_key, xray_config_mode, xray_config, usage_coefficient
) VALUES (
	7, 'usage-node', '127.0.0.1', 62051, 62052, 'connected', 'connected', '', '',
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
	assertString(t, db, `SELECT agent_status FROM nodes WHERE id = 7`, "connected")
	assertInt64(t, db, `SELECT COUNT(*) FROM node_operations`, 0)

	t.Run("health recovery does not enqueue a runtime replacement", func(t *testing.T) {
		if _, err := db.Exec(`UPDATE nodes SET status = 'error', last_status_change = NULL WHERE id = 7`); err != nil {
			t.Fatal(err)
		}
		recovered, err := controller.RecoverNodes(ctx, RecoverNodesRequest{Limit: 10})
		if err != nil || recovered.Checked != 1 || len(recovered.Errors) != 1 || !strings.Contains(recovered.Errors[0], "certificate") {
			t.Fatalf("expected a read-only health attempt: result=%#v err=%v", recovered, err)
		}
		assertInt64(t, db, `SELECT COUNT(*) FROM node_operations`, 0)
	})
}
