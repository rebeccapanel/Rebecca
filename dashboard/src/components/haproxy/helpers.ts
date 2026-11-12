import type {
	HAProxyConfig,
	HAProxyListener,
	HAProxyRoute,
	HAProxySettings,
} from "service/haproxy";

export const defaultSettings = (): HAProxySettings => ({
	max_connections: 8192,
	inspect_delay_ms: 5000,
	connect_timeout_ms: 5000,
	client_timeout_seconds: 3600,
	server_timeout_seconds: 3600,
	health_check: true,
	check_interval_ms: 2000,
	check_rise: 2,
	check_fall: 3,
	retries: 3,
	tcp_keep_alive: true,
	dont_log_null: true,
	log_level: "info",
});

export const emptyConfig = (): HAProxyConfig => ({
	id: 0,
	name: "HAProxy",
	enabled: false,
	settings: defaultSettings(),
	targets: [],
});

export const emptyListener = (index: number): HAProxyListener => ({
	name: `listener-${index + 1}`,
	listen_address: "0.0.0.0",
	listen_port: index === 0 ? 443 : 550 + index - 1,
	accept_proxy_protocol: false,
	routes: [],
	sites: [],
});

export const emptySite = (index: number) => ({
	enabled: true,
	is_default: false,
	name: `website-${index + 1}`,
	hostname: "",
	source: "builtin" as const,
	template_id: "builtin",
	template_url: "",
	tls_mode: "none" as const,
	certificate_domain: "",
	certificate_path: "",
	private_key_path: "",
	not_found_html: "",
});

export const externalRoute = (
	index: number,
	defaultUnavailable = false,
): HAProxyRoute => ({
	name: `external-${index + 1}`,
	source: "external",
	backend_host: "127.0.0.1",
	backend_port: 1194,
	match_type: defaultUnavailable ? "sni" : "default",
	match_value: "",
});

export const cloneConfig = (config: HAProxyConfig) => {
	const cloned = JSON.parse(JSON.stringify(config)) as HAProxyConfig;
	for (const target of cloned.targets) {
		for (const listener of target.listeners) {
			listener.sites =
				listener.sites ?? (listener.site?.enabled ? [listener.site] : []);
			delete listener.site;
		}
	}
	return cloned;
};

export const errorText = (error: unknown) => {
	const value = error as { data?: { detail?: string }; message?: string };
	return value?.data?.detail || value?.message || String(error);
};
