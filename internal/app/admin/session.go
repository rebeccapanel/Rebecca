package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"time"
)

type SessionState string

const (
	SessionActive        SessionState = "active"
	SessionPending2FA    SessionState = "pending_2fa"
	SessionSetupRequired SessionState = "setup_required"
)

type AdminSession struct {
	ID                int64        `json:"id"`
	AdminID           int64        `json:"admin_id"`
	State             SessionState `json:"state"`
	CreatedAt         time.Time    `json:"created_at"`
	LastSeenAt        time.Time    `json:"last_seen_at"`
	ExpiresAt         time.Time    `json:"expires_at"`
	IPAddress         string       `json:"ip_address"`
	UserAgent         string       `json:"user_agent"`
	PendingTOTPSecret string       `json:"-"`
	OTPAttempts       int          `json:"-"`
	Current           bool         `json:"current,omitempty"`
}

func NewSessionToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func SessionTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r Repository) CreateSession(ctx context.Context, session AdminSession, token string) (AdminSession, error) {
	_, _ = r.db.ExecContext(ctx, `DELETE FROM admin_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, dbTime(session.CreatedAt), dbTime(session.CreatedAt.AddDate(0, 0, -30)))
	result, err := r.db.ExecContext(ctx, `
INSERT INTO admin_sessions (
	admin_id, token_hash, state, created_at, last_seen_at, expires_at,
	ip_address, user_agent, pending_totp_secret, otp_attempts
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.AdminID,
		SessionTokenHash(token),
		string(session.State),
		dbTime(session.CreatedAt),
		dbTime(session.LastSeenAt),
		dbTime(session.ExpiresAt),
		session.IPAddress,
		session.UserAgent,
		nullableString(session.PendingTOTPSecret),
		session.OTPAttempts,
	)
	if err != nil {
		return AdminSession{}, err
	}
	session.ID, err = result.LastInsertId()
	return session, err
}

func (r Repository) SessionByToken(ctx context.Context, token string) (AdminSession, bool, error) {
	var session AdminSession
	var state string
	var created, lastSeen, expires any
	var ip, userAgent, pending sql.NullString
	err := r.db.QueryRowContext(ctx, `
SELECT id, admin_id, state, created_at, last_seen_at, expires_at,
	ip_address, user_agent, pending_totp_secret, COALESCE(otp_attempts, 0)
FROM admin_sessions
WHERE token_hash = ? AND revoked_at IS NULL
LIMIT 1`, SessionTokenHash(token)).Scan(
		&session.ID, &session.AdminID, &state, &created, &lastSeen, &expires,
		&ip, &userAgent, &pending, &session.OTPAttempts,
	)
	if err == sql.ErrNoRows {
		return AdminSession{}, false, nil
	}
	if err != nil {
		return AdminSession{}, false, err
	}
	session.State = SessionState(state)
	session.CreatedAt = timeValue(created)
	session.LastSeenAt = timeValue(lastSeen)
	session.ExpiresAt = timeValue(expires)
	session.IPAddress = ip.String
	session.UserAgent = userAgent.String
	session.PendingTOTPSecret = pending.String
	return session, true, nil
}

func (r Repository) ListSessions(ctx context.Context, adminID int64, currentID int64) ([]AdminSession, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, admin_id, state, created_at, last_seen_at, expires_at, ip_address, user_agent
FROM admin_sessions
WHERE admin_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ? AND state = ?
ORDER BY last_seen_at DESC`, adminID, dbTime(time.Now().UTC()), dbTime(time.Now().UTC().Add(-24*time.Hour)), string(SessionActive))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []AdminSession{}
	for rows.Next() {
		var session AdminSession
		var state string
		var created, lastSeen, expires any
		var ip, userAgent sql.NullString
		if err := rows.Scan(&session.ID, &session.AdminID, &state, &created, &lastSeen, &expires, &ip, &userAgent); err != nil {
			return nil, err
		}
		session.State = SessionState(state)
		session.CreatedAt = timeValue(created)
		session.LastSeenAt = timeValue(lastSeen)
		session.ExpiresAt = timeValue(expires)
		session.IPAddress = ip.String
		session.UserAgent = userAgent.String
		session.Current = session.ID == currentID
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (r Repository) TouchSession(ctx context.Context, id int64, now time.Time) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE admin_sessions SET last_seen_at = ?
WHERE id = ? AND last_seen_at < ?`, dbTime(now), id, dbTime(now.Add(-5*time.Minute)))
	return err
}

func (r Repository) RevokeSession(ctx context.Context, adminID int64, id int64, now time.Time) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
UPDATE admin_sessions SET revoked_at = ?
WHERE id = ? AND admin_id = ? AND revoked_at IS NULL`, dbTime(now), id, adminID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (r Repository) RevokeAllSessions(ctx context.Context, adminID int64, exceptID int64, now time.Time) error {
	query := `UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`
	args := []any{dbTime(now), adminID}
	if exceptID > 0 {
		query += ` AND id != ?`
		args = append(args, exceptID)
	}
	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (a Authenticator) AuthenticateSession(ctx context.Context, token string) (EffectiveAdminContext, error) {
	result, err := a.SessionContext(ctx, token)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if result.Session == nil || result.Session.State != SessionActive {
		return EffectiveAdminContext{}, ErrSessionRestricted
	}
	return result, nil
}

func (a Authenticator) SessionContext(ctx context.Context, token string) (EffectiveAdminContext, error) {
	session, found, err := a.repo.SessionByToken(ctx, token)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if !found {
		return EffectiveAdminContext{}, ErrInvalidToken
	}
	now := a.now()
	if !session.ExpiresAt.After(now) || session.LastSeenAt.Before(now.Add(-24*time.Hour)) {
		return EffectiveAdminContext{}, ErrSessionExpired
	}
	dbadmin, found, err := a.repo.AdminByID(ctx, session.AdminID)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if !found {
		return EffectiveAdminContext{}, ErrAdminNotFound
	}
	if err := dbadmin.ValidateAuthAllowed(now); err != nil {
		return EffectiveAdminContext{}, err
	}
	if err := a.repo.TouchSession(ctx, session.ID, now); err != nil {
		return EffectiveAdminContext{}, err
	}
	session.LastSeenAt = now
	return EffectiveAdminContext{Admin: dbadmin, Source: AuthSourceSession, Session: &session}, nil
}

func timeValue(value any) time.Time {
	parsed := parseOptionalDBTime(value)
	if parsed == nil {
		return time.Time{}
	}
	return *parsed
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
