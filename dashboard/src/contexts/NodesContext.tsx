import { useEffect } from "react";
import { useQuery, useQueryClient } from "react-query";
import { fetch } from "service/http";
import { getAPIWebSocketURL } from "utils/websocket";
import { z } from "zod";
import { create } from "zustand";
import { type FilterUsageType } from "./DashboardContext";

const configSchema = z
	.union([
		z
			.string()
			.optional()
			.transform((val, ctx) => {
				const trimmed = (val ?? "").trim();
				if (!trimmed) return null;
				try {
					return JSON.parse(trimmed);
				} catch (_err) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Invalid JSON for Xray config",
					});
					return z.NEVER;
				}
			}),
		z.record(z.any()),
		z.null(),
	])
	.nullish();

export const NodeSchema = z
	.object({
		name: z.string().min(1).max(120),
		note: z.string().max(500).nullable().optional(),
		address: z
			.string()
			.min(1)
			.refine((val) => {
				// Allow IPv4, IPv6, or domain
				const ipv4Regex =
					/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
				const ipv6Regex =
					/^\s*(?:(?:(?:[0-9a-f]{1,4}:){7}(?:[0-9a-f]{1,4}|:))|(?:(?:[0-9a-f]{1,4}:){6}(?::[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){5}(?:(?:(?::[0-9a-f]{1,4}){1,2})|:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){4}(?:(?:(?::[0-9a-f]{1,4}){1,3})|(?:(?::[0-9a-f]{1,4})?:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:(?:[0-9a-f]{1,4}:){3}(?:(?::[0-9a-f]{1,4}){1,4})|(?:(?::[0-9a-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:(?:[0-9a-f]{1,4}:){2}(?:(?::[0-9a-f]{1,4}){1,5})|(?:(?::[0-9a-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:(?:[0-9a-f]{1,4}:)(?:(?::[0-9a-f]{1,4}){1,6})|(?:(?::[0-9a-f]{1,4}){0,4}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?::(?:(?::[0-9a-f]{1,4}){1,7}|(?:(?::[0-9a-f]{1,4}){0,5}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(?:%.+)?\s*$/;
				const domainRegex =
					/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
				return (
					ipv4Regex.test(val) || ipv6Regex.test(val) || domainRegex.test(val)
				);
			}, "Invalid IP address or domain"),
		port: z
			.number()
			.min(1)
			.or(z.string().transform((v) => parseFloat(v))),
		api_port: z
			.number()
			.min(1)
			.or(z.string().transform((v) => parseFloat(v))),
		xray_version: z.string().nullable().optional(),
		node_service_version: z.string().nullable().optional(),
		node_install_mode: z.string().nullable().optional(),
		node_binary_tag: z.string().nullable().optional(),
		node_update_channel: z.string().nullable().optional(),
		cpu_cores: z.number().nullable().optional(),
		cpu_frequency_hz: z.number().nullable().optional(),
		cpu_usage_percent: z.number().nullable().optional(),
		memory_used: z.number().nullable().optional(),
		memory_total: z.number().nullable().optional(),
		memory_usage_percent: z.number().nullable().optional(),
		uptime_seconds: z.number().nullable().optional(),
		upload_speed: z.number().nullable().optional(),
		download_speed: z.number().nullable().optional(),
		id: z.number().nullable().optional(),
		status: z
			.enum(["connected", "connecting", "error", "disabled", "limited"])
			.nullable()
			.optional(),
		message: z.string().nullable().optional(),
		usage_coefficient: z
			.number()
			.or(z.string().transform((v) => parseFloat(v))),
		xray_config_mode: z.enum(["default", "custom"]).optional(),
		data_limit: z
			.number()
			.nullable()
			.optional()
			.or(
				z
					.string()
					.transform((v) => {
						if (v === "" || v === null || v === undefined) {
							return null;
						}
						const parsed = parseFloat(v);
						return Number.isFinite(parsed) ? parsed : null;
					})
					.nullable()
					.optional(),
			),
		uplink: z.number().nullable().optional(),
		downlink: z.number().nullable().optional(),
		use_nobetci: z.boolean().optional(),
		nobetci_port: z.number().nullable().optional(),
		proxy_enabled: z.boolean().optional(),
		proxy_type: z.enum(["http", "socks5"]).nullable().optional(),
		proxy_host: z.string().nullable().optional(),
		proxy_port: z
			.number()
			.nullable()
			.optional()
			.or(z.string().transform((v) => parseFloat(v))),
		proxy_username: z.string().nullable().optional(),
		proxy_password: z.string().nullable().optional(),
		certificate: z.string().optional(),
		certificate_key: z.string().optional(),
		certificate_token: z.string().optional(),
		has_custom_certificate: z.boolean().optional(),
		uses_default_certificate: z.boolean().optional(),
		certificate_public_key: z.string().nullable().optional(),
		node_certificate: z.string().nullable().optional(),
		node_certificate_key: z.string().nullable().optional(),
		xray_config: configSchema,
		sing_config: configSchema,
		hysteria_config: configSchema,
	})
	.superRefine((value, ctx) => {
		if (!value.proxy_enabled) {
			return;
		}

		if (!value.proxy_type) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["proxy_type"],
				message: "Proxy type is required",
			});
		}

		if (!value.proxy_host) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["proxy_host"],
				message: "Proxy host is required",
			});
		}

		if (
			value.proxy_port === null ||
			value.proxy_port === undefined ||
			Number.isNaN(value.proxy_port) ||
			value.proxy_port < 1 ||
			value.proxy_port > 65535
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["proxy_port"],
				message: "Proxy port must be between 1 and 65535",
			});
		}
	});

export type NodeType = z.infer<typeof NodeSchema>;
type NodeServiceUpdateRequest = NodeType & {
	channel?: string;
	version?: string;
};

export const getNodeDefaultValues = (): NodeType => ({
	name: "",
	note: "",
	address: "",
	port: 62050,
	api_port: 62051,
	xray_version: "",
	node_service_version: "",
	cpu_cores: null,
	cpu_frequency_hz: null,
	cpu_usage_percent: null,
	memory_used: null,
	memory_total: null,
	memory_usage_percent: null,
	uptime_seconds: null,
	upload_speed: null,
	download_speed: null,
	usage_coefficient: 1,
	xray_config_mode: "default",
	data_limit: null,
	uplink: 0,
	downlink: 0,
	use_nobetci: false,
	nobetci_port: null,
	proxy_enabled: false,
	proxy_type: null,
	proxy_host: null,
	proxy_port: null,
	proxy_username: null,
	proxy_password: null,
	xray_config: null,
	sing_config: null,
	hysteria_config: null,
});

export const FetchNodesQueryKey = "fetch-nodes-query-key";

export type NodeStore = {
	nodes: NodeType[];
	addNode: (node: NodeType) => Promise<NodeType>;
	fetchNodes: () => Promise<NodeType[]>;
	fetchNodesUsage: (query: FilterUsageType) => Promise<any>;
	updateNode: (node: NodeType) => Promise<NodeType>;
	regenerateNodeCertificate: (node: NodeType) => Promise<NodeType>;
	reconnectNode: (node: NodeType) => Promise<unknown>;
	restartNodeService: (node: NodeType) => Promise<unknown>;
	updateNodeService: (node: NodeServiceUpdateRequest) => Promise<unknown>;
	resetNodeUsage: (node: NodeType) => Promise<unknown>;
	deletingNode?: NodeType | null;
	deleteNode: () => Promise<unknown>;
	setDeletingNode: (node: NodeType | null) => void;
};

export const useNodesQuery = (options?: { enabled?: boolean }) => {
	return useQuery({
		queryKey: FetchNodesQueryKey,
		queryFn: useNodes.getState().fetchNodes,
		refetchOnWindowFocus: false,
		enabled: options?.enabled ?? true,
	});
};

const mergeLiveNodes = (
	current: NodeType[] | undefined,
	liveNodes: NodeType[],
) => {
	if (!current?.length) {
		return liveNodes;
	}
	const liveByID = new Map(
		liveNodes
			.filter((node) => node.id !== null && node.id !== undefined)
			.map((node) => [node.id, node]),
	);
	return current.map((node) => {
		const live =
			node.id !== null && node.id !== undefined ? liveByID.get(node.id) : null;
		return live ? { ...node, ...live } : node;
	});
};

export const useNodeMetricsStream = (enabled = true) => {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}
		const url = getAPIWebSocketURL("/nodes/metrics", { interval: 3 });
		if (!url) {
			return;
		}
		let closed = false;
		let ws: WebSocket | null = null;
		let reconnectTimer: number | undefined;

		const connect = () => {
			ws = new WebSocket(url);
			ws.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data);
					const liveNodes = Array.isArray(payload) ? payload : payload?.nodes;
					if (!Array.isArray(liveNodes)) {
						return;
					}
					queryClient.setQueryData<NodeType[]>(FetchNodesQueryKey, (current) =>
						mergeLiveNodes(current, liveNodes),
					);
				} catch (error) {
					console.error("Unable to parse node metrics stream payload", error);
				}
			};
			ws.onerror = () => {
				ws?.close();
			};
			ws.onclose = () => {
				if (!closed) {
					reconnectTimer = window.setTimeout(connect, 3000);
				}
			};
		};

		connect();
		return () => {
			closed = true;
			if (reconnectTimer) {
				window.clearTimeout(reconnectTimer);
			}
			ws?.close();
		};
	}, [enabled, queryClient]);
};

