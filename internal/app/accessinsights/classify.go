package accessinsights

import (
	"net"
	"strings"
)

// platformRule maps domain suffixes to a platform label. The registry is
// data-driven so new labels can be added without touching the matching logic.
type platformRule struct {
	label    string
	suffixes []string
}

// defaultPlatformRules covers the common platforms the legacy feature labelled.
// Order matters only for overlapping suffixes; the first match wins.
var defaultPlatformRules = []platformRule{
	{"youtube", []string{"youtube.com", "youtu.be", "ytimg.com", "googlevideo.com", "yt3.ggpht.com"}},
	{"google", []string{"google.com", "gstatic.com", "googleapis.com", "ggpht.com", "google-analytics.com", "doubleclick.net", "googlesyndication.com"}},
	{"instagram", []string{"instagram.com", "cdninstagram.com", "ig.me"}},
	{"facebook", []string{"facebook.com", "fbcdn.net", "fb.com", "messenger.com"}},
	{"whatsapp", []string{"whatsapp.com", "whatsapp.net"}},
	{"telegram", []string{"telegram.org", "t.me", "telegram.me", "telesco.pe", "cdn-telegram.org"}},
	{"tiktok", []string{"tiktok.com", "tiktokcdn.com", "byteoversea.com", "ibyteimg.com"}},
	{"snapchat", []string{"snapchat.com", "sc-cdn.net"}},
	{"netflix", []string{"netflix.com", "nflxvideo.net", "nflximg.net"}},
	{"twitter", []string{"twitter.com", "x.com", "twimg.com", "t.co"}},
	{"cloudflare", []string{"cloudflare.com", "cloudflare-dns.com", "cloudflareinsights.com"}},
	{"apple", []string{"apple.com", "icloud.com", "mzstatic.com", "cdn-apple.com"}},
	{"github", []string{"github.com", "githubusercontent.com", "githubassets.com", "ghcr.io"}},
	{"steam", []string{"steampowered.com", "steamstatic.com", "steamcommunity.com"}},
	{"microsoft", []string{"microsoft.com", "windows.net", "live.com", "office.com", "skype.com", "msftncsi.com"}},
	{"openai", []string{"openai.com", "oaistatic.com", "chatgpt.com"}},
	{"discord", []string{"discord.com", "discordapp.com", "discord.gg"}},
	{"linkedin", []string{"linkedin.com", "licdn.com"}},
	{"yahoo", []string{"yahoo.com", "yimg.com"}},
	{"xiaomi", []string{"xiaomi.com", "mi.com", "miui.com"}},
	{"huawei", []string{"huawei.com", "hicloud.com"}},
	{"samsung", []string{"samsung.com", "samsungcloud.com"}},
	{"divar", []string{"divar.ir"}},
	{"eitaa", []string{"eitaa.com"}},
	{"splus", []string{"splus.ir", "soroush-hamrah.ir"}},
	{"neshan", []string{"neshan.org"}},
	{"yektanet", []string{"yektanet.com"}},
}

// ClassifyHost returns a platform label for a destination host. Unknown hosts
// return "other"; private/loopback addresses return "local".
func ClassifyHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimSuffix(host, ".")
	if host == "" {
		return "other"
	}
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateIP(ip) {
			return "local"
		}
		// Bare public IPs are not classified by suffix.
		return "other"
	}
	for _, rule := range defaultPlatformRules {
		for _, suffix := range rule.suffixes {
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				return rule.label
			}
		}
	}
	if strings.HasSuffix(host, ".ir") {
		return "iran"
	}
	return "other"
}

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return true
	}
	return false
}
