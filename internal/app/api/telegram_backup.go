package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	backupapp "github.com/rebeccapanel/rebecca/internal/app/backup"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
)

const defaultTelegramBackupCheckInterval = time.Minute

func (s *Server) handleTelegramBackupSend(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/telegram/backup/send" {
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
	var payload struct {
		Scope string `json:"scope"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.telegramBackupDelivery().Send(r.Context(), s.backup(), payload.Scope)
	if err != nil {
		writeTelegramBackupError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) runTelegramBackupScheduler(ctx context.Context) {
	ticker := time.NewTicker(defaultTelegramBackupCheckInterval)
	defer ticker.Stop()

	s.runTelegramBackupOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runTelegramBackupOnce(ctx)
		}
	}
}

func (s *Server) runTelegramBackupOnce(ctx context.Context) {
	if s.telegramRepoEmpty() {
		return
	}
	settings, err := s.telegramRepo.Settings(ctx)
	if err != nil {
		logging.Warnf(logging.ComponentTelegram, "backup settings lookup failed: %v", err)
		return
	}
	if !telegramapp.BackupDue(settings, time.Now().UTC()) {
		return
	}
	if !s.isBinaryRuntime() {
		_ = s.telegramRepo.RecordBackupError(ctx, backupapp.DisabledDetail)
		s.telegramBackupDelivery().SendFailureReport(ctx, settings.BackupScope, errors.New(backupapp.DisabledDetail))
		return
	}
	if _, err := s.telegramBackupDelivery().Send(ctx, s.backup(), settings.BackupScope); err != nil {
		logging.Warnf(logging.ComponentTelegram, "backup delivery failed: %v", err)
		return
	}
	logging.Infof(logging.ComponentTelegram, "backup delivered scope=%s", firstNonEmpty(settings.BackupScope, backupapp.ScopeDatabase))
}

func (s *Server) telegramBackupDelivery() telegramapp.BackupDelivery {
	if s.telegramBackup.IsZero() {
		s.telegramBackup = telegramapp.NewBackupDelivery(s.telegramRepo, s.telegramSender)
	}
	return s.telegramBackup
}

func (s *Server) telegramRepoEmpty() bool {
	return s.telegramRepo == (telegramapp.Repository{})
}

func writeTelegramBackupError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	if errors.Is(err, telegramapp.ErrNotConfigured) || errors.Is(err, telegramapp.ErrNoRecipient) || strings.Contains(strings.ToLower(err.Error()), "proxy") {
		status = http.StatusBadRequest
	}
	var backupErr backupapp.Error
	if errors.As(err, &backupErr) {
		status = http.StatusBadRequest
	}
	writeError(w, status, err.Error())
}
