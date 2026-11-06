package nodecontroller

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRenderHAProxyConfigSupportsMultipleListenersAndWebsite(t *testing.T) {
	settings := defaultHAProxySettings()
	settings.HealthCheck = false
	text, err := renderHAProxyConfig(settings, 12, HAProxyTarget{NodeID: 7, Listeners: []HAProxyListener{
		{Name: "shared-443", ListenAddress: "0.0.0.0", ListenPort: 443, Routes: []HAProxyRoute{
			{Name: "ws", Source: "external", BackendHost: "127.0.0.1", BackendPort: 5423, MatchType: "http_path", MatchValue: "/edge"},
			{Name: "fallback", Source: "external", BackendHost: "127.0.0.1", BackendPort: 5424, MatchType: "default"},
		}, Sites: []HAProxySite{
			{Enabled: true, Source: "builtin", TemplateID: "builtin", TLSMode: "none"},
			{Enabled: true, Source: "builtin", TemplateID: "builtin", TLSMode: "self_signed", Hostname: "site.example.com"},
		}},
		{Name: "shared-550", ListenAddress: "0.0.0.0", ListenPort: 550, Routes: []HAProxyRoute{
			{Name: "tls", Source: "external", BackendHost: "127.0.0.1", BackendPort: 5501, MatchType: "sni", MatchValue: "edge.example.com"},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"bind 0.0.0.0:443", "bind 0.0.0.0:550", "path_beg /edge",
		"req.ssl_sni -i edge.example.com", "use_backend site_0_0 if site_0_0_http",
		"req.ssl_sni -i site.example.com", "server target unix@/tmp/rebecca-haproxy-12-0-1.sock",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("generated config is missing %q:\n%s", expected, text)
		}
	}
}

func TestDefaultWebsiteHandlesUnmatchedHTTPAndTLS(t *testing.T) {
	settings := defaultHAProxySettings()
	settings.HealthCheck = false
	text, err := renderHAProxyConfig(settings, 21, HAProxyTarget{Listeners: []HAProxyListener{{
		Name: "shared", ListenAddress: "127.0.0.1", ListenPort: 443,
		Routes: []HAProxyRoute{{Name: "path", Source: "external", BackendHost: "127.0.0.1", BackendPort: 5423, MatchType: "http_path", MatchValue: "/edge"}},
		Sites:  []HAProxySite{{Enabled: true, Default: true, Source: "builtin", TemplateID: "builtin", TLSMode: "none"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"use_backend backend_0_0 if match_0_0",
		"use_backend site_0_0 if { req.proto_http }",
		"use_backend site_tls_0_0 if { req_ssl_hello_type 1 }",
		"server target unix@/tmp/rebecca-haproxy-21-0-0.sock",
		"server target unix@/tmp/rebecca-haproxy-21-0-0-tls.sock",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("generated config is missing %q:\n%s", expected, text)
		}
	}
}

func TestDefaultWebsiteRejectsAnotherFallback(t *testing.T) {
	repository := Repository{}
	site := HAProxySite{Enabled: true, Default: true, Source: "builtin", TemplateID: "builtin", TLSMode: "self_signed"}
	if err := repository.normalizeHAProxySite(context.Background(), &site); err != nil {
		t.Fatalf("default website should not require a hostname: %v", err)
	}
	target := HAProxyTarget{Listeners: []HAProxyListener{{
		Name: "shared", ListenAddress: "127.0.0.1", ListenPort: 443,
		Routes: []HAProxyRoute{{Name: "fallback", Source: "external", BackendHost: "127.0.0.1", BackendPort: 5423, MatchType: "default"}},
		Sites:  []HAProxySite{site},
	}}}
	if err := repository.normalizeHAProxyTarget(context.Background(), &target, nil); err == nil || !strings.Contains(err.Error(), "both a default website and a default route") {
		t.Fatalf("expected conflicting fallbacks to be rejected, got %v", err)
	}
}

func TestResolveHAProxyTemplateMoURL(t *testing.T) {
	template, err := ResolveHAProxyTemplateMoURL("https://templatemo.com/tm-632-machina")
	if err != nil {
		t.Fatal(err)
	}
	if template.ID != "632-machina" || template.DownloadURL != "https://templatemo.com/download/templatemo_632_machina" {
		t.Fatalf("unexpected TemplateMo resolution: %#v", template)
	}
	if _, err := ResolveHAProxyTemplateMoURL("https://example.com/tm-632-machina"); err == nil {
		t.Fatal("untrusted template host was accepted")
	}
}

func TestNormalizeHAProxyRoutesResolvesXrayBackend(t *testing.T) {
	listener := HAProxyListener{ListenPort: 443, Routes: []HAProxyRoute{{
		Name: "ws", Source: "xray", InboundTag: "vless-ws", MatchType: "http_path", MatchValue: "/edge",
	}}}
	candidates := map[string]HAProxyCandidate{"vless-ws": {
		Tag: "vless-ws", Protocol: "vless", Network: "ws", Port: 5423,
		Matchers: []HAProxyMatcher{{Type: "http_path", Value: "/edge"}},
	}}
	if err := normalizeHAProxyRoutes(&listener, candidates); err != nil {
		t.Fatal(err)
	}
	if route := listener.Routes[0]; route.BackendHost != "127.0.0.1" || route.BackendPort != 5423 || route.Protocol != "vless" {
		t.Fatalf("unexpected resolved route: %#v", route)
	}
}

func TestHAProxyShadowsocksRequiresPath(t *testing.T) {
	stream := map[string]any{"network": "ws", "security": "tls", "wsSettings": map[string]any{"host": "ss.example.com"}}
	if haproxyInboundEligible("shadowsocks", stream, "ws") {
		t.Fatal("Shadowsocks without a path must not be selectable")
	}
	stream["wsSettings"].(map[string]any)["path"] = "/ss"
	if !haproxyInboundEligible("shadowsocks", stream, "ws") {
		t.Fatal("Shadowsocks with a path must be selectable")
	}
}

func TestHAProxyLiveRoutesHTTPSTLSAndOpaqueTraffic(t *testing.T) {
	binary := os.Getenv("HAPROXY_TEST_BINARY")
	if binary == "" {
		t.Skip("HAPROXY_TEST_BINARY is not set")
	}
	pathPort, pathHit, closePath := probeBackend(t, "path")
	defer closePath()
	tlsPort, tlsHit, closeTLS := probeBackend(t, "")
	defer closeTLS()
	fallbackPort, fallbackHit, closeFallback := probeBackend(t, "")
	defer closeFallback()
	secondPort, secondHit, closeSecond := probeBackend(t, "")
	defer closeSecond()
	frontend, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	frontendPort := frontend.Addr().(*net.TCPAddr).Port
	_ = frontend.Close()
	secondFrontend, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	secondFrontendPort := secondFrontend.Addr().(*net.TCPAddr).Port
	_ = secondFrontend.Close()
	settings := defaultHAProxySettings()
	settings.HealthCheck = false
	settings.InspectDelayMS = 1000
	text, err := renderHAProxyConfig(settings, 1, HAProxyTarget{Listeners: []HAProxyListener{
		{
			Name: "live", ListenAddress: "127.0.0.1", ListenPort: frontendPort,
			Routes: []HAProxyRoute{
				{Name: "path", Source: "external", BackendHost: "127.0.0.1", BackendPort: pathPort, MatchType: "http_path", MatchValue: "/ss"},
				{Name: "tls", Source: "external", BackendHost: "127.0.0.1", BackendPort: tlsPort, MatchType: "sni", MatchValue: "tls.example.test"},
				{Name: "fallback", Source: "external", BackendHost: "127.0.0.1", BackendPort: fallbackPort, MatchType: "default"},
			},
		},
		{
			Name: "second", ListenAddress: "127.0.0.1", ListenPort: secondFrontendPort,
			Routes: []HAProxyRoute{{Name: "second", Source: "external", BackendHost: "127.0.0.1", BackendPort: secondPort, MatchType: "default"}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "haproxy.cfg")
	if err := os.WriteFile(configPath, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(binary, "-c", "-f", configPath).CombinedOutput(); err != nil {
		t.Fatalf("HAProxy rejected generated config: %v\n%s", err, output)
	}
	command := exec.Command(binary, "-db", "-f", configPath)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = command.Process.Signal(syscall.SIGTERM)
		_, _ = command.Process.Wait()
	}()
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(frontendPort))
	waitForTCP(t, address)
	waitForHit(t, fallbackHit, "readiness probe")

	connection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fmt.Fprintf(connection, "GET /ss/test HTTP/1.1\r\nHost: ordinary.example\r\nConnection: close\r\n\r\n")
	_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
	response := make([]byte, 256)
	count, _ := connection.Read(response)
	_ = connection.Close()
	if !strings.Contains(string(response[:count]), "path") {
		t.Fatalf("HTTP path traffic reached the wrong backend: %q", response[:count])
	}
	waitForHit(t, pathHit, "HTTP path")

	tlsConnection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	client := tls.Client(tlsConnection, &tls.Config{ServerName: "tls.example.test", InsecureSkipVerify: true}) // #nosec G402 -- synthetic local handshake
	_ = client.Handshake()
	_ = client.Close()
	waitForHit(t, tlsHit, "TLS SNI")

	raw, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = raw.Write([]byte("opaque-encrypted-packet"))
	_ = raw.Close()
	waitForHit(t, fallbackHit, "opaque fallback")

	secondAddress := net.JoinHostPort("127.0.0.1", strconv.Itoa(secondFrontendPort))
	second, err := net.DialTimeout("tcp", secondAddress, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = second.Write([]byte("second-listener-packet"))
	_ = second.Close()
	waitForHit(t, secondHit, "second listener")
}

func TestHAProxyLiveDefaultWebsiteReceivesHTTPAndTLS(t *testing.T) {
	binary := os.Getenv("HAPROXY_TEST_BINARY")
	if binary == "" {
		t.Skip("HAPROXY_TEST_BINARY is not set")
	}
	frontend, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	frontendPort := frontend.Addr().(*net.TCPAddr).Port
	_ = frontend.Close()
	configID := time.Now().UnixNano()
	httpHit, closeHTTP := probeUnixBackend(t, haproxySiteSocket(configID, 0, 0))
	defer closeHTTP()
	tlsHit, closeTLS := probeUnixBackend(t, haproxyDefaultTLSSiteSocket(configID, 0, 0))
	defer closeTLS()
	settings := defaultHAProxySettings()
	settings.HealthCheck = false
	settings.InspectDelayMS = 500
	text, err := renderHAProxyConfig(settings, configID, HAProxyTarget{Listeners: []HAProxyListener{{
		Name: "default-site", ListenAddress: "127.0.0.1", ListenPort: frontendPort,
		Sites: []HAProxySite{{Enabled: true, Default: true, Source: "builtin", TemplateID: "builtin", TLSMode: "none"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "haproxy.cfg")
	if err := os.WriteFile(configPath, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(binary, "-c", "-f", configPath).CombinedOutput(); err != nil {
		t.Fatalf("HAProxy rejected generated config: %v\n%s", err, output)
	}
	command := exec.Command(binary, "-db", "-f", configPath)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = command.Process.Signal(syscall.SIGTERM)
		_, _ = command.Process.Wait()
	}()
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(frontendPort))
	waitForTCP(t, address)

	httpConnection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fmt.Fprint(httpConnection, "GET / HTTP/1.1\r\nHost: unmatched.example\r\nConnection: close\r\n\r\n")
	_ = httpConnection.Close()
	waitForHit(t, httpHit, "default HTTP website")

	tlsConnection, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	client := tls.Client(tlsConnection, &tls.Config{ServerName: "unmatched.example", InsecureSkipVerify: true}) // #nosec G402 -- synthetic local handshake
	_ = client.Handshake()
	_ = client.Close()
	waitForHit(t, tlsHit, "default HTTPS website")
}

func probeBackend(t *testing.T, response string) (int, <-chan struct{}, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	hit := make(chan struct{}, 4)
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
				buffer := make([]byte, 4096)
				_, _ = connection.Read(buffer)
				hit <- struct{}{}
				if response != "" {
					_, _ = fmt.Fprintf(connection, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(response), response)
				}
			}()
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port, hit, func() { _ = listener.Close() }
}

func probeUnixBackend(t *testing.T, socket string) (<-chan struct{}, func()) {
	t.Helper()
	_ = os.Remove(socket)
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	hit := make(chan struct{}, 2)
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
				_, _ = connection.Read(make([]byte, 4096))
				hit <- struct{}{}
			}()
		}
	}()
	return hit, func() {
		_ = listener.Close()
		_ = os.Remove(socket)
	}
}

func waitForTCP(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 50*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("HAProxy did not listen on %s", address)
}

func waitForHit(t *testing.T, hit <-chan struct{}, kind string) {
	t.Helper()
	select {
	case <-hit:
	case <-time.After(3 * time.Second):
		t.Fatalf("%s traffic did not reach its backend", kind)
	}
}

func TestHAProxyInboundMatchersReadXHTTPPathFromEitherSettingsKey(t *testing.T) {
	for _, tc := range []struct{ network, key string }{
		{"xhttp", "xhttpSettings"},
		{"xhttp", "splithttpSettings"},
		{"splithttp", "xhttpSettings"},
		{"splithttp", "splithttpSettings"},
	} {
		stream := map[string]any{"network": tc.network, "security": "none", tc.key: map[string]any{"path": "/xh?ed=1"}}
		matchers := haproxyInboundMatchers(stream, tc.network, "none")
		if len(matchers) != 1 || matchers[0].Type != "http_path" || matchers[0].Value != "/xh" {
			t.Fatalf("%s/%s: unexpected matchers %v", tc.network, tc.key, matchers)
		}
	}
}
