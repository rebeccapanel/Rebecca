package webhook

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newTestRepo(t *testing.T) Repository {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`CREATE TABLE webhook_events (
		id INTEGER PRIMARY KEY,
		action VARCHAR(64) NOT NULL,
		username VARCHAR(128) NULL,
		payload TEXT NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'pending',
		attempts INTEGER NOT NULL DEFAULT 0,
		last_error TEXT NULL,
		enqueued_at DATETIME NOT NULL,
		send_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	)`)
	if err != nil {
		t.Fatal(err)
	}
	return NewRepository(db, "sqlite")
}

func countByStatus(t *testing.T, repo Repository, status string) int {
	t.Helper()
	var count int
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM webhook_events WHERE status = ?`, status).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestDispatcherDeliversBatchAndMarksSent(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	if err := repo.Enqueue(ctx, Event{Action: ActionUserCreated, Username: "alice", By: "admin", User: map[string]any{"username": "alice"}}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Enqueue(ctx, Event{Action: ActionUserDeleted, Username: "bob", By: "admin"}); err != nil {
		t.Fatal(err)
	}

	var (
		mu       sync.Mutex
		received []map[string]any
		gotSec   string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSec = r.Header.Get("x-webhook-secret")
		body, _ := io.ReadAll(r.Body)
		var batch []map[string]any
		_ = json.Unmarshal(body, &batch)
		mu.Lock()
		received = batch
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := NewDispatcher(repo, Config{Addresses: []string{srv.URL}, Secret: "s3cr3t"})
	if err := d.Dispatch(ctx); err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	if len(received) != 2 {
		t.Fatalf("expected 2 events delivered, got %d", len(received))
	}
	if received[0]["action"] != "user_created" || received[0]["username"] != "alice" {
		t.Fatalf("unexpected first event: %#v", received[0])
	}
	if tries, ok := received[0]["tries"].(float64); !ok || tries != 1 {
		t.Fatalf("expected tries=1, got %#v", received[0]["tries"])
	}
	if gotSec != "s3cr3t" {
		t.Fatalf("expected webhook secret header, got %q", gotSec)
	}
	if sent := countByStatus(t, repo, "sent"); sent != 2 {
		t.Fatalf("expected 2 sent, got %d", sent)
	}
}

func TestDispatcherReschedulesOnFailure(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	if err := repo.Enqueue(ctx, Event{Action: ActionUserCreated, Username: "alice"}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	d := NewDispatcher(repo, Config{Addresses: []string{srv.URL}, MaxRetries: 3, RetryInterval: time.Minute})
	if err := d.Dispatch(ctx); err == nil {
		t.Fatal("expected dispatch error on failure")
	}

	if pending := countByStatus(t, repo, "pending"); pending != 1 {
		t.Fatalf("expected event to stay pending, got %d", pending)
	}
	var attempts int
	if err := repo.db.QueryRow(`SELECT attempts FROM webhook_events WHERE id = 1`).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 {
		t.Fatalf("expected attempts=1, got %d", attempts)
	}
}

func TestDispatcherMarksFailedAfterMaxRetries(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	if err := repo.Enqueue(ctx, Event{Action: ActionUserCreated, Username: "alice"}); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	// MaxRetries=1: a single failed attempt should mark the event failed.
	d := NewDispatcher(repo, Config{Addresses: []string{srv.URL}, MaxRetries: 1, RetryInterval: time.Millisecond})
	_ = d.Dispatch(ctx)

	if failed := countByStatus(t, repo, "failed"); failed != 1 {
		t.Fatalf("expected 1 failed event, got %d", failed)
	}
}

func TestDispatcherDisabledWhenNoAddresses(t *testing.T) {
	repo := newTestRepo(t)
	d := NewDispatcher(repo, Config{})
	if d.Enabled() {
		t.Fatal("dispatcher should be disabled with no addresses")
	}
	if err := d.Dispatch(context.Background()); err != nil {
		t.Fatalf("disabled dispatch should be a no-op, got %v", err)
	}
}

func TestDispatcherSucceedsIfAnyEndpointAccepts(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	if err := repo.Enqueue(ctx, Event{Action: ActionUserCreated, Username: "alice"}); err != nil {
		t.Fatal(err)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer bad.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer good.Close()

	d := NewDispatcher(repo, Config{Addresses: []string{bad.URL, good.URL}})
	if err := d.Dispatch(ctx); err != nil {
		t.Fatalf("dispatch should succeed when one endpoint accepts: %v", err)
	}
	if sent := countByStatus(t, repo, "sent"); sent != 1 {
		t.Fatalf("expected 1 sent, got %d", sent)
	}
}
