import { getAuthToken } from "utils/authStorage";
import { $fetch, fetch as apiFetch } from "./http";

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
	default_vless_flow?: string | null;
	forum_topics?: Record<string, TelegramTopicSettingsPayload>;
	event_toggles?: Record<string, boolean>;
	backup_enabled?: boolean;
	backup_scope?: RebeccaBackupScope;
	backup_interval_value?: number;
	backup_interval_unit?: "minutes" | "hours" | "days";
}

export const getTelegramSettings =
	async (): Promise<TelegramSettingsResponse> => {
		return apiFetch("/settings/telegram");
	};

export const updateTelegramSettings = async (
	payload: TelegramSettingsUpdatePayload,
): Promise<TelegramSettingsResponse> => {
	return apiFetch("/settings/telegram", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
};

export interface PanelSettingsResponse {
	use_nobetci: boolean;
	default_subscription_type: "username-key" | "key" | "token";
	access_insights_enabled: boolean;
}

export interface PanelSettingsUpdatePayload {
	use_nobetci?: boolean;
	default_subscription_type?: "username-key" | "key" | "token";
	access_insights_enabled?: boolean;
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
	singbox_subscription_template: string;
	singbox_settings_template: string;
	mux_template: string;
	use_custom_json_default: boolean;
	use_custom_json_for_v2rayn: boolean;
	use_custom_json_for_v2rayng: boolean;
	use_custom_json_for_streisand: boolean;
	use_custom_json_for_happ: boolean;
	subscription_path: string;
	subscription_aliases: string[];
	subscription_ports: number[];
}

export type SubscriptionTemplateSettingsUpdatePayload = Partial<SubscriptionTemplateSettings>;

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
}

export interface CertificateRenewPayload {
	domain?: string | null;
}

export type ThreeXUiUsernameConflictMode =
	| "rename"
	| "skip"
	| "overwrite";

export type ThreeXUiDuplicateSubaddressSourceMode =
	| "keep_first"
	| "skip_all";

export type ThreeXUiDuplicateSubaddressExistingMode =
	| "skip"
	| "overwrite";

export type ThreeXUiOverrideMode = "none" | "add" | "replace";

export type ThreeXUiImportJobStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed";

export interface ThreeXUiImportAdminOption {
	id: number;
	username: string;
}

export interface ThreeXUiImportServiceOption {
	id: number;
	name: string;
	admin_ids: number[];
	supported_protocols: string[];
}

export interface ThreeXUiUsernameConflictItem {
	username: string;
	source_count: number;
	existing_usernames: string[];
}

export interface ThreeXUiInboundPreview {
	inbound_id: number;
	remark: string;
	protocol: string;
	source_tag: string | null;
	source_port: number | null;
	network: string | null;
	security: string | null;
	raw_client_count: number;
	importable_client_count: number;
	username_conflicts: ThreeXUiUsernameConflictItem[];
}

export interface ThreeXUiSubaddressOccurrence {
	inbound_id: number;
	inbound_remark: string;
	protocol: string;
	username: string;
	email: string | null;
}

export interface ThreeXUiDuplicateSubaddressGroup {
	subadress: string;
	source_count: number;
	occurrences: ThreeXUiSubaddressOccurrence[];
	existing_users: Array<{ id: number; username: string }>;
}

export interface ThreeXUiPreviewResponse {
	preview_id: string;
	source_inbounds: number;
	supported_inbounds: number;
	source_clients: number;
	importable_clients: number;
	skipped_unsupported: number;
	skipped_invalid: number;
	inbounds: ThreeXUiInboundPreview[];
	duplicate_subaddresses: ThreeXUiDuplicateSubaddressGroup[];
	admins: ThreeXUiImportAdminOption[];
	services: ThreeXUiImportServiceOption[];
}

export interface ThreeXUiInboundImportConfig {
	inbound_id: number;
	import_enabled?: boolean;
	admin_id?: number | null;
	service_id?: number | null;
	username_conflict_mode: ThreeXUiUsernameConflictMode;
	expire_override_mode?: ThreeXUiOverrideMode;
	expire_override_seconds?: number | null;
	traffic_override_mode?: ThreeXUiOverrideMode;
	traffic_override_bytes?: number | null;
}

export interface ThreeXUiImportRequest {
	preview_id: string;
	inbounds: ThreeXUiInboundImportConfig[];
	duplicate_subaddress_policy: {
		source_conflict_mode: ThreeXUiDuplicateSubaddressSourceMode;
		existing_conflict_mode: ThreeXUiDuplicateSubaddressExistingMode;
	};
}

export interface ThreeXUiImportJobResult {
	total_clients: number;
	processed_clients: number;
	created: number;
	updated: number;
	skipped: number;
	renamed: number;
	skipped_username_conflicts: number;
	skipped_subaddress_conflicts: number;
	updated_by_username_overwrite: number;
	updated_by_subaddress_overwrite: number;
	updated_by_credential_key: number;
	warnings: string[];
}

export interface ThreeXUiImportJobResponse {
	job_id: string;
	preview_id: string;
	status: ThreeXUiImportJobStatus;
	progress_current: number;
	progress_total: number;
	message: string | null;
	result: ThreeXUiImportJobResult | null;
	created_at: string;
	updated_at: string;
}

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
	const token = getAuthToken();
	return $fetch<Blob>(`/settings/backup/export?scope=${scope}`, {
		responseType: "blob",
		headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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

export const previewThreeXUiDatabase = async (
	file: File,
): Promise<ThreeXUiPreviewResponse> => {
	const body = new FormData();
	body.append("file", file);
	return apiFetch("/settings/database/3xui/preview", {
		method: "POST",
		body,
	});
};

export const startThreeXUiImport = async (
	payload: ThreeXUiImportRequest,
): Promise<ThreeXUiImportJobResponse> => {
	return apiFetch("/settings/database/3xui/import", {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const getThreeXUiImportJob = async (
	jobId: string,
): Promise<ThreeXUiImportJobResponse> => {
	return apiFetch(`/settings/database/3xui/jobs/${jobId}`);
};
