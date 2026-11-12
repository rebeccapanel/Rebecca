package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/notifications"
)

const (
	notificationEvaluationInterval = 5 * time.Minute
	notificationRetention          = 90 * 24 * time.Hour
)

func (s *Server) registerNotificationRoutes(r chi.Router) {
	r.HandleFunc("/notifications", s.requireAdmin(s.handleNotificationsRoot))
	r.HandleFunc("/notifications/read", s.requireAdmin(s.handleNotificationsRead))
	r.HandleFunc("/notifications/sent", s.requireAdmin(s.handleNotificationsSent))
	r.HandleFunc("/notifications/recipients", s.requireAdmin(s.handleNotificationRecipients))
	r.HandleFunc("/notifications/rules", s.requireAdmin(s.handleNotificationRules))
	r.HandleFunc("/notifications/rules/*", s.requireAdmin(s.handleNotificationRule))
	r.Get("/notifications/push/config", s.requireAdmin(s.handleNotificationPushConfig))
	r.Get("/notifications/push/manifest", s.handleNotificationPushManifest)
	r.Post("/notifications/push/subscribe", s.requireSameOrigin(s.requireAdmin(s.handleNotificationPushSubscribe)))
	r.Post("/notifications/push/unsubscribe", s.requireSameOrigin(s.requireAdmin(s.handleNotificationPushUnsubscribe)))
	r.Post("/notifications/push/status", s.requireSameOrigin(s.requireAdmin(s.handleNotificationPushStatus)))
}

func (s *Server) notificationService() notifications.Service {
	return notifications.NewService(s.db, s.dialect)
}

func notificationPrincipal(r *http.Request) adminPrincipal {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	return principal
}

func canSendNotifications(principal adminPrincipal) bool {
	return principal.Role == string(adminapp.RoleSudo) || principal.Role == string(adminapp.RoleFullAccess)
}

func writeNotificationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, notifications.ErrInvalid):
		writeError(w, http.StatusUnprocessableEntity, strings.TrimPrefix(err.Error(), notifications.ErrInvalid.Error()+": "))
	case errors.Is(err, notifications.ErrUnknownRule):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) handleNotificationsRoot(w http.ResponseWriter, r *http.Request) {
	principal := notificationPrincipal(r)
	switch r.Method {
	case http.MethodGet:
		limit := parseOptionalNonNegativeInt(r.URL.Query().Get("limit"), 20)
		if limit <= 0 || limit > 100 {
			limit = 20
		}
		offset := parseOptionalNonNegativeInt(r.URL.Query().Get("offset"), 0)
		unreadOnly, err := optionalQueryBool(r.URL.Query().Get("unread_only"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid unread_only")
			return
		}
		inbox, err := s.notificationService().Inbox(r.Context(), principal.ID, limit, offset, unreadOnly)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, inbox)
	case http.MethodPost:
		if !canSendNotifications(principal) {
			writeError(w, http.StatusForbidden, "You're not allowed to send notifications.")
			return
		}
		var payload struct {
			Title    string  `json:"title"`
			Body     string  `json:"body"`
			Audience string  `json:"audience"`
			AdminIDs []int64 `json:"admin_ids"`
		}
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		recipients, err := s.notificationRecipientIDs(r.Context(), principal, payload.Audience, payload.AdminIDs)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		id, count, err := s.notificationService().Send(r.Context(), notifications.Sender{ID: principal.ID, Username: principal.Username}, payload.Title, payload.Body, recipients)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "recipients": count})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) notificationRecipientIDs(ctx context.Context, principal adminPrincipal, audience string, selected []int64) ([]int64, error) {
	candidates, err := s.notificationService().Recipients(ctx, false, principal.ID)
	if err != nil {
		return nil, err
	}
	allowed := make(map[int64]bool, len(candidates))
	for _, candidate := range candidates {
		allowed[candidate.ID] = true
	}
	ids := []int64{}
	switch strings.ToLower(strings.TrimSpace(audience)) {
	case "all":
		for _, candidate := range candidates {
			ids = append(ids, candidate.ID)
		}
	case "selected":
		for _, id := range selected {
			if allowed[id] {
				ids = append(ids, id)
			}
		}
	default:
		return nil, fmt.Errorf("%w: audience must be all or selected", notifications.ErrInvalid)
	}
	return ids, nil
}

func (s *Server) handleNotificationsRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal := notificationPrincipal(r)
	var payload struct {
		IDs []int64 `json:"ids"`
		All bool    `json:"all"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.notificationService().MarkRead(r.Context(), principal.ID, payload.IDs, payload.All)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}

func (s *Server) handleNotificationsSent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal := notificationPrincipal(r)
	if !canSendNotifications(principal) {
		writeError(w, http.StatusForbidden, "You're not allowed to send notifications.")
		return
	}
	var senderID *int64
	if !principal.Context.Admin.HasFullAccess() {
		id := principal.ID
		senderID = &id
	}
	items, err := s.notificationService().Sent(r.Context(), senderID, 100)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleNotificationRecipients(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal := notificationPrincipal(r)
	if !canSendNotifications(principal) {
		writeError(w, http.StatusForbidden, "You're not allowed to send notifications.")
		return
	}
	items, err := s.notificationService().Recipients(r.Context(), false, principal.ID)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleNotificationRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !notificationPrincipal(r).Context.Admin.HasFullAccess() {
		writeError(w, http.StatusForbidden, "Only full access admins can manage notification rules.")
		return
	}
	rules, err := s.notificationService().ListRules(r.Context())
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": rules})
}

func (s *Server) handleNotificationRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !notificationPrincipal(r).Context.Admin.HasFullAccess() {
		writeError(w, http.StatusForbidden, "Only full access admins can manage notification rules.")
		return
	}
	key := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/notifications/rules/"), "/")
	var update notifications.RuleUpdate
	if err := decodeOptionalJSON(r, &update); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := s.notificationService().SaveRule(r.Context(), key, update)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) runNotificationWorker(ctx context.Context) {
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.runNotificationCycle(ctx)
		timer.Reset(notificationEvaluationInterval)
	}
}

func (s *Server) runNotificationCycle(ctx context.Context) {
	service := s.notificationService()
	if err := service.Evaluate(ctx); err != nil && ctx.Err() == nil {
		logging.Warnf(logging.ComponentRuntime, "notification evaluation failed: %v", err)
	}
	if err := service.Prune(ctx, time.Now().Add(-notificationRetention)); err != nil && ctx.Err() == nil {
		logging.Warnf(logging.ComponentRuntime, "notification retention failed: %v", err)
	}
}
