package api

import (
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

func TestFlattenNodeStaticItemOmitsRuntimeFields(t *testing.T) {
	xrayVersion := "26.5.9"
	nodeVersion := "dev-abc123"
	item := flattenNodeStaticItem(nodecontroller.NodeListItem{
		ID:                 7,
		Name:               "de-1",
		Address:            "192.0.2.7",
		Port:               62050,
		APIPort:            62051,
		Status:             "connected",
		XrayVersion:        &xrayVersion,
		NodeServiceVersion: &nodeVersion,
		CPU: nodecontroller.CPUInfo{
			UsagePercent: 42,
		},
		Transfer: nodecontroller.NetInfo{
			UploadSpeed:   100,
			DownloadSpeed: 200,
		},
	})

	for _, key := range []string{
		"node_service_version",
		"cpu_usage_percent",
		"upload_speed",
		"download_speed",
	} {
		if _, exists := item[key]; exists {
			t.Fatalf("runtime field %q must not be included in a static update", key)
		}
	}
	if item["xray_version"] != &xrayVersion {
		t.Fatalf("persisted xray version was not preserved: %#v", item["xray_version"])
	}
	if item["name"] != "de-1" {
		t.Fatalf("static node fields were not preserved: %#v", item)
	}
}

func TestFlattenNodeLiveItemOmitsUnavailableRuntime(t *testing.T) {
	item := flattenNodeLiveItem(nodecontroller.NodeListItem{
		ID:      7,
		Name:    "de-1",
		Address: "192.0.2.7",
		Status:  "error",
	})
	for _, key := range []string{
		"node_service_version",
		"cpu_usage_percent",
		"upload_speed",
		"download_speed",
	} {
		if _, exists := item[key]; exists {
			t.Fatalf("unavailable runtime field %q must not overwrite cached data", key)
		}
	}
}
