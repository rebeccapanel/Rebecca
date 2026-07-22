package system

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxMaintenanceLogLines = 80

var (
	percentagePattern = regexp.MustCompile(`(?i)(?:^|\s)(100|[1-9]?\d)(?:\.\d+)?%`)
	curlProgressRow   = regexp.MustCompile(`\s(100|[1-9]?\d)\s+[\d.]+[kKmMgG]?\s+`)
)

type MaintenanceOperationSnapshot struct {
	ID          string   `json:"id"`
	Action      string   `json:"action"`
	Phase       string   `json:"phase"`
	Message     string   `json:"message"`
	Progress    *int     `json:"progress"`
	Running     bool     `json:"running"`
	Restarting  bool     `json:"restarting"`
	Error       string   `json:"error,omitempty"`
	Logs        []string `json:"logs"`
	StartedAt   int64    `json:"started_at"`
	UpdatedAt   int64    `json:"updated_at"`
	FinishedAt  *int64   `json:"finished_at,omitempty"`
	NeedsReload bool     `json:"needs_reload"`
}

type MaintenanceOperationStore struct {
	mu     sync.Mutex
	latest MaintenanceOperationSnapshot
}

func NewMaintenanceOperationStore() *MaintenanceOperationStore {
	return &MaintenanceOperationStore{}
}

func (s *MaintenanceOperationStore) Start(action string, args []string, message string) MaintenanceOperationSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().Unix()
	op := MaintenanceOperationSnapshot{
		ID:         fmt.Sprintf("%s-%d", action, time.Now().UnixNano()),
		Action:     action,
		Phase:      "queued",
		Message:    message,
		Running:    true,
		Restarting: false,
		Logs:       []string{"rebecca " + strings.Join(args, " ")},
		StartedAt:  now,
		UpdatedAt:  now,
	}
	s.latest = op
	return op
}

func (s *MaintenanceOperationStore) Latest() MaintenanceOperationSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneMaintenanceOperation(s.latest)
}

func (s *MaintenanceOperationStore) Get(id string) MaintenanceOperationSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.latest.ID != id {
		return MaintenanceOperationSnapshot{}
	}
	return cloneMaintenanceOperation(s.latest)
}

func (s *MaintenanceOperationStore) AppendOutput(id string, line string) {
	cleaned := cleanMaintenanceLine(line)
	if cleaned == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.latest.ID != id {
		return
	}
	s.latest.UpdatedAt = time.Now().Unix()
	s.latest.Logs = append(s.latest.Logs, cleaned)
	if len(s.latest.Logs) > maxMaintenanceLogLines {
		s.latest.Logs = append([]string{}, s.latest.Logs[len(s.latest.Logs)-maxMaintenanceLogLines:]...)
	}
	phase, message := classifyMaintenanceLine(cleaned, s.latest.Action)
	if phase != "" {
		s.latest.Phase = phase
	}
	if message != "" {
		s.latest.Message = message
	}
	if progress, ok := extractMaintenanceProgress(cleaned); ok {
		s.latest.Progress = &progress
		if s.latest.Phase == "queued" {
			s.latest.Phase = "downloading"
		}
	}
	if strings.Contains(strings.ToLower(cleaned), "restart") {
		s.latest.Restarting = true
		s.latest.NeedsReload = true
	}
}

func (s *MaintenanceOperationStore) MarkRestarting(id string, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.latest.ID != id {
		return
	}
	s.latest.UpdatedAt = time.Now().Unix()
	s.latest.Phase = "restarting"
	s.latest.Message = message
	s.latest.Restarting = true
	s.latest.NeedsReload = true
	s.latest.Running = true
}

func (s *MaintenanceOperationStore) Finish(id string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.latest.ID != id {
		return
	}
	now := time.Now().Unix()
	s.latest.UpdatedAt = now
	s.latest.FinishedAt = &now
	s.latest.Running = false
	if err != nil {
		s.latest.Phase = "failed"
		s.latest.Message = "Command failed"
		s.latest.Error = err.Error()
		return
	}
	if s.latest.Action == "update" || s.latest.Action == "restart" || s.latest.Action == "soft-reload" {
		s.latest.Phase = "restarting"
		s.latest.Message = "Rebecca is restarting. Waiting for the API to come back."
		s.latest.Restarting = true
		s.latest.NeedsReload = true
		return
	}
	s.latest.Phase = "completed"
	s.latest.Message = "Operation completed"
}

func cloneMaintenanceOperation(op MaintenanceOperationSnapshot) MaintenanceOperationSnapshot {
	op.Logs = append([]string{}, op.Logs...)
	return op
}

func cleanMaintenanceLine(line string) string {
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	line = strings.ReplaceAll(line, "\r", " ")
	line = strings.Join(strings.Fields(line), " ")
	if len(line) > 600 {
		line = line[:600]
	}
	return line
}

func classifyMaintenanceLine(line string, action string) (string, string) {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "download"):
		return "downloading", "Downloading the new Rebecca image"
	case strings.Contains(lower, "extract") || strings.Contains(lower, "unpack"):
		return "installing", "Extracting and installing the new binary"
	case strings.Contains(lower, "install"):
		return "installing", "Installing Rebecca files"
	case strings.Contains(lower, "migrat"):
		return "migrating", "Running database migrations"
	case strings.Contains(lower, "restart") || strings.Contains(lower, "stopping") || strings.Contains(lower, "started"):
		return "restarting", "Rebecca is restarting"
	case strings.Contains(lower, "selected") || strings.Contains(lower, "update"):
		if action == "update" {
			return "updating", "Updating Rebecca"
		}
	}
	return "", ""
}

func extractMaintenanceProgress(line string) (int, bool) {
	if match := percentagePattern.FindStringSubmatch(line); len(match) == 2 {
		value, err := strconv.Atoi(match[1])
		if err == nil {
			return clampPercent(value), true
		}
	}
	if match := curlProgressRow.FindStringSubmatch(line); len(match) == 2 {
		value, err := strconv.Atoi(match[1])
		if err == nil {
			return clampPercent(value), true
		}
	}
	return 0, false
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
