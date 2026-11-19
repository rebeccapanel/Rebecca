//go:build cgo

package api

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/notifications"
)

func newTestSubscriptionPushServer(t *testing.T) *Server {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "sub-push.sqlite3")
	server, err := New(Config{
		Database: "sqlite:///" + dbPath,
	})
	if err != nil {
		t.Fatalf("new api server: %v", err)
	}
	t.Cleanup(func() { _ = server.db.Close() })

	if _, err := server.db.Exec(`INSERT INTO admins (id, username, hashed_password, role, status) VALUES (1, 'owner', 'hash', 'full_access', 'active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := server.SubscriptionSettings(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := server.db.Exec(`UPDATE subscription_settings SET subscription_profile_title = 'SkyLink', subscription_web_push_enabled = 1`); err != nil {
		t.Fatal(err)
	}
	server.subPushEnabled.Store(true)
	if _, err := server.db.Exec(`INSERT INTO users (id, username, admin_id, status, data_limit, used_traffic, credential_key, subscription_token)
VALUES (100, 'alice', 1, 'active', 10737418240, 2147483648, '0123456789abcdef0123456789abcdef', 'tok-alice-push')`); err != nil {
		t.Fatal(err)
	}
	return server
}

func testBrowserPushKeys(t *testing.T) (string, string) {
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

func TestSubscriptionPushEndpointsAndAssets(t *testing.T) {
	server := newTestSubscriptionPushServer(t)
	handler := server.Handler()

	// Root service worker route.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, notifications.UserServiceWorkerPath, nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Service-Worker-Allowed") != "/" || !strings.Contains(rec.Body.String(), "showNotification") {
		t.Fatalf("root sw.js status=%d header=%q body=%q", rec.Code, rec.Header().Get("Service-Worker-Allowed"), rec.Body.String())
	}

	// Subscription-scoped SW works for valid token and rejects unknown token.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push/push/sw.js", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Service-Worker-Allowed") != "/" {
		t.Fatalf("sub sw.js status=%d sw-allowed=%q", rec.Code, rec.Header().Get("Service-Worker-Allowed"))
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sub/nonexistent/push/sw.js", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("invalid token sw.js status=%d, want 404", rec.Code)
	}

	// Manifest returns brand name and user start_url.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push/push/manifest.webmanifest", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("manifest status=%d body=%s", rec.Code, rec.Body.String())
	}
	var manifest struct {
		Name     string `json:"name"`
		StartURL string `json:"start_url"`
		Display  string `json:"display"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Name != "SkyLink" || manifest.StartURL != "/sub/tok-alice-push" || manifest.Display != "standalone" {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}

	// Config returns public VAPID key and URLs.
	rec = httptest.NewRecorder()
	cfgReq := httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push/push/config", nil)
	cfgReq.Host = "sub.example.com"
	handler.ServeHTTP(rec, cfgReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("config status=%d body=%s", rec.Code, rec.Body.String())
	}
	var cfgResp struct {
		Enabled     bool   `json:"enabled"`
		PublicKey   string `json:"public_key"`
		SWURL       string `json:"sw_url"`
		ManifestURL string `json:"manifest_url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfgResp); err != nil {
		t.Fatal(err)
	}
	if !cfgResp.Enabled || cfgResp.PublicKey == "" || cfgResp.SWURL != "/sub/tok-alice-push/push/sw.js" {
		t.Fatalf("unexpected config response: %+v", cfgResp)
	}

	// Wrong HTTP method returns 405.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push/push/subscribe", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET subscribe status=%d, want 405", rec.Code)
	}

	// Subscribe -> Status -> Preferences -> Unsubscribe full lifecycle.
	p256dh, auth := testBrowserPushKeys(t)
	endpoint := "https://fcm.googleapis.com/fcm/send/api-test-1"
	subBody := `{"endpoint":"` + endpoint + `","lang":"fa","keys":{"p256dh":"` + p256dh + `","auth":"` + auth + `"},"alerts":{"usage_80":true,"usage_95":true,"expiry_24h":true,"limited":true,"expired":true}}`
	rec = httptest.NewRecorder()
	subReq := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/subscribe", strings.NewReader(subBody))
	subReq.RemoteAddr = "198.51.100.10:12345"
	handler.ServeHTTP(rec, subReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("subscribe status=%d body=%s", rec.Code, rec.Body.String())
	}
	var statusResp notifications.UserPushStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &statusResp); err != nil {
		t.Fatal(err)
	}
	if !statusResp.Subscribed || statusResp.Devices != 1 || statusResp.Lang != "fa" || !statusResp.Alerts.Usage95 {
		t.Fatalf("unexpected subscribe response: %+v", statusResp)
	}

	// Status check via username/key URL also resolves the same user.
	rec = httptest.NewRecorder()
	stReq := httptest.NewRequest(http.MethodPost, "/sub/alice/0123456789abcdef0123456789abcdef/push/status", strings.NewReader(`{"endpoint":"`+endpoint+`"}`))
	handler.ServeHTTP(rec, stReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("status check status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &statusResp); err != nil || !statusResp.Subscribed || statusResp.Devices != 1 {
		t.Fatalf("unexpected status response: %+v err=%v", statusResp, err)
	}

	// Update preferences.
	rec = httptest.NewRecorder()
	prefReq := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/preferences", strings.NewReader(`{"endpoint":"`+endpoint+`","lang":"en","alerts":{"usage_80":true,"usage_95":false,"expiry_24h":false,"limited":true,"expired":true}}`))
	prefReq.RemoteAddr = "198.51.100.10:12345"
	handler.ServeHTTP(rec, prefReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("preferences status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &statusResp); err != nil || statusResp.Lang != "en" || statusResp.Alerts.Usage95 || statusResp.Alerts.Expiry24h {
		t.Fatalf("unexpected preferences response: %+v err=%v", statusResp, err)
	}

	// Invalid endpoint rejected with 400.
	rec = httptest.NewRecorder()
	badReq := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/subscribe", strings.NewReader(`{"endpoint":"https://evil.example/push","keys":{"p256dh":"`+p256dh+`","auth":"`+auth+`"}}`))
	badReq.RemoteAddr = "198.51.100.10:12345"
	handler.ServeHTTP(rec, badReq)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid endpoint status=%d, want 400", rec.Code)
	}

	// Unsubscribe.
	rec = httptest.NewRecorder()
	unsubReq := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/unsubscribe", strings.NewReader(`{"endpoint":"`+endpoint+`"}`))
	unsubReq.RemoteAddr = "198.51.100.10:12345"
	handler.ServeHTTP(rec, unsubReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("unsubscribe status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &statusResp); err != nil || statusResp.Subscribed || statusResp.Devices != 0 {
		t.Fatalf("unexpected unsubscribe response: %+v err=%v", statusResp, err)
	}
}

func TestSubscriptionPushTestEndpointAndRateLimit(t *testing.T) {
	server := newTestSubscriptionPushServer(t)
	var hits int32
	pushSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer pushSrv.Close()
	server.pushClient = pushSrv.Client()

	p256dh, auth := testBrowserPushKeys(t)
	endpoint := pushSrv.URL + "/dev1"
	fcmEndpoint := "https://fcm.googleapis.com/fcm/send/rate-limit-test"
	if _, err := server.notificationService().SubscribeUserPush(t.Context(), notifications.UserPushSubscription{
		UserID:   100,
		Endpoint: fcmEndpoint,
		P256dh:   p256dh,
		Auth:     auth,
		PageURL:  "/sub/tok-alice-push",
		Lang:     "fa",
	}); err != nil {
		t.Fatal(err)
	}
	// Swap stored URL to local TLS recorder while keeping endpoint_hash matching fcmEndpoint.
	if _, err := server.db.Exec(`UPDATE user_push_subscriptions SET endpoint = ? WHERE user_id = 100`, endpoint); err != nil {
		t.Fatal(err)
	}

	handler := server.Handler()
	for i := 0; i < subPushMaxTestPerUserWindow; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/test", strings.NewReader(`{"endpoint":"`+fcmEndpoint+`"}`))
		req.RemoteAddr = "198.51.100.20:4444"
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("test push #%d status=%d body=%s", i+1, rec.Code, rec.Body.String())
		}
	}
	if got := atomic.LoadInt32(&hits); got != subPushMaxTestPerUserWindow {
		t.Fatalf("push hits = %d, want %d", got, subPushMaxTestPerUserWindow)
	}

	// Next request exceeds per-user rate limit -> 429.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/test", strings.NewReader(`{"endpoint":"`+fcmEndpoint+`"}`))
	req.RemoteAddr = "198.51.100.20:4444"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("rate-limited test push status=%d, want 429", rec.Code)
	}
}

func TestSubscriptionHTMLIncludesWebPushPublicKey(t *testing.T) {
	server := newTestSubscriptionPushServer(t)
	tplDir := t.TempDir()
	subDir := filepath.Join(tplDir, "subscription")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(subDir, "index.html"), []byte(`<div data-key="{{ web_push_public_key }}" data-base="{{ web_push_base_url }}" data-sw="{{ web_push_sw_url }}" data-manifest="{{ web_push_manifest_url }}"></div>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := server.db.Exec(`UPDATE subscription_settings SET custom_templates_directory = ?, subscription_page_template = 'subscription/index.html'`, tplDir); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push", nil)
	req.Header.Set("Accept", "text/html")
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /sub/tok-alice-push status=%d body=%s", rec.Code, rec.Body.String())
	}
	key := server.cachedWebPushPublicKey(t.Context())
	if key == "" || !strings.Contains(rec.Body.String(), `data-key="`+key+`"`) || !strings.Contains(rec.Body.String(), `data-base="/sub/tok-alice-push/push"`) {
		t.Fatalf("expected web push context in rendered HTML (key=%q), got: %s", key, rec.Body.String())
	}

	// Turning the setting off hides the public key and disables push endpoints immediately.
	server.subPushEnabled.Store(false)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push", nil)
	req.Header.Set("Accept", "text/html")
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `data-key=""`) {
		t.Fatalf("disabled push must omit web_push_public_key, got status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sub/tok-alice-push/push/config", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("disabled /push/config must return enabled=false, got status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/sub/tok-alice-push/push/subscribe", strings.NewReader(`{}`)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("disabled /push/subscribe status=%d, want 403", rec.Code)
	}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, notifications.UserServiceWorkerPath, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("disabled root sw.js status=%d, want 404", rec.Code)
	}
}

