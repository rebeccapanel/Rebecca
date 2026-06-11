package gateway

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestIsNativeSystemMaintenanceRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "system stats", method: http.MethodGet, path: "/api/system", want: true},
		{name: "maintenance info", method: http.MethodGet, path: "/api/maintenance/info", want: true},
		{name: "maintenance update", method: http.MethodPost, path: "/api/maintenance/update", want: true},
		{name: "maintenance restart", method: http.MethodPost, path: "/api/maintenance/restart", want: true},
		{name: "maintenance soft reload", method: http.MethodPost, path: "/api/maintenance/soft-reload", want: true},
		{name: "system wrong method", method: http.MethodPost, path: "/api/system", want: false},
		{name: "maintenance info wrong method", method: http.MethodPost, path: "/api/maintenance/info", want: false},
		{name: "maintenance unknown", method: http.MethodPost, path: "/api/maintenance/unknown", want: false},
		{name: "system websocket stays python", method: http.MethodGet, path: "/api/system", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeSystemMaintenanceRoute(req); got != tt.want {
				t.Fatalf("isNativeSystemMaintenanceRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNativeSystemMaintenanceRoutesProxyToMasterAPI(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native system/maintenance route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	masterHits := 0
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		masterHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:         "127.0.0.1:0",
		PythonHost:   host,
		PythonPort:   port,
		MasterAPIURL: master.URL,
	})
	if err != nil {
		t.Fatal(err)
	}

	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/system"},
		{method: http.MethodGet, path: "/api/maintenance/info"},
		{method: http.MethodPost, path: "/api/maintenance/update"},
		{method: http.MethodPost, path: "/api/maintenance/restart"},
		{method: http.MethodPost, path: "/api/maintenance/soft-reload"},
	}
	for _, tc := range routes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	if masterHits != len(routes) {
		t.Fatalf("master hits=%d want %d", masterHits, len(routes))
	}
}

func TestNativeSystemMaintenanceRoutesReturnUnavailableWhenMasterAPIDown(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native system/maintenance route reached python while master API was down: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:       "127.0.0.1:0",
		PythonHost: host,
		PythonPort: port,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/system"},
		{method: http.MethodPost, path: "/api/maintenance/restart"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "native Go Master API unavailable") {
				t.Fatalf("unexpected body=%s", rec.Body.String())
			}
		})
	}
}

func TestIsNativeRuntimeHelperRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "core ips", method: http.MethodGet, path: "/api/core/ips", want: true},
		{name: "core runtime", method: http.MethodGet, path: "/api/core", want: true},
		{name: "core restart", method: http.MethodPost, path: "/api/core/restart", want: true},
		{name: "core logs websocket is separate", method: http.MethodGet, path: "/api/core/logs", header: "websocket", want: false},
		{name: "xray releases", method: http.MethodGet, path: "/api/core/xray/releases", want: true},
		{name: "geo templates", method: http.MethodGet, path: "/api/core/geo/templates", want: true},
		{name: "geo apply", method: http.MethodPost, path: "/api/core/geo/apply", want: true},
		{name: "geo update", method: http.MethodPost, path: "/api/core/geo/update", want: true},
		{name: "warp get", method: http.MethodGet, path: "/api/core/warp", want: true},
		{name: "warp delete", method: http.MethodDelete, path: "/api/core/warp", want: true},
		{name: "warp register", method: http.MethodPost, path: "/api/core/warp/register", want: true},
		{name: "warp license", method: http.MethodPost, path: "/api/core/warp/license", want: true},
		{name: "warp config", method: http.MethodGet, path: "/api/core/warp/config", want: true},
		{name: "outbound test", method: http.MethodPost, path: "/api/panel/xray/testOutbound", want: true},
		{name: "outbound traffic", method: http.MethodGet, path: "/api/panel/xray/getOutboundsTraffic", want: true},
		{name: "reset outbound traffic", method: http.MethodPost, path: "/api/panel/xray/resetOutboundsTraffic", want: true},
		{name: "core ips wrong method", method: http.MethodPost, path: "/api/core/ips", want: false},
		{name: "core runtime wrong method", method: http.MethodPost, path: "/api/core", want: false},
		{name: "outbound test wrong method", method: http.MethodGet, path: "/api/panel/xray/testOutbound", want: false},
		{name: "outbound traffic wrong method", method: http.MethodPost, path: "/api/panel/xray/getOutboundsTraffic", want: false},
		{name: "warp register wrong method", method: http.MethodGet, path: "/api/core/warp/register", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/api/core/ips", header: "websocket", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeRuntimeHelperRoute(req); got != tt.want {
				t.Fatalf("isNativeRuntimeHelperRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeRuntimeWebSocketRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "core logs websocket", method: http.MethodGet, path: "/api/core/logs", header: "websocket", want: true},
		{name: "core logs plain http", method: http.MethodGet, path: "/api/core/logs", want: false},
		{name: "core runtime websocket wrong path", method: http.MethodGet, path: "/api/core", header: "websocket", want: false},
		{name: "core logs wrong method", method: http.MethodPost, path: "/api/core/logs", header: "websocket", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeRuntimeWebSocketRoute(req); got != tt.want {
				t.Fatalf("isNativeRuntimeWebSocketRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNativeRuntimeHelperRoutesProxyToMasterAPI(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native runtime helper route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	masterHits := 0
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		masterHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:         "127.0.0.1:0",
		PythonHost:   host,
		PythonPort:   port,
		MasterAPIURL: master.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/core"},
		{method: http.MethodPost, path: "/api/core/restart"},
		{method: http.MethodGet, path: "/api/core/ips"},
		{method: http.MethodGet, path: "/api/core/xray/releases"},
		{method: http.MethodGet, path: "/api/core/geo/templates"},
		{method: http.MethodPost, path: "/api/core/geo/apply"},
		{method: http.MethodPost, path: "/api/core/geo/update"},
		{method: http.MethodGet, path: "/api/core/warp"},
		{method: http.MethodDelete, path: "/api/core/warp"},
		{method: http.MethodPost, path: "/api/core/warp/register"},
		{method: http.MethodPost, path: "/api/core/warp/license"},
		{method: http.MethodGet, path: "/api/core/warp/config"},
		{method: http.MethodPost, path: "/api/panel/xray/testOutbound"},
		{method: http.MethodGet, path: "/api/panel/xray/getOutboundsTraffic"},
		{method: http.MethodPost, path: "/api/panel/xray/resetOutboundsTraffic"},
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
	if masterHits != 15 {
		t.Fatalf("master hits=%d want 15", masterHits)
	}
}

func TestDeprecatedRuntimeRoutesReturnGone(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated runtime route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated runtime route reached master api: %s %s", r.Method, r.URL.Path)
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:         "127.0.0.1:0",
		PythonHost:   host,
		PythonPort:   port,
		MasterAPIURL: master.URL,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/core/access/insights"},
		{method: http.MethodGet, path: "/api/core/access/insights/multi-node"},
		{method: http.MethodGet, path: "/api/core/access/logs/raw"},
		{method: http.MethodPost, path: "/api/core/access/operators"},
		{method: http.MethodGet, path: "/api/core/access/logs/ws"},
		{method: http.MethodPost, path: "/api/core/xray/update"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusGone {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestDeprecatedTelegramSettingsRouteReturnsGone(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated telegram settings route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated telegram settings route reached master api: %s %s", r.Method, r.URL.Path)
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:         "127.0.0.1:0",
		PythonHost:   host,
		PythonPort:   port,
		MasterAPIURL: master.URL,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, method := range []string{http.MethodGet, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/settings/telegram", nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusGone {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestIsNativeNodeRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "nodes list", method: http.MethodGet, path: "/api/nodes", want: true},
		{name: "nodes usage", method: http.MethodGet, path: "/api/nodes/usage", want: true},
		{name: "node settings", method: http.MethodGet, path: "/api/node/settings", want: true},
		{name: "node certificate new", method: http.MethodPost, path: "/api/node/certificate/new", want: true},
		{name: "node create", method: http.MethodPost, path: "/api/node", want: true},
		{name: "node get", method: http.MethodGet, path: "/api/node/12", want: true},
		{name: "node update", method: http.MethodPut, path: "/api/node/12", want: true},
		{name: "node delete", method: http.MethodDelete, path: "/api/node/12", want: true},
		{name: "node reconnect", method: http.MethodPost, path: "/api/node/12/reconnect", want: true},
		{name: "node restart", method: http.MethodPost, path: "/api/node/12/restart", want: true},
		{name: "node sync", method: http.MethodPost, path: "/api/node/12/sync", want: true},
		{name: "node logs", method: http.MethodGet, path: "/api/node/12/logs", want: true},
		{name: "node usage daily", method: http.MethodGet, path: "/api/node/12/usage/daily", want: true},
		{name: "node runtime update", method: http.MethodPost, path: "/api/node/12/xray/update", want: true},
		{name: "node geo update", method: http.MethodPost, path: "/api/node/12/geo/update", want: true},
		{name: "node service restart", method: http.MethodPost, path: "/api/node/12/service/restart", want: true},
		{name: "node service update", method: http.MethodPost, path: "/api/node/12/service/update", want: true},
		{name: "node certificate regenerate", method: http.MethodPost, path: "/api/node/12/certificate/regenerate", want: true},
		{name: "node usage reset", method: http.MethodPost, path: "/api/node/12/usage/reset", want: true},
		{name: "node websocket logs stays python", method: http.MethodGet, path: "/api/node/12/logs", header: "websocket", want: false},
		{name: "master node route is deprecated", method: http.MethodGet, path: "/api/node/master", want: false},
		{name: "runtime route stays python", method: http.MethodGet, path: "/api/core", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeNodeRoute(req); got != tt.want {
				t.Fatalf("isNativeNodeRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeNodeWebSocketRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "node logs websocket", method: http.MethodGet, path: "/api/node/12/logs", header: "websocket", want: true},
		{name: "node logs plain http", method: http.MethodGet, path: "/api/node/12/logs", want: false},
		{name: "node logs wrong method", method: http.MethodPost, path: "/api/node/12/logs", header: "websocket", want: false},
		{name: "node bad id", method: http.MethodGet, path: "/api/node/nope/logs", header: "websocket", want: false},
		{name: "node other action", method: http.MethodGet, path: "/api/node/12/restart", header: "websocket", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeNodeWebSocketRoute(req); got != tt.want {
				t.Fatalf("isNativeNodeWebSocketRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNativeNodeMutationRoutesProxyToMasterAPI(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native node route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	masterHits := 0
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		masterHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	cfg := Config{
		Addr:             "127.0.0.1:0",
		PythonHost:       host,
		PythonPort:       port,
		MasterAPIURL:     master.URL,
		NativeNodeRoutes: true,
	}
	server, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}

	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/node/settings"},
		{method: http.MethodPost, path: "/api/node/certificate/new"},
		{method: http.MethodPost, path: "/api/node"},
		{method: http.MethodPut, path: "/api/node/12"},
		{method: http.MethodDelete, path: "/api/node/12"},
		{method: http.MethodPost, path: "/api/node/12/certificate/regenerate"},
		{method: http.MethodPost, path: "/api/node/12/usage/reset"},
		{method: http.MethodGet, path: "/api/nodes"},
		{method: http.MethodGet, path: "/api/node/12"},
		{method: http.MethodPost, path: "/api/node/12/reconnect"},
		{method: http.MethodPost, path: "/api/node/12/restart"},
		{method: http.MethodPost, path: "/api/node/12/sync"},
		{method: http.MethodGet, path: "/api/node/12/logs"},
		{method: http.MethodPost, path: "/api/node/12/xray/update"},
		{method: http.MethodPost, path: "/api/node/12/geo/update"},
		{method: http.MethodPost, path: "/api/node/12/service/restart"},
		{method: http.MethodPost, path: "/api/node/12/service/update"},
	}
	for _, tc := range routes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	if masterHits != len(routes) {
		t.Fatalf("master hits=%d want %d", masterHits, len(routes))
	}
}

func TestNativeNodeRoutesReturnUnavailableWhenMasterAPIDown(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native node route reached python while master API was down: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	cfg := Config{
		Addr:             "127.0.0.1:0",
		PythonHost:       host,
		PythonPort:       port,
		NativeNodeRoutes: true,
	}
	server, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/node", nil)
	rec := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "native Go Master API unavailable") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestDeprecatedMasterNodeRoutesReturnGone(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated master node route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("deprecated master node route reached master api: %s %s", r.Method, r.URL.Path)
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	cfg := Config{
		Addr:             "127.0.0.1:0",
		PythonHost:       host,
		PythonPort:       port,
		MasterAPIURL:     master.URL,
		NativeNodeRoutes: true,
	}
	server, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/node/master"},
		{method: http.MethodPut, path: "/api/node/master"},
		{method: http.MethodPost, path: "/api/node/master/usage/reset"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusGone {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestIsNativeAdminRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "current admin", method: http.MethodGet, path: "/api/admin", want: true},
		{name: "api admin token", method: http.MethodPost, path: "/api/admin/token", want: true},
		{name: "frontend admin token alias", method: http.MethodPost, path: "/admin/token", want: true},
		{name: "admin create", method: http.MethodPost, path: "/api/admin", want: true},
		{name: "admin list", method: http.MethodGet, path: "/api/admins", want: true},
		{name: "admin update", method: http.MethodPut, path: "/api/admin/seller", want: true},
		{name: "admin usage chart", method: http.MethodGet, path: "/api/admin/seller/usage/chart", want: true},
		{name: "myaccount get", method: http.MethodGet, path: "/api/myaccount", want: true},
		{name: "myaccount password", method: http.MethodPost, path: "/api/myaccount/change_password", want: true},
		{name: "myaccount api key delete", method: http.MethodDelete, path: "/api/myaccount/api-keys/7", want: true},
		{name: "admin websocket stays python", method: http.MethodGet, path: "/api/admin", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeAdminRoute(req); got != tt.want {
				t.Fatalf("isNativeAdminRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeSettingsRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "panel get", method: http.MethodGet, path: "/api/settings/panel", want: true},
		{name: "panel put", method: http.MethodPut, path: "/api/settings/panel", want: true},
		{name: "backup export", method: http.MethodGet, path: "/api/settings/backup/export", want: true},
		{name: "backup import", method: http.MethodPost, path: "/api/settings/backup/import", want: true},
		{name: "subscriptions get", method: http.MethodGet, path: "/api/settings/subscriptions", want: true},
		{name: "subscriptions put", method: http.MethodPut, path: "/api/settings/subscriptions", want: true},
		{name: "admin override", method: http.MethodPut, path: "/api/settings/subscriptions/admins/42", want: true},
		{name: "template get", method: http.MethodGet, path: "/api/settings/subscriptions/templates/clash_subscription_template", want: true},
		{name: "template put", method: http.MethodPut, path: "/api/settings/subscriptions/templates/clash_subscription_template", want: true},
		{name: "certificate issue", method: http.MethodPost, path: "/api/settings/subscriptions/certificates/issue", want: true},
		{name: "certificate renew", method: http.MethodPost, path: "/api/settings/subscriptions/certificates/renew", want: true},
		{name: "3xui preview", method: http.MethodPost, path: "/api/settings/database/3xui/preview", want: true},
		{name: "3xui import", method: http.MethodPost, path: "/api/settings/database/3xui/import", want: true},
		{name: "3xui job", method: http.MethodGet, path: "/api/settings/database/3xui/jobs/job-1", want: true},
		{name: "telegram remains deprecated", method: http.MethodGet, path: "/api/settings/telegram", want: false},
		{name: "bad admin id", method: http.MethodPut, path: "/api/settings/subscriptions/admins/nope", want: false},
		{name: "admin wrong method", method: http.MethodGet, path: "/api/settings/subscriptions/admins/42", want: false},
		{name: "template nested path", method: http.MethodGet, path: "/api/settings/subscriptions/templates/a/b", want: false},
		{name: "certificate wrong method", method: http.MethodGet, path: "/api/settings/subscriptions/certificates/issue", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/api/settings/panel", header: "websocket", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeSettingsRoute(req); got != tt.want {
				t.Fatalf("isNativeSettingsRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNativeSettingsRoutesProxyToMasterAPI(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native settings route reached python: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	masterHits := 0
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		masterHits++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer master.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:         "127.0.0.1:0",
		PythonHost:   host,
		PythonPort:   port,
		MasterAPIURL: master.URL,
	})
	if err != nil {
		t.Fatal(err)
	}

	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/settings/panel"},
		{method: http.MethodPut, path: "/api/settings/panel"},
		{method: http.MethodGet, path: "/api/settings/backup/export"},
		{method: http.MethodPost, path: "/api/settings/backup/import"},
		{method: http.MethodGet, path: "/api/settings/subscriptions"},
		{method: http.MethodPut, path: "/api/settings/subscriptions"},
		{method: http.MethodPut, path: "/api/settings/subscriptions/admins/1"},
		{method: http.MethodGet, path: "/api/settings/subscriptions/templates/clash_subscription_template"},
		{method: http.MethodPut, path: "/api/settings/subscriptions/templates/clash_subscription_template"},
		{method: http.MethodPost, path: "/api/settings/subscriptions/certificates/issue"},
		{method: http.MethodPost, path: "/api/settings/subscriptions/certificates/renew"},
		{method: http.MethodPost, path: "/api/settings/database/3xui/preview"},
		{method: http.MethodPost, path: "/api/settings/database/3xui/import"},
		{method: http.MethodGet, path: "/api/settings/database/3xui/jobs/job-1"},
	}
	for _, tc := range routes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	if masterHits != len(routes) {
		t.Fatalf("master hits=%d want %d", masterHits, len(routes))
	}
}

func TestNativeSettingsRoutesReturnUnavailableWhenMasterAPIDown(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("native settings route reached python while master API was down: %s %s", r.Method, r.URL.Path)
	}))
	defer python.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		Addr:       "127.0.0.1:0",
		PythonHost: host,
		PythonPort: port,
	})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/settings/subscriptions", nil)
	rec := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "native Go Master API unavailable") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestIsNativeCoreConfigRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "get config", method: http.MethodGet, path: "/api/core/config", want: true},
		{name: "put config", method: http.MethodPut, path: "/api/core/config", want: true},
		{name: "get targets", method: http.MethodGet, path: "/api/core/config/targets", want: true},
		{name: "mode update", method: http.MethodPut, path: "/api/core/config/targets/7/mode", want: true},
		{name: "mode update trailing slash", method: http.MethodPut, path: "/api/core/config/targets/7/mode/", want: true},
		{name: "bad node id stays python", method: http.MethodPut, path: "/api/core/config/targets/nope/mode", want: false},
		{name: "wrong target method stays python", method: http.MethodPost, path: "/api/core/config/targets", want: false},
		{name: "runtime root stays python", method: http.MethodGet, path: "/api/core", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/api/core/config", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeCoreConfigRoute(req); got != tt.want {
				t.Fatalf("isNativeCoreConfigRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeXrayHelperRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "api vlessenc", method: http.MethodGet, path: "/api/xray/vlessenc", want: true},
		{name: "api reality keypair", method: http.MethodGet, path: "/api/xray/reality-keypair", want: true},
		{name: "api reality shortid", method: http.MethodGet, path: "/api/xray/reality-shortid", want: true},
		{name: "api mldsa65", method: http.MethodGet, path: "/api/xray/mldsa65", want: true},
		{name: "api ech", method: http.MethodGet, path: "/api/xray/ech", want: true},
		{name: "legacy vlessenc", method: http.MethodGet, path: "/xray/vlessenc", want: true},
		{name: "wrong method stays python", method: http.MethodPost, path: "/api/xray/vlessenc", want: false},
		{name: "unknown helper stays python", method: http.MethodGet, path: "/api/xray/unknown", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/api/xray/reality-keypair", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeXrayHelperRoute(req); got != tt.want {
				t.Fatalf("isNativeXrayHelperRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeInboundRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "legacy inbounds list", method: http.MethodGet, path: "/inbounds", want: true},
		{name: "legacy inbounds full", method: http.MethodGet, path: "/inbounds/full", want: true},
		{name: "legacy inbound detail", method: http.MethodGet, path: "/inbounds/cdn", want: true},
		{name: "legacy inbound create", method: http.MethodPost, path: "/inbounds", want: true},
		{name: "legacy inbound update", method: http.MethodPut, path: "/inbounds/cdn", want: true},
		{name: "legacy inbound delete", method: http.MethodDelete, path: "/inbounds/cdn", want: true},
		{name: "api inbounds list", method: http.MethodGet, path: "/api/inbounds", want: true},
		{name: "api inbounds full", method: http.MethodGet, path: "/api/inbounds/full", want: true},
		{name: "api inbound detail", method: http.MethodGet, path: "/api/inbounds/cdn", want: true},
		{name: "wrong full method stays python", method: http.MethodPost, path: "/api/inbounds/full", want: false},
		{name: "nested path stays python", method: http.MethodGet, path: "/api/inbounds/cdn/extra", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/api/inbounds/cdn", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeInboundRoute(req); got != tt.want {
				t.Fatalf("isNativeInboundRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeHostRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "legacy hosts list", method: http.MethodGet, path: "/hosts", want: true},
		{name: "legacy hosts modify", method: http.MethodPut, path: "/hosts", want: true},
		{name: "legacy host status", method: http.MethodPut, path: "/hosts/7/status", want: true},
		{name: "api hosts list", method: http.MethodGet, path: "/api/hosts", want: true},
		{name: "api hosts modify", method: http.MethodPut, path: "/api/hosts", want: true},
		{name: "api host status", method: http.MethodPut, path: "/api/hosts/7/status", want: true},
		{name: "bad id stays python", method: http.MethodPut, path: "/api/hosts/nope/status", want: false},
		{name: "wrong suffix stays python", method: http.MethodPut, path: "/api/hosts/7/other", want: false},
		{name: "host websocket stays python", method: http.MethodGet, path: "/api/hosts", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeHostRoute(req); got != tt.want {
				t.Fatalf("isNativeHostRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeUserRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "users list", method: http.MethodGet, path: "/api/users", want: true},
		{name: "users list trailing slash", method: http.MethodGet, path: "/api/users/", want: true},
		{name: "users usage", method: http.MethodGet, path: "/api/users/usage", want: true},
		{name: "user detail", method: http.MethodGet, path: "/api/user/alice", want: true},
		{name: "user detail url encoded", method: http.MethodGet, path: "/api/user/alice%20vpn", want: true},
		{name: "user create", method: http.MethodPost, path: "/api/user", want: true},
		{name: "user create v2", method: http.MethodPost, path: "/api/v2/users", want: true},
		{name: "user update", method: http.MethodPut, path: "/api/user/alice", want: true},
		{name: "user update v2", method: http.MethodPut, path: "/api/v2/users/alice", want: true},
		{name: "user delete", method: http.MethodDelete, path: "/api/user/alice", want: true},
		{name: "user reset", method: http.MethodPost, path: "/api/user/alice/reset", want: true},
		{name: "user revoke sub", method: http.MethodPost, path: "/api/user/alice/revoke_sub", want: true},
		{name: "user active next", method: http.MethodPost, path: "/api/user/alice/active-next", want: true},
		{name: "user usage", method: http.MethodGet, path: "/api/user/alice/usage", want: true},
		{name: "users bulk action", method: http.MethodPost, path: "/api/users/actions", want: true},
		{name: "service scoped users bulk action", method: http.MethodPost, path: "/api/v2/services/7/users/actions", want: true},
		{name: "service scoped users bulk action bad id stays python", method: http.MethodPost, path: "/api/v2/services/nope/users/actions", want: false},
		{name: "service scoped users bulk action wrong method stays python", method: http.MethodGet, path: "/api/v2/services/7/users/actions", want: false},
		{name: "user websocket stays python", method: http.MethodGet, path: "/api/user/alice", header: "websocket", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeUserRoute(req); got != tt.want {
				t.Fatalf("isNativeUserRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeServiceRoute(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		header string
		want   bool
	}{
		{name: "services list", method: http.MethodGet, path: "/api/v2/services", want: true},
		{name: "service create", method: http.MethodPost, path: "/api/v2/services", want: true},
		{name: "service detail", method: http.MethodGet, path: "/api/v2/services/7", want: true},
		{name: "service update", method: http.MethodPut, path: "/api/v2/services/7", want: true},
		{name: "service delete", method: http.MethodDelete, path: "/api/v2/services/7", want: true},
		{name: "service reset usage", method: http.MethodPost, path: "/api/v2/services/7/reset-usage", want: true},
		{name: "service admin limits", method: http.MethodPut, path: "/api/v2/services/7/admins/2/limits", want: true},
		{name: "service usage timeseries", method: http.MethodGet, path: "/api/v2/services/7/usage/timeseries", want: true},
		{name: "service usage admins", method: http.MethodGet, path: "/api/v2/services/7/usage/admins", want: true},
		{name: "service admin usage timeseries", method: http.MethodGet, path: "/api/v2/services/7/usage/admin-timeseries", want: true},
		{name: "service scoped users action", method: http.MethodPost, path: "/api/v2/services/7/users/actions", want: true},
		{name: "service users list", method: http.MethodGet, path: "/api/v2/services/7/users", want: true},
		{name: "service users wrong method stays python", method: http.MethodPost, path: "/api/v2/services/7/users", want: false},
		{name: "service auto inbound create", method: http.MethodPost, path: "/api/v2/services/7/auto-inbound", want: true},
		{name: "service auto inbound delete", method: http.MethodDelete, path: "/api/v2/services/7/auto-inbound", want: true},
		{name: "service websocket stays python", method: http.MethodGet, path: "/api/v2/services/7", header: "websocket", want: false},
		{name: "bad service id stays python", method: http.MethodGet, path: "/api/v2/services/nope", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeServiceRoute(req); got != tt.want {
				t.Fatalf("isNativeServiceRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsNativeSubscriptionRoute(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		path     string
		header   string
		prefixes []string
		want     bool
	}{
		{name: "sub token", method: http.MethodGet, path: "/sub/token", want: true},
		{name: "sub token info", method: http.MethodGet, path: "/sub/token/info", want: true},
		{name: "sub username key", method: http.MethodGet, path: "/sub/alice/key", want: true},
		{name: "subscribe query alias", method: http.MethodGet, path: "/api/v1/client/subscribe", want: true},
		{name: "subscribe path alias", method: http.MethodGet, path: "/api/v1/client/subscribe/token", want: true},
		{name: "custom prefix", method: http.MethodGet, path: "/my-sub/token", prefixes: []string{"/my-sub"}, want: true},
		{name: "post stays python", method: http.MethodPost, path: "/sub/token", want: false},
		{name: "websocket stays python", method: http.MethodGet, path: "/sub/token", header: "websocket", want: false},
		{name: "dashboard stays python", method: http.MethodGet, path: "/dashboard/login", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Upgrade", tt.header)
			}
			if got := isNativeSubscriptionRoute(req, tt.prefixes); got != tt.want {
				t.Fatalf("isNativeSubscriptionRoute() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNativeNodeRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL:     "http://127.0.0.1:1",
		NativeNodeRoutes: true,
		PythonHost:       host,
		PythonPort:       port,
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)
	server.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "python fallback") {
		t.Fatalf("native node route fell back to python: %s", rec.Body.String())
	}
}

func TestNativeSubscriptionRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL:             "http://127.0.0.1:1",
		NativeSubscriptionRoutes: true,
		PythonHost:               host,
		PythonPort:               port,
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sub/token", nil)
	server.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "python fallback") {
		t.Fatalf("native subscription route fell back to python: %s", rec.Body.String())
	}
}

func TestNativeCoreConfigRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/core/config"},
		{method: http.MethodPut, path: "/api/core/config"},
		{method: http.MethodGet, path: "/api/core/config/targets"},
		{method: http.MethodPut, path: "/api/core/config/targets/7/mode"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native core config route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeXrayHelperRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		"/api/xray/vlessenc",
		"/api/xray/reality-keypair",
		"/api/xray/reality-shortid",
		"/api/xray/mldsa65",
		"/api/xray/ech",
		"/xray/vlessenc",
	} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native xray helper route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeInboundRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/inbounds"},
		{method: http.MethodGet, path: "/inbounds/full"},
		{method: http.MethodGet, path: "/inbounds/cdn"},
		{method: http.MethodPost, path: "/inbounds"},
		{method: http.MethodPut, path: "/inbounds/cdn"},
		{method: http.MethodDelete, path: "/inbounds/cdn"},
		{method: http.MethodGet, path: "/api/inbounds"},
		{method: http.MethodGet, path: "/api/inbounds/full"},
		{method: http.MethodGet, path: "/api/inbounds/cdn"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native inbound route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeHostRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/hosts"},
		{method: http.MethodPut, path: "/hosts"},
		{method: http.MethodPut, path: "/hosts/7/status"},
		{method: http.MethodGet, path: "/api/hosts"},
		{method: http.MethodPut, path: "/api/hosts"},
		{method: http.MethodPut, path: "/api/hosts/7/status"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native host route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeUserRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/users"},
		{method: http.MethodGet, path: "/api/users/usage"},
		{method: http.MethodGet, path: "/api/user/alice"},
		{method: http.MethodGet, path: "/api/user/alice/usage"},
		{method: http.MethodPost, path: "/api/user"},
		{method: http.MethodPost, path: "/api/v2/users"},
		{method: http.MethodPut, path: "/api/user/alice"},
		{method: http.MethodPut, path: "/api/v2/users/alice"},
		{method: http.MethodDelete, path: "/api/user/alice"},
		{method: http.MethodPost, path: "/api/user/alice/reset"},
		{method: http.MethodPost, path: "/api/user/alice/revoke_sub"},
		{method: http.MethodPost, path: "/api/user/alice/active-next"},
		{method: http.MethodPost, path: "/api/users/actions"},
		{method: http.MethodPost, path: "/api/v2/services/7/users/actions"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native user route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeServiceRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()
	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v2/services"},
		{method: http.MethodPost, path: "/api/v2/services"},
		{method: http.MethodGet, path: "/api/v2/services/7"},
		{method: http.MethodPut, path: "/api/v2/services/7"},
		{method: http.MethodDelete, path: "/api/v2/services/7"},
		{method: http.MethodPost, path: "/api/v2/services/7/reset-usage"},
		{method: http.MethodPut, path: "/api/v2/services/7/admins/2/limits"},
		{method: http.MethodGet, path: "/api/v2/services/7/usage/timeseries"},
		{method: http.MethodGet, path: "/api/v2/services/7/usage/admins"},
		{method: http.MethodGet, path: "/api/v2/services/7/usage/admin-timeseries"},
		{method: http.MethodGet, path: "/api/v2/services/7/users"},
		{method: http.MethodPost, path: "/api/v2/services/7/users/actions"},
		{method: http.MethodPost, path: "/api/v2/services/7/auto-inbound"},
		{method: http.MethodDelete, path: "/api/v2/services/7/auto-inbound"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			server.server.Handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "python fallback") {
				t.Fatalf("native service route fell back to python: %s", rec.Body.String())
			}
		})
	}
}

func TestNativeAdminRouteDoesNotFallbackToPython(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: "http://127.0.0.1:1",
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admins", nil)
	server.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "python fallback") {
		t.Fatalf("native admin route fell back to python: %s", rec.Body.String())
	}
}

func TestNativeAdminRouteProxiesToGoMasterAPI(t *testing.T) {
	master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/token" || r.Method != http.MethodPost {
			t.Fatalf("unexpected master request: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"access_token":"go-token","token_type":"bearer"}`))
	}))
	defer master.Close()

	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("python fallback"))
	}))
	defer python.Close()

	pythonURL := strings.TrimPrefix(python.URL, "http://")
	host, portValue, err := net.SplitHostPort(pythonURL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	server, err := NewServer(Config{
		MasterAPIURL: master.URL,
		PythonHost:   host,
		PythonPort:   port,
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/token", strings.NewReader("username=a&password=b"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	server.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "python fallback") {
		t.Fatalf("native admin route fell back to python: %s", rec.Body.String())
	}
}
