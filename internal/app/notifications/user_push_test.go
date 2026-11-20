//go:build cgo

package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/migrations"
)

func insertTestUser(t *testing.T, db *sql.DB, id int64, username string, status string, dataLimit int64, usedTraffic int64, expire int64) {
	t.Helper()
	var limitVal any
	if dataLimit > 0 {
		limitVal = dataLimit
	}
	if _, err := db.Exec(`INSERT INTO users (id, username, status, data_limit, used_traffic, expire, credential_key)
VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, username, status, limitVal, usedTraffic, nullableExpire(expire), fmt.Sprintf("cred-%d", id)); err != nil {
		t.Fatal(err)
	}
}

func updateTestUser(t *testing.T, db *sql.DB, id int64, status string, dataLimit int64, usedTraffic int64, expire int64) {
	t.Helper()
	var limitVal any
	if dataLimit > 0 {
		limitVal = dataLimit
	}
	if _, err := db.Exec(`UPDATE users SET status = ?, data_limit = ?, used_traffic = ?, expire = ? WHERE id = ?`,
		status, limitVal, usedTraffic, nullableExpire(expire), id); err != nil {
		t.Fatal(err)
	}
}

func addUserPushDevice(t *testing.T, db *sql.DB, rec *pushRecorder, userID int64, name string, lang string, createdAt int64, prefs int64) string {
	t.Helper()
	p256dh, auth := browserKeys(t)
	endpoint := rec.server.URL + "/" + name
	if _, err := db.Exec(`INSERT INTO user_push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, user_agent, page_url, lang, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'test', '/sub/tok', ?, ?, ?)`,
		userID, pushEndpointHash(endpoint), endpoint, p256dh, auth, lang, createdAt, createdAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT OR REPLACE INTO user_push_alert_states (user_id, sent_mask, alert_prefs, updated_at) VALUES (?, 0, ?, ?)`,
		userID, prefs, createdAt); err != nil {
		t.Fatal(err)
	}
	return endpoint
}

