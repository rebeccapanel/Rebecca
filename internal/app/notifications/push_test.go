//go:build cgo

package notifications

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type pushRecorder struct {
	server *httptest.Server
	hits   int32
	status int32
}

func newPushRecorder(t *testing.T) *pushRecorder {
	t.Helper()
	rec := &pushRecorder{status: http.StatusCreated}
	rec.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&rec.hits, 1)
		w.WriteHeader(int(atomic.LoadInt32(&rec.status)))
	}))
	t.Cleanup(rec.server.Close)
	return rec
}

func (r *pushRecorder) count() int { return int(atomic.LoadInt32(&r.hits)) }

func browserKeys(t *testing.T) (string, string) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(auth)
}

func addPushDevice(t *testing.T, db *sql.DB, rec *pushRecorder, adminID int64, name string) {
	t.Helper()
	p256dh, auth := browserKeys(t)
	endpoint := rec.server.URL + "/" + name
	if _, err := db.Exec(`INSERT INTO admin_push_subscriptions (admin_id, endpoint_hash, endpoint, p256dh, auth, user_agent, page_url, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'test', '/dashboard/notifications', 1, 1)`, adminID, pushEndpointHash(endpoint), endpoint, p256dh, auth); err != nil {
		t.Fatal(err)
	}
}

func TestValidPushEndpoint(t *testing.T) {
	cases := map[string]bool{
		"https://fcm.googleapis.com/fcm/send/abc":                true,
		"https://updates.push.services.mozilla.com/wpush/v2/abc": true,
		"https://web.push.apple.com/abc":                         true,
		"https://wns2-par02p.notify.windows.com/?token=abc":      true,
		"http://fcm.googleapis.com/fcm/send/abc":                 false,
		"https://storage.googleapis.com/bucket":                  false,
		"https://evil.example.com/push":                          false,
		"https://fcm.googleapis.com.evil.example.com/push":       false,
		"https://user@fcm.googleapis.com/push":                   false,
		"https://fcm.googleapis.com:8443/push":                   false,
		"https://127.0.0.1/push":                                 false,
		"":                                                       false,
	}
	for endpoint, want := range cases {
		if got := ValidPushEndpoint(endpoint); got != want {
			t.Errorf("ValidPushEndpoint(%q) = %v, want %v", endpoint, got, want)
		}
	}
}

func TestPushSubscriptionLifecycle(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "alice", "standard", 0, 0, 0)
	p256dh, auth := browserKeys(t)
	in := PushSubscription{AdminID: 1, Endpoint: "https://fcm.googleapis.com/fcm/send/one", P256dh: p256dh, Auth: auth, PageURL: "/dashboard/notifications"}
	if err := service.SubscribePush(ctx, in); err != nil {
		t.Fatal(err)
	}
	if err := service.SubscribePush(ctx, in); err != nil {
		t.Fatal(err)
	}
	status, err := service.PushStatus(ctx, 1, in.Endpoint)
	if err != nil || !status.Subscribed || status.Devices != 1 {
		t.Fatalf("status = %+v, %v", status, err)
	}
	other, _ := service.PushStatus(ctx, 1, "https://fcm.googleapis.com/fcm/send/other")
	if other.Subscribed {
		t.Fatal("an unknown endpoint must not count as subscribed")
	}
	bad := in
	bad.Endpoint = "https://evil.example.com/x"
	if err := service.SubscribePush(ctx, bad); !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("foreign endpoint must be refused, got %v", err)
	}
	if err := service.UnsubscribePush(ctx, 1, in.Endpoint); err != nil {
		t.Fatal(err)
	}
	if status, _ := service.PushStatus(ctx, 1, in.Endpoint); status.Subscribed || status.Devices != 0 {
		t.Fatalf("subscription must be gone, got %+v", status)
	}
}

