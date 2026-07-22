//go:build cgo

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
)

type fakeRuntimeDetector struct {
	info systemapp.RuntimeInfo
}

func (r fakeRuntimeDetector) Info() systemapp.RuntimeInfo {
	return r.info
}

type fakeUpdateChecker struct{}

func (fakeUpdateChecker) Status(_ context.Context, repo string, current *string, channel string) systemapp.UpdateStatus {
	releaseTag := "v0.2.0"
	devTag := "dev-abcdef0"
	latestRelease := systemapp.ReleaseInfo{"tag": releaseTag, "name": "v0.2.0"}
	latestDev := systemapp.ReleaseInfo{"tag": devTag, "sha": "abcdef0123456789", "branch": "dev"}
	target := releaseTag
	if channel == "dev" {
		target = devTag
	}
	return systemapp.UpdateStatus{
		Repo:          repo,
		Current:       current,
		Channel:       firstTestString(channel, systemapp.InferUpdateChannel(current)),
		Available:     systemapp.IsDifferentVersion(current, &target),
		Target:        &target,
		LatestRelease: &latestRelease,
		LatestDev:     &latestDev,
		CheckedAt:     1_780_000_000,
	}
}

type recordingScheduler struct {
	mu   sync.Mutex
	args [][]string
}

func (s *recordingScheduler) Schedule(args []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.args = append(s.args, append([]string(nil), args...))
	return nil
}

func (s *recordingScheduler) ScheduleWithProgress(args []string, onOutput func(string), onDone func(error)) error {
	if err := s.Schedule(args); err != nil {
		return err
	}
	if onOutput != nil {
		onOutput("Downloading Rebecca binary 42%")
		onOutput("Restarting Rebecca service")
	}
	return nil
}

func (s *recordingScheduler) snapshot() [][]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([][]string, len(s.args))
	for i := range s.args {
		result[i] = append([]string(nil), s.args[i]...)
	}
	return result
}

func TestMaintenanceInfoBinaryAndDockerMock(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "owner", "pass123")
	tag := "dev-1234567"
	server.maintenance = systemapp.NewMaintenanceServiceWithDeps(
		fakeRuntimeDetector{info: systemapp.RuntimeInfo{
			Mode:        "binary",
			InstallMode: "binary",
			Service:     "rebecca",
			Image:       "rebecca-server (binary)",
			Tag:         &tag,
			Channel:     "dev",
			Binary:      map[string]any{"tag": tag, "install_mode": "binary"},
		}},
		fakeUpdateChecker{},
		&recordingScheduler{},
	)

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/maintenance/info", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("maintenance info status=%d body=%s", rec.Code, rec.Body.String())
	}
	var info struct {
		Panel struct {
			Mode        string                  `json:"mode"`
			InstallMode string                  `json:"install_mode"`
			Service     string                  `json:"service"`
			Image       string                  `json:"image"`
			Tag         *string                 `json:"tag"`
			Channel     string                  `json:"channel"`
			Update      *systemapp.UpdateStatus `json:"update"`
		} `json:"panel"`
		Node       any                    `json:"node"`
		NodeUpdate systemapp.UpdateStatus `json:"node_update"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Panel.Mode != "binary" ||
		info.Panel.InstallMode != "binary" ||
		info.Panel.Service != "rebecca" ||
		info.Panel.Image != "rebecca-server (binary)" ||
		info.Panel.Tag == nil ||
		*info.Panel.Tag != tag ||
		info.Panel.Channel != "dev" ||
		info.Panel.Update == nil ||
		info.Panel.Update.Target == nil ||
		*info.Panel.Update.Target != "dev-abcdef0" ||
		info.Node != nil ||
		info.NodeUpdate.Repo != "rebeccapanel/Rebecca-node" {
		t.Fatalf("unexpected maintenance info: %#v", info)
	}

	server.maintenance = systemapp.NewMaintenanceServiceWithDeps(
		fakeRuntimeDetector{info: systemapp.RuntimeInfo{
			Mode:        "docker",
			InstallMode: "docker",
			Service:     "rebecca",
			Image:       "rebeccapanel/rebecca",
			Channel:     "unknown",
			Binary:      map[string]any{},
		}},
		fakeUpdateChecker{},
		&recordingScheduler{},
	)
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/maintenance/info", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("docker maintenance info status=%d body=%s", rec.Code, rec.Body.String())
	}
	var dockerInfo struct {
		Panel struct {
			Mode string `json:"mode"`
		} `json:"panel"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &dockerInfo); err != nil {
		t.Fatal(err)
	}
	if dockerInfo.Panel.Mode != "docker" {
		t.Fatalf("expected docker mode, got %#v", dockerInfo)
	}
}

func TestMaintenanceActionsAcceptedAndValidated(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleSudo, adminapp.StatusActive)
	token := adminBearerToken(t, server, "owner", "pass123")
	scheduler := &recordingScheduler{}
	server.maintenance = systemapp.NewMaintenanceServiceWithDeps(
		fakeRuntimeDetector{info: systemapp.RuntimeInfo{Mode: "binary", InstallMode: "binary", Channel: "latest", Binary: map[string]any{}}},
		fakeUpdateChecker{},
		scheduler,
	)

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/update", token, `{"channel":"dev"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", rec.Code, rec.Body.String())
	}
	var updateResponse struct {
		Status    string                                  `json:"status"`
		Operation systemapp.MaintenanceOperationSnapshot `json:"operation"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updateResponse); err != nil {
		t.Fatal(err)
	}
	if updateResponse.Status != "accepted" || updateResponse.Operation.Action != "update" || updateResponse.Operation.Progress == nil || *updateResponse.Operation.Progress != 42 {
		t.Fatalf("unexpected update operation response: %#v", updateResponse)
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/maintenance/status", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("maintenance status=%d body=%s", rec.Code, rec.Body.String())
	}
	var status systemapp.MaintenanceOperationSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Action != "update" || status.Progress == nil || *status.Progress != 42 {
		t.Fatalf("unexpected maintenance status: %#v", status)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/restart", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("restart status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/soft-reload", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("soft reload status=%d body=%s", rec.Code, rec.Body.String())
	}
	args := scheduler.snapshot()
	if len(args) != 3 ||
		!equalStringSlices(args[0], []string{"update", "--dev"}) ||
		!equalStringSlices(args[1], []string{"restart", "-n"}) ||
		!equalStringSlices(args[2], []string{"restart", "-n"}) {
		t.Fatalf("unexpected scheduled args: %#v", args)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/update", token, `{"channel":"nightly"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid channel status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/update", token, `{"version":"bad version"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid version status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMaintenanceRequiresSudoAndBinaryForActions(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	standardToken := adminBearerToken(t, server, "seller", "pass123")
	ownerToken := adminBearerToken(t, server, "owner", "pass123")
	server.maintenance = systemapp.NewMaintenanceServiceWithDeps(
		fakeRuntimeDetector{info: systemapp.RuntimeInfo{Mode: "docker", InstallMode: "docker", Channel: "unknown", Binary: map[string]any{}}},
		fakeUpdateChecker{},
		&recordingScheduler{},
	)

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/maintenance/info", standardToken, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard info status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/update", ownerToken, `{}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("docker update status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/maintenance/restart", ownerToken, `{}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("docker restart status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func equalStringSlices(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func firstTestString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
