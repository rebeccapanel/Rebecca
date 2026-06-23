package accessinsights

import "testing"

func TestClassifyHost(t *testing.T) {
	cases := map[string]string{
		"www.youtube.com":              "youtube",
		"rr5---sn-abc.googlevideo.com": "youtube",
		"scontent.cdninstagram.com":    "instagram",
		"api.telegram.org":             "telegram",
		"chatgpt.com":                  "openai",
		"raw.githubusercontent.com":    "github",
		"divar.ir":                     "divar",
		"example.ir":                   "iran",
		"unknown-host.example":         "other",
		"8.8.8.8":                      "other",
		"127.0.0.1":                    "local",
		"10.0.0.5":                     "local",
		"192.168.1.1":                  "local",
		"":                             "other",
	}
	for host, want := range cases {
		if got := ClassifyHost(host); got != want {
			t.Errorf("ClassifyHost(%q) = %q, want %q", host, got, want)
		}
	}
}
