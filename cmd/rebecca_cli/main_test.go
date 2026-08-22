package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/migrations"
	_ "modernc.org/sqlite"
)

func TestRunRejectsUnknownCommands(t *testing.T) {
	app := &cli{}
	for _, args := range [][]string{{"unknown"}, {"migrate", "unknown"}} {
		err := app.run(args)
		if err == nil || !strings.Contains(err.Error(), "unknown") {
			t.Fatalf("run(%q) error = %v", args, err)
		}
	}
}

func TestAdminCreateUsesRootForTerminalAndInteractiveTUI(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "admins.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := migrations.RunMigrations(context.Background(), db, "sqlite"); err != nil {
		t.Fatal(err)
	}

	app := &cli{db: db, dialect: "sqlite", stdin: bufio.NewReader(strings.NewReader("tui-created\n1\n"))}
	if err := app.adminCreate([]string{"--username", "terminal-created", "--role", "standard", "--password", "secret1", "--json"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envAdminPassword, "secret2")
	if err := app.adminCreate(nil); err != nil {
		t.Fatal(err)
	}

	for _, username := range []string{"terminal-created", "tui-created"} {
		var createdBy string
		if err := db.QueryRow(`SELECT created_by FROM admins WHERE username = ?`, username).Scan(&createdBy); err != nil {
			t.Fatal(err)
		}
		if createdBy != "root" {
			t.Fatalf("%s created_by = %q, want root", username, createdBy)
		}
	}
}

func TestFinalMaskHostPrecedenceAndShareLinks(t *testing.T) {
	parsed := parseInbounds(map[string]any{"inbounds": []any{map[string]any{
		"tag": "VLESS", "protocol": "vless",
		"streamSettings": map[string]any{"finalmask": map[string]any{
			"udp":        []any{map[string]any{"type": "salamander"}},
			"quicParams": map[string]any{"congestion": "bbr"},
		}},
	}}})
	legacyFragment := sql.NullString{String: "10-20,30-40,tlshello,3", Valid: true}
	legacyNoise := sql.NullString{String: "rand:5-10,20&str:hello,30", Valid: true}
	host := hostInfo{
		MuxEnable:       true,
		FragmentSetting: legacyFragment,
		NoiseSetting:    legacyNoise,
		FinalMask: map[string]any{
			"tcp":        []any{map[string]any{"type": "header-custom"}},
			"quicParams": map[string]any{"debug": true},
		},
	}
	finalMask := effectiveFinalMask(parsed["VLESS"].FinalMask, host)
	tcp := finalMask["tcp"].([]any)
	quic := finalMask["quicParams"].(map[string]any)
	if len(tcp) != 1 || tcp[0].(map[string]any)["type"] != "header-custom" {
		t.Fatalf("host FinalMask was not authoritative: %#v", finalMask)
	}
	if len(finalMask["udp"].([]any)) != 1 || quic["congestion"] != "bbr" || quic["debug"] != true {
		t.Fatalf("inbound FinalMask was not merged: %#v", finalMask)
	}
	if _, exists := finalMask["mux"]; exists {
		t.Fatalf("mux leaked into FinalMask: %#v", finalMask)
	}

	fallback := effectiveFinalMask(nil, hostInfo{FragmentSetting: legacyFragment, NoiseSetting: legacyNoise})
	fragment := fallback["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)
	noise := fallback["udp"].([]any)[0].(map[string]any)["settings"].(map[string]any)["noise"].([]any)
	if fragment["lengths"].([]any)[0] != "10-20" || fragment["delays"].([]any)[0] != "30-40" ||
		fragment["packets"] != "tlshello" || fragment["maxSplit"] != "3" || len(noise) != 2 {
		t.Fatalf("legacy masks were not converted: %#v", fallback)
	}
	if _, exists := noise[0].(map[string]any)["type"]; exists {
		t.Fatalf("random noise used an invalid packet type: %#v", noise[0])
	}

	node := generatedNode{
		Remark: "mask", Address: "example.com", Port: "443", Network: "tcp", TLS: "none",
		Settings:  map[string]any{"id": "00000000-0000-0000-0000-000000000000", "password": "secret"},
		FinalMask: finalMask,
	}
	for name, link := range map[string]string{"vless": buildVLESSLink(node), "trojan": buildTrojanLink(node)} {
		parsedLink, err := url.Parse(link)
		if err != nil {
			t.Fatalf("parse %s link: %v", name, err)
		}
		var got map[string]any
		if err := json.Unmarshal([]byte(parsedLink.Query().Get("fm")), &got); err != nil || len(got) == 0 {
			t.Fatalf("%s fm query is invalid: %#v (%v)", name, got, err)
		}
		if parsedLink.Query().Get("fragment") != "" || parsedLink.Query().Get("noise") != "" {
			t.Fatalf("%s retained legacy mask params: %s", name, link)
		}
	}

	vmessPayload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(buildVMessLink(node), "vmess://"))
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(vmessPayload, &payload); err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["fm"].(map[string]any); !ok {
		t.Fatalf("VMess payload has no FinalMask: %#v", payload)
	}
	if strings.Contains(buildShadowsocksLink(node), "?") {
		t.Fatal("raw Shadowsocks link unexpectedly gained query parameters")
	}
}
