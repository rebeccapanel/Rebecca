//go:build cgo

package notifications

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rebeccapanel/rebecca/internal/app/migrations"
)

var testNow = time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)

func newTestService(t *testing.T) (Service, *sql.DB) {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "notifications.sqlite3")
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := migrations.RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	service := NewService(db, "sqlite")
	service.now = func() time.Time { return testNow }
	return service, db
}

func insertAdmin(t *testing.T, db *sql.DB, id int64, username string, role string, dataLimit int64, usersUsage int64, expire int64) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO admins (id, username, role, status, permissions, data_limit, users_usage, created_traffic, lifetime_usage, deleted_users_usage, expire, traffic_limit_mode, created_by)
VALUES (?, ?, ?, 'active', '{}', ?, ?, 0, 0, 0, ?, 'used_traffic', 'root')`, id, username, role, dataLimit, usersUsage, nullableExpire(expire)); err != nil {
		t.Fatal(err)
	}
}

func nullableExpire(expire int64) any {
	if expire == 0 {
		return nil
	}
	return expire
}

func setUsersUsage(t *testing.T, db *sql.DB, id int64, usage int64) {
	t.Helper()
	if _, err := db.Exec(`UPDATE admins SET users_usage = ? WHERE id = ?`, usage, id); err != nil {
		t.Fatal(err)
	}
}

func inboxTotal(t *testing.T, service Service, adminID int64) int64 {
	t.Helper()
	inbox, err := service.Inbox(context.Background(), adminID, 50, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	return inbox.Total
}

func TestTrafficRuleSendsOnceUntilTheConditionClears(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "alice", "standard", 1000, 850, 0)

	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	inbox, err := service.Inbox(ctx, 1, 10, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if inbox.Total != 1 || inbox.Items[0].Title != "Traffic usage warning" || !strings.Contains(inbox.Items[0].Body, "85%") {
		t.Fatalf("unexpected first notification: %#v", inbox)
	}
	if inbox.Items[0].SenderUsername != SystemSender {
		t.Fatalf("sender = %q, want %q", inbox.Items[0].SenderUsername, SystemSender)
	}

	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 1 {
		t.Fatalf("repeated evaluation sent again: total=%d", got)
	}

	setUsersUsage(t, db, 1, 100)
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	setUsersUsage(t, db, 1, 900)
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 2 {
		t.Fatalf("crossing the threshold again must notify again: total=%d", got)
	}
}

func TestExpiryRuleWarnsOnlyInsideTheThresholdWindow(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "soon", "standard", 0, 0, testNow.Add(2*24*time.Hour).Unix())
	insertAdmin(t, db, 2, "later", "standard", 0, 0, testNow.Add(10*24*time.Hour).Unix())

	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 1 {
		t.Fatalf("admin expiring in 2 days: total=%d, want 1", got)
	}
	if got := inboxTotal(t, service, 2); got != 0 {
		t.Fatalf("admin expiring in 10 days must not be warned: total=%d", got)
	}
	inbox, _ := service.Inbox(ctx, 1, 10, 0, false)
	if !strings.Contains(inbox.Items[0].Body, "2 day(s)") {
		t.Fatalf("body = %q, want the days left", inbox.Items[0].Body)
	}
}

func TestNodeOfflineNotifiesOperatorsOnly(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "sudo", "sudo", 0, 0, 0)
	insertAdmin(t, db, 2, "owner", "full_access", 0, 0, 0)
	insertAdmin(t, db, 3, "standard", "standard", 0, 0, 0)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, address, port, api_port, status) VALUES (7, 'de-7', '127.0.0.1', 62050, 62051, 'error')`); err != nil {
		t.Fatal(err)
	}

	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 1 {
		t.Fatalf("sudo admin total=%d, want 1", got)
	}
	if got := inboxTotal(t, service, 2); got != 1 {
		t.Fatalf("full access admin total=%d, want 1", got)
	}
	if got := inboxTotal(t, service, 3); got != 0 {
		t.Fatalf("standard admin must not receive node alerts: total=%d", got)
	}
	inbox, _ := service.Inbox(ctx, 2, 10, 0, false)
	if !strings.Contains(inbox.Items[0].Body, "de-7") {
		t.Fatalf("body = %q, want the node name", inbox.Items[0].Body)
	}
}

