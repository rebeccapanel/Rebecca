package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()

	r.HandleFunc("/__rebecca_api/healthz", s.handleHealth)
	if s.cfg.APIDocsEnabled {
		r.HandleFunc("/openapi.json", s.handleOpenAPIJSON)
		r.HandleFunc("/docs", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			http.Redirect(w, r, "/docs/", http.StatusMovedPermanently)
		})
		r.Handle("/docs/*", swaggerUIHandler())
	} else {
		r.HandleFunc("/openapi.json", s.handleDocsDisabled)
		r.HandleFunc("/docs", s.handleDocsDisabled)
		r.HandleFunc("/docs/*", s.handleDocsDisabled)
	}
	r.HandleFunc("/admin/token", s.handleAdminToken)
	r.HandleFunc("/internal/admin/validate", s.handleInternalAdminValidate)
	r.HandleFunc("/internal/node/session-event", s.handleNodeSessionEvent)
	r.HandleFunc("/xray/*", s.requireSudo(s.handleXrayHelperPath))
	r.HandleFunc("/inbounds/full", s.requireSudo(s.handleInboundsFull))
	r.HandleFunc("/inbounds/*", s.requireSudo(s.handleInboundPath))
	r.HandleFunc("/inbounds", s.handleInboundsRootEntry)
	r.HandleFunc("/hosts/*", s.requireAdmin(s.handleHostStatusPath))
	r.HandleFunc("/hosts", s.requireAdmin(s.handleHostsRoot))
	r.HandleFunc("/sub/*", s.handleSubscriptionPath)

	r.Route("/api", func(r chi.Router) {
		s.registerAdminRoutes(r)
		s.registerMyAccountRoutes(r)
		s.registerCoreRoutes(r)
		s.registerConfigRoutes(r)
		s.registerInboundHostRoutes(r)
		s.registerSystemRoutes(r)
		s.registerSettingsRoutes(r)
		s.registerServiceRoutes(r)
		s.registerUserRoutes(r)
		s.registerPanelXrayRoutes(r)
		s.registerSubscriptionRoutes(r)
		s.registerNodeRoutes(r)
	})

	r.NotFound(s.handleHomeOrSubscriptionPath)
	return r
}

func (s *Server) registerAdminRoutes(r chi.Router) {
	r.HandleFunc("/auth/login", s.requireSameOrigin(s.handleAuthLogin))
	r.HandleFunc("/auth/session", s.handleAuthSession)
	r.HandleFunc("/auth/logout", s.requireSameOrigin(s.handleAuthLogout))
	r.HandleFunc("/auth/2fa/verify", s.requireSameOrigin(s.handleAuthVerify2FA))
	r.HandleFunc("/auth/2fa/setup", s.requireSameOrigin(s.handleAuth2FA))
	r.HandleFunc("/auth/2fa/confirm", s.requireSameOrigin(s.handleAuth2FA))
	r.HandleFunc("/auth/2fa", s.requireSameOrigin(s.handleAuth2FA))
	r.HandleFunc("/auth/sessions/*", s.requireSameOrigin(s.handleAuthSessions))
	r.HandleFunc("/auth/sessions", s.requireSameOrigin(s.handleAuthSessions))
	r.HandleFunc("/admin/token", s.handleAdminToken)
	r.HandleFunc("/admin/permissions/standard/bulk", s.requireAdmin(s.handleBulkStandardPermissions))
	r.HandleFunc("/admin/usage/reset/*", s.requireAdmin(s.handleAdminUsageResetPath))
	r.HandleFunc("/admin/usage/*", s.requireAdmin(s.handleAdminUsageValuePath))
	r.HandleFunc("/admin/*", s.requireAdmin(s.handleAdminMutationPath))
	r.HandleFunc("/admin", s.requireAdmin(s.handleAdminRoot))
	r.HandleFunc("/admins", s.requireAdmin(s.handleAdminsList))
}

