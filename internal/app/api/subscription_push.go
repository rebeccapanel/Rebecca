package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/notifications"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

const (
	subscriptionPushEvaluationInterval       = 5 * time.Minute
	subscriptionPushMaxBodyBytes       int64 = 8 << 10

	subPushRateWindow           = 5 * time.Minute
	subPushMaxMutatePerWindow   = 30
	subPushMaxTestPerUserWindow = 3
	subPushMaxTestPerIPWindow   = 10
	subPushRateCapacity         = 4096
)

type subPushRateBucket struct {
	count   int
	resetAt time.Time
}

type subPushRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]subPushRateBucket
	now     func() time.Time
}

func (l *subPushRateLimiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	if l.now != nil {
		now = l.now()
	}
	bucket, ok := l.buckets[key]
	if ok && !now.Before(bucket.resetAt) {
		delete(l.buckets, key)
		ok = false
	}
	if !ok {
		if len(l.buckets) >= subPushRateCapacity {
			for k, item := range l.buckets {
				if !now.Before(item.resetAt) {
					delete(l.buckets, k)
				}
			}
			if len(l.buckets) >= subPushRateCapacity {
				return false
			}
		}
		if l.buckets == nil {
			l.buckets = make(map[string]subPushRateBucket)
		}
		l.buckets[key] = subPushRateBucket{count: 1, resetAt: now.Add(window)}
		return true
	}
	if bucket.count >= limit {
		return false
	}
	bucket.count++
	l.buckets[key] = bucket
	return true
}

func writeSubPushRateLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(int(subPushRateWindow.Seconds())))
	writeError(w, http.StatusTooManyRequests, "too many push requests; try again later")
}

