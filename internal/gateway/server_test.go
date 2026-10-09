package gateway

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pires/go-proxyproto"
)

type testHostAwareHandler struct {
	host string
	http.Handler
}

func (h testHostAwareHandler) HandlesHost(host string) bool {
	return strings.EqualFold(host, h.host)
}

func TestGatewayForwardsAPIDirectlyToInProcessHandler(t *testing.T) {
	hits := []string{}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/system"},
		{method: http.MethodPost, path: "/admin/token"},
		{method: http.MethodGet, path: "/sub/token"},
		{method: http.MethodGet, path: "/"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}

	if strings.Join(hits, ",") != "GET /api/system,POST /admin/token,GET /sub/token,GET /" {
		t.Fatalf("unexpected API hits: %#v", hits)
	}
}

func TestGatewayReturnsUnavailableWithoutAPIHandler(t *testing.T) {
	server, err := NewServer(Config{})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/system", nil)
	rec := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Go API handler is unavailable") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestGatewayRejectsIncompleteTLSConfig(t *testing.T) {
	if _, err := NewServer(Config{TLSCertFile: "/tmp/fullchain.pem"}); err == nil || !strings.Contains(err.Error(), "incomplete TLS configuration") {
		t.Fatalf("expected incomplete TLS error for cert-only config, got %v", err)
	}
	if _, err := NewServer(Config{TLSKeyFile: "/tmp/key.pem"}); err == nil || !strings.Contains(err.Error(), "incomplete TLS configuration") {
		t.Fatalf("expected incomplete TLS error for key-only config, got %v", err)
	}
}

func TestGatewayServesEmbeddedDashboardAndStatics(t *testing.T) {
	server, err := NewServer(Config{DashboardPath: "/dashboard/"})
	if err != nil {
		t.Fatal(err)
	}

	redirect := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(redirect, httptest.NewRequest(http.MethodGet, "/dashboard", nil))
	if redirect.Code != http.StatusTemporaryRedirect || redirect.Header().Get("Location") != "/dashboard/login" {
		t.Fatalf("dashboard redirect status=%d location=%q", redirect.Code, redirect.Header().Get("Location"))
	}

	spa := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(spa, httptest.NewRequest(http.MethodGet, "/dashboard/login", nil))
	if spa.Code != http.StatusOK || !strings.Contains(strings.ToLower(spa.Body.String()), "<!doctype html>") {
		t.Fatalf("dashboard spa status=%d body=%s", spa.Code, spa.Body.String())
	}

	static := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(static, httptest.NewRequest(http.MethodGet, "/statics/locales/en.json", nil))
	if static.Code != http.StatusOK || !strings.Contains(static.Body.String(), "dashboard") {
		t.Fatalf("static status=%d body=%s", static.Code, static.Body.String())
	}

	missingModule := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(missingModule, httptest.NewRequest(http.MethodGet, "/assets/SwaggerDocsViewer.missing.js", nil))
	if missingModule.Code != http.StatusNotFound || strings.Contains(strings.ToLower(missingModule.Body.String()), "<!doctype html>") {
		t.Fatalf("missing module status=%d body=%s", missingModule.Code, missingModule.Body.String())
	}
}

func TestGatewayLetsHostedDomainOverrideDashboardRoutes(t *testing.T) {
	api := testHostAwareHandler{
		host: "app.example.com",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte("hosted:" + r.URL.Path))
		}),
	}
	server, err := NewServer(Config{DashboardPath: "/dashboard/", APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	hosted := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "https://app.example.com/dashboard/login", nil)
	server.server.Handler.ServeHTTP(hosted, request)
	if hosted.Code != http.StatusOK || hosted.Body.String() != "hosted:/dashboard/login" {
		t.Fatalf("hosted status=%d body=%q", hosted.Code, hosted.Body.String())
	}

	panel := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "https://panel.example.com/dashboard/login", nil)
	server.server.Handler.ServeHTTP(panel, request)
	if panel.Code != http.StatusOK || !strings.Contains(strings.ToLower(panel.Body.String()), "<!doctype html>") {
		t.Fatalf("panel status=%d body=%q", panel.Code, panel.Body.String())
	}
}

