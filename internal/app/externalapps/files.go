package externalapps

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxExternalAppTextBytes   = 2 << 20
	maxExternalAppConfigBytes = 64 << 10
	maxExternalAppListedFiles = 10_000
)

var (
	errExternalAppInvalidPath   = errors.New("invalid application file path")
	errExternalAppProtectedPath = errors.New("this application path is managed by Rebecca")
	errExternalAppInvalidFile   = errors.New("unsupported application file")
	errExternalAppTextTooLarge  = errors.New("text files are limited to 2 MiB")
	errExternalAppBinaryFile    = errors.New("binary files cannot be opened in the editor")
	errExternalAppInvalidConfig = errors.New("invalid PHP-FPM configuration")
)

type File struct {
	Name        string `json:"name"`
	IsDirectory bool   `json:"isDirectory"`
	Path        string `json:"path"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	Size        int64  `json:"size,omitempty"`
}

type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	UpdatedAt string `json:"updated_at"`
}

type FileRequest struct {
	Path    string   `json:"path"`
	NewPath string   `json:"new_path,omitempty"`
	Paths   []string `json:"paths,omitempty"`
	Content string   `json:"content,omitempty"`
}

func (m *Manager) openFileRoot(domain string) (*os.Root, Record, error) {
	record, ok := m.Lookup(domain)
	if !ok {
		return nil, Record{}, errExternalAppNotFound
	}
	base, err := filepath.EvalSymlinks(m.appsDir())
	if err != nil {
		return nil, Record{}, err
	}
	rootPath, err := filepath.EvalSymlinks(record.Root)
	if err != nil {
		return nil, Record{}, err
	}
	fileAccess := m.fileAccess
	if fileAccess == "" {
		fileAccess = externalAppFileAccessRoot
	}
	boundary, err := filepath.EvalSymlinks(fileAccess)
	if err != nil {
		return nil, Record{}, err
	}
	if !pathWithin(boundary, base) || !pathWithin(base, rootPath) {
		return nil, Record{}, errExternalAppInvalidPath
	}
	if err := rejectExternalAppMounts(rootPath); err != nil {
		return nil, Record{}, err
	}
	root, err := os.OpenRoot(rootPath)
	return root, record, err
}

func rejectExternalAppMounts(root string) error {
	data, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return fmt.Errorf("inspect application mount points: %w", err)
	}
	root = filepath.Clean(root)
	for line := range strings.Lines(string(data)) {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		mountPoint := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`).Replace(fields[4])
		if filepath.Clean(mountPoint) == root || pathWithin(root, mountPoint) {
			return errors.New("application file access is disabled while its directory contains a mount point")
		}
	}
	return nil
}

