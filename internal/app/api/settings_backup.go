package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	backupapp "github.com/rebeccapanel/rebecca/internal/app/backup"
	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
)

func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/backup/export" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.isBinaryRuntime() {
		writeError(w, http.StatusConflict, backupapp.DisabledDetail)
		return
	}
	service := s.backup()
	result, err := service.Export(r.Context(), r.URL.Query().Get("scope"))
	if err != nil {
		writeBackupError(w, err)
		return
	}
	defer os.Remove(result.Path)
	w.Header().Set("Content-Type", backupapp.MediaType)
	w.Header().Set("Content-Disposition", `attachment; filename=`+strconv.Quote(safeDownloadFilename(result.Filename)))
	http.ServeFile(w, r, result.Path)
}

func (s *Server) handleBackupImport(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/backup/import" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.isBinaryRuntime() {
		writeError(w, http.StatusConflict, backupapp.DisabledDetail)
		return
	}
	uploadPath, cleanup, err := saveBackupUpload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer cleanup()
	result, err := s.backup().Import(r.Context(), uploadPath, r.URL.Query().Get("scope"))
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) backup() *backupapp.Service {
	if s.backupService != nil {
		return s.backupService
	}
	s.backupService = backupapp.NewService(s.db, s.dialect, s.cfg.Database)
	return s.backupService
}

func (s *Server) isBinaryRuntime() bool {
	var info systemapp.RuntimeInfo
	if s.maintenance != nil && s.maintenance.Runtime != nil {
		info = s.maintenance.Runtime.Info()
	} else {
		info = systemapp.DefaultRuntimeDetector{}.Info()
	}
	return strings.EqualFold(strings.TrimSpace(info.Mode), "binary")
}

func saveBackupUpload(r *http.Request) (string, func(), error) {
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		return "", func() {}, err
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return "", func() {}, err
	}
	defer file.Close()
	suffix := filepath.Ext(header.Filename)
	if suffix == "" {
		suffix = backupapp.Extension
	}
	tempFile, err := os.CreateTemp("", "rebecca-backup-upload-*"+suffix)
	if err != nil {
		return "", func() {}, err
	}
	path := tempFile.Name()
	cleanup := func() { _ = os.Remove(path) }
	if _, err := io.Copy(tempFile, file); err != nil {
		_ = tempFile.Close()
		cleanup()
		return "", func() {}, err
	}
	if err := tempFile.Close(); err != nil {
		cleanup()
		return "", func() {}, err
	}
	return path, cleanup, nil
}

func writeBackupError(w http.ResponseWriter, err error) {
	var backupErr backupapp.Error
	if errors.As(err, &backupErr) {
		writeError(w, http.StatusBadRequest, backupErr.Message)
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func safeDownloadFilename(filename string) string {
	filename = filepath.Base(strings.TrimSpace(filename))
	if filename == "." || filename == string(filepath.Separator) || filename == "" {
		return "rebecca-backup" + backupapp.Extension
	}
	return filename
}
