import { $fetch, apiBaseURL, fetch as apiFetch } from "./http";

export interface TelegramTopicSettingsPayload {
	title: string;
	topic_id?: number | null;
}

export interface TelegramSettingsResponse {
	api_token: string | null;
	use_telegram: boolean;
	proxy_url: string | null;
	admin_chat_ids: number[];
	logs_chat_id: number | null;
	logs_chat_is_forum: boolean;
	backup_chat_id: number | null;
	backup_chat_is_forum: boolean;
	default_vless_flow: string | null;
	forum_topics: Record<string, TelegramTopicSettingsPayload>;
	event_toggles: Record<string, boolean>;
	backup_enabled: boolean;
	backup_scope: RebeccaBackupScope;
	backup_interval_value: number;
	backup_interval_unit: "minutes" | "hours" | "days";
	backup_last_sent_at: string | null;
	backup_last_error: string | null;
}

export interface TelegramSettingsUpdatePayload {
	api_token?: string | null;
	use_telegram?: boolean;
	proxy_url?: string | null;
	admin_chat_ids?: number[];
	logs_chat_id?: number | null;
	logs_chat_is_forum?: boolean;
	backup_chat_id?: number | null;
	backup_chat_is_forum?: boolean;
	default_vless_flow?: string | null;
	forum_topics?: Record<string, TelegramTopicSettingsPayload>;
	event_toggles?: Record<string, boolean>;
	backup_enabled?: boolean;
	backup_scope?: RebeccaBackupScope;
	backup_interval_value?: number;
	backup_interval_unit?: "minutes" | "hours" | "days";
}

export interface TelegramBackupSendResponse {
	ok: boolean;
	filename: string;
	scope: RebeccaBackupScope;
	size: number;
	results: Array<{
		chat_id: number;
		message_id?: number;
		ok: boolean;
		error?: string;
	}>;
}

const disabledTelegramSettings: TelegramSettingsResponse = {
	api_token: null,
	use_telegram: false,
	proxy_url: null,
	admin_chat_ids: [],
	logs_chat_id: null,
	logs_chat_is_forum: false,
	backup_chat_id: null,
	backup_chat_is_forum: false,
	default_vless_flow: null,
	forum_topics: {},
	event_toggles: {},
	backup_enabled: false,
	backup_scope: "database",
	backup_interval_value: 24,
	backup_interval_unit: "hours",
	backup_last_sent_at: null,
	backup_last_error: null,
};

const isGoneResponse = (error: unknown): boolean => {
	const maybeError = error as {
		status?: number;
		statusCode?: number;
		response?: { status?: number };
		data?: { status?: number };
	};
	return (
		maybeError?.status === 410 ||
		maybeError?.statusCode === 410 ||
		maybeError?.response?.status === 410 ||
		maybeError?.data?.status === 410
	);
};

export const getTelegramSettings =
	async (): Promise<TelegramSettingsResponse> => {
		try {
			return await apiFetch("/settings/telegram");
		} catch (error) {
			if (isGoneResponse(error)) return disabledTelegramSettings;
			throw error;
		}
	};

