package outboundsub

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestParseSubscriptionBodyVLESS(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	const suites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
	body := []byte("vless://11111111-1111-4111-8111-111111111111@example.com:443?type=ws&security=tls&host=edge.example.com&path=%2Fws&sni=sni.example.com&fp=chrome&cs=" + url.QueryEscape(suites) + "&pcs=" + pin + "&vcn=cert.example.com#Edge")
	outbounds, identities, err := ParseSubscriptionBody(body)
	if err != nil {
		t.Fatalf("ParseSubscriptionBody() error = %v", err)
	}
	if len(outbounds) != 1 || len(identities) != 1 {
		t.Fatalf("got outbounds=%d identities=%d", len(outbounds), len(identities))
	}
	ob := outbounds[0]
	if ob["protocol"] != "vless" || ob["tag"] != "Edge" {
		t.Fatalf("unexpected outbound: %#v", ob)
	}
	settings := ob["settings"].(map[string]any)
	vnext := settings["vnext"].([]any)
	server := vnext[0].(map[string]any)
	if server["address"] != "example.com" || server["port"] != 443 {
		t.Fatalf("unexpected vnext server: %#v", server)
	}
	stream := ob["streamSettings"].(map[string]any)
	if stream["network"] != "ws" || stream["security"] != "tls" {
		t.Fatalf("unexpected stream: %#v", stream)
	}
	tls := stream["tlsSettings"].(map[string]any)
	if tls["serverName"] != "sni.example.com" || tls["fingerprint"] != "unsafe" || tls["cipherSuites"] != suites {
		t.Fatalf("unexpected tls settings: %#v", tls)
	}
	if tls["pinnedPeerCertSha256"] != pin || tls["verifyPeerCertByName"] != "cert.example.com" {
		t.Fatalf("new TLS verification settings were not parsed: %#v", tls)
	}
}

func TestParseSubscriptionBodyBase64AndStableTags(t *testing.T) {
	payload := strings.Join([]string{
		"trojan://secret@example.net:443?type=tcp&security=tls&sni=example.net#First",
		"ss://YWVzLTEyOC1nY206cGFzcw==@example.org:8388#Second",
	}, "\n")
	encoded := base64.StdEncoding.EncodeToString([]byte(payload))
	outbounds, identities, err := ParseSubscriptionBody([]byte(encoded))
	if err != nil {
		t.Fatalf("ParseSubscriptionBody() error = %v", err)
	}
	if len(outbounds) != 2 || len(identities) != 2 {
		t.Fatalf("got outbounds=%d identities=%d", len(outbounds), len(identities))
	}
	assigned := assignStableTags(outbounds, identities, map[string]string{identities[0]: "fixed-tag"}, nil, 7, "sub7-")
	if assigned[0] != "fixed-tag" {
		t.Fatalf("assigned[0]=%q", assigned[0])
	}
	if !strings.HasPrefix(assigned[1], "sub7-") {
		t.Fatalf("assigned[1]=%q", assigned[1])
	}
}

