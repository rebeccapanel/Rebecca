package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestGeoTemplateFilesFromIndexWithFiles(t *testing.T) {
	var data any
	if err := json.Unmarshal([]byte(`{
		"templates": [
			{
				"name": "standard",
				"files": [
					{"name": "geoip.dat", "url": "https://example.com/geoip.dat"},
					{"name": "geosite.dat", "url": "https://example.com/geosite.dat"}
				]
			}
		]
	}`), &data); err != nil {
		t.Fatal(err)
	}

	files, status, err := geoTemplateFilesFromIndex(data, "standard")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if len(files) != 2 {
		t.Fatalf("files len = %d, want 2", len(files))
	}
	if files[0].Name != "geoip.dat" || files[1].Name != "geosite.dat" {
		t.Fatalf("unexpected files: %#v", files)
	}
}

func TestGeoTemplateFilesFromIndexWithLinks(t *testing.T) {
	var data any
	if err := json.Unmarshal([]byte(`[
		{
			"name": "standard",
			"links": {
				"geoip.dat": "https://example.com/geoip.dat",
				"geosite.dat": "https://example.com/geosite.dat"
			}
		}
	]`), &data); err != nil {
		t.Fatal(err)
	}

	files, status, err := geoTemplateFilesFromIndex(data, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if len(files) != 2 {
		t.Fatalf("files len = %d, want 2", len(files))
	}
}

func TestGeoTemplateFilesFromIndexTemplateNotFound(t *testing.T) {
	var data any
	if err := json.Unmarshal([]byte(`{"templates": [{"name": "standard", "files": []}]}`), &data); err != nil {
		t.Fatal(err)
	}

	_, status, err := geoTemplateFilesFromIndex(data, "missing")
	if err == nil {
		t.Fatal("expected error")
	}
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", status, http.StatusNotFound)
	}
}

func TestSafeGeoFilename(t *testing.T) {
	name, err := safeGeoFilename(`nested\geoip.dat`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "geoip.dat" {
		t.Fatalf("name = %q, want geoip.dat", name)
	}
	if _, err := safeGeoFilename("other.dat"); err == nil {
		t.Fatal("expected invalid filename error")
	}
}
