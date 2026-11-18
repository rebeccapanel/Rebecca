package migrations

import (
	"context"
	"testing"
)

func TestRepairOutboundTrafficIndexMergesDuplicatesAndRestoresUniqueKey(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE outbound_traffic (id INTEGER PRIMARY KEY, outbound_id TEXT NOT NULL, target_id TEXT NOT NULL DEFAULT 'master', uplink BIGINT DEFAULT 0, downlink BIGINT DEFAULT 0);
INSERT INTO outbound_traffic (id, outbound_id, target_id, uplink, downlink) VALUES
 (1, 'a', 'master', 10, 1), (2, 'a', 'master', 5, 2), (3, 'a', 'node:1', 7, 7);`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := repairOutboundTrafficIndex(ctx, db, "sqlite"); err != nil {
			t.Fatal(err)
		}
	}
	var count, up, down int64
	if err := db.QueryRow(`SELECT COUNT(*), SUM(uplink), SUM(downlink) FROM outbound_traffic`).Scan(&count, &up, &down); err != nil {
		t.Fatal(err)
	}
	if count != 2 || up != 22 || down != 10 {
		t.Fatalf("rows=%d up=%d down=%d, want 2/22/10", count, up, down)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO outbound_traffic (outbound_id, target_id) VALUES ('a', 'master')`); err == nil {
		t.Fatal("duplicate (target_id, outbound_id) must be rejected")
	}
}
