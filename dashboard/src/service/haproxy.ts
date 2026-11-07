import { fetch as apiFetch } from "./http";

export type HAProxyMatchType = "sni" | "http_host" | "http_path" | "default";
export type HAProxyMatcher = { type: HAProxyMatchType; value: string };
export type HAProxyCandidate = {
	tag: string;
	protocol: string;
	network: string;
	port: number;
	matchers: HAProxyMatcher[];
};
export type HAProxyRoute = {
	name: string;
	source: "xray" | "external";
	inbound_tag?: string;
	protocol?: string;
	backend_host: string;
	backend_port: number;
	match_type: HAProxyMatchType;
	match_value?: string;
};
export type HAProxySite = {
	enabled: boolean;
	is_default?: boolean;
	name?: string;
	hostname?: string;
	source: "builtin" | "templatemo" | "upload";
	template_id: string;
	template_url?: string;
	tls_mode?: "none" | "self_signed" | "managed" | "custom";
	certificate_domain?: string;
	certificate_path?: string;
	private_key_path?: string;
	not_found_html?: string;
};
export type HAProxyListener = {
	name: string;
	listen_address: string;
	listen_port: number;
	accept_proxy_protocol: boolean;
	routes: HAProxyRoute[];
	site?: HAProxySite;
	sites?: HAProxySite[];
};
export type HAProxyTarget = {
	node_id: number;
	listeners: HAProxyListener[];
	generated_config?: string;
};
export type HAProxySettings = {
	max_connections: number;
	inspect_delay_ms: number;
	connect_timeout_ms: number;
	client_timeout_seconds: number;
	server_timeout_seconds: number;
	health_check: boolean;
	check_interval_ms: number;
	check_rise: number;
	check_fall: number;
	retries: number;
	tcp_keep_alive: boolean;
	dont_log_null: boolean;
	log_level: string;
};
export type HAProxyConfig = {
	id: number;
	name: string;
	enabled: boolean;
	settings: HAProxySettings;
	targets: HAProxyTarget[];
	created_at?: string;
	updated_at?: string;
};
export type HAProxyNode = {
	id: number;
	name: string;
	status: string;
	haproxy_config_id?: number;
};
export type HAProxyTemplate = {
	id: string;
	name: string;
	preview_url?: string;
	download_url?: string;
};
export type HAProxyCertificate = {
	domain: string;
	status: string;
	not_after?: string;
};
export type HAProxyOverview = {
	configs: HAProxyConfig[];
	nodes: HAProxyNode[];
	templates: HAProxyTemplate[];
	uploaded_templates: HAProxyTemplate[];
	certificates: HAProxyCertificate[];
};

export type HAProxyCloneResult = {
	target?: HAProxyTarget;
	missingInbounds: string[];
};

export const haproxyMatcherPriority: HAProxyMatchType[] = [
	"sni",
	"http_path",
	"http_host",
	"default",
];

export const preferredHAProxyMatcher = (matchers: HAProxyMatcher[]) =>
	haproxyMatcherPriority
		.map((type) => matchers.find((matcher) => matcher.type === type && (matcher.value !== "" || type === "default")))
		.find(Boolean) ?? matchers[0];

export const cloneHAProxyTargetForNode = (
	source: HAProxyTarget,
	nodeID: number,
	candidates: HAProxyCandidate[],
	templates: HAProxyTemplate[],
	randomizeTemplates: boolean,
	random = Math.random,
): HAProxyCloneResult => {
	const target = JSON.parse(JSON.stringify(source)) as HAProxyTarget;
	target.node_id = nodeID;
	delete target.generated_config;
	const missing = new Set<string>();
	for (const listener of target.listeners) {
		listener.routes = listener.routes.map((route) => {
			if (route.source !== "xray") return route;
			const candidate = candidates.find(
				(item) =>
					item.tag === route.inbound_tag &&
					item.matchers.some(
						(matcher) =>
							matcher.type === route.match_type &&
							(matcher.value || "") === (route.match_value || ""),
					),
			);
			if (!candidate) {
				missing.add(route.inbound_tag || route.name);
				return route;
			}
			return {
				...route,
				protocol: candidate.protocol,
				backend_host: "127.0.0.1",
				backend_port: candidate.port,
			};
		});
		listener.sites =
			listener.sites ?? (listener.site?.enabled ? [listener.site] : []);
		delete listener.site;
		if (!randomizeTemplates) continue;
		const used = new Set<string>();
		for (const site of listener.sites) {
			if (site.source !== "templatemo" || templates.length === 0) continue;
			const current =
				site.template_id ||
				site.template_url?.match(/\/tm-([0-9]{3}-[a-z0-9-]+)/i)?.[1] ||
				"";
			const unused = templates.filter(
				(template) => template.id !== current && !used.has(template.id),
			);
			const alternatives = templates.filter(
				(template) => template.id !== current,
			);
			const pool = unused.length
				? unused
				: alternatives.length
					? alternatives
					: templates;
			const template =
				pool[
					Math.floor(Math.max(0, Math.min(0.999999999, random())) * pool.length)
				];
			if (!template) continue;
			used.add(template.id);
			site.template_id = template.id;
			site.template_url = "";
		}
	}
	return missing.size
		? { missingInbounds: [...missing] }
		: { target, missingInbounds: [] };
};

export const getHAProxyOverview = () => apiFetch<HAProxyOverview>("/haproxy");
export const getHAProxyCandidates = (nodeID: number) =>
	apiFetch<{ candidates: HAProxyCandidate[] }>(`/haproxy/candidates/${nodeID}`);
export const createHAProxyConfig = (config: HAProxyConfig) =>
	apiFetch<HAProxyConfig>("/haproxy", { method: "POST", body: config });
export const updateHAProxyConfig = (config: HAProxyConfig) =>
	apiFetch<HAProxyConfig>(`/haproxy/${config.id}`, {
		method: "PUT",
		body: config,
	});
export const deleteHAProxyConfig = (id: number) =>
	apiFetch<{ ok: boolean }>(`/haproxy/${id}`, { method: "DELETE" });
export const previewHAProxyConfig = (config: HAProxyConfig) =>
	apiFetch<HAProxyConfig>("/haproxy/preview", { method: "POST", body: config });
export const uploadHAProxyTemplate = (name: string, archive: File) => {
	const body = new FormData();
	body.set("name", name);
	body.set("archive", archive);
	return apiFetch<HAProxyTemplate>("/haproxy/templates", {
		method: "POST",
		body,
	});
};