export const useNodes = create<NodeStore>((set, get) => ({
	nodes: [],
	addNode(body) {
		return fetch<NodeType>("/node", { method: "POST", body });
	},
	fetchNodes() {
		return fetch<NodeType[]>("/nodes");
	},
	fetchNodesUsage(query: FilterUsageType) {
		return fetch("/nodes/usage", { query });
	},
	updateNode(body) {
		return fetch<NodeType>(`/node/${body.id}`, {
			method: "PUT",
			body,
		});
	},
	regenerateNodeCertificate(body) {
		return fetch<NodeType>(`/node/${body.id}/certificate/regenerate`, {
			method: "POST",
		});
	},
	setDeletingNode(node) {
		set({ deletingNode: node });
	},
	reconnectNode(body) {
		return fetch(`/node/${body.id}/reconnect`, {
			method: "POST",
		});
	},
	restartNodeService(body) {
		return fetch(`/node/${body.id}/service/restart`, {
			method: "POST",
		});
	},
	updateNodeService(body) {
		return fetch(`/node/${body.id}/service/update`, {
			method: "POST",
			body: {
				channel: body.channel,
				version: body.version,
			},
		});
	},
	resetNodeUsage(body) {
		return fetch(`/node/${body.id}/usage/reset`, {
			method: "POST",
		});
	},
	deleteNode: () => {
		return fetch(`/node/${get().deletingNode?.id}`, {
			method: "DELETE",
		});
	},
}));
