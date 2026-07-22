//go:build cgo

package api

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/usage"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

type serviceUsageTestPoint struct {
	Timestamp   string `json:"timestamp"`
	UsedTraffic int64  `json:"used_traffic"`
}

func testServiceServer(t *testing.T) (*Server, *sql.DB, string) {
	t.Helper()
	server, db := testAdminServer(t)
	server.usageService = usage.NewService(usage.NewRepository(db, "sqlite"))
	server.userService = userapp.NewService(userapp.NewRepository(db, "sqlite"))
	statements := []string{
		`ALTER TABLE admins_services ADD COLUMN created_at DATETIME NULL`,
		`ALTER TABLE admins_services ADD COLUMN updated_at DATETIME NULL`,
		`DROP TABLE services`,
		`DROP TABLE hosts`,
		`DROP TABLE service_hosts`,
		`CREATE TABLE services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			description TEXT NULL,
			used_traffic BIGINT DEFAULT 0,
			lifetime_used_traffic BIGINT DEFAULT 0,
			users_usage BIGINT DEFAULT 0,
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE hosts (
			id INTEGER PRIMARY KEY,
			remark TEXT,
			address TEXT,
			port BIGINT NULL,
			path TEXT NULL,
			sni TEXT NULL,
			host TEXT NULL,
			security TEXT NOT NULL DEFAULT 'inbound_default',
			alpn TEXT NOT NULL DEFAULT 'none',
			fingerprint TEXT NOT NULL DEFAULT 'none',
			inbound_tag TEXT,
			allowinsecure INTEGER NULL,
			is_disabled INTEGER DEFAULT 0,
			mux_enable INTEGER NOT NULL DEFAULT 0,
			fragment_setting TEXT NULL,
			noise_setting TEXT NULL,
			random_user_agent INTEGER NOT NULL DEFAULT 0,
			use_sni_as_host INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE service_hosts (
			service_id INTEGER,
			host_id INTEGER,
			sort BIGINT DEFAULT 0,
			created_at DATETIME NULL
		)`,
		`INSERT INTO hosts (id, inbound_tag, remark, address, port, security, alpn, fingerprint, is_disabled, mux_enable, random_user_agent, use_sni_as_host) VALUES
			(1, 'vless-in', 'main', 'example.com', 443, 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(2, 'vmess-in', 'second', 'example.org', 8443, 'inbound_default', 'none', 'none', 0, 0, 0, 0)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	return server, db, adminBearerToken(t, server, "owner", "pass123")
}

func TestServiceMutationRoutesGoNative(t *testing.T) {
	server, db, token := testServiceServer(t)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Basic","description":"entry","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID        int64   `json:"id"`
		HostIDs   []int64 `json:"host_ids"`
		AdminIDs  []int64 `json:"admin_ids"`
		HostCount int64   `json:"host_count"`
		HasHosts  bool    `json:"has_hosts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || len(created.HostIDs) != 1 || len(created.AdminIDs) != 1 || created.HostCount != 1 || !created.HasHosts {
		t.Fatalf("unexpected create response: %#v", created)
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services", sellerToken, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller list status = %d body=%s", rec.Code, rec.Body.String())
	}
	var list struct {
		Total    int64            `json:"total"`
		Services []map[string]any `json:"services"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 1 || len(list.Services) != 1 {
		t.Fatalf("seller list did not scope to assigned service: %#v", list)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID)+"/admins/2/limits", token, `{"data_limit":1000,"show_user_traffic":false,"delete_user_usage_limit_enabled":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("limit update status = %d body=%s", rec.Code, rec.Body.String())
	}
	var adminLimit struct {
		DataLimit                   *int64 `json:"data_limit"`
		ShowUserTraffic             bool   `json:"show_user_traffic"`
		DeleteUserUsageLimitEnabled bool   `json:"delete_user_usage_limit_enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &adminLimit); err != nil {
		t.Fatal(err)
	}
	if adminLimit.DataLimit == nil || *adminLimit.DataLimit != 1000 || adminLimit.ShowUserTraffic || adminLimit.DeleteUserUsageLimitEnabled {
		t.Fatalf("unexpected admin limit response: %#v", adminLimit)
	}

	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id) VALUES (10, 'svc_user', 2, 'active', ?)`, created.ID); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID), token, `{"hosts":[{"host_id":1},{"host_id":2,"sort":1}],"admin_ids":[2],"description":"updated"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user'`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
	assertDBInt64(t, db, `SELECT data_limit FROM admins_services WHERE service_id = ? AND admin_id = 2`, 1000, created.ID)

	if _, err := db.Exec(`UPDATE services SET used_traffic = 500, users_usage = 700, lifetime_used_traffic = 900 WHERE id = ?`, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins_services SET used_traffic = 500, lifetime_used_traffic = 900 WHERE service_id = ? AND admin_id = 2`, created.ID); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/"+itoa(created.ID)+"/reset-usage", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset usage status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT used_traffic FROM services WHERE id = ?`, 0, created.ID)
	assertDBInt64(t, db, `SELECT users_usage FROM services WHERE id = ?`, 0, created.ID)
	assertDBInt64(t, db, `SELECT lifetime_used_traffic FROM services WHERE id = ?`, 900, created.ID)
	assertDBInt64(t, db, `SELECT used_traffic FROM admins_services WHERE service_id = ? AND admin_id = 2`, 0, created.ID)
	assertDBInt64(t, db, `SELECT lifetime_used_traffic FROM admins_services WHERE service_id = ? AND admin_id = 2`, 900, created.ID)

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/"+itoa(created.ID), token, `{"mode":"delete_users","unlink_admins":true}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM users WHERE id = 10`, "deleted")
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'remove_user' AND user_id = 10`, 0)
}

func TestServiceAdminLimitUpdatePersistsAllLimitFields(t *testing.T) {
	server, db, token := testServiceServer(t)
	setAdminUserPermissions(t, db, 2, func(perms *adminapp.AdminPermissions) {
		perms.Users.Delete = true
	})

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"LimitFields","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID)+"/admins/2/limits", token, `{
		"traffic_limit_mode":"created_traffic",
		"data_limit":2048,
		"users_limit":3,
		"show_user_traffic":false,
		"delete_user_usage_limit_enabled":true,
		"delete_user_usage_limit":512
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("limit update status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body serviceAdminResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TrafficLimitMode != adminapp.TrafficLimitCreatedTraffic ||
		body.DataLimit == nil || *body.DataLimit != 2048 ||
		body.UsersLimit == nil || *body.UsersLimit != 3 ||
		body.ShowUserTraffic ||
		!body.DeleteUserUsageLimitEnabled ||
		body.DeleteUserUsageLimit == nil || *body.DeleteUserUsageLimit != 512 {
		t.Fatalf("unexpected limit response: %#v", body)
	}
	assertDBString(t, db, `SELECT traffic_limit_mode FROM admins_services WHERE admin_id = 2 AND service_id = ?`, "created_traffic", created.ID)
	assertDBInt64(t, db, `SELECT data_limit FROM admins_services WHERE admin_id = 2 AND service_id = ?`, 2048, created.ID)
	assertDBInt64(t, db, `SELECT users_limit FROM admins_services WHERE admin_id = 2 AND service_id = ?`, 3, created.ID)
	assertDBInt64(t, db, `SELECT show_user_traffic FROM admins_services WHERE admin_id = 2 AND service_id = ?`, 0, created.ID)
	assertDBInt64(t, db, `SELECT delete_user_usage_limit_enabled FROM admins_services WHERE admin_id = 2 AND service_id = ?`, 1, created.ID)
	assertDBInt64(t, db, `SELECT delete_user_usage_limit FROM admins_services WHERE admin_id = 2 AND service_id = ?`, 512, created.ID)
}

func TestServiceUsageAnalyticsRoutes(t *testing.T) {
	server, db, token := testServiceServer(t)
	insertMasterAPIAdmin(t, db, 3, "idle-admin", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO services (id, name, used_traffic, lifetime_used_traffic, users_usage) VALUES (77, 'UsageSvc', 0, 0, 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO admins_services (admin_id, service_id) VALUES (2, 77), (3, 77)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, service_id, status) VALUES
		(701, 'usage_a', 2, 77, 'active'),
		(702, 'usage_unassigned', NULL, 77, 'active'),
		(703, 'usage_deleted', 2, 77, 'deleted'),
		(704, 'usage_other_service', 2, 78, 'active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES
		('2026-06-01 01:15:00.000000', 701, NULL, 100),
		('2026-06-01 01:45:00.000000', 701, NULL, 200),
		('2026-06-01 02:00:00.000000', 702, NULL, 50),
		('2026-06-01 03:00:00.000000', 703, NULL, 999),
		('2026-06-02 04:00:00.000000', 701, NULL, 300),
		('2026-06-01 05:00:00.000000', 704, NULL, 777)`); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/77/usage/timeseries?start=2026-06-01T00:00:00Z&end=2026-06-02T23:59:59Z&granularity=day", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("timeseries status = %d body=%s", rec.Code, rec.Body.String())
	}
	var series struct {
		ServiceID   int64                   `json:"service_id"`
		Granularity string                  `json:"granularity"`
		Points      []serviceUsageTestPoint `json:"points"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &series); err != nil {
		t.Fatal(err)
	}
	if series.ServiceID != 77 || series.Granularity != "day" {
		t.Fatalf("unexpected timeseries metadata: %#v", series)
	}
	if usagePoint(series.Points, "2026-06-01T00:00:00Z") != 350 || usagePoint(series.Points, "2026-06-02T00:00:00Z") != 300 {
		t.Fatalf("unexpected day points: %#v", series.Points)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/77/usage/timeseries?start=2026-06-01T00:00:00Z&end=2026-06-01T03:00:00Z&granularity=hour", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("hourly status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &series); err != nil {
		t.Fatal(err)
	}
	if series.Granularity != "hour" || usagePoint(series.Points, "2026-06-01T01:00:00Z") != 300 || usagePoint(series.Points, "2026-06-01T02:00:00Z") != 50 {
		t.Fatalf("unexpected hour points: %#v", series.Points)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/77/usage/admins?start=2026-06-01T00:00:00Z&end=2026-06-02T23:59:59Z", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("admins usage status = %d body=%s", rec.Code, rec.Body.String())
	}
	var adminsBody struct {
		Admins []struct {
			AdminID     *int64 `json:"admin_id"`
			Username    string `json:"username"`
			UsedTraffic int64  `json:"used_traffic"`
		} `json:"admins"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &adminsBody); err != nil {
		t.Fatal(err)
	}
	if len(adminsBody.Admins) != 3 {
		t.Fatalf("expected usage rows for used, unassigned, and linked zero admin: %#v", adminsBody.Admins)
	}
	if adminsBody.Admins[0].AdminID == nil || *adminsBody.Admins[0].AdminID != 2 || adminsBody.Admins[0].UsedTraffic != 1599 {
		t.Fatalf("unexpected primary admin usage: %#v", adminsBody.Admins)
	}
	if adminsBody.Admins[1].AdminID != nil || adminsBody.Admins[1].UsedTraffic != 50 {
		t.Fatalf("unexpected unassigned usage: %#v", adminsBody.Admins)
	}
	if adminsBody.Admins[2].AdminID == nil || *adminsBody.Admins[2].AdminID != 3 || adminsBody.Admins[2].UsedTraffic != 0 {
		t.Fatalf("expected linked zero usage admin: %#v", adminsBody.Admins)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/77/usage/admin-timeseries?admin_id=2&start=2026-06-01T00:00:00Z&end=2026-06-02T23:59:59Z&granularity=day", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin timeseries status = %d body=%s", rec.Code, rec.Body.String())
	}
	var adminSeries struct {
		AdminID     *int64                  `json:"admin_id"`
		Username    string                  `json:"username"`
		Granularity string                  `json:"granularity"`
		Points      []serviceUsageTestPoint `json:"points"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &adminSeries); err != nil {
		t.Fatal(err)
	}
	if adminSeries.AdminID == nil || *adminSeries.AdminID != 2 || adminSeries.Username != "seller" || adminSeries.Granularity != "day" {
		t.Fatalf("unexpected admin timeseries metadata: %#v", adminSeries)
	}
	if usagePoint(adminSeries.Points, "2026-06-01T00:00:00Z") != 1299 || usagePoint(adminSeries.Points, "2026-06-02T00:00:00Z") != 300 {
		t.Fatalf("unexpected admin timeseries points: %#v", adminSeries.Points)
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/77/usage/timeseries", sellerToken, `{}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard admin usage status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServiceHostOrderingAndDetailResponse(t *testing.T) {
	server, _, token := testServiceServer(t)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Ordered","hosts":[{"host_id":2,"sort":0},{"host_id":1,"sort":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created serviceDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || !created.HasHosts || created.Broken {
		t.Fatalf("unexpected create base response: %#v", created.serviceBaseResponse)
	}
	assertInt64Slice(t, created.HostIDs, []int64{2, 1})
	assertInt64Slice(t, created.AdminIDs, []int64{2})
	if len(created.Hosts) != 2 || created.Hosts[0].ID != 2 || created.Hosts[0].Sort != 0 || created.Hosts[1].ID != 1 || created.Hosts[1].Sort != 1 {
		t.Fatalf("unexpected host detail response: %#v", created.Hosts)
	}
	if len(created.Admins) != 1 || created.Admins[0].ID != 2 || created.Admins[0].Username != "seller" {
		t.Fatalf("unexpected admin detail response: %#v", created.Admins)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID), token, `{"hosts":[{"host_id":1,"sort":0},{"host_id":2,"sort":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reorder status = %d body=%s", rec.Code, rec.Body.String())
	}
	var reordered serviceDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &reordered); err != nil {
		t.Fatal(err)
	}
	assertInt64Slice(t, reordered.HostIDs, []int64{1, 2})
	if len(reordered.Hosts) != 2 || reordered.Hosts[0].ID != 1 || reordered.Hosts[1].ID != 2 {
		t.Fatalf("unexpected reordered hosts: %#v", reordered.Hosts)
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
}

func TestServiceDuplicateHostDenied(t *testing.T) {
	server, _, token := testServiceServer(t)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"DuplicateHosts","hosts":[{"host_id":1},{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate create status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Duplicate host ids") {
		t.Fatalf("unexpected duplicate create body: %s", rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"NoDuplicate","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID), token, `{"hosts":[{"host_id":1},{"host_id":1}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate update status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServiceDisabledHostMarksServiceBroken(t *testing.T) {
	server, db, token := testServiceServer(t)
	if _, err := db.Exec(`UPDATE hosts SET is_disabled = 1 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"DisabledHost","hosts":[{"host_id":2}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created serviceDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	assertInt64Slice(t, created.HostIDs, []int64{2})
	if len(created.Hosts) != 0 {
		t.Fatalf("disabled host should be omitted from active hosts: %#v", created.Hosts)
	}
	if created.HostCount != 0 || created.HasHosts || !created.Broken {
		t.Fatalf("disabled host should mark service broken: %#v", created.serviceBaseResponse)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/v2/services/"+itoa(created.ID), token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("detail status = %d body=%s", rec.Code, rec.Body.String())
	}
	var detail serviceDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	assertInt64Slice(t, detail.HostIDs, []int64{2})
	if len(detail.Hosts) != 0 || detail.HasHosts || !detail.Broken {
		t.Fatalf("unexpected disabled host detail: %#v", detail)
	}
}

func TestServiceDeleteTransferUsersEnqueuesOperations(t *testing.T) {
	server, db, token := testServiceServer(t)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Source","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("source create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var source struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Target","hosts":[{"host_id":2}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("target create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var target struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id) VALUES
		(20, 'transfer_a', 2, 'active', ?),
		(21, 'transfer_b', 2, 'limited', ?)`, source.ID, source.ID); err != nil {
		t.Fatal(err)
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/"+itoa(source.ID), token, `{"mode":"transfer_users","target_service_id":`+itoa(target.ID)+`,"unlink_admins":true}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("transfer delete status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM services WHERE id = ?`, 0, source.ID)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE service_id = ?`, 2, target.ID)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id IN (20, 21)`, 2)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
}

func TestServiceDeleteEmptyService(t *testing.T) {
	server, db, token := testServiceServer(t)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Empty","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/"+itoa(created.ID), token, `{"mode":"delete_users","unlink_admins":true}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM services WHERE id = ?`, 0, created.ID)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM admins_services WHERE service_id = ?`, 0, created.ID)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'remove_user'`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
}

func TestServiceMutationRollsBackWhenNodeOperationFails(t *testing.T) {
	server, db, token := testServiceServer(t)
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"Rollback","hosts":[{"host_id":1}]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id) VALUES (11, 'rollback_user', 1, 'active', ?)`, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID), token, `{"hosts":[{"host_id":1},{"host_id":2}]}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected update to fail when node_operations is missing")
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM service_hosts WHERE service_id = ?`, 1, created.ID)
}

func TestServiceDeleteRollsBackWhenNodeOperationFails(t *testing.T) {
	server, db, token := testServiceServer(t)
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"DeleteRollback","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id) VALUES (12, 'delete_rollback_user', 2, 'active', ?)`, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatal(err)
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/"+itoa(created.ID), token, `{"mode":"delete_users","unlink_admins":true}`)
	if rec.Code == http.StatusNoContent {
		t.Fatalf("expected delete to fail when node_operations is missing")
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM services WHERE id = ?`, 1, created.ID)
	assertDBString(t, db, `SELECT status FROM users WHERE id = 12`, "active")
}

func TestServiceHostChangeKeepsSubscriptionLinkAndChangesConfigOutput(t *testing.T) {
	server, db, token := testServiceServer(t)
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN credential_key TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN used_traffic BIGINT DEFAULT 0`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN data_limit BIGINT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN data_limit_reset_strategy TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN online_at DATETIME NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN note TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN telegram_id TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN contact_number TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN sub_updated_at DATETIME NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN sub_last_user_agent TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN created_at DATETIME NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN flow TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN expire BIGINT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN on_hold_expire_duration BIGINT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN ip_limit INTEGER DEFAULT 0`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN auto_delete_in_days INTEGER NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN subadress TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE jwt ADD COLUMN subscription_secret_key TEXT DEFAULT 'sub-secret'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE jwt ADD COLUMN vmess_mask TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE jwt ADD COLUMN vless_mask TEXT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE panel_settings (id INTEGER PRIMARY KEY, default_subscription_type TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE subscription_settings (id INTEGER PRIMARY KEY, subscription_url_prefix TEXT, subscription_path TEXT, subscription_ports TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE user_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER, used_traffic_at_reset BIGINT DEFAULT 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, settings TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE next_plans (
		id INTEGER PRIMARY KEY,
		user_id INTEGER,
		position BIGINT DEFAULT 0,
		data_limit BIGINT DEFAULT 0,
		expire BIGINT NULL,
		add_remaining_traffic INTEGER DEFAULT 0,
		fire_on_either INTEGER DEFAULT 1,
		increase_data_limit INTEGER DEFAULT 0,
		start_on_first_connect INTEGER DEFAULT 0,
		trigger_on TEXT DEFAULT 'data_limit'
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO panel_settings (id, default_subscription_type) VALUES (1, 'key')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO subscription_settings (id, subscription_url_prefix, subscription_path, subscription_ports) VALUES (1, 'https://panel.example', 'sub', '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO xray_config (id, data) VALUES (1, ?)`, `{"inbounds":[{"tag":"vless-in","protocol":"vless","port":443,"settings":{"clients":[]},"streamSettings":{"network":"tcp","security":"tls"}},{"tag":"vmess-in","protocol":"vmess","port":8443,"settings":{"clients":[]},"streamSettings":{"network":"tcp","security":"tls"}}]}`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE hosts SET inbound_tag = 'vless-in' WHERE id = 2`); err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services", token, `{"name":"ConfigSvc","hosts":[{"host_id":1}],"admin_ids":[2]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, service_id, credential_key, used_traffic, data_limit, created_at) VALUES (30, 'config_user', 2, 'active', ?, '0123456789abcdef0123456789abcdef', 0, 1000, '2026-06-05 00:00:00')`, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO proxies (id, user_id, type, settings) VALUES (30, 30, 'vless', '{"id":"11111111-1111-4111-8111-111111111111"}')`); err != nil {
		t.Fatal(err)
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = userReadRequest(t, server, http.MethodGet, "/api/user/config_user", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("get user before host change status = %d body=%s", rec.Code, rec.Body.String())
	}
	beforeURL := subscriptionURLFromResponse(t, rec.Body.Bytes())
	beforeConfig := decodeSubscriptionBody(subscriptionBody(t, server, beforeURL))
	if !strings.Contains(beforeConfig, "example.com") || strings.Contains(beforeConfig, "example.org") {
		t.Fatalf("unexpected config before host change: %s", beforeConfig)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/v2/services/"+itoa(created.ID), token, `{"hosts":[{"host_id":2}],"admin_ids":[2]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update hosts status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user'`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)

	rec = userReadRequest(t, server, http.MethodGet, "/api/user/config_user", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("get user after host change status = %d body=%s", rec.Code, rec.Body.String())
	}
	afterURL := subscriptionURLFromResponse(t, rec.Body.Bytes())
	if afterURL != beforeURL {
		t.Fatalf("subscription URL changed after service host update: before=%q after=%q", beforeURL, afterURL)
	}
	afterConfig := decodeSubscriptionBody(subscriptionBody(t, server, afterURL))
	if !strings.Contains(afterConfig, "example.org") || strings.Contains(afterConfig, "example.com") {
		t.Fatalf("unexpected config after host change: %s", afterConfig)
	}
}

func TestServiceUsersReadRouteGoNative(t *testing.T) {
	server, db := testUserReadServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 3, "outsider", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (7, 'service-users')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO admins_services (admin_id, service_id) VALUES (2, 7)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (
		id, username, admin_id, status, credential_key, used_traffic, created_at, data_limit, service_id
	) VALUES
		(70, 'svc_owner_user', 1, 'active', 'key-owner', 100, '2026-06-05 00:00:00', 1000, 7),
		(71, 'svc_seller_user', 2, 'active', 'key-seller', 200, '2026-06-05 00:00:01', 1000, 7),
		(72, 'other_service_user', 2, 'active', 'key-other', 300, '2026-06-05 00:00:02', 1000, NULL)`); err != nil {
		t.Fatal(err)
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec := userReadRequest(t, server, http.MethodGet, "/api/v2/services/7/users?limit=10", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller service users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Users []struct {
			Username         string            `json:"username"`
			SubscriptionURL  string            `json:"subscription_url"`
			SubscriptionURLs map[string]string `json:"subscription_urls"`
		} `json:"users"`
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 1 || len(body.Users) != 1 {
		t.Fatalf("expected seller-owned service user, got %#v", body)
	}
	seen := map[string]bool{}
	for _, item := range body.Users {
		seen[item.Username] = true
		if item.SubscriptionURL == "" {
			t.Fatalf("missing subscription_url for %#v", item)
		}
	}
	if seen["svc_owner_user"] || !seen["svc_seller_user"] || seen["other_service_user"] {
		t.Fatalf("unexpected service users: %#v", seen)
	}

	outsiderToken := adminBearerToken(t, server, "outsider", "pass123")
	rec = userReadRequest(t, server, http.MethodGet, "/api/v2/services/7/users", outsiderToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("outsider status = %d body=%s", rec.Code, rec.Body.String())
	}

	ownerToken := adminBearerToken(t, server, "owner", "pass123")
	rec = userReadRequest(t, server, http.MethodGet, "/api/v2/services/7/users?limit=10", ownerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner service users status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 2 || len(body.Users) != 2 {
		t.Fatalf("expected full-access owner to see both service users, got %#v", body)
	}

	rec = userReadRequest(t, server, http.MethodGet, "/api/v2/services/404/users", ownerToken)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing service status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func itoa(value int64) string {
	return strconv.FormatInt(value, 10)
}

func assertInt64Slice(t *testing.T, got []int64, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("slice length mismatch: got=%v want=%v", got, want)
	}
	for index := range got {
		if got[index] != want[index] {
			t.Fatalf("slice mismatch: got=%v want=%v", got, want)
		}
	}
}

func usagePoint(points []serviceUsageTestPoint, timestamp string) int64 {
	for _, point := range points {
		if point.Timestamp == timestamp {
			return point.UsedTraffic
		}
	}
	return 0
}

func subscriptionURLFromResponse(t *testing.T, raw []byte) string {
	t.Helper()
	var body struct {
		SubscriptionURL string `json:"subscription_url"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.SubscriptionURL == "" {
		t.Fatalf("missing subscription_url in %s", string(raw))
	}
	return body.SubscriptionURL
}

func subscriptionBody(t *testing.T, server *Server, rawURL string) string {
	t.Helper()
	path := rawURL
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		parts := strings.SplitN(rawURL, "://", 2)
		slash := strings.Index(parts[1], "/")
		if slash < 0 {
			t.Fatalf("subscription URL has no path: %s", rawURL)
		}
		path = parts[1][slash:]
	}
	rec := userReadRequest(t, server, http.MethodGet, path, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("subscription status = %d body=%s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

func decodeSubscriptionBody(body string) string {
	raw := strings.TrimSpace(body)
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		return string(decoded)
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(raw); err == nil {
		return string(decoded)
	}
	return body
}
