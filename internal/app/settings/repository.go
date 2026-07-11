package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultSubscriptionType            = "key"
	defaultDashboardPath               = "/dashboard/"
	defaultPHPMyAdminPort              = 8080
	defaultPHPMyAdminPath              = "/phpmyadmin/"
	defaultPHPMyAdminLoginMode         = "rebecca"
	defaultSubscriptionProfileTitle    = "Subscription"
	defaultSubscriptionSupportURL      = "https://t.me/"
	defaultSubscriptionUpdateInterval  = "12"
	defaultClashSubscriptionTemplate   = "clash/default.yml"
	defaultClashSettingsTemplate       = "clash/settings.yml"
	defaultSubscriptionPageTemplate    = "subscription/index.html"
	defaultHomePageTemplate            = "home/index.html"
	defaultV2RaySubscriptionTemplate   = "v2ray/default.json"
	defaultV2RaySettingsTemplate       = "v2ray/settings.json"
	defaultHappSubscriptionTemplate    = "v2ray/default.json"
	defaultIncySubscriptionTemplate    = "v2ray/default.json"
	defaultSingBoxSubscriptionTemplate = "singbox/default.json"
	defaultSingBoxSettingsTemplate     = "singbox/settings.json"
	defaultMuxTemplate                 = "mux/default.json"
	defaultSubscriptionPath            = "sub"
)

var allowedSubscriptionTypes = map[string]bool{
	"username-key": true,
	"key":          true,
	"token":        true,
}

var templateKeys = map[string]bool{
	"clash_subscription_template":   true,
	"clash_settings_template":       true,
	"subscription_page_template":    true,
	"home_page_template":            true,
	"v2ray_subscription_template":   true,
	"v2ray_settings_template":       true,
	"happ_subscription_template":    true,
	"incy_subscription_template":    true,
	"singbox_subscription_template": true,
	"singbox_settings_template":     true,
	"mux_template":                  true,
}

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) PanelSettings(ctx context.Context) (PanelSettings, error) {
	if err := r.ensurePanelDefaultSubscriptionTypeColumn(ctx); err != nil {
		return PanelSettings{}, err
	}
	if err := r.ensurePanelRecord(ctx); err != nil {
		return PanelSettings{}, err
	}
	return r.panelSettings(ctx)
}