func (s *Server) registerMyAccountRoutes(r chi.Router) {
	r.HandleFunc("/myaccount/change_password", s.requireAdmin(s.handleMyAccountChangePassword))
	r.HandleFunc("/myaccount/api-keys/*", s.requireAdmin(s.handleMyAccountAPIKeyPath))
	r.HandleFunc("/myaccount/api-keys", s.requireAdmin(s.handleMyAccountAPIKeys))
	r.HandleFunc("/myaccount/nodes", s.requireAdmin(s.handleMyAccountNodes))
	r.HandleFunc("/myaccount", s.requireAdmin(s.handleMyAccount))
}

func (s *Server) registerCoreRoutes(r chi.Router) {
	r.HandleFunc("/core/access/*", s.requireAdmin(s.handleCoreAccessPath))
	r.HandleFunc("/core/logs", s.requireSudo(s.handleRuntimeLogsWebSocket))
	r.HandleFunc("/core/restart", s.requireSudo(s.handleCoreRestart))
	r.HandleFunc("/core/ips", s.requireAdmin(s.handleCoreIPs))
	r.HandleFunc("/core/xray/releases", s.requireSudo(s.handleCoreXrayReleases))
	r.HandleFunc("/core/geo/templates", s.requireSudo(s.handleGeoTemplates))
	r.HandleFunc("/core/geo/apply", s.requireSudo(s.handleGeoApply))
	r.HandleFunc("/core/geo/update", s.requireSudo(s.handleGeoApply))
	r.HandleFunc("/core/warp/register", s.requireSudo(s.handleWarpRegister))
	r.HandleFunc("/core/warp/license", s.requireSudo(s.handleWarpLicense))
	r.HandleFunc("/core/warp/config", s.requireSudo(s.handleWarpConfig))
	r.HandleFunc("/core/warp", s.requireSudo(s.handleWarpAccount))
	r.HandleFunc("/core", s.requireAdmin(s.handleCoreRuntime))
	r.HandleFunc("/xray/*", s.requireSudo(s.handleXrayHelperPath))
}

func (s *Server) registerConfigRoutes(r chi.Router) {
	r.HandleFunc("/core/config/targets/*", s.requireSudo(s.handleCoreConfigTargetPath))
	r.HandleFunc("/core/config/targets", s.requireSudo(s.handleCoreConfigTargets))
	r.HandleFunc("/core/config", s.requireSudo(s.handleCoreConfig))
}

func (s *Server) registerInboundHostRoutes(r chi.Router) {
	r.HandleFunc("/inbounds/full", s.requireSudo(s.handleInboundsFull))
	r.HandleFunc("/inbounds/openvpn/runtime", s.requireSudo(s.handleOVRuntime))
	r.HandleFunc("/inbounds/*", s.requireSudo(s.handleInboundPath))
	r.HandleFunc("/inbounds", s.handleInboundsRootEntry)
	r.HandleFunc("/hosts/*", s.requireAdmin(s.handleHostStatusPath))
	r.HandleFunc("/hosts", s.requireAdmin(s.handleHostsRoot))
}

func (s *Server) registerSystemRoutes(r chi.Router) {
	r.HandleFunc("/system/metrics", s.requireAdmin(s.handleSystemMetricsWebSocket))
	r.HandleFunc("/system", s.requireAdmin(s.handleSystemStats))
	r.HandleFunc("/maintenance/info", s.requireSudo(s.handleMaintenanceInfo))
	r.HandleFunc("/maintenance/status", s.requireSudo(s.handleMaintenanceStatus))
	r.HandleFunc("/maintenance/update", s.requireSudo(s.handleMaintenanceUpdate))
	r.HandleFunc("/maintenance/restart", s.requireSudo(s.handleMaintenanceRestart))
	r.HandleFunc("/maintenance/soft-reload", s.requireSudo(s.handleMaintenanceSoftReload))
}

