//go:build cgo

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

func TestNodeSessionEventTogglesXrayRuntimeAccess(t *testing.T) {
	server, db := testAdminServer(t)
	_, err := db.Exec(`
CREATE TABLE vpn_user_sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol TEXT NOT NULL,
	inbound_tag TEXT NULL,
	session_id TEXT NOT NULL,
	assigned_ip TEXT NULL,
	started_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	ended_at DATETIME NULL,
	UNIQUE(node_id, session_id)
)`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO nodes (id, name, status, certificate) VALUES (7, 'node-7', 'connected', 'node-cert'), (8, 'node-8', 'connected', 'other-cert')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, status, service_id) VALUES (42, 'pool-user', 'active', 1)`); err != nil {
		t.Fatal(err)
	}

	token := nodecontroller.NodeSessionEventToken("admin-secret", 7, "node-cert")
	postNodeSessionEvent(t, server, token, `{"node_id":7,"user_id":42,"protocol":"wg","inbound_tag":"wg-main","session_id":"wg:one","assigned_ip":"10.70.0.2","event":"start"}`)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM vpn_user_sessions WHERE user_id = 42 AND ended_at IS NULL`, 1)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE user_id = 42 AND operation_type = 'disable_user'`, 2)

	postNodeSessionEvent(t, server, token, `{"node_id":7,"user_id":42,"protocol":"ov","inbound_tag":"ov-main","session_id":"ov:two","assigned_ip":"10.66.0.2","event":"start"}`)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM vpn_user_sessions WHERE user_id = 42 AND ended_at IS NULL`, 2)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE user_id = 42 AND operation_type = 'disable_user'`, 2)

	postNodeSessionEvent(t, server, token, `{"node_id":7,"user_id":42,"protocol":"wg","session_id":"wg:one","event":"stop"}`)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM vpn_user_sessions WHERE user_id = 42 AND ended_at IS NULL`, 1)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE user_id = 42 AND operation_type = 'enable_user'`, 0)

	postNodeSessionEvent(t, server, token, `{"node_id":7,"user_id":42,"protocol":"ov","session_id":"ov:two","event":"stop"}`)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM vpn_user_sessions WHERE user_id = 42 AND ended_at IS NULL`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE user_id = 42 AND operation_type = 'enable_user'`, 2)
}

func postNodeSessionEvent(t *testing.T, server *Server, token string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/internal/node/session-event", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("session event status = %d body=%s", rec.Code, rec.Body.String())
	}
	return rec
}
