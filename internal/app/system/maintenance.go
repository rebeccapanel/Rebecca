package system

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const hostOperationDisabledDetail = "This host-level action is available only on binary installations. Migrate this panel to the binary version before using update, restart, runtime, or geo actions from the web UI."

var (
	releaseVersionPattern = regexp.MustCompile(`^v?\d+(?:\.\d+){1,3}(?:[-+._A-Za-z0-9]*)?$`)
	devVersionPattern     = regexp.MustCompile(`^dev-[0-9a-fA-F]{7,40}$`)
)

type MaintenanceError struct {
	Status int
	Detail string
}

func (e MaintenanceError) Error() string {
	return e.Detail
}

type RuntimeInfo struct {
	Mode        string         `json:"mode"`
	InstallMode string         `json:"install_mode"`
	Service     string         `json:"service"`
	Image       string         `json:"image"`
	Tag         *string        `json:"tag"`
	Channel     string         `json:"channel"`
	Python      *string        `json:"python"`
	Go          string         `json:"go"`
	Binary      map[string]any `json:"binary"`
	Update      *UpdateStatus  `json:"update,omitempty"`
}

type ReleaseInfo map[string]any

type UpdateStatus struct {
	Repo          string       `json:"repo"`
	Current       *string      `json:"current"`
	Channel       string       `json:"channel"`
	Available     bool         `json:"available"`
	Target        *string      `json:"target"`
	LatestRelease *ReleaseInfo `json:"latest_release"`
	LatestDev     *ReleaseInfo `json:"latest_dev"`
	CheckedAt     int64        `json:"checked_at"`
	Error         string       `json:"error,omitempty"`
}

type MaintenanceInfo struct {
	Panel      RuntimeInfo  `json:"panel"`
	Node       any          `json:"node"`
	NodeUpdate UpdateStatus `json:"node_update"`
}

type MaintenanceUpdateRequest struct {
	Channel string `json:"channel"`
	Version string `json:"version"`
}

type RuntimeDetector interface {
	Info() RuntimeInfo
}

type UpdateChecker interface {
	Status(ctx context.Context, repo string, current *string, channel string) UpdateStatus
}

type CommandScheduler interface {
	Schedule(args []string) error
}

type ProgressCommandScheduler interface {
	ScheduleWithProgress(args []string, onOutput func(string), onDone func(error)) error
}

type MaintenanceService struct {
	Runtime  RuntimeDetector
	Updates  UpdateChecker
	Commands CommandScheduler
	ops      *MaintenanceOperationStore
}

func NewMaintenanceService() *MaintenanceService {
	return NewMaintenanceServiceWithDeps(DefaultRuntimeDetector{}, NewGitHubUpdateChecker(), DefaultCommandScheduler{})
}

func NewMaintenanceServiceWithDeps(runtimeDetector RuntimeDetector, updateChecker UpdateChecker, scheduler CommandScheduler) *MaintenanceService {
	if runtimeDetector == nil {
		runtimeDetector = DefaultRuntimeDetector{}
	}
	if updateChecker == nil {
		updateChecker = NewGitHubUpdateChecker()
	}
	if scheduler == nil {
		scheduler = DefaultCommandScheduler{}
	}
	return &MaintenanceService{
		Runtime:  runtimeDetector,
		Updates:  updateChecker,
		Commands: scheduler,
		ops:      NewMaintenanceOperationStore(),
	}
}

func (s *MaintenanceService) Info(ctx context.Context) (MaintenanceInfo, error) {
	panel := s.Runtime.Info()
	panel.Update = ptr(s.Updates.Status(ctx, "rebeccapanel/Rebecca", panel.Tag, panel.Channel))
	return MaintenanceInfo{
		Panel:      panel,
		Node:       nil,
		NodeUpdate: s.Updates.Status(ctx, "rebeccapanel/Rebecca-node", nil, ""),
	}, nil
}

func (s *MaintenanceService) Update(_ context.Context, req MaintenanceUpdateRequest) (MaintenanceOperationSnapshot, error) {
	if err := requireBinaryRuntime(s.Runtime.Info()); err != nil {
		return MaintenanceOperationSnapshot{}, err
	}
	args, err := BuildRebeccaUpdateArgs(req.Channel, req.Version)
	if err != nil {
		return MaintenanceOperationSnapshot{}, err
	}
	return s.startOperation("update", args, "Preparing panel update")
}