func TestPushKeepsNewestDevices(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "alice", "standard", 0, 0, 0)
	p256dh, auth := browserKeys(t)
	for i := 0; i < maxDevicesPerAdmin+3; i++ {
		endpoint := "https://fcm.googleapis.com/fcm/send/" + string(rune('a'+i))
		if err := service.SubscribePush(ctx, PushSubscription{AdminID: 1, Endpoint: endpoint, P256dh: p256dh, Auth: auth}); err != nil {
			t.Fatal(err)
		}
	}
	if status, _ := service.PushStatus(ctx, 1, ""); status.Devices != maxDevicesPerAdmin {
		t.Fatalf("devices = %d, want %d", status.Devices, maxDevicesPerAdmin)
	}
}

func TestManualSendPushesToEveryRecipientDevice(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())
	insertAdmin(t, db, 1, "alice", "standard", 0, 0, 0)
	insertAdmin(t, db, 2, "bob", "standard", 0, 0, 0)
	insertAdmin(t, db, 3, "carol", "standard", 0, 0, 0)
	addPushDevice(t, db, rec, 1, "a1")
	addPushDevice(t, db, rec, 1, "a2")
	addPushDevice(t, db, rec, 2, "b1")
	addPushDevice(t, db, rec, 3, "c1")
	if _, _, err := service.Send(ctx, Sender{ID: 3, Username: "carol"}, "Maintenance", "Tonight at 2am", []int64{1, 2}); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 3 {
		t.Fatalf("push deliveries = %d, want 3 (two devices of alice, one of bob)", rec.count())
	}
}

func TestRuleNotificationsArePushed(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())
	insertAdmin(t, db, 1, "alice", "standard", 1000, 850, 0)
	addPushDevice(t, db, rec, 1, "a1")
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("a traffic alert must be pushed once, got %d", rec.count())
	}
	if err := service.Evaluate(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("a repeated evaluation must not push again, got %d", rec.count())
	}
}

func TestRejectedSubscriptionsAreRemoved(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	atomic.StoreInt32(&rec.status, http.StatusGone)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())
	insertAdmin(t, db, 1, "alice", "standard", 0, 0, 0)
	insertAdmin(t, db, 2, "bob", "standard", 0, 0, 0)
	addPushDevice(t, db, rec, 1, "a1")
	if _, _, err := service.Send(ctx, Sender{ID: 2, Username: "bob"}, "Hello", "World", []int64{1}); err != nil {
		t.Fatal(err)
	}
	if status, _ := service.PushStatus(ctx, 1, ""); status.Devices != 0 {
		t.Fatalf("a subscription rejected with 410 must be removed, %d left", status.Devices)
	}
}

func TestMandatoryRulesCannotBeDisabled(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertAdmin(t, db, 1, "alice", "standard", 1000, 900, 0)
	for _, key := range []string{RuleAdminTraffic, RuleAdminExpiry} {
		if _, err := service.SaveRule(ctx, key, RuleUpdate{Enabled: false, Threshold: 5, Title: "t", Body: "b"}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("disabling %s must be refused, got %v", key, err)
		}
		if _, err := db.Exec(`INSERT INTO notification_rules (rule_key, enabled, threshold, title, body, updated_at) VALUES (?, 0, 5, 't', 'b', 1)`, key); err != nil {
			t.Fatal(err)
		}
	}
	rules, err := service.ListRules(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range rules {
		wantMandatory := rule.Key == RuleAdminTraffic || rule.Key == RuleAdminExpiry
		if rule.Mandatory != wantMandatory {
			t.Errorf("rule %s mandatory = %v, want %v", rule.Key, rule.Mandatory, wantMandatory)
		}
		if wantMandatory && !rule.Enabled {
			t.Errorf("mandatory rule %s must stay enabled even if the stored row says otherwise", rule.Key)
		}
	}
	if _, err := service.SaveRule(ctx, RuleNodeOffline, RuleUpdate{Enabled: false, Title: "t", Body: "b"}); err != nil {
		t.Fatalf("optional rules may still be disabled: %v", err)
	}
}
