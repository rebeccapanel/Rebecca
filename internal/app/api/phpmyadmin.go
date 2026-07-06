package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
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
	Host     string
	Port     string
	Database string
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
	output, err := runRebeccaPHPMyAdminCommand(r.Context(), "enable-phpmyadmin", "--path", path)
	if err != nil {
		writeError(w, http.StatusBadGateway, strings.TrimSpace(output+"\n"+err.Error()))
		return
	}
	publicURL := buildPHPMyAdminPanelURL(r)
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
	theme := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("theme")))
	if err := ensurePHPMyAdminRuntimeConfig(credentials, theme); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	_, _ = w.Write([]byte(buildPHPMyAdminEmbedHTML(phpMyAdminEmbedPath+"index.php", theme)))
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
	if err := s.servePHPMyAdminLocal(w, r, status); err != nil {
		writeError(w, http.StatusBadGateway, "phpMyAdmin proxy failed: "+err.Error())
	}
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
	publicURL := buildPHPMyAdminPanelURL(r)
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

func buildPHPMyAdminPanelURL(r *http.Request) string {
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("%s://%s%s", requestScheme(r), host, phpMyAdminEmbedPath)
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
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		host = "127.0.0.1"
	}
	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		port = "3306"
	}
	database := strings.Trim(strings.TrimPrefix(parsed.Path, "/"), "/")
	if unescaped, err := url.PathUnescape(database); err == nil {
		database = unescaped
	}
	return phpMyAdminCredentials{
		Username: username,
		Password: password,
		Host:     host,
		Port:     port,
		Database: database,
	}, nil
}

func ensurePHPMyAdminRuntimeConfig(credentials phpMyAdminCredentials, theme string) error {
	if err := os.MkdirAll("/etc/phpmyadmin/conf.d", 0o755); err != nil {
		return fmt.Errorf("prepare phpMyAdmin config directory: %w", err)
	}
	theme = strings.ToLower(strings.TrimSpace(theme))
	themeLine := ""
	if theme == "blueberry" {
		themeLine = "$cfg['ThemeDefault'] = 'blueberry';\n"
	}
	onlyDBLine := ""
	if strings.TrimSpace(credentials.Database) != "" {
		onlyDBLine = "$cfg['Servers'][$i]['only_db'] = " + phpString(credentials.Database) + ";\n"
	}
	config := "<?php\n" +
		"declare(strict_types=1);\n" +
		"$i = 1;\n" +
		"$cfg['Servers'] = [];\n" +
		"$cfg['Servers'][$i] = [];\n" +
		"$cfg['Servers'][$i]['auth_type'] = 'config';\n" +
		"$cfg['Servers'][$i]['host'] = " + phpString(credentials.Host) + ";\n" +
		"$cfg['Servers'][$i]['port'] = " + phpString(credentials.Port) + ";\n" +
		"$cfg['Servers'][$i]['connect_type'] = 'tcp';\n" +
		"$cfg['Servers'][$i]['user'] = " + phpString(credentials.Username) + ";\n" +
		"$cfg['Servers'][$i]['password'] = " + phpString(credentials.Password) + ";\n" +
		"$cfg['Servers'][$i]['AllowNoPassword'] = false;\n" +
		onlyDBLine +
		"$cfg['AllowArbitraryServer'] = false;\n" +
		themeLine
	if err := os.WriteFile("/etc/phpmyadmin/conf.d/rebecca.php", []byte(config), 0o644); err != nil {
		return fmt.Errorf("write phpMyAdmin runtime config: %w", err)
	}
	if err := os.Chmod("/etc/phpmyadmin/conf.d/rebecca.php", 0o644); err != nil {
		return fmt.Errorf("set phpMyAdmin runtime config permissions: %w", err)
	}
	return nil
}

func phpString(value string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"'", "\\'",
		"\r", "\\r",
		"\n", "\\n",
	)
	return "'" + replacer.Replace(value) + "'"
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

func buildPHPMyAdminEmbedHTML(loginURL string, theme string) string {
	theme = strings.TrimSpace(theme)
	if theme != "blueberry" {
		theme = ""
	}
	themeCookieScript := ""
	if theme != "" {
		escapedTheme := html.EscapeString(theme)
		themeCookieScript = `document.cookie="pma_theme=` + escapedTheme + `;path=` + phpMyAdminEmbedPath + `;SameSite=Lax";
document.cookie="pma_theme-1=` + escapedTheme + `;path=` + phpMyAdminEmbedPath + `;SameSite=Lax";`
	}
	escapedLoginURL := html.EscapeString(loginURL)
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{height:100%;margin:0;background:#0b0f17;color:#dbeafe;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
iframe{display:block;width:100%;height:100%;border:0;background:#fff}
.loading{position:fixed;inset:0;display:grid;place-items:center;background:#0b0f17;color:#dbeafe;z-index:1}
.panel{max-width:520px;border:1px solid rgba(148,163,184,.22);border-radius:12px;background:rgba(15,23,42,.84);padding:24px;text-align:center;box-shadow:0 20px 48px rgba(0,0,0,.35)}
.muted{color:#94a3b8;margin:.5rem 0 0}
</style>
</head>
<body>
<div class="loading" id="loading"><div class="panel"><strong>Opening phpMyAdmin...</strong><p class="muted">Rebecca is signing in with the configured database account for this full-access session.</p></div></div>
<iframe id="pma-frame" src="` + escapedLoginURL + `" title="phpMyAdmin" onload="rebeccaRevealPHPMyAdmin()"></iframe>
<script>
` + themeCookieScript + `
function rebeccaRevealPHPMyAdmin(){
  document.getElementById('loading').style.display='none';
  var frame=document.getElementById('pma-frame');
  try {
    var doc=frame.contentDocument || frame.contentWindow.document;
    if (!doc) return;
    var blocker=doc.getElementById('cfs-style');
    if (blocker) blocker.remove();
    if (doc.documentElement) {
      doc.documentElement.style.display='block';
      doc.documentElement.style.visibility='visible';
    }
    if (doc.body) doc.body.style.visibility='visible';
  } catch (_) {}
}
var rebeccaPMARevealAttempts=0;
var rebeccaPMARevealTimer=setInterval(function(){
  rebeccaRevealPHPMyAdmin();
  rebeccaPMARevealAttempts++;
  if (rebeccaPMARevealAttempts > 40) clearInterval(rebeccaPMARevealTimer);
}, 250);
</script>
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