func TestSubscriptionWebPushSettingDefaultOffAndLiveToggle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sub-push-toggle.sqlite3")
	server, err := New(Config{Database: "sqlite:///" + dbPath})
	if err != nil {
		t.Fatalf("new api server: %v", err)
	}
	t.Cleanup(func() { _ = server.db.Close() })

	// Off by default on fresh install.
	if server.subPushEnabled.Load() {
		t.Fatal("subscription_web_push_enabled must default to false")
	}

	updated, err := server.settingsRepo.UpdateSubscriptionSettings(t.Context(), map[string]json.RawMessage{
		"subscription_web_push_enabled": json.RawMessage(`true`),
	})
	if err != nil || !updated.SubscriptionWebPushEnabled {
		t.Fatalf("enable setting: updated=%+v err=%v", updated, err)
	}
	server.applySubscriptionSettings(updated)
	if !server.subPushEnabled.Load() {
		t.Fatal("applySubscriptionSettings(true) must enable subPushEnabled")
	}

	updated, err = server.settingsRepo.UpdateSubscriptionSettings(t.Context(), map[string]json.RawMessage{
		"subscription_web_push_enabled": json.RawMessage(`false`),
	})
	if err != nil || updated.SubscriptionWebPushEnabled {
		t.Fatalf("disable setting: updated=%+v err=%v", updated, err)
	}
	server.applySubscriptionSettings(updated)
	if server.subPushEnabled.Load() {
		t.Fatal("applySubscriptionSettings(false) must disable subPushEnabled")
	}
}
