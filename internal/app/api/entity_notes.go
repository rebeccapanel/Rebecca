package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

const (
	entityNoteTypeAdmin   = "admin"
	entityNoteTypeHost    = "host"
	entityNoteTypeInbound = "inbound"
	entityNoteMaxRunes    = 4000
	entityNoteMaxBody     = 16 << 10
	entityNoteKeyMaxBytes = 255
)

type entityNoteResponse struct {
	Note      string `json:"note"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt int64  `json:"updated_at"`
}

func (s *Server) registerNoteRoutes(r chi.Router) {
	r.HandleFunc("/notes/*", s.requireNoteViewer(s.handleEntityNote))
}

func (s *Server) requireNoteViewer(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
		if principal.Role != string(adminapp.RoleSudo) && principal.Role != string(adminapp.RoleFullAccess) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		if principal.Role == string(adminapp.RoleSudo) && !principal.Context.Admin.Permissions.Sudo.Notes {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		next(w, r)
	})
}

func (s *Server) handleEntityNote(w http.ResponseWriter, r *http.Request) {
	entityType, rawKey, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/api/notes/"), "/")
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	unescaped, err := url.PathUnescape(rawKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note target")
		return
	}
	key, ok := entityNoteKey(entityType, unescaped)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid note target")
		return
	}
	exists, err := s.entityNoteTargetExists(r.Context(), entityType, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read note target")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		note, err := s.loadEntityNote(r.Context(), entityType, key)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read note")
			return
		}
		writeJSON(w, http.StatusOK, note)
	case http.MethodPut:
		s.saveEntityNoteRequest(w, r, entityType, key)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) saveEntityNoteRequest(w http.ResponseWriter, r *http.Request, entityType string, key string) {
	var payload struct {
		Note string `json:"note"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, entityNoteMaxBody)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	note := strings.TrimSpace(payload.Note)
	if utf8.RuneCountInString(note) > entityNoteMaxRunes {
		writeError(w, http.StatusBadRequest, "note is too long")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if note == "" {
		if _, err := s.db.ExecContext(r.Context(), `DELETE FROM entity_notes WHERE entity_type = ? AND entity_key = ?`, entityType, key); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save note")
			return
		}
		writeJSON(w, http.StatusOK, entityNoteResponse{})
		return
	}
	saved := entityNoteResponse{Note: note, UpdatedBy: principal.Username, UpdatedAt: time.Now().UTC().Unix()}
	if err := s.upsertEntityNote(r.Context(), entityType, key, saved); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save note")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func entityNoteKey(entityType string, raw string) (string, bool) {
	key := strings.TrimSpace(raw)
	if key == "" || len(key) > entityNoteKeyMaxBytes {
		return "", false
	}
	switch entityType {
	case entityNoteTypeAdmin, entityNoteTypeHost:
		id, err := strconv.ParseInt(key, 10, 64)
		if err != nil || id <= 0 {
			return "", false
		}
		return strconv.FormatInt(id, 10), true
	case entityNoteTypeInbound:
		return key, true
	default:
		return "", false
	}
}

func (s *Server) entityNoteTargetExists(ctx context.Context, entityType string, key string) (bool, error) {
	var table string
	switch entityType {
	case entityNoteTypeAdmin:
		table = "admins"
	case entityNoteTypeHost:
		table = "hosts"
	default:
		return true, nil
	}
	id, err := strconv.ParseInt(key, 10, 64)
	if err != nil {
		return false, err
	}
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE id = ?", id).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Server) loadEntityNote(ctx context.Context, entityType string, key string) (entityNoteResponse, error) {
	var note entityNoteResponse
	err := s.db.QueryRowContext(ctx, `SELECT note, updated_by, updated_at FROM entity_notes WHERE entity_type = ? AND entity_key = ?`, entityType, key).Scan(&note.Note, &note.UpdatedBy, &note.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return entityNoteResponse{}, nil
	}
	return note, err
}

func (s *Server) upsertEntityNote(ctx context.Context, entityType string, key string, note entityNoteResponse) error {
	if s.dialect == "sqlite" {
		_, err := s.db.ExecContext(ctx, `INSERT INTO entity_notes (entity_type, entity_key, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_type, entity_key) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, entityType, key, note.Note, note.UpdatedBy, note.UpdatedAt)
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO entity_notes (entity_type, entity_key, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`, entityType, key, note.Note, note.UpdatedBy, note.UpdatedAt)
	return err
}