func (s *MaintenanceService) Restart(context.Context) (MaintenanceOperationSnapshot, error) {
	if err := requireBinaryRuntime(s.Runtime.Info()); err != nil {
		return MaintenanceOperationSnapshot{}, err
	}
	return s.startOperation("restart", []string{"restart", "-n"}, "Preparing panel restart")
}

func (s *MaintenanceService) SoftReload(context.Context) (MaintenanceOperationSnapshot, error) {
	if err := requireBinaryRuntime(s.Runtime.Info()); err != nil {
		return MaintenanceOperationSnapshot{}, err
	}
	return s.startOperation("soft-reload", []string{"restart", "-n"}, "Preparing panel reload")
}

func (s *MaintenanceService) Status() MaintenanceOperationSnapshot {
	if s.ops == nil {
		s.ops = NewMaintenanceOperationStore()
	}
	return s.ops.Latest()
}

func (s *MaintenanceService) startOperation(action string, args []string, message string) (MaintenanceOperationSnapshot, error) {
	if s.ops == nil {
		s.ops = NewMaintenanceOperationStore()
	}
	op := s.ops.Start(action, args, message)
	onOutput := func(line string) {
		s.ops.AppendOutput(op.ID, line)
	}
	onDone := func(err error) {
		s.ops.Finish(op.ID, err)
	}
	if action == "restart" || action == "soft-reload" {
		if err := s.Commands.Schedule(args); err != nil {
			s.ops.Finish(op.ID, err)
			return s.ops.Get(op.ID), err
		}
		s.ops.MarkRestarting(op.ID, "Command accepted. Waiting for Rebecca to restart.")
		return s.ops.Get(op.ID), nil
	}
	if scheduler, ok := s.Commands.(ProgressCommandScheduler); ok {
		if err := scheduler.ScheduleWithProgress(args, onOutput, onDone); err != nil {
			s.ops.Finish(op.ID, err)
			return s.ops.Get(op.ID), err
		}
		return s.ops.Get(op.ID), nil
	}
	if err := s.Commands.Schedule(args); err != nil {
		s.ops.Finish(op.ID, err)
		return s.ops.Get(op.ID), err
	}
	s.ops.MarkRestarting(op.ID, "Command accepted. Waiting for Rebecca to restart.")
	return s.ops.Get(op.ID), nil
}

func requireBinaryRuntime(info RuntimeInfo) error {
	if strings.EqualFold(strings.TrimSpace(info.Mode), "binary") {
		return nil
	}
	return MaintenanceError{Status: http.StatusConflict, Detail: hostOperationDisabledDetail}
}

func BuildRebeccaUpdateArgs(channel string, version string) ([]string, error) {
	args := []string{"update"}
	normalizedVersion := strings.TrimSpace(version)
	normalizedChannel := strings.ToLower(strings.TrimSpace(channel))

	if normalizedVersion != "" {
		switch normalizedVersion {
		case "latest":
			return append(args, "--version", "latest"), nil
		case "dev":
			return append(args, "--dev"), nil
		}
		if devVersionPattern.MatchString(normalizedVersion) {
			return append(args, "--version", normalizedVersion), nil
		}
		if !releaseVersionPattern.MatchString(normalizedVersion) {
			return nil, MaintenanceError{Status: http.StatusUnprocessableEntity, Detail: "Invalid update version"}
		}
		return append(args, "--version", normalizedVersion), nil
	}

	switch normalizedChannel {
	case "", "current", "auto":
		return args, nil
	case "dev":
		return append(args, "--dev"), nil
	case "latest", "stable", "release":
		return append(args, "--version", "latest"), nil
	default:
		return nil, MaintenanceError{Status: http.StatusUnprocessableEntity, Detail: "Invalid update channel"}
	}
}

type DefaultRuntimeDetector struct{}