func TestParseTrojanPreservesFullDecodedUserInfoPassword(t *testing.T) {
	for _, link := range []string{
		"trojan://pa%3Ass%40word@example.com:443?security=tls#encoded",
		"trojan://pa:ss%40word@example.com:443?security=tls#legacy-userpass",
	} {
		result, err := ParseLink(link)
		if err != nil {
			t.Fatalf("ParseLink(%q): %v", link, err)
		}
		server := result.Outbound["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
		if server["password"] != "pa:ss@word" {
			t.Fatalf("Trojan password was truncated: got=%#v outbound=%#v", server["password"], result.Outbound)
		}
		if !strings.Contains(result.Identity, "trojan://pa:ss@word@example.com:443?") {
			t.Fatalf("Trojan identity lost the decoded password: %q", result.Identity)
		}
	}
}

func TestParseLinkRejectsMissingTrustBoundaryFieldsWithoutPanicking(t *testing.T) {
	validVMess := map[string]any{
		"add": "example.com", "id": "11111111-1111-4111-8111-111111111111", "port": 443,
	}
	vmessLink := func(overrides map[string]any) string {
		payload := map[string]any{}
		for key, value := range validVMess {
			payload[key] = value
		}
		for key, value := range overrides {
			if value == nil {
				delete(payload, key)
			} else {
				payload[key] = value
			}
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		return "vmess://" + base64.RawStdEncoding.EncodeToString(raw)
	}

	for _, link := range []string{
		"vless://example.com:443?type=ws",
		"vless://@example.com:443?type=ws",
		"vless://11111111-1111-4111-8111-111111111111@?type=ws",
		"trojan://example.com:443?security=tls",
		"trojan://secret@?security=tls",
		"wireguard://wg.example.com:51820?publickey=peer",
		"wireguard://secret@?publickey=peer",
		vmessLink(map[string]any{"add": nil}),
		vmessLink(map[string]any{"id": nil}),
		vmessLink(map[string]any{"port": 0}),
		vmessLink(map[string]any{"port": 65536}),
	} {
		if _, err := ParseLink(link); err == nil {
			t.Fatalf("malformed known-scheme link was accepted: %s", link)
		}
	}

	wireguard, err := ParseLink("wireguard://wg.example.com:51820?privatekey=fallback-secret&publickey=peer")
	if err != nil {
		t.Fatalf("WireGuard query secret fallback failed: %v", err)
	}
	if wireguard.Outbound["settings"].(map[string]any)["secretKey"] != "fallback-secret" {
		t.Fatalf("WireGuard query secret fallback was lost: %#v", wireguard.Outbound)
	}
}

func TestMergeOutbounds(t *testing.T) {
	cfg := map[string]any{"outbounds": []any{map[string]any{"tag": "direct", "protocol": "freedom"}}}
	merged := MergeOutbounds(cfg, []any{map[string]any{"tag": "pre"}}, []any{map[string]any{"tag": "post"}})
	raw, _ := json.Marshal(merged["outbounds"])
	got := string(raw)
	if !strings.Contains(got, `"pre"`) || !strings.Contains(got, `"direct"`) || !strings.Contains(got, `"post"`) {
		t.Fatalf("merged outbounds = %s", got)
	}
	if len(cfg["outbounds"].([]any)) != 1 {
		t.Fatalf("MergeOutbounds mutated original config")
	}
}

func TestParseVLESSXHTTPPreservesEncryptionRealityAndExtra(t *testing.T) {
	const encryption = "mlkem768x25519plus.native.0rtt.100-111-1111.75-0-111.50-0-3333.ptjHQxBQxTJ9MWr2cd5qWIflBSACHOevTauCQwa_71U"
	extra := url.Values{}
	extra.Set("type", "xhttp")
	extra.Set("security", "reality")
	extra.Set("encryption", encryption)
	extra.Set("flow", "xtls-rprx-vision")
	extra.Set("path", "/x http")
	extra.Set("host", "edge.example.com")
	extra.Set("mode", "packet-up")
	extra.Set("pbk", "public+key")
	extra.Set("sid", "01234567")
	extra.Set("spx", "/spider+x")
	extra.Set("extra", `{"sessionIDPlacement":"header","sessionIDKey":"X-Session","uplinkHTTPMethod":"POST","xPaddingBytes":"100-1000","headers":{"Host":"must-not-survive","X-Client":"value"},"downloadSettings":{"address":"down.example.com","port":8443,"network":"xhttp","security":"tls","xhttpSettings":{"path":"/down"}}}`)
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?" + extra.Encode() + "#Edge%2B%E2%9C%93"
	result, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outbound["tag"] != "Edge+✓" {
		t.Fatalf("fragment decoded incorrectly: %#v", result.Outbound["tag"])
	}
	settings := result.Outbound["settings"].(map[string]any)
	user := settings["vnext"].([]any)[0].(map[string]any)["users"].([]any)[0].(map[string]any)
	if user["encryption"] != encryption || user["flow"] != "xtls-rprx-vision" {
		t.Fatalf("VLESS user options were not preserved: %#v", user)
	}
	stream := result.Outbound["streamSettings"].(map[string]any)
	xhttp := stream["xhttpSettings"].(map[string]any)
	for key, want := range map[string]any{
		"path": "/x http", "mode": "packet-up", "sessionIDPlacement": "header",
		"sessionIDKey": "X-Session", "uplinkHTTPMethod": "POST", "xPaddingBytes": "100-1000",
	} {
		if got := xhttp[key]; got != want {
			t.Fatalf("xhttp %s=%#v want %#v; all=%#v", key, got, want, xhttp)
		}
	}
	headers := xhttp["headers"].(map[string]any)
	if headers["X-Client"] != "value" || headers["Host"] != nil {
		t.Fatalf("XHTTP headers did not keep custom values while filtering Host: %#v", headers)
	}
	download := xhttp["downloadSettings"].(map[string]any)
	if download["address"] != "down.example.com" || download["port"] != float64(8443) {
		t.Fatalf("XHTTP downloadSettings were lost: %#v", download)
	}
	reality := stream["realitySettings"].(map[string]any)
	if reality["publicKey"] != "public+key" || reality["spiderX"] != "/spider+x" {
		t.Fatalf("Reality values were corrupted: %#v", reality)
	}
}

func TestParseVMessXHTTPUsesTypeAsModeAndExtra(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"v": "2", "ps": "vmess", "add": "example.com", "port": "443",
		"id": "11111111-1111-4111-8111-111111111111", "aid": "0", "net": "xhttp",
		"type": "stream-up", "path": "/x", "host": "edge.example.com",
		"extra": map[string]any{"sessionPlacement": "query", "sessionKey": "sid", "uplinkChunkSize": "1024-2048"},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := ParseLink("vmess://" + base64.StdEncoding.EncodeToString(payload))
	if err != nil {
		t.Fatal(err)
	}
	xhttp := result.Outbound["streamSettings"].(map[string]any)["xhttpSettings"].(map[string]any)
	if xhttp["mode"] != "stream-up" || xhttp["sessionIDPlacement"] != "query" || xhttp["sessionIDKey"] != "sid" || xhttp["uplinkChunkSize"] != "1024-2048" {
		t.Fatalf("VMess XHTTP options were not preserved: %#v", xhttp)
	}
}

func TestParseVMessTLSCipherSuites(t *testing.T) {
	const suites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
	payload, err := json.Marshal(map[string]any{
		"v": "2", "ps": "vmess", "add": "example.com", "port": "443",
		"id": "11111111-1111-4111-8111-111111111111", "net": "tcp", "tls": "tls", "cs": suites,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := ParseLink("vmess://" + base64.StdEncoding.EncodeToString(payload))
	if err != nil {
		t.Fatal(err)
	}
	tls := result.Outbound["streamSettings"].(map[string]any)["tlsSettings"].(map[string]any)
	if tls["cipherSuites"] != suites || tls["fingerprint"] != "unsafe" {
		t.Fatalf("VMess cipherSuites were not preserved: %#v", tls)
	}
}

func TestParseShadowsocksSIP002IPv6PluginAndFragments(t *testing.T) {
	modern := "ss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:p@ss+word")) + "@[2001:db8::1]:8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dedge.example.com#%E2%9C%93%2Bplus"
	result, err := ParseLink(modern)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outbound["tag"] != "✓+plus" {
		t.Fatalf("modern fragment decoded incorrectly: %#v", result.Outbound["tag"])
	}
	server := result.Outbound["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
	if server["address"] != "2001:db8::1" || server["password"] != "p@ss+word" {
		t.Fatalf("modern SIP002 values were corrupted: %#v", server)
	}
	stream := result.Outbound["streamSettings"].(map[string]any)
	if stream["tcpSettings"].(map[string]any)["header"].(map[string]any)["type"] != "http" {
		t.Fatalf("SIP003 HTTP obfs was lost: %#v", stream)
	}

	legacyCore := base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret@[2001:db8::2]:8389"))
	legacy, err := ParseLink("ss://" + legacyCore + "#%E2%9C%93%2Blegacy")
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Outbound["tag"] != "✓+legacy" {
		t.Fatalf("legacy fragment decoded incorrectly: %#v", legacy.Outbound["tag"])
	}
}

func TestV2rayNShadowsocksPreservesNativeTLSAndFinalMask(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	link := EncodeV2rayNShadowsocks(V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Remarks: "SS TLS", Address: "ss.example.com", Port: 443,
		Password: "secret", Network: "ws", StreamSecurity: "tls", SNI: "sni.example.com",
		ALPN: "h2,http/1.1", Fingerprint: "chrome", CertSHA: pin, MuxEnabled: true,
		FinalMask:      `{"tcp":[{"type":"fragment","settings":{"length":"3-5"}}]}`,
		ProtocolExtra:  V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
		TransportExtra: V2rayNShadowsocksTransportExtra{Host: "edge.example.com", Path: "/ss", Heartbeat: 30},
	})
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(link, "v2rayn://shadowsocks/"))
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(payload, &wire); err != nil || wire["ConfigType"] != float64(3) || wire["ConfigVersion"] != float64(4) || wire["StreamSecurity"] != "tls" || wire["ProtoExtraObj"].(map[string]any)["SsMethod"] != "aes-256-gcm" {
		t.Fatalf("v2rayN wire payload mismatch: payload=%#v err=%v", wire, err)
	}
	result, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	server := result.Outbound["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
	stream := result.Outbound["streamSettings"].(map[string]any)
	tls := stream["tlsSettings"].(map[string]any)
	ws := stream["wsSettings"].(map[string]any)
	finalMask := stream["finalmask"].(map[string]any)
	mux := result.Outbound["mux"].(map[string]any)
	if server["method"] != "aes-256-gcm" || server["password"] != "secret" || stream["network"] != "ws" || stream["security"] != "tls" {
		t.Fatalf("native Shadowsocks profile was downgraded: %#v", result.Outbound)
	}
	if tls["serverName"] != "sni.example.com" || tls["fingerprint"] != "chrome" || tls["pinnedPeerCertSha256"] != pin || ws["path"] != "/ss" || ws["host"] != "edge.example.com" || ws["heartbeatPeriod"] != 30 || len(finalMask) == 0 || mux["enabled"] != true {
		t.Fatalf("native Shadowsocks stream settings were lost: %#v", stream)
	}
}

func TestV2rayNShadowsocksPreservesReality(t *testing.T) {
	link := EncodeV2rayNShadowsocks(V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "ss.example.com", Port: 443,
		Password: "secret", Network: "raw", StreamSecurity: "reality", SNI: "sni.example.com",
		Fingerprint: "chrome", PublicKey: "public-key", ShortID: "abcd", SpiderX: "/", MLDSA65Verify: "verify-key",
		ProtocolExtra: V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
	})
	result, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	reality := result.Outbound["streamSettings"].(map[string]any)["realitySettings"].(map[string]any)
	if reality["publicKey"] != "public-key" || reality["shortId"] != "abcd" || reality["spiderX"] != "/" || reality["mldsa65Verify"] != "verify-key" {
		t.Fatalf("Shadowsocks Reality settings were lost: %#v", reality)
	}
}

func TestV2rayNShadowsocks2022KeepsCombinedPassword(t *testing.T) {
	link := EncodeV2rayNShadowsocks(V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "ss.example.com", Port: 443,
		Password: "server-key:client-key", Network: "raw", StreamSecurity: "tls",
		ProtocolExtra: V2rayNShadowsocksProtocolExtra{Method: "2022-blake3-aes-128-gcm"},
	})
	result, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	server := result.Outbound["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
	if server["method"] != "2022-blake3-aes-128-gcm" || server["password"] != "server-key:client-key" {
		t.Fatalf("SS2022 credentials were corrupted: %#v", server)
	}
}

func TestV2rayNShadowsocksRejectsClientTransportDowngrade(t *testing.T) {
	link := EncodeV2rayNShadowsocks(V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "ss.example.com", Port: 443,
		Password: "secret", Network: "hysteria",
		ProtocolExtra: V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
	})
	if _, err := DecodeV2rayNShadowsocks(link); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("lossy client transport was accepted: %v", err)
	}
}

