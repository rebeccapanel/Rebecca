package api

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
	_ "modernc.org/sqlite"
)

func TestOperatorResolverCachesRanges(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"from":"5.52.0.0","to":"5.52.255.255","owner":"Mobile Communication Company of Iran PLC","short_name":"Hamrah Aval"}]`))
	}))
	defer server.Close()
	resolver := newOperatorResolver()
	resolver.url = server.URL

	for range 2 {
		result := resolver.Lookup(context.Background(), []string{"5.52.10.20", "2001:db8::1"})
		if got := result["5.52.10.20"].ShortName; got != "Hamrah Aval" {
			t.Fatalf("operator=%q", got)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("range source requests=%d want=1", got)
	}
}

func TestAccessProtocolLabel(t *testing.T) {
	tests := map[string]string{
		"xray": "Xray", "ov": "OpenVPN", "wg": "WireGuard", "l2tp": "L2TP/IPsec",
		"ikev2": "IKEv2", "anyconnect": "Cisco AnyConnect",
	}
	for protocol, want := range tests {
		if got := accessProtocolLabel(protocol); got != want {
			t.Fatalf("%s=%q want=%q", protocol, got, want)
		}
	}
}

func TestAccessInsightsHandlerReturnsCrossProtocolOperators(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "access-api.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, admin_id INTEGER, status TEXT);
CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE user_online_ips (node_id INTEGER, user_id INTEGER, protocol TEXT, ip TEXT, last_seen_at DATETIME);
CREATE TABLE vpn_user_sessions (
  node_id INTEGER, user_id INTEGER, protocol TEXT, inbound_tag TEXT, session_id TEXT,
  assigned_ip TEXT, client_ip TEXT, last_seen_at DATETIME, ended_at DATETIME
);
INSERT INTO users (id, username, admin_id, status) VALUES (42, 'alice', 1, 'active');
INSERT INTO nodes (id, name) VALUES (7, 'edge-de');
INSERT INTO user_online_ips (node_id, user_id, protocol, ip, last_seen_at) VALUES (7, 42, 'xray', '5.52.10.20', CURRENT_TIMESTAMP);
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, inbound_tag, session_id, assigned_ip, client_ip, last_seen_at, ended_at)
VALUES (7, 42, 'ov', 'ov-main', 'ov-1', '10.66.0.2', '5.52.10.21', CURRENT_TIMESTAMP, NULL);`); err != nil {
		t.Fatal(err)
	}
	server := &Server{
		nodeController: nodecontroller.NewController(nodecontroller.NewRepository(db, "sqlite")),
		operators: &operatorResolver{
			ranges: []operatorRange{{
				ShortName: "Hamrah Aval", Owner: "Mobile Communication Company of Iran PLC",
				start: netip.MustParseAddr("5.52.0.0"), end: netip.MustParseAddr("5.52.255.255"),
			}},
			loadedAt: time.Now(),
		},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/core/access/insights?limit=20", nil)
	request = request.WithContext(context.WithValue(request.Context(), adminContextKey, adminPrincipal{
		ID: 1,
		Context: adminapp.EffectiveAdminContext{Admin: adminapp.Admin{
			ID: 1, Role: adminapp.RoleFullAccess, Permissions: adminapp.RoleDefaultPermissions(adminapp.RoleFullAccess),
		}},
	}))
	recorder := httptest.NewRecorder()
	server.handleAccessInsights(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	for _, expected := range []string{`"user_label":"alice"`, `"platform":"Xray"`, `"platform":"OpenVPN"`, `"short_name":"Hamrah Aval"`} {
		if !strings.Contains(recorder.Body.String(), expected) {
			t.Fatalf("missing %s in %s", expected, recorder.Body.String())
		}
	}
}
