package notifications

import (
	"encoding/json"
	"strings"
)

const ServiceWorkerScript = `self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { title: 'Rebecca', body: event.data ? event.data.text() : '' }; }
  var options = {
    body: data.body || '',
    icon: data.icon || '/statics/favicon/android-chrome-192x192.png',
    badge: '/statics/favicon/android-chrome-192x192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Rebecca', options));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      var client = windows[i];
      if (client.url && client.url.indexOf(target) !== -1 && 'focus' in client) { return client.focus(); }
    }
    if (self.clients.openWindow) { return self.clients.openWindow(target); }
  }));
});
`

type manifestIcon struct {
	Src   string `json:"src"`
	Sizes string `json:"sizes"`
	Type  string `json:"type"`
}

type manifest struct {
	Name            string         `json:"name"`
	ShortName       string         `json:"short_name"`
	StartURL        string         `json:"start_url"`
	Scope           string         `json:"scope"`
	Display         string         `json:"display"`
	BackgroundColor string         `json:"background_color"`
	ThemeColor      string         `json:"theme_color"`
	Icons           []manifestIcon `json:"icons"`
}

func ManifestJSON(basename string) ([]byte, error) {
	basename = strings.TrimRight(cleanPageURL(basename), "/")
	return json.Marshal(manifest{
		Name:            "Rebecca",
		ShortName:       "Rebecca",
		StartURL:        basename + "/",
		Scope:           basename + "/",
		Display:         "standalone",
		BackgroundColor: "#ffffff",
		ThemeColor:      "#3B81F6",
		Icons: []manifestIcon{
			{Src: "/statics/favicon/android-chrome-192x192.png", Sizes: "192x192", Type: "image/png"},
			{Src: "/statics/favicon/android-chrome-512x512.png", Sizes: "512x512", Type: "image/png"},
		},
	})
}
