//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func createLabelTables(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE entity_groups (id INTEGER PRIMARY KEY, entity_type VARCHAR(16) NOT NULL, name VARCHAR(128) NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE UNIQUE INDEX ux_entity_groups_type_name ON entity_groups (entity_type, name)`,
		`CREATE TABLE entity_group_members (entity_type VARCHAR(16) NOT NULL, entity_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (entity_type, entity_id))`,
		`CREATE TABLE entity_tags (entity_type VARCHAR(16) NOT NULL, entity_id INTEGER NOT NULL DEFAULT 0, entity_name VARCHAR(191) NOT NULL DEFAULT '', tag VARCHAR(64) NOT NULL, PRIMARY KEY (entity_type, entity_id, entity_name, tag))`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
}

type labelTestUsers struct {
	Users []struct {
		Username string   `json:"username"`
		Tags     []string `json:"tags"`
		Group    *struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"group"`
	} `json:"users"`
	Total int64 `json:"total"`
}

func labelUserNames(t *testing.T, server *Server, token string, query string) []string {
	t.Helper()
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/users?"+query, token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list %q status=%d body=%s", query, rec.Code, rec.Body.String())
	}
	var body labelTestUsers
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, user := range body.Users {
		names = append(names, user.Username)
	}
	return names
}

func sameNames(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	seen := map[string]bool{}
	for _, name := range got {
		seen[name] = true
	}
	for _, name := range want {
		if !seen[name] {
			return false
		}
	}
	return true
}

func TestGroupsAreManagedByGlobalAdminsOnly(t *testing.T) {
	server, db, owner := testUserMutationServer(t)
	seller := adminBearerToken(t, server, "seller", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"user","name":"Resellers"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"user","name":"resellers"}`); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate status=%d want 409", rec.Code)
	}
	if rec := adminJSONRequest(t, server, http.MethodPost, "/api/groups", seller, `{"type":"user","name":"Mine"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("standard create status=%d want 403", rec.Code)
	}
	if rec := adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"host","name":"x"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("host group status=%d want 400", rec.Code)
	}
	if rec := adminJSONRequest(t, server, http.MethodGet, "/api/groups?type=user", seller, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Resellers") {
		t.Fatalf("standard list status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodGet, "/api/groups?type=admin", seller, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("standard admin group list status=%d want 403", rec.Code)
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM entity_groups`, 1)
}

