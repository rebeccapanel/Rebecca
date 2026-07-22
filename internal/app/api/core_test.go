//go:build cgo

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestCoreRuntimeRouteIsGoNative(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, status, xray_version) VALUES (7, 'node-a', 'connected', '25.2.1')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "owner", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/core", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("core status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Version       *string `json:"version"`
		Started       bool    `json:"started"`
		LogsWebSocket string  `json:"logs_websocket"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Started || body.Version == nil || *body.Version != "25.2.1" || body.LogsWebSocket != "/api/core/logs" {
		t.Fatalf("unexpected core response: %#v", body)
	}
}

func TestCoreRestartQueuesSyncConfig(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, status, xray_version) VALUES (7, 'node-a', 'connected', '25.2.1')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "owner", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/core/restart?target=node:7", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("node restart queue status = %d body=%s", rec.Code, rec.Body.String())
	}
	var nodeOps int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`).Scan(&nodeOps); err != nil {
		t.Fatal(err)
	}
	if nodeOps != 1 {
		t.Fatalf("node sync operations = %d, want 1", nodeOps)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/core/restart", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("global restart queue status = %d body=%s", rec.Code, rec.Body.String())
	}
	var globalOps int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`).Scan(&globalOps); err != nil {
		t.Fatal(err)
	}
	if globalOps != 1 {
		t.Fatalf("global sync operations = %d, want 1", globalOps)
	}
}

func TestOutboundTestRejectsMasterTarget(t *testing.T) {
	server := &Server{}
	payload := []byte(`{
		"target_id": "master",
		"outbound": "{\"tag\":\"direct\",\"protocol\":\"freedom\"}",
		"allOutbounds": "[{\"tag\":\"direct\",\"protocol\":\"freedom\"}]"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/testOutbound", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleOutboundTest(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Change the target to a node") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestRouteTestRejectsMasterTarget(t *testing.T) {
	server := &Server{}
	payload := []byte(`{
		"target_id": "master",
		"domain": "example.com",
		"port": 443,
		"network": "tcp"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/routeTest", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleRouteTest(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Change the target to a node") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestRouteTestRejectsMissingDestination(t *testing.T) {
	server := &Server{}
	payload := []byte(`{
		"target_id": "node:7",
		"port": 443,
		"network": "tcp"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/routeTest", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleRouteTest(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "domain or ip is required") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestTorProxySetupRejectsInvalidPort(t *testing.T) {
	server := &Server{}
	payload := []byte(`{
		"target_id": "node:7",
		"port": 80,
		"country": "de"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/tor/setup", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleTorProxySetup(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "port must be") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestTorProxySetupReturnsBeforeNodeInstallation(t *testing.T) {
	server, db := testAdminServer(t)
	insertNodeConfig(t, db, 999, "default", nil)
	payload := []byte(`{
		"target_id": "node:999",
		"port": 9050,
		"country": "de",
		"tag": "tor-de"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/tor/setup", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleTorProxySetup(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Obj     struct {
			Outbound map[string]any `json:"outbound"`
		} `json:"obj"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Success || body.Obj.Outbound["tag"] != "tor-de" {
		t.Fatalf("unexpected response: %#v", body)
	}
}

func TestTorProxySetupRejectsExistingOutboundTag(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterConfig(t, db, map[string]any{
		"outbounds": []any{map[string]any{"tag": "tor-de", "protocol": "socks"}},
	})
	payload := []byte(`{
		"target_id": "master",
		"port": 9050,
		"country": "de",
		"tag": "tor-de"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/tor/setup", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleTorProxySetup(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "outbound tag already exists: tor-de") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestTorProfilesFromPayloadAssignsAscendingPorts(t *testing.T) {
	profiles, err := torProfilesFromPayload(map[string]any{
		"locations":  []any{"de", "nl", "us"},
		"start_port": float64(9050),
		"port_step":  float64(2),
		"direction":  "up",
		"tag_prefix": "exit",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 || profiles[0].Tag != "exit-de" || profiles[1].Port != 9052 || profiles[2].Port != 9054 {
		t.Fatalf("unexpected profiles: %#v", profiles)
	}
}

func TestTorProfilesFromPayloadAssignsDescendingPorts(t *testing.T) {
	profiles, err := torProfilesFromPayload(map[string]any{
		"locations":  "de, nl\nus",
		"start_port": float64(9050),
		"port_step":  float64(5),
		"direction":  "down",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 || profiles[0].Port != 9050 || profiles[1].Port != 9045 || profiles[2].Port != 9040 {
		t.Fatalf("unexpected profiles: %#v", profiles)
	}
}

func TestTorProfilesFromPayloadRejectsDuplicateLocations(t *testing.T) {
	_, err := torProfilesFromPayload(map[string]any{
		"locations":  []any{"de", "DE"},
		"start_port": float64(9050),
	})
	if err == nil || !strings.Contains(err.Error(), "duplicated") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestOutboundTestRejectsAddresslessTCPAndICMP(t *testing.T) {
	server := &Server{}
	for _, testType := range []string{"tcp", "icmp"} {
		t.Run(testType, func(t *testing.T) {
			payload := []byte(`{
				"target_id": "node:7",
				"test_type": "` + testType + `",
				"outbound": "{\"tag\":\"direct\",\"protocol\":\"freedom\"}",
				"allOutbounds": "[{\"tag\":\"direct\",\"protocol\":\"freedom\"}]"
			}`)
			req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/testOutbound", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			server.handleOutboundTest(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "require an outbound address") {
				t.Fatalf("unexpected body=%s", rec.Body.String())
			}
		})
	}
}

func TestOutboundTestsBatchKeepsPerItemFailures(t *testing.T) {
	server := &Server{}
	payload := []byte(`{
		"target_id": "node:7",
		"test_type": "tcp",
		"outbounds": "[{\"tag\":\"direct\",\"protocol\":\"freedom\"}]",
		"allOutbounds": "[{\"tag\":\"direct\",\"protocol\":\"freedom\"}]"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/testOutbounds", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleOutboundTests(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Obj     []struct {
			Success  bool   `json:"success"`
			Error    string `json:"error"`
			TestType string `json:"test_type"`
		} `json:"obj"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Success || len(body.Obj) != 1 || body.Obj[0].Success || body.Obj[0].TestType != "tcp" || !strings.Contains(body.Obj[0].Error, "require an outbound address") {
		t.Fatalf("unexpected batch response: %#v", body)
	}
}

func TestOutboundAddressDetection(t *testing.T) {
	tests := map[string]struct {
		outbound map[string]any
		want     bool
	}{
		"freedom": {
			outbound: map[string]any{"protocol": "freedom", "settings": map[string]any{}},
			want:     false,
		},
		"vless": {
			outbound: map[string]any{
				"protocol": "vless",
				"settings": map[string]any{
					"vnext": []any{map[string]any{"address": "example.com", "port": 443}},
				},
			},
			want: true,
		},
		"wireguard": {
			outbound: map[string]any{
				"protocol": "wireguard",
				"settings": map[string]any{
					"peers": []any{map[string]any{"endpoint": "1.1.1.1:2408"}},
				},
			},
			want: true,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			if got := outboundHasAddress(tc.outbound); got != tc.want {
				t.Fatalf("outboundHasAddress()=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestOutboundTestTypeNormalization(t *testing.T) {
	tests := map[string]struct {
		payload map[string]any
		want    string
	}{
		"default": {payload: map[string]any{}, want: "latency"},
		"http":    {payload: map[string]any{"test_type": "http"}, want: "latency"},
		"latency": {payload: map[string]any{"test_type": "latency"}, want: "latency"},
		"tcp":     {payload: map[string]any{"test_type": "tcp"}, want: "tcp"},
		"icmp":    {payload: map[string]any{"testType": "ping"}, want: "icmp"},
		"unknown": {payload: map[string]any{"type": "weird"}, want: "latency"},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			if got := outboundTestType(tc.payload); got != tc.want {
				t.Fatalf("outboundTestType()=%q, want %q", got, tc.want)
			}
		})
	}
}
