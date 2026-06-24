package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	backupapp "github.com/rebeccapanel/rebecca/internal/app/backup"
	"github.com/rebeccapanel/rebecca/internal/app/migrations"
	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
	settingsapp "github.com/rebeccapanel/rebecca/internal/app/settings"
	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
	"github.com/rebeccapanel/rebecca/internal/app/usage"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	warpapp "github.com/rebeccapanel/rebecca/internal/app/warp"
	webhookapp "github.com/rebeccapanel/rebecca/internal/app/webhook"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
	"github.com/rebeccapanel/rebecca/internal/platform/db"
)

type Server struct {
	cfg             Config
	db              *sql.DB
	dialect         string
	adminRepo       adminapp.Repository
	adminAuth       adminapp.Authenticator
	nodeController  nodecontroller.Controller
	nodeMutations   nodeapp.Repository
	systemService   *systemapp.Service
	maintenance     *systemapp.MaintenanceService
	usageService    usage.Service
	userService     userapp.Service
	warpService     warpapp.Service
	configRepo      xrayconfig.Repository
	settingsRepo    settingsapp.Repository
	telegramRepo    telegramapp.Repository
	telegramSender  telegramapp.Sender
	telegramReports telegramapp.Reporter
	telegramBackup  telegramapp.BackupDelivery
	webhookRepo     webhookapp.Repository
	webhookDispatch webhookapp.Dispatcher
	backupService   *backupapp.Service
	backgroundOnce  sync.Once
}

func New(cfg Config) (*Server, error) {
	pool, err := db.Open(cfg.Database)
	if err != nil {
		return nil, err
	}
	migrationCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := migrations.RunMigrations(migrationCtx, pool.DB, pool.Dialect); err != nil {
		return nil, fmt.Errorf("run database migrations: %w", err)
	}
	if err := checkDatabaseIntegrity(migrationCtx, pool.DB); err != nil {
		return nil, fmt.Errorf("database integrity check: %w", err)
	}
	adminRepo := adminapp.NewRepository(pool.DB, pool.Dialect)
	nodeRepo := nodecontroller.NewRepository(pool.DB, pool.Dialect)
	nodeMutationRepo := nodeapp.NewRepository(pool.DB, pool.Dialect)
	usageRepo := usage.NewRepository(pool.DB, pool.Dialect)
	userRepo := userapp.NewRepository(pool.DB, pool.Dialect)
	warpRepo := warpapp.NewRepository(pool.DB, pool.Dialect)
	settingsRepo := settingsapp.NewRepository(pool.DB, pool.Dialect)
	telegramRepo := telegramapp.NewRepository(pool.DB, pool.Dialect)
	telegramSender := telegramapp.NewSender(telegramRepo, cfg.TelegramAPIBase)
	webhookRepo := webhookapp.NewRepository(pool.DB, pool.Dialect)
	webhookDispatch := webhookapp.NewDispatcher(webhookRepo, webhookapp.Config{
		Addresses:     cfg.WebhookAddresses,
		Secret:        cfg.WebhookSecret,
		MaxRetries:    cfg.WebhookMaxRetries,
		RetryInterval: parseWorkerInterval(cfg.WebhookRetryInterval, 30*time.Second),
	})
	backupService := backupapp.NewService(pool.DB, pool.Dialect, cfg.Database)
	configRepo := xrayconfig.NewRepository(pool.DB, pool.Dialect, xrayconfig.Options{
		FallbackInboundTag:  cfg.XrayFallbackInboundTag,
		ExcludedInboundTags: cfg.XrayExcludeInboundTags,
	})
	sudoers := []string{}
	if strings.TrimSpace(cfg.SudoUsername) != "" && strings.TrimSpace(cfg.SudoPassword) != "" {
		sudoers = append(sudoers, cfg.SudoUsername)
	}
	return &Server{
		cfg:            cfg,
		db:             pool.DB,
		dialect:        pool.Dialect,
		adminRepo:      adminRepo,
		adminAuth:      adminapp.NewAuthenticator(adminRepo, adminapp.WithSudoers(sudoers)),
		nodeController: nodecontroller.NewController(nodeRepo),
		nodeMutations:  nodeMutationRepo,
		systemService:  systemapp.NewService(pool.DB, pool.Dialect, systemapp.DefaultVersion),
		maintenance:    systemapp.NewMaintenanceService(),
		usageService:   usage.NewService(usageRepo),
		userService:    userapp.NewServiceWithTemplates(userRepo, settingsRepo),
		warpService:    warpapp.NewService(warpRepo, warpapp.NewClient(cfg.WarpAPIBase)),
		configRepo:     configRepo,
		settingsRepo:   settingsRepo,
		telegramRepo:   telegramRepo,
		telegramSender: telegramSender,
		telegramReports: telegramapp.NewReporter(
			telegramRepo,
			telegramSender,
		),
		telegramBackup:  telegramapp.NewBackupDelivery(telegramRepo, telegramSender),
		webhookRepo:     webhookRepo,
		webhookDispatch: webhookDispatch,
		backupService:   backupService,
	}, nil
}

