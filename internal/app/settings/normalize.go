package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var placeholderRegexp = regexp.MustCompile(`//+`)

var ErrTemplateNotFound = errors.New("template not found")

func normalizePrefix(prefix string) string {
	cleaned := strings.TrimSpace(prefix)
	return strings.TrimRight(cleaned, "/")
}

func ensureScheme(value string) string {
	if value == "" || strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return "https://" + value
}

func normalizeSupportURL(value string) string {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		return ""
	}
	return ensureScheme(cleaned)
}

func normalizePath(value string) string {
	cleaned := strings.Trim(strings.TrimSpace(value), "/")
	if cleaned == "" {
		return defaultSubscriptionPath
	}
	return cleaned
}

func normalizeDashboardPath(value string) string {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		cleaned = defaultDashboardPath
	}
	cleaned = "/" + strings.Trim(cleaned, "/") + "/"
	if cleaned == "//" {
		return defaultDashboardPath
	}
	return cleaned
}

func normalizeURLPath(value string, fallback string) string {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		cleaned = fallback
	}
	cleaned = "/" + strings.Trim(cleaned, "/") + "/"
	if cleaned == "//" {
		return "/"
	}
	return cleaned
}

func normalizePort(value int, fallback int) int {
	if value < 1 || value > 65535 {
		return fallback
	}
	return value
}

func normalizeAlias(alias string) string {
	cleaned := strings.TrimSpace(alias)
	if cleaned == "" {
		return ""
	}
	cleaned = strings.ReplaceAll(cleaned, "{identifier}", "")
	cleaned = strings.ReplaceAll(cleaned, "{token}", "")
	cleaned = strings.ReplaceAll(cleaned, "{key}", "")
	cleaned = placeholderRegexp.ReplaceAllString(cleaned, "/")
	return strings.TrimSpace(cleaned)
}

func normalizeAliases(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		alias := normalizeAlias(value)
		if alias == "" || seen[alias] {
			continue
		}
		seen[alias] = true
		result = append(result, alias)
	}
	return result
}

func normalizePorts(values []int) []int {
	result := []int{}
	seen := map[int]bool{}
	for _, value := range values {
		if value < 1 || value > 65535 || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func decodeStringArray(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err == nil {
		return normalizeAliases(values)
	}
	return normalizeAliases([]string{raw})
}

func decodeIntArray(raw string) []int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []int{}
	}
	var values []int
	if err := json.Unmarshal([]byte(raw), &values); err == nil {
		return normalizePorts(values)
	}
	var stringsList []string
	if err := json.Unmarshal([]byte(raw), &stringsList); err == nil {
		ints := make([]int, 0, len(stringsList))
		for _, value := range stringsList {
			parsed, err := strconv.Atoi(strings.TrimSpace(value))
			if err == nil {
				ints = append(ints, parsed)
			}
		}
		return normalizePorts(ints)
	}
	parts := strings.Split(raw, ",")
	ints := make([]int, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.Atoi(strings.TrimSpace(part))
		if err == nil {
			ints = append(ints, parsed)
		}
	}
	return normalizePorts(ints)
}

func rawStringDefault(raw json.RawMessage, fallback string) string {
	if string(raw) == "null" {
		return fallback
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return strings.TrimSpace(value)
	}
	return fallback
}

func rawBoolDefault(raw json.RawMessage, fallback bool) bool {
	if string(raw) == "null" {
		return fallback
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return b
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return number != 0
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		switch strings.ToLower(strings.TrimSpace(text)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off", "":
			return false
		}
	}
	return fallback
}