func (DefaultRuntimeDetector) Info() RuntimeInfo {
	metadata := readRuntimeMetadata()
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("REBECCA_INSTALL_MODE")))
	if mode == "" {
		mode = strings.ToLower(strings.TrimSpace(readTextFile(installModePath())))
	}
	if mode == "" {
		if value, ok := metadata["install_mode"].(string); ok {
			mode = strings.ToLower(strings.TrimSpace(value))
		}
	}
	if mode == "" {
		mode = "docker"
	}
	tag := stringPtrFromAny(metadata["tag"])
	image := strings.TrimSpace(stringFromAny(metadata["image"]))
	if image == "" {
		if mode == "binary" {
			image = "rebecca-server (binary)"
		} else {
			image = "rebeccapanel/rebecca"
		}
	}
	return RuntimeInfo{
		Mode:        mode,
		InstallMode: mode,
		Service:     serviceName(),
		Image:       image,
		Tag:         tag,
		Channel:     InferUpdateChannel(tag),
		Python:      nil,
		Go:          runtime.Version(),
		Binary:      metadata,
	}
}

func serviceName() string {
	if value := strings.TrimSpace(os.Getenv("REBECCA_SERVICE_NAME")); value != "" {
		return value
	}
	return "rebecca"
}

func runtimeMetadataPath() string {
	if value := strings.TrimSpace(os.Getenv("REBECCA_BINARY_METADATA_FILE")); value != "" {
		return value
	}
	return filepath.Join(appDir(), ".binary-release.json")
}

func installModePath() string {
	if value := strings.TrimSpace(os.Getenv("REBECCA_INSTALL_MODE_FILE")); value != "" {
		return value
	}
	return filepath.Join(appDir(), ".install-mode")
}

func appDir() string {
	if value := strings.TrimSpace(os.Getenv("REBECCA_APP_DIR")); value != "" {
		return value
	}
	return "/opt/rebecca"
}

func readRuntimeMetadata() map[string]any {
	content, err := os.ReadFile(runtimeMetadataPath())
	if err != nil {
		return map[string]any{}
	}
	var data map[string]any
	if err := json.Unmarshal(content, &data); err != nil {
		return map[string]any{}
	}
	if data == nil {
		return map[string]any{}
	}
	return data
}

func readTextFile(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(content)
}

type DefaultCommandScheduler struct{}

func (DefaultCommandScheduler) Schedule(args []string) error {
	cli, err := resolveRebeccaCLI()
	if err != nil {
		return err
	}
	command := append([]string{cli}, args...)
	if runtime.GOOS != "windows" {
		if systemdRun, err := exec.LookPath("systemd-run"); err == nil && systemdRun != "" {
			unit := fmt.Sprintf("rebecca-host-action-%d", time.Now().UnixNano())
			command = append(
				[]string{systemdRun, "--unit", unit, "--collect", "--description", "Rebecca host action", "--"},
				command...,
			)
		}
	}
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return MaintenanceError{Status: http.StatusInternalServerError, Detail: "Failed to schedule Rebecca command: " + err.Error()}
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
	return nil
}

func (DefaultCommandScheduler) ScheduleWithProgress(args []string, onOutput func(string), onDone func(error)) error {
	cli, err := resolveRebeccaCLI()
	if err != nil {
		return err
	}
	command := append([]string{cli}, args...)
	cmd := exec.Command(command[0], command[1:]...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return MaintenanceError{Status: http.StatusInternalServerError, Detail: "Failed to capture Rebecca command output: " + err.Error()}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return MaintenanceError{Status: http.StatusInternalServerError, Detail: "Failed to capture Rebecca command output: " + err.Error()}
	}
	if err := cmd.Start(); err != nil {
		return MaintenanceError{Status: http.StatusInternalServerError, Detail: "Failed to schedule Rebecca command: " + err.Error()}
	}
	readPipe := func(reader io.Reader) {
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			if onOutput != nil {
				onOutput(scanner.Text())
			}
		}
	}
	go readPipe(stdout)
	go readPipe(stderr)
	go func() {
		err := cmd.Wait()
		if onDone != nil {
			onDone(err)
		}
	}()
	return nil
}

