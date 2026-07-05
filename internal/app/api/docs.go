package api

import (
	_ "embed"
	"html/template"
	"net/http"

	"github.com/swaggest/swgui"
	"github.com/swaggest/swgui/v5emb"
)

//go:embed openapi/openapi.json
var openAPIJSON []byte

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(openAPIJSON)
}

func (s *Server) handleDocsDisabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeError(w, http.StatusNotFound, "API docs are disabled")
}

func swaggerUIHandler() http.Handler {
	return v5emb.NewHandlerWithConfig(swgui.Config{
		Title:       "Rebecca API",
		SwaggerJSON: "/openapi.json",
		BasePath:    "/docs/",
		SettingsUI: map[string]string{
			"persistAuthorization": "true",
			"requestInterceptor":   swaggerRequestInterceptorJS,
			"onComplete":           swaggerOnCompleteJS,
		},
		AppendHead: template.HTML(swaggerDarkThemeCSS), //nolint:gosec // Static CSS only.
	})
}

const swaggerStoredTokenJS = `function() {
	try {
		var token = window.localStorage && window.localStorage.getItem("token");
		return token && token.trim ? token.trim() : "";
	} catch (error) {
		return "";
	}
}`

const swaggerRequestInterceptorJS = `function(req) {
	if (!req.loadSpec) {
		var token = (` + swaggerStoredTokenJS + `)();
		if (token && !(req.headers && req.headers.Authorization)) {
			req.headers = req.headers || {};
			req.headers.Authorization = "Bearer " + token;
		}
	}
	return req;
}`

const swaggerOnCompleteJS = `function() {
	var token = (` + swaggerStoredTokenJS + `)();
	if (token && window.ui && window.ui.preauthorizeApiKey) {
		window.ui.preauthorizeApiKey("bearerAuth", token);
	}

	var dom = document.querySelector(".scheme-container select");
	if (!dom) {
		return;
	}
	for (var key in dom) {
		if (key.startsWith("__reactInternalInstance$") && dom[key]._currentElement) {
			var compWrapper = dom[key]._currentElement._owner;
			if (compWrapper && compWrapper._instance && compWrapper._instance.setScheme) {
				compWrapper._instance.setScheme(window.location.protocol.slice(0, -1));
			}
		}
	}
}`

