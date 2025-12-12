import { useQuery } from "react-query";
import { fetch } from "service/http";
import { z } from "zod";
import { create } from "zustand";
import { type FilterUsageType, useDashboard } from "./DashboardContext";

export const NodeSchema = z.object({
	name: z.string().min(1),
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
	id: z.number().nullable().optional(),
	status: z
		.enum(["connected", "connecting", "error", "disabled", "limited"])
		.nullable()
		.optional(),
	message: z.string().nullable().optional(),
	add_as_new_host: z.boolean().optional(),
	usage_coefficient: z.number().or(z.string().transform((v) => parseFloat(v))),
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
	access_insights_enabled: z.boolean().optional(),
	nobetci_port: z.number().nullable().optional(),
	certificate: z.string().optional(),
	certificate_key: z.string().optional(),
	certificate_token: z.string().optional(),
	has_custom_certificate: z.boolean().optional(),
	uses_default_certificate: z.boolean().optional(),
	certificate_public_key: z.string().nullable().optional(),
	node_certificate: z.string().nullable().optional(),
});

export type NodeType = z.infer<typeof NodeSchema>;

export const getNodeDefaultValues = (): NodeType => ({
	name: "",
	address: "",
	port: 62050,
	api_port: 62051,
	xray_version: "",
	node_service_version: "",
	usage_coefficient: 1,
	data_limit: null,
	uplink: 0,
	downlink: 0,
	use_nobetci: false,
	access_insights_enabled: false,
	nobetci_port: null,
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
	updateNodeService: (node: NodeType) => Promise<unknown>;
	resetNodeUsage: (node: NodeType) => Promise<unknown>;
	updateMasterNode: (payload: {
		data_limit: number | null;
	}) => Promise<unknown>;
	resetMasterUsage: () => Promise<unknown>;
	deletingNode?: NodeType | null;
	deleteNode: () => Promise<unknown>;
	setDeletingNode: (node: NodeType | null) => void;
};

export const useNodesQuery = (options?: { enabled?: boolean }) => {
	const { isEditingNodes } = useDashboard();
	return useQuery({
		queryKey: FetchNodesQueryKey,
		queryFn: useNodes.getState().fetchNodes,
		refetchInterval: isEditingNodes ? 3000 : undefined,
		refetchOnWindowFocus: false,
		enabled: options?.enabled ?? true,
	});
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
		});
	},
	resetNodeUsage(body) {
		return fetch(`/node/${body.id}/usage/reset`, {
			method: "POST",
		});
	},
	updateMasterNode(body) {
		return fetch("/node/master", {
			method: "PUT",
			body,
		});
	},
	resetMasterUsage() {
		return fetch("/node/master/usage/reset", {
			method: "POST",
		});
	},
	deleteNode: () => {
		return fetch(`/node/${get().deletingNode?.id}`, {
			method: "DELETE",
		});
	},
}));