func resolveRebeccaCLI() (string, error) {
	candidates := []string{strings.TrimSpace(os.Getenv("REBECCA_SCRIPT_BIN"))}
	if path, err := exec.LookPath("rebecca"); err == nil {
		candidates = append(candidates, path)
	}
	candidates = append(candidates, "/usr/local/bin/rebecca")
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if stat, err := os.Stat(candidate); err == nil && !stat.IsDir() {
			return candidate, nil
		}
	}
	return "", MaintenanceError{Status: http.StatusServiceUnavailable, Detail: "Rebecca CLI was not found on this host"}
}

type GitHubUpdateChecker struct {
	APIBase        string
	RawBase        string
	HTTPClient     *http.Client
	ManifestBranch string
	ManifestPath   string
	Now            func() time.Time
	CacheTTL       time.Duration
	ErrorTTL       time.Duration

	mu       sync.Mutex
	cache    map[string]githubUpdateCacheEntry
	inFlight map[string]*githubUpdateCall
}

type githubUpdateCacheEntry struct {
	status    UpdateStatus
	expiresAt time.Time
}

type githubUpdateCall struct {
	done   chan struct{}
	status UpdateStatus
}

func NewGitHubUpdateChecker() *GitHubUpdateChecker {
	return &GitHubUpdateChecker{
		APIBase:        "https://api.github.com",
		RawBase:        "https://raw.githubusercontent.com",
		HTTPClient:     &http.Client{Timeout: 8 * time.Second},
		ManifestBranch: firstEnv("REBECCA_BINARY_DEV_MANIFEST_BRANCH", "dev-build-manifest"),
		ManifestPath:   "dev-builds.json",
		Now:            time.Now,
		CacheTTL:       10 * time.Minute,
		ErrorTTL:       5 * time.Minute,
	}
}

func (c *GitHubUpdateChecker) Status(ctx context.Context, repo string, current *string, channel string) UpdateStatus {
	now := c.now()
	key := c.statusCacheKey(repo, current, channel)

	c.mu.Lock()
	if c.cache == nil {
		c.cache = map[string]githubUpdateCacheEntry{}
	}
	if c.inFlight == nil {
		c.inFlight = map[string]*githubUpdateCall{}
	}
	if cached, ok := c.cache[key]; ok && now.Before(cached.expiresAt) {
		status := cloneUpdateStatus(cached.status)
		c.mu.Unlock()
		return status
	}
	if call, ok := c.inFlight[key]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return cloneUpdateStatus(call.status)
		case <-ctx.Done():
			return c.errorStatus(repo, current, channel, now, ctx.Err().Error())
		}
	}
	call := &githubUpdateCall{done: make(chan struct{})}
	c.inFlight[key] = call
	c.mu.Unlock()

	status := c.statusUncached(ctx, repo, current, channel, now)
	ttl := c.CacheTTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	if status.Error != "" {
		ttl = c.ErrorTTL
		if ttl <= 0 {
			ttl = 5 * time.Minute
		}
	}

	c.mu.Lock()
	c.cache[key] = githubUpdateCacheEntry{status: cloneUpdateStatus(status), expiresAt: now.Add(ttl)}
	delete(c.inFlight, key)
	call.status = cloneUpdateStatus(status)
	close(call.done)
	c.mu.Unlock()

	return status
}

func (c *GitHubUpdateChecker) statusUncached(ctx context.Context, repo string, current *string, channel string, now time.Time) UpdateStatus {
	checkedAt := now.Unix()
	currentChannel := strings.ToLower(strings.TrimSpace(channel))
	if currentChannel == "" {
		currentChannel = InferUpdateChannel(current)
	}
	if currentChannel == "" {
		currentChannel = "unknown"
	}
	status := UpdateStatus{
		Repo:      repo,
		Current:   current,
		Channel:   currentChannel,
		Available: false,
		CheckedAt: checkedAt,
	}
	latestRelease, err := c.latestRelease(ctx, repo)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	latestDev, err := c.latestDev(ctx, repo)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.LatestRelease = latestRelease
	status.LatestDev = latestDev
	target := latestRelease
	if currentChannel == "dev" {
		target = latestDev
	}
	if target != nil {
		if tag := strings.TrimSpace(stringFromAny((*target)["tag"])); tag != "" {
			status.Target = &tag
			status.Available = IsDifferentVersion(current, status.Target)
		}
	}
	return status
}