const swaggerDarkThemeCSS = `<style>
:root {
	color-scheme: dark;
	--rebecca-docs-bg: #050912;
	--rebecca-docs-panel: #0d1524;
	--rebecca-docs-panel-soft: #111c2d;
	--rebecca-docs-border: #26364f;
	--rebecca-docs-text: #e8edf7;
	--rebecca-docs-muted: #a6b3c8;
	--rebecca-docs-code: #18243a;
}

html,
body {
	background: var(--rebecca-docs-bg) !important;
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui {
	color: var(--rebecca-docs-text);
}

.swagger-ui .scheme-container,
.swagger-ui .information-container,
.swagger-ui .opblock-tag-section,
.swagger-ui .models,
.swagger-ui section.models {
	background: transparent !important;
	box-shadow: none !important;
	border-color: var(--rebecca-docs-border) !important;
}

.swagger-ui .info .title,
.swagger-ui .info h1,
.swagger-ui .info h2,
.swagger-ui .info h3,
.swagger-ui .info h4,
.swagger-ui .info h5,
.swagger-ui .opblock-tag,
.swagger-ui .opblock-summary-path,
.swagger-ui .opblock-summary-description,
.swagger-ui .tab li,
.swagger-ui label,
.swagger-ui table thead tr td,
.swagger-ui table thead tr th,
.swagger-ui .parameter__name,
.swagger-ui .parameter__type,
.swagger-ui .response-col_status,
.swagger-ui .response-col_description,
.swagger-ui .model-title,
.swagger-ui .model,
.swagger-ui .model-box,
.swagger-ui .renderedMarkdown,
.swagger-ui .renderedMarkdown p,
.swagger-ui .renderedMarkdown li,
.swagger-ui .markdown p,
.swagger-ui .markdown li {
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .info .base-url,
.swagger-ui .info .description,
.swagger-ui .info p,
.swagger-ui .opblock-tag small,
.swagger-ui .parameter__deprecated,
.swagger-ui .parameter__in,
.swagger-ui .prop-format,
.swagger-ui .model .property,
.swagger-ui .responses-inner h4,
.swagger-ui .responses-inner h5 {
	color: var(--rebecca-docs-muted) !important;
}

.swagger-ui .wrapper {
	max-width: 1460px;
}

.swagger-ui .opblock {
	background: var(--rebecca-docs-panel) !important;
	border-color: var(--rebecca-docs-border) !important;
	box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
}

.swagger-ui .opblock .opblock-summary {
	border-color: rgba(255, 255, 255, 0.08) !important;
}

.swagger-ui .opblock .opblock-section-header,
.swagger-ui .responses-wrapper,
.swagger-ui .opblock-description-wrapper,
.swagger-ui .opblock-external-docs-wrapper,
.swagger-ui .opblock-title_normal {
	background: var(--rebecca-docs-panel-soft) !important;
	border-color: var(--rebecca-docs-border) !important;
	box-shadow: none !important;
}

.swagger-ui .opblock-body pre,
.swagger-ui .highlight-code,
.swagger-ui .microlight,
.swagger-ui .model-example,
.swagger-ui textarea,
.swagger-ui input,
.swagger-ui select {
	background: var(--rebecca-docs-code) !important;
	color: var(--rebecca-docs-text) !important;
	border-color: var(--rebecca-docs-border) !important;
}

.swagger-ui input::placeholder,
.swagger-ui textarea::placeholder {
	color: #73839d !important;
}

.swagger-ui .dialog-ux .backdrop-ux {
	background: rgba(3, 7, 18, 0.78) !important;
}

.swagger-ui .dialog-ux .modal-ux {
	background: var(--rebecca-docs-panel) !important;
	border: 1px solid var(--rebecca-docs-border) !important;
	border-radius: 8px !important;
	box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48) !important;
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .dialog-ux .modal-ux-header {
	background: var(--rebecca-docs-panel-soft) !important;
	border-bottom: 1px solid var(--rebecca-docs-border) !important;
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .dialog-ux .modal-ux-header h3,
.swagger-ui .dialog-ux .modal-ux-content h4,
.swagger-ui .dialog-ux .modal-ux-content label,
.swagger-ui .dialog-ux .modal-ux-content p,
.swagger-ui .dialog-ux .auth-container h4,
.swagger-ui .dialog-ux .auth-container label,
.swagger-ui .dialog-ux .auth-container .wrapper {
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .dialog-ux .modal-ux-content,
.swagger-ui .dialog-ux .auth-container {
	background: var(--rebecca-docs-panel) !important;
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .dialog-ux .auth-container input {
	background: #17243a !important;
	color: var(--rebecca-docs-text) !important;
	border: 1px solid #49698f !important;
}

.swagger-ui .dialog-ux .modal-ux-header .close-modal {
	background: transparent !important;
	border: 0 !important;
	color: var(--rebecca-docs-text) !important;
}

.swagger-ui .dialog-ux .modal-ux-header .close-modal svg {
	fill: var(--rebecca-docs-text) !important;
}

.swagger-ui .btn,
.swagger-ui .btn.authorize,
.swagger-ui .try-out__btn,
.swagger-ui button {
	background: #12223a !important;
	color: var(--rebecca-docs-text) !important;
	border-color: #40638e !important;
	box-shadow: none !important;
}

.swagger-ui .btn.execute {
	background: #1f8ad8 !important;
	border-color: #1f8ad8 !important;
	color: #03101f !important;
}

.swagger-ui .btn.cancel {
	background: #3a1d25 !important;
	border-color: #8a4353 !important;
	color: #ffd7df !important;
}

.swagger-ui .opblock.opblock-get {
	background: rgba(15, 74, 109, 0.28) !important;
	border-color: #2b83b7 !important;
}

.swagger-ui .opblock.opblock-post {
	background: rgba(22, 101, 52, 0.24) !important;
	border-color: #2faa66 !important;
}

.swagger-ui .opblock.opblock-put {
	background: rgba(113, 72, 16, 0.24) !important;
	border-color: #d69a2d !important;
}

.swagger-ui .opblock.opblock-delete {
	background: rgba(127, 29, 29, 0.24) !important;
	border-color: #df5f5f !important;
}

.swagger-ui .opblock.opblock-patch {
	background: rgba(75, 58, 137, 0.24) !important;
	border-color: #9b8cff !important;
}

.swagger-ui .opblock .opblock-summary-method {
	box-shadow: none !important;
}

.swagger-ui .opblock .opblock-summary-path__deprecated {
	color: #f1a8a8 !important;
}

.swagger-ui .response-control-media-type__accept-message,
.swagger-ui .download-contents {
	color: #9fd7ff !important;
}

.swagger-ui svg,
.swagger-ui .arrow {
	fill: var(--rebecca-docs-text) !important;
	color: var(--rebecca-docs-text) !important;
}
</style>`
