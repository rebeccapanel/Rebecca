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
	default_subscription_type: "username-key" | "key" | "token" | "key-username";
}

export interface PanelSettingsUpdatePayload {
	default_subscription_type?: "username-key" | "key" | "token" | "key-username";
}

export type RebeccaBackupScope = "database" | "full";

export interface RebeccaBackupImportResponse {
	scope: RebeccaBackupScope;
	tables_restored: number;
	rows_restored: number;
	files_restored: string[];
	warnings: string[];
}

export type ClientRoutingRule = {
  pattern: string;
  result: string;
};

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
	subscription_path: string;
	subscription_aliases: string[];
	subscription_ports: number[];
	client_routing_rules?: ClientRoutingRule[];
	subscription_placeholder_enabled: boolean;
	subscription_placeholder_remark: string;
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

export interface SubscriptionPlaceholderSetting {
	admin_id: number;
	admin_username: string;
	service_id: number;
	service_name: string;
	enabled: boolean;
	expired_remark: string;
	limited_remark: string;
	disabled_remark: string;
}

export interface SubscriptionPlaceholderSettingsResponse {
	items: SubscriptionPlaceholderSetting[];
	manage_all: boolean;
}

export const getSubscriptionPlaceholderSettings = async () =>
	apiFetch<SubscriptionPlaceholderSettingsResponse>("/settings/placeholders");

export const updateSubscriptionPlaceholderSetting = async (
	payload: Pick<
		SubscriptionPlaceholderSetting,
		| "admin_id"
		| "service_id"
		| "enabled"
		| "expired_remark"
		| "limited_remark"
		| "disabled_remark"
	>,
) =>
	apiFetch<SubscriptionPlaceholderSetting>("/settings/placeholders", {
		method: "PUT",
		body: JSON.stringify(payload),
	});

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

export interface AllSettingsUpdatePayload {
	panel?: PanelSettingsUpdatePayload;
	runtime?: RuntimeSettingsUpdatePayload;
	telegram?: TelegramSettingsUpdatePayload;
	subscriptions?: SubscriptionTemplateSettingsUpdatePayload;
	subscription_admins?: Array<{
		id: number;
		settings: AdminSubscriptionUpdatePayload;
	}>;
}

export interface AllSettingsUpdateResponse {
	panel?: PanelSettingsResponse;
	runtime?: RuntimeSettingsResponse;
	telegram?: TelegramSettingsResponse;
	subscriptions?: SubscriptionTemplateSettings;
	subscription_admins?: AdminSubscriptionSettings[];
}

export const updateAllSettings = async (
	payload: AllSettingsUpdatePayload,
): Promise<AllSettingsUpdateResponse> => {
	return apiFetch("/settings/all", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

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
	id: string;
	template: "archive" | "mirzabot";
	name: string;
	domain: string;
	path?: string;
	enabled: boolean;
	runtime: "static" | "php" | "node";
	version?: string;
	source_sha?: string;
	installed_at: string;
	php_version?: string;
	bot_username?: string;
	index_file: string;
	fallback_to_index: boolean;
	max_request_body_mb: number;
	static_cache_seconds: number;
	not_found_file: string;
	has_database: boolean;
	public_url: string;
	update_available?: boolean;
	latest_version?: string;
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
	runtime: "php" | "static" | "node";
	archive?: File;
	create_database: boolean;
	database?: string;
	database_user?: string;
	database_password?: string;
}): Promise<ExternalAppRecord> => {
	const body = new FormData();
	body.set("domain", payload.domain);
	body.set("name", payload.name);
	body.set("runtime", payload.runtime);
	body.set("create_database", String(payload.create_database));
	if (payload.archive) body.set("archive", payload.archive);
	if (payload.create_database) {
		body.set("database", payload.database ?? "");
		body.set("database_user", payload.database_user ?? "");
		body.set("database_password", payload.database_password ?? "");
	}
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
	database_backup?: File;
}): Promise<ExternalAppRecord> => {
	const body = new FormData();
	body.set("domain", payload.domain);
	body.set("bot_token", payload.bot_token);
	body.set("admin_id", payload.admin_id);
	if (payload.database_backup) {
		body.set("database_backup", payload.database_backup);
	}
	return $fetch("/settings/external-apps/mirzabot", {
		method: "POST",
		body,
		timeout: 20 * 60 * 1000,
	});
};

export const setExternalAppEnabled = async (payload: {
	id: string;
	enabled: boolean;
}): Promise<ExternalAppRecord> => {
	return apiFetch(
		`/settings/external-apps/${encodeURIComponent(payload.id)}/${payload.enabled ? "enable" : "disable"}`,
		{ method: "POST", body: JSON.stringify({}), timeout: 120000 },
	);
};

export const updateExternalMirzaBot = async (
	id: string,
): Promise<ExternalAppRecord> => {
	return apiFetch(externalAppPath(id, "/update"), {
		method: "POST",
		body: JSON.stringify({}),
		timeout: 20 * 60 * 1000,
	});
};

export const exportExternalAppDatabase = async (id: string): Promise<Blob> => {
	return $fetch<Blob>(externalAppPath(id, "/database-backup"), {
		responseType: "blob",
		credentials: "include",
		timeout: 10 * 60 * 1000,
	} as any);
};

export const updateExternalAppSettings = async (payload: {
	id: string;
	index_file: string;
	fallback_to_index: boolean;
	max_request_body_mb: number;
	static_cache_seconds: number;
	not_found_file: string;
}): Promise<ExternalAppRecord> => {
	return apiFetch(externalAppPath(payload.id, "/settings"), {
		method: "PUT",
		body: JSON.stringify({
			index_file: payload.index_file,
			fallback_to_index: payload.fallback_to_index,
			max_request_body_mb: payload.max_request_body_mb,
			static_cache_seconds: payload.static_cache_seconds,
			not_found_file: payload.not_found_file,
		}),
	});
};

export const deleteExternalApp = async (payload: {
	id: string;
	keep_database: boolean;
}): Promise<void> => {
	await apiFetch(`/settings/external-apps/${encodeURIComponent(payload.id)}`, {
		method: "DELETE",
		body: JSON.stringify({ keep_database: payload.keep_database }),
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

const externalAppPath = (id: string, suffix = "") =>
	`/settings/external-apps/${encodeURIComponent(id)}${suffix}`;

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
	file: File,
	onProgress?: (percent: number) => void,
): Promise<RebeccaBackupImportResponse> => {
	return new Promise((resolve, reject) => {
		const body = new FormData();
		body.append("file", file);
		const xhr = new XMLHttpRequest();
		const baseURL = (apiBaseURL || "/api").replace(/\/$/, "");
		xhr.open("POST", `${baseURL}/settings/backup/import`);
		xhr.withCredentials = true;
		xhr.responseType = "json";
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				onProgress?.(
					Math.min(100, Math.round((event.loaded / event.total) * 100)),
				);
			}
		};
		xhr.upload.onload = () => onProgress?.(100);
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(xhr.response as RebeccaBackupImportResponse);
				return;
			}
			reject({ response: { _data: xhr.response } });
		};
		xhr.onerror = () => reject(new Error("Backup upload failed"));
		onProgress?.(0);
		xhr.send(body);
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