func normalizeExternalAppPath(raw string, allowRoot bool) (string, error) {
	if strings.ContainsRune(raw, '\x00') || strings.Contains(raw, `\`) || len(raw) > 4096 {
		return "", errExternalAppInvalidPath
	}
	if raw == "" || raw == "/" {
		if allowRoot {
			return ".", nil
		}
		return "", errExternalAppInvalidPath
	}
	if strings.HasPrefix(raw, "//") {
		return "", errExternalAppInvalidPath
	}
	raw = strings.TrimPrefix(raw, "/")
	clean := path.Clean(raw)
	if clean == "." || clean != raw || strings.HasPrefix(clean, "../") {
		return "", errExternalAppInvalidPath
	}
	for _, segment := range strings.Split(clean, "/") {
		if segment == "" || len(segment) > 255 {
			return "", errExternalAppInvalidPath
		}
		if protectedExternalAppSegment(segment) {
			return "", errExternalAppProtectedPath
		}
	}
	return clean, nil
}

func protectedExternalAppSegment(segment string) bool {
	switch segment {
	case ".composer", ".git", ".locks", ".logs", ".sessions", ".tmp", "node_modules", "vendor":
		return true
	default:
		return strings.HasPrefix(segment, ".rebecca-")
	}
}

func (m *Manager) listFiles(domain string) ([]File, error) {
	root, _, err := m.openFileRoot(domain)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	files := make([]File, 0, 128)
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		for _, segment := range strings.Split(name, "/") {
			if protectedExternalAppSegment(segment) {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() && (!info.Mode().IsRegular() || FileHasMultipleLinks(info)) {
			return nil
		}
		if len(files) >= maxExternalAppListedFiles {
			return errors.New("application has too many files to display")
		}
		item := File{
			Name:        entry.Name(),
			IsDirectory: info.IsDir(),
			Path:        "/" + filepath.ToSlash(name),
			UpdatedAt:   info.ModTime().UTC().Format(time.RFC3339),
		}
		if info.Mode().IsRegular() {
			item.Size = info.Size()
		}
		files = append(files, item)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, nil
}

func (m *Manager) readFile(domain, rawPath string) (FileContent, error) {
	name, err := normalizeExternalAppPath(rawPath, false)
	if err != nil {
		return FileContent{}, err
	}
	root, _, err := m.openFileRoot(domain)
	if err != nil {
		return FileContent{}, err
	}
	defer root.Close()
	info, err := root.Lstat(name)
	if err != nil {
		return FileContent{}, err
	}
	if !info.Mode().IsRegular() || FileHasMultipleLinks(info) {
		return FileContent{}, errExternalAppInvalidFile
	}
	file, err := root.Open(name)
	if err != nil {
		return FileContent{}, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || FileHasMultipleLinks(openedInfo) {
		return FileContent{}, errExternalAppInvalidFile
	}
	data, err := io.ReadAll(io.LimitReader(file, maxExternalAppTextBytes+1))
	if err != nil {
		return FileContent{}, err
	}
	if len(data) > maxExternalAppTextBytes {
		return FileContent{}, errExternalAppTextTooLarge
	}
	if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
		return FileContent{}, errExternalAppBinaryFile
	}
	return FileContent{Path: "/" + name, Content: string(data), UpdatedAt: openedInfo.ModTime().UTC().Format(time.RFC3339)}, nil
}

func (m *Manager) saveFile(ctx context.Context, domain, rawPath string, data []byte) error {
	if len(data) > maxExternalAppTextBytes {
		return errExternalAppTextTooLarge
	}
	if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
		return errExternalAppBinaryFile
	}
	name, err := normalizeExternalAppPath(rawPath, false)
	if err != nil {
		return err
	}
	if !m.operationMu.TryLock() {
		return errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	root, record, err := m.openFileRoot(domain)
	if err != nil {
		return err
	}
	defer root.Close()
	return writeExternalAppFile(ctx, root, record, name, data, true)
}

func (m *Manager) createFolder(ctx context.Context, domain, rawPath string) error {
	name, err := normalizeExternalAppPath(rawPath, false)
	if err != nil {
		return err
	}
	if !m.operationMu.TryLock() {
		return errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	root, record, err := m.openFileRoot(domain)
	if err != nil {
		return err
	}
	defer root.Close()
	if err := requireExternalAppDirectory(root, path.Dir(name)); err != nil {
		return err
	}
	if err := root.Mkdir(name, 0o755); err != nil {
		return err
	}
	directory, err := root.Open(name)
	if err != nil {
		return err
	}
	defer directory.Close()
	return chownExternalAppFile(ctx, directory, record)
}

func (m *Manager) uploadFile(ctx context.Context, domain, parent, filename string, data []byte) (File, error) {
	parent, err := normalizeExternalAppPath(parent, true)
	if err != nil {
		return File{}, err
	}
	if filename == "" || filename != path.Base(filename) || strings.Contains(filename, `\`) {
		return File{}, errExternalAppInvalidPath
	}
	name, err := normalizeExternalAppPath(path.Join(parent, filename), false)
	if err != nil {
		return File{}, err
	}
	if len(data) == 0 || len(data) > maxExternalAppArchiveBytes {
		return File{}, errors.New("uploaded files are limited to 32 MiB")
	}
	if !m.operationMu.TryLock() {
		return File{}, errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	root, record, err := m.openFileRoot(domain)
	if err != nil {
		return File{}, err
	}
	defer root.Close()
	if err := writeExternalAppFile(ctx, root, record, name, data, false); err != nil {
		return File{}, err
	}
	info, err := root.Stat(name)
	if err != nil {
		return File{}, err
	}
	return File{Name: path.Base(name), Path: "/" + name, Size: info.Size(), UpdatedAt: info.ModTime().UTC().Format(time.RFC3339)}, nil
}

func writeExternalAppFile(ctx context.Context, root *os.Root, record Record, name string, data []byte, overwrite bool) error {
	if err := requireExternalAppDirectory(root, path.Dir(name)); err != nil {
		return err
	}
	mode := os.FileMode(0o644)
	if info, err := root.Lstat(name); err == nil {
		if !info.Mode().IsRegular() || FileHasMultipleLinks(info) {
			return errExternalAppInvalidFile
		}
		if !overwrite {
			return fs.ErrExist
		}
		mode = info.Mode().Perm()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	suffix, err := randomHex(8)
	if err != nil {
		return err
	}
	tempName := path.Join(path.Dir(name), ".rebecca-write-"+suffix)
	file, err := root.OpenFile(tempName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer root.Remove(tempName)
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	if err == nil {
		err = file.Chmod(mode)
	}
	if err == nil {
		err = chownExternalAppFile(ctx, file, record)
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if overwrite {
		return root.Rename(tempName, name)
	}
	if err := root.Link(tempName, name); err != nil {
		return err
	}
	return root.Remove(tempName)
}

func requireExternalAppDirectory(root *os.Root, name string) error {
	info, err := root.Lstat(name)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errExternalAppInvalidPath
	}
	return nil
}

func chownExternalAppFile(ctx context.Context, file *os.File, record Record) error {
	if record.Runtime != "php" {
		return nil
	}
	uid, gid, err := unixUserIDs(ctx, record.SystemUser)
	if err != nil {
		return err
	}
	return file.Chown(uid, gid)
}

func (m *Manager) moveFile(domain, oldPath, newPath string) error {
	oldName, err := normalizeExternalAppPath(oldPath, false)
	if err != nil {
		return err
	}
	newName, err := normalizeExternalAppPath(newPath, false)
	if err != nil {
		return err
	}
	if oldName == newName {
		return nil
	}
	if strings.HasPrefix(newName, oldName+"/") {
		return errExternalAppInvalidPath
	}
	if !m.operationMu.TryLock() {
		return errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	root, _, err := m.openFileRoot(domain)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat(oldName)
	if err != nil {
		return err
	}
	if !info.IsDir() && (!info.Mode().IsRegular() || FileHasMultipleLinks(info)) {
		return errExternalAppInvalidFile
	}
	if _, err := root.Lstat(newName); err == nil {
		return fs.ErrExist
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := requireExternalAppDirectory(root, path.Dir(newName)); err != nil {
		return err
	}
	return root.Rename(oldName, newName)
}

func (m *Manager) deleteFiles(domain string, rawPaths []string) error {
	if len(rawPaths) == 0 || len(rawPaths) > 100 {
		return errExternalAppInvalidPath
	}
	names := make([]string, 0, len(rawPaths))
	seen := map[string]bool{}
	for _, rawPath := range rawPaths {
		name, err := normalizeExternalAppPath(rawPath, false)
		if err != nil {
			return err
		}
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	sort.Slice(names, func(i, j int) bool { return strings.Count(names[i], "/") > strings.Count(names[j], "/") })
	if !m.operationMu.TryLock() {
		return errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	root, _, err := m.openFileRoot(domain)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, name := range names {
		info, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if !info.IsDir() && (!info.Mode().IsRegular() || FileHasMultipleLinks(info)) {
			return errExternalAppInvalidFile
		}
		if err := root.RemoveAll(name); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) openDownload(domain, rawPath string) (*os.File, os.FileInfo, error) {
	name, err := normalizeExternalAppPath(rawPath, false)
	if err != nil {
		return nil, nil, err
	}
	root, _, err := m.openFileRoot(domain)
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() || FileHasMultipleLinks(info) {
		if err == nil {
			err = errExternalAppInvalidFile
		}
		return nil, nil, err
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || FileHasMultipleLinks(openedInfo) {
		file.Close()
		return nil, nil, errExternalAppInvalidFile
	}
	return file, openedInfo, nil
}

func (m *Manager) readPHPConfig(domain string) (FileContent, error) {
	record, err := m.safePHPConfigRecord(domain)
	if err != nil {
		return FileContent{}, err
	}
	data, err := os.ReadFile(record.PoolConfig)
	if err != nil {
		return FileContent{}, err
	}
	if len(data) > maxExternalAppConfigBytes || !utf8.Valid(data) {
		return FileContent{}, errExternalAppInvalidConfig
	}
	info, err := os.Stat(record.PoolConfig)
	if err != nil {
		return FileContent{}, err
	}
	return FileContent{Path: record.PoolConfig, Content: string(data), UpdatedAt: info.ModTime().UTC().Format(time.RFC3339)}, nil
}

func (m *Manager) savePHPConfig(ctx context.Context, domain, content string) error {
	if len(content) == 0 || len(content) > maxExternalAppConfigBytes || !utf8.ValidString(content) {
		return errExternalAppInvalidConfig
	}
	if !m.operationMu.TryLock() {
		return errExternalAppBusy
	}
	defer m.operationMu.Unlock()
	record, err := m.safePHPConfigRecord(domain)
	if err != nil {
		return err
	}
	if err := validateExternalAppPoolConfig(record, content); err != nil {
		return err
	}
	previous, err := os.ReadFile(record.PoolConfig)
	if err != nil {
		return err
	}
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	if err := writeAtomicFile(record.PoolConfig, []byte(content), 0o600); err != nil {
		return err
	}
	if err := reloadPHPFPM(ctx, record); err == nil {
		return nil
	} else {
		failure := err
		if restoreErr := writeAtomicFile(record.PoolConfig, previous, 0o600); restoreErr != nil {
			return fmt.Errorf("restore PHP-FPM configuration after validation failure: %w", restoreErr)
		}
		if restoreErr := reloadPHPFPM(ctx, record); restoreErr != nil {
			return fmt.Errorf("restore PHP-FPM service after validation failure: %w", restoreErr)
		}
		return fmt.Errorf("%w: %v; previous configuration restored", errExternalAppInvalidConfig, failure)
	}
}

func (m *Manager) safePHPConfigRecord(domain string) (Record, error) {
	record, ok := m.Lookup(domain)
	if !ok {
		return Record{}, errExternalAppNotFound
	}
	if record.Runtime != "php" || record.PHPVersion == "" {
		return Record{}, errExternalAppUnsupported
	}
	expected := filepath.Join("/etc/php", record.PHPVersion, "fpm", "pool.d", "rebecca-"+domainHash(record.Domain)+".conf")
	if filepath.Clean(record.PoolConfig) != expected || record.Service != "php"+record.PHPVersion+"-fpm" {
		return Record{}, errExternalAppInvalidPath
	}
	return record, nil
}

func validateExternalAppPoolConfig(record Record, content string) error {
	expectedSection, expected, err := parseExternalAppPoolConfig(externalAppPoolConfig(record, record.Template == "mirzabot"))
	if err != nil {
		return err
	}
	section, values, err := parseExternalAppPoolConfig(content)
	if err != nil || section != expectedSection || len(values) != len(expected) {
		return errExternalAppInvalidConfig
	}
	editable := map[string]func(string) bool{
		"pm.max_children":                      func(value string) bool { return integerBetween(value, 1, 10) },
		"pm.process_idle_timeout":              func(value string) bool { return durationBetween(value, 5*time.Second, 5*time.Minute) },
		"pm.max_requests":                      func(value string) bool { return integerBetween(value, 50, 5000) },
		"request_terminate_timeout":            func(value string) bool { return durationBetween(value, 10*time.Second, 10*time.Minute) },
		"php_admin_value[upload_max_filesize]": func(value string) bool { return phpSizeBetween(value, 1<<20, 32<<20) },
		"php_admin_value[post_max_size]":       func(value string) bool { return phpSizeBetween(value, 1<<20, 32<<20) },
		"php_admin_value[memory_limit]":        func(value string) bool { return phpSizeBetween(value, 32<<20, 1<<30) },
	}
	for key, expectedValue := range expected {
		value, ok := values[key]
		if !ok {
			return errExternalAppInvalidConfig
		}
		if validate, editableKey := editable[key]; editableKey {
			if !validate(value) {
				return fmt.Errorf("%w: unsafe value for %s", errExternalAppInvalidConfig, key)
			}
		} else if value != expectedValue {
			return fmt.Errorf("%w: %s is managed by Rebecca", errExternalAppInvalidConfig, key)
		}
	}
	if phpSizeBytes(values["php_admin_value[post_max_size]"]) < phpSizeBytes(values["php_admin_value[upload_max_filesize]"]) {
		return fmt.Errorf("%w: post_max_size must not be smaller than upload_max_filesize", errExternalAppInvalidConfig)
	}
	return nil
}

func parseExternalAppPoolConfig(content string) (string, map[string]string, error) {
	section := ""
	values := map[string]string{}
	for line := range strings.Lines(content) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			if section != "" {
				return "", nil, errExternalAppInvalidConfig
			}
			section = line
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !ok || section == "" || key == "" {
			return "", nil, errExternalAppInvalidConfig
		}
		if _, duplicate := values[key]; duplicate {
			return "", nil, fmt.Errorf("%w: duplicate %s", errExternalAppInvalidConfig, key)
		}
		values[key] = value
	}
	if section == "" {
		return "", nil, errExternalAppInvalidConfig
	}
	return section, values, nil
}

func integerBetween(value string, minimum, maximum int) bool {
	number, err := strconv.Atoi(value)
	return err == nil && number >= minimum && number <= maximum
}

func durationBetween(value string, minimum, maximum time.Duration) bool {
	duration, err := time.ParseDuration(value)
	return err == nil && duration >= minimum && duration <= maximum
}

func phpSizeBetween(value string, minimum, maximum int64) bool {
	bytes := phpSizeBytes(value)
	return bytes >= minimum && bytes <= maximum
}

func phpSizeBytes(value string) int64 {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) < 2 {
		return -1
	}
	multiplier := int64(0)
	switch value[len(value)-1] {
	case 'K':
		multiplier = 1 << 10
	case 'M':
		multiplier = 1 << 20
	case 'G':
		multiplier = 1 << 30
	default:
		return -1
	}
	number, err := strconv.ParseInt(value[:len(value)-1], 10, 64)
	if err != nil || number < 0 || number > (1<<30)/multiplier {
		return -1
	}
	return number * multiplier
}

func (m *Manager) handleExternalAppFiles(w http.ResponseWriter, r *http.Request, domain string, action []string) {
	if len(action) == 0 {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		files, err := m.listFiles(domain)
		if err != nil {
			writeExternalAppFileError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"files": files})
		return
	}
	switch action[0] {
	case "content":
		if r.Method == http.MethodGet {
			content, err := m.readFile(domain, r.URL.Query().Get("path"))
			if err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, content)
			return
		}
		if r.Method == http.MethodPut {
			var request FileRequest
			if err := decodeOptionalJSON(r, &request); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := m.saveFile(r.Context(), domain, request.Path, []byte(request.Content)); err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case "folder":
		if r.Method == http.MethodPost {
			var request FileRequest
			if err := decodeOptionalJSON(r, &request); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := m.createFolder(r.Context(), domain, request.Path); err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case "upload":
		if r.Method == http.MethodPost {
			m.handleExternalAppFileUpload(w, r, domain)
			return
		}
	case "move":
		if r.Method == http.MethodPost {
			var request FileRequest
			if err := decodeOptionalJSON(r, &request); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := m.moveFile(domain, request.Path, request.NewPath); err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case "delete":
		if r.Method == http.MethodPost {
			var request FileRequest
			if err := decodeOptionalJSON(r, &request); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := m.deleteFiles(domain, request.Paths); err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case "download":
		if r.Method == http.MethodGet {
			file, info, err := m.openDownload(domain, r.URL.Query().Get("path"))
			if err != nil {
				writeExternalAppFileError(w, err)
				return
			}
			defer file.Close()
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
			http.ServeContent(w, r, info.Name(), info.ModTime(), file)
			return
		}
	}
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func (m *Manager) handleExternalAppFileUpload(w http.ResponseWriter, r *http.Request, domain string) {
	if err := r.ParseMultipartForm(MaxRequestBodyBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart upload")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxExternalAppArchiveBytes+1))
	if err != nil || len(data) > maxExternalAppArchiveBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "uploaded files are limited to 32 MiB")
		return
	}
	item, err := m.uploadFile(r.Context(), domain, r.FormValue("parent"), header.Filename, data)
	if err != nil {
		writeExternalAppFileError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (m *Manager) handleExternalAppConfig(w http.ResponseWriter, r *http.Request, domain string) {
	if r.Method == http.MethodGet {
		content, err := m.readPHPConfig(domain)
		if err != nil {
			writeExternalAppFileError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, content)
		return
	}
	if r.Method == http.MethodPut {
		var request FileRequest
		if err := decodeOptionalJSON(r, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := m.savePHPConfig(r.Context(), domain, request.Content); err != nil {
			writeExternalAppFileError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func writeExternalAppFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errExternalAppNotFound), errors.Is(err, fs.ErrNotExist):
		writeError(w, http.StatusNotFound, "application file not found")
	case errors.Is(err, fs.ErrExist), errors.Is(err, errExternalAppBusy):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errExternalAppInvalidPath), errors.Is(err, errExternalAppProtectedPath),
		errors.Is(err, errExternalAppInvalidFile), errors.Is(err, errExternalAppTextTooLarge),
		errors.Is(err, errExternalAppBinaryFile), errors.Is(err, errExternalAppInvalidConfig),
		errors.Is(err, errExternalAppUnsupported):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "application file operation failed")
	}
}