func (c *GitHubUpdateChecker) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *GitHubUpdateChecker) statusCacheKey(repo string, current *string, channel string) string {
	currentValue := ""
	if current != nil {
		currentValue = strings.TrimSpace(*current)
	}
	return strings.ToLower(strings.TrimSpace(repo)) + "|" + strings.ToLower(strings.TrimSpace(channel)) + "|" + currentValue
}

func (c *GitHubUpdateChecker) errorStatus(repo string, current *string, channel string, now time.Time, detail string) UpdateStatus {
	currentChannel := strings.ToLower(strings.TrimSpace(channel))
	if currentChannel == "" {
		currentChannel = InferUpdateChannel(current)
	}
	if currentChannel == "" {
		currentChannel = "unknown"
	}
	return UpdateStatus{
		Repo:      repo,
		Current:   cloneStringPtr(current),
		Channel:   currentChannel,
		CheckedAt: now.Unix(),
		Error:     detail,
	}
}

func cloneUpdateStatus(status UpdateStatus) UpdateStatus {
	clone := status
	clone.Current = cloneStringPtr(status.Current)
	clone.Target = cloneStringPtr(status.Target)
	if status.LatestRelease != nil {
		release := cloneReleaseInfo(*status.LatestRelease)
		clone.LatestRelease = &release
	}
	if status.LatestDev != nil {
		dev := cloneReleaseInfo(*status.LatestDev)
		clone.LatestDev = &dev
	}
	return clone
}

func cloneStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func cloneReleaseInfo(info ReleaseInfo) ReleaseInfo {
	clone := make(ReleaseInfo, len(info))
	for key, value := range info {
		clone[key] = value
	}
	return clone
}

func (c *GitHubUpdateChecker) latestRelease(ctx context.Context, repo string) (*ReleaseInfo, error) {
	var data map[string]any
	if err := c.getJSON(ctx, strings.TrimRight(c.APIBase, "/")+"/repos/"+repo+"/releases/latest", &data); err != nil {
		return nil, err
	}
	tag := firstNonEmptyString(stringFromAny(data["tag_name"]), stringFromAny(data["name"]))
	if tag == "" {
		return nil, nil
	}
	info := ReleaseInfo{
		"tag":          tag,
		"name":         data["name"],
		"published_at": data["published_at"],
		"html_url":     data["html_url"],
	}
	return &info, nil
}

func (c *GitHubUpdateChecker) latestDev(ctx context.Context, repo string) (*ReleaseInfo, error) {
	if info, err := c.latestDevFromManifest(ctx, repo); err == nil && info != nil {
		return info, nil
	}
	var data map[string]any
	workflowURL := strings.TrimRight(c.APIBase, "/") + "/repos/" + repo + "/actions/workflows/binary-build.yml/runs?branch=dev&event=push&status=success&per_page=100"
	if err := c.getJSON(ctx, workflowURL, &data); err != nil {
		return nil, err
	}
	runs, _ := data["workflow_runs"].([]any)
	for _, item := range runs {
		run, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if stringFromAny(run["head_branch"]) != "dev" ||
			stringFromAny(run["conclusion"]) != "success" ||
			(stringFromAny(run["status"]) != "" && stringFromAny(run["status"]) != "completed") {
			continue
		}
		sha := strings.TrimSpace(stringFromAny(run["head_sha"]))
		if sha == "" {
			continue
		}
		short := sha
		if len(short) > 7 {
			short = short[:7]
		}
		info := ReleaseInfo{
			"tag":        "dev-" + short,
			"sha":        sha,
			"branch":     "dev",
			"created_at": run["created_at"],
			"updated_at": run["updated_at"],
			"html_url":   run["html_url"],
		}
		return &info, nil
	}
	return nil, nil
}

