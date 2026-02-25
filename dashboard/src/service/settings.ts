import { fetch as apiFetch } from "./http";

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
}

export type SubscriptionTemplateSettingsUpdatePayload = Partial<
	Omit<SubscriptionTemplateSettings, "subscription_path">
>;

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
