package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"

	"github.com/pressly/goose/v3"
)

//go:embed sql/*
var migrationFS embed.FS

var gooseMu sync.Mutex
var migrationDialect string

const (
	latestGooseVersion         int64 = 27
	legacyAlembicFinalRevision       = "23_drop_access_insights"
	legacyAlembicFinalBaseline int64 = 16
)

type Runner struct {
	DB      *sql.DB
	Dialect string
}

type VersionInfo struct {
	Dialect                string `json:"dialect"`
	HasAlembic             bool   `json:"has_alembic"`
	AlembicRevision        string `json:"alembic_revision,omitempty"`
	LegacyRevisionKnownBad bool   `json:"legacy_revision_known_bad"`
	LegacyRevisionHandling string `json:"legacy_revision_handling,omitempty"`
	HasGoose               bool   `json:"has_goose"`
	GooseVersion           int64  `json:"goose_version"`
}

type StatusInfo struct {
	Version VersionInfo `json:"version"`
	Dirty   bool        `json:"dirty"`
	Message string      `json:"message"`
}

func New(db *sql.DB, dialect string) Runner {
	return Runner{DB: db, Dialect: NormalizeDialect(dialect)}
}

func RunMigrations(ctx context.Context, db *sql.DB, dialect string) error {
	return New(db, dialect).Run(ctx)
}

func RunMigrationsTo(ctx context.Context, db *sql.DB, dialect string, version int64) error {
	return New(db, dialect).RunTo(ctx, version)
}

func Status(ctx context.Context, db *sql.DB, dialect string) (StatusInfo, error) {
	return New(db, dialect).Status(ctx)
}

func Version(ctx context.Context, db *sql.DB, dialect string) (VersionInfo, error) {
	return New(db, dialect).Version(ctx)
}

func (r Runner) Run(ctx context.Context) error {
	return r.run(ctx, 0)
}

func (r Runner) RunTo(ctx context.Context, version int64) error {
	if version <= 0 {
		return r.Run(ctx)
	}
	return r.run(ctx, version)
}

func (r Runner) run(ctx context.Context, targetVersion int64) error {
	if r.DB == nil {
		return fmt.Errorf("database is nil")
	}
	dialect := NormalizeDialect(r.Dialect)
	if err := setGooseDialect(dialect); err != nil {
		return err
	}
	gooseMu.Lock()
	defer gooseMu.Unlock()
	migrationDialect = dialect
	defer func() { migrationDialect = "" }()
	goose.SetLogger(log.New(io.Discard, "", 0))
	goose.SetBaseFS(migrationFS)
	defer goose.SetBaseFS(nil)
	if err := r.prepareLegacyBaseline(ctx, dialect, targetVersion); err != nil {
		return err
	}
	var err error
	if targetVersion > 0 {
		err = goose.UpToContext(ctx, r.DB, "sql", targetVersion, goose.WithNoColor(true))
	} else {
		err = goose.UpContext(ctx, r.DB, "sql", goose.WithNoColor(true))
	}
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "no migration files found") {
		_, ensureErr := goose.EnsureDBVersion(r.DB)
		return ensureErr
	}
	return err
}

func (r Runner) prepareLegacyBaseline(ctx context.Context, dialect string, _ int64) error {
	hasGoose, err := HasTable(ctx, r.DB, dialect, goose.TableName())
	if err != nil {
		return err
	}
	if hasGoose {
		return nil
	}
	if err := runPreGooseLegacyRepairs(ctx, r.DB, dialect); err != nil {
		return err
	}
	hasAlembic, err := HasTable(ctx, r.DB, dialect, "alembic_version")
	if err != nil || !hasAlembic {
		return err
	}
	revision, err := readAlembicRevision(ctx, r.DB)
	if err != nil {
		return err
	}
	baseline, err := legacyGooseBaseline(ctx, r.DB, dialect, revision)
	if err != nil || baseline <= 0 {
		return err
	}
	return seedGooseBaseline(ctx, r.DB, baseline)
}