func TestUserGroupTagsFilterAndBulkActions(t *testing.T) {
	server, db, owner := testUserMutationServer(t)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, data_limit, created_at) VALUES
		(1, 'alpha', 1, 'active', 1, 'ka', 1000, '2026-06-05 00:00:00'),
		(2, 'beta', 1, 'active', 1, 'kb', 1000, '2026-06-05 00:00:00'),
		(3, 'gamma', 1, 'active', 1, 'kc', 1000, '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"user","name":"vip"}`)
	var group struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &group); err != nil || group.ID == 0 {
		t.Fatalf("group create: %s", rec.Body.String())
	}

	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/user/alpha", owner, `{"group_id":`+itoa(group.ID)+`,"tags":["Gold","  gold ","trial"]}`); rec.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/users?username=alpha", owner, "")
	if !strings.Contains(rec.Body.String(), `"tags":["gold","trial"]`) || !strings.Contains(rec.Body.String(), `"name":"vip"`) {
		t.Fatalf("list misses labels: %s", rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/user/beta", owner, `{"group_id":`+itoa(group.ID)+`,"tags":["trial"]}`); rec.Code != http.StatusOK {
		t.Fatalf("labels status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/user/gamma", owner, `{"group_id":9999}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown group status=%d want 404", rec.Code)
	}

	if got := labelUserNames(t, server, owner, "group_id="+itoa(group.ID)); !sameNames(got, "alpha", "beta") {
		t.Fatalf("group filter = %v", got)
	}
	if got := labelUserNames(t, server, owner, "group_id=none"); !sameNames(got, "gamma") {
		t.Fatalf("no-group filter = %v", got)
	}
	if got := labelUserNames(t, server, owner, "tag=trial"); !sameNames(got, "alpha", "beta") {
		t.Fatalf("tag filter = %v", got)
	}
	if got := labelUserNames(t, server, owner, "tag=trial&tag=gold"); !sameNames(got, "alpha", "beta") {
		t.Fatalf("any tags filter = %v", got)
	}
	if got := labelUserNames(t, server, owner, "tag=trial&tag=gold&tag_match=all"); !sameNames(got, "alpha") {
		t.Fatalf("all tags filter = %v", got)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", owner, `{"action":"increase_traffic","gigabytes":1,"group_ids":[`+itoa(group.ID)+`]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("group bulk status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'alpha'`, 1000+1073741824)
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'beta'`, 1000+1073741824)
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'gamma'`, 1000)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", owner, `{"action":"disable_users","tags":["gold"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("tag bulk status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE status = 'disabled'`, 1)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE username = 'alpha' AND status = 'disabled'`, 1)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", owner, `{"action":"add_tags","group_ids":[`+itoa(group.ID)+`],"target_tags":["promo"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("add tags status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := labelUserNames(t, server, owner, "tag=promo"); !sameNames(got, "alpha", "beta") {
		t.Fatalf("promo filter = %v", got)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", owner, `{"action":"clear_group","tags":["promo"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear group status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := labelUserNames(t, server, owner, "group_id=none"); !sameNames(got, "alpha", "beta", "gamma") {
		t.Fatalf("after clear = %v", got)
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id IN (SELECT id FROM users WHERE username = 'gamma')`, 0)
}

func TestStandardAdminLabelsOnlyOwnUsers(t *testing.T) {
	server, db, owner := testUserMutationServer(t)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, created_at) VALUES
		(30, 'mine', 2, 'active', 1, 'ka', '2026-06-05 00:00:00'),
		(31, 'theirs', 1, 'active', 1, 'kb', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	seller := adminBearerToken(t, server, "seller", "pass123")
	adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"user","name":"vip"}`)

	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/user/mine", seller, `{"group_id":1,"tags":["a"]}`); rec.Code != http.StatusOK {
		t.Fatalf("own user status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/user/theirs", seller, `{"tags":["a"]}`); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign user status=%d want 403", rec.Code)
	}
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/host/1", seller, `{"tags":["a"]}`); rec.Code != http.StatusForbidden {
		t.Fatalf("host status=%d want 403", rec.Code)
	}
	if got := labelUserNames(t, server, seller, "tag=a"); !sameNames(got, "mine") {
		t.Fatalf("standard admin tag filter = %v", got)
	}
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", seller, `{"action":"clear_group","group_ids":[1]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller bulk status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM entity_group_members`, 0)
}

func TestHostAndAdminLabelsAndPurgeOnGroupDelete(t *testing.T) {
	server, db, owner := testUserMutationServer(t)
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/host/1", owner, `{"tags":["edge","EU"]}`); rec.Code != http.StatusOK {
		t.Fatalf("host labels status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/host/77", owner, `{"tags":["edge"]}`); rec.Code != http.StatusNotFound {
		t.Fatalf("missing host status=%d want 404", rec.Code)
	}
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/labels/host", owner, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"1":{"group":null,"tags":["edge","eu"]}`) {
		t.Fatalf("host label map status=%d body=%s", rec.Code, rec.Body.String())
	}
	adminJSONRequest(t, server, http.MethodPost, "/api/groups", owner, `{"type":"admin","name":"staff"}`)
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/admin/seller", owner, `{"group_id":1}`); rec.Code != http.StatusOK {
		t.Fatalf("admin labels status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/admins?group_id=1", owner, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"username":"seller"`) || strings.Contains(rec.Body.String(), `"username":"owner"`) || !strings.Contains(rec.Body.String(), `"name":"staff"`) {
		t.Fatalf("admin list filter status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := adminJSONRequest(t, server, http.MethodDelete, "/api/groups/1", owner, ""); rec.Code != http.StatusOK {
		t.Fatalf("delete group status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM entity_group_members`, 0)
	if rec := adminJSONRequest(t, server, http.MethodPut, "/api/labels/admin/seller", owner, `{"group_id":1}`); rec.Code != http.StatusNotFound {
		t.Fatalf("deleted group status=%d want 404", rec.Code)
	}
}
