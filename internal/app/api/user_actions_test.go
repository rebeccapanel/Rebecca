//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

func testUserMutationServer(t *testing.T) (*Server, *sql.DB, string) {
	t.Helper()
	server, db := testUserReadServer(t)
	server.userService = userapp.NewService(userapp.NewRepository(db, "sqlite"))
	extra := []string{
		`ALTER TABLE users ADD COLUMN sub_revoked_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN edit_at DATETIME NULL`,
		`ALTER TABLE user_usage_logs ADD COLUMN reset_at DATETIME NULL`,
		`ALTER TABLE admins_services ADD COLUMN updated_at DATETIME NULL`,
		`CREATE TABLE IF NOT EXISTS inbounds (id INTEGER PRIMARY KEY, tag TEXT UNIQUE)`,
		`INSERT INTO xray_config (id, data) VALUES (1, '{"inbounds":[{"tag":"vless-in","protocol":"vless","port":443,"settings":{"decryption":"none"},"streamSettings":{"network":"tcp","security":"none","tcpSettings":{"header":{"type":"none"}}}}]}')`,
		`INSERT INTO services (id, name) VALUES (1, 'basic')`,
		`INSERT INTO hosts (id, inbound_tag, remark, address, is_disabled) VALUES (1, 'vless-in', 'main', 'example.com', 0)`,
		`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (1, 1, 0)`,
		`INSERT INTO inbounds (id, tag) VALUES (1, 'vless-in')`,
		`INSERT INTO nodes (id, name, status) VALUES (1, 'node-1', 'connected')`,
	}
	for _, statement := range extra {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	return server, db, adminBearerToken(t, server, "owner", "pass123")
}

func TestUserMutationCreateUpdateDeleteQueuesOperations(t *testing.T) {
	server, db, token := testUserMutationServer(t)

	rec := userReadRequest(t, server, http.MethodPost, "/api/user", token)
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user", token, `{"username":"go_user","service_id":1,"data_limit":1000}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertUserOperationCount(t, db, "add_user", "go_user", 1)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user", token, `{"username":"go_user","service_id":1}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user", token, `{"username":"proxy_payload","service_id":1,"proxies":{"vless":{"id":"11111111-1111-4111-8111-111111111111"}}}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("proxies create status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT credential_key FROM users WHERE username = 'proxy_payload'`, "11111111111141118111111111111111")
	assertDBInt64(t, db, `SELECT COUNT(*) FROM proxies WHERE user_id = (SELECT id FROM users WHERE username = 'proxy_payload')`, 0)

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/user/go_user", token, `{"status":"disabled","data_limit":2000}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertUserOperationCount(t, db, "disable_user", "go_user", 1)
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'go_user'`, 2000)

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/users/go_user", token, `{"status":"active"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("v2 update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertUserOperationCount(t, db, "enable_user", "go_user", 1)

	if _, err := db.Exec(`UPDATE users SET status = 'limited', used_traffic = 1500, data_limit = 1000 WHERE username = 'go_user'`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/user/go_user", token, `{"data_limit":2000}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("limited traffic update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'go_user'`, "active")
	assertUserOperationCount(t, db, "enable_user", "go_user", 2)

	if _, err := db.Exec(`UPDATE users SET status = 'expired', expire = 1000 WHERE username = 'go_user'`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/user/go_user", token, `{"expire":2000000000}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expired time update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'go_user'`, "active")
	assertUserOperationCount(t, db, "enable_user", "go_user", 3)

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/user/go_user", token, `{"proxies":{"vless":{"id":"11111111-1111-4111-8111-111111111111"}}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("proxies update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT credential_key FROM users WHERE username = 'go_user'`, "11111111111141118111111111111111")
	assertDBInt64(t, db, `SELECT COUNT(*) FROM proxies WHERE user_id = (SELECT id FROM users WHERE username = 'go_user')`, 0)

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/user/go_user", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertUserOperationCount(t, db, "remove_user", "go_user", 1)
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'go_user'`, "deleted")
}

func TestUserMutationResetRevokeAndActiveNext(t *testing.T) {
	server, db, token := testUserMutationServer(t)
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/user", token, `{"username":"plan_user","service_id":1,"data_limit":1000}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	if _, err := db.Exec(`UPDATE users SET used_traffic = 500 WHERE username = 'plan_user'`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user/plan_user/reset", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT used_traffic FROM users WHERE username = 'plan_user'`, 0)
	assertUserOperationAtLeast(t, db, "update_user", "plan_user", 1)

	var oldKey string
	if err := db.QueryRow(`SELECT credential_key FROM users WHERE username = 'plan_user'`).Scan(&oldKey); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user/plan_user/revoke_sub", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke status = %d body=%s", rec.Code, rec.Body.String())
	}
	var newKey string
	if err := db.QueryRow(`SELECT credential_key FROM users WHERE username = 'plan_user'`).Scan(&newKey); err != nil {
		t.Fatal(err)
	}
	if oldKey == newKey {
		t.Fatalf("expected credential key to rotate")
	}

	userID := assertUserID(t, db, "plan_user")
	if _, err := db.Exec(`INSERT INTO next_plans (user_id, position, data_limit, expire, add_remaining_traffic, fire_on_either, trigger_on) VALUES (?, 0, 4096, NULL, 0, 1, 'either')`, userID); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/user/plan_user/active-next", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("active-next status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'plan_user'`, 4096)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM next_plans WHERE user_id = ?`, 0, userID)
}

func TestUserMutationRollsBackWhenNodeOperationFails(t *testing.T) {
	server, db, token := testUserMutationServer(t)
	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/user", token, `{"username":"rollback_user","service_id":1,"data_limit":1000}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected create to fail when operation enqueue fails")
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE username = 'rollback_user'`, 0)
}

func TestUsersBulkActionsGoNative(t *testing.T) {
	server, db, token := testUserMutationServer(t)
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (2, 'premium')`); err != nil {
		t.Fatal(err)
	}
	now := "2026-06-05 00:00:00"
	old := "2020-01-01 00:00:00"
	if _, err := db.Exec(`
INSERT INTO users (id, username, admin_id, status, credential_key, used_traffic, data_limit, expire, created_at, last_status_change, service_id)
VALUES
	(20, 'bulk_a', 1, 'active', 'ka', 100, 1024, 2000000000, ?, ?, 1),
	(21, 'bulk_b', 1, 'active', 'kb', 100, 2048, 2000000000, ?, ?, 1),
	(22, 'bulk_c', 1, 'expired', 'kc', 100, 4096, 1000000000, ?, ?, NULL)`,
		now, now, now, now, now, old,
	); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", token, `{"action":"increase_traffic","gigabytes":1,"service_id":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("increase bulk status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'bulk_a'`, 1024+1073741824)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id IN (20, 21)`, 2)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"disable_users"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("service disable bulk status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'bulk_a'`, "disabled")
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'bulk_c'`, "expired")

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", token, `{"action":"change_service","admin_username":"owner","service_id":1,"target_service_id":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("change service bulk status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT service_id FROM users WHERE username = 'bulk_b'`, 2)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/users/actions", token, `{"action":"cleanup_status","days":1,"statuses":["expired"],"service_id_is_null":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("cleanup bulk status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'bulk_c'`, "deleted")
}

func TestServiceScopedBulkActionsGoNative(t *testing.T) {
	server, db, token := testUserMutationServer(t)
	seedServiceForAdmin(t, db, 1, "source", 1, ``, ``)
	seedServiceForAdmin(t, db, 2, "target", 1, ``, ``)
	now := "2026-06-05 00:00:00"
	old := "2020-01-01 00:00:00"
	if _, err := db.Exec(`
INSERT INTO users (id, username, admin_id, status, credential_key, used_traffic, data_limit, expire, created_at, last_status_change, service_id)
VALUES
	(80, 'svc_bulk_active', 1, 'active', 'ka', 100, 1073741824, 2000000000, ?, ?, 1),
	(81, 'svc_bulk_disabled', 1, 'disabled', 'kb', 100, 1073741824, 2000000000, ?, ?, 1),
	(82, 'svc_bulk_expired', 1, 'expired', 'kc', 100, 1073741824, 1000000000, ?, ?, 1),
	(83, 'svc_bulk_other', 1, 'active', 'kd', 100, 1073741824, 2000000000, ?, ?, 2)`,
		now, now, now, now, now, old, now, now,
	); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"extend_expire","days":2,"scope":["active"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("extend status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT expire FROM users WHERE username = 'svc_bulk_active'`, 2000000000+2*86400)
	assertDBInt64(t, db, `SELECT expire FROM users WHERE username = 'svc_bulk_other'`, 2000000000)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"reduce_expire","days":1,"scope":["active"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reduce status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT expire FROM users WHERE username = 'svc_bulk_active'`, 2000000000+86400)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"increase_traffic","gigabytes":1,"scope":["active"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("increase traffic status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'svc_bulk_active'`, 2*1073741824)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"decrease_traffic","gigabytes":0.5,"scope":["active"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("decrease traffic status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT data_limit FROM users WHERE username = 'svc_bulk_active'`, 2*1073741824-536870912)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"cleanup_status","days":1,"statuses":["expired"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("cleanup status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'svc_bulk_expired'`, "deleted")

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"disable_users"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'svc_bulk_active'`, "disabled")

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"activate_users"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("activate status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'svc_bulk_active'`, "active")
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'svc_bulk_disabled'`, "active")

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"change_service","admin_username":"owner","target_service_id":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("change service status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE service_id = 2 AND username IN ('svc_bulk_active', 'svc_bulk_disabled')`, 2)
	assertDBInt64(t, db, `SELECT service_id FROM users WHERE username = 'svc_bulk_other'`, 2)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user'`, 10)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
}

func TestServiceScopedBulkActionsRespectStandardAdminScope(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	seedServiceForAdmin(t, db, 1, "assigned", 2, ``, ``)
	seedServiceForAdmin(t, db, 2, "unassigned", 0, ``, ``)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, created_at) VALUES
		(84, 'seller_assigned', 2, 'active', 1, 'ka', '2026-06-05 00:00:00'),
		(85, 'seller_unassigned', 2, 'active', 2, 'kb', '2026-06-05 00:00:00'),
		(86, 'owner_assigned', 1, 'active', 1, 'kc', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	rec := userReadRequest(t, server, http.MethodGet, "/api/v2/services/1/users?limit=10", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("service users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var list struct {
		Total int64 `json:"total"`
		Users []struct {
			Username string `json:"username"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 1 || len(list.Users) != 1 || list.Users[0].Username != "seller_assigned" {
		t.Fatalf("unexpected standard service users list: %#v", list)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", sellerToken, `{"action":"disable_users"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller service action status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'seller_assigned'`, "disabled")
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'owner_assigned'`, "active")

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/2/users/actions", sellerToken, `{"action":"disable_users"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unassigned service action status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServiceScopedBulkActivateHonorsPerServiceLimits(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "limited", 2, `traffic_limit_mode, data_limit, used_traffic, users_limit`, `'used_traffic', 1000, 0, 1`)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, created_at) VALUES
		(87, 'already_active_service_user', 2, 'active', 1, 'ka', '2026-06-05 00:00:00'),
		(88, 'disabled_service_user', 2, 'disabled', 1, 'kb', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	ownerToken := adminBearerToken(t, server, "owner", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", ownerToken, `{"action":"activate_users"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("users limit status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'disabled_service_user'`, "disabled")

	if _, err := db.Exec(`UPDATE admins_services SET users_limit = NULL, used_traffic = 1000 WHERE admin_id = 2 AND service_id = 1`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", ownerToken, `{"action":"activate_users"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("service traffic cap status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'disabled_service_user'`, "disabled")
}

func TestServiceScopedBulkActionRollsBackWhenNodeOperationFails(t *testing.T) {
	server, db, token := testUserMutationServer(t)
	seedServiceForAdmin(t, db, 1, "rollback-service", 1, ``, ``)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, created_at) VALUES
		(89, 'service_rollback_user', 1, 'active', 1, 'rollback-key', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/1/users/actions", token, `{"action":"disable_users"}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected service-scoped action to fail when operation enqueue fails")
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'service_rollback_user'`, "active")
}

func TestServiceAdminLimitsEnforcedForUserCreate(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "limited", 2, `traffic_limit_mode, data_limit, used_traffic, users_limit`, `'used_traffic', 100, 0, 1`)
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id) VALUES (40, 'already_active', 2, 'active', 1)`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sellerToken, `{"username":"too_many","service_id":1,"data_limit":50}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("users_limit status = %d body=%s", rec.Code, rec.Body.String())
	}

	if _, err := db.Exec(`UPDATE users SET status = 'on_hold' WHERE id = 40`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sellerToken, `{"username":"too_many_on_hold","service_id":1,"data_limit":50}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("on-hold users_limit status = %d body=%s", rec.Code, rec.Body.String())
	}

	if _, err := db.Exec(`UPDATE users SET status = 'disabled' WHERE id = 40`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins_services SET used_traffic = 100, users_limit = NULL WHERE admin_id = 2 AND service_id = 1`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sellerToken, `{"username":"used_cap","service_id":1,"data_limit":50}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("used traffic cap status = %d body=%s", rec.Code, rec.Body.String())
	}

	if _, err := db.Exec(`UPDATE admins_services SET traffic_limit_mode = 'created_traffic', data_limit = 1000, used_traffic = 0, created_traffic = 900 WHERE admin_id = 2 AND service_id = 1`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sellerToken, `{"username":"created_cap","service_id":1,"data_limit":200}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("created traffic cap status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sellerToken, `{"username":"created_ok","service_id":1,"data_limit":50}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("created ok status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 1`, 950)
	assertUserOperationCount(t, db, "add_user", "created_ok", 1)
}

func TestServiceAdminLimitsEnforcedForUserServiceTransfer(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "source", 2, `traffic_limit_mode, data_limit, created_traffic`, `'created_traffic', 10000, 500`)
	seedServiceForAdmin(t, db, 2, "target", 2, `traffic_limit_mode, data_limit, created_traffic`, `'created_traffic', 1000, 900`)
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, used_traffic, data_limit, credential_key, created_at) VALUES (41, 'move_me', 2, 'active', 1, 0, 200, 'move-key', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodPut, "/api/user/move_me", sellerToken, `{"service_id":2}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("service transfer created cap status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT service_id FROM users WHERE username = 'move_me'`, 1)
	assertDBInt64(t, db, `SELECT created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 2`, 900)

	if _, err := db.Exec(`UPDATE admins_services SET created_traffic = 100 WHERE admin_id = 2 AND service_id = 2`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/user/move_me", sellerToken, `{"service_id":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("service transfer ok status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT service_id FROM users WHERE username = 'move_me'`, 2)
	assertDBInt64(t, db, `SELECT created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 1`, 300)
	assertDBInt64(t, db, `SELECT created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 2`, 300)
}

func TestServiceAdminUsersLimitEnforcedForActiveServiceTransfer(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "source", 2, `users_limit`, `10`)
	seedServiceForAdmin(t, db, 2, "target", 2, `users_limit`, `1`)
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, used_traffic, data_limit, credential_key) VALUES
		(42, 'target_taken', 2, 'active', 2, 0, 100, 'taken-key'),
		(43, 'active_move', 2, 'active', 1, 0, 100, 'active-key')`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodPut, "/api/user/active_move", sellerToken, `{"service_id":2}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("active transfer users limit status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT service_id FROM users WHERE username = 'active_move'`, 1)
}

func TestServiceAdminShowUserTrafficFalseHidesServiceTraffic(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "hidden-traffic", 2, `traffic_limit_mode, data_limit, show_user_traffic`, `'created_traffic', 10000, 0`)
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, used_traffic, data_limit, credential_key, created_at) VALUES (44, 'hidden_usage', 2, 'active', 1, 777, 1000, 'hidden-key', '2026-06-05 00:00:00')`); err != nil {
		t.Fatal(err)
	}
	rec := userReadRequest(t, server, http.MethodGet, "/api/v2/services/1/users?limit=10", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("service users hidden traffic status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Users []map[string]any `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Users) != 1 || int64(body.Users[0]["used_traffic"].(float64)) != 0 {
		t.Fatalf("expected hidden service traffic, got %#v", body.Users)
	}
	rec = userReadRequest(t, server, http.MethodGet, "/api/v2/services/1/users?sort=used_traffic", sellerToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("service traffic sort status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServiceAdminDeleteUsageLimitAndCredit(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	setAdminUserPermissions(t, db, 2, func(perms *adminapp.AdminPermissions) {
		perms.Users.Delete = true
	})
	enableServiceTrafficAdmin(t, db, 2)
	seedServiceForAdmin(t, db, 1, "delete-cap", 2, `traffic_limit_mode, data_limit, created_traffic, delete_user_usage_limit_enabled, delete_user_usage_limit`, `'created_traffic', 1000, 900, 1, 100`)
	sellerToken := adminBearerToken(t, server, "seller", "pass123")

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, used_traffic, data_limit, credential_key) VALUES
		(45, 'delete_too_big', 2, 'active', 1, 150, 200, 'too-big-key'),
		(46, 'delete_ok', 2, 'active', 1, 80, 200, 'delete-ok-key')`); err != nil {
		t.Fatal(err)
	}
	rec := adminJSONRequest(t, server, http.MethodDelete, "/api/user/delete_too_big", sellerToken, `{}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("delete cap denied status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/user/delete_ok", sellerToken, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete cap ok status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE username = 'delete_ok'`, "deleted")
	assertDBInt64(t, db, `SELECT deleted_users_usage FROM admins_services WHERE admin_id = 2 AND service_id = 1`, 80)
	assertDBInt64(t, db, `SELECT created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 1`, 820)
	assertDBInt64(t, db, `SELECT amount FROM admin_created_traffic_logs WHERE admin_id = 2 AND service_id = 1 AND action = 'user_delete_credit'`, -80)
}

func TestSudoAndFullAccessBypassServiceAssignmentScope(t *testing.T) {
	server, db, _ := testUserMutationServer(t)
	insertMasterAPIAdmin(t, db, 3, "sudoer", "pass123", adminapp.RoleSudo, adminapp.StatusActive)
	seedServiceForAdmin(t, db, 1, "unassigned", 0, ``, ``)

	sudoToken := adminBearerToken(t, server, "sudoer", "pass123")
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", sudoToken, `{"username":"sudo_service_user","service_id":1,"data_limit":100}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("sudo unassigned service create status = %d body=%s", rec.Code, rec.Body.String())
	}

	fullToken := adminBearerToken(t, server, "owner", "pass123")
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/users", fullToken, `{"username":"full_service_user","service_id":1,"data_limit":100}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("full access unassigned service create status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func assertUserOperationCount(t *testing.T, db *sql.DB, op string, username string, want int64) {
	t.Helper()
	assertUserOperationAtLeast(t, db, op, username, want)
	var got int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations no JOIN users u ON u.id = no.user_id WHERE no.operation_type = ? AND u.username = ?`, op, username).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("operation %s for %s count=%d want=%d", op, username, got, want)
	}
}

func assertUserOperationAtLeast(t *testing.T, db *sql.DB, op string, username string, want int64) {
	t.Helper()
	var got int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations no JOIN users u ON u.id = no.user_id WHERE no.operation_type = ? AND u.username = ?`, op, username).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got < want {
		t.Fatalf("operation %s for %s count=%d want at least %d", op, username, got, want)
	}
}

func assertUserID(t *testing.T, db *sql.DB, username string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func assertDBInt64(t *testing.T, db *sql.DB, query string, want int64, args ...any) {
	t.Helper()
	var got int64
	if err := db.QueryRow(query, args...).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("query %q got=%d want=%d", query, got, want)
	}
}

func assertDBString(t *testing.T, db *sql.DB, query string, want string, args ...any) {
	t.Helper()
	var got string
	if err := db.QueryRow(query, args...).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("query %q got=%q want=%q", query, got, want)
	}
}

func decodeBody(t *testing.T, recBody []byte) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recBody, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func enableServiceTrafficAdmin(t *testing.T, db *sql.DB, adminID int64) {
	t.Helper()
	if _, err := db.Exec(`UPDATE admins SET use_service_traffic_limits = 1 WHERE id = ?`, adminID); err != nil {
		t.Fatal(err)
	}
}

func setAdminUserPermissions(t *testing.T, db *sql.DB, adminID int64, mutate func(*adminapp.AdminPermissions)) {
	t.Helper()
	perms := adminapp.RoleDefaultPermissions(adminapp.RoleStandard)
	mutate(&perms)
	raw, err := json.Marshal(perms)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET permissions = ? WHERE id = ?`, string(raw), adminID); err != nil {
		t.Fatal(err)
	}
}

func seedServiceForAdmin(t *testing.T, db *sql.DB, serviceID int64, name string, adminID int64, limitColumns string, limitValues string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (?, ?)`, serviceID, name); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (?, 1, 0)`, serviceID); err != nil {
		t.Fatal(err)
	}
	if adminID <= 0 {
		return
	}
	columns := `admin_id, service_id`
	values := `?, ?`
	args := []any{adminID, serviceID}
	if strings.TrimSpace(limitColumns) != "" {
		columns += `, ` + limitColumns
		values += `, ` + limitValues
	}
	if _, err := db.Exec(`INSERT INTO admins_services (`+columns+`) VALUES (`+values+`)`, args...); err != nil {
		t.Fatal(err)
	}
}
