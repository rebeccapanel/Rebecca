package xrayconfig

import (
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
)

const plainPublicTransportWarning = "Xray 26.7.11+ clients refuse links to this inbound on a public address unless the host adds TLS or REALITY or the inbound uses VLESS encryption"

func InboundCompatibilityWarning(inbound map[string]any) string {
	protocol := normalizeProxyProtocol(jsonvalue.String(inbound["protocol"]))
	if protocol != "vless" && protocol != "trojan" {
		return ""
	}
	security := strings.ToLower(strings.TrimSpace(jsonvalue.String(mapValue(inbound["streamSettings"])["security"])))
	if security != "" && security != "none" {
		return ""
	}
	if protocol == "vless" && vlessEncryptionEnabled(mapValue(inbound["settings"])["decryption"]) {
		return ""
	}
	return plainPublicTransportWarning
}