func (s *Server) registerSettingsRoutes(r chi.Router) {
	r.HandleFunc("/settings", s.requireAdmin(s.handleRuntimeSettings))
	r.HandleFunc("/settings/backup/export", s.requireSudo(s.handleBackupExport))
	r.HandleFunc("/settings/backup/import", s.requireSudo(s.handleBackupImport))
	r.HandleFunc("/settings/panel", s.requireAdmin(s.handlePanelSettings))
	r.HandleFunc("/settings/phpmyadmin/embed/*", s.handlePHPMyAdmin)
	r.HandleFunc("/settings/phpmyadmin/*", s.requireSudo(s.handlePHPMyAdmin))
	r.HandleFunc("/settings/phpmyadmin", s.requireSudo(s.handlePHPMyAdmin))
	r.HandleFunc("/settings/telegram/backup/send", s.requireSudo(s.handleTelegramBackupSend))
	r.HandleFunc("/settings/telegram/test", s.requireSudo(s.handleTelegramSettingsTest))
	r.HandleFunc("/settings/telegram", s.requireSudo(s.handleTelegramSettings))
	r.HandleFunc("/settings/subscriptions/certificates/issue", s.requireSudo(s.handleSettingsDisabledRoute))
	r.HandleFunc("/settings/subscriptions/certificates/renew", s.requireSudo(s.handleSettingsDisabledRoute))
	r.HandleFunc("/settings/subscriptions/admins/*", s.requireSudo(s.handleAdminSubscriptionSettingsPath))
	r.HandleFunc("/settings/subscriptions/templates/*", s.requireSudo(s.handleSubscriptionTemplatePath))
	r.HandleFunc("/settings/subscriptions", s.requireSudo(s.handleSubscriptionSettings))
}

func (s *Server) registerServiceRoutes(r chi.Router) {
	r.HandleFunc("/v2/services/*", s.requireAdmin(s.handleServicePath))
	r.HandleFunc("/v2/services", s.requireAdmin(s.handleServicesRoot))
}

func (s *Server) registerUserRoutes(r chi.Router) {
	r.HandleFunc("/v2/users/*", s.requireAdmin(s.handleUserV2Path))
	r.HandleFunc("/v2/users", s.requireAdmin(s.handleUserV2Root))
	r.HandleFunc("/users/actions", s.requireAdmin(s.handleUsersBulkAction))
	r.HandleFunc("/users/usage", s.requireAdmin(s.handleUsersUsage))
	r.HandleFunc("/users", s.requireAdmin(s.handleUsers))
	r.HandleFunc("/user/*", s.requireAdmin(s.handleUserPath))
	r.HandleFunc("/user", s.requireAdmin(s.handleUserRoot))
}

func (s *Server) registerPanelXrayRoutes(r chi.Router) {
	r.HandleFunc("/panel/xray/nord/*", s.requireSudo(s.handleNordPath))
	r.HandleFunc("/panel/xray/outbound-subs/*", s.requireSudo(s.handleOutboundSubscriptionPath))
	r.HandleFunc("/panel/xray/outbound-subs", s.requireSudo(s.handleOutboundSubscriptions))
	r.HandleFunc("/panel/xray/tor/setup", s.requireSudo(s.handleTorProxySetup))
	r.HandleFunc("/panel/xray/windscribe/locations", s.requireSudo(s.handleWindscribeLocations))
	r.HandleFunc("/panel/xray/windscribe/setup", s.requireSudo(s.handleWindscribeSetup))
	r.HandleFunc("/panel/xray/testOutbound", s.requireSudo(s.handleOutboundTest))
	r.HandleFunc("/panel/xray/testOutbounds", s.requireSudo(s.handleOutboundTests))
	r.HandleFunc("/panel/xray/routeTest", s.requireSudo(s.handleRouteTest))
	r.HandleFunc("/panel/xray/getOutboundsTraffic", s.requireSudo(s.handleOutboundsTraffic))
	r.HandleFunc("/panel/xray/resetOutboundsTraffic", s.requireSudo(s.handleResetOutboundsTraffic))
}

func (s *Server) registerSubscriptionRoutes(r chi.Router) {
	r.HandleFunc("/v1/client/subscribe/*", s.handleSubscriptionPath)
	r.HandleFunc("/v1/client/subscribe", s.handleSubscriptionPath)
}

func (s *Server) registerNodeRoutes(r chi.Router) {
	r.HandleFunc("/nodes/usage", s.requireSudo(s.handleNodesUsage))
	r.HandleFunc("/nodes/metrics", s.requireSudo(s.handleNodesMetricsWebSocket))
	r.HandleFunc("/nodes", s.requireSudo(s.handleNodes))
	r.HandleFunc("/node/*", s.requireSudo(s.handleNodePath))
	r.HandleFunc("/node", s.requireSudo(s.handleNodeRoot))
}
