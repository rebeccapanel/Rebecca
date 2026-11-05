package api

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func newLabelsMigratedServer(t *testing.T) (*Server, string) {
	t.Helper()
	testDir := t.TempDir()
	server, err := New(Config{
		Database:                    "sqlite:///" + filepath.ToSlash(filepath.Join(testDir, "labels.sqlite3")),
		CertificateBase:             filepath.Join(testDir, "certificates"),
		ExternalAppsBase:            filepath.Join(testDir, "apps"),
		JWTAccessTokenExpireMinutes: 1440,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.db.Close() })
	hash, err := adminapp.HashPassword("pass123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.db.Exec(`INSERT INTO admins (username, hashed_password, role, permissions, status) VALUES (?, ?, ?, ?, ?)`, "root", hash, "full_access", "{}", "active"); err != nil {
		t.Fatal(err)
	}
	if _, err := server.db.Exec(`INSERT INTO inbounds (tag) VALUES (?)`, "label-in"); err != nil {
		t.Fatal(err)
	}
	return server, sqliteAdminToken(t, server)
}

func TestHostTagsTravelWithTheHostPayload(t *testing.T) {
	server, token := newLabelsMigratedServer(t)

	rec := sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, `{"label-in":[{"remark":"one","address":"one.example.com","port":443,"security":"inbound_default","is_disabled":false,"tags":["Edge","eu"]}]}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tags":["edge","eu"]`) {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	hostID := sqliteHostID(t, server.db, "one")

	rec = sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, `{"label-in":[{"id":`+itoa(hostID)+`,"remark":"one","address":"two.example.com","port":443,"security":"inbound_default","is_disabled":false}]}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tags":["edge","eu"]`) {
		t.Fatalf("a payload without tags must keep them: status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, `{"label-in":[{"id":`+itoa(hostID)+`,"remark":"one","address":"two.example.com","port":443,"security":"inbound_default","is_disabled":false,"tags":[]}]}`)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"edge"`) {
		t.Fatalf("empty tags must clear them: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminGroupAndTagsInCreateAndUpdatePayload(t *testing.T) {
	server, token := newLabelsMigratedServer(t)
	rec := sqliteJSONRequest(server, http.MethodPost, "/api/groups", token, `{"type":"admin","name":"Support"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("group status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = sqliteJSONRequest(server, http.MethodPost, "/api/admin", token, `{"username":"agent","password":"secret1","role":"standard","group_id":1,"tags":["Night","L1"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create admin status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = sqliteJSONRequest(server, http.MethodGet, "/api/admins?group_id=1", token, "")
	if !strings.Contains(rec.Body.String(), `"username":"agent"`) || strings.Contains(rec.Body.String(), `"username":"root"`) || !strings.Contains(rec.Body.String(), `"name":"Support"`) {
		t.Fatalf("group filter body=%s", rec.Body.String())
	}

	rec = sqliteJSONRequest(server, http.MethodPut, "/api/admin/agent", token, `{"group_id":null}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update admin status=%d body=%s", rec.Code, rec.Body.String())
	}
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM entity_group_members`, 0)

	rec = sqliteJSONRequest(server, http.MethodGet, "/api/admins?tag=night&tag=l1&tag_match=all", token, "")
	if !strings.Contains(rec.Body.String(), `"username":"agent"`) || !strings.Contains(rec.Body.String(), `"tags":["l1","night"]`) || strings.Contains(rec.Body.String(), `"username":"root"`) {
		t.Fatalf("tag filter body=%s", rec.Body.String())
	}
	if rec := sqliteJSONRequest(server, http.MethodPut, "/api/admin/agent", token, `{"tags":["day"]}`); rec.Code != http.StatusOK {
		t.Fatalf("tag update status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = sqliteJSONRequest(server, http.MethodGet, "/api/admins?tag=night", token, "")
	if strings.Contains(rec.Body.String(), `"username":"agent"`) {
		t.Fatalf("old tag still matches: %s", rec.Body.String())
	}
	if rec := sqliteJSONRequest(server, http.MethodPost, "/api/admin", token, `{"username":"agent2","password":"secret1","role":"standard","group_id":99}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown group status=%d want 404", rec.Code)
	}
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM admins WHERE username = 'agent2'`, 0)
}

func TestNodeTags(t *testing.T) {
	server, token := newLabelsMigratedServer(t)
	if _, err := server.db.Exec(`INSERT INTO nodes (name, address, port, api_port, status) VALUES ('de-1', '203.0.113.5', 62050, 62051, 'connected')`); err != nil {
		t.Fatal(err)
	}
	rec := sqliteJSONRequest(server, http.MethodPut, "/api/labels/node/1", token, `{"tags":["Germany","hetzner"]}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tags":["germany","hetzner"]`) {
		t.Fatalf("node labels status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := sqliteJSONRequest(server, http.MethodPut, "/api/labels/node/9", token, `{"tags":["x"]}`); rec.Code != http.StatusNotFound {
		t.Fatalf("missing node status=%d want 404", rec.Code)
	}
	if rec := sqliteJSONRequest(server, http.MethodPut, "/api/labels/node/1", token, `{"group_id":1}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("node group status=%d want 400", rec.Code)
	}
	rec = sqliteJSONRequest(server, http.MethodGet, "/api/labels/node", token, "")
	if !strings.Contains(rec.Body.String(), `"1":{"group":null,"tags":["germany","hetzner"]}`) {
		t.Fatalf("node map body=%s", rec.Body.String())
	}
	if _, err := server.db.Exec(`UPDATE nodes SET status = 'deleted'`); err != nil {
		t.Fatal(err)
	}
	rec = sqliteJSONRequest(server, http.MethodGet, "/api/tags?type=node", token, "")
	if strings.Contains(rec.Body.String(), "germany") {
		t.Fatalf("deleted node tags still listed: %s", rec.Body.String())
	}
}
