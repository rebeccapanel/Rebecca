package api

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const phpMyAdminSQLiteDetail = "phpMyAdmin is available only for MySQL or MariaDB installations."

type phpMyAdminEnableRequest struct {
	Port int    `json:"port"`
	Path string `json:"path"`
}

type phpMyAdminActionResponse struct {
	OK     bool               `json:"ok"`
	Status phpMyAdminResponse `json:"status"`
	Output string             `json:"output,omitempty"`
}

type phpMyAdminResponse struct {
	Enabled     bool   `json:"enabled"`
	Supported   bool   `json:"supported"`
	Database    string `json:"database"`
	Port        int    `json:"port"`
	Path        string `json:"path"`
	PublicURL   string `json:"public_url"`
	ExternalURL string `json:"external_url"`
	EmbedURL    string `json:"embed_url"`
}

type phpMyAdminCredentials struct {
	Username string
	Password string
}

type jsonRaw = json.RawMessage

func rawJSONBool(value bool) json.RawMessage {
	if value {
		return json.RawMessage(`true`)
	}
	return json.RawMessage(`false`)
}

func rawJSONInt(value int) json.RawMessage {
	return json.RawMessage(strconv.Itoa(value))
}

func rawJSONString(value string) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}

func (s *Server) handlePHPMyAdmin(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/settings/phpmyadmin":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, http.StatusOK, s.phpMyAdminStatus(r))
	case "/api/settings/phpmyadmin/enable":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handlePHPMyAdminEnable(w, r)
	case "/api/settings/phpmyadmin/disable":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handlePHPMyAdminDisable(w, r)
	case "/api/settings/phpmyadmin/embed-html":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handlePHPMyAdminEmbedHTML(w, r)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handlePHPMyAdminEnable(w http.ResponseWriter, r *http.Request) {
	if !s.phpMyAdminSupported() {
		writeError(w, http.StatusConflict, phpMyAdminSQLiteDetail)
		return
	}
	if err := s.requireBinaryInstall(); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	var payload phpMyAdminEnableRequest
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	port := normalizePHPMyAdminPort(payload.Port)
	path := normalizePHPMyAdminPath(payload.Path)
	output, err := runRebeccaPHPMyAdminCommand(r.Context(), "enable-phpmyadmin", "--port", strconv.Itoa(port), "--path", path)
	if err != nil {
		writeError(w, http.StatusBadGateway, strings.TrimSpace(output+"\n"+err.Error()))
		return
	}
	publicURL := buildPHPMyAdminPublicURL(r, port, path)
	if _, err := s.settingsRepo.UpdateRuntimeSettings(r.Context(), map[string]jsonRaw{
		"phpmyadmin_enabled":    rawJSONBool(true),
		"phpmyadmin_port":       rawJSONInt(port),
		"phpmyadmin_path":       rawJSONString(path),
		"phpmyadmin_public_url": rawJSONString(publicURL),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, phpMyAdminActionResponse{OK: true, Status: s.phpMyAdminStatus(r), Output: strings.TrimSpace(output)})
}

func (s *Server) handlePHPMyAdminDisable(w http.ResponseWriter, r *http.Request) {
	if err := s.requireBinaryInstall(); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	output, err := runRebeccaPHPMyAdminCommand(r.Context(), "disable-phpmyadmin")
	if err != nil {
		writeError(w, http.StatusBadGateway, strings.TrimSpace(output+"\n"+err.Error()))
		return
	}
	if _, err := s.settingsRepo.UpdateRuntimeSettings(r.Context(), map[string]jsonRaw{
		"phpmyadmin_enabled": rawJSONBool(false),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, phpMyAdminActionResponse{OK: true, Status: s.phpMyAdminStatus(r), Output: strings.TrimSpace(output)})
}

func (s *Server) handlePHPMyAdminEmbedHTML(w http.ResponseWriter, r *http.Request) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if principal.Role != "full_access" {
		writeError(w, http.StatusForbidden, "Only full access admins can open embedded phpMyAdmin")
		return
	}
	status := s.phpMyAdminStatus(r)
	if !status.Enabled {
		writeError(w, http.StatusConflict, "phpMyAdmin is disabled")
		return
	}
	credentials, err := parsePHPMyAdminCredentials(s.cfg.Database)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(buildPHPMyAdminEmbedHTML(status.ExternalURL, credentials)))
}

func (s *Server) phpMyAdminStatus(r *http.Request) phpMyAdminResponse {
	settings, err := s.settingsRepo.RuntimeSettings(r.Context())
	if err != nil {
		settings.PHPMyAdminPort = 8080
		settings.PHPMyAdminPath = "/phpmyadmin/"
	}
	port := normalizePHPMyAdminPort(settings.PHPMyAdminPort)
	path := normalizePHPMyAdminPath(settings.PHPMyAdminPath)
	publicURL := strings.TrimSpace(settings.PHPMyAdminPublicURL)
	if publicURL == "" {
		publicURL = buildPHPMyAdminPublicURL(r, port, path)
	}
	return phpMyAdminResponse{
		Enabled:     settings.PHPMyAdminEnabled,
		Supported:   s.phpMyAdminSupported(),
		Database:    s.dialect,
		Port:        port,
		Path:        path,
		PublicURL:   publicURL,
		ExternalURL: publicURL,
		EmbedURL:    "/api/settings/phpmyadmin/embed-html",
	}
}

func (s *Server) phpMyAdminSupported() bool {
	return strings.EqualFold(s.dialect, "mysql")
}

func (s *Server) requireBinaryInstall() error {
	info := s.maintenance.Runtime.Info()
	mode := strings.ToLower(strings.TrimSpace(info.Mode))
	if mode == "" {
		mode = strings.ToLower(strings.TrimSpace(info.InstallMode))
	}
	if mode != "binary" {
		return fmt.Errorf("phpMyAdmin management is available only on binary installations")
	}
	return nil
}

func normalizePHPMyAdminPort(port int) int {
	if port < 1 || port > 65535 {
		return 8080
	}
	return port
}

func normalizePHPMyAdminPath(path string) string {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		cleaned = "phpmyadmin"
	}
	cleaned = "/" + strings.Trim(cleaned, "/") + "/"
	if cleaned == "//" {
		return "/phpmyadmin/"
	}
	return cleaned
}

