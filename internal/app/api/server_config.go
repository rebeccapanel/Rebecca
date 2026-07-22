package api

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Database                     string
	NodeOperationsPollInterval   string
	NodeUsageCollectionInterval  string
	NodeUsageCollectionLimit     int
	NodeUsageFlushInterval       string
	NodeUsageFlushBatchSize      int
	RecordNodeUsage              bool
	RecordNodeUserUsages         bool
	AdminLifecycleInterval       string
	UserLifecycleInterval        string
	UserLifecycleBatchSize       int
	UserUsageResetInterval       string
	UserUsageResetBatchSize      int
	UserAutodeleteInterval       string
	UserAutodeleteBatchSize      int
	UsersAutodeleteDays          int
	UserAutodeleteIncludeLimited bool
	JWTAccessTokenExpireMinutes  int
	UsersListTimeoutSeconds      float64
	SubscriptionReadOnly         bool
	TelegramAPIBase              string
	APIDocsEnabled               bool
	WebhookAddresses             []string
	WebhookSecret                string
	WebhookSendInterval          string
	WebhookMaxRetries            int
	WebhookRetryInterval         string
}

func LoadConfig() (Config, error) {
	env := loadEnvFiles()
	lookup := func(keys ...string) string {
		for _, key := range keys {
			if value := strings.TrimSpace(os.Getenv(key)); value != "" {
				return value
			}
			if value := strings.TrimSpace(env[key]); value != "" {
				return value
			}
		}
		return ""
	}

	cfg := Config{
		Database:                     lookup("SQLALCHEMY_DATABASE_URL", "DATABASE_URL"),
		NodeOperationsPollInterval:   lookup("REBECCA_NODE_OPERATIONS_POLL_INTERVAL"),
		NodeUsageCollectionInterval:  lookup("REBECCA_NODE_USAGE_COLLECTION_INTERVAL"),
		NodeUsageCollectionLimit:     parseIntDefault(lookup("REBECCA_NODE_USAGE_COLLECTION_LIMIT"), 0),
		NodeUsageFlushInterval:       lookup("REBECCA_NODE_USAGE_FLUSH_INTERVAL"),
		NodeUsageFlushBatchSize:      parseIntDefault(lookup("REBECCA_NODE_USAGE_FLUSH_BATCH_SIZE"), 2000),
		RecordNodeUsage:              true,
		RecordNodeUserUsages:         true,
		AdminLifecycleInterval:       lookup("REBECCA_ADMIN_LIFECYCLE_INTERVAL"),
		UserLifecycleInterval:        firstNonEmpty(lookup("REBECCA_USER_LIFECYCLE_INTERVAL"), secondsEnv(lookup("JOB_REVIEW_USERS_INTERVAL"))),
		UserLifecycleBatchSize:       parseIntDefault(lookup("REBECCA_USER_LIFECYCLE_BATCH_SIZE", "JOB_REVIEW_USERS_BATCH_SIZE"), 500),
		UserUsageResetInterval:       lookup("REBECCA_USER_USAGE_RESET_INTERVAL"),
		UserUsageResetBatchSize:      parseIntDefault(lookup("REBECCA_USER_USAGE_RESET_BATCH_SIZE"), 500),
		UserAutodeleteInterval:       lookup("REBECCA_USER_AUTODELETE_INTERVAL"),
		UserAutodeleteBatchSize:      parseIntDefault(lookup("REBECCA_USER_AUTODELETE_BATCH_SIZE"), 500),
		UsersAutodeleteDays:          parseIntDefault(lookup("USERS_AUTODELETE_DAYS"), -1),
		UserAutodeleteIncludeLimited: parseBoolDefault(lookup("USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS"), false),
		JWTAccessTokenExpireMinutes:  parseIntDefault(lookup("JWT_ACCESS_TOKEN_EXPIRE_MINUTES"), 1440),
		UsersListTimeoutSeconds:      parseFloatDefault(lookup("USERS_LIST_TIMEOUT_SECONDS"), 0),
		TelegramAPIBase:              lookup("REBECCA_TELEGRAM_API_BASE"),
		WebhookAddresses:             splitWebhookAddresses(lookup("WEBHOOK_ADDRESS")),
		WebhookSecret:                lookup("WEBHOOK_SECRET"),
		WebhookSendInterval:          firstNonEmpty(lookup("REBECCA_WEBHOOK_SEND_INTERVAL"), secondsEnv(lookup("JOB_SEND_NOTIFICATIONS_INTERVAL"))),
		WebhookMaxRetries:            parseIntDefault(lookup("NUMBER_OF_RECURRENT_NOTIFICATIONS"), 3),
		WebhookRetryInterval:         firstNonEmpty(lookup("REBECCA_WEBHOOK_RETRY_INTERVAL"), secondsEnv(lookup("RECURRENT_NOTIFICATIONS_TIMEOUT"))),
	}
	if cfg.Database == "" {
		return Config{}, fmt.Errorf("SQLALCHEMY_DATABASE_URL is required")
	}
	return cfg, nil
}

// splitWebhookAddresses parses WEBHOOK_ADDRESS, which may list several endpoints
// separated by commas or whitespace.
func splitWebhookAddresses(value string) []string {
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		if trimmed := strings.TrimSpace(field); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func secondsEnv(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if _, err := strconv.ParseFloat(value, 64); err == nil {
		return value + "s"
	}
	return value
}

func parseBoolDefault(value string, fallback bool) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseIntDefault(value string, fallback int) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	var result int
	if _, err := fmt.Sscanf(value, "%d", &result); err != nil {
		return fallback
	}
	return result
}

func parseFloatDefault(value string, fallback float64) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	result, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return result
}

func loadEnvFiles() map[string]string {
	result := map[string]string{}
	for _, path := range candidateEnvFiles() {
		mergeEnvFile(result, path)
	}
	return result
}

func candidateEnvFiles() []string {
	seen := map[string]bool{}
	add := func(paths []string, path string) []string {
		path = strings.TrimSpace(path)
		if path == "" {
			return paths
		}
		abs, err := filepath.Abs(path)
		if err == nil {
			path = abs
		}
		if seen[path] {
			return paths
		}
		seen[path] = true
		return append(paths, path)
	}

	paths := []string{}
	paths = add(paths, os.Getenv("REBECCA_ENV_FILE"))
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		paths = add(paths, filepath.Join(dir, ".env"))
		paths = add(paths, filepath.Join(filepath.Dir(dir), ".env"))
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = add(paths, filepath.Join(cwd, ".env"))
		paths = add(paths, filepath.Join(filepath.Dir(cwd), ".env"))
	}
	return paths
}

func mergeEnvFile(dst map[string]string, path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key != "" {
			if _, exists := dst[key]; exists {
				continue
			}
			dst[key] = value
		}
	}
}
