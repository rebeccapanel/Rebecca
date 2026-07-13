package gateway

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed static/dashboard/build/*
var embeddedDashboardBuild embed.FS

type dashboardFiles struct {
	root string
	fs   fs.FS
}

func newDashboardFiles(cfg Config) *dashboardFiles {
	root := normalizeDashboardRoot(cfg.DashboardPath)
	return &dashboardFiles{root: root, fs: embeddedBuildFS()}
}

func embeddedBuildFS() fs.FS {
	sub, err := fs.Sub(embeddedDashboardBuild, "static/dashboard/build")
	if err != nil {
		return embeddedDashboardBuild
	}
	return sub
}

func normalizeDashboardRoot(value string) string {
	value = "/" + strings.Trim(strings.TrimSpace(value), "/")
	if value == "/" {
		return "/dashboard"
	}
	return value
}

func (d *dashboardFiles) matches(r *http.Request) bool {
	if d == nil || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		return false
	}
	cleaned := strings.TrimRight(r.URL.Path, "/")
	return cleaned == d.root ||
		strings.HasPrefix(r.URL.Path, d.root+"/") ||
		r.URL.Path == "/assets" ||
		strings.HasPrefix(r.URL.Path, "/assets/") ||
		r.URL.Path == "/statics" ||
		strings.HasPrefix(r.URL.Path, "/statics/")
}

func (d *dashboardFiles) serve(w http.ResponseWriter, r *http.Request) {
	if d == nil {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == d.root {
		http.Redirect(w, r, d.root+"/login", http.StatusTemporaryRedirect)
		return
	}
	name := ""
	switch {
	case strings.HasPrefix(r.URL.Path, "/statics/"):
		name = strings.TrimPrefix(r.URL.Path, "/")
	case strings.HasPrefix(r.URL.Path, "/assets/"):
		name = strings.TrimPrefix(r.URL.Path, "/")
	case strings.TrimRight(r.URL.Path, "/") == d.root:
		name = "index.html"
	case strings.HasPrefix(r.URL.Path, d.root+"/"):
		name = strings.TrimPrefix(r.URL.Path, d.root+"/")
	default:
		http.NotFound(w, r)
		return
	}
	name = path.Clean(strings.TrimPrefix(name, "/"))
	if name == "." || name == "" {
		name = "index.html"
	}
	staticAsset := strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "statics/")
	if staticAsset && (!fileExists(d.fs, name) || path.Ext(name) == "") {
		http.NotFound(w, r)
		return
	}
	if !fileExists(d.fs, name) || path.Ext(name) == "" {
		name = "index.html"
	}
	content, err := fs.ReadFile(d.fs, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-store")
	}
	http.ServeContent(w, r, path.Base(name), time.Time{}, bytes.NewReader(content))
}

func fileExists(source fs.FS, name string) bool {
	info, err := fs.Stat(source, name)
	return err == nil && !info.IsDir()
}
