package api

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/textproto"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const phpMyAdminDocumentRoot = "/usr/share/phpmyadmin"

const (
	fcgiVersion1    = 1
	fcgiBegin       = 1
	fcgiEnd         = 3
	fcgiParams      = 4
	fcgiStdin       = 5
	fcgiStdout      = 6
	fcgiStderr      = 7
	fcgiResponder   = 1
	fcgiRequestID   = 1
	fcgiMaxBodySize = 65535
)

func (s *Server) servePHPMyAdminLocal(w http.ResponseWriter, r *http.Request, status phpMyAdminResponse) error {
	suffix := strings.TrimPrefix(r.URL.Path, phpMyAdminEmbedPath)
	if suffix == "" || strings.HasSuffix(suffix, "/") {
		suffix = strings.TrimRight(suffix, "/") + "/index.php"
	}
	cleanURLPath := path.Clean("/" + suffix)
	rel := strings.TrimPrefix(cleanURLPath, "/")
	fullPath, err := safePHPMyAdminPath(rel)
	if err != nil {
		return err
	}
	if info, err := os.Stat(fullPath); err == nil && info.IsDir() {
		rel = strings.TrimRight(rel, "/") + "/index.php"
		fullPath, err = safePHPMyAdminPath(rel)
		if err != nil {
			return err
		}
	}
	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() && !strings.HasSuffix(strings.ToLower(rel), ".php") {
		servePHPMyAdminStatic(w, r, fullPath, info)
		return nil
	}
	if !strings.HasSuffix(strings.ToLower(rel), ".php") {
		rel = "index.php"
		fullPath, err = safePHPMyAdminPath(rel)
		if err != nil {
			return err
		}
	}
	return s.servePHPMyAdminPHP(w, r, status, rel, fullPath)
}

func servePHPMyAdminStatic(w http.ResponseWriter, r *http.Request, fullPath string, info os.FileInfo) {
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(fullPath))); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "public, max-age=604800")
	file, err := os.Open(fullPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer file.Close()
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *Server) servePHPMyAdminPHP(w http.ResponseWriter, r *http.Request, status phpMyAdminResponse, scriptRel string, scriptPath string) error {
	credentials, err := parsePHPMyAdminCredentials(s.cfg.Database)
	if err != nil {
		return err
	}
	theme := ""
	if cookie, err := r.Cookie("pma_theme"); err == nil {
		theme = cookie.Value
	}
	if err := ensurePHPMyAdminRuntimeConfig(credentials, theme); err != nil {
		return err
	}
	network, address, err := findPHPFPMSocket()
	if err != nil {
		return err
	}
	params := phpMyAdminFastCGIParams(r, scriptRel, scriptPath)
	stdout, stderr, err := fastCGIRequest(network, address, params, r.Body)
	if err != nil {
		return err
	}
	if len(stderr) > 0 && len(stdout) == 0 {
		return errors.New(strings.TrimSpace(string(stderr)))
	}
	return writePHPMyAdminFastCGIResponse(w, stdout, status)
}

func safePHPMyAdminPath(rel string) (string, error) {
	root, err := filepath.Abs(phpMyAdminDocumentRoot)
	if err != nil {
		return "", err
	}
	candidate, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "", err
	}
	if candidate != root && !strings.HasPrefix(candidate, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid phpMyAdmin path")
	}
	return candidate, nil
}

func findPHPFPMSocket() (string, string, error) {
	sockets, _ := filepath.Glob("/run/php/php*-fpm.sock")
	sort.Strings(sockets)
	for i := len(sockets) - 1; i >= 0; i-- {
		if _, err := os.Stat(sockets[i]); err == nil {
			return "unix", sockets[i], nil
		}
	}
	if conn, err := net.Dial("tcp", "127.0.0.1:9000"); err == nil {
		_ = conn.Close()
		return "tcp", "127.0.0.1:9000", nil
	}
	return "", "", fmt.Errorf("could not find php-fpm socket under /run/php")
}

func phpMyAdminFastCGIParams(r *http.Request, scriptRel string, scriptPath string) map[string]string {
	serverName := r.Host
	serverPort := "80"
	if host, port, err := net.SplitHostPort(r.Host); err == nil {
		serverName = host
		serverPort = port
	} else if requestScheme(r) == "https" {
		serverPort = "443"
	}
	params := map[string]string{
		"GATEWAY_INTERFACE": "CGI/1.1",
		"SERVER_SOFTWARE":   "Rebecca",
		"REQUEST_METHOD":    r.Method,
		"QUERY_STRING":      r.URL.RawQuery,
		"REQUEST_URI":       r.URL.RequestURI(),
		"SCRIPT_FILENAME":   scriptPath,
		"SCRIPT_NAME":       phpMyAdminEmbedPath + strings.TrimLeft(scriptRel, "/"),
		"PHP_SELF":          phpMyAdminEmbedPath + strings.TrimLeft(scriptRel, "/"),
		"DOCUMENT_ROOT":     phpMyAdminDocumentRoot,
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
		if cgiName == "HTTP_CONTENT_TYPE" || cgiName == "HTTP_CONTENT_LENGTH" || cgiName == "HTTP_AUTHORIZATION" {
			continue
		}
		params[cgiName] = strings.Join(values, ", ")
	}
	return params
}

func remoteHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return remoteAddr
}

func fastCGIRequest(network string, address string, params map[string]string, body io.Reader) ([]byte, []byte, error) {
	conn, err := net.Dial(network, address)
	if err != nil {
		return nil, nil, err
	}
	defer conn.Close()
	beginBody := make([]byte, 8)
	binary.BigEndian.PutUint16(beginBody[0:2], fcgiResponder)
	if err := writeFastCGIRecord(conn, fcgiBegin, beginBody); err != nil {
		return nil, nil, err
	}
	if err := writeFastCGIParams(conn, params); err != nil {
		return nil, nil, err
	}
	if err := writeFastCGIStdin(conn, body); err != nil {
		return nil, nil, err
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	for {
		recordType, content, err := readFastCGIRecord(conn)
		if err != nil {
			return nil, nil, err
		}
		switch recordType {
		case fcgiStdout:
			stdout.Write(content)
		case fcgiStderr:
			stderr.Write(content)
		case fcgiEnd:
			return stdout.Bytes(), stderr.Bytes(), nil
		}
	}
}

func writeFastCGIParams(w io.Writer, params map[string]string) error {
	var encoded bytes.Buffer
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		writeFastCGILength(&encoded, len(key))
		writeFastCGILength(&encoded, len(params[key]))
		encoded.WriteString(key)
		encoded.WriteString(params[key])
	}
	if err := writeFastCGIRecord(w, fcgiParams, encoded.Bytes()); err != nil {
		return err
	}
	return writeFastCGIRecord(w, fcgiParams, nil)
}

func writeFastCGIStdin(w io.Writer, body io.Reader) error {
	if body != nil {
		buf := make([]byte, fcgiMaxBodySize)
		for {
			n, readErr := body.Read(buf)
			if n > 0 {
				if err := writeFastCGIRecord(w, fcgiStdin, buf[:n]); err != nil {
					return err
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				return readErr
			}
		}
	}
	return writeFastCGIRecord(w, fcgiStdin, nil)
}

func writeFastCGILength(w io.Writer, length int) {
	if length < 128 {
		_, _ = w.Write([]byte{byte(length)})
		return
	}
	var buf [4]byte
	binary.BigEndian.PutUint32(buf[:], uint32(length)|0x80000000)
	_, _ = w.Write(buf[:])
}

func writeFastCGIRecord(w io.Writer, recordType uint8, content []byte) error {
	for {
		chunk := content
		if len(chunk) > fcgiMaxBodySize {
			chunk = content[:fcgiMaxBodySize]
		}
		padding := byte((8 - (len(chunk) % 8)) % 8)
		header := []byte{
			fcgiVersion1,
			recordType,
			0, fcgiRequestID,
			0, 0,
			padding,
			0,
		}
		binary.BigEndian.PutUint16(header[4:6], uint16(len(chunk)))
		if _, err := w.Write(header); err != nil {
			return err
		}
		if len(chunk) > 0 {
			if _, err := w.Write(chunk); err != nil {
				return err
			}
		}
		if padding > 0 {
			if _, err := w.Write(make([]byte, padding)); err != nil {
				return err
			}
		}
		if len(content) <= fcgiMaxBodySize {
			return nil
		}
		content = content[fcgiMaxBodySize:]
	}
}

func readFastCGIRecord(r io.Reader) (uint8, []byte, error) {
	header := make([]byte, 8)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, nil, err
	}
	contentLength := int(binary.BigEndian.Uint16(header[4:6]))
	paddingLength := int(header[6])
	content := make([]byte, contentLength)
	if contentLength > 0 {
		if _, err := io.ReadFull(r, content); err != nil {
			return 0, nil, err
		}
	}
	if paddingLength > 0 {
		if _, err := io.CopyN(io.Discard, r, int64(paddingLength)); err != nil {
			return 0, nil, err
		}
	}
	return header[1], content, nil
}

