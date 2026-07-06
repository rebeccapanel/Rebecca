package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const phpMyAdminSQLiteDetail = "phpMyAdmin is available only for MySQL or MariaDB installations."
const phpMyAdminEmbedPath = "/api/settings/phpmyadmin/embed/"
const phpMyAdminEmbedCookie = "rebecca_pma_embed"
const phpMyAdminEmbedTTL = 15 * time.Minute

var phpMyAdminEmbedSecret = newPHPMyAdminEmbedSecret()

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
	if strings.HasPrefix(r.URL.Path, phpMyAdminEmbedPath) {
		s.handlePHPMyAdminProxy(w, r)
		return
	}
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
	expires := time.Now().Add(phpMyAdminEmbedTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     phpMyAdminEmbedCookie,
		Value:    signPHPMyAdminEmbedSession(principal.Username, expires),
		Path:     phpMyAdminEmbedPath,
		Expires:  expires,
		MaxAge:   int(phpMyAdminEmbedTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPSRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(buildPHPMyAdminEmbedHTML(phpMyAdminEmbedPath+"index.php", credentials)))
}

func (s *Server) handlePHPMyAdminProxy(w http.ResponseWriter, r *http.Request) {
	if !s.phpMyAdminProxyAuthorized(r) {
		writeAuthError(w, fmt.Errorf("missing bearer token"))
		return
	}
	status := s.phpMyAdminStatus(r)
	if !status.Enabled {
		writeError(w, http.StatusConflict, "phpMyAdmin is disabled")
		return
	}
	target := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort("127.0.0.1", strconv.Itoa(status.Port)),
	}
	targetPath := phpMyAdminTargetPath(status.Path, r.URL.Path)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = targetPath
		req.URL.RawPath = ""
		req.URL.RawQuery = r.URL.RawQuery
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", r.Host)
		req.Header.Set("X-Forwarded-Proto", requestScheme(r))
		req.Header.Del("Accept-Encoding")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		return rewritePHPMyAdminProxyResponse(resp, status)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		writeError(w, http.StatusBadGateway, "phpMyAdmin proxy failed: "+err.Error())
	}
	proxy.ServeHTTP(w, r)
}

func (s *Server) phpMyAdminProxyAuthorized(r *http.Request) bool {
	if principal, err := s.authenticate(r.Context(), r); err == nil && principal.Role == "full_access" {
		return true
	}
	cookie, err := r.Cookie(phpMyAdminEmbedCookie)
	if err != nil {
		return false
	}
	return verifyPHPMyAdminEmbedSession(cookie.Value, time.Now())
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
	if publicURL == "" || isLoopbackPHPMyAdminURL(publicURL) {
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

func isLoopbackPHPMyAdminURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
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

func buildPHPMyAdminEmbedHTML(loginURL string, credentials phpMyAdminCredentials) string {
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

func newPHPMyAdminEmbedSecret() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err == nil {
		return secret
	}
	return []byte(fmt.Sprintf("rebecca-pma-%d", time.Now().UnixNano()))
}

func signPHPMyAdminEmbedSession(username string, expires time.Time) string {
	payload := fmt.Sprintf("%s|%d", username, expires.Unix())
	mac := hmac.New(sha256.New, phpMyAdminEmbedSecret)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyPHPMyAdminEmbedSession(value string, now time.Time) bool {
	payloadEncoded, sigEncoded, ok := strings.Cut(value, ".")
	if !ok {
		return false
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadEncoded)
	if err != nil {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(sigEncoded)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, phpMyAdminEmbedSecret)
	_, _ = mac.Write(payloadBytes)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return false
	}
	_, expiresRaw, ok := strings.Cut(string(payloadBytes), "|")
	if !ok {
		return false
	}
	expiresUnix, err := strconv.ParseInt(expiresRaw, 10, 64)
	if err != nil {
		return false
	}
	return now.Unix() <= expiresUnix
}

func phpMyAdminTargetPath(configuredPath string, requestPath string) string {
	suffix := strings.TrimPrefix(requestPath, phpMyAdminEmbedPath)
	base := normalizePHPMyAdminPath(configuredPath)
	if suffix == "" {
		return base
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(suffix, "/")
}

func rewritePHPMyAdminProxyResponse(resp *http.Response, status phpMyAdminResponse) error {
	upstreamBase := normalizePHPMyAdminPath(status.Path)
	proxyBase := phpMyAdminEmbedPath
	if location := strings.TrimSpace(resp.Header.Get("Location")); location != "" {
		resp.Header.Set("Location", rewritePHPMyAdminURL(location, status, proxyBase))
	}
	rewritePHPMyAdminCookies(resp.Header, proxyBase)
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "text/html") &&
		!strings.Contains(contentType, "text/css") &&
		!strings.Contains(contentType, "javascript") {
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	body = bytes.ReplaceAll(body, []byte(upstreamBase), []byte(proxyBase))
	body = bytes.ReplaceAll(body, []byte(strings.TrimRight(upstreamBase, "/")), []byte(strings.TrimRight(proxyBase, "/")))
	body = bytes.ReplaceAll(body, []byte("http://127.0.0.1:"+strconv.Itoa(status.Port)+upstreamBase), []byte(proxyBase))
	body = bytes.ReplaceAll(body, []byte("http://localhost:"+strconv.Itoa(status.Port)+upstreamBase), []byte(proxyBase))
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	resp.Header.Set("Cache-Control", "no-store")
	return nil
}

func rewritePHPMyAdminURL(value string, status phpMyAdminResponse, proxyBase string) string {
	configuredPath := normalizePHPMyAdminPath(status.Path)
	if strings.HasPrefix(value, configuredPath) {
		return proxyBase + strings.TrimLeft(strings.TrimPrefix(value, configuredPath), "/")
	}
	parsed, err := url.Parse(value)
	if err == nil && parsed.Hostname() != "" {
		host := parsed.Hostname()
		if (host == "127.0.0.1" || host == "localhost") && parsed.Port() == strconv.Itoa(status.Port) {
			rewritten := proxyBase + strings.TrimLeft(strings.TrimPrefix(parsed.Path, configuredPath), "/")
			if parsed.RawQuery != "" {
				rewritten += "?" + parsed.RawQuery
			}
			return rewritten
		}
	}
	return value
}

func rewritePHPMyAdminCookies(header http.Header, proxyBase string) {
	cookies := header.Values("Set-Cookie")
	if len(cookies) == 0 {
		return
	}
	header.Del("Set-Cookie")
	for _, raw := range cookies {
		parts := strings.Split(raw, ";")
		hasPath := false
		for i, part := range parts {
			trimmed := strings.TrimSpace(part)
			if strings.HasPrefix(strings.ToLower(trimmed), "path=") {
				parts[i] = " Path=" + proxyBase
				hasPath = true
			}
		}
		if !hasPath {
			parts = append(parts, " Path="+proxyBase)
		}
		header.Add("Set-Cookie", strings.Join(parts, ";"))
	}
}

func isHTTPSRequest(r *http.Request) bool {
	return requestScheme(r) == "https"
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if scheme := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))); scheme != "" {
		return scheme
	}
	return "http"
}
