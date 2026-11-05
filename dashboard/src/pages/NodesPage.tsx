import { TagChips } from "components/labels/TagChips";
import { TagFilterButton } from "components/labels/TagFilterButton";
import {
	EMPTY_LABEL_FILTER,
	type LabelFilterValue,
	matchesTagFilter,
} from "components/labels/LabelFilter";
import { useLabelItems } from "service/labels";
import { barClass } from "lib/tone";
import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Progress } from "components/ui/progress";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "components/ui/hover-card";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Alert, AlertDescription } from "components/ui/alert";
import { toast } from "components/ui/sonner";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Plus as AddIcon, Download, RefreshCw, BookOpen, CircleCheck, Cpu, Trash2 as DeleteIcon, Copy, Pencil as EditIcon, Globe, Ban, ShieldCheck, Wrench } from "lucide-react";

import { useDisclosure } from "hooks/useDisclosure";

import { cn } from "lib/cn";
import {
	ExpandedDetails,
	ExpandedHeading,
	ExpandedMeta,
} from "components/ui/ExpandedPanel";
import { DataTableSortMenu, type SortOption } from "components/ui/DataTableSortMenu";
import type { SortingState } from "@tanstack/react-table";
import { AppleEmojiText } from "components/common/AppleEmojiText";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { OverviewBand } from "components/ui/overview-band";
import { useDashboard } from "contexts/DashboardContext";
import {
	FetchNodesQueryKey,
	type NodeType,
	useNodeMetricsStream,
	useNodes,
	useNodesQuery,
} from "contexts/NodesContext";
import { type HostsSchema, useHosts } from "contexts/HostsContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetch as apiFetch } from "service/http";
import { formatBytes } from "utils/formatByte";
import { summarizeNodes } from "utils/resourceSummary";
import {
	DEFAULT_SEARCH_MATCH_OPTIONS,
	matchesAnySearch,
} from "utils/searchMatch";
import {
	getNodesPerPageLimitSize,
	setNodesPerPageLimitSize,
} from "utils/userPreferenceStorage";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import {
	DataTable,
	PageLoadingSkeleton,
	type DataTableColumn,
	type DataTableRowAction,
} from "../components/ui";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import type { BuildCatalog } from "../components/BuildVersionSelect";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { GeoUpdateDialog } from "../components/GeoUpdateDialog";
import { NodeFormModal } from "../components/NodeFormModal";
import { NodeInstallBundleDialog } from "../components/NodeInstallBundleDialog";
import { NodeModalStatusBadge } from "../components/NodeModalStatusBadge";
import {
	NodeServiceUpdateDialog,
	type NodeServiceUpdateChannel,
} from "../components/NodeServiceUpdateDialog";

const BULK_NODE_ACTIONS: Record<string, string> = {
	"bulk-enable": "enable",
	"bulk-disable": "disable",
	"bulk-delete": "delete",
	"bulk-reset": "usage-reset",
	"bulk-restart": "service-restart",
	"bulk-reboot": "host-reboot",
};

const normalizeVersion = (value?: string | null) => {
	if (!value) return "";
	const trimmed = value.trim();
	if (trimmed.toLowerCase().startsWith("dev-")) {
		return trimmed.toLowerCase();
	}
	return trimmed.replace(/^v+/i, "").split(/[-_]/)[0].trim();
};

dayjs.extend(utc);

const AddIconStyled = withClass(AddIcon, "w-4 h-4");
const DeleteIconStyled = withClass(DeleteIcon, "w-4 h-4");
const EditIconStyled = withClass(EditIcon, "w-4 h-4");
const ArrowPathIconStyled = withClass(RefreshCw, "w-4 h-4");
const CopyIconStyled = withClass(Copy, "w-4 h-4");
const DownloadIconStyled = withClass(Download, "w-4 h-4");
const TutorialIconStyled = withClass(BookOpen, "w-4 h-4");
const EnableIconStyled = withClass(CircleCheck, "w-4 h-4");
const DisableIconStyled = withClass(Ban, "w-4 h-4");
const CoreIconStyled = withClass(Cpu, "w-4 h-4");
const GeoIconStyled = withClass(Globe, "w-4 h-4");
const CertificateIconStyled = withClass(ShieldCheck, "w-4 h-4");
const ServiceIconStyled = withClass(Wrench, "w-4 h-4");

const EMPTY_CELL_VALUE = "-";

const formatCellValue = (value?: string | number | null): string => {
	if (value === null || value === undefined || value === "") {
		return EMPTY_CELL_VALUE;
	}
	return String(value);
};

const getNodeServiceUpdateAvailable = (
	currentVersion?: string | null,
	latestVersion?: string | null,
	channel?: string | null,
): boolean => {
	if (
		channel === "dev" &&
		!/^dev-[0-9a-f]{7,40}$/i.test(currentVersion ?? "")
	) {
		return false;
	}
	const current = normalizeVersion(currentVersion);
	const latest = normalizeVersion(latestVersion);
	return Boolean(current && latest && current !== latest);
};

const getNodeUpdateChannel = (
	node?: Pick<NodeType, "node_update_channel"> | null,
	fallback?: string,
) =>
	node?.node_update_channel === "dev"
		? "dev"
		: fallback === "dev"
			? "dev"
			: "latest";

const getNodeRuntimeVersion = (node: NodeType) =>
	node.node_binary_tag || node.node_service_version || "";

const getNodeRuntimeDisplayVersion = (node: NodeType) => {
	const version = getNodeRuntimeVersion(node);
	if (
		node.node_update_channel === "dev" &&
		!/^dev-[0-9a-f]{7,40}$/i.test(version)
	) {
		return version ? `dev (${version})` : "dev";
	}
	return version;
};

const getLatestNodeVersionForChannel = (
	maintenanceInfo: MaintenanceInfo | undefined,
	channel: string,
) =>
	channel === "dev"
		? maintenanceInfo?.node_update?.latest_dev?.tag || ""
		: maintenanceInfo?.node_update?.latest_release?.tag || "";

const formatNodeBytes = (value?: number | null, precision = 2) =>
	value !== null && value !== undefined ? formatBytes(value, precision) : "-";

const formatNodePercent = (value?: number | null) =>
	value !== null && value !== undefined && Number.isFinite(value)
		? `${Math.round(value * 10) / 10}%`
		: "-";

const formatCPUFrequency = (value?: number | null) => {
	if (
		value === null ||
		value === undefined ||
		!Number.isFinite(value) ||
		value <= 0
	) {
		return "-";
	}
	return `${Math.round((value / 1_000_000_000) * 100) / 100} GHz`;
};

const protocolColorScheme = (state: string) => {
	switch (state) {
		case "running":
			return "green";
		case "error":
			return "red";
		case "stopped":
			return "orange";
		default:
			return "gray";
	}
};

const ProtocolStatusList = ({
	statuses,
}: {
	statuses?: NodeType["protocol_statuses"];
}) => (
	<div className="flex-wrap flex gap-2">
		{statuses?.length ? (
			statuses.map((status) => (
				<Badge key={status.protocol} title={status.detail} className={toneClass(protocolColorScheme(status.state))}>
					{status.protocol} · {status.state}
					{status.inbounds > 0 ? ` (${status.inbounds})` : ""}
				</Badge>
			))
		) : (
			<p className="text-[0.875rem] text-panel-text-muted">
				-
			</p>
		)}
	</div>
);

const formatNodeLimit = (value?: number | null) =>
	value !== null && value !== undefined && value > 0
		? formatBytes(value, 2)
		: "∞";

const formatNodeSpeed = (value?: number | null) =>
	value !== null && value !== undefined ? `${formatBytes(value, 2)}/s` : "-";

const formatNodeUptime = (value?: number | null) => {
	if (
		value === null ||
		value === undefined ||
		!Number.isFinite(value) ||
		value <= 0
	) {
		return "-";
	}
	const units = [
		{ suffix: "y", seconds: 365 * 24 * 60 * 60 },
		{ suffix: "d", seconds: 24 * 60 * 60 },
		{ suffix: "h", seconds: 60 * 60 },
		{ suffix: "m", seconds: 60 },
		{ suffix: "s", seconds: 1 },
	];
	let remaining = Math.floor(value);
	const parts: string[] = [];
	for (const unit of units) {
		const amount = Math.floor(remaining / unit.seconds);
		if (amount > 0 || (unit.suffix === "s" && parts.length === 0)) {
			parts.push(`${amount}${unit.suffix}`);
			remaining -= amount * unit.seconds;
		}
		if (parts.length === 2) break;
	}
	return parts.join(" ");
};

const nodeNameSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const formatNodeNamePreview = (value?: string | null) => {
	const text = value?.trim();
	if (!text) return "";
	const graphemes = Array.from(nodeNameSegmenter.segment(text), ({ segment }) => segment);
	return graphemes.length > 10 ? `${graphemes.slice(0, 10).join("")}...` : text;
};

const boundedPercent = (value?: number | null) =>
	value !== null && value !== undefined && Number.isFinite(value)
		? Math.max(0, Math.min(100, value))
		: undefined;

const NodeMetricDisplay = ({
	value,
	helper,
	percent,
	colorScheme = "blue",
}: {
	value: string;
	helper?: string | null;
	percent?: number | null;
	colorScheme?: string;
}) => {
	const progressValue = boundedPercent(percent);
	return (
		<div className="flex flex-col items-center justify-center gap-1 min-w-0! max-w-full min-h-[34px] pb-1 text-center mx-auto">
			<p className="font-semibold text-[0.75rem] leading-[1.375] truncate max-w-full">
				{value}
			</p>
			{helper && helper !== "-" ? (
				<p className="text-[0.75rem] text-gray-500 leading-[1.375] truncate max-w-full">
					{helper}
				</p>
			) : null}
			{progressValue !== undefined && (
				<Progress value={progressValue} indicatorClassName={barClass(colorScheme)} className="rounded-full w-[46px] mx-auto bg-blackAlpha-100 dark:bg-whiteAlpha-200" />
			)}
		</div>
	);
};

const getNodeInstallBundle = (node: NodeType): string => {
	const cert = node.node_certificate?.trim() ?? "";
	const key = node.node_certificate_key?.trim() ?? "";
	if (cert && key) {
		return `${cert}\n${key}\n`;
	}
	return cert || node.certificate_public_key?.trim() || "";
};

type NodeSortKey =
	| "name"
	| "status"
	| "usage"
	| "bandwidth"
	| "cpu"
	| "ram"
	| "uptime";
type NodeSortDirection = "asc" | "desc";

const getNodeUsage = (node: NodeType) =>
	(node.uplink ?? 0) + (node.downlink ?? 0);

const getNodeBandwidth = (node: NodeType) =>
	(node.upload_speed ?? 0) + (node.download_speed ?? 0);

const splitHostAddressValues = (value?: string | null) =>
	String(value ?? "")
		.split(/\r?\n|[,;]/)
		.map((item) => item.trim())
		.filter(Boolean);

const normalizeNodeAddressToken = (value: string) =>
	value
		.trim()
		.replace(/^\[(.*)\]$/, "$1")
		.toLowerCase();

const uniqueHostValues = (values: string[]) => {
	const seen = new Set<string>();
	const result: string[] = [];
	values.forEach((value) => {
		const normalized = normalizeNodeAddressToken(value);
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		result.push(value.trim());
	});
	return result;
};

const getHostAddressValues = (host: HostsSchema[string][number]) =>
	uniqueHostValues([
		...splitHostAddressValues(host.address),
		...(Array.isArray(host.address_options) ? host.address_options : []),
	]);

