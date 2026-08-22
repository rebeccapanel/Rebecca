package api

import (
	"errors"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	externalapps "github.com/rebeccapanel/rebecca/internal/app/externalapps"
)

const maxExternalAppResponseBytes = 64 << 20

type externalAppAwareHandler struct {
	apps *externalapps.Manager
	next http.Handler
}

func (h *externalAppAwareHandler) HandlesHost(host string) bool {
	if h == nil || h.apps == nil {
		return false
	}
	_, ok := h.apps.Lookup(host)
	return ok
}

func (h *externalAppAwareHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.apps == nil {
		h.next.ServeHTTP(w, r)
		return
	}
	record, ok := h.apps.Lookup(r.Host)
	if !ok {
		h.next.ServeHTTP(w, r)
		return
	}
	setExternalAppSecurityHeaders(w.Header())
	if !record.Enabled {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "Application is disabled", http.StatusServiceUnavailable)
		return
	}
	if r.ContentLength > externalapps.MaxRequestBodyBytes {
		http.Error(w, "Request body is too large", http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, externalapps.MaxRequestBodyBytes)
	if err := serveExternalApp(h.apps, w, r, record); err != nil {
		http.Error(w, "Application is unavailable", http.StatusBadGateway)
	}
}

func serveExternalApp(manager *externalapps.Manager, w http.ResponseWriter, r *http.Request, record externalapps.Record) error {
	rel, fullPath, info, err := resolveExternalAppPath(record, r.URL.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
			return nil
		}
		return err
	}
	if info.IsDir() {
		http.NotFound(w, r)
		return nil
	}
	if strings.EqualFold(filepath.Ext(rel), ".php") {
		if record.Runtime != "php" || !phpScriptAllowed(record, rel) {
			http.NotFound(w, r)
			return nil
		}
		if record.Template == "mirzabot" {
			if err := manager.AuthorizeMirzaRequest(r, record, rel); err != nil {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return nil
			}
		}
		return serveExternalAppFastCGI(w, r, record, rel, fullPath)
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return nil
	}
	serveExternalAppStatic(w, r, record, rel)
	return nil
}

func resolveExternalAppPath(record externalapps.Record, requestPath string) (string, string, os.FileInfo, error) {
	if strings.ContainsRune(requestPath, '\x00') || strings.Contains(requestPath, "\\") {
		return "", "", nil, os.ErrNotExist
	}
	cleanPath := path.Clean("/" + requestPath)
	rel := strings.TrimPrefix(cleanPath, "/")
	if rel == "." {
		rel = ""
	}
	if externalAppPathDenied(rel) {
		return "", "", nil, os.ErrNotExist
	}
	root, err := os.OpenRoot(record.Root)
	if err != nil {
		return "", "", nil, err
	}
	defer root.Close()
	rootPath := filepath.FromSlash(rel)
	if rootPath == "" {
		rootPath = "."
	}
	info, err := root.Stat(rootPath)
	if err == nil && info.IsDir() {
		for _, index := range []string{"index.php", "index.html"} {
			candidate := filepath.Join(rootPath, index)
			candidateInfo, candidateErr := root.Stat(candidate)
			if candidateErr == nil && !candidateInfo.IsDir() {
				rel = path.Join(rel, index)
				info = candidateInfo
				break
			}
		}
	}
	if err != nil {
		return "", "", nil, os.ErrNotExist
	}
	if externalAppPathDenied(rel) {
		return "", "", nil, os.ErrNotExist
	}
	return filepath.ToSlash(rel), filepath.Join(record.Root, filepath.FromSlash(rel)), info, nil
}

func externalAppPathDenied(rel string) bool {
	if rel == "" {
		return false
	}
	parts := strings.Split(strings.ToLower(filepath.ToSlash(rel)), "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".") {
			return true
		}
	}
	switch parts[0] {
	case "vendor":
		return true
	}
	switch strings.ToLower(path.Base(rel)) {
	case "config.php", "table.php", "composer.json", "composer.lock", "install.sh":
		return true
	default:
		return false
	}
}

func phpScriptAllowed(record externalapps.Record, rel string) bool {
	if record.Template != "mirzabot" {
		return true
	}
	rel = strings.ToLower(filepath.ToSlash(rel))
	if rel == "index.php" {
		return true
	}
	for _, prefix := range []string{"api/", "app/", "cronbot/", "panel/", "payment/", "sub/", "vpnbot/"} {
		if strings.HasPrefix(rel, prefix) {
			return true
		}
	}
	return false
}