func writePHPMyAdminFastCGIResponse(w http.ResponseWriter, stdout []byte, status phpMyAdminResponse) error {
	headers, body, err := splitFastCGIHeaders(stdout)
	if err != nil {
		return err
	}
	statusCode := http.StatusOK
	for key, values := range headers {
		if strings.EqualFold(key, "Status") && len(values) > 0 {
			if code, err := strconv.Atoi(strings.Fields(values[0])[0]); err == nil {
				statusCode = code
			}
			continue
		}
		if shouldSkipPHPMyAdminEmbedHeader(key) {
			continue
		}
		for _, value := range values {
			if strings.EqualFold(key, "Location") {
				value = rewritePHPMyAdminURL(value, status, phpMyAdminEmbedPath)
			}
			w.Header().Add(key, value)
		}
	}
	rewritePHPMyAdminCookies(w.Header(), phpMyAdminEmbedPath)
	body = rewritePHPMyAdminBody(body, status, phpMyAdminEmbedPath)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(statusCode)
	_, err = w.Write(body)
	return err
}

func shouldSkipPHPMyAdminEmbedHeader(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "content-length", "x-frame-options", "content-security-policy", "x-content-security-policy", "x-webkit-csp":
		return true
	default:
		return false
	}
}

func splitFastCGIHeaders(stdout []byte) (textproto.MIMEHeader, []byte, error) {
	separator := []byte("\r\n\r\n")
	idx := bytes.Index(stdout, separator)
	if idx < 0 {
		separator = []byte("\n\n")
		idx = bytes.Index(stdout, separator)
	}
	if idx < 0 {
		return nil, nil, fmt.Errorf("invalid php-fpm response")
	}
	headerBytes := bytes.ReplaceAll(stdout[:idx], []byte("\r\n"), []byte("\n"))
	headerBytes = append(headerBytes, '\n', '\n')
	reader := textproto.NewReader(bufio.NewReader(bytes.NewReader(headerBytes)))
	headers, err := reader.ReadMIMEHeader()
	if err != nil {
		return nil, nil, err
	}
	return headers, stdout[idx+len(separator):], nil
}

func rewritePHPMyAdminBody(body []byte, status phpMyAdminResponse, proxyBase string) []byte {
	upstreamBase := normalizePHPMyAdminPath(status.Path)
	upstreamBaseNoSlash := strings.TrimRight(upstreamBase, "/")
	proxyBaseNoSlash := strings.TrimRight(proxyBase, "/")
	const proxyBasePlaceholder = "__REBECCA_PMA_PROXY_BASE__"
	const proxyBaseNoSlashPlaceholder = "__REBECCA_PMA_PROXY_BASE_NO_SLASH__"
	body = stripHTMLBlockContaining(body, "<script", "</script>", "cross_framing_protection.js")
	body = stripHTMLBlockContaining(body, "<style", "</style>", "cfs-style")
	body = bytes.ReplaceAll(body, []byte("http://127.0.0.1:"+strconv.Itoa(status.Port)+upstreamBase), []byte(proxyBasePlaceholder))
	body = bytes.ReplaceAll(body, []byte("http://localhost:"+strconv.Itoa(status.Port)+upstreamBase), []byte(proxyBasePlaceholder))
	body = bytes.ReplaceAll(body, []byte("http://127.0.0.1:"+strconv.Itoa(status.Port)+upstreamBaseNoSlash), []byte(proxyBaseNoSlashPlaceholder))
	body = bytes.ReplaceAll(body, []byte("http://localhost:"+strconv.Itoa(status.Port)+upstreamBaseNoSlash), []byte(proxyBaseNoSlashPlaceholder))
	body = bytes.ReplaceAll(body, []byte(upstreamBase), []byte(proxyBasePlaceholder))
	body = bytes.ReplaceAll(body, []byte(upstreamBaseNoSlash), []byte(proxyBaseNoSlashPlaceholder))
	body = bytes.ReplaceAll(body, []byte(proxyBasePlaceholder), []byte(proxyBase))
	body = bytes.ReplaceAll(body, []byte(proxyBaseNoSlashPlaceholder), []byte(proxyBaseNoSlash))
	return body
}

func stripHTMLBlockContaining(body []byte, openTag string, closeTag string, marker string) []byte {
	openNeedle := []byte(strings.ToLower(openTag))
	closeNeedle := []byte(strings.ToLower(closeTag))
	markerNeedle := []byte(strings.ToLower(marker))
	for {
		lower := bytes.ToLower(body)
		markerIndex := bytes.Index(lower, markerNeedle)
		if markerIndex < 0 {
			return body
		}
		start := bytes.LastIndex(lower[:markerIndex], openNeedle)
		if start < 0 {
			return body
		}
		endRelative := bytes.Index(lower[markerIndex:], closeNeedle)
		if endRelative < 0 {
			return body
		}
		end := markerIndex + endRelative + len(closeNeedle)
		body = append(body[:start], body[end:]...)
	}
}
