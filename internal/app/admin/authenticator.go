package admin

import (
	"context"
	"errors"
	"strings"
	"time"
)

type Authenticator struct {
	repo Repository
	now  func() time.Time
}

type AuthenticatorOption func(*Authenticator)

func NewAuthenticator(repo Repository, opts ...AuthenticatorOption) Authenticator {
	auth := Authenticator{
		repo: repo,
		now:  func() time.Time { return time.Now().UTC() },
	}
	for _, opt := range opts {
		opt(&auth)
	}
	return auth
}

func WithClock(now func() time.Time) AuthenticatorOption {
	return func(auth *Authenticator) {
		if now != nil {
			auth.now = now
		}
	}
}

func (a Authenticator) AuthenticateBearer(ctx context.Context, token string) (EffectiveAdminContext, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return EffectiveAdminContext{}, ErrInvalidToken
	}
	if result, err := a.authenticateJWT(ctx, token); err == nil {
		return result, nil
	} else if looksLikeJWT(token) || err != ErrInvalidToken {
		return EffectiveAdminContext{}, err
	}
	return a.authenticateAPIKey(ctx, token)
}

func (a Authenticator) authenticateJWT(ctx context.Context, token string) (EffectiveAdminContext, error) {
	secret, err := a.repo.AdminSecret(ctx)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	payload, err := VerifyAdminToken(token, secret, a.now())
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	dbadmin, found, err := a.repo.AdminByUsername(ctx, payload.Username)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if !found {
		return EffectiveAdminContext{}, ErrAdminNotFound
	}
	if err := dbadmin.ValidateNotDeleted(); err != nil {
		return EffectiveAdminContext{}, err
	}
	if dbadmin.PasswordResetAt != nil {
		if payload.CreatedAt == nil {
			return EffectiveAdminContext{}, ErrPasswordResetAfter
		}
		if dbadmin.PasswordResetAt.After(*payload.CreatedAt) {
			return EffectiveAdminContext{}, ErrPasswordResetAfter
		}
	}
	if err := dbadmin.ValidateAuthAllowed(a.now()); err != nil {
		return EffectiveAdminContext{}, err
	}
	return EffectiveAdminContext{
		Admin:          dbadmin,
		Source:         AuthSourceJWT,
		TokenCreatedAt: payload.CreatedAt,
	}, nil
}

func (a Authenticator) authenticateAPIKey(ctx context.Context, token string) (EffectiveAdminContext, error) {
	apiKey, found, err := a.repo.APIKeyByToken(ctx, token)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if !found {
		return EffectiveAdminContext{}, ErrInvalidToken
	}
	if apiKey.ExpiresAt != nil && a.now().After(*apiKey.ExpiresAt) {
		return EffectiveAdminContext{}, errors.New("admin api key expired")
	}
	dbadmin, found, err := a.repo.AdminByID(ctx, apiKey.AdminID)
	if err != nil {
		return EffectiveAdminContext{}, err
	}
	if !found {
		return EffectiveAdminContext{}, ErrAdminNotFound
	}
	if err := dbadmin.ValidateAuthAllowed(a.now()); err != nil {
		return EffectiveAdminContext{}, err
	}
	usedAt := a.now()
	if err := a.repo.TouchAPIKey(ctx, apiKey.ID, usedAt); err != nil {
		return EffectiveAdminContext{}, err
	}
	apiKey.LastUsedAt = &usedAt
	return EffectiveAdminContext{
		Admin:  dbadmin,
		Source: AuthSourceAPIKey,
		APIKey: &apiKey,
	}, nil
}

func looksLikeJWT(token string) bool {
	return strings.Count(token, ".") == 2
}
