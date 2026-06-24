package logging

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

const (
	ComponentAdmin    = "Admin"
	ComponentDatabase = "Database"
	ComponentNode     = "Node"
	ComponentRuntime  = "Runtime"
	ComponentTelegram = "Telegram"
	ComponentUser     = "User"
	ComponentWebhook  = "Webhook"
)

func init() {
	log.SetFlags(0)
}

func Debugf(component string, format string, args ...any) {
	output(LevelDebug, component, format, args...)
}

func Infof(component string, format string, args ...any) {
	output(LevelInfo, component, format, args...)
}

func Warnf(component string, format string, args ...any) {
	output(LevelWarn, component, format, args...)
}

func Errorf(component string, format string, args ...any) {
	output(LevelError, component, format, args...)
}

func Fatalf(component string, format string, args ...any) {
	output(LevelError, component, format, args...)
	os.Exit(1)
}

func output(level Level, component string, format string, args ...any) {
	if level < configuredLevel() {
		return
	}
	component = strings.TrimSpace(component)
	if component == "" {
		component = "Runtime"
	}
	message := fmt.Sprintf(format, args...)
	_ = log.Output(3, fmt.Sprintf("[%s] %s %s", component, levelLabel(level), message))
}

func configuredLevel() Level {
	value := strings.ToLower(strings.TrimSpace(firstEnv("REBECCA_LOG_LEVEL", "REBECCA_LOG_MODE", "LOG_LEVEL")))
	if value == "" && truthy(firstEnv("REBECCA_DEBUG", "DEBUG")) {
		value = "debug"
	}
	switch value {
	case "debug", "trace":
		return LevelDebug
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

func levelLabel(level Level) string {
	switch level {
	case LevelDebug:
		return "DEBUG"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	default:
		return "INFO"
	}
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on", "debug":
		return true
	default:
		return false
	}
}