const getHostLabel = (host: HostsSchema[string][number], inboundTag: string) =>
	host.remark?.trim() || `${inboundTag} #${host.id ?? "new"}`;

const emptyNodeHostImpact = (): NodeHostImpact => ({
	cleanupHostNames: [],
	cleanupPayload: {},
	cleanupTags: [],
	cleanupCount: 0,
	riskyHostNames: [],
	nodeAddresses: [],
});

const buildNodeHostImpact = (
	hosts: HostsSchema,
	nodesForAction: NodeType[],
): NodeHostImpact => {
	const nodeAddresses = uniqueHostValues(
		nodesForAction
			.map((node) => node.address ?? "")
			.map((address) => address.trim())
			.filter(Boolean),
	);
	if (nodeAddresses.length === 0 || !hosts || typeof hosts !== "object") {
		return emptyNodeHostImpact();
	}

	const nodeAddressSet = new Set(nodeAddresses.map(normalizeNodeAddressToken));
	const impact = emptyNodeHostImpact();
	impact.nodeAddresses = nodeAddresses;
	const cleanupTags = new Set<string>();
	const cleanupHostNames = new Set<string>();
	const riskyHostNames = new Set<string>();

	Object.entries(hosts).forEach(([inboundTag, hostList]) => {
		if (!Array.isArray(hostList)) return;
		let changed = false;
		const nextHostList = hostList.map((host) => {
			if (host.is_disabled) {
				return host;
			}
			const values = getHostAddressValues(host);
			const hasNodeAddress = values.some((value) =>
				nodeAddressSet.has(normalizeNodeAddressToken(value)),
			);
			if (!hasNodeAddress) {
				return host;
			}

			const remaining = values.filter(
				(value) => !nodeAddressSet.has(normalizeNodeAddressToken(value)),
			);
			const hostName = getHostLabel(host, inboundTag);
			if (remaining.length === 0) {
				riskyHostNames.add(hostName);
				return host;
			}

			changed = true;
			cleanupHostNames.add(hostName);
			return {
				...host,
				address: remaining.join(", "),
				address_options: [],
			};
		});
		if (changed) {
			impact.cleanupPayload[inboundTag] = nextHostList;
			cleanupTags.add(inboundTag);
		}
	});

	impact.cleanupTags = Array.from(cleanupTags);
	impact.cleanupHostNames = Array.from(cleanupHostNames);
	impact.cleanupCount = impact.cleanupHostNames.length;
	impact.riskyHostNames = Array.from(riskyHostNames);
	return impact;
};

const hasNodeHostImpact = (impact?: NodeHostImpact | null) =>
	Boolean(
		impact && (impact.cleanupCount > 0 || impact.riskyHostNames.length > 0),
	);

type VersionDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

type GeoDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

type ServiceUpdateTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes: NodeType[] };

type ServiceActionConfirm =
	| { type: "restart"; node: NodeType; label: string }
	| { type: "update"; node: NodeType; label: string }
	| { type: "reboot"; node: NodeType; label: string }
	| {
			type: "disable";
			node: NodeType;
			label: string;
			hostImpact?: NodeHostImpact;
	  }
	| { type: "update-all"; count: number }
	| {
			type:
				| "bulk-enable"
				| "bulk-disable"
				| "bulk-delete"
				| "bulk-reset"
				| "bulk-restart"
				| "bulk-update"
				| "bulk-reboot";
			nodes: NodeType[];
			count: number;
			hostImpact?: NodeHostImpact;
	  };