func (c *GitHubUpdateChecker) latestDevFromManifest(ctx context.Context, repo string) (*ReleaseInfo, error) {
	manifestPath := strings.Trim(strings.TrimSpace(c.ManifestPath), "/")
	if manifestPath == "" {
		manifestPath = "dev-builds.json"
	}
	branch := strings.TrimSpace(c.ManifestBranch)
	if branch == "" {
		branch = "dev-build-manifest"
	}
	url := strings.TrimRight(c.RawBase, "/") + "/" + repo + "/" + branch + "/" + manifestPath
	var data map[string]any
	if err := c.getJSON(ctx, url, &data); err != nil {
		return nil, err
	}
	build := selectManifestBuild(data)
	if build == nil {
		return nil, nil
	}
	tag := firstNonEmptyString(stringFromAny((*build)["tag"]), stringFromAny((*build)["build_tag"]))
	if tag == "" {
		return nil, nil
	}
	runID := strings.TrimSpace(stringFromAny((*build)["run_id"]))
	var htmlURL any
	if runID != "" {
		htmlURL = "https://github.com/" + repo + "/actions/runs/" + runID
	}
	info := ReleaseInfo{
		"tag":          tag,
		"sha":          (*build)["sha"],
		"branch":       firstNonEmptyString(stringFromAny((*build)["branch"]), "dev"),
		"created_at":   firstNonEmptyAny((*build)["created_at"], (*build)["generated_at"]),
		"updated_at":   firstNonEmptyAny(data["updated_at"], (*build)["generated_at"]),
		"html_url":     htmlURL,
		"manifest_url": url,
	}
	if assets, ok := (*build)["assets"].(map[string]any); ok {
		info["assets"] = assets
	} else {
		info["assets"] = map[string]any{}
	}
	return &info, nil
}

func selectManifestBuild(data map[string]any) *map[string]any {
	builds, _ := data["builds"].([]any)
	latest := strings.TrimSpace(stringFromAny(data["latest"]))
	if len(builds) > 0 && latest != "" {
		for _, item := range builds {
			build, ok := item.(map[string]any)
			if ok && stringFromAny(build["tag"]) == latest {
				return &build
			}
		}
	}
	for _, item := range builds {
		build, ok := item.(map[string]any)
		if ok {
			return &build
		}
	}
	if legacy, ok := data["latest"].(map[string]any); ok {
		return &legacy
	}
	return nil
}

func firstNonEmptyAny(values ...any) any {
	for _, value := range values {
		if strings.TrimSpace(stringFromAny(value)) != "" {
			return value
		}
	}
	return nil
}

func (c *GitHubUpdateChecker) getJSON(ctx context.Context, url string, target any) error {
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Rebecca-update-check")
	if token := firstEnv("GITHUB_TOKEN", ""); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	} else if token := firstEnv("GH_TOKEN", ""); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("github request failed: %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(target)
}

func InferUpdateChannel(tag *string) string {
	normalized := ""
	if tag != nil {
		normalized = strings.ToLower(strings.TrimSpace(*tag))
	}
	if strings.HasPrefix(normalized, "dev-") {
		return "dev"
	}
	if normalized != "" {
		return "latest"
	}
	return "unknown"
}

func NormalizeVersionTag(tag *string) string {
	if tag == nil {
		return ""
	}
	normalized := strings.ToLower(strings.TrimSpace(*tag))
	normalized = strings.TrimPrefix(normalized, "refs/tags/")
	if strings.HasPrefix(normalized, "v") && len(normalized) > 1 && normalized[1] >= '0' && normalized[1] <= '9' {
		normalized = normalized[1:]
	}
	return normalized
}

func IsDifferentVersion(current *string, target *string) bool {
	currentNormalized := NormalizeVersionTag(current)
	targetNormalized := NormalizeVersionTag(target)
	return currentNormalized != "" && targetNormalized != "" && currentNormalized != targetNormalized
}

func stringPtrFromAny(value any) *string {
	result := strings.TrimSpace(stringFromAny(value))
	if result == "" {
		return nil
	}
	return &result
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstEnv(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func ptr[T any](value T) *T {
	return &value
}

func HTTPStatus(err error) (int, string) {
	if err == nil {
		return http.StatusOK, ""
	}
	var maintenanceErr MaintenanceError
	if errors.As(err, &maintenanceErr) {
		return maintenanceErr.Status, maintenanceErr.Detail
	}
	return http.StatusInternalServerError, err.Error()
}
