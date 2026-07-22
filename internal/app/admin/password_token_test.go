package admin

import (
	"strings"
	"testing"
	"time"
)

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$2") {
		t.Fatalf("unexpected bcrypt hash prefix: %s", hash)
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Fatal("expected password to verify")
	}
	if VerifyPassword(hash, "wrong") {
		t.Fatal("wrong password verified")
	}
}

func TestAdminTokenCreateVerify(t *testing.T) {
	now := time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC)
	token, err := CreateAdminTokenAt("pouria", RoleReseller, "secret", time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := VerifyAdminToken(token, "secret", now.Add(30*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Username != "pouria" || payload.Role != RoleReseller {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if payload.CreatedAt == nil || !payload.CreatedAt.Equal(now) {
		t.Fatalf("unexpected iat: %#v", payload.CreatedAt)
	}
	if _, err := VerifyAdminToken(token, "secret", now.Add(2*time.Hour)); err == nil {
		t.Fatal("expected expired token to fail")
	}
	if _, err := VerifyAdminToken(token, "different", now); err == nil {
		t.Fatal("expected wrong secret to fail")
	}
}

func TestAdminTokenAcceptsLegacyAdminRole(t *testing.T) {
	now := time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC)
	token, err := encodeHS256JWT(
		map[string]string{"alg": "HS256", "typ": "JWT"},
		map[string]any{"sub": "legacy", "access": "admin", "iat": now.Unix()},
		"secret",
	)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := VerifyAdminToken(token, "secret", now)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Role != RoleStandard {
		t.Fatalf("expected legacy admin to normalize to standard, got %s", payload.Role)
	}
}