func buildPHPMyAdminPublicURL(r *http.Request, port int, path string) string {
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if hostOnly, _, err := net.SplitHostPort(host); err == nil {
		host = hostOnly
	} else if strings.Count(host, ":") == 1 && !strings.HasPrefix(host, "[") {
		if before, _, ok := strings.Cut(host, ":"); ok {
			host = before
		}
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%d%s", host, normalizePHPMyAdminPort(port), normalizePHPMyAdminPath(path))
}

func parsePHPMyAdminCredentials(databaseURL string) (phpMyAdminCredentials, error) {
	parsed, err := url.Parse(strings.TrimSpace(databaseURL))
	if err != nil {
		return phpMyAdminCredentials{}, err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if !strings.HasPrefix(scheme, "mysql") && !strings.HasPrefix(scheme, "mariadb") {
		return phpMyAdminCredentials{}, fmt.Errorf(phpMyAdminSQLiteDetail)
	}
	username := strings.TrimSpace(parsed.User.Username())
	password, _ := parsed.User.Password()
	if username == "" {
		return phpMyAdminCredentials{}, fmt.Errorf("database username is missing")
	}
	return phpMyAdminCredentials{Username: username, Password: password}, nil
}

func runRebeccaPHPMyAdminCommand(parent context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	defer cancel()
	binary := "rebecca"
	if _, err := os.Stat("/usr/local/bin/rebecca"); err == nil {
		binary = "/usr/local/bin/rebecca"
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return string(output), ctx.Err()
	}
	return string(output), err
}

func buildPHPMyAdminEmbedHTML(externalURL string, credentials phpMyAdminCredentials) string {
	loginURL := strings.TrimRight(externalURL, "/") + "/index.php"
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{height:100%;margin:0;background:#0b0f17;color:#dbeafe;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.wrap{display:grid;min-height:100%;place-items:center;padding:24px;text-align:center}
.panel{max-width:520px;border:1px solid rgba(148,163,184,.22);border-radius:12px;background:rgba(15,23,42,.84);padding:24px;box-shadow:0 20px 48px rgba(0,0,0,.35)}
.muted{color:#94a3b8}
</style>
</head>
<body>
<div class="wrap"><div class="panel"><strong>Opening phpMyAdmin...</strong><p class="muted">Rebecca is signing in with the configured database account for this full-access session.</p></div></div>
<form id="pma-login" method="post" action="` + html.EscapeString(loginURL) + `">
<input type="hidden" name="pma_username" value="` + html.EscapeString(credentials.Username) + `">
<input type="hidden" name="pma_password" value="` + html.EscapeString(credentials.Password) + `">
<input type="hidden" name="server" value="1">
</form>
<script>window.setTimeout(function(){document.getElementById("pma-login").submit();},150);</script>
</body>
</html>`
}