func (s *Server) StartBackground(ctx context.Context) {
	s.backgroundOnce.Do(func() {
		go s.runNodeOperationsWorker(ctx)
		go s.runNodeUsageCollector(ctx)
		go s.runAdminLifecycleWorker(ctx)
		s.runUserLifecycleWorkers(ctx)
		go s.runTelegramBackupScheduler(ctx)
		go s.runWebhookWorker(ctx)
		go s.runTelegramBot(ctx)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.db.PingContext(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/nodes" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := s.nodeController.List(ctx, nodecontroller.Request{})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	nodes := make([]map[string]any, 0, len(result.Nodes))
	for _, node := range result.Nodes {
		nodes = append(nodes, flattenNodeItem(node))
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleNodesUsage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/nodes/usage" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := s.usageService.NodesUsage(r.Context(), usage.UsageRequest{Start: start, End: end})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"usages": rows})
}

func (s *Server) handleNodePath(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/node/settings":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeSettings(w, r)
		return
	case "/api/node/certificate/new":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeCertificateNew(w, r)
		return
	case "/api/node/master":
		if r.Method != http.MethodGet && r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeError(w, http.StatusGone, "master node usage/runtime routes have been removed")
		return
	case "/api/node/master/usage/reset":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeError(w, http.StatusGone, "master node usage/runtime routes have been removed")
		return
	}
	id, suffix, ok := parseNodePath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch suffix {
	case "":
		switch r.Method {
		case http.MethodGet:
			s.handleNode(w, r, id)
		case http.MethodPut:
			s.handleNodeUpdate(w, r, id)
		case http.MethodDelete:
			s.handleNodeDelete(w, r, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	case "reconnect":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeReconnect(w, r, id)
	case "restart":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeRestart(w, r, id)
	case "sync":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeSync(w, r, id)
	case "logs":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			s.handleNodeLogsWebSocket(w, r, id)
			return
		}
		s.handleNodeLogs(w, r, id)
	case "usage/daily":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeUsageDaily(w, r, id)
	case "xray/update":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeRuntimeUpdate(w, r, id)
	case "geo/update":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeGeoUpdate(w, r, id)
	case "service/restart":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeServiceRestart(w, r, id)
	case "service/update":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeServiceUpdate(w, r, id)
	case "certificate/regenerate":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeCertificateRegenerate(w, r, id)
	case "usage/reset":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleNodeUsageReset(w, r, id)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleNode(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	node, err := s.nodeController.Get(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenNodeItem(node))
}

func (s *Server) handleNodeReconnect(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	result, err := s.nodeController.Reconnect(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func (s *Server) handleNodeRestart(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	result, err := s.nodeController.Restart(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func (s *Server) handleNodeSync(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	result, err := s.nodeController.Sync(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func (s *Server) handleNodeLogs(w http.ResponseWriter, r *http.Request, nodeID int64) {
	maxLines := 200
	if value := strings.TrimSpace(r.URL.Query().Get("max_lines")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid max_lines")
			return
		}
		maxLines = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	result, err := s.nodeController.Logs(ctx, nodecontroller.Request{NodeID: nodeID, MaxLines: maxLines})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"node_id": nodeID,
		"logs":    result.Logs,
	})
}

func (s *Server) handleNodeUsageDaily(w http.ResponseWriter, r *http.Request, nodeID int64) {
	granularity := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("granularity")))
	if granularity == "" {
		granularity = "day"
	}
	if granularity != "day" && granularity != "hour" {
		writeError(w, http.StatusBadRequest, "Invalid granularity. Use 'day' or 'hour'.")
		return
	}
	nodeName, err := s.nodeName(r.Context(), nodeID)
	if err != nil {
		writeControllerError(w, err)
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := s.usageService.NodeUsageByDay(r.Context(), usage.UsageRequest{
		NodeID:      &nodeID,
		Granularity: granularity,
		Start:       start,
		End:         end,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"node_id":   nodeID,
		"node_name": nodeName,
		"usages":    rows,
	})
}

func (s *Server) handleNodeRuntimeUpdate(w http.ResponseWriter, r *http.Request, nodeID int64) {
	var payload struct {
		Version string `json:"version"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.Version) == "" {
		writeError(w, http.StatusUnprocessableEntity, "version is required")
		return
	}
	version := strings.TrimSpace(payload.Version)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		_, _ = s.nodeController.UpdateRuntime(ctx, nodecontroller.Request{
			NodeID:  nodeID,
			Version: version,
		})
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":  "accepted",
		"node_id": nodeID,
		"detail":  "Node core update started. Refresh the node list to see the final status.",
	})
}

func (s *Server) handleNodeGeoUpdate(w http.ResponseWriter, r *http.Request, nodeID int64) {
	var payload geoUpdatePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	files, status, err := resolveGeoUpdateFiles(r.Context(), payload)
	if err != nil {
		writeError(w, status, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	result, err := s.nodeController.UpdateGeo(ctx, nodecontroller.Request{
		NodeID: nodeID,
		Files:  files,
	})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func (s *Server) handleNodeServiceRestart(w http.ResponseWriter, r *http.Request, nodeID int64) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	result, err := s.nodeController.RestartService(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func (s *Server) handleNodeServiceUpdate(w http.ResponseWriter, r *http.Request, nodeID int64) {
	var payload struct {
		Channel string `json:"channel"`
		Version string `json:"version"`
	}
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	result, err := s.nodeController.UpdateService(ctx, nodecontroller.Request{
		NodeID:  nodeID,
		Channel: payload.Channel,
		Version: payload.Version,
	})
	if err != nil {
		writeControllerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flattenRuntimeResult(result))
}

func parseNodePath(path string) (int64, string, bool) {
	rest := strings.TrimPrefix(path, "/api/node/")
	if rest == path || rest == "" {
		return 0, "", false
	}
	parts := strings.Split(rest, "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		return 0, "", false
	}
	return id, strings.Join(parts[1:], "/"), true
}

func (s *Server) nodeName(ctx context.Context, nodeID int64) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(name, '') FROM nodes WHERE id = ? LIMIT 1`, nodeID).Scan(&name)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("node not found")
	}
	return name, err
}

func normalizeUsageRange(start string, end string) (string, string, error) {
	start = strings.TrimSpace(start)
	end = strings.TrimSpace(end)
	endTime := time.Now().UTC()
	startTime := endTime.Add(-30 * 24 * time.Hour)
	if start != "" {
		parsed, err := parseFlexibleTime(start)
		if err != nil {
			return "", "", fmt.Errorf("invalid date range or format")
		}
		startTime = parsed
	}
	if end != "" {
		parsed, err := parseFlexibleTime(end)
		if err != nil {
			return "", "", fmt.Errorf("invalid date range or format")
		}
		endTime = parsed
	}
	if endTime.Before(startTime) {
		return "", "", fmt.Errorf("start date must be before end date")
	}
	return startTime.Format(time.RFC3339Nano), endTime.Format(time.RFC3339Nano), nil
}

func parseFlexibleTime(value string) (time.Time, error) {
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported timestamp")
}

func decodeOptionalJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	return nil
}

func writeControllerError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	if errors.Is(err, sql.ErrNoRows) || strings.Contains(strings.ToLower(err.Error()), "not found") {
		status = http.StatusNotFound
	}
	writeError(w, status, err.Error())
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]any{"detail": detail})
}