func serveExternalAppStatic(w http.ResponseWriter, r *http.Request, record externalapps.Record, rel string) {
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(rel))); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if strings.EqualFold(filepath.Ext(rel), ".html") {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	file, err := os.OpenInRoot(record.Root, filepath.FromSlash(rel))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func serveExternalAppFastCGI(w http.ResponseWriter, r *http.Request, record externalapps.Record, scriptRel, scriptPath string) error {
	params := externalAppFastCGIParams(r, record, scriptRel, scriptPath)
	stdout, stderr, err := fastCGIRequestLimited("unix", record.Socket, params, r.Body, maxExternalAppResponseBytes)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			http.Error(w, "Request body is too large", http.StatusRequestEntityTooLarge)
			return nil
		}
		return err
	}
	if len(stderr) > 0 && len(stdout) == 0 {
		return errors.New("PHP-FPM returned an error")
	}
	return writeExternalAppFastCGIResponse(w, stdout)
}

func externalAppFastCGIParams(r *http.Request, record externalapps.Record, scriptRel, scriptPath string) map[string]string {
	serverName := externalapps.CanonicalHost(r.Host)
	serverPort := "80"
	if _, port, err := net.SplitHostPort(r.Host); err == nil {
		serverPort = port
	} else if requestScheme(r) == "https" {
		serverPort = "443"
	}
	scriptName := "/" + strings.TrimLeft(filepath.ToSlash(scriptRel), "/")
	params := map[string]string{
		"GATEWAY_INTERFACE": "CGI/1.1",
		"SERVER_SOFTWARE":   "Rebecca",
		"REQUEST_METHOD":    r.Method,
		"QUERY_STRING":      r.URL.RawQuery,
		"REQUEST_URI":       r.URL.RequestURI(),
		"SCRIPT_FILENAME":   scriptPath,
		"SCRIPT_NAME":       scriptName,
		"PHP_SELF":          scriptName,
		"DOCUMENT_ROOT":     record.Root,
		"REDIRECT_STATUS":   "200",
		"SERVER_NAME":       serverName,
		"SERVER_PORT":       serverPort,
		"SERVER_PROTOCOL":   r.Proto,
		"REMOTE_ADDR":       remoteHost(r.RemoteAddr),
		"HTTPS":             "off",
	}
	if requestScheme(r) == "https" {
		params["HTTPS"] = "on"
	}
	if r.ContentLength > 0 {
		params["CONTENT_LENGTH"] = strconv.FormatInt(r.ContentLength, 10)
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		params["CONTENT_TYPE"] = contentType
	}
	for key, values := range r.Header {
		if len(values) == 0 {
			continue
		}
		cgiName := "HTTP_" + strings.ToUpper(strings.ReplaceAll(key, "-", "_"))
		switch cgiName {
		case "HTTP_CONTENT_TYPE", "HTTP_CONTENT_LENGTH", "HTTP_CONNECTION", "HTTP_PROXY":
			continue
		}
		params[cgiName] = strings.Join(values, ", ")
	}
	return params
}

func writeExternalAppFastCGIResponse(w http.ResponseWriter, stdout []byte) error {
	headers, body, err := splitFastCGIHeaders(stdout)
	if err != nil {
		return err
	}
	statusCode := http.StatusOK
	statusSet := false
	hasLocation := false
	for key, values := range headers {
		if strings.EqualFold(key, "Status") && len(values) > 0 {
			if fields := strings.Fields(values[0]); len(fields) > 0 {
				if code, err := strconv.Atoi(fields[0]); err == nil && code >= 100 && code <= 999 {
					statusCode = code
					statusSet = true
				}
			}
			continue
		}
		if externalAppHopByHopHeader(key) || strings.EqualFold(key, "X-Powered-By") || strings.EqualFold(key, "Content-Length") {
			continue
		}
		if strings.EqualFold(key, "Location") {
			hasLocation = true
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if hasLocation && !statusSet {
		statusCode = http.StatusFound
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(statusCode)
	_, err = w.Write(body)
	return err
}

func externalAppHopByHopHeader(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func setExternalAppSecurityHeaders(header http.Header) {
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "same-origin")
	header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	header.Set("X-Frame-Options", "SAMEORIGIN")
}