func TestParseHysteria2PreservesTLSObfsPortsAndIPv6(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	result, err := ParseLink("hysteria2://p%40ss%2Bword@[2001:db8::7]:443,20000-30000/?sni=hy.example.com&insecure=1&obfs=salamander&obfs-password=mask%2Bkey&pinSHA256=" + pin + "#Hy%2B%E2%9C%93")
	if err != nil {
		t.Fatal(err)
	}
	if result.Outbound["tag"] != "Hy+✓" {
		t.Fatalf("Hysteria fragment decoded incorrectly: %#v", result.Outbound["tag"])
	}
	settings := result.Outbound["settings"].(map[string]any)
	if settings["address"] != "2001:db8::7" || settings["version"] != 2 {
		t.Fatalf("unexpected Hysteria settings: %#v", settings)
	}
	stream := result.Outbound["streamSettings"].(map[string]any)
	tls := stream["tlsSettings"].(map[string]any)
	if _, exists := tls["allowInsecure"]; exists || tls["pinnedPeerCertSha256"] != pin {
		t.Fatalf("Hysteria Xray TLS settings did not replace insecure with its certificate pin: %#v", tls)
	}
	finalMask := stream["finalmask"].(map[string]any)
	udp := finalMask["udp"].([]any)[0].(map[string]any)
	if udp["type"] != "salamander" || udp["settings"].(map[string]any)["password"] != "mask+key" {
		t.Fatalf("Hysteria obfs was lost: %#v", finalMask)
	}
	ports := finalMask["quicParams"].(map[string]any)["udpHop"].(map[string]any)["ports"]
	if ports != "443,20000-30000" {
		t.Fatalf("Hysteria port hopping was lost: %#v", finalMask)
	}
	if _, err := ParseLink("hysteria://secret@example.com:443"); err == nil {
		t.Fatal("legacy Hysteria URI must not be mislabeled as Xray Hysteria 2")
	}
	gecko, err := ParseLink("hysteria2://secret@example.com:443?obfs=gecko&obfs-password=mask")
	if err != nil {
		t.Fatal(err)
	}
	geckoMask := gecko.Outbound["streamSettings"].(map[string]any)["finalmask"].(map[string]any)["udp"].([]any)[0].(map[string]any)
	geckoSettings := geckoMask["settings"].(map[string]any)
	if geckoMask["type"] != "salamander" || geckoSettings["packetSize"] != "512-1200" || geckoSettings["password"] != "mask" {
		t.Fatalf("Gecko was not mapped to the Xray FinalMask representation: %#v", geckoMask)
	}
}