export const updateTelegramSettings = async (
	payload: TelegramSettingsUpdatePayload,
): Promise<TelegramSettingsResponse> => {
	return apiFetch("/settings/telegram", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export const testTelegramSettings = async (): Promise<{
	ok: boolean;
	chat_id: number;
	detail: string;
}> => {
	return apiFetch("/settings/telegram/test", {
		method: "POST",
		body: JSON.stringify({}),
	});
};

export const sendTelegramBackup = async (
	scope: RebeccaBackupScope,
): Promise<TelegramBackupSendResponse> => {
	return apiFetch("/settings/telegram/backup/send", {
		method: "POST",
		body: JSON.stringify({ scope }),
	});
};

export interface PanelSettingsResponse {
	default_subscription_type: "username-key" | "key" | "token";
}

export interface PanelSettingsUpdatePayload {
	default_subscription_type?: "username-key" | "key" | "token";
}

export type RebeccaBackupScope = "database" | "full";

export interface RebeccaBackupImportResponse {
	scope: RebeccaBackupScope;
	tables_restored: number;
	rows_restored: number;
	files_restored: string[];
	warnings: string[];
}

export interface SubscriptionTemplateSettings {
	subscription_url_prefix: string;
	subscription_profile_title: string;
	subscription_support_url: string;
	subscription_update_interval: string;
	custom_templates_directory: string | null;
	clash_subscription_template: string;
	clash_settings_template: string;
	subscription_page_template: string;
	home_page_template: string;
	v2ray_subscription_template: string;
	v2ray_settings_template: string;
	happ_subscription_template: string;
	incy_subscription_template: string;
	singbox_subscription_template: string;
	singbox_settings_template: string;
	mux_template: string;
	use_custom_json_default: boolean;
	use_custom_json_for_v2rayn: boolean;
	use_custom_json_for_v2rayng: boolean;
	use_custom_json_for_streisand: boolean;
	use_custom_json_for_happ: boolean;
	use_custom_json_for_incy: boolean;
	subscription_path: string;
	subscription_aliases: string[];
	subscription_ports: number[];
}

export type SubscriptionTemplateSettingsUpdatePayload =
	Partial<SubscriptionTemplateSettings>;

export interface AdminSubscriptionSettings {
	id: number;
	username: string;
	subscription_domain: string | null;
	subscription_settings: Partial<SubscriptionTemplateSettings>;
}

export interface AdminSubscriptionUpdatePayload {
	subscription_domain?: string | null;
	subscription_settings?: Partial<SubscriptionTemplateSettings>;
}

export interface SubscriptionCertificate {
	id?: number;
	domain: string;
	admin_id: number | null;
	email: string | null;
	provider: string | null;
	alt_names: string[];
	last_issued_at: string | null;
	last_renewed_at: string | null;
	path: string;
	status:
		| "active"
		| "expiring"
		| "expired"
		| "not_yet_valid"
		| "missing"
		| "invalid"
		| "revoking"
		| "revoked";
	not_before: string | null;
	not_after: string | null;
	issuer: string | null;
	fingerprint_sha256: string | null;
	auto_renew: boolean;
	serve_tls: boolean;
}

export interface SubscriptionSettingsBundle {
	settings: SubscriptionTemplateSettings;
	admins: AdminSubscriptionSettings[];
	certificates: SubscriptionCertificate[];
}

export interface SubscriptionTemplateContentResponse {
	template_key: string;
	template_name: string;
	custom_directory: string | null;
	resolved_path: string | null;
	admin_id: number | null;
	content: string;
}

export interface CertificateIssuePayload {
	email: string;
	domains: string[];
	admin_id?: number | null;
	provider: "letsencrypt" | "zerossl";
}

export interface CertificateRenewPayload {
	domain: string;
}

export interface CertificateImportPayload {
	domain: string;
	admin_id?: number | null;
	fullchain: string;
	private_key: string;
}

export interface RuntimeSettingsResponse {
	dashboard_path: string;
	record_node_usage: boolean;
	record_node_user_usages: boolean;
	subscription_read_only: boolean;
	api_docs_enabled: boolean;
	phpmyadmin_enabled: boolean;
	phpmyadmin_port: number;
	phpmyadmin_path: string;
	phpmyadmin_public_url: string;
	phpmyadmin_login_mode: "rebecca" | "custom";
	phpmyadmin_username: string;
	phpmyadmin_password: string;
}

export type RuntimeSettingsUpdatePayload = Partial<RuntimeSettingsResponse>;

export const getRuntimeSettings =
	async (): Promise<RuntimeSettingsResponse> => {
		return apiFetch("/settings");
	};

export const updateRuntimeSettings = async (
	payload: RuntimeSettingsUpdatePayload,
): Promise<RuntimeSettingsResponse> => {
	return apiFetch("/settings", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export interface PHPMyAdminStatus {
	enabled: boolean;
	supported: boolean;
	database: string;
	port: number;
	path: string;
	public_url: string;
	external_url: string;
	embed_url: string;
	login_mode: "rebecca" | "custom";
}

export interface PHPMyAdminActionResponse {
	ok: boolean;
	status: PHPMyAdminStatus;
	output?: string;
}

export const getPHPMyAdminStatus = async (): Promise<PHPMyAdminStatus> => {
	return apiFetch("/settings/phpmyadmin");
};

export const enablePHPMyAdmin = async (payload: {
	port: number;
	path: string;
}): Promise<PHPMyAdminActionResponse> => {
	return apiFetch("/settings/phpmyadmin/enable", {
		method: "POST",
		body: JSON.stringify(payload),
		timeout: 600000,
	});
};

export const disablePHPMyAdmin =
	async (): Promise<PHPMyAdminActionResponse> => {
		return apiFetch("/settings/phpmyadmin/disable", {
			method: "POST",
			body: JSON.stringify({}),
			timeout: 600000,
		});
	};

export interface ExternalAppRecord {
	template: "archive" | "mirzabot";
	name: string;
	domain: string;
	enabled: boolean;
	runtime: "static" | "php";
	version?: string;
	source_sha?: string;
	installed_at: string;
	php_version?: string;
	bot_username?: string;
	public_url: string;
}

export interface ExternalAppTemplate {
	id: "archive" | "mirzabot";
	name: string;
	supported: boolean;
	detail?: string;
	version?: string;
	source_sha?: string;
	source_url?: string;
}

export interface ExternalAppsResponse {
	supported: boolean;
	detail: string;
	templates: ExternalAppTemplate[];
	apps: ExternalAppRecord[];
}

export const getExternalApps = async (): Promise<ExternalAppsResponse> => {
	return apiFetch("/settings/external-apps");
};

export const installExternalArchive = async (payload: {
	domain: string;
	name: string;
	archive: File;
}): Promise<ExternalAppRecord> => {
	const body = new FormData();
	body.set("domain", payload.domain);
	body.set("name", payload.name);
	body.set("archive", payload.archive);
	return $fetch("/settings/external-apps/archive", {
		method: "POST",
		body,
		timeout: 20 * 60 * 1000,
	});
};

export const installMirzaBot = async (payload: {
	domain: string;
	bot_token: string;
	admin_id: string;
}): Promise<ExternalAppRecord> => {
	return apiFetch("/settings/external-apps/mirzabot", {
		method: "POST",
		body: JSON.stringify(payload),
		timeout: 20 * 60 * 1000,
	});
};

export const setExternalAppEnabled = async (payload: {
	domain: string;
	enabled: boolean;
}): Promise<ExternalAppRecord> => {
	return apiFetch(
		`/settings/external-apps/${encodeURIComponent(payload.domain)}/${payload.enabled ? "enable" : "disable"}`,
		{ method: "POST", body: JSON.stringify({}), timeout: 120000 },
	);
};

export const deleteExternalApp = async (domain: string): Promise<void> => {
	await apiFetch(`/settings/external-apps/${encodeURIComponent(domain)}`, {
		method: "DELETE",
		timeout: 10 * 60 * 1000,
	});
};

export interface ExternalAppFile {
	name: string;
	isDirectory: boolean;
	path: string;
	updatedAt?: string;
	size?: number;
}

export interface ExternalAppFileContent {
	path: string;
	content: string;
	updated_at: string;
}

const externalAppPath = (domain: string, suffix = "") =>
	`/settings/external-apps/${encodeURIComponent(domain)}${suffix}`;

export const getExternalAppFiles = async (
	domain: string,
): Promise<{ files: ExternalAppFile[] }> => {
	return apiFetch(externalAppPath(domain, "/files"));
};

export const getExternalAppFile = async (
	domain: string,
	path: string,
): Promise<ExternalAppFileContent> => {
	return apiFetch(
		`${externalAppPath(domain, "/files/content")}?path=${encodeURIComponent(path)}`,
	);
};

export const saveExternalAppFile = async (payload: {
	domain: string;
	path: string;
	content: string;
}): Promise<void> => {
	await apiFetch(externalAppPath(payload.domain, "/files/content"), {
		method: "PUT",
		body: JSON.stringify({ path: payload.path, content: payload.content }),
	});
};

export const createExternalAppFolder = async (payload: {
	domain: string;
	path: string;
}): Promise<void> => {
	await apiFetch(externalAppPath(payload.domain, "/files/folder"), {
		method: "POST",
		body: JSON.stringify({ path: payload.path }),
	});
};

export const moveExternalAppFile = async (payload: {
	domain: string;
	path: string;
	new_path: string;
}): Promise<void> => {
	await apiFetch(externalAppPath(payload.domain, "/files/move"), {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const deleteExternalAppFiles = async (payload: {
	domain: string;
	paths: string[];
}): Promise<void> => {
	await apiFetch(externalAppPath(payload.domain, "/files/delete"), {
		method: "POST",
		body: JSON.stringify({ paths: payload.paths }),
	});
};

const externalAppAPIBase = (apiBaseURL || "/api").replace(/\/$/, "");

export const externalAppFileUploadURL = (domain: string) =>
	`${externalAppAPIBase}${externalAppPath(domain, "/files/upload")}`;

export const externalAppFileDownloadURL = (domain: string, path: string) =>
	`${externalAppAPIBase}${externalAppPath(domain, "/files/download")}?path=${encodeURIComponent(path)}`;

export const getExternalAppPHPConfig = async (
	domain: string,
): Promise<ExternalAppFileContent> => {
	return apiFetch(externalAppPath(domain, "/php-config"));
};

export const saveExternalAppPHPConfig = async (payload: {
	domain: string;
	content: string;
}): Promise<void> => {
	await apiFetch(externalAppPath(payload.domain, "/php-config"), {
		method: "PUT",
		body: JSON.stringify({ content: payload.content }),
	});
};

export const getPHPMyAdminEmbedHTML = async (
	theme?: string,
): Promise<string> => {
	const search = theme ? `?theme=${encodeURIComponent(theme)}` : "";
	const response = await fetch(
		`${apiBaseURL}/settings/phpmyadmin/embed-html${search}`,
		{
			cache: "no-store",
			credentials: "include",
		},
	);
	if (!response.ok) {
		let detail = await response.text();
		try {
			const parsed = JSON.parse(detail);
			detail = parsed?.detail || detail;
		} catch {
			// keep raw response body
		}
		throw new Error(detail || `Request failed with status ${response.status}`);
	}
	return response.text();
};

export const getPanelSettings = async (): Promise<PanelSettingsResponse> => {
	return apiFetch("/settings/panel");
};

export const updatePanelSettings = async (
	payload: PanelSettingsUpdatePayload,
): Promise<PanelSettingsResponse> => {
	return apiFetch("/settings/panel", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export const exportRebeccaBackup = async (
	scope: RebeccaBackupScope,
): Promise<Blob> => {
	return $fetch<Blob>(`/settings/backup/export?scope=${scope}`, {
		responseType: "blob",
		credentials: "include",
	} as any);
};

export const importRebeccaBackup = async (
	scope: RebeccaBackupScope,
	file: File,
): Promise<RebeccaBackupImportResponse> => {
	const body = new FormData();
	body.append("file", file);
	return apiFetch(`/settings/backup/import?scope=${scope}`, {
		method: "POST",
		body,
	});
};

export const getSubscriptionSettings =
	async (): Promise<SubscriptionSettingsBundle> => {
		return apiFetch("/settings/subscriptions");
	};

export const updateSubscriptionSettings = async (
	payload: SubscriptionTemplateSettingsUpdatePayload,
): Promise<SubscriptionTemplateSettings> => {
	return apiFetch("/settings/subscriptions", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export const updateAdminSubscriptionSettings = async (
	adminId: number,
	payload: AdminSubscriptionUpdatePayload,
): Promise<AdminSubscriptionSettings> => {
	return apiFetch(`/settings/subscriptions/admins/${adminId}`, {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export const getSubscriptionTemplateContent = async (
	templateKey: string,
	adminId?: number | null,
): Promise<SubscriptionTemplateContentResponse> => {
	const query = adminId != null ? `?admin_id=${adminId}` : "";
	return apiFetch(`/settings/subscriptions/templates/${templateKey}${query}`);
};

export const updateSubscriptionTemplateContent = async (
	templateKey: string,
	payload: { content: string; admin_id?: number | null },
): Promise<SubscriptionTemplateContentResponse> => {
	const query = payload.admin_id != null ? `?admin_id=${payload.admin_id}` : "";
	return apiFetch(`/settings/subscriptions/templates/${templateKey}${query}`, {
		method: "PUT",
		body: JSON.stringify({ content: payload.content }),
	});
};

export const issueSubscriptionCertificate = async (
	payload: CertificateIssuePayload,
): Promise<SubscriptionCertificate> => {
	return apiFetch("/settings/subscriptions/certificates/issue", {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const renewSubscriptionCertificate = async (
	payload: CertificateRenewPayload,
): Promise<SubscriptionCertificate | null> => {
	return apiFetch("/settings/subscriptions/certificates/renew", {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const importSubscriptionCertificate = async (
	payload: CertificateImportPayload,
): Promise<SubscriptionCertificate> => {
	return apiFetch("/settings/subscriptions/certificates/import", {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const revokeSubscriptionCertificate = async (
	domain: string,
): Promise<SubscriptionCertificate> => {
	return apiFetch(
		`/settings/subscriptions/certificates/${encodeURIComponent(domain)}/revoke`,
		{ method: "POST", body: JSON.stringify({}) },
	);
};

export const deleteSubscriptionCertificate = async (
	domain: string,
): Promise<void> => {
	return apiFetch(
		`/settings/subscriptions/certificates/${encodeURIComponent(domain)}`,
		{ method: "DELETE" },
	);
};

export const updateSubscriptionCertificateServing = async (
	domain: string,
	serveTLS: boolean,
): Promise<SubscriptionCertificate> => {
	return apiFetch(
		`/settings/subscriptions/certificates/${encodeURIComponent(domain)}`,
		{
			method: "PUT",
			body: JSON.stringify({ serve_tls: serveTLS }),
		},
	);
};
