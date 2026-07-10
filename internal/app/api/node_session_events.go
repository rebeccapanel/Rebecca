package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

type nodeSessionEventPayload struct {
	Token      string `json:"token,omitempty"`
	NodeID     int64  `json:"node_id"`
	UserID     int64  `json:"user_id"`
	Protocol   string `json:"protocol"`
	InboundTag string `json:"inbound_tag,omitempty"`
	SessionID  string `json:"session_id"`
	AssignedIP string `json:"assigned_ip,omitempty"`
	ClientIP   string `json:"client_ip,omitempty"`
	Event      string `json:"event"`
}

func (s *Server) handleNodeSessionEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload nodeSessionEventPayload
	if err := decodeOptionalJSON(r, &payload); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}
	if token := bearerToken(r); token != "" {
		payload.Token = token
	}
	if err := s.validateNodeSessionEvent(r.Context(), payload); err != nil {
		writeStatusError(w, err)
		return
	}
	if err := s.applyNodeSessionEvent(r.Context(), payload); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) validateNodeSessionEvent(ctx context.Context, payload nodeSessionEventPayload) error {
	if payload.NodeID <= 0 || payload.UserID <= 0 || strings.TrimSpace(payload.SessionID) == "" {
		return statusError{status: http.StatusBadRequest, detail: "node_id, user_id and session_id are required"}
	}
	switch strings.ToLower(strings.TrimSpace(payload.Protocol)) {
	case "ov", "openvpn", "l2tp", "wg", "wireguard":
	default:
		return statusError{status: http.StatusBadRequest, detail: "unsupported protocol"}
	}
	switch strings.ToLower(strings.TrimSpace(payload.Event)) {
	case "start", "stop", "seen":
	default:
		return statusError{status: http.StatusBadRequest, detail: "unsupported event"}
	}
	var cert string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(certificate, '') FROM nodes WHERE id = ? LIMIT 1`, payload.NodeID).Scan(&cert)
	if err == sql.ErrNoRows {
		return statusError{status: http.StatusForbidden, detail: "node not found"}
	}
	if err != nil {
		return err
	}
	secret, err := s.nodeSessionCallbackSecret(ctx)
	if err != nil {
		return err
	}
	if strings.TrimSpace(secret) == "" {
		return statusError{status: http.StatusForbidden, detail: "node session secret is not configured"}
	}
	expected := nodecontroller.NodeSessionEventToken(secret, payload.NodeID, cert)
	if expected == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(strings.TrimSpace(payload.Token))) != 1 {
		return statusError{status: http.StatusForbidden, detail: "invalid node session token"}
	}
	return nil
}

func (s *Server) nodeSessionCallbackSecret(ctx context.Context) (string, error) {
	var adminSecret, legacySecret sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT admin_secret_key, secret_key FROM jwt ORDER BY id LIMIT 1`).Scan(&adminSecret, &legacySecret)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if value := strings.TrimSpace(adminSecret.String); value != "" {
		return value, nil
	}
	return strings.TrimSpace(legacySecret.String), nil
}

func (s *Server) applyNodeSessionEvent(ctx context.Context, payload nodeSessionEventPayload) error {
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	before, err := activeVPNSessionLimitState(ctx, tx, payload.UserID)
	if err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(payload.Event)) {
	case "start", "seen":
		if err := upsertVPNSession(ctx, tx, payload, now); err != nil {
			return err
		}
	case "stop":
		if err := endVPNSession(ctx, tx, payload, now); err != nil {
			return err
		}
	}
	after, err := activeVPNSessionLimitState(ctx, tx, payload.UserID)
	if err != nil {
		return err
	}
	userID := payload.UserID
	if !before.Blocked && after.Blocked {
		if err := enqueueNodeOperationTx(ctx, tx, "disable_user", nil, &userID, map[string]any{"source": "device_limit", "protocol": payload.Protocol}); err != nil {
			return err
		}
	} else if before.Blocked && !after.Blocked {
		if err := enqueueNodeOperationTx(ctx, tx, "enable_user", nil, &userID, map[string]any{"source": "device_limit", "protocol": payload.Protocol}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type vpnSessionLimitState struct {
	Count   int64
	Limit   int64
	Blocked bool
}

func activeVPNSessionLimitState(ctx context.Context, tx *sql.Tx, userID int64) (vpnSessionLimitState, error) {
	var state vpnSessionLimitState
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(ip_limit, 0) FROM users WHERE id = ? LIMIT 1`, userID).Scan(&state.Limit)
	if err == sql.ErrNoRows {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	rows, err := tx.QueryContext(ctx, `
SELECT COALESCE(client_ip, ''), COALESCE(assigned_ip, ''), session_id
FROM vpn_user_sessions
WHERE user_id = ? AND ended_at IS NULL`, userID)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	devices := map[string]struct{}{}
	for rows.Next() {
		var clientIP, assignedIP, sessionID string
		if err := rows.Scan(&clientIP, &assignedIP, &sessionID); err != nil {
			return state, err
		}
		key := sessionLimitDeviceKey(clientIP, assignedIP, sessionID)
		if key == "" {
			continue
		}
		devices[key] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return state, err
	}
	state.Count = int64(len(devices))
	state.Blocked = state.Limit > 0 && state.Count >= state.Limit
	return state, nil
}

func sessionLimitDeviceKey(clientIP string, assignedIP string, sessionID string) string {
	if value := strings.TrimSpace(clientIP); value != "" {
		return "client:" + value
	}
	if value := strings.TrimSpace(assignedIP); value != "" {
		return "assigned:" + value
	}
	if value := strings.TrimSpace(sessionID); value != "" {
		return "session:" + value
	}
	return ""
}

func upsertVPNSession(ctx context.Context, tx *sql.Tx, payload nodeSessionEventPayload, now time.Time) error {
	res, err := tx.ExecContext(ctx, `
UPDATE vpn_user_sessions
SET user_id = ?, protocol = ?, inbound_tag = ?, assigned_ip = ?, client_ip = ?, last_seen_at = ?, ended_at = NULL
WHERE node_id = ? AND session_id = ?`,
		payload.UserID,
		normalizedVPNProtocol(payload.Protocol),
		nullableTrimmed(payload.InboundTag),
		nullableTrimmed(payload.AssignedIP),
		nullableTrimmed(payload.ClientIP),
		dbTimestamp(now),
		payload.NodeID,
		strings.TrimSpace(payload.SessionID),
	)
	if err != nil {
		return err
	}
	if affected, err := res.RowsAffected(); err == nil && affected > 0 {
		return nil
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, inbound_tag, session_id, assigned_ip, client_ip, started_at, last_seen_at, ended_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		payload.NodeID,
		payload.UserID,
		normalizedVPNProtocol(payload.Protocol),
		nullableTrimmed(payload.InboundTag),
		strings.TrimSpace(payload.SessionID),
		nullableTrimmed(payload.AssignedIP),
		nullableTrimmed(payload.ClientIP),
		dbTimestamp(now),
		dbTimestamp(now),
	)
	return err
}

func endVPNSession(ctx context.Context, tx *sql.Tx, payload nodeSessionEventPayload, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
UPDATE vpn_user_sessions
SET last_seen_at = ?, ended_at = ?
WHERE node_id = ? AND session_id = ? AND user_id = ? AND ended_at IS NULL`,
		dbTimestamp(now),
		dbTimestamp(now),
		payload.NodeID,
		strings.TrimSpace(payload.SessionID),
		payload.UserID,
	)
	return err
}

func normalizedVPNProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "openvpn":
		return "ov"
	case "wireguard":
		return "wg"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func nullableTrimmed(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