func (r Repository) UpdatePanelSettings(ctx context.Context, raw map[string]json.RawMessage) (PanelSettings, error) {
	if err := r.ensurePanelDefaultSubscriptionTypeColumn(ctx); err != nil {
		return PanelSettings{}, err
	}
	if err := r.ensurePanelRecord(ctx); err != nil {
		return PanelSettings{}, err
	}
	sets := []string{}
	args := []any{}
	if value, ok := raw["default_subscription_type"]; ok {
		incoming := strings.TrimSpace(rawStringDefault(value, ""))
		if allowedSubscriptionTypes[incoming] {
			sets = append(sets, "default_subscription_type = ?")
			args = append(args, incoming)
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = ?")
		args = append(args, dbTime(time.Now().UTC()))
		args = append(args, r.panelRecordID(ctx))
		if _, err := r.db.ExecContext(ctx, "UPDATE panel_settings SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return PanelSettings{}, err
		}
	}
	return r.panelSettings(ctx)
}

func (r Repository) RuntimeSettings(ctx context.Context) (RuntimeSettings, error) {
	if err := r.ensureRuntimeSettingsRecord(ctx); err != nil {
		return RuntimeSettings{}, err
	}
	return r.runtimeSettings(ctx)
}

func (r Repository) UpdateRuntimeSettings(ctx context.Context, raw map[string]json.RawMessage) (RuntimeSettings, error) {
	if err := r.ensureRuntimeSettingsRecord(ctx); err != nil {
		return RuntimeSettings{}, err
	}
	sets := []string{}
	args := []any{}
	add := func(column string, value any) {
		sets = append(sets, column+" = ?")
		args = append(args, value)
	}
	for key, value := range raw {
		switch key {
		case "dashboard_path":
			add(key, normalizeDashboardPath(rawStringDefault(value, defaultDashboardPath)))
		case "phpmyadmin_port":
			add(key, normalizePort(rawIntDefault(value, defaultPHPMyAdminPort), defaultPHPMyAdminPort))
		case "phpmyadmin_path":
			add(key, normalizeURLPath(rawStringDefault(value, defaultPHPMyAdminPath), defaultPHPMyAdminPath))
		case "phpmyadmin_public_url":
			add(key, strings.TrimSpace(rawStringDefault(value, "")))
		case "phpmyadmin_login_mode":
			add(key, normalizePHPMyAdminLoginMode(rawStringDefault(value, defaultPHPMyAdminLoginMode)))
		case "phpmyadmin_username":
			add(key, strings.TrimSpace(rawStringDefault(value, "")))
		case "phpmyadmin_password":
			add(key, rawStringDefault(value, ""))
		case "record_node_usage", "record_node_user_usages", "subscription_read_only", "api_docs_enabled":
			add(key, rawBoolDefault(value, false))
		case "phpmyadmin_enabled":
			add(key, rawBoolDefault(value, false))
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = ?")
		args = append(args, dbTime(time.Now().UTC()))
		args = append(args, 1)
		if _, err := r.db.ExecContext(ctx, "UPDATE settings SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return RuntimeSettings{}, err
		}
	}
	return r.runtimeSettings(ctx)
}

func (r Repository) SubscriptionBundle(ctx context.Context) (SubscriptionBundle, error) {
	settings, err := r.SubscriptionSettings(ctx)
	if err != nil {
		return SubscriptionBundle{}, err
	}
	admins, err := r.adminSubscriptionSettings(ctx)
	if err != nil {
		return SubscriptionBundle{}, err
	}
	certificates, err := r.subscriptionCertificates(ctx)
	if err != nil {
		return SubscriptionBundle{}, err
	}
	return SubscriptionBundle{Settings: settings, Admins: admins, Certificates: certificates}, nil
}

func (r Repository) SubscriptionSettings(ctx context.Context) (SubscriptionSettings, error) {
	if err := r.ensureSubscriptionRecord(ctx); err != nil {
		return SubscriptionSettings{}, err
	}
	return r.subscriptionSettings(ctx)
}

func (r Repository) UpdateSubscriptionSettings(ctx context.Context, raw map[string]json.RawMessage) (SubscriptionSettings, error) {
	if err := r.ensureSubscriptionRecord(ctx); err != nil {
		return SubscriptionSettings{}, err
	}
	sets := []string{}
	args := []any{}
	add := func(column string, value any) {
		sets = append(sets, column+" = ?")
		args = append(args, value)
	}
	for key, value := range raw {
		switch key {
		case "subscription_url_prefix":
			add(key, normalizePrefix(rawStringDefault(value, "")))
		case "subscription_support_url":
			add(key, normalizeSupportURL(rawStringDefault(value, "")))
		case "subscription_profile_title", "subscription_update_interval":
			add(key, strings.TrimSpace(rawStringDefault(value, "")))
		case "subscription_path":
			add(key, normalizePath(rawStringDefault(value, "")))
		case "subscription_aliases":
			aliases, err := rawStringList(value)
			if err != nil {
				return SubscriptionSettings{}, fmt.Errorf("subscription_aliases must be a list")
			}
			encoded, _ := json.Marshal(normalizeAliases(aliases))
			add(key, string(encoded))
		case "subscription_ports":
			ports, err := rawIntList(value)
			if err != nil {
				return SubscriptionSettings{}, fmt.Errorf("subscription_ports must be a list")
			}
			encoded, _ := json.Marshal(normalizePorts(ports))
			add(key, string(encoded))
		case "use_custom_json_default", "use_custom_json_for_v2rayn", "use_custom_json_for_v2rayng", "use_custom_json_for_streisand", "use_custom_json_for_happ", "use_custom_json_for_incy":
			add(key, rawBoolDefault(value, false))
		case "custom_templates_directory":
			if string(value) == "null" {
				add(key, nil)
			} else {
				add(key, strings.TrimSpace(rawStringDefault(value, "")))
			}
		case "clash_subscription_template", "clash_settings_template", "subscription_page_template", "home_page_template", "v2ray_subscription_template", "v2ray_settings_template", "happ_subscription_template", "incy_subscription_template", "singbox_subscription_template", "singbox_settings_template", "mux_template":
			if string(value) == "null" {
				continue
			}
			templateName, err := normalizeTemplateName(rawStringDefault(value, ""))
			if err != nil {
				return SubscriptionSettings{}, fmt.Errorf("%s: %w", key, err)
			}
			add(key, templateName)
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = ?")
		args = append(args, dbTime(time.Now().UTC()))
		args = append(args, r.subscriptionRecordID(ctx))
		if _, err := r.db.ExecContext(ctx, "UPDATE subscription_settings SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return SubscriptionSettings{}, err
		}
	}
	return r.subscriptionSettings(ctx)
}

func (r Repository) UpdateAdminSubscriptionSettings(ctx context.Context, adminID int64, raw map[string]json.RawMessage) (AdminSubscriptionSettings, error) {
	exists, err := r.adminExists(ctx, adminID)
	if err != nil {
		return AdminSubscriptionSettings{}, err
	}
	if !exists {
		return AdminSubscriptionSettings{}, ErrAdminNotFound
	}
	sets := []string{}
	args := []any{}
	if value, ok := raw["subscription_domain"]; ok {
		var domain *string
		if string(value) != "null" {
			trimmed := strings.TrimSpace(rawStringDefault(value, ""))
			if trimmed != "" {
				domain = &trimmed
			}
		}
		sets = append(sets, "subscription_domain = ?")
		args = append(args, nullableString(domain))
	}
	if value, ok := raw["subscription_settings"]; ok {
		settingsMap := map[string]any{}
		if string(value) != "null" {
			if err := json.Unmarshal(value, &settingsMap); err != nil {
				return AdminSubscriptionSettings{}, err
			}
			if settingsMap == nil {
				settingsMap = map[string]any{}
			}
		}
		encoded, _ := json.Marshal(settingsMap)
		sets = append(sets, "subscription_settings = ?")
		args = append(args, string(encoded))
	}
	if len(sets) > 0 {
		args = append(args, adminID)
		if _, err := r.db.ExecContext(ctx, "UPDATE admins SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return AdminSubscriptionSettings{}, err
		}
	}
	admin, err := r.adminSubscriptionSetting(ctx, adminID)
	if err != nil {
		return AdminSubscriptionSettings{}, err
	}
	return admin, nil
}

var ErrAdminNotFound = errors.New("admin not found")
var ErrUnsupportedTemplateKey = errors.New("unsupported template key")

func (r Repository) panelSettings(ctx context.Context) (PanelSettings, error) {
	var defaultType sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE(default_subscription_type, 'key') FROM panel_settings ORDER BY id DESC LIMIT 1`).Scan(&defaultType)
	if err != nil {
		return PanelSettings{}, err
	}
	result := PanelSettings{DefaultSubscriptionType: defaultType.String}
	if !allowedSubscriptionTypes[result.DefaultSubscriptionType] {
		result.DefaultSubscriptionType = defaultSubscriptionType
	}
	return result, nil
}

func (r Repository) runtimeSettings(ctx context.Context) (RuntimeSettings, error) {
	var result RuntimeSettings
	err := r.db.QueryRowContext(ctx, `
SELECT
	COALESCE(dashboard_path, '/dashboard/'),
	COALESCE(record_node_usage, 1),
	COALESCE(record_node_user_usages, 1),
	COALESCE(subscription_read_only, 0),
	COALESCE(api_docs_enabled, 0),
	COALESCE(phpmyadmin_enabled, 0),
	COALESCE(phpmyadmin_port, 8080),
	COALESCE(phpmyadmin_path, '/phpmyadmin/'),
	COALESCE(phpmyadmin_public_url, ''),
	COALESCE(phpmyadmin_login_mode, 'rebecca'),
	COALESCE(phpmyadmin_username, ''),
	COALESCE(phpmyadmin_password, '')
FROM settings
WHERE id = 1
LIMIT 1`).Scan(
		&result.DashboardPath,
		&result.RecordNodeUsage,
		&result.RecordNodeUserUsages,
		&result.SubscriptionReadOnly,
		&result.APIDocsEnabled,
		&result.PHPMyAdminEnabled,
		&result.PHPMyAdminPort,
		&result.PHPMyAdminPath,
		&result.PHPMyAdminPublicURL,
		&result.PHPMyAdminLoginMode,
		&result.PHPMyAdminUsername,
		&result.PHPMyAdminPassword,
	)
	if err != nil {
		return RuntimeSettings{}, err
	}
	result.DashboardPath = normalizeDashboardPath(result.DashboardPath)
	result.PHPMyAdminPort = normalizePort(result.PHPMyAdminPort, defaultPHPMyAdminPort)
	result.PHPMyAdminPath = normalizeURLPath(result.PHPMyAdminPath, defaultPHPMyAdminPath)
	result.PHPMyAdminLoginMode = normalizePHPMyAdminLoginMode(result.PHPMyAdminLoginMode)
	return result, nil
}

func (r Repository) ensureRuntimeSettingsRecord(ctx context.Context) error {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM settings WHERE id = 1`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `
INSERT INTO settings (
	id,
	dashboard_path,
	record_node_usage,
	record_node_user_usages,
	subscription_read_only,
	api_docs_enabled,
	phpmyadmin_enabled,
	phpmyadmin_port,
	phpmyadmin_path,
	phpmyadmin_public_url,
	phpmyadmin_login_mode,
	phpmyadmin_username,
	phpmyadmin_password,
	created_at,
	updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		1,
		defaultDashboardPath,
		true,
		true,
		false,
		false,
		false,
		defaultPHPMyAdminPort,
		defaultPHPMyAdminPath,
		"",
		defaultPHPMyAdminLoginMode,
		"",
		"",
		dbTime(time.Now().UTC()),
		dbTime(time.Now().UTC()),
	)
	return err
}

func (r Repository) ensurePanelRecord(ctx context.Context) error {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM panel_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `INSERT INTO panel_settings (default_subscription_type, created_at, updated_at) VALUES (?, ?, ?)`, defaultSubscriptionType, dbTime(time.Now().UTC()), dbTime(time.Now().UTC()))
	return err
}

func (r Repository) ensurePanelDefaultSubscriptionTypeColumn(ctx context.Context) error {
	if r.dialect != "sqlite" && r.dialect != "mysql" {
		return nil
	}
	var probe any
	err := r.db.QueryRowContext(ctx, `SELECT default_subscription_type FROM panel_settings LIMIT 1`).Scan(&probe)
	if err == nil || errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if !strings.Contains(strings.ToLower(err.Error()), "default_subscription_type") {
		return nil
	}
	_, alterErr := r.db.ExecContext(ctx, `ALTER TABLE panel_settings ADD COLUMN default_subscription_type VARCHAR(32) NOT NULL DEFAULT 'key'`)
	return alterErr
}

func (r Repository) panelRecordID(ctx context.Context) int64 {
	var id int64
	_ = r.db.QueryRowContext(ctx, `SELECT id FROM panel_settings ORDER BY id DESC LIMIT 1`).Scan(&id)
	return id
}

func (r Repository) subscriptionSettings(ctx context.Context) (SubscriptionSettings, error) {
	row := r.db.QueryRowContext(ctx, `SELECT
subscription_url_prefix,
subscription_profile_title,
subscription_support_url,
subscription_update_interval,
custom_templates_directory,
clash_subscription_template,
clash_settings_template,
subscription_page_template,
home_page_template,
v2ray_subscription_template,
v2ray_settings_template,
happ_subscription_template,
incy_subscription_template,
singbox_subscription_template,
singbox_settings_template,
mux_template,
COALESCE(use_custom_json_default, 0),
COALESCE(use_custom_json_for_v2rayn, 0),
COALESCE(use_custom_json_for_v2rayng, 0),
COALESCE(use_custom_json_for_streisand, 0),
COALESCE(use_custom_json_for_happ, 0),
COALESCE(use_custom_json_for_incy, 0),
subscription_path,
subscription_aliases,
subscription_ports
FROM subscription_settings ORDER BY id DESC LIMIT 1`)
	var result SubscriptionSettings
	var customDir sql.NullString
	var aliasesRaw, portsRaw sql.NullString
	var useDefault, useV2RayN, useV2RayNG, useStreisand, useHapp, useIncy sql.NullBool
	if err := row.Scan(
		&result.SubscriptionURLPrefix,
		&result.SubscriptionProfileTitle,
		&result.SubscriptionSupportURL,
		&result.SubscriptionUpdateInterval,
		&customDir,
		&result.ClashSubscriptionTemplate,
		&result.ClashSettingsTemplate,
		&result.SubscriptionPageTemplate,
		&result.HomePageTemplate,
		&result.V2RaySubscriptionTemplate,
		&result.V2RaySettingsTemplate,
		&result.HappSubscriptionTemplate,
		&result.IncySubscriptionTemplate,
		&result.SingBoxSubscriptionTemplate,
		&result.SingBoxSettingsTemplate,
		&result.MuxTemplate,
		&useDefault,
		&useV2RayN,
		&useV2RayNG,
		&useStreisand,
		&useHapp,
		&useIncy,
		&result.SubscriptionPath,
		&aliasesRaw,
		&portsRaw,
	); err != nil {
		return SubscriptionSettings{}, err
	}
	if customDir.Valid {
		result.CustomTemplatesDirectory = &customDir.String
	}
	result.UseCustomJSONDefault = useDefault.Valid && useDefault.Bool
	result.UseCustomJSONForV2RayN = useV2RayN.Valid && useV2RayN.Bool
	result.UseCustomJSONForV2RayNG = useV2RayNG.Valid && useV2RayNG.Bool
	result.UseCustomJSONForStreisand = useStreisand.Valid && useStreisand.Bool
	result.UseCustomJSONForHapp = useHapp.Valid && useHapp.Bool
	result.UseCustomJSONForIncy = useIncy.Valid && useIncy.Bool
	result.SubscriptionURLPrefix = normalizePrefix(result.SubscriptionURLPrefix)
	result.SubscriptionSupportURL = normalizeSupportURL(result.SubscriptionSupportURL)
	result.SubscriptionPath = normalizePath(result.SubscriptionPath)
	result.SubscriptionAliases = decodeStringArray(aliasesRaw.String)
	result.SubscriptionPorts = decodeIntArray(portsRaw.String)
	applySubscriptionDefaults(&result)
	return result, nil
}

func (r Repository) ensureSubscriptionRecord(ctx context.Context) error {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM subscription_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := dbTime(time.Now().UTC())
	_, err := r.db.ExecContext(ctx, `INSERT INTO subscription_settings (
subscription_url_prefix,
subscription_profile_title,
subscription_support_url,
subscription_update_interval,
custom_templates_directory,
clash_subscription_template,
clash_settings_template,
subscription_page_template,
home_page_template,
v2ray_subscription_template,
v2ray_settings_template,
happ_subscription_template,
incy_subscription_template,
singbox_subscription_template,
singbox_settings_template,
mux_template,
use_custom_json_default,
use_custom_json_for_v2rayn,
use_custom_json_for_v2rayng,
use_custom_json_for_streisand,
use_custom_json_for_happ,
use_custom_json_for_incy,
subscription_path,
subscription_aliases,
subscription_ports,
created_at,
updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"",
		defaultSubscriptionProfileTitle,
		defaultSubscriptionSupportURL,
		defaultSubscriptionUpdateInterval,
		nil,
		defaultClashSubscriptionTemplate,
		defaultClashSettingsTemplate,
		defaultSubscriptionPageTemplate,
		defaultHomePageTemplate,
		defaultV2RaySubscriptionTemplate,
		defaultV2RaySettingsTemplate,
		defaultHappSubscriptionTemplate,
		defaultIncySubscriptionTemplate,
		defaultSingBoxSubscriptionTemplate,
		defaultSingBoxSettingsTemplate,
		defaultMuxTemplate,
		false,
		false,
		false,
		false,
		false,
		false,
		defaultSubscriptionPath,
		"[]",
		"[]",
		now,
		now,
	)
	return err
}

func (r Repository) subscriptionRecordID(ctx context.Context) int64 {
	var id int64
	_ = r.db.QueryRowContext(ctx, `SELECT id FROM subscription_settings ORDER BY id DESC LIMIT 1`).Scan(&id)
	return id
}

func (r Repository) adminSubscriptionSettings(ctx context.Context) ([]AdminSubscriptionSettings, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, username, subscription_domain, subscription_settings FROM admins WHERE COALESCE(status, '') != 'deleted' ORDER BY username ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []AdminSubscriptionSettings{}
	for rows.Next() {
		item, err := scanAdminSubscription(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r Repository) adminSubscriptionSetting(ctx context.Context, adminID int64) (AdminSubscriptionSettings, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, username, subscription_domain, subscription_settings FROM admins WHERE id = ? LIMIT 1`, adminID)
	return scanAdminSubscription(row)
}

func (r Repository) adminExists(ctx context.Context, adminID int64) (bool, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `SELECT id FROM admins WHERE id = ? LIMIT 1`, adminID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAdminSubscription(row scanner) (AdminSubscriptionSettings, error) {
	var item AdminSubscriptionSettings
	var domain sql.NullString
	var rawSettings sql.NullString
	if err := row.Scan(&item.ID, &item.Username, &domain, &rawSettings); err != nil {
		return item, err
	}
	if domain.Valid {
		item.SubscriptionDomain = &domain.String
	}
	item.SubscriptionSettings = map[string]any{}
	if strings.TrimSpace(rawSettings.String) != "" {
		_ = json.Unmarshal([]byte(rawSettings.String), &item.SubscriptionSettings)
		if item.SubscriptionSettings == nil {
			item.SubscriptionSettings = map[string]any{}
		}
	}
	return item, nil
}

func (r Repository) subscriptionCertificates(ctx context.Context) ([]SubscriptionCertificate, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, domain, admin_id, email, provider, alt_names, last_issued_at, last_renewed_at FROM subscription_domains ORDER BY domain ASC`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			return []SubscriptionCertificate{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	result := []SubscriptionCertificate{}
	for rows.Next() {
		var item SubscriptionCertificate
		var id, adminID sql.NullInt64
		var email, provider, altNames, issued, renewed sql.NullString
		if err := rows.Scan(&id, &item.Domain, &adminID, &email, &provider, &altNames, &issued, &renewed); err != nil {
			return nil, err
		}
		if id.Valid {
			item.ID = &id.Int64
		}
		if adminID.Valid {
			item.AdminID = &adminID.Int64
		}
		if email.Valid {
			item.Email = &email.String
		}
		if provider.Valid {
			item.Provider = &provider.String
		}
		item.AltNames = decodeStringArray(altNames.String)
		if issued.Valid {
			item.LastIssuedAt = &issued.String
		}
		if renewed.Valid {
			item.LastRenewedAt = &renewed.String
		}
		item.Path = certificatePath(item.Domain)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r Repository) ReadTemplateContent(ctx context.Context, templateKey string, adminID *int64) (TemplateContent, error) {
	if !templateKeys[templateKey] {
		return TemplateContent{}, fmt.Errorf("%w: %s", ErrUnsupportedTemplateKey, templateKey)
	}
	if err := r.ensureSubscriptionRecord(ctx); err != nil {
		return TemplateContent{}, err
	}
	selection, err := r.templateSelection(ctx, templateKey, adminID)
	if err != nil {
		return TemplateContent{}, err
	}
	if adminID != nil {
		if content, ok, err := r.readTemplateSelection(templateKey, adminID, selection, true); err != nil || ok {
			return content, err
		}
		globalSelection, err := r.templateSelection(ctx, templateKey, nil)
		if err != nil {
			return TemplateContent{}, err
		}
		if content, ok, err := r.readTemplateSelection(templateKey, nil, globalSelection, true); err != nil || ok {
			return content, err
		}
		if content, ok, err := r.readTemplateSelection(templateKey, adminID, selection, false); err != nil || ok {
			return content, err
		}
		return r.emptyTemplateContent(templateKey, globalSelection, nil), nil
	}
	if content, ok, err := r.readTemplateSelection(templateKey, adminID, selection, true); err != nil || ok {
		return content, err
	}
	if content, ok, err := r.readTemplateSelection(templateKey, adminID, selection, false); err != nil || ok {
		return content, err
	}
	return r.emptyTemplateContent(templateKey, selection, adminID), nil
}

func (r Repository) readTemplateSelection(templateKey string, adminID *int64, selection templateSelection, customOnly bool) (TemplateContent, bool, error) {
	var path string
	var err error
	if customOnly {
		path, err = resolveCustomTemplatePath(selection.TemplateName, selection.CustomDirectory, adminID)
	} else {
		path, err = resolveAppTemplatePath(selection.TemplateName)
	}
	if err != nil {
		if errors.Is(err, ErrTemplateNotFound) {
			return TemplateContent{}, false, nil
		}
		return TemplateContent{}, false, err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return TemplateContent{}, false, fmt.Errorf("unable to load template %s: %w", selection.TemplateName, err)
	}
	contentText := strings.ReplaceAll(string(content), "\r\n", "\n")
	resolved := displayTemplatePath(path, selection.TemplateName, selection.CustomDirectory)
	return TemplateContent{
		TemplateKey:     templateKey,
		TemplateName:    selection.TemplateName,
		CustomDirectory: selection.CustomDirectory,
		ResolvedPath:    &resolved,
		AdminID:         adminID,
		Content:         contentText,
	}, true, nil
}

func (r Repository) emptyTemplateContent(templateKey string, selection templateSelection, adminID *int64) TemplateContent {
	resolved := displayTemplatePath(filepath.Join(appTemplateBasePath(), selection.TemplateName), selection.TemplateName, selection.CustomDirectory)
	return TemplateContent{
		TemplateKey:     templateKey,
		TemplateName:    selection.TemplateName,
		CustomDirectory: selection.CustomDirectory,
		ResolvedPath:    &resolved,
		AdminID:         adminID,
		Content:         "",
	}
}

func (r Repository) WriteTemplateContent(ctx context.Context, templateKey string, adminID *int64, content string) (TemplateContent, error) {
	if !templateKeys[templateKey] {
		return TemplateContent{}, fmt.Errorf("%w: %s", ErrUnsupportedTemplateKey, templateKey)
	}
	if err := r.ensureSubscriptionRecord(ctx); err != nil {
		return TemplateContent{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return TemplateContent{}, err
	}
	defer func() { _ = tx.Rollback() }()

	selection, err := r.templateSelectionTx(ctx, tx, templateKey, adminID)
	if err != nil {
		return TemplateContent{}, err
	}
	customDir := selection.CustomDirectory
	if customDir == nil || strings.TrimSpace(*customDir) == "" {
		dir := persistentTemplateDirectory(adminID)
		customDir = &dir
		now := dbTime(time.Now().UTC())
		if adminID != nil {
			overrides, err := r.adminSubscriptionSettingsMapTx(ctx, tx, *adminID)
			if err != nil {
				return TemplateContent{}, err
			}
			overrides["custom_templates_directory"] = dir
			encoded, _ := json.Marshal(overrides)
			if _, err := tx.ExecContext(ctx, `UPDATE admins SET subscription_settings = ? WHERE id = ?`, string(encoded), *adminID); err != nil {
				return TemplateContent{}, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE subscription_settings SET custom_templates_directory = ?, updated_at = ? WHERE id = ?`, dir, now, r.subscriptionRecordIDTx(ctx, tx)); err != nil {
				return TemplateContent{}, err
			}
		}
	}

	targetPath, err := resolveWritableTemplatePath(selection.TemplateName, *customDir)
	if err != nil {
		return TemplateContent{}, err
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return TemplateContent{}, fmt.Errorf("unable to write template %s: %w", selection.TemplateName, err)
	}
	if err := os.WriteFile(targetPath, []byte(content), 0o644); err != nil {
		return TemplateContent{}, fmt.Errorf("unable to write template %s: %w", selection.TemplateName, err)
	}
	if err := tx.Commit(); err != nil {
		return TemplateContent{}, err
	}
	return r.ReadTemplateContent(ctx, templateKey, adminID)
}

type templateSelection struct {
	TemplateName    string
	CustomDirectory *string
}

func (r Repository) templateSelection(ctx context.Context, templateKey string, adminID *int64) (templateSelection, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return templateSelection{}, err
	}
	defer func() { _ = tx.Rollback() }()
	selection, err := r.templateSelectionTx(ctx, tx, templateKey, adminID)
	if err != nil {
		return templateSelection{}, err
	}
	if err := tx.Commit(); err != nil {
		return templateSelection{}, err
	}
	return selection, nil
}

func (r Repository) templateSelectionTx(ctx context.Context, tx *sql.Tx, templateKey string, adminID *int64) (templateSelection, error) {
	if adminID != nil {
		exists, err := r.adminExistsTx(ctx, tx, *adminID)
		if err != nil {
			return templateSelection{}, err
		}
		if !exists {
			return templateSelection{}, ErrAdminNotFound
		}
	}
	var columns subscriptionTemplateColumns
	var customDir sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT clash_subscription_template, clash_settings_template, subscription_page_template, home_page_template, v2ray_subscription_template, v2ray_settings_template, happ_subscription_template, incy_subscription_template, singbox_subscription_template, singbox_settings_template, mux_template, custom_templates_directory FROM subscription_settings ORDER BY id DESC LIMIT 1`).
		Scan(
			&columns.ClashSubscription,
			&columns.ClashSettings,
			&columns.SubscriptionPage,
			&columns.HomePage,
			&columns.V2RaySubscription,
			&columns.V2RaySettings,
			&columns.HappSubscription,
			&columns.IncySubscription,
			&columns.SingBoxSubscription,
			&columns.SingBoxSettings,
			&columns.Mux,
			&customDir,
		); err != nil {
		return templateSelection{}, err
	}
	templateName := columns.value(templateKey)
	var custom *string
	if customDir.Valid {
		custom = &customDir.String
	}
	if adminID != nil {
		overrides, err := r.adminSubscriptionSettingsMapTx(ctx, tx, *adminID)
		if err != nil {
			return templateSelection{}, err
		}
		if value, ok := stringFromMap(overrides, templateKey); ok && strings.TrimSpace(value) != "" {
			templateName = strings.TrimSpace(value)
		}
		if value, ok := stringFromMap(overrides, "custom_templates_directory"); ok && strings.TrimSpace(value) != "" {
			trimmed := strings.TrimSpace(value)
			custom = &trimmed
		}
	}
	return templateSelection{TemplateName: templateName, CustomDirectory: custom}, nil
}

type subscriptionTemplateColumns struct {
	ClashSubscription   string
	ClashSettings       string
	SubscriptionPage    string
	HomePage            string
	V2RaySubscription   string
	V2RaySettings       string
	HappSubscription    string
	IncySubscription    string
	SingBoxSubscription string
	SingBoxSettings     string
	Mux                 string
}

func (c subscriptionTemplateColumns) value(templateKey string) string {
	switch templateKey {
	case "clash_subscription_template":
		return c.ClashSubscription
	case "clash_settings_template":
		return c.ClashSettings
	case "subscription_page_template":
		return c.SubscriptionPage
	case "home_page_template":
		return c.HomePage
	case "v2ray_subscription_template":
		return c.V2RaySubscription
	case "v2ray_settings_template":
		return c.V2RaySettings
	case "happ_subscription_template":
		return c.HappSubscription
	case "incy_subscription_template":
		return c.IncySubscription
	case "singbox_subscription_template":
		return c.SingBoxSubscription
	case "singbox_settings_template":
		return c.SingBoxSettings
	case "mux_template":
		return c.Mux
	default:
		return ""
	}
}

func (r Repository) adminExistsTx(ctx context.Context, tx *sql.Tx, adminID int64) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM admins WHERE id = ? LIMIT 1`, adminID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (r Repository) adminSubscriptionSettingsMapTx(ctx context.Context, tx *sql.Tx, adminID int64) (map[string]any, error) {
	var raw sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT subscription_settings FROM admins WHERE id = ? LIMIT 1`, adminID).Scan(&raw); err != nil {
		return nil, err
	}
	result := map[string]any{}
	if strings.TrimSpace(raw.String) != "" {
		_ = json.Unmarshal([]byte(raw.String), &result)
	}
	if result == nil {
		result = map[string]any{}
	}
	return result, nil
}

func (r Repository) subscriptionRecordIDTx(ctx context.Context, tx *sql.Tx) int64 {
	var id int64
	_ = tx.QueryRowContext(ctx, `SELECT id FROM subscription_settings ORDER BY id DESC LIMIT 1`).Scan(&id)
	return id
}
