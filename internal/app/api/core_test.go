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