func runPreGooseLegacyRepairs(ctx context.Context, db *sql.DB, dialect string) error {
	hasUsers, err := HasTable(ctx, db, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	hasID, err := HasColumn(ctx, db, dialect, "users", "id")
	if err != nil || !hasID {
		return err
	}
	hasUsername, err := HasColumn(ctx, db, dialect, "users", "username")
	if err != nil || !hasUsername {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := normalizeUserLifecycleStatus(ctx, tx, dialect); err != nil {
		return err
	}
	if err := repairDuplicateUsernames(ctx, tx); err != nil {
		return err
	}
	if err := dropUserUsernameIndexIfPossible(ctx, tx, dialect, "ix_users_username"); err != nil {
		return err
	}
	if err := dropUserUsernameIndexIfPossible(ctx, tx, dialect, "username"); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "users", "ix_users_username", []string{"username"}, true); err != nil {
		return err
	}
	return tx.Commit()
}

func legacyGooseBaseline(ctx context.Context, db *sql.DB, dialect string, revision string) (int64, error) {
	if ok, err := schemaLooksGoLatest(ctx, db, dialect); err != nil || ok {
		if ok {
			return latestGooseVersion, nil
		}
		return 0, err
	}
	if strings.TrimSpace(revision) != legacyAlembicFinalRevision {
		return 0, nil
	}
	ok, err := schemaLooksLegacyAlembicFinal(ctx, db, dialect)
	if err != nil || !ok {
		return 0, err
	}
	return legacyAlembicFinalBaseline, nil
}

func schemaLooksGoLatest(ctx context.Context, db *sql.DB, dialect string) (bool, error) {
	checks := []struct {
		table  string
		column string
	}{
		{"nodes", "note"},
		{"users", "credential_key"},
		{"services", "users_usage"},
		{"node_operations", "idempotency_key"},
		{"telegram_settings", "backup_chat_id"},
		{"telegram_settings", "last_sent_at"},
	}
	for _, check := range checks {
		ok, err := HasColumn(ctx, db, dialect, check.table, check.column)
		if err != nil || !ok {
			return false, err
		}
	}
	hasJWTMasks, err := HasColumn(ctx, db, dialect, "jwt", "vmess_mask")
	if err != nil {
		return false, err
	}
	hasExcludedInbounds, err := HasTable(ctx, db, dialect, "exclude_inbounds_association")
	if err != nil {
		return false, err
	}
	hasHostSort, err := HasColumn(ctx, db, dialect, "hosts", "sort")
	if err != nil {
		return false, err
	}
	hasPanelNobetci, err := HasColumn(ctx, db, dialect, "panel_settings", "use_nobetci")
	if err != nil {
		return false, err
	}
	hasNodeNobetci, err := HasColumn(ctx, db, dialect, "nodes", "use_nobetci")
	if err != nil {
		return false, err
	}
	hasNodeNobetciPort, err := HasColumn(ctx, db, dialect, "nodes", "nobetci_port")
	if err != nil {
		return false, err
	}
	return !hasJWTMasks && !hasExcludedInbounds && !hasHostSort && !hasPanelNobetci && !hasNodeNobetci && !hasNodeNobetciPort, nil
}

func schemaLooksLegacyAlembicFinal(ctx context.Context, db *sql.DB, dialect string) (bool, error) {
	checks := []struct {
		table  string
		column string
	}{
		{"admins", "role"},
		{"admins", "permissions"},
		{"users", "credential_key"},
		{"users", "admin_disabled_at"},
		{"services", "users_usage"},
		{"admins_services", "traffic_limit_mode"},
		{"nodes", "xray_config_mode"},
		{"node_operations", "idempotency_key"},
		{"xray_config", "data"},
		{"subscription_settings", "subscription_path"},
		{"telegram_settings", "backup_scope"},
	}
	for _, check := range checks {
		ok, err := HasColumn(ctx, db, dialect, check.table, check.column)
		if err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

func seedGooseBaseline(ctx context.Context, db *sql.DB, baseline int64) error {
	if baseline <= 0 {
		return nil
	}
	if _, err := goose.EnsureDBVersionContext(ctx, db); err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for version := int64(1); version <= baseline; version++ {
		if _, err := tx.ExecContext(ctx, `INSERT INTO goose_db_version (version_id, is_applied) VALUES (?, ?)`, version, true); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func activeDialect() string {
	if migrationDialect == "" {
		return "sqlite"
	}
	return migrationDialect
}

func (r Runner) Status(ctx context.Context) (StatusInfo, error) {
	version, err := r.Version(ctx)
	if err != nil {
		return StatusInfo{}, err
	}
	message := "goose migrations are initialized"
	if version.LegacyRevisionKnownBad && !version.HasGoose {
		message = "known-bad legacy Alembic revision detected; Go migrations bypass the broken revision tag and run idempotent repairs"
	} else if version.HasAlembic && !version.HasGoose {
		message = "legacy alembic database detected; Go migrations have not been initialized"
	}
	return StatusInfo{Version: version, Message: message}, nil
}

func (r Runner) Version(ctx context.Context) (VersionInfo, error) {
	if r.DB == nil {
		return VersionInfo{}, fmt.Errorf("database is nil")
	}
	dialect := NormalizeDialect(r.Dialect)
	info := VersionInfo{Dialect: dialect, GooseVersion: -1}

	hasAlembic, err := HasTable(ctx, r.DB, dialect, "alembic_version")
	if err != nil {
		return VersionInfo{}, err
	}
	info.HasAlembic = hasAlembic
	if hasAlembic {
		revision, err := readAlembicRevision(ctx, r.DB)
		if err != nil {
			return VersionInfo{}, err
		}
		info.AlembicRevision = revision
		if handling := legacyAlembicRevisionHandling(revision); handling != "" {
			info.LegacyRevisionKnownBad = true
			info.LegacyRevisionHandling = handling
		}
	}

	hasGoose, err := HasTable(ctx, r.DB, dialect, "goose_db_version")
	if err != nil {
		return VersionInfo{}, err
	}
	info.HasGoose = hasGoose
	if hasGoose {
		if err := setGooseDialect(dialect); err != nil {
			return VersionInfo{}, err
		}
		gooseMu.Lock()
		version, err := goose.GetDBVersion(r.DB)
		gooseMu.Unlock()
		if err != nil {
			return VersionInfo{}, err
		}
		info.GooseVersion = version
	}
	return info, nil
}

func UnsupportedDowngrade() error {
	return fmt.Errorf("downgrade migrations are not supported")
}

func NormalizeDialect(dialect string) string {
	switch strings.ToLower(strings.TrimSpace(dialect)) {
	case "sqlite", "sqlite3":
		return "sqlite"
	case "mysql", "mariadb":
		return "mysql"
	default:
		return strings.ToLower(strings.TrimSpace(dialect))
	}
}

func setGooseDialect(dialect string) error {
	switch NormalizeDialect(dialect) {
	case "sqlite":
		return goose.SetDialect("sqlite3")
	case "mysql":
		return goose.SetDialect("mysql")
	default:
		return fmt.Errorf("unsupported migration dialect: %s", dialect)
	}
}

func readAlembicRevision(ctx context.Context, db *sql.DB) (string, error) {
	var revision sql.NullString
	err := db.QueryRowContext(ctx, `SELECT version_num FROM alembic_version LIMIT 1`).Scan(&revision)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return revision.String, nil
}

func legacyAlembicRevisionHandling(revision string) string {
	switch strings.TrimSpace(revision) {
	case "5g6h7i8j9k0l":
		return "skip broken Alembic merge/no-op revision; run all Go migrations normally"
	case "ff05a3b7cdef":
		return "skip broken Alembic direct seed; admin role repair is covered by Go migration 000004"
	default:
		return ""
	}
}
