package admin

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func GenerateTOTPSecret() (string, error) {
	value := make([]byte, 20)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(value), nil
}

func TOTPURI(account string, secret string) string {
	label := url.PathEscape("Rebecca:" + account)
	values := url.Values{
		"secret":    {secret},
		"issuer":    {"Rebecca"},
		"algorithm": {"SHA1"},
		"digits":    {"6"},
		"period":    {"30"},
	}
	return "otpauth://totp/" + label + "?" + values.Encode()
}

func VerifyTOTP(secret string, code string, now time.Time, lastCounter *int64) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return 0, false
	}
	if _, err := strconv.Atoi(code); err != nil {
		return 0, false
	}
	baseCounter := now.UTC().Unix() / 30
	for _, counter := range []int64{baseCounter, baseCounter - 1, baseCounter + 1} {
		if counter < 0 || (lastCounter != nil && counter <= *lastCounter) {
			continue
		}
		candidate, err := totpCode(secret, uint64(counter))
		if err == nil && hmac.Equal([]byte(candidate), []byte(code)) {
			return counter, true
		}
	}
	return 0, false
}

func totpCode(secret string, counter uint64) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}
	value := make([]byte, 8)
	binary.BigEndian.PutUint64(value, counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(value)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	number := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", number%1_000_000), nil
}

func EncryptTOTPSecret(secret string, keyMaterial string) (string, error) {
	block, err := aes.NewCipher(totpEncryptionKey(keyMaterial))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(secret), nil)
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func DecryptTOTPSecret(value string, keyMaterial string) (string, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(totpEncryptionKey(keyMaterial))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", fmt.Errorf("invalid encrypted TOTP secret")
	}
	plain, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func totpEncryptionKey(material string) []byte {
	sum := sha256.Sum256([]byte("rebecca-admin-totp-v1:" + material))
	return sum[:]
}
