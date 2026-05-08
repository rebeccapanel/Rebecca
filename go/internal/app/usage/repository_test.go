package usage

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func testRepository(t *testing.T) Repository {
	t.Helper()

	path := filepath.Join(t.TempDir(), "usage.sqlite3")
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	statements := []string{
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, username TEXT NOT NULL)`,
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT NOT NULL,
			status TEXT NOT NULL,
			admin_id INTEGER,
			service_id INTEGER
		)`,
		`CREATE TABLE node_user_usages (
			id INTEGER PRIMARY KEY,
			created_at DATETIME NOT NULL,
			user_id INTEGER,
			node_id INTEGER,
			used_traffic BIGINT DEFAULT 0
		)`,
		`INSERT INTO nodes (id, name) VALUES (10, 'edge-a'), (11, 'edge-b')`,
		`INSERT INTO admins (id, username) VALUES (1, 'alpha'), (2, 'beta')`,
		`INSERT INTO users (id, username, status, admin_id, service_id) VALUES
			(1, 'u1', 'active', 1, 7),
			(2, 'u2', 'active', 1, 7),
			(3, 'u3', 'deleted', 1, 7),
			(4, 'u4', 'active', NULL, 7),
			(5, 'u5', 'active', 2, 8)`,
		`INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES
			('2026-05-08 09:00:00.000000', 1, NULL, 100),
			('2026-05-08 09:00:00.000000', 1, 10, 200),
			('2026-05-08 10:00:00.000000', 2, NULL, 300),
			('2026-05-08 10:00:00.000000', 2, 10, 400),
			('2026-05-08 11:00:00.000000', 3, 10, 999),
			('2026-05-08 12:00:00.000000', 4, 11, 50),
			('2026-05-08 13:00:00.000000', 5, 11, 600)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			if strings.Contains(err.Error(), "CGO_ENABLED=0") || strings.Contains(err.Error(), "requires cgo") {
				t.Skipf("sqlite driver requires cgo in this environment: %v", err)
			}
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	return NewRepository(db, "sqlite")
}

func testRange(t *testing.T) (time.Time, time.Time) {
	t.Helper()
	start, err := time.Parse(time.RFC3339, "2026-05-08T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	end, err := time.Parse(time.RFC3339, "2026-05-09T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	return start, end
}

func TestAdminUsageByDayAndNodes(t *testing.T) {
	repo := testRepository(t)
	start, end := testRange(t)

	dayRows, err := repo.AdminUsageByDay(context.Background(), 1, nil, "day", start, end)
	if err != nil {
		t.Fatal(err)
	}
	wantDay := []DateUsageRow{{Date: "2026-05-08", UsedTraffic: 1000}}
	if !reflect.DeepEqual(dayRows, wantDay) {
		t.Fatalf("AdminUsageByDay() = %#v, want %#v", dayRows, wantDay)
	}

	masterID := int64(0)
	masterRows, err := repo.AdminUsageByDay(context.Background(), 1, &masterID, "hour", start, end)
	if err != nil {
		t.Fatal(err)
	}
	wantMaster := []DateUsageRow{
		{Date: "2026-05-08 09:00", UsedTraffic: 100},
		{Date: "2026-05-08 10:00", UsedTraffic: 300},
	}
	if !reflect.DeepEqual(masterRows, wantMaster) {
		t.Fatalf("AdminUsageByDay(master) = %#v, want %#v", masterRows, wantMaster)
	}

	nodeRows, err := repo.AdminUsageByNodes(context.Background(), 1, start, end)
	if err != nil {
		t.Fatal(err)
	}
	wantNodes := []NodeTrafficRow{
		{NodeID: nil, NodeName: "Master", Uplink: 0, Downlink: 400},
		{NodeID: int64Ptr(10), NodeName: "edge-a", Uplink: 0, Downlink: 600},
	}
	if !reflect.DeepEqual(nodeRows, wantNodes) {
		t.Fatalf("AdminUsageByNodes() = %#v, want %#v", nodeRows, wantNodes)
	}
}

func TestServiceUsage(t *testing.T) {
	repo := testRepository(t)
	start, end := testRange(t)

	timeseries, err := repo.ServiceUsageTimeseries(context.Background(), 7, "day", start, end)
	if err != nil {
		t.Fatal(err)
	}
	wantTimeseries := []TimeseriesRow{
		{Timestamp: "2026-05-08T00:00:00Z", Date: "2026-05-08", UsedTraffic: 1050},
		{Timestamp: "2026-05-09T00:00:00Z", Date: "2026-05-09", UsedTraffic: 0},
	}
	if !reflect.DeepEqual(timeseries, wantTimeseries) {
		t.Fatalf("ServiceUsageTimeseries() = %#v, want %#v", timeseries, wantTimeseries)
	}

	adminRows, err := repo.ServiceAdminUsage(context.Background(), 7, start, end)
	if err != nil {
		t.Fatal(err)
	}
	wantAdmins := []ServiceAdminUsageRow{
		{AdminID: nil, Username: "No Admin", UsedTraffic: 50},
		{AdminID: int64Ptr(1), Username: "alpha", UsedTraffic: 1999},
	}
	if !reflect.DeepEqual(adminRows, wantAdmins) {
		t.Fatalf("ServiceAdminUsage() = %#v, want %#v", adminRows, wantAdmins)
	}

	unassigned, err := repo.ServiceAdminUsageTimeseries(context.Background(), 7, 0, "hour", start, end)
	if err != nil {
		t.Fatal(err)
	}
	if got := unassigned[12]; got.Timestamp != "2026-05-08T12:00:00Z" || got.UsedTraffic != 50 {
		t.Fatalf("ServiceAdminUsageTimeseries()[12] = %#v", got)
	}
}

func int64Ptr(value int64) *int64 {
	v := value
	return &v
}
