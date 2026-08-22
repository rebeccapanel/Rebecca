package api

import (
	"bytes"
	"crypto/ecdh"
	"crypto/mlkem"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerateVLESSEncAuthBlocks(t *testing.T) {
	auths, err := generateVLESSEncAuthBlocks()
	if err != nil {
		t.Fatal(err)
	}
	assertVLESSEncAuthBlocks(t, auths)
}

func TestVLESSEncHelperDisablesCaching(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/xray/vlessenc", nil)
	new(Server).handleXrayHelperPath(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("vlessenc status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("vlessenc secret response is cacheable: %q", recorder.Header().Get("Cache-Control"))
	}
	var response struct {
		Auths []map[string]string `json:"auths"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	assertVLESSEncAuthBlocks(t, response.Auths)
}

func assertVLESSEncAuthBlocks(t *testing.T, auths []map[string]string) {
	t.Helper()
	if len(auths) != 7 {
		t.Fatalf("unexpected VLESS Encryption auth count: %#v", auths)
	}
	byID := make(map[string]map[string]string, len(auths))
	for _, auth := range auths {
		id := auth["id"]
		if id == "" || byID[id] != nil {
			t.Fatalf("missing or duplicate VLESS Encryption auth id %q: %#v", id, auths)
		}
		byID[id] = auth
	}
	if none := byID["none"]; none["label"] != "none" || none["encryption"] != "none" || none["decryption"] != "none" {
		t.Fatalf("backward-compatible none auth mismatch: %#v", none)
	}

	for _, algorithm := range []struct {
		id              string
		serverKeyLength int
		clientKeyLength int
	}{
		{id: "x25519", serverKeyLength: 32, clientKeyLength: 32},
		{id: "mlkem768", serverKeyLength: 64, clientKeyLength: 1184},
	} {
		var nativeServerKey, nativeClientKey []byte
		for _, mode := range []string{"native", "xorpub", "random"} {
			id := algorithm.id
			if mode != "native" {
				id += "_" + mode
			}
			auth := byID[id]
			if auth == nil || auth["label"] == "" {
				t.Fatalf("missing VLESS Encryption auth %q: %#v", id, auths)
			}
			decryption := strings.Split(auth["decryption"], ".")
			encryption := strings.Split(auth["encryption"], ".")
			if len(decryption) != 4 || len(encryption) != 4 || decryption[0] != "mlkem768x25519plus" || encryption[0] != "mlkem768x25519plus" || decryption[1] != mode || encryption[1] != mode || decryption[2] != "600s" || encryption[2] != "0rtt" {
				t.Fatalf("invalid %s mode pair: decryption=%q encryption=%q", id, auth["decryption"], auth["encryption"])
			}
			serverKey, serverErr := base64.RawURLEncoding.DecodeString(decryption[3])
			clientKey, clientErr := base64.RawURLEncoding.DecodeString(encryption[3])
			if serverErr != nil || clientErr != nil || len(serverKey) != algorithm.serverKeyLength || len(clientKey) != algorithm.clientKeyLength {
				t.Fatalf("invalid %s keys: server=%d/%v client=%d/%v", id, len(serverKey), serverErr, len(clientKey), clientErr)
			}
			if mode == "native" {
				nativeServerKey, nativeClientKey = serverKey, clientKey
			} else if !bytes.Equal(serverKey, nativeServerKey) || !bytes.Equal(clientKey, nativeClientKey) {
				t.Fatalf("%s mode did not retain its generated authentication key pair", id)
			}
		}
		if algorithm.id == "x25519" {
			privateKey, err := ecdh.X25519().NewPrivateKey(nativeServerKey)
			if err != nil || !bytes.Equal(privateKey.PublicKey().Bytes(), nativeClientKey) {
				t.Fatalf("X25519 client encryption key is not paired with server decryption key: %v", err)
			}
		} else {
			privateKey, err := mlkem.NewDecapsulationKey768(nativeServerKey)
			if err != nil || !bytes.Equal(privateKey.EncapsulationKey().Bytes(), nativeClientKey) {
				t.Fatalf("ML-KEM-768 client encryption key is not paired with server decryption seed: %v", err)
			}
		}
	}
}

func TestGeneratedVLESSEncryptionAcceptedByOfficialXray(t *testing.T) {
	binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_TEST_BINARY"))
	if binary == "" {
		t.Skip("set REBECCA_XRAY_TEST_BINARY to an official Xray binary")
	}
	auths, err := generateVLESSEncAuthBlocks()
	if err != nil {
		t.Fatal(err)
	}
	for _, auth := range auths {
		if auth["id"] == "none" {
			continue
		}
		t.Run(auth["id"], func(t *testing.T) {
			config := map[string]any{
				"log": map[string]any{"loglevel": "none"},
				"inbounds": []any{map[string]any{
					"listen": "127.0.0.1", "port": 12345, "protocol": "vless",
					"settings": map[string]any{
						"clients":    []any{map[string]any{"id": "11111111-1111-4111-8111-111111111111"}},
						"decryption": auth["decryption"],
					},
				}},
				"outbounds": []any{map[string]any{"tag": "direct", "protocol": "freedom"}},
			}
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			output, err := exec.Command(binary, "run", "-test", "-config", path).CombinedOutput()
			if err != nil {
				t.Fatalf("official Xray rejected generated %s authentication: %v\n%s", auth["id"], err, output)
			}
		})
	}
}
