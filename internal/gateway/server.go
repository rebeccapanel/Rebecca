package gateway

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	cfg     Config
	server  *http.Server
	servers []*http.Server
}

func NewServer(cfg Config) (*Server, error) {
	if (strings.TrimSpace(cfg.TLSCertFile) == "") != (strings.TrimSpace(cfg.TLSKeyFile) == "") {
		return nil, fmt.Errorf("incomplete TLS configuration: set both UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE, or leave both empty for plain HTTP")
	}

	dashboard := newDashboardFiles(cfg)
	apiHandler := cfg.APIHandler

	mux := http.NewServeMux()
	mux.HandleFunc("/__rebecca_go/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/__rebecca_go/api_healthz", func(w http.ResponseWriter, r *http.Request) {
		if apiHandler == nil {
			http.Error(w, "Go API handler is unavailable", http.StatusServiceUnavailable)
			return
		}
		apiHandler.ServeHTTP(w, apiHealthRequest(r))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if dashboard.matches(r) {
			dashboard.serve(w, r)
			return
		}
		if isDeprecatedRuntimeRoute(r) {
			http.Error(w, deprecatedRuntimeRouteDetail(r), http.StatusGone)
			return
		}
		if isDeprecatedMasterNodeRoute(r) {
			http.Error(w, "master node usage/runtime routes have been removed", http.StatusGone)
			return
		}
		if apiHandler == nil {
			http.Error(w, "Go API handler is unavailable", http.StatusServiceUnavailable)
			return
		}
		apiHandler.ServeHTTP(w, r)
	})

	servers := make([]*http.Server, 0, 1+len(cfg.ExtraListenPorts))
	mainServer := newHTTPServer(cfg.Addr, mux)
	servers = append(servers, mainServer)
	for _, addr := range extraListenAddrs(cfg.Addr, cfg.ExtraListenPorts) {
		servers = append(servers, newHTTPServer(addr, mux))
	}

	return &Server{cfg: cfg, server: mainServer, servers: servers}, nil
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
	}
}

func apiHealthRequest(r *http.Request) *http.Request {
	req := r.Clone(r.Context())
	req.Method = http.MethodGet
	req.URL.Path = "/__rebecca_api/healthz"
	req.URL.RawPath = ""
	req.URL.RawQuery = ""
	return req
}

func isDeprecatedRuntimeRoute(r *http.Request) bool {
	path := strings.TrimRight(r.URL.Path, "/")
	return path == "/api/core/xray/update"
}

func deprecatedRuntimeRouteDetail(r *http.Request) string {
	path := strings.TrimRight(r.URL.Path, "/")
	if path == "/api/core/xray/update" {
		return "Master runtime is node-only; update nodes instead."
	}
	return "Master runtime is node-only; update nodes instead."
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

func (s *Server) Run() error {
	if len(s.servers) == 0 && s.server != nil {
		s.servers = []*http.Server{s.server}
	}
	errCh := make(chan error, len(s.servers))
	for _, server := range s.servers {
		server := server
		go func() {
			var err error
			if s.cfg.TLSCertFile != "" && s.cfg.TLSKeyFile != "" {
				err = server.ListenAndServeTLS(s.cfg.TLSCertFile, s.cfg.TLSKeyFile)
			} else {
				err = server.ListenAndServe()
			}
			errCh <- err
		}()
	}
	err := <-errCh
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if len(s.servers) == 0 && s.server != nil {
		s.servers = []*http.Server{s.server}
	}
	var wg sync.WaitGroup
	errCh := make(chan error, len(s.servers))
	for _, server := range s.servers {
		if server == nil {
			continue
		}
		wg.Add(1)
		go func(server *http.Server) {
			defer wg.Done()
			if err := server.Shutdown(ctx); err != nil {
				errCh <- err
			}
		}(server)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			return err
		}
	}
	return nil
}

func extraListenAddrs(primary string, ports []int) []string {
	host, primaryPort := splitListenAddr(primary)
	seen := map[string]bool{primary: true}
	if primaryPort != "" {
		seen[net.JoinHostPort(host, primaryPort)] = true
		if host == "" {
			seen[":"+primaryPort] = true
		}
	}
	out := []string{}
	for _, port := range ports {
		if port <= 0 || port > 65535 {
			continue
		}
		portText := strconv.Itoa(port)
		if portText == primaryPort {
			continue
		}
		addr := net.JoinHostPort(host, portText)
		if host == "" {
			addr = ":" + portText
		}
		if seen[addr] {
			continue
		}
		seen[addr] = true
		out = append(out, addr)
	}
	return out
}

func splitListenAddr(addr string) (string, string) {
	host, port, err := net.SplitHostPort(addr)
	if err == nil {
		return host, port
	}
	if strings.HasPrefix(addr, ":") && len(addr) > 1 {
		return "", strings.TrimPrefix(addr, ":")
	}
	return "", ""
}
