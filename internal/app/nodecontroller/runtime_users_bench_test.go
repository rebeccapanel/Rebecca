package nodecontroller

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func BenchmarkRuntimeUsers100k(b *testing.B) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(b.TempDir(), "bench.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, credential_key TEXT, flow TEXT, service_id INTEGER, status TEXT NOT NULL, ip_limit INTEGER NOT NULL DEFAULT 0);
CREATE TABLE user_credentials (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, settings TEXT);
CREATE INDEX idx_uc_user ON user_credentials (user_id)`); err != nil {
		b.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	for i := 1; i <= 100000; i++ {
		if _, err := tx.ExecContext(ctx, `INSERT INTO users (id, username, credential_key, service_id, status) VALUES (?, ?, ?, 1, 'active')`, i, fmt.Sprintf("user%d", i), fmt.Sprintf("key%d", i)); err != nil {
			b.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_credentials (user_id, type, settings) VALUES (?, 'vless', '{}')`, i); err != nil {
			b.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	repo := NewRepository(db, "sqlite")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rows, err := repo.RuntimeUsers(ctx)
		if err != nil {
			b.Fatal(err)
		}
		if len(rows) < 100000 {
			b.Fatalf("expected at least 100000 rows, got %d", len(rows))
		}
	}
}
