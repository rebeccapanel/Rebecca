package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
)

func TestOVServiceIDsForInboundIgnoresDisabledHosts(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "wg-active-hosts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE hosts (id INTEGER PRIMARY KEY, inbound_tag TEXT, is_disabled BOOLEAN DEFAULT 0);
CREATE TABLE service_hosts (service_id INTEGER, host_id INTEGER);
INSERT INTO hosts (id, inbound_tag, is_disabled) VALUES (1, 'wg-main', 1), (2, 'wg-main', 0);
INSERT INTO service_hosts (service_id, host_id) VALUES (10, 1), (20, 2);`); err != nil {
		t.Fatal(err)
	}

	got, err := NewRepository(db, "sqlite").OVServiceIDsForInbound(context.Background(), "wg-main")
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{20}; !reflect.DeepEqual(got, want) {
		t.Fatalf("service IDs = %v, want %v", got, want)
	}
}
