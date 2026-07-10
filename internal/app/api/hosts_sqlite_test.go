package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
)

func TestHostsCRUDOnMigratedSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "hosts.sqlite3")
	server, err := New(Config{
		Database:                    "sqlite:///" + filepath.ToSlash(dbPath),
		JWTAccessTokenExpireMinutes: 1440,
		SudoUsername:                "root",
		SudoPassword:                "pass123",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.db.Close() })

	token := sqliteAdminToken(t, server)
	if _, err := server.db.Exec(`INSERT INTO inbounds (tag) VALUES (?)`, "sqlite-in"); err != nil {
		t.Fatal(err)
	}
	if _, err := server.db.Exec(`INSERT INTO services (name) VALUES (?)`, "sqlite-service"); err != nil {
		t.Fatal(err)
	}
	serviceID := sqliteLastID(t, server.db)

	payload := `{"sqlite-in":[{"remark":"one","address":"one.example.com","port":443,"security":"inbound_default","is_disabled":false}]}`
	rec := sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("add host status=%d body=%s", rec.Code, rec.Body.String())
	}
	hostID := sqliteHostID(t, server.db, "one")
	if _, err := server.db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (?, ?, 0)`, serviceID, hostID); err != nil {
		t.Fatal(err)
	}

	payload = `{"sqlite-in":[{"id":` + strconv.FormatInt(hostID, 10) + `,"remark":"two","address":"two.example.com","port":8443,"security":"none","is_disabled":false}]}`
	rec = sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("edit host status=%d body=%s", rec.Code, rec.Body.String())
	}
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM service_hosts WHERE service_id = ? AND host_id = ?`, 1, serviceID, hostID)
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 1)

	payload = `{"sqlite-in":[]}`
	rec = sqliteJSONRequest(server, http.MethodPut, "/api/hosts", token, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete host status=%d body=%s", rec.Code, rec.Body.String())
	}
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM hosts WHERE id = ?`, 0, hostID)
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM service_hosts WHERE service_id = ? AND host_id = ?`, 0, serviceID, hostID)
	sqliteAssertCount(t, server.db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 2)
}

func sqliteAdminToken(t *testing.T, server *Server) string {
	t.Helper()
	rec := sqliteJSONRequest(server, http.MethodPost, "/api/admin/token", "", `{"username":"root","password":"pass123"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return "Bearer " + body.AccessToken
}

func sqliteJSONRequest(server *Server, method string, path string, token string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func sqliteHostID(t *testing.T, db *sql.DB, remark string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(`SELECT id FROM hosts WHERE remark = ?`, remark).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func sqliteLastID(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(`SELECT last_insert_rowid()`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func sqliteAssertCount(t *testing.T, db *sql.DB, query string, want int64, args ...any) {
	t.Helper()
	var got int64
	if err := db.QueryRow(query, args...).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s = %d, want %d", query, got, want)
	}
}