func TestRemovedAndDeprecatedRoutes(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("removed/deprecated route reached API handler: %s %s", r.Method, r.URL.Path)
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: "/api/core/xray/update", want: http.StatusGone},
		{method: http.MethodGet, path: "/api/node/master", want: http.StatusGone},
		{method: http.MethodPost, path: "/api/node/master/usage/reset", want: http.StatusGone},
	}
	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAccessInsightsRouteReachesAPI(t *testing.T) {
	server, err := NewServer(Config{APIHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/core/access/insights" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	})})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/core/access/insights", nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestGatewayHealthChecks(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__rebecca_api/healthz" {
			t.Fatalf("unexpected health path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/__rebecca_go/healthz", "/__rebecca_go/api_healthz"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		server.server.Handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestExtraListenAddrsUsePrimaryHostAndSkipDuplicates(t *testing.T) {
	got := extraListenAddrs(":443", []int{443, 2053, 0, 70000, 8443, 2053})
	want := []string{":2053", ":8443"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("extraListenAddrs(:443)=%v want %v", got, want)
	}

	got = extraListenAddrs("127.0.0.1:443", []int{2053})
	want = []string{"127.0.0.1:2053"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("extraListenAddrs(127.0.0.1:443)=%v want %v", got, want)
	}
}

func TestNewHTTPServerSetsReadAndIdleTimeouts(t *testing.T) {
	server := newHTTPServer(":8000", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 15*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s", server.ReadHeaderTimeout)
	}
	if server.ReadTimeout != 15*time.Minute {
		t.Fatalf("ReadTimeout = %s", server.ReadTimeout)
	}
	if server.IdleTimeout != 2*time.Minute {
		t.Fatalf("IdleTimeout = %s", server.IdleTimeout)
	}
	if server.WriteTimeout != 0 {
		t.Fatalf("WriteTimeout = %s, want 0 for WebSocket streams", server.WriteTimeout)
	}
}

func TestGatewayProxyProtocolV1(t *testing.T) {
	var remoteAddr string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remoteAddr = r.RemoteAddr
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	server, err := NewServer(Config{
		Addr:            "127.0.0.1:0",
		ProxyProtocol:   true,
		APIHandler:      handler,
		CertificateBase: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}

	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- server.Run()
	}()
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	select {
	case <-server.Ready():
	case err := <-runErrCh:
		t.Fatalf("server failed before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server to become ready")
	}

	addrs := server.ListenAddrs()
	if len(addrs) == 0 {
		t.Fatal("no active listener addresses")
	}

	conn, err := net.Dial("tcp", addrs[0])
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Send PROXY protocol v1 header
	header := "PROXY TCP4 198.51.100.33 127.0.0.1 54321 8000\r\n"
	request := "GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(header + request)); err != nil {
		t.Fatalf("failed to write request: %v", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("failed to read response: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		t.Fatalf("failed to parse RemoteAddr %q: %v", remoteAddr, err)
	}
	if host != "198.51.100.33" {
		t.Fatalf("expected client IP 198.51.100.33, got %s (full RemoteAddr: %s)", host, remoteAddr)
	}
}

func TestGatewayProxyProtocolV2(t *testing.T) {
	var remoteAddr string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remoteAddr = r.RemoteAddr
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	server, err := NewServer(Config{
		Addr:            "127.0.0.1:0",
		ProxyProtocol:   true,
		APIHandler:      handler,
		CertificateBase: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}

	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- server.Run()
	}()
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	select {
	case <-server.Ready():
	case err := <-runErrCh:
		t.Fatalf("server failed before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server to become ready")
	}

	addrs := server.ListenAddrs()
	if len(addrs) == 0 {
		t.Fatal("no active listener addresses")
	}

	conn, err := net.Dial("tcp", addrs[0])
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Build and write PROXY protocol v2 header
	proxyHeader := &proxyproto.Header{
		Version:           2,
		Command:           proxyproto.PROXY,
		TransportProtocol: proxyproto.TCPv4,
		SourceAddr: &net.TCPAddr{
			IP:   net.ParseIP("203.0.113.88"),
			Port: 43210,
		},
		DestinationAddr: &net.TCPAddr{
			IP:   net.ParseIP("127.0.0.1"),
			Port: 8000,
		},
	}
	if _, err := proxyHeader.WriteTo(conn); err != nil {
		t.Fatalf("write proxy v2 header: %v", err)
	}

	request := "GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatalf("failed to write request: %v", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("failed to read response: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		t.Fatalf("failed to parse RemoteAddr %q: %v", remoteAddr, err)
	}
	if host != "203.0.113.88" {
		t.Fatalf("expected client IP 203.0.113.88, got %s (full RemoteAddr: %s)", host, remoteAddr)
	}
}

func TestGatewayProxyProtocolPolicyUseAllowsDirectConnections(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	server, err := NewServer(Config{
		Addr:                "127.0.0.1:0",
		ProxyProtocol:       true,
		ProxyProtocolPolicy: "use",
		APIHandler:          handler,
		CertificateBase:     t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}

	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- server.Run()
	}()
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	select {
	case <-server.Ready():
	case err := <-runErrCh:
		t.Fatalf("server failed before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server to become ready")
	}

	addrs := server.ListenAddrs()
	conn, err := net.Dial("tcp", addrs[0])
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Direct request WITHOUT PROXY protocol header
	request := "GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatalf("failed to write request: %v", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("direct request failed with policy 'use': %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestGatewayProxyProtocolPolicyRequireRejectsDirectConnections(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	server, err := NewServer(Config{
		Addr:                "127.0.0.1:0",
		ProxyProtocol:       true,
		ProxyProtocolPolicy: "require",
		APIHandler:          handler,
		CertificateBase:     t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}

	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- server.Run()
	}()
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	select {
	case <-server.Ready():
	case err := <-runErrCh:
		t.Fatalf("server failed before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for server to become ready")
	}

	addrs := server.ListenAddrs()
	conn, err := net.Dial("tcp", addrs[0])
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Direct request WITHOUT PROXY protocol header should fail under 'require'
	request := "GET /api/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
	_, _ = conn.Write([]byte(request))

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err == nil {
		resp.Body.Close()
		t.Fatalf("expected direct request without PROXY header to fail under policy 'require', but got status %d", resp.StatusCode)
	}
}