type subscriptionPushRequest struct {
	Endpoint string `json:"endpoint"`
	PageURL  string `json:"page_url"`
	Lang     string `json:"lang"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	Alerts *notifications.UserAlertPrefs `json:"alerts"`
}

func (s *Server) cachedWebPushPublicKey(ctx context.Context) string {
	s.vapidPublicMu.RLock()
	cached := s.vapidPublicKey
	s.vapidPublicMu.RUnlock()
	if cached != "" {
		return cached
	}
	key, err := s.notificationService().PushPublicKey(ctx)
	if err != nil || strings.TrimSpace(key) == "" {
		return ""
	}
	key = strings.TrimSpace(key)
	s.vapidPublicMu.Lock()
	s.vapidPublicKey = key
	s.vapidPublicMu.Unlock()
	return key
}

func (s *Server) rememberSubscriptionPushHost(ctx context.Context, host string) {
	host = strings.TrimSpace(host)
	if host == "" {
		return
	}
	s.pushHostMu.RLock()
	cached := s.cachedPushHost
	s.pushHostMu.RUnlock()
	if cached == host {
		return
	}
	s.notificationService().RememberPushHost(ctx, host)
	s.pushHostMu.Lock()
	s.cachedPushHost = host
	s.pushHostMu.Unlock()
}

func (s *Server) handleSubscriptionPushServiceWorker(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.subPushEnabled.Load() {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Service-Worker-Allowed", "/")
	_, _ = w.Write([]byte(notifications.UserServiceWorkerScript))
}

func (s *Server) handleSubscriptionPush(w http.ResponseWriter, r *http.Request, req userapp.SubscriptionRenderRequest) {
	switch req.PushAction {
	case "sw.js", "manifest.webmanifest", "config":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
	case "status", "subscribe", "unsubscribe", "preferences", "test":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
	default:
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}

	if !s.subPushEnabled.Load() {
		if req.PushAction == "config" {
			writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
			return
		}
		writeError(w, http.StatusForbidden, "subscription web push is disabled")
		return
	}

	user, subSettings, err := s.userService.ResolveSubscriptionUser(r.Context(), req)
	if err != nil {
		writeSubscriptionError(w, err)
		return
	}
	if strings.EqualFold(user.Status, "deleted") {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}

	subBase := strings.TrimSuffix(r.URL.Path, "/push/"+req.PushAction)
	if subBase == "" {
		subBase = "/"
	}

	switch req.PushAction {
	case "sw.js":
		s.handleSubscriptionPushServiceWorker(w, r)
	case "manifest.webmanifest":
		startURL := strings.TrimSpace(r.URL.Query().Get("path"))
		if startURL == "" {
			startURL = subBase
		}
		body, err := notifications.UserManifestJSON(subSettings.SubscriptionProfileTitle, startURL, startURL)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "manifest unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	case "config":
		key := s.cachedWebPushPublicKey(r.Context())
		if key == "" {
			writeError(w, http.StatusServiceUnavailable, "push is unavailable")
			return
		}
		s.rememberSubscriptionPushHost(r.Context(), subscriptionPublicHost(r))
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled":      true,
			"public_key":   key,
			"sw_url":       subBase + "/push/sw.js",
			"manifest_url": subBase + "/push/manifest.webmanifest",
		})
	case "status":
		payload, ok := decodeSubscriptionPushBody(w, r)
		if !ok {
			return
		}
		status, err := s.notificationService().UserPushStatus(r.Context(), user.ID, payload.Endpoint)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not read push status")
			return
		}
		writeJSON(w, http.StatusOK, status)
	case "subscribe":
		if !s.subPushLimiter.allow(fmt.Sprintf("mut:%s:%d", requestPeer(r), user.ID), subPushMaxMutatePerWindow, subPushRateWindow) {
			writeSubPushRateLimited(w)
			return
		}
		payload, ok := decodeSubscriptionPushBody(w, r)
		if !ok {
			return
		}
		pageURL := strings.TrimSpace(payload.PageURL)
		if pageURL == "" {
			pageURL = subBase
		}
		s.rememberSubscriptionPushHost(r.Context(), subscriptionPublicHost(r))
		service := s.notificationService()
		status, err := service.SubscribeUserPush(r.Context(), notifications.UserPushSubscription{
			UserID:    user.ID,
			Endpoint:  strings.TrimSpace(payload.Endpoint),
			P256dh:    strings.TrimSpace(payload.Keys.P256dh),
			Auth:      strings.TrimSpace(payload.Keys.Auth),
			UserAgent: r.Header.Get("User-Agent"),
			PageURL:   pageURL,
			Lang:      payload.Lang,
			Alerts:    payload.Alerts,
		})
		if errors.Is(err, notifications.ErrInvalidSubscription) {
			writeError(w, http.StatusBadRequest, "invalid push subscription")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not save push subscription")
			return
		}
		writeJSON(w, http.StatusOK, status)
	case "preferences":
		if !s.subPushLimiter.allow(fmt.Sprintf("mut:%s:%d", requestPeer(r), user.ID), subPushMaxMutatePerWindow, subPushRateWindow) {
			writeSubPushRateLimited(w)
			return
		}
		payload, ok := decodeSubscriptionPushBody(w, r)
		if !ok {
			return
		}
		status, err := s.notificationService().UpdateUserPushPreferences(r.Context(), user.ID, payload.Endpoint, payload.Lang, payload.Alerts)
		if errors.Is(err, notifications.ErrNotSubscribed) {
			writeError(w, http.StatusNotFound, "push subscription not found")
			return
		}
		if errors.Is(err, notifications.ErrInvalidSubscription) {
			writeError(w, http.StatusBadRequest, "invalid push subscription")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not update push preferences")
			return
		}
		writeJSON(w, http.StatusOK, status)
	case "unsubscribe":
		if !s.subPushLimiter.allow(fmt.Sprintf("mut:%s:%d", requestPeer(r), user.ID), subPushMaxMutatePerWindow, subPushRateWindow) {
			writeSubPushRateLimited(w)
			return
		}
		payload, ok := decodeSubscriptionPushBody(w, r)
		if !ok {
			return
		}
		status, err := s.notificationService().UnsubscribeUserPush(r.Context(), user.ID, payload.Endpoint)
		if errors.Is(err, notifications.ErrInvalidSubscription) {
			writeError(w, http.StatusBadRequest, "invalid push subscription")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not remove push subscription")
			return
		}
		writeJSON(w, http.StatusOK, status)
	case "test":
		peer := requestPeer(r)
		if !s.subPushLimiter.allow(fmt.Sprintf("test:u:%d", user.ID), subPushMaxTestPerUserWindow, subPushRateWindow) ||
			!s.subPushLimiter.allow("test:ip:"+peer, subPushMaxTestPerIPWindow, subPushRateWindow) {
			writeSubPushRateLimited(w)
			return
		}
		payload, ok := decodeSubscriptionPushBody(w, r)
		if !ok {
			return
		}
		s.rememberSubscriptionPushHost(r.Context(), subscriptionPublicHost(r))
		err := s.notificationService().SendUserPushTest(r.Context(), user.ID, payload.Endpoint, subSettings.SubscriptionProfileTitle)
		switch {
		case errors.Is(err, notifications.ErrInvalidSubscription):
			writeError(w, http.StatusBadRequest, "invalid push subscription")
			return
		case errors.Is(err, notifications.ErrNotSubscribed):
			writeError(w, http.StatusNotFound, "push subscription not found")
			return
		case errors.Is(err, notifications.ErrPushGone):
			writeError(w, http.StatusGone, "push subscription expired")
			return
		case errors.Is(err, notifications.ErrPushDeliveryFailed):
			writeError(w, http.StatusBadGateway, "could not deliver test notification")
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, "could not send test notification")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sent": true})
	}
}

func decodeSubscriptionPushBody(w http.ResponseWriter, r *http.Request) (subscriptionPushRequest, bool) {
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, subscriptionPushMaxBodyBytes)
	}
	var payload subscriptionPushRequest
	if err := decodeOptionalJSON(r, &payload); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body is too large")
			return payload, false
		}
		writeError(w, http.StatusBadRequest, "invalid request body")
		return payload, false
	}
	return payload, true
}

func subscriptionPublicHost(r *http.Request) string {
	host := firstForwardedValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	return host
}

func (s *Server) runSubscriptionPushWorker(ctx context.Context) {
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.runSubscriptionPushCycle(ctx)
		timer.Reset(subscriptionPushEvaluationInterval)
	}
}

func (s *Server) runSubscriptionPushCycle(ctx context.Context) {
	if !s.subPushEnabled.Load() {
		return
	}
	if !s.subPushEvalRunning.CompareAndSwap(false, true) {
		return
	}
	defer s.subPushEvalRunning.Store(false)

	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	res, err := s.notificationService().EvaluateUserAlerts(workerCtx)
	if err != nil && ctx.Err() == nil {
		logging.Warnf(logging.ComponentRuntime, "subscription web push evaluation failed: %v", err)
		return
	}
	if res.Queued > 0 || res.Pruned > 0 {
		logging.Debugf(
			logging.ComponentRuntime,
			"subscription web push checked=%d queued=%d delivered=%d pruned=%d",
			res.Checked,
			res.Queued,
			res.Delivered,
			res.Pruned,
		)
	}
}

func (s *Server) runSubscriptionPushForUsers(ctx context.Context, userIDs []int64) {
	if !s.subPushEnabled.Load() || len(userIDs) == 0 {
		return
	}
	workerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	res, err := s.notificationService().EvaluateUserAlertsForUsers(workerCtx, userIDs)
	if err != nil && ctx.Err() == nil {
		logging.Warnf(logging.ComponentRuntime, "subscription web push lifecycle delivery failed: %v", err)
		return
	}
	if res.Queued > 0 || res.Pruned > 0 {
		logging.Debugf(
			logging.ComponentRuntime,
			"subscription web push lifecycle checked=%d queued=%d delivered=%d pruned=%d",
			res.Checked,
			res.Queued,
			res.Delivered,
			res.Pruned,
		)
	}
}
