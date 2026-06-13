//go:build cgo

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
)

type fakeSystemMetricsProvider struct {
	mu    sync.Mutex
	calls int
}

func (p *fakeSystemMetricsProvider) Snapshot(context.Context) (systemapp.MetricsSnapshot, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	call := int64(p.calls)
	return systemapp.MetricsSnapshot{
		Timestamp:              1_780_000_000 + call,
		CPUCores:               8,
		CPUUsage:               float64(10 + call),
		Memory:                 systemapp.UsageStats{Current: 300, Total: 1000, Percent: 30},
		Swap:                   systemapp.UsageStats{Current: 20, Total: 100, Percent: 20},
		Disk:                   systemapp.UsageStats{Current: 400, Total: 2000, Percent: 20},
		LoadAvg:                []float64{1.1, 1.2, 1.3},
		UptimeSeconds:          1234,
		PanelUptimeSeconds:     234,
		AppMemory:              4321,
		AppThreads:             7,
		PanelCPUPercent:        float64(5 + call),
		PanelMemoryPercent:     2.5,
		IncomingBandwidthSpeed: 700 + call,
		OutgoingBandwidthSpeed: 900 + call,
	}, nil
}

func TestSystemStatsRouteIsGoNativeAndCompatible(t *testing.T) {
	server, db := testAdminServer(t)
	statements := []string{
		`CREATE TABLE system (id INTEGER PRIMARY KEY, uplink BIGINT DEFAULT 0, downlink BIGINT DEFAULT 0)`,
		`INSERT INTO system (id, uplink, downlink) VALUES (1, 111, 222)`,
		`ALTER TABLE users ADD COLUMN online_at DATETIME NULL`,
		`INSERT INTO nodes (id, name, status, xray_version) VALUES (1, 'node-a', 'connected', '25.1.0')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	onlineAt := time.Now().UTC().Format("2006-01-02 15:04:05.000000")
	if _, err := db.Exec(
		`INSERT INTO users (id, username, admin_id, status, online_at) VALUES
			(1, 'owner_active', 1, 'active', ?),
			(2, 'seller_limited', 2, 'limited', ?),
			(3, 'seller_disabled', 2, 'disabled', NULL)`,
		onlineAt,
		onlineAt,
	); err != nil {
		t.Fatal(err)
	}
	server.systemService = systemapp.NewServiceWithProvider(
		db,
		"sqlite",
		systemapp.DefaultVersion,
		&fakeSystemMetricsProvider{},
	)

	ownerToken := adminBearerToken(t, server, "owner", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/system", ownerToken, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("system status = %d body=%s", rec.Code, rec.Body.String())
	}
	var first struct {
		Version               string                          `json:"version"`
		CPUCores              int                             `json:"cpu_cores"`
		CPUUsage              float64                         `json:"cpu_usage"`
		TotalUser             int64                           `json:"total_user"`
		OnlineUsers           int64                           `json:"online_users"`
		IncomingBandwidth     int64                           `json:"incoming_bandwidth"`
		OutgoingBandwidth     int64                           `json:"outgoing_bandwidth"`
		PanelTotalBandwidth   int64                           `json:"panel_total_bandwidth"`
		IncomingBandwidthRate int64                           `json:"incoming_bandwidth_speed"`
		OutgoingBandwidthRate int64                           `json:"outgoing_bandwidth_speed"`
		XrayRunning           bool                            `json:"xray_running"`
		XrayVersion           *string                         `json:"xray_version"`
		LastTelegramError     *string                         `json:"last_telegram_error"`
		CPUHistory            []systemapp.HistoryEntry        `json:"cpu_history"`
		NetworkHistory        []systemapp.NetworkHistoryEntry `json:"network_history"`
		PersonalUsage         systemapp.PersonalUsageStats    `json:"personal_usage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.Version != systemapp.DefaultVersion ||
		first.CPUCores != 8 ||
		first.CPUUsage != 11 ||
		first.TotalUser != 3 ||
		first.OnlineUsers != 2 ||
		first.IncomingBandwidth != 111 ||
		first.OutgoingBandwidth != 222 ||
		first.PanelTotalBandwidth != 333 ||
		first.IncomingBandwidthRate != 701 ||
		first.OutgoingBandwidthRate != 901 ||
		!first.XrayRunning ||
		first.XrayVersion == nil ||
		*first.XrayVersion != "25.1.0" ||
		first.LastTelegramError != nil ||
		len(first.CPUHistory) != 1 ||
		len(first.NetworkHistory) != 1 ||
		first.PersonalUsage.TotalUsers != 1 {
		t.Fatalf("unexpected first system response: %#v", first)
	}

	if _, err := db.Exec(`UPDATE nodes SET status = 'error' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/system", sellerToken, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("seller system status = %d body=%s", rec.Code, rec.Body.String())
	}
	var second struct {
		TotalUser     int64                        `json:"total_user"`
		UsersLimited  int64                        `json:"users_limited"`
		XrayRunning   bool                         `json:"xray_running"`
		XrayVersion   *string                      `json:"xray_version"`
		CPUHistory    []systemapp.HistoryEntry     `json:"cpu_history"`
		PersonalUsage systemapp.PersonalUsageStats `json:"personal_usage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.TotalUser != 2 ||
		second.UsersLimited != 1 ||
		second.XrayRunning ||
		second.XrayVersion != nil ||
		len(second.CPUHistory) != 2 ||
		second.PersonalUsage.TotalUsers != 2 {
		t.Fatalf("unexpected second system response: %#v", second)
	}
}
