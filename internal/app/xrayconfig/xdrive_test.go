package xrayconfig

import (
	"encoding/json"
	"strings"
	"testing"
)

func xdriveTestInbound(t *testing.T, protocol, decryption, xdrive string) map[string]any {
	t.Helper()
	var settings map[string]any
	if err := json.Unmarshal([]byte(xdrive), &settings); err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"tag":      "xd",
		"port":     18443,
		"protocol": protocol,
		"settings": map[string]any{"clients": []any{}, "decryption": decryption},
		"streamSettings": map[string]any{
			"network":        "xdrive",
			"security":       "none",
			"xdriveSettings": settings,
		},
	}
}

func TestXDriveInboundValidation(t *testing.T) {
	const enc = "mlkem768x25519plus.native.600s.key"
	valid := map[string]string{
		"local":        `{"service":"local","remoteFolder":"/tmp/drive"}`,
		"google drive": `{"service":"google-drive","remoteFolder":"f","secrets":["id","secret","token"]}`,
		"legacy name":  `{"service":"Google Drive","remoteFolder":"f","secrets":["id","secret","token"]}`,
		"template":     `{"service":"template","template":{"put":{"url":"u"},"get":{"url":"u"},"list":{"url":"u","namesRegex":"\"name\":\"([^\"]+)\""},"delete":{"url":"u"}}}`,
		"s3":           `{"service":"s3","remoteFolder":"x","secrets":["AKID","SECRET"],"s3":{"endpoint":"https://storage.example.net","region":"r","bucket":"b"}}`,
	}
	for name, xdrive := range valid {
		if err := validateExecutableInbound(xdriveTestInbound(t, "vless", enc, xdrive)); err != nil {
			t.Fatalf("%s must be accepted: %v", name, err)
		}
	}
	invalid := []struct{ name, protocol, decryption, xdrive, want string }{
		{"vmess", "vmess", enc, `{"service":"local","remoteFolder":"f"}`, "carries only VLESS"},
		{"no encryption", "vless", "none", `{"service":"local","remoteFolder":"f"}`, "needs VLESS encryption"},
		{"local without folder", "vless", enc, `{"service":"local","remoteFolder":""}`, `needs a "remoteFolder"`},
		{"two google secrets", "vless", enc, `{"service":"google-drive","remoteFolder":"f","secrets":["id","secret"]}`, "needs 3 secrets"},
		{"empty google secret", "vless", enc, `{"service":"google-drive","remoteFolder":"f","secrets":["id","","token"]}`, "needs 3 secrets"},
		{"template missing", "vless", enc, `{"service":"template"}`, `needs a "template" object`},
		{"template without delete", "vless", enc, `{"service":"template","template":{"put":{"url":"u"},"get":{"url":"u"},"list":{"url":"u","namesRegex":"(.+)"}}}`, "needs put, get, list and delete"},
		{"template without regex", "vless", enc, `{"service":"template","template":{"put":{"url":"u"},"get":{"url":"u"},"list":{"url":"u"},"delete":{"url":"u"}}}`, "needs a namesRegex"},
		{"template without group", "vless", enc, `{"service":"template","template":{"put":{"url":"u"},"get":{"url":"u"},"list":{"url":"u","namesRegex":"name"},"delete":{"url":"u"}}}`, "needs one capture group"},
		{"s3 without object", "vless", enc, `{"service":"s3","secrets":["k","s"]}`, `needs an "s3" object`},
		{"s3 ftp endpoint", "vless", enc, `{"service":"s3","secrets":["k","s"],"s3":{"endpoint":"ftp://s3.example","bucket":"b"}}`, "must be an http(s) URL"},
		{"s3 one secret", "vless", enc, `{"service":"s3","secrets":["k"],"s3":{"endpoint":"https://s3.example","bucket":"b"}}`, "needs AccessKeyID, SecretAccessKey"},
		{"s3 virtual host on ip", "vless", enc, `{"service":"s3","secrets":["k","s"],"s3":{"endpoint":"https://10.0.0.1","bucket":"b","pathStyle":false}}`, "requires a DNS endpoint"},
		{"unknown service", "vless", enc, `{"service":"Dropbox","remoteFolder":"f"}`, `unsupported XDRIVE service "Dropbox"`},
	}
	for _, tc := range invalid {
		err := validateExecutableInbound(xdriveTestInbound(t, tc.protocol, tc.decryption, tc.xdrive))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: got %v, want one containing %q", tc.name, err, tc.want)
		}
	}
}

func TestCanonicalizeXDriveServiceRenamesGoogleDrive(t *testing.T) {
	inbound := xdriveTestInbound(t, "vless", "mlkem768x25519plus.native.600s.key", `{"service":"Google Drive","remoteFolder":"f","secrets":["a","b","c"]}`)
	canonicalizeXDriveService(inbound)
	stream := mapValue(inbound["streamSettings"])
	if got := mapValue(stream["xdriveSettings"])["service"]; got != "google-drive" {
		t.Fatalf("service = %v, want google-drive", got)
	}
}