func rawIntDefault(raw json.RawMessage, fallback int) int {
	if string(raw) == "null" {
		return fallback
	}
	var value int
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return int(number)
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		parsed, err := strconv.Atoi(strings.TrimSpace(text))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func rawStringList(raw json.RawMessage) ([]string, error) {
	if string(raw) == "null" {
		return []string{}, nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	return values, nil
}

func rawIntList(raw json.RawMessage) ([]int, error) {
	if string(raw) == "null" {
		return []int{}, nil
	}
	var values []int
	if err := json.Unmarshal(raw, &values); err == nil {
		return values, nil
	}
	var stringValues []string
	if err := json.Unmarshal(raw, &stringValues); err != nil {
		return nil, err
	}
	ints := make([]int, 0, len(stringValues))
	for _, value := range stringValues {
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err == nil {
			ints = append(ints, parsed)
		}
	}
	return ints, nil
}

func applySubscriptionDefaults(settings *SubscriptionSettings) {
	if settings.SubscriptionProfileTitle == "" {
		settings.SubscriptionProfileTitle = defaultSubscriptionProfileTitle
	}
	if settings.SubscriptionSupportURL == "" {
		settings.SubscriptionSupportURL = defaultSubscriptionSupportURL
	}
	if settings.SubscriptionUpdateInterval == "" {
		settings.SubscriptionUpdateInterval = defaultSubscriptionUpdateInterval
	}
	if settings.ClashSubscriptionTemplate == "" {
		settings.ClashSubscriptionTemplate = defaultClashSubscriptionTemplate
	}
	if settings.ClashSettingsTemplate == "" {
		settings.ClashSettingsTemplate = defaultClashSettingsTemplate
	}
	if settings.SubscriptionPageTemplate == "" {
		settings.SubscriptionPageTemplate = defaultSubscriptionPageTemplate
	}
	if settings.HomePageTemplate == "" {
		settings.HomePageTemplate = defaultHomePageTemplate
	}
	if settings.V2RaySubscriptionTemplate == "" {
		settings.V2RaySubscriptionTemplate = defaultV2RaySubscriptionTemplate
	}
	if settings.V2RaySettingsTemplate == "" {
		settings.V2RaySettingsTemplate = defaultV2RaySettingsTemplate
	}
	if settings.SingBoxSubscriptionTemplate == "" {
		settings.SingBoxSubscriptionTemplate = defaultSingBoxSubscriptionTemplate
	}
	if settings.SingBoxSettingsTemplate == "" {
		settings.SingBoxSettingsTemplate = defaultSingBoxSettingsTemplate
	}
	if settings.MuxTemplate == "" {
		settings.MuxTemplate = defaultMuxTemplate
	}
	if settings.SubscriptionPath == "" {
		settings.SubscriptionPath = defaultSubscriptionPath
	}
	if settings.SubscriptionAliases == nil {
		settings.SubscriptionAliases = []string{}
	}
	if settings.SubscriptionPorts == nil {
		settings.SubscriptionPorts = []int{}
	}
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func dbTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}

func certificatePath(domain string) string {
	base := os.Getenv("REBECCA_CERT_BASE")
	if strings.TrimSpace(base) == "" {
		dataDir := os.Getenv("REBECCA_DATA_DIR")
		if strings.TrimSpace(dataDir) == "" {
			dataDir = "/var/lib/rebecca"
		}
		base = filepath.Join(dataDir, "certs")
	}
	return filepath.Join(base, domain) + string(os.PathSeparator)
}

func appTemplateBasePath() string {
	candidates := []string{}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "templates"))
		candidates = append(candidates, filepath.Join(filepath.Dir(cwd), "templates"))
		candidates = append(candidates, filepath.Join(filepath.Dir(filepath.Dir(cwd)), "templates"))
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(dir, "templates"))
		candidates = append(candidates, filepath.Join(filepath.Dir(dir), "templates"))
		candidates = append(candidates, filepath.Join(filepath.Dir(filepath.Dir(dir)), "templates"))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return "templates"
}

func persistentTemplateDirectory(adminID *int64) string {
	dataDir := strings.TrimSpace(os.Getenv("REBECCA_DATA_DIR"))
	if dataDir == "" {
		dataDir = "/var/lib/rebecca"
	}
	base := filepath.Join(dataDir, "templates")
	if adminID != nil {
		return filepath.Join(base, "admins", strconv.FormatInt(*adminID, 10))
	}
	return base
}

func resolveExistingTemplatePath(templateName string, customDirectory *string) (string, error) {
	if path, err := resolveCustomTemplatePath(templateName, customDirectory, nil); err == nil {
		return path, nil
	} else if !errors.Is(err, ErrTemplateNotFound) {
		return "", err
	}
	return resolveAppTemplatePath(templateName)
}

func resolveCustomTemplatePath(templateName string, customDirectory *string, adminID *int64) (string, error) {
	baseDir := ""
	if customDirectory != nil {
		baseDir = strings.TrimSpace(*customDirectory)
	}
	if baseDir == "" {
		baseDir = persistentTemplateDirectory(adminID)
	}
	path, err := safeJoin(baseDir, templateName)
	if err != nil {
		return "", err
	}
	if info, statErr := os.Stat(path); statErr == nil && !info.IsDir() {
		return path, nil
	}
	return "", fmt.Errorf("%w: %s", ErrTemplateNotFound, templateName)
}

func resolveAppTemplatePath(templateName string) (string, error) {
	path, err := safeJoin(appTemplateBasePath(), templateName)
	if err != nil {
		return "", err
	}
	if info, statErr := os.Stat(path); statErr == nil && !info.IsDir() {
		return path, nil
	}
	return "", fmt.Errorf("%w: %s", ErrTemplateNotFound, templateName)
}

func resolveWritableTemplatePath(templateName string, customDirectory string) (string, error) {
	return safeJoin(customDirectory, templateName)
}

func displayTemplatePath(path string, templateName string, customDirectory *string) string {
	if customDirectory == nil || strings.TrimSpace(*customDirectory) == "" {
		return filepath.ToSlash(filepath.Join("templates", filepath.Clean(templateName)))
	}
	return path
}

func safeJoin(baseDir string, name string) (string, error) {
	base, err := filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(base, filepath.Clean(name)))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return "", err
	}
	if rel == "." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || rel == ".." || filepath.IsAbs(rel) {
		return "", fmt.Errorf("template path escapes the templates directory")
	}
	return target, nil
}

func stringFromMap(values map[string]any, key string) (string, bool) {
	value, ok := values[key]
	if !ok || value == nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	default:
		return fmt.Sprint(typed), true
	}
}