func TestDisabledRuleTracksStateWithoutSending(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "sudo", "sudo", 0, 0, 0)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, address, port, api_port, status) VALUES (7, 'de-7', '127.0.0.1', 62050, 62051, 'error')`); err != nil {
		t.Fatal(err)
	}

	rule, err := service.SaveRule(ctx, RuleNodeOffline, RuleUpdate{Enabled: false, Title: "t", Body: "{node}"})
	if err != nil || rule.Enabled {
		t.Fatalf("disable rule: rule=%#v err=%v", rule, err)
	}
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 0 {
		t.Fatalf("disabled rule sent %d notifications", got)
	}
	if _, err := service.SaveRule(ctx, RuleNodeOffline, RuleUpdate{Enabled: true, Title: "t", Body: "{node}"}); err != nil {
		t.Fatal(err)
	}
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if got := inboxTotal(t, service, 1); got != 0 {
		t.Fatalf("re-enabling replayed an old alert: total=%d", got)
	}
}

func TestSaveRuleOverridesThresholdAndValidates(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "alice", "standard", 1000, 600, 0)

	if _, err := service.SaveRule(ctx, RuleAdminTraffic, RuleUpdate{Enabled: true, Threshold: 50, Title: "Heads up", Body: "{percent}% used"}); err != nil {
		t.Fatal(err)
	}
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	inbox, _ := service.Inbox(ctx, 1, 10, 0, false)
	if inbox.Total != 1 || inbox.Items[0].Body != "60% used" {
		t.Fatalf("custom threshold and template not applied: %#v", inbox)
	}

	rules, err := service.ListRules(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range rules {
		if rule.Key == RuleAdminTraffic && (rule.Threshold != 50 || rule.DefaultThreshold != 80) {
			t.Fatalf("rule = %#v, want threshold 50 and default 80", rule)
		}
	}

	for _, update := range []RuleUpdate{
		{Enabled: true, Threshold: 0, Title: "x", Body: "y"},
		{Enabled: true, Threshold: 101, Title: "x", Body: "y"},
		{Enabled: true, Threshold: 3, Title: "", Body: "y"},
	} {
		if _, err := service.SaveRule(ctx, RuleAdminTraffic, update); !errors.Is(err, ErrInvalid) {
			t.Fatalf("SaveRule(%#v) error = %v, want ErrInvalid", update, err)
		}
	}
	if _, err := service.SaveRule(ctx, "missing", RuleUpdate{Title: "x", Body: "y"}); !errors.Is(err, ErrUnknownRule) {
		t.Fatalf("unknown rule error = %v, want ErrUnknownRule", err)
	}
}

func TestManualSendAndReadState(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "sudo", "sudo", 0, 0, 0)
	insertAdmin(t, db, 2, "alice", "standard", 0, 0, 0)
	insertAdmin(t, db, 3, "bob", "standard", 0, 0, 0)

	id, count, err := service.Send(ctx, Sender{ID: 1, Username: "sudo"}, "Maintenance", "Tonight at 22:00", []int64{2, 3, 2})
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 || count != 2 {
		t.Fatalf("send id=%d recipients=%d, want a notification for 2 recipients", id, count)
	}
	if _, _, err := service.Send(ctx, Sender{ID: 1, Username: "sudo"}, "x", "y", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty recipients error = %v, want ErrInvalid", err)
	}

	inbox, err := service.Inbox(ctx, 2, 10, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if inbox.Unread != 1 || inbox.Items[0].SenderUsername != "sudo" || inbox.Items[0].ReadAt != nil {
		t.Fatalf("unexpected inbox for alice: %#v", inbox)
	}
	updated, err := service.MarkRead(ctx, 2, nil, true)
	if err != nil || updated != 1 {
		t.Fatalf("mark all read updated=%d err=%v", updated, err)
	}
	inbox, _ = service.Inbox(ctx, 2, 10, 0, true)
	if inbox.Total != 0 && len(inbox.Items) != 0 {
		t.Fatalf("unread filter still returns read items: %#v", inbox)
	}
	sender := int64(1)
	sent, err := service.Sent(ctx, &sender, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(sent) != 1 || sent[0].Recipients != 2 || sent[0].Read != 1 {
		t.Fatalf("sent = %#v, want 2 recipients with 1 read", sent)
	}
}
