package admin

import (
	"testing"
	"time"
)

func TestTOTPAndSecretEncryption(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	now := time.Unix(59, 0).UTC()
	counter, ok := VerifyTOTP(secret, "287082", now, nil)
	if !ok || counter != 1 {
		t.Fatalf("RFC TOTP vector failed: counter=%d ok=%v", counter, ok)
	}
	if _, ok := VerifyTOTP(secret, "287082", now, &counter); ok {
		t.Fatal("reused TOTP code must be rejected")
	}

	encrypted, err := EncryptTOTPSecret(secret, "persistent-key")
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := DecryptTOTPSecret(encrypted, "persistent-key")
	if err != nil {
		t.Fatal(err)
	}
	if decrypted != secret {
		t.Fatalf("decrypted secret = %q", decrypted)
	}
}