const createNodeActionBatchHeaders = () => ({
	"X-Rebecca-Action-Batch":
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(36).slice(2)}`,
});

type NodeHostImpact = {
	cleanupHostNames: string[];
	cleanupPayload: Partial<HostsSchema>;
	cleanupTags: string[];
	cleanupCount: number;
	riskyHostNames: string[];
	nodeAddresses: string[];
};

type MaintenanceInfo = {
	panel?: { mode?: string; install_mode?: string } | null;
	node_update?: {
		channel?: string;
		latest_release?: { tag?: string | null } | null;
		latest_dev?: { tag?: string | null } | null;
	} | null;
};

const nodeSortKeys: NodeSortKey[] = [
	"name",
	"status",
	"usage",
	"bandwidth",
	"cpu",
	"ram",
	"uptime",
];

const isNodeSortKey = (value: string): value is NodeSortKey =>
	nodeSortKeys.includes(value as NodeSortKey);

export const NodesPage: FC = () => {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const navigate = useNavigate();
	const { userData, getUserIsSuccess } = useGetUser();
	const canManageNodes =
		getUserIsSuccess && Boolean(userData.permissions?.sections.nodes);
	const onEditingNodes = useDashboard((state) => state.onEditingNodes);
	const {
		data: nodes,
		isLoading,
		error,
		refetch: refetchNodes,
		isFetching,
	} = useNodesQuery({ enabled: canManageNodes });
	useNodeMetricsStream(canManageNodes);
	const addNode = useNodes((state) => state.addNode);
	const updateNode = useNodes((state) => state.updateNode);
	const regenerateNodeCertificate = useNodes(
		(state) => state.regenerateNodeCertificate,
	);
	const reconnectNode = useNodes((state) => state.reconnectNode);
	const restartNodeService = useNodes((state) => state.restartNodeService);
	const rebootNodeHost = useNodes((state) => state.rebootNodeHost);
	const updateNodeService = useNodes((state) => state.updateNodeService);
	const resetNodeUsage = useNodes((state) => state.resetNodeUsage);
	const deleteNode = useNodes((state) => state.deleteNode);
	const setDeletingNode = useNodes((state) => state.setDeletingNode);
	const queryClient = useQueryClient();
	
	const refreshHosts = useHosts((state) => state.fetchHosts);
	const nodePanelBg = "bg-panel-surface";
	const nodePanelBorder = "border-panel-border!";
	const [editingNode, setEditingNode] = useState<NodeType | null>(null);
	const [expandedNodeID, setExpandedNodeID] = useState<number | null>(null);
	const [isAddNodeOpen, setAddNodeOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [statusFilter, setStatusFilter] = useState("all");
	const [installModeFilter, setInstallModeFilter] = useState("all");
	const [sortKey, setSortKey] = useState<NodeSortKey>("name");
	const [sortDirection, setSortDirection] = useState<NodeSortDirection>("asc");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(() => getNodesPerPageLimitSize());
	const [versionDialogTarget, setVersionDialogTarget] =
		useState<VersionDialogTarget | null>(null);
	const [serviceUpdateTarget, setServiceUpdateTarget] =
		useState<ServiceUpdateTarget | null>(null);
	const [geoDialogTarget, setGeoDialogTarget] =
		useState<GeoDialogTarget | null>(null);
	const [updatingCoreNodeId, setUpdatingCoreNodeId] = useState<number | null>(
		null,
	);
	const [updatingGeoNodeId, setUpdatingGeoNodeId] = useState<number | null>(
		null,
	);
	const [updatingBulkCore, setUpdatingBulkCore] = useState(false);
	const [togglingNodeId, setTogglingNodeId] = useState<number | null>(null);
	const [pendingStatus, setPendingStatus] = useState<Record<number, boolean>>(
		{},
	);
	const [resetCandidate, setResetCandidate] = useState<NodeType | null>(null);
	const [regeneratingNodeId, setRegeneratingNodeId] = useState<number | null>(
		null,
	);
	const [restartingServiceNodeId, setRestartingServiceNodeId] = useState<
		number | null
	>(null);
	const [rebootingHostNodeId, setRebootingHostNodeId] = useState<number | null>(
		null,
	);
	const [updatingServiceNodeId, setUpdatingServiceNodeId] = useState<
		number | null
	>(null);
	const [updatingBulkService, setUpdatingBulkService] = useState(false);
	const [serviceActionConfirm, setServiceActionConfirm] =
		useState<ServiceActionConfirm | null>(null);
	const [hostCleanupLoading, setHostCleanupLoading] = useState(false);
	const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
	const [bulkNodeActionLoading, setBulkNodeActionLoading] = useState<
		string | null
	>(null);
	const [newNodeCertificate, setNewNodeCertificate] = useState<{
		certificate: string;
		certificate_key?: string | null;
		name?: string | null;
	} | null>(null);
	const {
		isOpen: isResetConfirmOpen,
		onOpen: openResetConfirm,
		onClose: closeResetConfirm,
	} = useDisclosure();
	const [deleteCandidate, setDeleteCandidate] = useState<NodeType | null>(null);
	const {
		isOpen: isDeleteConfirmOpen,
		onOpen: openDeleteConfirm,
		onClose: closeDeleteConfirm,
	} = useDisclosure();
	useEffect(() => {
		setNodesPerPageLimitSize(String(pageSize));
	}, [pageSize]);

	const { data: maintenanceInfo } = useQuery<MaintenanceInfo>({ queryKey: ["maintenance-info"], queryFn: () => apiFetch<MaintenanceInfo>("/maintenance/info"), refetchOnWindowFocus: false,
			enabled: canManageNodes, });
	const { data: buildCatalog } = useQuery<BuildCatalog>({ queryKey: ["maintenance-builds", "node"], queryFn: () => apiFetch<BuildCatalog>("/maintenance/builds?target=node"), enabled: canManageNodes,
			refetchOnWindowFocus: false,
			staleTime: 10 * 60 * 1000,
			retry: false, });
	const detectedNodeUpdateChannel =
		nodes?.find((nodeItem) => nodeItem.node_update_channel)
			?.node_update_channel || maintenanceInfo?.node_update?.channel;
	const nodeUpdateChannel =
		detectedNodeUpdateChannel === "dev" ? "dev" : "latest";
	const panelInstallMode =
		maintenanceInfo?.panel?.mode ||
		maintenanceInfo?.panel?.install_mode ||
		"docker";
	const hostActionsAvailable = panelInstallMode === "binary";
	useEffect(() => {
		if (!canManageNodes) {
			onEditingNodes(false);
			return;
		}

		onEditingNodes(true);
		return () => {
			onEditingNodes(false);
		};
	}, [canManageNodes, onEditingNodes]);

	const { isPending: isAdding, mutate: addNodeMutate } = useMutation({ mutationFn: addNode, onSuccess: (createdNode: NodeType) => {
			generateSuccessMessage(
				t("nodes.addNodeSuccess", {
					name: createdNode.name ?? t("nodes.unnamedNode"),
				}),
				toast,
			);
			queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			refetchNodes();
		},
		onError: (err) => {
			generateErrorMessage(err, toast);
		}, });

	const { isPending: isUpdating, mutate: updateNodeMutate } = useMutation({ mutationFn: updateNode, onSuccess: () => {
				generateSuccessMessage(t("nodes.nodeUpdated"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				refetchNodes();
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			}, });

	const { isPending: isDeletingNode, mutate: deleteNodeMutate } = useMutation({ mutationFn: async (node: NodeType) => {
			setDeletingNode(node);
			return deleteNode();
		}, onSuccess: (_result, node) => {
				generateSuccessMessage(
					t("deleteNode.deleteSuccess", { name: node.name }),
					toast,
				);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				refetchNodes();
				closeDeleteConfirm();
				setDeleteCandidate(null);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setDeletingNode(null);
			}, });

	const { mutate: regenerateNodeCertMutate, isPending: isRegenerating } =
		useMutation({ mutationFn: regenerateNodeCertificate, onMutate: (node: NodeType) => {
				setRegeneratingNodeId(node.id ?? null);
			},
			onSuccess: (updatedNode: NodeType) => {
				generateSuccessMessage(t("nodes.regenerateCertSuccess"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				if (updatedNode?.node_certificate) {
					setNewNodeCertificate({
						certificate: updatedNode.node_certificate,
						certificate_key: updatedNode.node_certificate_key,
						name: updatedNode.name,
					});
				}
				setEditingNode(updatedNode);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setRegeneratingNodeId(null);
			}, });

	const { isPending: isReconnecting, mutate: reconnect } = useMutation({ mutationFn: reconnectNode, onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			}, });

	const { mutate: toggleNodeStatus, isPending: isToggling } = useMutation({ mutationFn: updateNode, onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: (_, __, variables: any) => {
				if (variables?.id != null) {
					setPendingStatus((prev) => {
						const next = { ...prev };
						delete next[variables.id as number];
						return next;
					});
				}
				setTogglingNodeId(null);
			}, });

	const loadNodeHostImpact = async (nodesForAction: NodeType[]) => {
		const currentHosts = await apiFetch<HostsSchema>("/hosts");
		return buildNodeHostImpact(currentHosts || {}, nodesForAction);
	};

	const applyNodeHostCleanup = async (impact?: NodeHostImpact | null) => {
		if (!impact || impact.cleanupCount === 0) {
			return;
		}
		await apiFetch("/hosts", {
			method: "PUT",
			body: impact.cleanupPayload,
		});
		refreshHosts();
		toast.success(t("nodes.hostAddressCleanupApplied", {
				count: impact.cleanupCount,
			}), { duration: 2400 });
	};

	const renderHostImpactMessage = (
		baseMessage: string,
		impact?: NodeHostImpact | null,
	) => {
		if (!hasNodeHostImpact(impact)) {
			return baseMessage;
		}
		const cleanupNames = impact?.cleanupHostNames ?? [];
		const riskyNames = impact?.riskyHostNames ?? [];
		const formatNames = (items: string[]) => {
			const visible = items.slice(0, 4).join(", ");
			const remaining = items.length - 4;
			return remaining > 0 ? `${visible} +${remaining}` : visible;
		};
		return (
			<div className="flex flex-col items-stretch gap-2">
				<p>{baseMessage}</p>
				{cleanupNames.length > 0 && (
					<p className="text-blue-300">
						{t("nodes.hostAddressCleanupNotice", {
							hosts: formatNames(cleanupNames),
						})}
					</p>
				)}
				{riskyNames.length > 0 && (
					<p className="text-orange-300 font-bold">
						{t("nodes.hostAddressRiskNotice", {
							hosts: formatNames(riskyNames),
						})}
					</p>
				)}
			</div>
		);
	};

	const { isPending: isResettingUsage, mutate: resetUsageMutate } = useMutation({ mutationFn: resetNodeUsage, onSuccess: () => {
				generateSuccessMessage(t("nodes.resetUsageSuccess"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setResetCandidate(null);
				closeResetConfirm();
			}, });

	const { mutate: restartServiceMutate, isPending: isRestartingService } =
		useMutation({ mutationFn: restartNodeService, onMutate: (node: NodeType) => {
				setRestartingServiceNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(t("nodes.restartServiceTriggered"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setRestartingServiceNodeId(null);
			}, });

	const { mutate: updateServiceMutate, isPending: isUpdatingService } =
		useMutation({ mutationFn: updateNodeService, onMutate: (node) => {
				setUpdatingServiceNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(t("nodes.updateServiceTriggered"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setUpdatingServiceNodeId(null);
			}, });

	const { mutate: rebootHostMutate, isPending: isRebootingHost } = useMutation({ mutationFn: rebootNodeHost, onMutate: (node: NodeType) => {
				setRebootingHostNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(t("nodes.rebootHostTriggered"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setRebootingHostNodeId(null);
			}, });

	const runToggleNodeStatus = (node: NodeType) => {
		if (!node?.id) return;
		const isEnabled = node.status !== "disabled";
		const nextStatus = isEnabled ? "disabled" : "connecting";
		const nodeId = node.id as number;
		setTogglingNodeId(nodeId);
		setPendingStatus((prev) => ({ ...prev, [nodeId]: !isEnabled }));
		toggleNodeStatus({ ...node, status: nextStatus });
	};

	const handleToggleNode = async (node: NodeType) => {
		if (!node?.id) return;
		const isEnabled = node.status !== "disabled";
		if (!isEnabled) {
			runToggleNodeStatus(node);
			return;
		}
		try {
			const hostImpact = await loadNodeHostImpact([node]);
			if (hostImpact.riskyHostNames.length > 0) {
				const label = node.name || node.address || t("nodes.thisNode");
				setServiceActionConfirm({
					type: "disable",
					node,
					label,
					hostImpact,
				});
				return;
			}
			setHostCleanupLoading(true);
			await applyNodeHostCleanup(hostImpact);
			runToggleNodeStatus(node);
		} catch (err) {
			generateErrorMessage(err, toast);
		} finally {
			setHostCleanupLoading(false);
		}
	};

	const handleResetNodeUsage = (node: NodeType) => {
		if (!node?.id) return;
		setResetCandidate(node);
		openResetConfirm();
	};

	const handleDeleteNodeRequest = (node: NodeType) => {
		if (!node?.id) return;
		setDeleteCandidate(node);
		openDeleteConfirm();
	};

	const handleCloseDeleteConfirm = () => {
		if (isDeletingNode) return;
		closeDeleteConfirm();
		setDeleteCandidate(null);
	};

	const confirmDeleteNode = () => {
		if (!deleteCandidate) return;
		deleteNodeMutate(deleteCandidate);
	};

	const handleRestartNodeService = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode");
		setServiceActionConfirm({ type: "restart", node, label });
	};

	const handleUpdateNodeService = useCallback((node: NodeType) => {
		if (!node?.id) return;
		setServiceUpdateTarget({ type: "node", node });
	}, []);

	const closeServiceUpdateDialog = () => {
		if (updatingServiceNodeId !== null || updatingBulkService) return;
		setServiceUpdateTarget(null);
	};

	const handleServiceUpdateSubmit = async (
		channel: NodeServiceUpdateChannel,
		version?: string,
	) => {
		if (!serviceUpdateTarget) return;
		if (serviceUpdateTarget.type === "node") {
			const node = serviceUpdateTarget.node;
			if (!node.id) return;
			setUpdatingServiceNodeId(node.id);
			try {
				await apiFetch(`/node/${node.id}/service/update`, {
					method: "POST",
					body: { channel, version },
				});
				generateSuccessMessage(t("nodes.updateServiceTriggered"), toast);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				queryClient.invalidateQueries({ queryKey: ["maintenance-info"] });
				setServiceUpdateTarget(null);
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingServiceNodeId(null);
			}
			return;
		}

		const targetNodes = serviceUpdateTarget.nodes.filter(
			(node) => node.id != null,
		);
		if (targetNodes.length === 0) return;
		setUpdatingBulkService(true);
		try {
			await apiFetch("/nodes/service/update", {
				method: "POST",
				body: {
					nodes: targetNodes.map((node) => ({ id: node.id, channel, version })),
				},
			});
			generateSuccessMessage(
				t("nodes.updateAllNodeServicesTriggered", {
					count: targetNodes.length,
				}),
				toast,
			);
			queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			queryClient.invalidateQueries({ queryKey: ["maintenance-info"] });
			setServiceUpdateTarget(null);
		} catch (err) {
			generateErrorMessage(err, toast);
		} finally {
			setUpdatingBulkService(false);
		}
	};

	const handleRebootNodeHost = useCallback(
		(node: NodeType) => {
			if (!node?.id) return;
			const label = node.name || node.address || t("nodes.thisNode");
			setServiceActionConfirm({ type: "reboot", node, label });
		},
		[t],
	);

	const copyToClipboard = async (
		value: string | null | undefined,
		label: string,
	) => {
		const text = value?.trim();
		if (!text) {
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t("nodes.copySuccess", { label }), { duration: 1800 });
		} catch (error) {
			generateErrorMessage(error, toast);
		}
	};

	const confirmResetUsage = () => {
		if (!resetCandidate?.id) return;
		resetUsageMutate(resetCandidate);
	};

	const handleCloseResetConfirm = () => {
		setResetCandidate(null);
		closeResetConfirm();
	};

	const handleUpdateAllNodeServices = () => {
		const targetNodes = (nodes ?? []).filter(
			(node) => node.id != null && node.node_install_mode === "binary",
		);
		if (targetNodes.length === 0) {
			toast.warning(t("nodes.noBinaryNodesForServiceUpdate"));
			return;
		}
		setServiceUpdateTarget({ type: "bulk", nodes: targetNodes });
	};

	const closeServiceActionConfirm = () => {
		if (
			isRestartingService ||
			isUpdatingService ||
			updatingBulkService ||
			hostCleanupLoading
		) {
			return;
		}
		setServiceActionConfirm(null);
	};

	const confirmServiceAction = async () => {
		if (!serviceActionConfirm) {
			return;
		}
		if (serviceActionConfirm.type === "restart") {
			restartServiceMutate(serviceActionConfirm.node);
			setServiceActionConfirm(null);
			return;
		}
		if (serviceActionConfirm.type === "update") {
			updateServiceMutate({
				...serviceActionConfirm.node,
				channel: getNodeUpdateChannel(
					serviceActionConfirm.node,
					nodeUpdateChannel,
				),
			});
			setServiceActionConfirm(null);
			return;
		}
		if (serviceActionConfirm.type === "reboot") {
			rebootHostMutate(serviceActionConfirm.node);
			setServiceActionConfirm(null);
			return;
		}
		if (serviceActionConfirm.type === "disable") {
			const targetNode = serviceActionConfirm.node;
			const hostImpact = serviceActionConfirm.hostImpact;
			setServiceActionConfirm(null);
			try {
				setHostCleanupLoading(true);
				await applyNodeHostCleanup(hostImpact);
				runToggleNodeStatus(targetNode);
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setHostCleanupLoading(false);
			}
			return;
		}

		if (
			serviceActionConfirm.type === "bulk-enable" ||
			serviceActionConfirm.type === "bulk-disable" ||
			serviceActionConfirm.type === "bulk-delete" ||
			serviceActionConfirm.type === "bulk-reset" ||
			serviceActionConfirm.type === "bulk-restart" ||
			serviceActionConfirm.type === "bulk-update" ||
			serviceActionConfirm.type === "bulk-reboot"
		) {
			const actionType = serviceActionConfirm.type;
			const targetNodes = serviceActionConfirm.nodes.filter(
				(node: NodeType) => node.id != null,
			);
			const hostImpact = serviceActionConfirm.hostImpact;
			setServiceActionConfirm(null);
			setBulkNodeActionLoading(actionType);
			let successCount = 0;
			let failedCount = 0;
			const completedIDs: number[] = [];
			const recentActionHeaders = createNodeActionBatchHeaders();
			if (actionType === "bulk-disable") {
				try {
					await applyNodeHostCleanup(hostImpact);
				} catch (err) {
					setBulkNodeActionLoading(null);
					generateErrorMessage(err, toast);
					return;
				}
			}
			if (actionType === "bulk-update") {
				try {
					await apiFetch("/nodes/service/update", {
						method: "POST",
						headers: recentActionHeaders,
						body: {
							nodes: targetNodes.map((node) => ({
								id: node.id,
								channel: getNodeUpdateChannel(node, nodeUpdateChannel),
							})),
						},
					});
					successCount = targetNodes.length;
					completedIDs.push(
						...targetNodes.flatMap((node) =>
							node.id == null ? [] : [node.id],
						),
					);
				} catch (err) {
					failedCount = targetNodes.length;
					generateErrorMessage(err, toast);
				}
			} else {
				const nodeIds = targetNodes.flatMap((node) =>
					node.id == null ? [] : [node.id],
				);
				try {
					await apiFetch("/nodes/bulk", {
						method: "POST",
						headers: recentActionHeaders,
						body: {
							action: BULK_NODE_ACTIONS[actionType],
							node_ids: nodeIds,
						},
					});
					successCount = nodeIds.length;
					completedIDs.push(...nodeIds);
				} catch (err) {
					failedCount = nodeIds.length;
					generateErrorMessage(err, toast);
				}
			}
			setBulkNodeActionLoading(null);
			queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
			refetchNodes();
			if (actionType === "bulk-delete") {
				setSelectedNodeIds((current) =>
					current.filter((id) => !completedIDs.includes(id)),
				);
			}
			if (successCount > 0) {
				generateSuccessMessage(
					t("nodes.bulkActionSuccess", { count: successCount }),
					toast,
				);
			}
			if (failedCount > 0) {
				toast.error(t("nodes.bulkActionFailed", { count: failedCount }));
			}
			return;
		}

		const targetNodes = (nodes ?? []).filter(
			(node) => node.id != null && node.node_install_mode === "binary",
		);
		if (targetNodes.length === 0) {
			setServiceActionConfirm(null);
			return;
		}

		setUpdatingBulkService(true);
		setServiceActionConfirm(null);
		let successCount = 0;
		let failedCount = 0;
		try {
			await apiFetch("/nodes/service/update", {
				method: "POST",
				body: {
					nodes: targetNodes.map((node) => ({
						id: node.id,
						channel: getNodeUpdateChannel(node, nodeUpdateChannel),
					})),
				},
			});
			successCount = targetNodes.length;
		} catch (err) {
			failedCount = targetNodes.length;
			generateErrorMessage(err, toast);
		}
		setUpdatingBulkService(false);
		queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
		refetchNodes();
		if (successCount > 0) {
			generateSuccessMessage(
				t("nodes.updateAllNodeServicesTriggered", { count: successCount }),
				toast,
			);
		}
		if (failedCount > 0) {
			toast.error(t("nodes.updateAllNodeServicesFailed", { count: failedCount }));
		}
	};

	const closeVersionDialog = () => setVersionDialogTarget(null);
	const closeGeoDialog = () => setGeoDialogTarget(null);

	const handleVersionSubmit = async ({
		version,
	}: {
		version: string;
		persist?: boolean;
	}) => {
		if (!versionDialogTarget) {
			return;
		}

		if (versionDialogTarget.type === "bulk") {
			const targetNodes =
				versionDialogTarget.nodes?.filter(
					(node) => node.id != null && node.status === "connected",
				) ??
				(nodes ?? []).filter(
					(node) => node.id != null && node.status === "connected",
				);
			if (targetNodes.length === 0) {
				toast.warning(t("nodes.coreVersionDialog.noConnectedNodes"));
				return;
			}

			setUpdatingBulkCore(true);
			try {
				const recentActionHeaders = createNodeActionBatchHeaders();
				await apiFetch("/nodes/bulk", {
					method: "POST",
					headers: recentActionHeaders,
					body: {
						action: "core-update",
						node_ids: targetNodes.flatMap((node) =>
							node.id == null ? [] : [node.id],
						),
						options: { version },
					},
				});
				generateSuccessMessage(
					t("nodes.coreVersionDialog.bulkSuccess", {
						success: targetNodes.length,
						total: targetNodes.length,
					}),
					toast,
				);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				closeVersionDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingBulkCore(false);
			}
			return;
		}

		if (versionDialogTarget.type === "node") {
			const targetNode = versionDialogTarget.node;
			if (!targetNode?.id) {
				return;
			}
			setUpdatingCoreNodeId(targetNode.id);
			try {
				await apiFetch(`/node/${targetNode.id}/xray/update`, {
					method: "POST",
					body: { version },
				});
				generateSuccessMessage(
					t("nodes.coreVersionDialog.nodeUpdateSuccess", {
						name: targetNode.name ?? t("nodes.unnamedNode"),
						version,
					}),
					toast,
				);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				closeVersionDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingCoreNodeId(null);
			}
		}
	};

	const handleGeoSubmit = async (payload: {
		mode: "template" | "manual";
		templateIndexUrl: string;
		templateName: string;
		files: { name: string; url: string }[];
		persistEnv: boolean;
		nodeId?: number;
	}) => {
		if (!geoDialogTarget) {
			return;
		}

		const body = {
			mode: payload.mode,
			template_index_url: payload.templateIndexUrl,
			template_name: payload.templateName,
			files: payload.files,
			persist_env: payload.persistEnv,
		};

		if (geoDialogTarget.type === "node") {
			const targetNode = geoDialogTarget.node;
			if (!targetNode?.id) {
				return;
			}
			setUpdatingGeoNodeId(targetNode.id);
			try {
				await apiFetch(`/node/${targetNode.id}/geo/update`, {
					method: "POST",
					body,
				});
				generateSuccessMessage(
					t("nodes.geoDialog.nodeUpdateSuccess", {
						name: targetNode.name ?? t("nodes.unnamedNode"),
					}),
					toast,
				);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				closeGeoDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingGeoNodeId(null);
			}
		}

		if (geoDialogTarget.type === "bulk") {
			const targetNodes =
				geoDialogTarget.nodes?.filter(
					(node) => node.id != null && node.status === "connected",
				) ?? [];
			if (targetNodes.length === 0) {
				toast.warning(t("nodes.geoDialog.noConnectedNodes"));
				return;
			}
			setBulkNodeActionLoading("bulk-geo");
			try {
				await apiFetch("/nodes/bulk", {
					method: "POST",
					headers: createNodeActionBatchHeaders(),
					body: {
						action: "geo-update",
						node_ids: targetNodes.flatMap((node) =>
							node.id == null ? [] : [node.id],
						),
						options: body,
					},
				});
				generateSuccessMessage(
					t("nodes.geoDialog.bulkSuccess", { count: targetNodes.length }),
					toast,
				);
				queryClient.invalidateQueries({ queryKey: [FetchNodesQueryKey] });
				closeGeoDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setBulkNodeActionLoading(null);
			}
		}
	};

	const { data: nodeLabels } = useLabelItems("node");
	const [tagFilter, setTagFilter] = useState<LabelFilterValue>(EMPTY_LABEL_FILTER);
	const filteredNodes = useMemo(() => {
		if (!nodes) return [];
		return nodes.filter((node) => {
			if (!matchesTagFilter(nodeLabels?.items[String(node.id)]?.tags, tagFilter)) {
				return false;
			}
			const runtime = node.node_binary_tag || node.node_service_version || "";
			const matchesSearch = matchesAnySearch(
				[node.name, node.address, node.xray_version, runtime, node.note],
				searchTerm,
				searchMatch,
			);
			const matchesStatus =
				statusFilter === "all" || (node.status || "error") === statusFilter;
			const matchesInstallMode =
				installModeFilter === "all" ||
				(node.node_install_mode || "unknown") === installModeFilter;
			return matchesSearch && matchesStatus && matchesInstallMode;
		});
	}, [nodes, nodeLabels, tagFilter, searchMatch, searchTerm, statusFilter, installModeFilter]);

	const sortedNodes = useMemo(() => {
		const sorted = [...filteredNodes];
		sorted.sort((left, right) => {
			const direction = sortDirection === "asc" ? 1 : -1;
			const compareText = (a: string, b: string) =>
				a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
			let result = 0;
			switch (sortKey) {
				case "usage":
					result = getNodeUsage(left) - getNodeUsage(right);
					break;
				case "bandwidth":
					result = getNodeBandwidth(left) - getNodeBandwidth(right);
					break;
				case "cpu":
					result =
						(left.cpu_usage_percent ?? -1) - (right.cpu_usage_percent ?? -1);
					break;
				case "ram":
					result =
						(left.memory_usage_percent ?? -1) -
						(right.memory_usage_percent ?? -1);
					break;
				case "uptime":
					result = (left.uptime_seconds ?? -1) - (right.uptime_seconds ?? -1);
					break;
				case "status":
					result = compareText(left.status || "error", right.status || "error");
					break;
				default:
					result = compareText(left.name || "", right.name || "");
					break;
			}
			return result * direction;
		});
		return sorted;
	}, [filteredNodes, sortDirection, sortKey]);

	const totalPages = Math.max(1, Math.ceil(sortedNodes.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const paginatedNodes = useMemo(
		() =>
			sortedNodes.slice((currentPage - 1) * pageSize, currentPage * pageSize),
		[sortedNodes, currentPage, pageSize],
	);

	const paginationStart =
		sortedNodes.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
	const paginationEnd = Math.min(currentPage * pageSize, sortedNodes.length);
	const selectedNodeIdSet = useMemo(
		() => new Set(selectedNodeIds),
		[selectedNodeIds],
	);
	const selectedNodes = useMemo(
		() =>
			(nodes ?? []).filter(
				(node) => node.id != null && selectedNodeIdSet.has(node.id),
			),
		[nodes, selectedNodeIdSet],
	);
	const filteredNodeIds = useMemo(
		() =>
			filteredNodes
				.map((node) => node.id)
				.filter((id): id is number => id != null),
		[filteredNodes],
	);
	const activeFilteredNodeIds = useMemo(
		() =>
			filteredNodes
				.filter((node) => node.status === "connected")
				.map((node) => node.id)
				.filter((id): id is number => id != null),
		[filteredNodes],
	);
	const allFilteredSelected =
		filteredNodeIds.length > 0 &&
		filteredNodeIds.every((id) => selectedNodeIdSet.has(id));
	const onlyActiveFilteredSelected =
		activeFilteredNodeIds.length > 0 &&
		selectedNodeIds.length === activeFilteredNodeIds.length &&
		activeFilteredNodeIds.every((id) => selectedNodeIdSet.has(id));

	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing filters must reset pagination.
	useEffect(() => {
		setPage(1);
	}, [
		searchTerm,
		statusFilter,
		installModeFilter,
		sortKey,
		sortDirection,
		pageSize,
	]);

	useEffect(() => {
		const availableIds = new Set(
			(nodes ?? [])
				.map((node) => node.id)
				.filter((id): id is number => id != null),
		);
		setSelectedNodeIds((current) =>
			current.filter((id) => availableIds.has(id)),
		);
	}, [nodes]);

	const selectAllFilteredNodes = () => {
		setSelectedNodeIds(filteredNodeIds);
	};

	const selectOnlyActiveNodes = () => {
		setSelectedNodeIds(activeFilteredNodeIds);
	};

	const selectableSelectedNodes = () =>
		selectedNodes.filter((node) => node.id != null);

	const selectedBinaryNodes = () =>
		selectableSelectedNodes().filter(
			(node) => node.node_install_mode === "binary",
		);

	const selectedConnectedBinaryNodes = () =>
		selectedBinaryNodes().filter((node) => node.status === "connected");

	const openBulkActionConfirm = async (
		type:
			| "bulk-enable"
			| "bulk-disable"
			| "bulk-delete"
			| "bulk-reset"
			| "bulk-restart"
			| "bulk-update"
			| "bulk-reboot",
		nodesForAction: NodeType[],
	) => {
		if (nodesForAction.length === 0) {
			toast.warning(t("nodes.noSelectedNodesForAction"));
			return;
		}
		if (type === "bulk-update") {
			setServiceUpdateTarget({ type: "bulk", nodes: nodesForAction });
			return;
		}
		let hostImpact: NodeHostImpact | undefined;
		if (type === "bulk-disable") {
			try {
				hostImpact = await loadNodeHostImpact(nodesForAction);
			} catch (err) {
				generateErrorMessage(err, toast);
				return;
			}
		}
		setServiceActionConfirm({
			type,
			nodes: nodesForAction,
			count: nodesForAction.length,
			hostImpact,
		});
	};

	const nodeOverview = useMemo(() => {
		const summary = summarizeNodes(nodes ?? []);
		return {
			total: {
				label: t("total"),
				value: summary.total,
				caption: `${t("nodes.disabled")}: ${summary.disabled}`,
			},
			rows: [
				{ key: "connected", label: t("nodeModal.status.connected"), value: summary.connected, tone: "bg-panel-success" },
				{ key: "error", label: t("nodeModal.status.error"), value: summary.error, tone: "bg-panel-danger" },
			],
			distribution: {
				label: t("nodes.sections.health"),
				segments: [
					{ key: "connected", label: t("nodeModal.status.connected"), value: summary.connected, tone: "bg-panel-success" },
					{ key: "connecting", label: t("nodeModal.status.connecting"), value: summary.connecting, tone: "bg-panel-info" },
					{ key: "error", label: t("nodeModal.status.error"), value: summary.error, tone: "bg-panel-danger" },
					{ key: "limited", label: t("nodeModal.status.limited"), value: summary.limited, tone: "bg-panel-warning" },
					{ key: "disabled", label: t("nodeModal.status.disabled"), value: summary.disabled, tone: "bg-panel-text-muted/60" },
				],
			},
			extra: {
				label: t("summary.usage"),
				value: formatBytes(summary.usage, 2),
				caption: `↑ ${formatBytes(summary.uploadSpeed, 2)}/s · ↓ ${formatBytes(summary.downloadSpeed, 2)}/s`,
			},
		};
	}, [nodes, t]);

	const hasConnectedNodes = useMemo(
		() =>
			(nodes ?? []).some(
				(node) => node.id != null && node.status === "connected",
			),
		[nodes],
	);
	const hasBinaryNodes = useMemo(
		() =>
			(nodes ?? []).some(
				(node) => node.id != null && node.node_install_mode === "binary",
			),
		[nodes],
	);

	const errorMessage = useMemo(() => {
		if (!error) return undefined;
		if (error instanceof Error) return error.message;
		if (typeof error === "string") return error;
		if (typeof error === "object" && "message" in error) {
			const possible = (error as { message?: unknown }).message;
			if (typeof possible === "string") return possible;
		}
		return t("errorOccurred");
	}, [error, t]);

	const hasError = Boolean(errorMessage);

	const versionDialogLoading =
		versionDialogTarget?.type === "node"
			? versionDialogTarget.node.id != null &&
				updatingCoreNodeId === versionDialogTarget.node.id
			: versionDialogTarget?.type === "bulk"
				? updatingBulkCore
				: false;

	const geoDialogLoading =
		geoDialogTarget?.type === "node"
			? geoDialogTarget.node.id != null &&
				updatingGeoNodeId === geoDialogTarget.node.id
			: geoDialogTarget?.type === "bulk"
				? bulkNodeActionLoading === "bulk-geo"
				: false;

	const serviceActionConfirmTitle =
		serviceActionConfirm?.type === "restart"
			? t("nodes.restartServiceAction")
			: serviceActionConfirm?.type === "update"
				? t("nodes.updateServiceAction")
				: serviceActionConfirm?.type === "reboot"
					? t("nodes.rebootHostAction")
					: serviceActionConfirm?.type === "disable"
						? t("nodes.disableNode")
						: serviceActionConfirm?.type === "update-all"
							? t("nodes.updateAllNodeServices")
							: serviceActionConfirm?.type === "bulk-enable"
								? t("nodes.bulkEnable")
								: serviceActionConfirm?.type === "bulk-disable"
									? t("nodes.bulkDisable")
									: serviceActionConfirm?.type === "bulk-delete"
										? t("nodes.bulkDelete")
										: serviceActionConfirm?.type === "bulk-reset"
											? t("nodes.bulkResetTraffic")
											: serviceActionConfirm?.type === "bulk-restart"
												? t("nodes.bulkRestartService")
												: serviceActionConfirm?.type === "bulk-update"
													? t("nodes.bulkUpdateService")
													: serviceActionConfirm?.type === "bulk-reboot"
														? t("nodes.bulkRebootHost")
														: "";

	const serviceActionConfirmMessage =
		serviceActionConfirm?.type === "restart"
			? t("nodes.restartServiceConfirm", { name: serviceActionConfirm.label })
			: serviceActionConfirm?.type === "update"
				? t("nodes.updateServiceConfirm", { name: serviceActionConfirm.label })
				: serviceActionConfirm?.type === "reboot"
					? t("nodes.rebootHostConfirm", { name: serviceActionConfirm.label })
					: serviceActionConfirm?.type === "disable"
						? renderHostImpactMessage(
								t("nodes.disableConfirm", {
									name: serviceActionConfirm.label,
								}),
								serviceActionConfirm.hostImpact,
							)
						: serviceActionConfirm?.type === "update-all"
							? t("nodes.updateAllNodeServicesConfirm", {
									count: serviceActionConfirm.count,
								})
							: serviceActionConfirm?.type === "bulk-enable"
								? t("nodes.bulkEnableConfirm", {
										count: serviceActionConfirm.count,
									})
								: serviceActionConfirm?.type === "bulk-disable"
									? renderHostImpactMessage(
											t("nodes.bulkDisableConfirm", {
												count: serviceActionConfirm.count,
											}),
											serviceActionConfirm.hostImpact,
										)
									: serviceActionConfirm?.type === "bulk-delete"
										? t("nodes.bulkDeleteConfirm", {
												count: serviceActionConfirm.count,
											})
										: serviceActionConfirm?.type === "bulk-reset"
											? t("nodes.bulkResetTrafficConfirm", {
													count: serviceActionConfirm.count,
												})
											: serviceActionConfirm?.type === "bulk-restart"
												? t("nodes.bulkRestartServiceConfirm", {
														count: serviceActionConfirm.count,
													})
												: serviceActionConfirm?.type === "bulk-update"
													? t("nodes.bulkUpdateServiceConfirm", {
															count: serviceActionConfirm.count,
														})
													: serviceActionConfirm?.type === "bulk-reboot"
														? t("nodes.bulkRebootHostConfirm", {
																count: serviceActionConfirm.count,
															})
														: "";

	const serviceActionConfirmLabel =
		serviceActionConfirm?.type === "restart"
			? t("nodes.restartServiceAction")
			: serviceActionConfirm?.type === "reboot"
				? t("nodes.rebootHostAction")
				: serviceActionConfirm?.type === "update-all"
					? t("nodes.updateAllNodeServices")
					: serviceActionConfirm?.type === "disable"
						? t("nodes.disableNode")
						: serviceActionConfirm?.type === "bulk-enable"
							? t("nodes.enableNode")
							: serviceActionConfirm?.type === "bulk-disable"
								? t("nodes.disableNode")
								: serviceActionConfirm?.type === "bulk-delete"
									? t("delete")
									: serviceActionConfirm?.type === "bulk-reset"
										? t("nodes.resetUsage")
										: serviceActionConfirm?.type === "bulk-restart"
											? t("nodes.restartServiceAction")
											: serviceActionConfirm?.type === "bulk-update"
												? t("nodes.updateServiceAction")
												: serviceActionConfirm?.type === "bulk-reboot"
													? t("nodes.rebootHostAction")
													: t("nodes.updateServiceAction");

	const serviceActionConfirmLoading =
		isRestartingService ||
		isUpdatingService ||
		isRebootingHost ||
		hostCleanupLoading ||
		updatingBulkService ||
		Boolean(bulkNodeActionLoading);

	const serviceUpdateDialogTitle =
		serviceUpdateTarget?.type === "node"
			? t("nodes.updateServiceDialog.nodeTitle", {
					name: serviceUpdateTarget.node.name ?? t("nodes.unnamedNode"),
				})
			: t("nodes.updateServiceDialog.bulkTitle");
	const serviceUpdateDialogDescription =
		serviceUpdateTarget?.type === "node"
			? t("nodes.updateServiceDialog.nodeDescription")
			: t("nodes.updateServiceDialog.bulkDescription", {
					count: serviceUpdateTarget?.nodes.length ?? 0,
				});
	const serviceUpdateCurrentChannel =
		serviceUpdateTarget?.type === "node"
			? getNodeUpdateChannel(serviceUpdateTarget.node, nodeUpdateChannel)
			: nodeUpdateChannel;
	const serviceUpdateCurrentVersion =
		serviceUpdateTarget?.type === "node"
			? getNodeRuntimeVersion(serviceUpdateTarget.node)
			: undefined;

	const versionDialogTitle =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkTitle")
			: versionDialogTarget?.type === "node"
				? t("nodes.coreVersionDialog.nodeTitle", {
						name: versionDialogTarget.node.name ?? t("nodes.unnamedNode"),
					})
				: "";

	const versionDialogDescription =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkDescription")
			: versionDialogTarget?.type === "node"
				? t("nodes.coreVersionDialog.nodeDescription", {
						name: versionDialogTarget.node.name ?? t("nodes.unnamedNode"),
					})
				: "";

	const versionDialogCurrentVersion =
		versionDialogTarget?.type === "node"
			? (versionDialogTarget.node.xray_version ?? "")
			: "";

	const geoDialogTitle =
		geoDialogTarget?.type === "node"
			? t("nodes.geoDialog.nodeTitle", {
					name: geoDialogTarget.node.name ?? t("nodes.unnamedNode"),
				})
			: geoDialogTarget?.type === "bulk"
				? t("nodes.geoDialog.bulkTitle")
				: "";

	const renderNodeStatus = (node: NodeType) => {
		const status = node.status || "error";
		const statusBadge = <NodeModalStatusBadge status={status} compact />;
		if (status !== "error" || !node.message) {
			return statusBadge;
		}
		return (
			<HoverCard openDelay={250} closeDelay={150}>
				<HoverCardTrigger asChild>
					<span>{statusBadge}</span>
				</HoverCardTrigger>
				<HoverCardContent side="top" className="w-auto max-w-[360px] px-2 py-1 text-[0.875rem]">
					
					<div className="p-3">{node.message}</div>
				</HoverCardContent>
			</HoverCard>
		);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: Column handlers intentionally use current render state.
	const nodeColumns = useMemo<DataTableColumn<NodeType>[]>(
		() => [
			{
				id: "name",
				header: t("nodes.nodeName"),
				accessor: (node) => node.name || t("nodes.unnamedNode"),
				sortable: true,
				sortValue: (node) => node.name || "",
				isPrimary: true,
				priority: "primary",
				width: { lg: "82px", xl: "92px" },
				minWidth: "70px",
				maxWidth: "112px",
				truncate: true,
				tooltip: true,
				mobilePriority: 0,
				mobileMetaLabel: t("nodes.nodeName"),
				cell: (node) => (
					<p dir="auto" className="font-semibold text-panel-text truncate max-w-full">
						<AppleEmojiText>
							{formatNodeNamePreview(node.name || t("nodes.unnamedNode"))}
						</AppleEmojiText>
					</p>
				),
			},
			{
				id: "status",
				header: t("status"),
				sortable: true,
				sortValue: (node) => node.status || "error",
				priority: "high",
				width: { lg: "88px", xl: "96px" },
				minWidth: "80px",
				maxWidth: "104px",
				headerAlign: "center",
				cellAlign: "center",
				mobilePriority: 1,
				mobileMetaLabel: t("status"),
				cell: renderNodeStatus,
			},
			{
				id: "address",
				sortable: false,
				header: t("nodes.nodeAddress"),
				accessor: "address",
				priority: "high",
				width: { lg: "126px", xl: "138px" },
				minWidth: "112px",
				maxWidth: "158px",
				truncate: true,
				tooltip: true,
				mobilePriority: 2,
				mobileMetaLabel: t("nodes.nodeAddress"),
				cell: (node) => (
					<button type="button" dir="ltr" onClick={(event) => {
							event.stopPropagation();
							copyToClipboard(node.address, t("nodes.nodeAddress"));
						}} className="[unicode-bidi:isolate] cursor-pointer text-start max-w-full truncate hover:text-primary-500 hover:underline">
						{formatCellValue(node.address)}
					</button>
				),
			},
			{
				id: "xray",
				header: t("nodes.columns.xrayVersion"),
				priority: "medium",
				hideBelow: "lg",
				mobileVisible: true,
				width: { xl: "96px" },
				minWidth: "84px",
				maxWidth: "110px",
				truncate: true,
				hideOnMobile: true,
				mobilePriority: 3,
				mobileMetaLabel: t("nodes.columns.xrayVersion"),
				cell: (node) =>
					node.xray_version ? (
						<Badge asChild><button type="button" onClick={(event) => {
								event.stopPropagation();
								if (node.id) setVersionDialogTarget({ type: "node", node });
							}} className={cn("bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200", "max-w-full overflow-hidden whitespace-nowrap cursor-pointer hover:opacity-[0.82]")}>
							{`Xray ${node.xray_version}`}
						</button></Badge>
					) : (
						<span className="text-panel-text-muted">
							-
						</span>
					),
			},
			{
				id: "runtime",
				sortable: false,
				header: t("nodes.columns.nodeRuntime"),
				accessor: (node) =>
					[node.node_install_mode, node.node_update_channel]
						.filter(Boolean)
						.join(" / ") || EMPTY_CELL_VALUE,
				priority: "low",
				hideBelow: "xl",
				mobileVisible: true,
				width: { xl: "118px" },
				minWidth: "104px",
				maxWidth: "142px",
				truncate: true,
				tooltip: true,
				align: "start",
				mobileLabel: t("nodes.runtime"),
				mobilePriority: 4,
				cell: (node) => {
					const nodeId = node.id as number | undefined;
					const nodeHostActionsAvailable =
						hostActionsAvailable && node.node_install_mode === "binary";
					const nodeRuntimeVersion = getNodeRuntimeVersion(node);
					const nodeRuntimeDisplayVersion = getNodeRuntimeDisplayVersion(node);
					const nodeEffectiveUpdateChannel = getNodeUpdateChannel(
						node,
						nodeUpdateChannel,
					);
					const nodeLatestVersion = getLatestNodeVersionForChannel(
						maintenanceInfo,
						nodeEffectiveUpdateChannel,
					);
					const nodeServiceUpdateAvailable = getNodeServiceUpdateAvailable(
						nodeRuntimeVersion,
						nodeLatestVersion,
						nodeEffectiveUpdateChannel,
					);
					const nodeInstallLabel =
						[node.node_install_mode, node.node_update_channel]
							.filter(Boolean)
							.join(" / ") || EMPTY_CELL_VALUE;
					const rebootRequired = /reboot/i.test(node.message ?? "");
					return (
						<div className="flex flex-col items-start justify-center gap-1 min-w-0! max-w-full overflow-hidden">
							{nodeRuntimeDisplayVersion ? (
								<Badge className={cn("bg-green-600 text-white", "max-w-full overflow-hidden whitespace-nowrap justify-start")}>
									{t("nodes.nodeServiceVersionTag", {
										version: nodeRuntimeDisplayVersion,
									})}
								</Badge>
							) : (
								<span className="text-[0.875rem] text-panel-text-muted">
									-
								</span>
							)}
							<p className="text-[0.75rem] text-panel-text-muted truncate min-w-0! max-w-full text-start">
								{nodeInstallLabel}
							</p>
							{nodeServiceUpdateAvailable && (
								<Button onClick={(event) => {
										event.stopPropagation();
										handleUpdateNodeService(node);
									}} disabled={!nodeId || !nodeHostActionsAvailable} variant="link" size="xs" loading={
										isUpdatingService &&
										nodeId != null &&
										updatingServiceNodeId === nodeId
									} className={cn("text-orange-600 hover:underline dark:text-orange-300", "shrink-0")}>{<DownloadIconStyled />}
									{t("nodes.nodeUpdateAvailable")}
								</Button>
							)}
							{rebootRequired && (
								<Button onClick={(event) => {
										event.stopPropagation();
										handleRebootNodeHost(node);
									}} disabled={!nodeId || !nodeHostActionsAvailable} variant="link" size="xs" loading={
										isRebootingHost &&
										nodeId != null &&
										rebootingHostNodeId === nodeId
									} className={cn("text-destructive hover:underline", "shrink-0")}>{<ArrowPathIconStyled />}
									{t("nodes.rebootRequired")}
								</Button>
							)}
						</div>
					);
				},
			},
			{
				id: "uptime",
				header: t("redisUptime"),
				sortable: true,
				sortValue: (node) => node.uptime_seconds ?? -1,
				priority: "medium",
				hideBelow: "xl",
				mobileVisible: true,
				width: { xl: "86px" },
				minWidth: "78px",
				maxWidth: "102px",
				truncate: true,
				mobilePriority: 5,
				mobileMetaLabel: t("redisUptime"),
				cell: (node) => (
					<p className="font-medium text-[0.875rem] leading-[1.375]">
						{formatNodeUptime(node.uptime_seconds)}
					</p>
				),
			},
			{
				id: "usage",
				header: t("nodes.trafficLimit"),
				sortable: true,
				sortValue: getNodeUsage,
				priority: "high",
				width: { lg: "128px", xl: "146px" },
				minWidth: "116px",
				maxWidth: "162px",
				headerAlign: "center",
				cellAlign: "center",
				truncate: true,
				mobilePriority: 6,
				mobileSummary: true,
				mobileMetaLabel: t("nodes.trafficLimit"),
				cell: (node) => {
					const totalUsage = getNodeUsage(node);
					const nodeTrafficLimitDisplay = `${formatNodeBytes(totalUsage, 2)} / ${
						node.data_limit != null && node.data_limit > 0
							? formatNodeLimit(node.data_limit)
							: "∞"
					}`;
					const nodeRemainingDataDisplay =
						node.data_limit != null && node.data_limit > 0
							? formatNodeBytes(Math.max(node.data_limit - totalUsage, 0), 2)
							: null;
					return (
						<NodeMetricDisplay
							value={nodeTrafficLimitDisplay}
							helper={
								nodeRemainingDataDisplay
									? `${t("nodes.remainingData")}: ${nodeRemainingDataDisplay}`
									: null
							}
							colorScheme="green"
						/>
					);
				},
			},
			{
				id: "bandwidth",
				header: t("nodes.bandwidthSpeed"),
				sortable: true,
				sortValue: getNodeBandwidth,
				priority: "high",
				hideBelow: "lg",
				mobileVisible: true,
				width: { xl: "124px" },
				minWidth: "112px",
				maxWidth: "142px",
				headerAlign: "center",
				cellAlign: "center",
				truncate: true,
				mobilePriority: 7,
				mobileMetaLabel: t("nodes.columns.bandwidth.variant2"),
				cell: (node) => (
					<NodeMetricDisplay
						value={`${formatNodeSpeed(node.upload_speed)} / ${formatNodeSpeed(
							node.download_speed,
						)}`}
					/>
				),
			},
			{
				id: "cpu",
				header: t("nodes.cpu"),
				sortable: true,
				sortValue: (node) => node.cpu_usage_percent ?? -1,
				priority: "high",
				mobileVisible: true,
				width: { lg: "76px", xl: "84px" },
				minWidth: "68px",
				maxWidth: "94px",
				headerAlign: "center",
				cellAlign: "center",
				truncate: true,
				hideOnMobile: true,
				mobilePriority: 8,
				mobileMetaLabel: t("nodes.cpu"),
				mobileDetailCell: (node) => (
					<p dir="ltr" className="text-[0.875rem] font-semibold">
						{formatNodePercent(node.cpu_usage_percent)}
					</p>
				),
				cell: (node) => (
					<NodeMetricDisplay
						value={formatNodePercent(node.cpu_usage_percent)}
						helper={formatCPUFrequency(node.cpu_frequency_hz)}
						percent={node.cpu_usage_percent}
						colorScheme="orange"
					/>
				),
			},
			{
				id: "ram",
				header: t("nodes.ram"),
				sortable: true,
				sortValue: (node) => node.memory_usage_percent ?? -1,
				priority: "high",
				mobileVisible: true,
				width: { lg: "110px", xl: "124px" },
				minWidth: "98px",
				maxWidth: "138px",
				headerAlign: "center",
				cellAlign: "center",
				truncate: true,
				hideOnMobile: true,
				mobilePriority: 9,
				mobileMetaLabel: t("nodes.ram"),
				mobileDetailCell: (node) => (
					<p dir="ltr" className="text-[0.875rem] font-semibold">
						{formatNodeBytes(node.memory_used, 2)} /{" "}
						{formatNodeBytes(node.memory_total, 2)}
					</p>
				),
				cell: (node) => (
					<NodeMetricDisplay
						value={`${formatNodeBytes(node.memory_used, 2)} / ${formatNodeBytes(
							node.memory_total,
							2,
						)}`}
						helper={formatNodePercent(node.memory_usage_percent)}
						percent={node.memory_usage_percent}
						colorScheme="purple"
					/>
				),
			},
			{
				id: "tags",
				header: t("tags.title"),
				priority: "low",
				mobileVisible: true,
				mobilePriority: 9,
				mobileMetaLabel: t("tags.title"),
				cell: (node) => <TagChips tags={nodeLabels?.items[String(node.id)]?.tags} limit={2} />,
			},
			{
				id: "protocols",
				header: t("nodes.protocols"),
				desktopVisible: false,
				mobileVisible: true,
				mobilePriority: 10,
				mobileMetaLabel: t("nodes.protocols"),
				cell: (node) => (
					<ProtocolStatusList statuses={node.protocol_statuses} />
				),
			},
			{
				id: "certificate",
				sortable: false,
				header: t("nodes.certificate"),
				accessor: getNodeInstallBundle,
				priority: "low",
				hideBelow: "xl",
				mobileVisible: false,
				width: "42px",
				minWidth: "38px",
				maxWidth: "46px",
				headerAlign: "center",
				cellAlign: "center",
				isMeta: true,
				hideOnMobile: true,
				cell: (node) => {
					const certificateBundle = getNodeInstallBundle(node);
					return (
						<Button aria-label={t("nodes.copyCertificate")} disabled={!certificateBundle} onClick={(event) => {
								event.stopPropagation();
								copyToClipboard(certificateBundle, t("nodes.certificate"));
							}} variant="ghost" size="sm" className={cn("size-8 p-0", "text-panel-text-muted")}>{<CopyIconStyled />}</Button>
					);
				},
			},
		],
		[
			handleRebootNodeHost,
			handleUpdateNodeService,
			hostActionsAvailable,
			isRebootingHost,
			isUpdatingService,
			maintenanceInfo,
			nodeUpdateChannel,
			rebootingHostNodeId,
			t,
			updatingServiceNodeId,
		],
	);

	const renderExpandedNode = (node: NodeType) => {
		const actions = nodeRowActions(node).filter(Boolean);
		return (
			<div className="rb-resource-expanded">
				<ExpandedDetails>
					<ExpandedHeading title={t("nodes.sections.health")} first />
					<ExpandedMeta label={t("nodes.agentHealth")} value={node.agent_status || "unknown"} />
					<ExpandedMeta label={t("nodes.xrayHealth")} value={node.xray_status || "unknown"} />
					<ExpandedMeta label={t("nodes.nodeAddress")} value={`${node.address}:${node.port}`} />
					<ExpandedMeta label={t("nodes.installMode.label")} value={node.node_install_mode || "-"} />
					<ExpandedMeta label={t("nodes.updateChannel")} value={node.node_update_channel || "-"} />
					<ExpandedMeta label={t("nodes.revisions")} value={`${node.applied_revision ?? 0} / ${node.desired_revision ?? 0}`} />
					<ExpandedHeading title={t("nodes.sections.resources")} />
					<ExpandedMeta label={t("nodes.cpu")} value={`${formatNodePercent(node.cpu_usage_percent)} · ${formatCPUFrequency(node.cpu_frequency_hz) || "-"}`} />
					<ExpandedMeta label={t("nodes.ram")} value={`${formatNodeBytes(node.memory_used)} / ${formatNodeBytes(node.memory_total)}`} />
					<ExpandedMeta label={t("nodes.bandwidthSpeed")} value={`↑ ${formatNodeSpeed(node.upload_speed)} · ↓ ${formatNodeSpeed(node.download_speed)}`} />
					<ExpandedMeta label={t("nodes.xrayCPU")} value={formatNodePercent(node.xray_cpu_usage_percent)} />
					<ExpandedMeta label={t("nodes.xrayMemory")} value={formatNodeBytes(node.xray_memory_used)} />
					<ExpandedMeta label={t("redisUptime")} value={formatNodeUptime(node.uptime_seconds)} />
					<ExpandedHeading title={t("nodes.runtime")} />
					<ExpandedMeta label={t("nodes.columns.nodeRuntime")} value={getNodeRuntimeDisplayVersion(node) || "-"} />
					<ExpandedMeta label={t("nodes.xrayProcess")} value={node.xray_pid ? `PID ${node.xray_pid}` : "-"} />
					<ExpandedMeta label={t("nodes.xrayUptime")} value={formatNodeUptime(node.xray_uptime_seconds)} />
					<ExpandedMeta label={t("nodes.capabilities")} value={node.capabilities?.join(", ") || "-"} wide />
					<ExpandedMeta label={t("nodes.note")} value={node.note || "-"} />
					<ExpandedMeta label={t("nodes.lastMessage")} value={node.message || "-"} />
					<ExpandedHeading title={t("nodes.protocolHealth")} />
					<div className="[grid-column:1_/_-1]">
						<ProtocolStatusList statuses={node.protocol_statuses} />
					</div>
				</ExpandedDetails>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control */}
				<div onClick={(event) => event.stopPropagation()} className="flex items-center justify-end gap-1 flex-wrap rb-resource-expanded-actions">
					<div className="flex flex-row items-center gap-1 flex-wrap rb-inline-actions">
						{actions.map((action) => (
							<Tooltip key={action.id}>
<TooltipTrigger asChild>
								<span>
									<Button aria-label={String(action.label)} disabled={typeof action.disabled === "function" ? action.disabled(node) : action.disabled} onClick={() => action.onClick?.(node)} variant="ghost" size="sm" className={cn("size-8 p-0", "min-w-[30px]! h-[30px]")}>{action.icon}</Button>
								</span>
							</TooltipTrigger>
<TooltipContent>{action.label}</TooltipContent>
</Tooltip>
						))}
					</div>
				</div>
			</div>
		);
	};

	const nodeRowActions = (node: NodeType): DataTableRowAction<NodeType>[] => {
		const nodeId = node.id as number | undefined;
		const status = node.status || "error";
		const isEnabled = status !== "disabled" && status !== "limited";
		const pending = nodeId != null ? pendingStatus[nodeId] : undefined;
		const displayEnabled = pending ?? isEnabled;
		const isToggleLoading =
			nodeId != null && togglingNodeId === nodeId && isToggling;
		const nodeHostActionsAvailable =
			hostActionsAvailable && node.node_install_mode === "binary";
		const isCoreUpdating = nodeId != null && updatingCoreNodeId === nodeId;
		const isGeoUpdating = nodeId != null && updatingGeoNodeId === nodeId;
		const isRestartingMaintenance =
			isRestartingService &&
			nodeId != null &&
			restartingServiceNodeId === nodeId;
		const isUpdatingMaintenance =
			isUpdatingService && nodeId != null && updatingServiceNodeId === nodeId;
		const isRebootingMaintenance =
			isRebootingHost && nodeId != null && rebootingHostNodeId === nodeId;

		return [
			{
				id: "edit",
				label: t("edit"),
				icon: <EditIconStyled />,
				onClick: () => setEditingNode(node),
			},
			{
				id: "toggle",
				label: displayEnabled ? t("nodes.disableNode") : t("nodes.enableNode"),
				icon: displayEnabled ? <DisableIconStyled /> : <EnableIconStyled />,
				onClick: () => handleToggleNode(node),
				disabled: !nodeId || isToggleLoading,
			},
			status === "error"
				? {
						id: "reconnect",
						label: t("nodes.reconnect"),
						icon: <ArrowPathIconStyled />,
						onClick: () => reconnect(node),
						disabled: isReconnecting,
					}
				: null,
			{
				id: "core",
				label: t("nodes.updateCoreAction"),
				icon: <CoreIconStyled />,
				onClick: () => nodeId && setVersionDialogTarget({ type: "node", node }),
				disabled: !nodeId || !nodeHostActionsAvailable || isCoreUpdating,
			},
			{
				id: "geo",
				label: t("nodes.updateGeoAction"),
				icon: <GeoIconStyled />,
				onClick: () => nodeId && setGeoDialogTarget({ type: "node", node }),
				disabled: !nodeId || !nodeHostActionsAvailable || isGeoUpdating,
			},
			{
				id: "restart-service",
				label: t("nodes.restartServiceAction"),
				icon: <ServiceIconStyled />,
				onClick: () => handleRestartNodeService(node),
				disabled:
					!nodeId || !nodeHostActionsAvailable || isRestartingMaintenance,
			},
			{
				id: "update-service",
				label: t("nodes.updateServiceAction"),
				icon: <DownloadIconStyled />,
				onClick: () => handleUpdateNodeService(node),
				disabled:
					!nodeId || !nodeHostActionsAvailable || isUpdatingMaintenance,
			},
			{
				id: "reboot-host",
				label: t("nodes.rebootHostAction"),
				icon: <ArrowPathIconStyled />,
				onClick: () => handleRebootNodeHost(node),
				disabled:
					!nodeId || !nodeHostActionsAvailable || isRebootingMaintenance,
				isDanger: true,
			},
			{
				id: "reset-usage",
				label: t("nodes.resetUsage"),
				icon: <ArrowPathIconStyled />,
				onClick: () => handleResetNodeUsage(node),
				disabled: !nodeId,
				isDanger: true,
			},
			node.uses_default_certificate
				? {
						id: "certificate",
						label: t("nodes.generatePrivateCert"),
						icon: <CertificateIconStyled />,
						onClick: () => nodeId && regenerateNodeCertMutate(node),
						disabled:
							!nodeId ||
							(isRegenerating &&
								nodeId != null &&
								regeneratingNodeId === nodeId),
					}
				: null,
			{
				id: "delete",
				label: t("delete"),
				icon: <DeleteIconStyled />,
				onClick: () => handleDeleteNodeRequest(node),
				disabled: isDeletingNode,
				isDanger: true,
			},
		].filter(Boolean) as DataTableRowAction<NodeType>[];
	};

	const nodeSorting = useMemo<SortingState>(
		() => [{ id: sortKey, desc: sortDirection === "desc" }],
		[sortDirection, sortKey],
	);
	const nodeSortOptions = useMemo<SortOption[]>(
		() => [
			{ id: "name", label: t("nodes.nodeName"), type: "text" },
			{ id: "status", label: t("status"), type: "text" },
			{ id: "uptime", label: t("redisUptime"), type: "number" },
			{ id: "usage", label: t("nodes.trafficLimit"), type: "number" },
			{ id: "bandwidth", label: t("nodes.bandwidthSpeed"), type: "number" },
			{ id: "cpu", label: t("nodes.cpu"), type: "number" },
			{ id: "ram", label: t("nodes.ram"), type: "number" },
		],
		[t],
	);

	const handleNodeTableSorting = (nextSorting: SortingState) => {
		const next = nextSorting[0];
		if (!next) {
			setSortKey("name");
			setSortDirection("asc");
			return;
		}
		if (!isNodeSortKey(next.id)) return;
		setSortKey(next.id);
		setSortDirection(next.desc ? "desc" : "asc");
	};

	const nodesPagination =
		filteredNodes.length > 0 ? (
			<div className={cn("hover:md:shadow-sm hover:md:border-panel-border-strong!", cn("flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 border rounded-2xl p-4 md:p-5 [transition:box-shadow_0.2s_ease,_border-color_0.2s_ease]", nodePanelBorder, nodePanelBg))}>
				<p className="text-[0.875rem] text-gray-500">
					{t("nodes.paginationSummary", {
						start: paginationStart,
						end: paginationEnd,
						total: filteredNodes.length,
					})}
				</p>
				<div className="flex flex-row items-center gap-2 justify-between md:justify-end">
					<Select size="sm" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="w-[90px]">
						<option value={12}>12</option>
						<option value={24}>24</option>
						<option value={48}>48</option>
						<option value={96}>96</option>
						<option value={100}>100</option>
					</Select>
					<div className="inline-flex items-center gap-2">
						<Button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1}>
							{t("previous")}
						</Button>
						<Button disabled>
							{currentPage} / {totalPages}
						</Button>
						<Button onClick={() =>
								setPage((value) => Math.min(totalPages, value + 1))
							} disabled={currentPage >= totalPages}>
							{t("next")}
						</Button>
					</div>
				</div>
			</div>
		) : null;

	if (!getUserIsSuccess) {
		return <PageLoadingSkeleton />;
	}

	if (!canManageNodes) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<h1 className="font-semibold text-[1.5rem]">
					{t("nodes.title")}
				</h1>
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
					{t("nodes.noPermission")}
				</p>
			</div>
		);
	}

	if (isLoading && !nodes) {
		return <PageLoadingSkeleton />;
	}

	return (
		<div className={cn("flex flex-col gap-5 items-stretch", selectedNodeIds.length > 0 ? "pb-32" + " " + "md:pb-24" : "pb-0")}>
			{hasError && (
				<Alert variant="destructive" className="rounded-md">
					<CircleAlert className="size-4" aria-hidden="true" />
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			)}

			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand total={nodeOverview.total} rows={nodeOverview.rows} distribution={nodeOverview.distribution} extra={nodeOverview.extra} locale={locale} onSegmentSelect={(key) => setStatusFilter((current) => (current === key ? "all" : key))} selectedKey={statusFilter === "all" ? null : statusFilter} />
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 xl:flex-row xl:items-center">
						<div className="min-w-0 flex-1">
							<div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-2 xl:flex xl:flex-row">
						<div className="col-span-2 flex min-w-0 flex-1 flex-row items-center gap-2 xl:col-span-1">
							<SearchInput containerProps={{ className: "min-w-0 flex-1 xl:w-[320px] xl:flex-none" }} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("nodes.searchPlaceholder")} matchOptions={searchMatch} onMatchOptionsChange={setSearchMatch} />
							<DataTableSortMenu
								options={nodeSortOptions}
								sorting={nodeSorting}
								onSortingChange={handleNodeTableSorting}
							/>
						</div>
						<TagFilterButton type="node" value={tagFilter} onChange={setTagFilter} />
						<Select size="sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full xl:w-[150px]">
							<option value="all">{t("nodes.filters.allStatuses")}</option>
							<option value="connected">{t("status.connected")}</option>
							<option value="connecting">
								{t("nodeModal.status.connecting")}
							</option>
							<option value="error">{t("nodeModal.status.error")}</option>
							<option value="disabled">{t("status.disabled")}</option>
							<option value="limited">{t("status.limited")}</option>
						</Select>
						<Select size="sm" value={installModeFilter} onChange={(event) => setInstallModeFilter(event.target.value)} className="w-full xl:w-[150px]">
							<option value="all">{t("nodes.filters.allModes")}</option>
							<option value="binary">{t("nodes.installMode.binary")}</option>
							<option value="docker">{t("nodes.installMode.docker")}</option>
							<option value="unknown">{t("status.unknown")}</option>
						</Select>
					</div>
						</div>
						<div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:shrink-0">
						<Button onClick={() =>
								navigate(
									`/tutorials?doc=${encodeURIComponent(
										"admin/nodes/#section-nodes-admin-guide",
									)}`,
								)
							} variant="outline" size="sm" className="h-[36px] px-3">{<TutorialIconStyled />}
							{t("nodes.toolbarTutorial")}
						</Button>
						<Button onClick={() => setVersionDialogTarget({ type: "bulk" })} disabled={!hasConnectedNodes || !hostActionsAvailable} variant="outline" size="sm" className="h-[36px] px-3">{<CoreIconStyled />}
							{t("nodes.toolbarUpdateCore")}
						</Button>
						<Button onClick={handleUpdateAllNodeServices} disabled={
								!hostActionsAvailable || !hasBinaryNodes || updatingBulkService
							} variant="outline" size="sm" loading={updatingBulkService} className="h-[36px] px-3">{<DownloadIconStyled />}
							{t("nodes.toolbarUpdateServices")}
						</Button>
						<div className="ms-auto flex items-center gap-1.5">
						<Tooltip>
<TooltipTrigger asChild>
							<Button aria-label={t("nodes.refreshNodes")} onClick={() => refetchNodes()} variant="ghost" size="sm" loading={isFetching} className="size-8 p-0">{<ArrowPathIconStyled />}</Button>
						</TooltipTrigger>
<TooltipContent>{t("nodes.refreshNodes")}</TooltipContent>
</Tooltip>
						<Button onClick={() => setAddNodeOpen(true)} size="sm" className="h-[36px] px-3">{<AddIconStyled />}
							{t("nodes.addNode")}
						</Button>
					</div>
					</div>
					</div>
				</div>
			</div>

			{!hostActionsAvailable && (
				<Alert className="rounded-md">
					<TriangleAlert className="size-4" aria-hidden="true" />
					<AlertDescription>
						{t("nodes.binaryMigrationRequired")}
					</AlertDescription>
				</Alert>
			)}

			<div className="rb-nodes-section">
				<DataTable
					ariaLabel={t("nodes.manageNodesHeader")}
					data={paginatedNodes}
					columns={nodeColumns}
					getRowId={(node, index) => String(node.id ?? node.name ?? index)}
					loading={isLoading}
					loadingRows={Math.min(pageSize, 8)}
					emptyState={
						<p className="text-[0.875rem] text-panel-text-muted text-center">
							{t("nodes.noNodesFound")}
						</p>
					}
					enableSelection
					selectedRowIds={selectedNodeIds.map(String)}
					selectedRows={selectedNodes}
					selectedCount={selectedNodeIds.length}
					onSelectionChange={(rowIds) => {
						setSelectedNodeIds(
							rowIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
						);
					}}
					getRowCanSelect={(node) => node.id != null}
					rowActions={nodeRowActions}
					actionsDisplay="menu"
					actionsPlacement="end"
					actionsColumnWidth="44px"
					showActionsOnHover
					onRowClick={(node) =>
						setExpandedNodeID((current) =>
							current === node.id ? null : (node.id ?? null),
						)
					}
					isRowExpanded={(node) => expandedNodeID === node.id}
					renderExpandedRow={renderExpandedNode}
					sorting={nodeSorting}
					onSortingChange={handleNodeTableSorting}
					showSortMenu={false}
					manualSorting
					pagination={nodesPagination}
					selectedLabel={t("nodes.selectedCount", {
						count: selectedNodeIds.length,
					})}
					renderBulkActions={() => (
						<>
							<Button onClick={selectAllFilteredNodes} disabled={allFilteredSelected} variant="outline" size="sm">
								{t("nodes.selectAllFiltered")}
							</Button>
							<Button onClick={selectOnlyActiveNodes} disabled={
									activeFilteredNodeIds.length === 0 || onlyActiveFilteredSelected
								} variant="outline" size="sm">{<EnableIconStyled />}
								{t("nodes.selectOnlyActive")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm("bulk-enable", selectableSelectedNodes())
								} disabled={Boolean(bulkNodeActionLoading)} variant="outline" size="sm">{<EnableIconStyled />}
								{t("nodes.enableNode")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm("bulk-disable", selectableSelectedNodes())
								} disabled={Boolean(bulkNodeActionLoading)} variant="outline" size="sm">{<DisableIconStyled />}
								{t("nodes.disableNode")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm("bulk-reset", selectableSelectedNodes())
								} disabled={Boolean(bulkNodeActionLoading)} variant="outline" size="sm">{<ArrowPathIconStyled />}
								{t("nodes.resetUsage")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm(
										"bulk-restart",
										selectedConnectedBinaryNodes(),
									)
								} disabled={
									Boolean(bulkNodeActionLoading) ||
									selectedConnectedBinaryNodes().length === 0
								} variant="outline" size="sm">{<ServiceIconStyled />}
								{t("nodes.restartServiceAction")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm("bulk-update", selectedBinaryNodes())
								} disabled={
									Boolean(bulkNodeActionLoading) ||
									selectedBinaryNodes().length === 0
								} variant="outline" size="sm">{<DownloadIconStyled />}
								{t("nodes.updateServiceAction")}
							</Button>
							<Button onClick={() =>
									setVersionDialogTarget({
										type: "bulk",
										nodes: selectedConnectedBinaryNodes(),
									})
								} disabled={
									Boolean(bulkNodeActionLoading) ||
									selectedConnectedBinaryNodes().length === 0
								} variant="outline" size="sm">{<CoreIconStyled />}
								{t("nodes.updateCoreAction")}
							</Button>
							<Button onClick={() =>
									setGeoDialogTarget({
										type: "bulk",
										nodes: selectedConnectedBinaryNodes(),
									})
								} disabled={
									Boolean(bulkNodeActionLoading) ||
									selectedConnectedBinaryNodes().length === 0
								} variant="outline" size="sm">{<GeoIconStyled />}
								{t("nodes.updateGeoAction")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm(
										"bulk-reboot",
										selectedConnectedBinaryNodes(),
									)
								} disabled={
									Boolean(bulkNodeActionLoading) ||
									selectedConnectedBinaryNodes().length === 0
								} variant="outline" size="sm">{<ArrowPathIconStyled />}
								{t("nodes.rebootHostAction")}
							</Button>
							<Button onClick={() =>
									openBulkActionConfirm("bulk-delete", selectableSelectedNodes())
								} disabled={Boolean(bulkNodeActionLoading)} variant="outline" size="sm" className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">{<DeleteIconStyled />}
								{t("delete")}
							</Button>
						</>
					)}
					tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }}
				/>
			</div>
			<CoreVersionDialog
				open={Boolean(versionDialogTarget)}
				onClose={closeVersionDialog}
				onSubmit={handleVersionSubmit}
				currentVersion={versionDialogCurrentVersion}
				title={versionDialogTitle}
				description={versionDialogDescription}
				allowPersist={false}
				isSubmitting={versionDialogLoading}
			/>
			<NodeServiceUpdateDialog
				open={Boolean(serviceUpdateTarget)}
				onClose={closeServiceUpdateDialog}
				onSubmit={handleServiceUpdateSubmit}
				title={serviceUpdateDialogTitle}
				description={serviceUpdateDialogDescription}
				currentChannel={serviceUpdateCurrentChannel}
				targetVersion={serviceUpdateCurrentVersion}
				latestVersion={getLatestNodeVersionForChannel(
					maintenanceInfo,
					"latest",
				)}
				devVersion={getLatestNodeVersionForChannel(maintenanceInfo, "dev")}
				catalog={buildCatalog}
				isSubmitting={updatingServiceNodeId !== null || updatingBulkService}
			/>
			<GeoUpdateDialog
				open={Boolean(geoDialogTarget)}
				onClose={closeGeoDialog}
				onSubmit={handleGeoSubmit}
				title={geoDialogTitle}
				showMasterOptions={false}
				isSubmitting={geoDialogLoading}
			/>
			<ConfirmDialog
				open={Boolean(serviceActionConfirm)}
				onClose={closeServiceActionConfirm}
				onConfirm={confirmServiceAction}
				title={serviceActionConfirmTitle}
				description={serviceActionConfirmMessage}
				confirmLabel={serviceActionConfirmLabel}
				colorScheme={
					serviceActionConfirm?.type === "restart"
						? "orange"
						: serviceActionConfirm?.type === "reboot"
							? "red"
							: serviceActionConfirm?.type === "bulk-delete" ||
									serviceActionConfirm?.type === "bulk-reset" ||
									serviceActionConfirm?.type === "bulk-reboot"
								? "red"
								: "blue"
				}
				loading={serviceActionConfirmLoading}
			/>
			<ConfirmDialog
				open={isDeleteConfirmOpen}
				onClose={handleCloseDeleteConfirm}
				onConfirm={confirmDeleteNode}
				title={t("delete")}
				description={t("deleteNode.prompt", {
					name:
						deleteCandidate?.name ??
						deleteCandidate?.address ??
						t("nodes.thisNode"),
				})}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={isDeletingNode}
				isConfirmDisabled={!deleteCandidate}
			/>

			<ConfirmDialog
				open={isResetConfirmOpen}
				onClose={handleCloseResetConfirm}
				onConfirm={confirmResetUsage}
				title={t("nodes.resetUsage")}
				description={t("nodes.resetUsageConfirm", {
					name:
						resetCandidate?.name ??
						resetCandidate?.address ??
						t("nodes.thisNode"),
				})}
				confirmLabel={t("nodes.resetUsage")}
				colorScheme="red"
				loading={isResettingUsage}
				isConfirmDisabled={!resetCandidate}
			/>

			<NodeFormModal
				open={isAddNodeOpen}
				onClose={() => setAddNodeOpen(false)}
				mutate={addNodeMutate}
				loading={isAdding}
				isAddMode
				onSubmitSuccess={(createdNode) => {
					if (createdNode?.node_certificate) {
						setNewNodeCertificate({
							certificate: createdNode.node_certificate,
							certificate_key: createdNode.node_certificate_key,
							name: createdNode.name,
						});
					}
				}}
			/>
			<NodeFormModal
				open={!!editingNode}
				onClose={() => setEditingNode(null)}
				node={editingNode || undefined}
				mutate={updateNodeMutate}
				loading={isUpdating}
			/>
			{newNodeCertificate && (
				<NodeInstallBundleDialog
					name={newNodeCertificate.name}
					certificate={newNodeCertificate.certificate}
					certificateKey={newNodeCertificate.certificate_key}
					onClose={() => setNewNodeCertificate(null)}
				/>
			)}
		</div>
	);
};

export default NodesPage;