func TestUserPushSubscriptionLifecycle(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertTestUser(t, db, 10, "alice", "active", 10_000, 1_000, 0)

	p256dh, auth := browserKeys(t)
	in := UserPushSubscription{
		UserID:   10,
		Endpoint: "https://fcm.googleapis.com/fcm/send/user-one",
		P256dh:   p256dh,
		Auth:     auth,
		PageURL:  "/sub/alice-token",
		Lang:     "fa-IR",
	}
	status, err := service.SubscribeUserPush(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Subscribed || status.Devices != 1 || status.Lang != "fa" {
		t.Fatalf("unexpected subscribe status: %+v", status)
	}
	if !status.Alerts.Usage80 || status.Alerts.Usage95 || !status.Alerts.Expiry24h || !status.Alerts.Limited || !status.Alerts.Expired {
		t.Fatalf("unexpected default alert prefs: %+v", status.Alerts)
	}

	// Idempotent re-subscribe keeps 1 device.
	if status, err = service.SubscribeUserPush(ctx, in); err != nil || status.Devices != 1 {
		t.Fatalf("resubscribe status=%+v err=%v", status, err)
	}

	// Update preferences & language.
	custom := UserAlertPrefs{Usage80: true, Usage95: true, Expiry24h: false, Limited: true, Expired: true}
	status, err = service.UpdateUserPushPreferences(ctx, 10, in.Endpoint, "en-US", &custom)
	if err != nil {
		t.Fatal(err)
	}
	if status.Lang != "en" || !status.Alerts.Usage95 || status.Alerts.Expiry24h {
		t.Fatalf("unexpected updated prefs: %+v", status)
	}

	// Foreign endpoint rejected.
	bad := in
	bad.Endpoint = "https://evil.example.com/hook"
	if _, err := service.SubscribeUserPush(ctx, bad); !errors.Is(err, ErrInvalidSubscription) {
		t.Fatalf("foreign endpoint must be refused, got %v", err)
	}

	// Unsubscribe removes device and cleans up alert state.
	status, err = service.UnsubscribeUserPush(ctx, 10, in.Endpoint)
	if err != nil || status.Subscribed || status.Devices != 0 {
		t.Fatalf("unexpected unsubscribe status=%+v err=%v", status, err)
	}
	var stateRows int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM user_push_alert_states WHERE user_id = 10`).Scan(&stateRows); err != nil || stateRows != 0 {
		t.Fatalf("alert state must be cleaned up when last device unsubscribes, got %d (err=%v)", stateRows, err)
	}
}

func TestUserPushKeepsNewestDevices(t *testing.T) {
	ctx := context.Background()
	service, db := newTestService(t)
	insertTestUser(t, db, 11, "bob", "active", 10_000, 0, 0)
	p256dh, auth := browserKeys(t)

	for i := 0; i < maxDevicesPerUser+3; i++ {
		endpoint := fmt.Sprintf("https://fcm.googleapis.com/fcm/send/dev-%d", i)
		if _, err := service.SubscribeUserPush(ctx, UserPushSubscription{
			UserID:   11,
			Endpoint: endpoint,
			P256dh:   p256dh,
			Auth:     auth,
		}); err != nil {
			t.Fatal(err)
		}
	}
	status, err := service.UserPushStatus(ctx, 11, "")
	if err != nil || status.Devices != maxDevicesPerUser {
		t.Fatalf("devices = %d (err=%v), want %d", status.Devices, err, maxDevicesPerUser)
	}
}

func TestUserPushInitialSeedPreventsImmediateSpam(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	// User is ALREADY at 85% usage when subscribing.
	insertTestUser(t, db, 20, "already85", "active", 10_000, 8_500, 0)
	p256dh, auth := browserKeys(t)
	if _, err := service.SubscribeUserPush(ctx, UserPushSubscription{
		UserID:   20,
		Endpoint: "https://fcm.googleapis.com/fcm/send/seed-dev",
		P256dh:   p256dh,
		Auth:     auth,
	}); err != nil {
		t.Fatal(err)
	}
	// Point endpoint at test recorder to observe any deliveries.
	if _, err := db.Exec(`UPDATE user_push_subscriptions SET endpoint = ? WHERE user_id = 20`, rec.server.URL+"/seed"); err != nil {
		t.Fatal(err)
	}

	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 0 {
		t.Fatalf("already-85%% user must not be spammed on first tick, got %d pushes", rec.count())
	}

	// Crossing into limited (100%) MUST still notify once.
	updateTestUser(t, db, 20, "limited", 10_000, 10_000, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("limited transition must push once, got %d", rec.count())
	}
}

func TestUserPushUsageLifecycleAndReset(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	insertTestUser(t, db, 30, "carol", "active", 10_000, 5_000, 0)
	addUserPushDevice(t, db, rec, 30, "c1", "fa", testNow.Unix(), UserAlertAllMask)

	// Below 80%: no push.
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 0 {
		t.Fatalf("50%% usage pushed %d times, want 0", rec.count())
	}

	// Cross 80%: 1 push, repeated evaluation stays 1.
	updateTestUser(t, db, 30, "active", 10_000, 8_200, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("82%% usage pushed %d times, want 1", rec.count())
	}

	// Cross 95%: 1 more push (total 2).
	updateTestUser(t, db, 30, "active", 10_000, 9_600, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 2 {
		t.Fatalf("96%% usage pushed %d times, want 2", rec.count())
	}

	// Reach 100% / limited: 1 more push (total 3).
	updateTestUser(t, db, 30, "limited", 10_000, 10_000, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 3 {
		t.Fatalf("limited usage pushed %d times, want 3", rec.count())
	}

	// Reset usage (renewal): clears sent bits, then crossing 80% again notifies once more (total 4).
	updateTestUser(t, db, 30, "active", 10_000, 0, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	updateTestUser(t, db, 30, "active", 10_000, 8_100, 0)
	if _, err := service.EvaluateUserAlerts(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 4 {
		t.Fatalf("after reset and 81%% again, pushes = %d, want 4", rec.count())
	}
}

func TestUserPushJumpSuppressionAndExpiryTrack(t *testing.T) {
	// Direct jump 50% -> 100% sends ONLY limited (not 80% + 95% + limited).
	alerts, mask := evaluateUserAlertState("limited", 10_000, 10_000, 0, testNow.Unix(), 0, UserAlertAllMask)
	if len(alerts) != 1 || alerts[0] != UserAlertLimited {
		t.Fatalf("jump to limited alerts = %v, want [%d]", alerts, UserAlertLimited)
	}
	if mask&(UserAlertUsage80|UserAlertUsage95|UserAlertLimited) != (UserAlertUsage80 | UserAlertUsage95 | UserAlertLimited) {
		t.Fatalf("expected all lower usage bits marked, got %b", mask)
	}

	// Jump 50% -> 96% when usage_95 is disabled still fires usage_80 once.
	alerts, mask = evaluateUserAlertState("active", 9_600, 10_000, 0, testNow.Unix(), 0, UserAlertDefaultMask)
	if len(alerts) != 1 || alerts[0] != UserAlertUsage80 {
		t.Fatalf("96%% with usage_95 disabled alerts = %v, want [%d]", alerts, UserAlertUsage80)
	}
	alerts, _ = evaluateUserAlertState("active", 9_700, 10_000, 0, testNow.Unix(), mask, UserAlertDefaultMask)
	if len(alerts) != 0 {
		t.Fatalf("97%% repeat must not resend usage_80, got %v", alerts)
	}

	// Expiry track: >24h -> no alert, 12h -> expiry_24h, expired -> expired, renewed -> clears.
	now := testNow.Unix()
	alerts, mask = evaluateUserAlertState("active", 0, 0, now+48*3600, now, 0, UserAlertDefaultMask)
	if len(alerts) != 0 || mask != 0 {
		t.Fatalf("48h left must not alert: alerts=%v mask=%d", alerts, mask)
	}
	alerts, mask = evaluateUserAlertState("active", 0, 0, now+12*3600, now, mask, UserAlertDefaultMask)
	if len(alerts) != 1 || alerts[0] != UserAlertExpiry24h {
		t.Fatalf("12h left alerts=%v, want expiry_24h", alerts)
	}
	alerts, mask = evaluateUserAlertState("expired", 0, 0, now-60, now, mask, UserAlertDefaultMask)
	if len(alerts) != 1 || alerts[0] != UserAlertExpired {
		t.Fatalf("expired alerts=%v, want expired", alerts)
	}
	// Renew to +30 days clears expiry bits.
	alerts, mask = evaluateUserAlertState("active", 0, 0, now+30*86400, now, mask, UserAlertDefaultMask)
	if len(alerts) != 0 || mask != 0 {
		t.Fatalf("renewed user must clear mask: alerts=%v mask=%d", alerts, mask)
	}
	// Disabled/on_hold users receive zero alerts.
	alerts, _ = evaluateUserAlertState("disabled", 10_000, 10_000, now-60, now, 0, UserAlertAllMask)
	if len(alerts) != 0 {
		t.Fatalf("disabled user must not receive alerts, got %v", alerts)
	}
}

func TestUserPushRevocationAndGoneCleanup(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	// User 40 subscribed BEFORE sub_revoked_at -> pruned, 0 pushes.
	insertTestUser(t, db, 40, "revoked", "limited", 10_000, 10_000, 0)
	addUserPushDevice(t, db, rec, 40, "old-dev", "en", testNow.Add(-2*time.Hour).Unix(), UserAlertDefaultMask)
	if _, err := db.Exec(`UPDATE users SET sub_revoked_at = ? WHERE id = 40`, testNow.Add(-1*time.Hour).Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}

	// User 41 returns 410 Gone -> device and state removed.
	insertTestUser(t, db, 41, "goneuser", "limited", 10_000, 10_000, 0)
	addUserPushDevice(t, db, rec, 41, "gone-dev", "en", testNow.Unix(), UserAlertDefaultMask)
	atomic.StoreInt32(&rec.status, http.StatusGone)

	// User 42 was soft-deleted -> cleaned up, 0 pushes.
	insertTestUser(t, db, 42, "deleted", "deleted", 10_000, 10_000, 0)
	addUserPushDevice(t, db, rec, 42, "del-dev", "en", testNow.Unix(), UserAlertDefaultMask)

	res, err := service.EvaluateUserAlerts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("only user 41 should be attempted, got %d hits", rec.count())
	}
	if res.Pruned < 3 {
		t.Fatalf("expected revoked + gone + deleted pruned, got %+v", res)
	}
	var subsLeft, statesLeft int64
	_ = db.QueryRow(`SELECT COUNT(*) FROM user_push_subscriptions`).Scan(&subsLeft)
	_ = db.QueryRow(`SELECT COUNT(*) FROM user_push_alert_states`).Scan(&statesLeft)
	if subsLeft != 0 || statesLeft != 0 {
		t.Fatalf("expected all dead subscriptions/states pruned, got subs=%d states=%d", subsLeft, statesLeft)
	}
}

func TestUserPushMultiBatchKeysetPagination(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	const totalUsers = 7
	for i := int64(1); i <= totalUsers; i++ {
		insertTestUser(t, db, 100+i, fmt.Sprintf("u%d", i), "active", 10_000, 8_500, 0)
		addUserPushDevice(t, db, rec, 100+i, fmt.Sprintf("d%d", i), "en", testNow.Unix(), UserAlertDefaultMask)
	}

	res, err := service.evaluateUserAlertsBatched(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.Checked != totalUsers || res.Delivered != totalUsers || rec.count() != totalUsers {
		t.Fatalf("batched evaluation res=%+v hits=%d, want %d", res, rec.count(), totalUsers)
	}
}

func TestUserPushTargetedEvaluateForUsers(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	insertTestUser(t, db, 201, "target1", "limited", 10_000, 10_000, 0)
	insertTestUser(t, db, 202, "other", "limited", 10_000, 10_000, 0)
	addUserPushDevice(t, db, rec, 201, "t1", "fa", testNow.Unix(), UserAlertDefaultMask)
	addUserPushDevice(t, db, rec, 202, "t2", "en", testNow.Unix(), UserAlertDefaultMask)

	// Evaluating ONLY user 201 must check and push ONLY user 201 (not scan user 202).
	res, err := service.EvaluateUserAlertsForUsers(ctx, []int64{201, 201, 9999})
	if err != nil {
		t.Fatal(err)
	}
	if res.Checked != 1 || res.Delivered != 1 || rec.count() != 1 {
		t.Fatalf("targeted evaluation res=%+v hits=%d, want checked=1 delivered=1", res, rec.count())
	}
}

func TestSendUserPushTest(t *testing.T) {
	ctx := context.Background()
	rec := newPushRecorder(t)
	service, db := newTestService(t)
	service = service.WithPushClient(rec.server.Client())

	insertTestUser(t, db, 50, "tester", "active", 10_000, 1_000, 0)
	endpoint := addUserPushDevice(t, db, rec, 50, "t1", "fa", testNow.Unix(), UserAlertDefaultMask)

	if err := service.SendUserPushTest(ctx, 50, endpoint, "SkyLink"); err != nil {
		t.Fatalf("SendUserPushTest failed: %v", err)
	}
	if rec.count() != 1 {
		t.Fatalf("hits = %d, want 1", rec.count())
	}
	if err := service.SendUserPushTest(ctx, 50, rec.server.URL+"/unknown", "SkyLink"); !errors.Is(err, ErrNotSubscribed) {
		t.Fatalf("unknown endpoint must return ErrNotSubscribed, got %v", err)
	}
	atomic.StoreInt32(&rec.status, http.StatusGone)
	if err := service.SendUserPushTest(ctx, 50, endpoint, "SkyLink"); !errors.Is(err, ErrPushGone) {
		t.Fatalf("410 response must return ErrPushGone, got %v", err)
	}
	if st, _ := service.UserPushStatus(ctx, 50, endpoint); st.Subscribed || st.Devices != 0 {
		t.Fatalf("410 device must be removed, got %+v", st)
	}
}

func TestFormatUserAlertMessagesLocalized(t *testing.T) {
	now := testNow.Unix()
	fa80 := formatUserAlertMessage(UserAlertUsage80, "fa", "SkyLink", 8*1024*1024*1024, 10*1024*1024*1024, 0, now)
	if fa80.Dir != "rtl" || fa80.Lang != "fa" || !strings.Contains(fa80.Title, "SkyLink") || !strings.Contains(fa80.Title, "80%") {
		t.Fatalf("unexpected fa 80%% message: %+v", fa80)
	}
	enLim := formatUserAlertMessage(UserAlertLimited, "en", "SkyLink", 10*1024*1024*1024, 10*1024*1024*1024, 0, now)
	if enLim.Dir != "ltr" || enLim.Lang != "en" || !strings.Contains(enLim.Title, "Data limit reached") {
		t.Fatalf("unexpected en limited message: %+v", enLim)
	}
	faExp := formatUserAlertMessage(UserAlertExpiry24h, "fa", "", 0, 0, now+5*3600, now)
	if faExp.Dir != "rtl" || !strings.Contains(faExp.Title, "5") {
		t.Fatalf("unexpected fa 24h message: %+v", faExp)
	}
	ru80 := formatUserAlertMessage(UserAlertUsage80, "ru-RU", "SkyLink", 8*1024*1024*1024, 10*1024*1024*1024, 0, now)
	if ru80.Dir != "ltr" || ru80.Lang != "ru" || !strings.Contains(ru80.Title, "80%") {
		t.Fatalf("unexpected ru 80%% message: %+v", ru80)
	}
	zhExp := formatUserAlertMessage(UserAlertExpired, "zh-CN", "SkyLink", 0, 0, now-10, now)
	if zhExp.Dir != "ltr" || zhExp.Lang != "zh" || !strings.Contains(zhExp.Title, "SkyLink") {
		t.Fatalf("unexpected zh expired message: %+v", zhExp)
	}
}

func BenchmarkUserPushEvaluate10k(b *testing.B) {
	ctx := context.Background()
	path := b.TempDir() + "/bench.sqlite3"
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()
	if err := migrations.RunMigrations(ctx, db, "sqlite"); err != nil {
		b.Fatal(err)
	}
	service := NewService(db, "sqlite")
	service.now = func() time.Time { return testNow }

	// Seed 10,000 active users and 3,000 push-subscribed users (30% opt-in).
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	uStmt, err := tx.Prepare(`INSERT INTO users (id, username, status, data_limit, used_traffic, expire, credential_key) VALUES (?, ?, 'active', 10737418240, 4294967296, ?, ?)`)
	if err != nil {
		b.Fatal(err)
	}
	sStmt, err := tx.Prepare(`INSERT INTO user_push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, user_agent, page_url, lang, created_at, updated_at) VALUES (?, ?, ?, 'k', 'a', 'ua', '/sub/t', 'en', ?, ?)`)
	if err != nil {
		b.Fatal(err)
	}
	stStmt, err := tx.Prepare(`INSERT INTO user_push_alert_states (user_id, sent_mask, alert_prefs, updated_at) VALUES (?, 0, 29, ?)`)
	if err != nil {
		b.Fatal(err)
	}
	exp := testNow.Add(15 * 24 * time.Hour).Unix()
	now := testNow.Unix()
	for i := int64(1); i <= 10_000; i++ {
		if _, err := uStmt.Exec(i, fmt.Sprintf("u%d", i), exp, fmt.Sprintf("cred-%d", i)); err != nil {
			b.Fatal(err)
		}
		if i <= 3_000 {
			ep := fmt.Sprintf("https://fcm.googleapis.com/fcm/send/u%d", i)
			if _, err := sStmt.Exec(i, pushEndpointHash(ep), ep, now, now); err != nil {
				b.Fatal(err)
			}
			if _, err := stStmt.Exec(i, now); err != nil {
				b.Fatal(err)
			}
		}
	}
	_ = uStmt.Close()
	_ = sStmt.Close()
	_ = stStmt.Close()
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}

	b.Run("FullSweep_10kUsers_3kSubscribed_SteadyState", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := service.EvaluateUserAlerts(ctx)
			if err != nil || res.Checked != 3_000 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})

	b.Run("TargetedLifecycle_5Users_In10kDB", func(b *testing.B) {
		ids := []int64{10, 500, 1500, 2500, 8000}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := service.EvaluateUserAlertsForUsers(ctx, ids)
			if err != nil || res.Checked != 4 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})
}