func TestParseHysteria2PreservesDecodedUserPasswordAuthAndIdentity(t *testing.T) {
	for _, tc := range []struct {
		link string
		auth string
	}{
		{link: "hysteria2://alice:secret@example.com:443/#userpass", auth: "alice:secret"},
		{link: "hysteria2://alice%3Asec%2Bret@example.com:443/#encoded", auth: "alice:sec+ret"},
	} {
		result, err := ParseLink(tc.link)
		if err != nil {
			t.Fatalf("ParseLink(%q): %v", tc.link, err)
		}
		stream := result.Outbound["streamSettings"].(map[string]any)
		settings := stream["hysteriaSettings"].(map[string]any)
		if settings["auth"] != tc.auth {
			t.Fatalf("Hysteria auth was truncated: got=%#v want=%q", settings["auth"], tc.auth)
		}
		if !strings.Contains(result.Identity, ":"+tc.auth+"@example.com:443?") {
			t.Fatalf("Hysteria identity lost decoded auth: %q", result.Identity)
		}
	}
}

func TestParseLinkRejectsInsecureTLSWithoutValidCertificatePins(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	colonPin := strings.Join([]string{
		"fe", "dc", "ba", "98", "76", "54", "32", "10",
		"fe", "dc", "ba", "98", "76", "54", "32", "10",
		"fe", "dc", "ba", "98", "76", "54", "32", "10",
		"fe", "dc", "ba", "98", "76", "54", "32", "10",
	}, ":")
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&insecure=1"
	if _, err := ParseLink(base); err == nil || !strings.Contains(err.Error(), "requires certificate pinning") {
		t.Fatalf("insecure Xray link accepted without a certificate pin: link=%s err=%v", base, err)
	}
	vmessInsecure, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "allowInsecure": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    base,
		"Trojan":   "trojan://secret@example.com:443?security=tls&insecure=1",
		"Hysteria": "hysteria2://secret@example.com:443/?insecure=1",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessInsecure),
	} {
		if _, err := ParseLink(link); err == nil || !strings.Contains(err.Error(), "peer-name verification") {
			t.Fatalf("insecure %s link accepted without pin/vcn: link=%s err=%v", name, link, err)
		}
	}
	vmessVCN, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "allowInsecure": 1, "verifyPeerCertByName": "cert.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    base + "&vcn=cert.example.com",
		"Trojan":   "trojan://secret@example.com:443?security=tls&insecure=1&verifyPeerCertByName=cert.example.com",
		"Hysteria": "hysteria2://secret@example.com:443/?insecure=1&vcn=cert.example.com",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessVCN),
	} {
		result, err := ParseLink(link)
		if err != nil {
			t.Fatalf("insecure %s link with vcn was rejected: %v", name, err)
		}
		tls := result.Outbound["streamSettings"].(map[string]any)["tlsSettings"].(map[string]any)
		if tls["verifyPeerCertByName"] != "cert.example.com" || tls["allowInsecure"] != nil {
			t.Fatalf("%s vcn was not preserved safely: %#v", name, tls)
		}
	}
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "pinSHA256": "abcd",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    strings.Replace(base, "&insecure=1", "&pcs=abcd", 1),
		"Trojan":   "trojan://secret@example.com:443?security=tls&pcs=abcd",
		"Hysteria": "hysteria2://secret@example.com:443/?pinSHA256=abcd",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
	} {
		if _, err := ParseLink(link); err == nil || !strings.Contains(err.Error(), "64 hexadecimal") {
			t.Fatalf("malformed %s pin without insecure was accepted: link=%s err=%v", name, link, err)
		}
	}
	link := base + "&pcs=" + url.QueryEscape(pin+","+colonPin)
	result, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	tls := result.Outbound["streamSettings"].(map[string]any)["tlsSettings"].(map[string]any)
	if tls["pinnedPeerCertSha256"] != pin+","+colonPin {
		t.Fatalf("CSV/colon-separated pins were not preserved: %#v", tls)
	}
	validWithoutInsecure := strings.Replace(link, "&insecure=1", "", 1)
	if _, err := ParseLink(validWithoutInsecure); err != nil {
		t.Fatalf("valid certificate pins without insecure were rejected: %v", err)
	}
}

