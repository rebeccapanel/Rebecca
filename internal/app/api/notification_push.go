package api

import (
	"net/http"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/notifications"
)

type notificationPushRequest struct {
	Endpoint string `json:"endpoint"`
	PageURL  string `json:"page_url"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func (s *Server) handleNotificationPushServiceWorker(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Service-Worker-Allowed", "/")
	_, _ = w.Write([]byte(notifications.ServiceWorkerScript))
}

func (s *Server) handleNotificationPushManifest(w http.ResponseWriter, r *http.Request) {
	body, err := notifications.ManifestJSON(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "manifest unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(body)
}

func (s *Server) handleNotificationPushConfig(w http.ResponseWriter, r *http.Request) {
	service := s.notificationService()
	key, err := service.PushPublicKey(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "push is unavailable")
		return
	}
	service.RememberPushHost(r.Context(), r.Host)
	writeJSON(w, http.StatusOK, map[string]any{"public_key": key})
}

func (s *Server) handleNotificationPushSubscribe(w http.ResponseWriter, r *http.Request) {
	var req notificationPushRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	principal := notificationPrincipal(r)
	err := s.notificationService().SubscribePush(r.Context(), notifications.PushSubscription{
		AdminID:   principal.ID,
		Endpoint:  req.Endpoint,
		P256dh:    req.Keys.P256dh,
		Auth:      req.Keys.Auth,
		UserAgent: r.Header.Get("User-Agent"),
		PageURL:   req.PageURL,
	})
	if err == notifications.ErrInvalidSubscription {
		writeError(w, http.StatusBadRequest, "invalid push subscription")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscribed": true})
}

func (s *Server) handleNotificationPushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req notificationPushRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	principal := notificationPrincipal(r)
	if err := s.notificationService().UnsubscribePush(r.Context(), principal.ID, strings.TrimSpace(req.Endpoint)); err != nil {
		writeError(w, http.StatusBadRequest, "invalid push subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscribed": false})
}

func (s *Server) handleNotificationPushStatus(w http.ResponseWriter, r *http.Request) {
	var req notificationPushRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	principal := notificationPrincipal(r)
	status, err := s.notificationService().PushStatus(r.Context(), principal.ID, strings.TrimSpace(req.Endpoint))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read the subscription")
		return
	}
	writeJSON(w, http.StatusOK, status)
}
