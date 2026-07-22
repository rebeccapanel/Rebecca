package admin

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type AdminTokenPayload struct {
	Username  string
	Role      AdminRole
	CreatedAt *time.Time
	ExpiresAt *time.Time
}

type adminJWTClaims struct {
	Subject string          `json:"sub"`
	Role    string          `json:"role,omitempty"`
	Access  string          `json:"access,omitempty"`
	Issued  json.RawMessage `json:"iat,omitempty"`
	Expires json.RawMessage `json:"exp,omitempty"`
}

func CreateAdminToken(username string, role AdminRole, secret string, expiresIn time.Duration) (string, error) {
	return CreateAdminTokenAt(username, role, secret, expiresIn, time.Now().UTC())
}

func CreateAdminTokenAt(
	username string,
	role AdminRole,
	secret string,
	expiresIn time.Duration,
	now time.Time,
) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}
	role, err := ParseRole(string(role))
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(secret) == "" {
		return "", errors.New("jwt secret is required")
	}

	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := map[string]any{
		"sub":  username,
		"role": string(role),
		"iat":  now.UTC().Unix(),
	}
	if expiresIn > 0 {
		payload["exp"] = now.UTC().Add(expiresIn).Unix()
	}
	// TODO: send Go-native admin login reports through Telegram once the
	// notification migration in docs/TODO_GO_TELEGRAM.md is implemented.
	return encodeHS256JWT(header, payload, secret)
}

func VerifyAdminToken(token string, secret string, now time.Time) (AdminTokenPayload, error) {
	token = strings.TrimSpace(token)
	secret = strings.TrimSpace(secret)
	if token == "" || secret == "" {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	var header struct {
		Algorithm string `json:"alg"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" {
		return AdminTokenPayload{}, ErrInvalidToken
	}

	signed := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signed))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(expected, actual) {
		return AdminTokenPayload{}, ErrInvalidToken
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	var claims adminJWTClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	username := strings.TrimSpace(claims.Subject)
	if username == "" {
		return AdminTokenPayload{}, ErrInvalidToken
	}
	roleText := claims.Role
	if strings.TrimSpace(roleText) == "" {
		roleText = claims.Access
	}
	role, err := ParseRole(roleText)
	if err != nil {
		return AdminTokenPayload{}, err
	}

	var createdAt *time.Time
	if iat, ok, err := parseJWTTime(claims.Issued); err != nil {
		return AdminTokenPayload{}, fmt.Errorf("invalid token issued-at: %w", err)
	} else if ok {
		createdAt = &iat
	}
	var expiresAt *time.Time
	if exp, ok, err := parseJWTTime(claims.Expires); err != nil {
		return AdminTokenPayload{}, fmt.Errorf("invalid token expiration: %w", err)
	} else if ok {
		expiresAt = &exp
		if now.UTC().After(exp) {
			return AdminTokenPayload{}, errors.New("token expired")
		}
	}

	return AdminTokenPayload{
		Username:  username,
		Role:      role,
		CreatedAt: createdAt,
		ExpiresAt: expiresAt,
	}, nil
}

func encodeHS256JWT(header map[string]string, payload map[string]any, secret string) (string, error) {
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(headerBytes) + "." +
		base64.RawURLEncoding.EncodeToString(payloadBytes)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return unsigned + "." + signature, nil
}

func parseJWTTime(raw json.RawMessage) (time.Time, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return time.Time{}, false, nil
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		seconds := int64(number)
		nanos := int64((number - float64(seconds)) * 1e9)
		return time.Unix(seconds, nanos).UTC(), true, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return time.Time{}, false, err
	}
	if numeric, err := strconv.ParseFloat(text, 64); err == nil {
		seconds := int64(numeric)
		nanos := int64((numeric - float64(seconds)) * 1e9)
		return time.Unix(seconds, nanos).UTC(), true, nil
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
	} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC(), true, nil
		}
	}
	return time.Time{}, false, fmt.Errorf("unsupported timestamp")
}