func TestParseHysteria2DefaultsMissingPortAndKeepsLegacyMportAlias(t *testing.T) {
	for _, link := range []string{
		"hysteria2://secret@example.com/?sni=example.com#domain",
		"hy2://secret@[2001:db8::8]/?sni=example.com#ipv6",
		"hysteria2://example.net/?sni=example.net&ech=AEL%2BECH%2FCONFIG%3D%3D#no-auth",
		"hy2://[2001:db8::9]/?sni=example.com#no-auth-ipv6",
	} {
		result, err := ParseLink(link)
		if err != nil {
			t.Fatalf("ParseLink(%q): %v", link, err)
		}
		settings := result.Outbound["settings"].(map[string]any)
		if settings["port"] != 443 {
			t.Fatalf("default port=%#v for %s", settings["port"], link)
		}
		hysteria := result.Outbound["streamSettings"].(map[string]any)["hysteriaSettings"].(map[string]any)
		if !strings.Contains(link, "secret") && len(hysteria) != 2 {
			t.Fatalf("no-auth Hysteria link emitted an auth field: %#v", hysteria)
		}
		if strings.Contains(link, "ech=") {
			tls := result.Outbound["streamSettings"].(map[string]any)["tlsSettings"].(map[string]any)
			if tls["echConfigList"] != "AEL+ECH/CONFIG==" {
				t.Fatalf("Hysteria ECH was lost: %#v", tls)
			}
		}
	}
	legacy, err := ParseLink("hysteria2://secret@example.com:443/?mport=20000-30000")
	if err != nil {
		t.Fatal(err)
	}
	finalMask := legacy.Outbound["streamSettings"].(map[string]any)["finalmask"].(map[string]any)
	if got := finalMask["quicParams"].(map[string]any)["udpHop"].(map[string]any)["ports"]; got != "20000-30000" {
		t.Fatalf("legacy mport alias was not preserved: %#v", finalMask)
	}
	for _, malformed := range []string{
		"hysteria2://secret@example.com:443,/?sni=example.com",
		"hysteria2://secret@example.com:6000-5000/?sni=example.com",
		"hysteria2://secret@2001:db8::1:443/?sni=example.com",
		"hysteria2://secret@example.com/?pinSHA256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef%2C0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	} {
		if _, err := ParseLink(malformed); err == nil {
			t.Fatalf("malformed Hysteria authority was accepted: %s", malformed)
		}
	}
}

