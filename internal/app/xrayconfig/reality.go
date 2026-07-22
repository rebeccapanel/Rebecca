package xrayconfig

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"

	"golang.org/x/crypto/curve25519"
)

var hexPrivateKeyPattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

func NormalizeRealityPrivateKey(privateKey string) (string, error) {
	raw, err := decodeRealityPrivateKey(privateKey)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func DeriveRealityPublicKey(privateKey string) (string, error) {
	raw, err := decodeRealityPrivateKey(privateKey)
	if err != nil {
		return "", err
	}
	public, err := curve25519.X25519(raw, curve25519.Basepoint)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(public), nil
}

func decodeRealityPrivateKey(privateKey string) ([]byte, error) {
	normalized := strings.Join(strings.Fields(privateKey), "")
	if normalized == "" {
		return nil, errors.New("Reality private key is empty")
	}

	var raw []byte
	var err error
	if hexPrivateKeyPattern.MatchString(normalized) {
		raw, err = hex.DecodeString(normalized)
	} else {
		raw, err = decodeBase64Key(normalized)
	}
	if err != nil {
		return nil, err
	}
	if len(raw) != 32 {
		return nil, errors.New("Reality private key must decode to 32 bytes")
	}
	return raw, nil
}

func decodeBase64Key(value string) ([]byte, error) {
	if raw, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.URLEncoding.DecodeString(padBase64(value)); err == nil {
		return raw, nil
	}
	if raw, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.StdEncoding.DecodeString(padBase64(value)); err == nil {
		return raw, nil
	}
	return nil, errors.New("Reality private key is not valid Base64 or hex")
}

func padBase64(value string) string {
	if remainder := len(value) % 4; remainder != 0 {
		return value + strings.Repeat("=", 4-remainder)
	}
	return value
}
