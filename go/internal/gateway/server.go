package gateway

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	cfg    Config
	server *http.Server
}

func NewServer(cfg Config) (*Server, error) {
	target, err := url.Parse("http://" + cfg.PythonAddr())
	if err != nil {
		return nil, err
	}

	pythonProxy := httputil.NewSingleHostReverseProxy(target)
	pythonProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, fmt.Sprintf("python runtime unavailable: %s", err), http.StatusBadGateway)
	}

	var masterProxy *httputil.ReverseProxy
	if strings.TrimSpace(cfg.MasterAPIURL) != "" {
		masterTarget, err := url.Parse(strings.TrimRight(cfg.MasterAPIURL, "/"))
		if err != nil {
			return nil, err
		}
		masterProxy = httputil.NewSingleHostReverseProxy(masterTarget)
		masterProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, fmt.Sprintf("native Go Master API unavailable: %s", err), http.StatusServiceUnavailable)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/__rebecca_go/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/__rebecca_go/master_api_healthz", func(w http.ResponseWriter, r *http.Request) {
		if masterProxy == nil || strings.TrimSpace(cfg.MasterAPIURL) == "" {
			http.Error(w, "native node routes are not enabled", http.StatusServiceUnavailable)
			return
		}
		req, err := http.NewRequestWithContext(
			r.Context(),
			http.MethodGet,
			strings.TrimRight(cfg.MasterAPIURL, "/")+"/__rebecca_master_api/healthz",
			nil,
		)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		defer res.Body.Close()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(res.StatusCode)
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			_, _ = w.Write([]byte("ok\n"))
		}
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if isNativeRuntimeWebSocketRoute(r) || (cfg.NativeNodeRoutes && isNativeNodeWebSocketRoute(r)) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isDeprecatedRuntimeRoute(r) {
			http.Error(w, deprecatedRuntimeRouteDetail(r), http.StatusGone)
			return
		}
		if isDeprecatedTelegramSettingsRoute(r) {
			http.Error(w, "Telegram integration is temporarily disabled and tracked in TODO_GO_TELEGRAM.md.", http.StatusGone)
			return
		}
		if isNativeSettingsRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isDeprecatedMasterNodeRoute(r) {
			http.Error(w, "master node usage/runtime routes have been removed", http.StatusGone)
			return
		}
		if isNativeSystemMaintenanceRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeAdminRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeCoreConfigRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeRuntimeHelperRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeXrayHelperRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeInboundRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeHostRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeServiceRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if isNativeUserRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if cfg.NativeSubscriptionRoutes && isNativeSubscriptionRoute(r, cfg.SubscriptionPrefixes) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		if cfg.NativeNodeRoutes && isNativeNodeRoute(r) {
			if masterProxy == nil {
				http.Error(w, "native Go Master API unavailable", http.StatusServiceUnavailable)
				return
			}
			masterProxy.ServeHTTP(w, r)
			return
		}
		pythonProxy.ServeHTTP(w, r)
	})

	return &Server{
		cfg: cfg,
		server: &http.Server{
			Addr:              cfg.Addr,
			Handler:           mux,
			ReadHeaderTimeout: 15 * time.Second,
		},
	}, nil
}

func isNativeSystemMaintenanceRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/system":
		return r.Method == http.MethodGet
	case "/api/maintenance/info":
		return r.Method == http.MethodGet
	case "/api/maintenance/update", "/api/maintenance/restart", "/api/maintenance/soft-reload":
		return r.Method == http.MethodPost
	default:
		return false
	}
}

func isNativeSubscriptionRoute(r *http.Request, prefixes []string) bool {
	if r.Method != http.MethodGet || strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	if path == "/api/v1/client/subscribe" || strings.HasPrefix(path, "/api/v1/client/subscribe/") {
		return true
	}
	if path == "/sub" || strings.HasPrefix(path, "/sub/") {
		return true
	}
	for _, prefix := range prefixes {
		prefix = strings.TrimRight(strings.TrimSpace(prefix), "/")
		if prefix == "" {
			continue
		}
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

func isNativeAdminRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/admin":
		return r.Method == http.MethodGet || r.Method == http.MethodPost
	case "/api/admins":
		return r.Method == http.MethodGet
	case "/api/admin/token", "/admin/token":
		return r.Method == http.MethodPost
	}
	if strings.HasPrefix(path, "/api/admin/") {
		return true
	}
	if path == "/api/myaccount" || strings.HasPrefix(path, "/api/myaccount/") {
		return true
	}
	return false
}

func isNativeCoreConfigRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/core/config":
		return r.Method == http.MethodGet || r.Method == http.MethodPut
	case "/api/core/config/targets":
		return r.Method == http.MethodGet
	}
	if r.Method != http.MethodPut || !strings.HasPrefix(path, "/api/core/config/targets/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/core/config/targets/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "mode" {
		return false
	}
	_, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil
}

func isNativeRuntimeHelperRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/core":
		return r.Method == http.MethodGet
	case "/api/core/restart":
		return r.Method == http.MethodPost
	case "/api/core/ips":
		return r.Method == http.MethodGet
	case "/api/core/xray/releases", "/api/core/geo/templates":
		return r.Method == http.MethodGet
	case "/api/core/geo/apply", "/api/core/geo/update":
		return r.Method == http.MethodPost
	case "/api/core/warp":
		return r.Method == http.MethodGet || r.Method == http.MethodDelete
	case "/api/core/warp/register", "/api/core/warp/license":
		return r.Method == http.MethodPost
	case "/api/core/warp/config":
		return r.Method == http.MethodGet
	case "/api/panel/xray/getOutboundsTraffic":
		return r.Method == http.MethodGet
	case "/api/panel/xray/testOutbound":
		return r.Method == http.MethodPost
	case "/api/panel/xray/resetOutboundsTraffic":
		return r.Method == http.MethodPost
	default:
		return false
	}
}

func isNativeRuntimeWebSocketRoute(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	return path == "/api/core/logs" && r.Method == http.MethodGet
}

func isDeprecatedRuntimeRoute(r *http.Request) bool {
	path := strings.TrimRight(r.URL.Path, "/")
	return path == "/api/core/xray/update" || path == "/api/core/access" || strings.HasPrefix(path, "/api/core/access/")
}

func deprecatedRuntimeRouteDetail(r *http.Request) string {
	path := strings.TrimRight(r.URL.Path, "/")
	if path == "/api/core/xray/update" {
		return "Master runtime is node-only; update nodes instead."
	}
	return "Access Insights is temporarily disabled while it is rebuilt as a Go-native feature."
}

func isDeprecatedTelegramSettingsRoute(r *http.Request) bool {
	path := strings.TrimRight(r.URL.Path, "/")
	return path == "/api/settings/telegram"
}

func isNativeSettingsRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/settings/panel":
		return r.Method == http.MethodGet || r.Method == http.MethodPut
	case "/api/settings/backup/export":
		return r.Method == http.MethodGet
	case "/api/settings/backup/import":
		return r.Method == http.MethodPost
	case "/api/settings/subscriptions":
		return r.Method == http.MethodGet || r.Method == http.MethodPut
	case "/api/settings/subscriptions/certificates/issue", "/api/settings/subscriptions/certificates/renew":
		return r.Method == http.MethodPost
	case "/api/settings/database/3xui/preview", "/api/settings/database/3xui/import":
		return r.Method == http.MethodPost
	}
	if strings.HasPrefix(path, "/api/settings/subscriptions/admins/") {
		rest := strings.TrimPrefix(path, "/api/settings/subscriptions/admins/")
		if rest == "" || strings.Contains(rest, "/") {
			return false
		}
		_, err := strconv.ParseInt(rest, 10, 64)
		return err == nil && r.Method == http.MethodPut
	}
	if strings.HasPrefix(path, "/api/settings/subscriptions/templates/") {
		rest := strings.TrimPrefix(path, "/api/settings/subscriptions/templates/")
		return rest != "" && !strings.Contains(rest, "/") && (r.Method == http.MethodGet || r.Method == http.MethodPut)
	}
	if strings.HasPrefix(path, "/api/settings/database/3xui/jobs/") {
		rest := strings.TrimPrefix(path, "/api/settings/database/3xui/jobs/")
		return rest != "" && !strings.Contains(rest, "/") && r.Method == http.MethodGet
	}
	return false
}

func isNativeXrayHelperRoute(r *http.Request) bool {
	if r.Method != http.MethodGet || strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/xray/vlessenc", "/api/xray/reality-keypair", "/api/xray/reality-shortid", "/api/xray/mldsa65", "/api/xray/ech",
		"/xray/vlessenc", "/xray/reality-keypair", "/xray/reality-shortid", "/xray/mldsa65", "/xray/ech":
		return true
	default:
		return false
	}
}

func isNativeInboundRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/inbounds", "/inbounds":
		return r.Method == http.MethodGet || r.Method == http.MethodPost
	case "/api/inbounds/full", "/inbounds/full":
		return r.Method == http.MethodGet
	}
	for _, prefix := range []string{"/api/inbounds/", "/inbounds/"} {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		rest := strings.TrimPrefix(path, prefix)
		if rest == "" || strings.Contains(rest, "/") || rest == "full" {
			return false
		}
		return r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodDelete
	}
	return false
}

func isNativeHostRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/hosts", "/hosts":
		return r.Method == http.MethodGet || r.Method == http.MethodPut
	}
	for _, prefix := range []string{"/api/hosts/", "/hosts/"} {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		rest := strings.TrimPrefix(path, prefix)
		parts := strings.Split(rest, "/")
		if len(parts) != 2 || parts[0] == "" || parts[1] != "status" {
			return false
		}
		_, err := strconv.ParseInt(parts[0], 10, 64)
		return err == nil && r.Method == http.MethodPut
	}
	return false
}

func isNativeUserRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	if path == "/api/users/actions" {
		return r.Method == http.MethodPost
	}
	if path == "/api/users/usage" {
		return r.Method == http.MethodGet
	}
	if isNativeServiceUsersActionRoute(path, r.Method) {
		return true
	}
	if path == "/api/users" {
		return r.Method == http.MethodGet
	}
	if path == "/api/user" || path == "/api/v2/users" {
		return r.Method == http.MethodPost
	}
	if strings.HasPrefix(path, "/api/v2/users/") {
		rest := strings.TrimPrefix(path, "/api/v2/users/")
		return rest != "" && !strings.Contains(rest, "/") && r.Method == http.MethodPut
	}
	if !strings.HasPrefix(path, "/api/user/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/user/")
	if rest == "" || strings.Contains(rest, "/") {
		parts := strings.Split(rest, "/")
		if len(parts) != 2 || parts[0] == "" {
			return false
		}
		switch parts[1] {
		case "reset", "revoke_sub", "active-next":
			return r.Method == http.MethodPost
		case "usage":
			return r.Method == http.MethodGet
		default:
			return false
		}
	}
	return r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodDelete
}

func isNativeServiceUsersActionRoute(path string, method string) bool {
	if method != http.MethodPost || !strings.HasPrefix(path, "/api/v2/services/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/v2/services/")
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "users" || parts[2] != "actions" {
		return false
	}
	_, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil
}

func isNativeServiceRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	if path == "/api/v2/services" {
		return r.Method == http.MethodGet || r.Method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/api/v2/services/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/v2/services/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		return false
	}
	if _, err := strconv.ParseInt(parts[0], 10, 64); err != nil {
		return false
	}
	if len(parts) == 1 {
		return r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodDelete
	}
	if len(parts) == 2 {
		switch parts[1] {
		case "reset-usage":
			return r.Method == http.MethodPost
		case "users":
			return r.Method == http.MethodGet
		case "auto-inbound":
			return r.Method == http.MethodPost || r.Method == http.MethodDelete
		}
	}
	if len(parts) == 4 && parts[1] == "admins" && parts[2] != "" && parts[3] == "limits" {
		_, err := strconv.ParseInt(parts[2], 10, 64)
		return err == nil && r.Method == http.MethodPut
	}
	if len(parts) == 3 && parts[1] == "usage" {
		switch parts[2] {
		case "timeseries", "admins", "admin-timeseries":
			return r.Method == http.MethodGet
		default:
			return false
		}
	}
	return isNativeServiceUsersActionRoute(path, r.Method)
}

func isDeprecatedMasterNodeRoute(r *http.Request) bool {
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/node/master":
		return r.Method == http.MethodGet || r.Method == http.MethodPut
	case "/api/node/master/usage/reset":
		return r.Method == http.MethodPost
	default:
		return false
	}
}

func isNativeNodeRoute(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/nodes":
		return r.Method == http.MethodGet
	case "/api/nodes/usage":
		return r.Method == http.MethodGet
	case "/api/node":
		return r.Method == http.MethodPost
	case "/api/node/settings":
		return r.Method == http.MethodGet
	case "/api/node/certificate/new":
		return r.Method == http.MethodPost
	}

	if !strings.HasPrefix(path, "/api/node/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/node/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		return false
	}
	if _, err := strconv.ParseInt(parts[0], 10, 64); err != nil {
		return false
	}
	suffix := strings.Join(parts[1:], "/")
	switch suffix {
	case "":
		return r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodDelete
	case "reconnect", "restart", "sync", "xray/update", "geo/update", "service/restart", "service/update":
		return r.Method == http.MethodPost
	case "logs", "usage/daily":
		return r.Method == http.MethodGet
	case "certificate/regenerate", "usage/reset":
		return r.Method == http.MethodPost
	default:
		return false
	}
}

func isNativeNodeWebSocketRoute(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || r.Method != http.MethodGet {
		return false
	}
	path := strings.TrimRight(r.URL.Path, "/")
	if !strings.HasPrefix(path, "/api/node/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/node/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "logs" {
		return false
	}
	_, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil
}

func (s *Server) Run() error {
	var err error
	if s.cfg.TLSCertFile != "" && s.cfg.TLSKeyFile != "" {
		err = s.server.ListenAndServeTLS(s.cfg.TLSCertFile, s.cfg.TLSKeyFile)
	} else {
		err = s.server.ListenAndServe()
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil || s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}