func TestParseLinkValidatesMKCPMTUAndTTI(t *testing.T) {
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none"
	for _, tc := range []struct {
		query string
		ok    bool
	}{
		{query: "&mtu=21&tti=10", ok: true},
		{query: "&mtu=575&tti=20", ok: true},
		{query: "&mtu=576&tti=10", ok: true},
		{query: "&mtu=1460&tti=100", ok: true},
		{query: "&mtu=1500&tti=20", ok: true},
		{query: "&mtu=4294967295&tti=20", ok: true},
		{query: "&mtu=1350&tti=101", ok: true},
		{query: "&mtu=1350&tti=5000", ok: true},
		{query: "&mtu=20&tti=20"},
		{query: "&mtu=4294967296&tti=20"},
		{query: "&mtu=1350&tti=5001"},
	} {
		_, err := ParseLink(base + tc.query)
		if (err == nil) != tc.ok {
			t.Fatalf("ParseLink(%q) err=%v ok=%t", tc.query, err, tc.ok)
		}
	}
	payload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "kcp", "tls": "none", "mtu": uint64(1<<32 - 1), "tti": 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := ParseLink("vmess://" + base64.RawStdEncoding.EncodeToString(payload))
	if err != nil {
		t.Fatalf("VMess canonical uint32 MTU was rejected: %v", err)
	}
	kcp := result.Outbound["streamSettings"].(map[string]any)["kcpSettings"].(map[string]any)
	if kcp["mtu"] != int(1<<32-1) {
		t.Fatalf("VMess canonical MTU was not preserved: %#v", kcp)
	}
}
