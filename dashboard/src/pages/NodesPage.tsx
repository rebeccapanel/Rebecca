import {
	Alert,
	AlertDescription,
	AlertIcon,
	Box,
	Button,
	ButtonGroup,
	chakra,
	Divider,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Progress,
	SimpleGrid,
	Spinner,
	Stack,
	Tag,
	Text,
	Tooltip,
	useClipboard,
	useColorModeValue,
	useDisclosure,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	PlusIcon as AddIcon,
	ArrowDownTrayIcon,
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	CpuChipIcon,
	TrashIcon as DeleteIcon,
	DocumentDuplicateIcon,
	PencilIcon as EditIcon,
	EllipsisVerticalIcon,
	GlobeAltIcon,
	MagnifyingGlassIcon,
	NoSymbolIcon,
	ShieldCheckIcon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import type { SortingState } from "@tanstack/react-table";
import { AppleEmojiText } from "components/common/AppleEmojiText";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
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
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import { fetch as apiFetch } from "service/http";
import { formatBytes } from "utils/formatByte";
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
	PageHeader,
	type DataTableColumn,
	type DataTableRowAction,
} from "../components/ui";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { GeoUpdateDialog } from "../components/GeoUpdateDialog";
import { NodeFormModal } from "../components/NodeFormModal";
import { NodeModalStatusBadge } from "../components/NodeModalStatusBadge";

const normalizeVersion = (value?: string | null) => {
	if (!value) return "";
	const trimmed = value.trim();
	if (trimmed.toLowerCase().startsWith("dev-")) {
		return trimmed.toLowerCase();
	}
	return trimmed.replace(/^v+/i, "").split(/[-_]/)[0].trim();
};

dayjs.extend(utc);

const AddIconStyled = chakra(AddIcon, { baseStyle: { w: 4, h: 4 } });
const DeleteIconStyled = chakra(DeleteIcon, { baseStyle: { w: 4, h: 4 } });
const EditIconStyled = chakra(EditIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowPathIconStyled = chakra(ArrowPathIcon, {
	baseStyle: { w: 4, h: 4 },
});
const SearchIcon = chakra(MagnifyingGlassIcon, { baseStyle: { w: 4, h: 4 } });
const CopyIconStyled = chakra(DocumentDuplicateIcon, {
	baseStyle: { w: 4, h: 4 },
});
const DownloadIconStyled = chakra(ArrowDownTrayIcon, {
	baseStyle: { w: 4, h: 4 },
});
const TutorialIconStyled = chakra(BookOpenIcon, {
	baseStyle: { w: 4, h: 4 },
});
const MoreIconStyled = chakra(EllipsisVerticalIcon, {
	baseStyle: { w: 4, h: 4 },
});
const EnableIconStyled = chakra(CheckCircleIcon, {
	baseStyle: { w: 4, h: 4 },
});
const DisableIconStyled = chakra(NoSymbolIcon, {
	baseStyle: { w: 4, h: 4 },
});
const CoreIconStyled = chakra(CpuChipIcon, {
	baseStyle: { w: 4, h: 4 },
});
const GeoIconStyled = chakra(GlobeAltIcon, {
	baseStyle: { w: 4, h: 4 },
});
const CertificateIconStyled = chakra(ShieldCheckIcon, {
	baseStyle: { w: 4, h: 4 },
});
const ServiceIconStyled = chakra(WrenchScrewdriverIcon, {
	baseStyle: { w: 4, h: 4 },
});

const BYTES_IN_GB = 1024 ** 3;
const EMPTY_CELL_VALUE = "-";

const formatCellValue = (value?: string | number | null): string => {
	if (value === null || value === undefined || value === "") {
		return EMPTY_CELL_VALUE;
	}
	return String(value);
};

const uniqueValues = (items: string[]): string[] =>
	Array.from(new Set(items.filter(Boolean)));

const getNodeServiceUpdateAvailable = (
	currentVersion?: string | null,
	latestVersion?: string | null,
	channel?: string | null,
): boolean => {
	if (channel === "dev" && !/^dev-[0-9a-f]{7,40}$/i.test(currentVersion ?? "")) {
		return false;
	}
	const current = normalizeVersion(currentVersion);
	const latest = normalizeVersion(latestVersion);
	return Boolean(current && latest && current !== latest);
};

const getNodeUpdateChannel = (
	node?: Pick<NodeType, "node_update_channel"> | null,
	fallback?: string,
) => (node?.node_update_channel === "dev" ? "dev" : fallback === "dev" ? "dev" : "latest");

const getNodeRuntimeVersion = (node: NodeType) =>
	node.node_binary_tag || node.node_service_version || "";

const getNodeRuntimeDisplayVersion = (node: NodeType) => {
	const version = getNodeRuntimeVersion(node);
	if (node.node_update_channel === "dev" && !/^dev-[0-9a-f]{7,40}$/i.test(version)) {
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
	if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
		return "-";
	}
	return `${Math.round((value / 1_000_000_000) * 100) / 100} GHz`;
};

const formatNodeLimit = (value?: number | null) =>
	value !== null && value !== undefined && value > 0
		? formatBytes(value, 2)
		: "∞";

const formatNodeSpeed = (value?: number | null) =>
	value !== null && value !== undefined ? `${formatBytes(value, 2)}/s` : "-";

const formatNodeUptime = (value?: number | null) =>
{
	if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
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

const formatNodeNamePreview = (value?: string | null) => {
	const text = value?.trim();
	if (!text) return "";
	return text.length > 10 ? `${text.slice(0, 10)}...` : text;
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
		<VStack
			align="center"
			justify="center"
			spacing={0.5}
			minW={0}
			maxW="full"
			minH="34px"
			overflow="hidden"
			textAlign="center"
			mx="auto"
		>
			<Text fontWeight="semibold" fontSize="xs" lineHeight="short" noOfLines={1} maxW="full">
				{value}
			</Text>
			{helper && helper !== "-" ? (
				<Text fontSize="xs" color="gray.500" lineHeight="short" noOfLines={1} maxW="full">
					{helper}
				</Text>
			) : null}
			{progressValue !== undefined && (
				<Progress
					value={progressValue}
					size="xs"
					colorScheme={colorScheme}
					borderRadius="full"
					w="46px"
					mx="auto"
					bg="blackAlpha.100"
					_dark={{ bg: "whiteAlpha.200" }}
				/>
			)}
		</VStack>
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

const getNodeUsage = (node: NodeType) => (node.uplink ?? 0) + (node.downlink ?? 0);

const getNodeBandwidth = (node: NodeType) =>
	(node.upload_speed ?? 0) + (node.download_speed ?? 0);

const splitHostAddressValues = (value?: string | null) =>
	String(value ?? "")
		.split(/\r?\n|[,;]/)
		.map((item) => item.trim())
		.filter(Boolean);

const normalizeNodeAddressToken = (value: string) =>
	value.trim().replace(/^\[(.*)\]$/, "$1").toLowerCase();

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
		impact &&
			(impact.cleanupCount > 0 || impact.riskyHostNames.length > 0),
	);

type VersionDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

type GeoDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

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
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { userData, getUserIsSuccess } = useGetUser();
	const canManageNodes =
		getUserIsSuccess && Boolean(userData.permissions?.sections.nodes);
	const { inbounds, onEditingNodes } = useDashboard();
	const isEditingNodes = useDashboard((state) => state.isEditingNodes);
	const {
		data: nodes,
		isLoading,
		error,
		refetch: refetchNodes,
		isFetching,
	} = useNodesQuery({ enabled: canManageNodes });
	useNodeMetricsStream(canManageNodes);
	const {
		addNode,
		updateNode,
		regenerateNodeCertificate,
		reconnectNode,
		restartNodeService,
		rebootNodeHost,
		updateNodeService,
		resetNodeUsage,
		deleteNode,
		setDeletingNode,
	} = useNodes();
	const queryClient = useQueryClient();
	const toast = useToast();
	const refreshHosts = useHosts((state) => state.fetchHosts);
	const nodePanelBg = useColorModeValue("panel.surface", "panel.surface");
	const nodePanelBorder = useColorModeValue("panel.border", "panel.border");
	const [editingNode, setEditingNode] = useState<NodeType | null>(null);
	const [isAddNodeOpen, setAddNodeOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [installModeFilter, setInstallModeFilter] = useState("all");
	const [sortKey, setSortKey] = useState<NodeSortKey>("name");
	const [sortDirection, setSortDirection] =
		useState<NodeSortDirection>("asc");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(() => getNodesPerPageLimitSize());
	const [versionDialogTarget, setVersionDialogTarget] =
		useState<VersionDialogTarget | null>(null);
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
	const [resettingNodeId, setResettingNodeId] = useState<number | null>(null);
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
	const generatedCertificateValue = newNodeCertificate?.certificate ?? "";
	const generatedCertificateKeyValue =
		newNodeCertificate?.certificate_key ?? "";
	const generatedCertificateBundleValue = generatedCertificateKeyValue
		? `${generatedCertificateValue.trim()}\n${generatedCertificateKeyValue.trim()}\n`
		: generatedCertificateValue;
	const {
		onCopy: copyGeneratedCertificateBundle,
		hasCopied: generatedCertificateBundleCopied,
	} = useClipboard(generatedCertificateBundleValue);
	const {
		isOpen: isResetConfirmOpen,
		onOpen: openResetConfirm,
		onClose: closeResetConfirm,
	} = useDisclosure();
	const [deleteCandidate, setDeleteCandidate] = useState<NodeType | null>(null);
	const [deleteHostImpact, setDeleteHostImpact] =
		useState<NodeHostImpact | null>(null);
	const {
		isOpen: isDeleteConfirmOpen,
		onOpen: openDeleteConfirm,
		onClose: closeDeleteConfirm,
	} = useDisclosure();
	useEffect(() => {
		setNodesPerPageLimitSize(String(pageSize));
	}, [pageSize]);

	const { data: maintenanceInfo } = useQuery<MaintenanceInfo>(
		["maintenance-info"],
		() => apiFetch<MaintenanceInfo>("/maintenance/info"),
		{
			refetchOnWindowFocus: false,
			enabled: canManageNodes,
		},
	);
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
	const defaultInboundSummaries = useMemo(
		() =>
			uniqueValues(
				Array.from(inbounds.values()).flatMap((items) =>
					items.map((inbound) => inbound.tag),
				),
			),
		[inbounds],
	);

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

	useEffect(() => {
		if (canManageNodes && !inbounds.size) {
			fetchInbounds();
		}
	}, [canManageNodes, inbounds.size]);

	const { isLoading: isAdding, mutate: addNodeMutate } = useMutation(addNode, {
		onSuccess: (createdNode: NodeType) => {
			generateSuccessMessage(t("nodes.addNodeSuccess"), toast);
			queryClient.invalidateQueries(FetchNodesQueryKey);
			refetchNodes();
		},
		onError: (err) => {
			generateErrorMessage(err, toast);
		},
	});

	const { isLoading: isUpdating, mutate: updateNodeMutate } = useMutation(
		updateNode,
		{
			onSuccess: () => {
				generateSuccessMessage(t("nodes.nodeUpdated"), toast);
				queryClient.invalidateQueries(FetchNodesQueryKey);
				refetchNodes();
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
		},
	);

	const { isLoading: isDeletingNode, mutate: deleteNodeMutate } = useMutation(
		async (node: NodeType) => {
			setDeletingNode(node);
			return deleteNode();
		},
		{
			onSuccess: (_result, node) => {
				generateSuccessMessage(
					t("deleteNode.deleteSuccess", { name: node.name }),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
				refetchNodes();
				closeDeleteConfirm();
				setDeleteCandidate(null);
				setDeleteHostImpact(null);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setDeletingNode(null);
			},
		},
	);

	const { mutate: regenerateNodeCertMutate, isLoading: isRegenerating } =
		useMutation(regenerateNodeCertificate, {
			onMutate: (node: NodeType) => {
				setRegeneratingNodeId(node.id ?? null);
			},
			onSuccess: (updatedNode: NodeType) => {
				generateSuccessMessage(
					t("nodes.regenerateCertSuccess"),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
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
			},
		});

	const { isLoading: isReconnecting, mutate: reconnect } = useMutation(
		reconnectNode,
		{
			onSuccess: () => {
				queryClient.invalidateQueries(FetchNodesQueryKey);
			},
		},
	);

	const { mutate: toggleNodeStatus, isLoading: isToggling } = useMutation(
		updateNode,
		{
			onSuccess: () => {
				queryClient.invalidateQueries(FetchNodesQueryKey);
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
			},
		},
	);

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
		toast({
			title: t("nodes.hostAddressCleanupApplied", { count: impact.cleanupCount }),
			status: "success",
			isClosable: true,
			position: "top",
			duration: 2400,
		});
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
			<VStack align="stretch" spacing={2}>
				<Text>{baseMessage}</Text>
				{cleanupNames.length > 0 && (
					<Text color="blue.300">
						{t("nodes.hostAddressCleanupNotice", { hosts: formatNames(cleanupNames) })}
					</Text>
				)}
				{riskyNames.length > 0 && (
					<Text color="orange.300" fontWeight="700">
						{t("nodes.hostAddressRiskNotice", { hosts: formatNames(riskyNames) })}
					</Text>
				)}
			</VStack>
		);
	};

	const { isLoading: isResettingUsage, mutate: resetUsageMutate } = useMutation(
		resetNodeUsage,
		{
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.resetUsageSuccess"),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setResettingNodeId(null);
				setResetCandidate(null);
				closeResetConfirm();
			},
		},
	);

	const { mutate: restartServiceMutate, isLoading: isRestartingService } =
		useMutation(restartNodeService, {
			onMutate: (node: NodeType) => {
				setRestartingServiceNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.restartServiceTriggered"),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setRestartingServiceNodeId(null);
			},
		});

	const { mutate: updateServiceMutate, isLoading: isUpdatingService } =
		useMutation(updateNodeService, {
			onMutate: (node: NodeType) => {
				setUpdatingServiceNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.updateServiceTriggered"),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setUpdatingServiceNodeId(null);
			},
		});

	const { mutate: rebootHostMutate, isLoading: isRebootingHost } =
		useMutation(rebootNodeHost, {
			onMutate: (node: NodeType) => {
				setRebootingHostNodeId(node.id ?? null);
			},
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.rebootHostTriggered"),
					toast,
				);
				queryClient.invalidateQueries(FetchNodesQueryKey);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setRebootingHostNodeId(null);
			},
		});

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
				const label =
					node.name || node.address || t("nodes.thisNode");
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

	const handleDeleteNodeRequest = async (node: NodeType) => {
		if (!node?.id) return;
		try {
			setDeleteHostImpact(await loadNodeHostImpact([node]));
			setDeleteCandidate(node);
			openDeleteConfirm();
		} catch (err) {
			generateErrorMessage(err, toast);
		}
	};

	const handleCloseDeleteConfirm = () => {
		if (isDeletingNode || hostCleanupLoading) return;
		closeDeleteConfirm();
		setDeleteCandidate(null);
		setDeleteHostImpact(null);
	};

	const confirmDeleteNode = async () => {
		if (!deleteCandidate) return;
		try {
			setHostCleanupLoading(true);
			await applyNodeHostCleanup(deleteHostImpact);
			deleteNodeMutate(deleteCandidate);
		} catch (err) {
			generateErrorMessage(err, toast);
		} finally {
			setHostCleanupLoading(false);
		}
	};

	const handleRestartNodeService = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode");
		setServiceActionConfirm({ type: "restart", node, label });
	};

	const handleUpdateNodeService = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode");
		setServiceActionConfirm({ type: "update", node, label });
	};

	const handleRebootNodeHost = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode");
		setServiceActionConfirm({ type: "reboot", node, label });
	};

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
			toast({
				title: t("nodes.copySuccess", { label }),
				status: "success",
				isClosable: true,
				position: "top",
				duration: 1800,
			});
		} catch (error) {
			generateErrorMessage(error, toast);
		}
	};

	const confirmResetUsage = () => {
		if (!resetCandidate?.id) return;
		setResettingNodeId(resetCandidate.id);
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
			toast({
				title: t("nodes.noBinaryNodesForServiceUpdate"),
				status: "warning",
				isClosable: true,
				position: "top",
			});
			return;
		}
		setServiceActionConfirm({
			type: "update-all",
			count: targetNodes.length,
		});
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
			try {
				await applyNodeHostCleanup(hostImpact);
			} catch (err) {
				setBulkNodeActionLoading(null);
				generateErrorMessage(err, toast);
				return;
			}
			for (const node of targetNodes) {
				if (node.id == null) {
					continue;
				}
				try {
					switch (actionType) {
						case "bulk-enable":
							await apiFetch(`/node/${node.id}`, {
								method: "PUT",
								body: { status: "connecting" },
							});
							break;
						case "bulk-disable":
							await apiFetch(`/node/${node.id}`, {
								method: "PUT",
								body: { status: "disabled" },
							});
							break;
						case "bulk-delete":
							await apiFetch(`/node/${node.id}`, { method: "DELETE" });
							break;
						case "bulk-reset":
							await apiFetch(`/node/${node.id}/usage/reset`, {
								method: "POST",
							});
							break;
						case "bulk-restart":
							await apiFetch(`/node/${node.id}/service/restart`, {
								method: "POST",
							});
							break;
						case "bulk-update":
							await apiFetch(`/node/${node.id}/service/update`, {
								method: "POST",
								body: {
									channel: getNodeUpdateChannel(node, nodeUpdateChannel),
								},
							});
							break;
						case "bulk-reboot":
							await apiFetch(`/node/${node.id}/host/reboot`, {
								method: "POST",
							});
							break;
						default:
							break;
					}
					successCount += 1;
					completedIDs.push(node.id);
				} catch (err) {
					failedCount += 1;
					generateErrorMessage(err, toast);
				}
			}
			setBulkNodeActionLoading(null);
			queryClient.invalidateQueries(FetchNodesQueryKey);
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
				toast({
					title: t("nodes.bulkActionFailed", { count: failedCount }),
					status: "error",
					isClosable: true,
					position: "top",
				});
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
		for (const node of targetNodes) {
			try {
				await apiFetch(`/node/${node.id}/service/update`, {
					method: "POST",
					body: {
						channel: getNodeUpdateChannel(node, nodeUpdateChannel),
					},
				});
				successCount += 1;
			} catch (err) {
				failedCount += 1;
				generateErrorMessage(err, toast);
			}
		}
		setUpdatingBulkService(false);
		queryClient.invalidateQueries(FetchNodesQueryKey);
		refetchNodes();
		if (successCount > 0) {
			generateSuccessMessage(
				t("nodes.updateAllNodeServicesTriggered", { count: successCount }),
				toast,
			);
		}
		if (failedCount > 0) {
			toast({
				title: t("nodes.updateAllNodeServicesFailed", { count: failedCount }),
				status: "error",
				isClosable: true,
				position: "top",
			});
		}
	};

	const closeVersionDialog = () => setVersionDialogTarget(null);
	const closeGeoDialog = () => setGeoDialogTarget(null);

	const handleVersionSubmit = async ({
		version,
		persist,
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
				toast({
					title: t("nodes.coreVersionDialog.noConnectedNodes"),
					status: "warning",
					isClosable: true,
					position: "top",
				});
				return;
			}

			setUpdatingBulkCore(true);
			try {
				const results: Array<{
					status: "fulfilled" | "rejected";
					node: NodeType;
				}> = [];
				for (const node of targetNodes) {
					try {
						await apiFetch(`/node/${node.id}/xray/update`, {
							method: "POST",
							body: { version },
						});
						results.push({ status: "fulfilled", node });
					} catch (err) {
						results.push({ status: "rejected", node });
						generateErrorMessage(err, toast);
					}
				}

				const success = results.filter(
					(result) => result.status === "fulfilled",
				).length;
				const failed = results.length - success;
				const total = results.length;

				if (success > 0) {
					generateSuccessMessage(
						t("nodes.coreVersionDialog.bulkSuccess", { success, total }),
						toast,
					);
				}
				if (failed > 0) {
					toast({
						title: t("nodes.coreVersionDialog.bulkPartialError", {
							failed,
							total,
						}),
						status: "error",
						isClosable: true,
						position: "top",
						duration: 4000,
					});
				}

				queryClient.invalidateQueries(FetchNodesQueryKey);
				closeVersionDialog();
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
				queryClient.invalidateQueries(FetchNodesQueryKey);
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
				queryClient.invalidateQueries(FetchNodesQueryKey);
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
				toast({
					title: t("nodes.geoDialog.noConnectedNodes"),
					status: "warning",
					isClosable: true,
					position: "top",
				});
				return;
			}
			setBulkNodeActionLoading("bulk-geo");
			let success = 0;
			let failed = 0;
			try {
				for (const node of targetNodes) {
					if (!node.id) continue;
					try {
						await apiFetch(`/node/${node.id}/geo/update`, {
							method: "POST",
							body,
						});
						success += 1;
					} catch (err) {
						failed += 1;
						generateErrorMessage(err, toast);
					}
				}
				if (success > 0) {
					generateSuccessMessage(
						t("nodes.geoDialog.bulkSuccess", { count: success }),
						toast,
					);
				}
				if (failed > 0) {
					toast({
						title: t("nodes.geoDialog.bulkPartialError", { count: failed }),
						status: "error",
						isClosable: true,
						position: "top",
					});
				}
				queryClient.invalidateQueries(FetchNodesQueryKey);
				closeGeoDialog();
			} finally {
				setBulkNodeActionLoading(null);
			}
		}
	};

	const filteredNodes = useMemo(() => {
		if (!nodes) return [];
		const term = searchTerm.trim().toLowerCase();
		return nodes.filter((node) => {
			const name = (node.name ?? "").toLowerCase();
			const address = (node.address ?? "").toLowerCase();
			const version = (node.xray_version ?? "").toLowerCase();
			const note = (node.note ?? "").toLowerCase();
			const runtime = (
				node.node_binary_tag ||
				node.node_service_version ||
				""
			).toLowerCase();
			const matchesSearch =
				!term ||
				name.includes(term) ||
				address.includes(term) ||
				version.includes(term) ||
				runtime.includes(term) ||
				note.includes(term);
			const matchesStatus =
				statusFilter === "all" || (node.status || "error") === statusFilter;
			const matchesInstallMode =
				installModeFilter === "all" ||
				(node.node_install_mode || "unknown") === installModeFilter;
			return matchesSearch && matchesStatus && matchesInstallMode;
		});
	}, [nodes, searchTerm, statusFilter, installModeFilter]);

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
					result = (left.cpu_usage_percent ?? -1) - (right.cpu_usage_percent ?? -1);
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
				case "name":
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
			sortedNodes.slice(
				(currentPage - 1) * pageSize,
				currentPage * pageSize,
			),
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

	const handleSort = (key: NodeSortKey) => {
		if (sortKey === key) {
			setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
			return;
		}
		setSortKey(key);
		setSortDirection(
			key === "usage" ||
				key === "bandwidth" ||
				key === "cpu" ||
				key === "ram" ||
				key === "uptime"
				? "desc"
				: "asc",
		);
	};

	const sortLabel = (key: NodeSortKey, label: string) =>
		sortKey === key ? `${label} ${sortDirection === "asc" ? "↑" : "↓"}` : label;

	useEffect(() => {
		setPage(1);
	}, [searchTerm, statusFilter, installModeFilter, sortKey, sortDirection, pageSize]);

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

	const toggleNodeSelection = (nodeID: number, checked: boolean) => {
		setSelectedNodeIds((current) => {
			if (checked) {
				return current.includes(nodeID) ? current : [...current, nodeID];
			}
			return current.filter((id) => id !== nodeID);
		});
	};

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
			toast({
				title: t("nodes.noSelectedNodesForAction"),
				status: "warning",
				isClosable: true,
				position: "top",
			});
			return;
		}
		let hostImpact: NodeHostImpact | undefined;
		if (type === "bulk-disable" || type === "bulk-delete") {
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

	const nodeSummary = useMemo(() => {
		const items = nodes ?? [];
		return {
			total: items.length,
			connected: items.filter((node) => node.status === "connected").length,
			disabled: items.filter((node) => node.status === "disabled").length,
		};
	}, [nodes]);

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
					? t("nodes.updateAllNodeServicesConfirm", { count: serviceActionConfirm.count })
					: serviceActionConfirm?.type === "bulk-enable"
						? t("nodes.bulkEnableConfirm", { count: serviceActionConfirm.count })
						: serviceActionConfirm?.type === "bulk-disable"
							? renderHostImpactMessage(
									t("nodes.bulkDisableConfirm", { count: serviceActionConfirm.count }),
									serviceActionConfirm.hostImpact,
								)
							: serviceActionConfirm?.type === "bulk-delete"
								? renderHostImpactMessage(
										t("nodes.bulkDeleteConfirm", { count: serviceActionConfirm.count }),
										serviceActionConfirm.hostImpact,
									)
								: serviceActionConfirm?.type === "bulk-reset"
									? t("nodes.bulkResetTrafficConfirm", { count: serviceActionConfirm.count })
									: serviceActionConfirm?.type === "bulk-restart"
										? t("nodes.bulkRestartServiceConfirm", { count: serviceActionConfirm.count })
										: serviceActionConfirm?.type === "bulk-update"
											? t("nodes.bulkUpdateServiceConfirm", { count: serviceActionConfirm.count })
											: serviceActionConfirm?.type === "bulk-reboot"
												? t("nodes.bulkRebootHostConfirm", { count: serviceActionConfirm.count })
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

	const versionDialogTitle =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkTitle")
			: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeTitle", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode"),
						})
					: "";

	const versionDialogDescription =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkDescription")
			: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeDescription", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode"),
						})
					: "";

	const versionDialogCurrentVersion =
		versionDialogTarget?.type === "node"
			? (versionDialogTarget.node.xray_version ?? "")
			: "";

	const geoDialogTitle =
		geoDialogTarget?.type === "node"
			? t("nodes.geoDialog.nodeTitle", {
					name:
							geoDialogTarget.node.name ??
							t("nodes.unnamedNode"),
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
			<Popover
				trigger="hover"
				placement="top"
				openDelay={250}
				closeDelay={150}
				isLazy
				closeOnBlur={false}
			>
				<PopoverTrigger>
					<Box as="span">{statusBadge}</Box>
				</PopoverTrigger>
				<PopoverContent maxW="360px" px={2} py={1} fontSize="sm">
					<PopoverArrow />
					<PopoverBody>{node.message}</PopoverBody>
				</PopoverContent>
			</Popover>
		);
	};

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
					<Text
						fontWeight="semibold"
						color="panel.text"
						noOfLines={1}
						maxW="full"
						dir="auto"
					>
						<AppleEmojiText>
							{formatNodeNamePreview(
								node.name || t("nodes.unnamedNode"),
							)}
						</AppleEmojiText>
					</Text>
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
					<Text
						as="button"
						type="button"
						dir="ltr"
						sx={{ unicodeBidi: "isolate" }}
						cursor="pointer"
						textAlign="start"
						maxW="full"
						noOfLines={1}
						_hover={{ color: "primary.500", textDecoration: "underline" }}
						onClick={(event) => {
							event.stopPropagation();
							copyToClipboard(
								node.address,
								t("nodes.nodeAddress"),
							);
						}}
					>
						{formatCellValue(node.address)}
					</Text>
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
						<Tag
							as="button"
							type="button"
							colorScheme="blue"
							size="sm"
							maxW="full"
							overflow="hidden"
							whiteSpace="nowrap"
							cursor="pointer"
							_hover={{ opacity: 0.82 }}
							onClick={(event) => {
								event.stopPropagation();
								if (node.id) setVersionDialogTarget({ type: "node", node });
							}}
						>
							{`Xray ${node.xray_version}`}
						</Tag>
					) : (
						<Text as="span" color="panel.textMuted">
							-
						</Text>
					),
			},
			{
				id: "runtime",
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
					const nodeServiceUpdateAvailable =
						getNodeServiceUpdateAvailable(
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
						<VStack
							align="start"
							justify="center"
							spacing={1}
							minW={0}
							maxW="full"
							overflow="hidden"
						>
							{nodeRuntimeDisplayVersion ? (
								<Tag
									colorScheme="green"
									size="sm"
									maxW="full"
									overflow="hidden"
									whiteSpace="nowrap"
									justifyContent="flex-start"
								>
									{t("nodes.nodeServiceVersionTag", {
										version: nodeRuntimeDisplayVersion,
									})}
								</Tag>
							) : (
								<Text as="span" fontSize="sm" color="panel.textMuted">
									-
								</Text>
							)}
							<Text
								fontSize="xs"
								color="panel.textMuted"
								noOfLines={1}
								minW={0}
								maxW="full"
								textAlign="start"
							>
								{nodeInstallLabel}
							</Text>
							{nodeServiceUpdateAvailable && (
								<Button
									size="xs"
									variant="link"
									colorScheme="orange"
									flexShrink={0}
									leftIcon={<DownloadIconStyled />}
									onClick={(event) => {
										event.stopPropagation();
										handleUpdateNodeService(node);
									}}
									isLoading={
										isUpdatingService &&
										nodeId != null &&
										updatingServiceNodeId === nodeId
									}
									isDisabled={!nodeId || !nodeHostActionsAvailable}
								>
									{t("nodes.nodeUpdateAvailable")}
								</Button>
							)}
							{rebootRequired && (
								<Button
									size="xs"
									variant="link"
									colorScheme="red"
									flexShrink={0}
									leftIcon={<ArrowPathIconStyled />}
									onClick={(event) => {
										event.stopPropagation();
										handleRebootNodeHost(node);
									}}
									isLoading={
										isRebootingHost &&
										nodeId != null &&
										rebootingHostNodeId === nodeId
									}
									isDisabled={!nodeId || !nodeHostActionsAvailable}
								>
									{t("nodes.rebootRequired")}
								</Button>
							)}
						</VStack>
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
					<Text fontWeight="medium" fontSize="sm" lineHeight="short">
						{formatNodeUptime(node.uptime_seconds)}
					</Text>
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
					<Text fontSize="sm" fontWeight="semibold" dir="ltr">
						{formatNodePercent(node.cpu_usage_percent)}
					</Text>
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
					<Text fontSize="sm" fontWeight="semibold" dir="ltr">
						{formatNodeBytes(node.memory_used, 2)} /{" "}
						{formatNodeBytes(node.memory_total, 2)}
					</Text>
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
				id: "certificate",
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
						<IconButton
							aria-label={t("nodes.copyCertificate")}
							icon={<CopyIconStyled />}
							size="sm"
							variant="ghost"
							color="panel.textMuted"
							isDisabled={!certificateBundle}
							onClick={(event) => {
								event.stopPropagation();
								copyToClipboard(
									certificateBundle,
									t("nodes.certificate"),
								);
							}}
						/>
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

	const nodeRowActions = (node: NodeType): DataTableRowAction<NodeType>[] => {
		const nodeId = node.id as number | undefined;
		const status = node.status || "error";
		const isEnabled = status !== "disabled" && status !== "limited";
		const pending = nodeId != null ? pendingStatus[nodeId] : undefined;
		const displayEnabled = pending ?? isEnabled;
		const isToggleLoading = nodeId != null && togglingNodeId === nodeId && isToggling;
		const nodeHostActionsAvailable =
			hostActionsAvailable && node.node_install_mode === "binary";
		const isCoreUpdating = nodeId != null && updatingCoreNodeId === nodeId;
		const isGeoUpdating = nodeId != null && updatingGeoNodeId === nodeId;
		const isRestartingMaintenance =
			isRestartingService && nodeId != null && restartingServiceNodeId === nodeId;
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
				label: displayEnabled
					? t("nodes.disableNode")
					: t("nodes.enableNode"),
				icon: displayEnabled ? <DisableIconStyled /> : <EnableIconStyled />,
				onClick: () => handleToggleNode(node),
				isDisabled: !nodeId || isToggleLoading,
			},
			status === "error"
				? {
						id: "reconnect",
						label: t("nodes.reconnect"),
						icon: <ArrowPathIconStyled />,
						onClick: () => reconnect(node),
						isDisabled: isReconnecting,
					}
				: null,
			{
				id: "core",
				label: t("nodes.updateCoreAction"),
				icon: <CoreIconStyled />,
				onClick: () => nodeId && setVersionDialogTarget({ type: "node", node }),
				isDisabled: !nodeId || !nodeHostActionsAvailable || isCoreUpdating,
			},
			{
				id: "geo",
				label: t("nodes.updateGeoAction"),
				icon: <GeoIconStyled />,
				onClick: () => nodeId && setGeoDialogTarget({ type: "node", node }),
				isDisabled: !nodeId || !nodeHostActionsAvailable || isGeoUpdating,
			},
			{
				id: "restart-service",
				label: t("nodes.restartServiceAction"),
				icon: <ServiceIconStyled />,
				onClick: () => handleRestartNodeService(node),
				isDisabled:
					!nodeId || !nodeHostActionsAvailable || isRestartingMaintenance,
			},
			{
				id: "update-service",
				label: t("nodes.updateServiceAction"),
				icon: <DownloadIconStyled />,
				onClick: () => handleUpdateNodeService(node),
				isDisabled:
					!nodeId || !nodeHostActionsAvailable || isUpdatingMaintenance,
			},
			{
				id: "reboot-host",
				label: t("nodes.rebootHostAction"),
				icon: <ArrowPathIconStyled />,
				onClick: () => handleRebootNodeHost(node),
				isDisabled:
					!nodeId || !nodeHostActionsAvailable || isRebootingMaintenance,
				isDanger: true,
			},
			{
				id: "reset-usage",
				label: t("nodes.resetUsage"),
				icon: <ArrowPathIconStyled />,
				onClick: () => handleResetNodeUsage(node),
				isDisabled: !nodeId,
				isDanger: true,
			},
			node.uses_default_certificate
				? {
						id: "certificate",
						label: t("nodes.generatePrivateCert"),
						icon: <CertificateIconStyled />,
						onClick: () => nodeId && regenerateNodeCertMutate(node),
						isDisabled:
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
				isDisabled: isDeletingNode,
				isDanger: true,
			},
		].filter(Boolean) as DataTableRowAction<NodeType>[];
	};

	const nodeSorting = useMemo<SortingState>(
		() => [{ id: sortKey, desc: sortDirection === "desc" }],
		[sortDirection, sortKey],
	);

	const handleNodeTableSorting = (nextSorting: SortingState) => {
		const next = nextSorting[0];
		if (!next || !isNodeSortKey(next.id)) return;
		setSortKey(next.id);
		setSortDirection(next.desc ? "desc" : "asc");
	};

	const nodesPagination =
		filteredNodes.length > 0 ? (
			<Stack
				direction={{ base: "column", md: "row" }}
				align={{ base: "stretch", md: "center" }}
				justify="space-between"
				spacing={3}
				borderWidth="1px"
				borderColor={nodePanelBorder}
				borderRadius="md"
				bg={nodePanelBg}
				p={3}
			>
				<Text fontSize="sm" color="gray.500">
					{t("nodes.paginationSummary", { start: paginationStart, end: paginationEnd, total: filteredNodes.length })}
				</Text>
				<HStack spacing={2} justify={{ base: "space-between", md: "flex-end" }}>
					<Select
						size="sm"
						value={pageSize}
						onChange={(event) => setPageSize(Number(event.target.value))}
						w="90px"
					>
						<option value={12}>12</option>
						<option value={24}>24</option>
						<option value={48}>48</option>
						<option value={96}>96</option>
						<option value={100}>100</option>
					</Select>
					<ButtonGroup size="sm" isAttached variant="outline">
						<Button
							onClick={() => setPage((value) => Math.max(1, value - 1))}
							isDisabled={currentPage <= 1}
						>
							{t("previous")}
						</Button>
						<Button isDisabled>
							{currentPage} / {totalPages}
						</Button>
						<Button
							onClick={() =>
								setPage((value) => Math.min(totalPages, value + 1))
							}
							isDisabled={currentPage >= totalPages}
						>
							{t("next")}
						</Button>
					</ButtonGroup>
				</HStack>
			</Stack>
		) : null;

	if (!getUserIsSuccess) {
		return (
			<VStack spacing={4} align="center" py={10}>
				<Spinner size="lg" />
			</VStack>
		);
	}

	if (!canManageNodes) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("nodes.title")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t("nodes.noPermission")}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack
			spacing={5}
			align="stretch"
			pb={selectedNodeIds.length > 0 ? { base: 32, md: 24 } : 0}
		>
			<PageHeader title={t("header.nodes")} />

			{hasError && (
				<Alert status="error" borderRadius="md">
					<AlertIcon />
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			)}

			<Stack
				spacing={3}
				w="full"
				borderWidth="1px"
				borderColor={nodePanelBorder}
				borderRadius="md"
				bg={nodePanelBg}
				p={3}
			>
				<Stack
					direction={{ base: "column", xl: "row" }}
					spacing={3}
					align={{ base: "stretch", xl: "flex-start" }}
					justify="space-between"
				>
					<VStack align="flex-start" spacing={1} minW={{ base: "0", xl: "210px" }}>
						<Text fontWeight="semibold">
							{t("nodes.manageNodesHeader")}
						</Text>
						<HStack spacing={2} flexWrap="wrap">
							<Tag size="sm" colorScheme="gray" variant="subtle">
								{t("total")}: {nodeSummary.total}
							</Tag>
							<Tag size="sm" colorScheme="green" variant="subtle">
								{t("status.connected")}:{" "}
								{nodeSummary.connected}
							</Tag>
							<Tag size="sm" colorScheme="gray" variant="subtle">
								{t("nodes.disabled")}:{" "}
								{nodeSummary.disabled}
							</Tag>
						</HStack>
					</VStack>
					<SimpleGrid
						columns={{ base: 2, md: 4 }}
						spacing={2}
						w={{ base: "full", xl: "auto" }}
						minW={0}
						maxW="full"
					>
						<Button
							leftIcon={<TutorialIconStyled />}
							variant="outline"
							size="sm"
							h="36px"
							px={3}
							minW={0}
							w="full"
							onClick={() =>
								navigate(
									`/tutorials?doc=${encodeURIComponent(
										"admin/nodes/#section-nodes-admin-guide",
									)}`,
								)
							}
						>
							{t("nodes.toolbarTutorial")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							leftIcon={<CoreIconStyled />}
							h="36px"
							px={3}
							minW={0}
							w="full"
							onClick={() => setVersionDialogTarget({ type: "bulk" })}
							isDisabled={!hasConnectedNodes || !hostActionsAvailable}
						>
							{t("nodes.toolbarUpdateCore")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							leftIcon={<DownloadIconStyled />}
							h="36px"
							px={3}
							minW={0}
							w="full"
							onClick={handleUpdateAllNodeServices}
							isLoading={updatingBulkService}
							isDisabled={
								!hostActionsAvailable || !hasBinaryNodes || updatingBulkService
							}
						>
							{t("nodes.toolbarUpdateServices")}
						</Button>
						<Button
							leftIcon={<AddIconStyled />}
							colorScheme="primary"
							size="sm"
							h="36px"
							px={3}
							minW={0}
							w="full"
							onClick={() => setAddNodeOpen(true)}
						>
							{t("nodes.addNode")}
						</Button>
					</SimpleGrid>
				</Stack>

				<Divider />

				<Stack
					direction={{ base: "column", xl: "row" }}
					spacing={3}
					align={{ base: "stretch", xl: "center" }}
					justify="space-between"
				>
					<Stack
						direction="row"
						spacing={2}
						align="center"
						flex="1"
						flexWrap="wrap"
					>
						<InputGroup
							size="sm"
							w={{ base: "full", md: "260px", xl: "280px" }}
							flex={{ base: "0 0 100%", md: "0 0 auto" }}
						>
							<InputLeftElement pointerEvents="none">
								<SearchIcon color="gray.400" />
							</InputLeftElement>
							<Input
								value={searchTerm}
								onChange={(event) => setSearchTerm(event.target.value)}
								placeholder={t("nodes.searchPlaceholder")}
							/>
						</InputGroup>
						<Select
							size="sm"
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							w={{ base: "calc(50% - 4px)", md: "150px" }}
						>
							<option value="all">{t("nodes.filters.allStatuses")}</option>
							<option value="connected">{t("status.connected")}</option>
							<option value="connecting">{t("nodeModal.status.connecting")}</option>
							<option value="error">{t("nodeModal.status.error")}</option>
							<option value="disabled">{t("status.disabled")}</option>
							<option value="limited">{t("status.limited")}</option>
						</Select>
						<Select
							size="sm"
							value={installModeFilter}
							onChange={(event) => setInstallModeFilter(event.target.value)}
							w={{ base: "calc(50% - 4px)", md: "150px" }}
						>
							<option value="all">{t("nodes.filters.allModes")}</option>
							<option value="binary">{t("nodes.installMode.binary")}</option>
							<option value="docker">{t("nodes.installMode.docker")}</option>
							<option value="unknown">{t("status.unknown")}</option>
						</Select>
						<Select
							size="sm"
							value={`${sortKey}.${sortDirection}`}
							onChange={(event) => {
								const [nextKey, nextDirection] = event.target.value.split(".");
								setSortKey(nextKey as NodeSortKey);
								setSortDirection(nextDirection as NodeSortDirection);
							}}
							w={{ base: "calc(50% - 4px)", md: "170px" }}
						>
							<option value="name.asc">{t("nodes.sort.nameAsc")}</option>
							<option value="name.desc">{t("nodes.sort.nameDesc")}</option>
							<option value="usage.asc">{t("nodes.sort.usageAsc")}</option>
							<option value="usage.desc">{t("nodes.sort.usageDesc")}</option>
							<option value="status.asc">{t("nodes.sort.statusAsc")}</option>
							<option value="status.desc">{t("nodes.sort.statusDesc")}</option>
							<option value="bandwidth.asc">{t("nodes.sort.bandwidthAsc")}</option>
							<option value="bandwidth.desc">{t("nodes.sort.bandwidthDesc")}</option>
							<option value="cpu.asc">{t("nodes.sort.cpuAsc")}</option>
							<option value="cpu.desc">{t("nodes.sort.cpuDesc")}</option>
							<option value="ram.asc">{t("nodes.sort.ramAsc")}</option>
							<option value="ram.desc">{t("nodes.sort.ramDesc")}</option>
						</Select>
						<Box
							w={{ base: "calc(50% - 4px)", md: "auto" }}
							display="flex"
							justifyContent={{ base: "flex-end", md: "flex-start" }}
						>
							<Tooltip label={t("nodes.refreshNodes")}>
								<IconButton
									aria-label={t("nodes.refreshNodes")}
									icon={<ArrowPathIconStyled />}
									variant="ghost"
									size="sm"
									onClick={() => refetchNodes()}
									isLoading={isFetching}
								/>
							</Tooltip>
						</Box>
					</Stack>
				</Stack>
			</Stack>

			{!hostActionsAvailable && (
				<Alert status="warning" variant="subtle" borderRadius="md">
					<AlertIcon />
					<AlertDescription>
						{t("nodes.binaryMigrationRequired")}
					</AlertDescription>
				</Alert>
			)}

			<DataTable
				ariaLabel={t("nodes.manageNodesHeader")}
				data={paginatedNodes}
				columns={nodeColumns}
				getRowId={(node, index) => String(node.id ?? node.name ?? index)}
				isLoading={isLoading}
				loadingRows={Math.min(pageSize, 8)}
				emptyState={
					<Text fontSize="sm" color="panel.textMuted" textAlign="center">
						{t("nodes.noNodesFound")}
					</Text>
				}
				enableSelection
				selectedRowIds={selectedNodeIds.map(String)}
				selectedRows={selectedNodes}
				selectedCount={selectedNodeIds.length}
				onSelectionChange={(rowIds) => {
					setSelectedNodeIds(
						rowIds
							.map((id) => Number(id))
							.filter((id) => Number.isFinite(id)),
					);
				}}
				getRowCanSelect={(node) => node.id != null}
				rowActions={nodeRowActions}
				actionsDisplay="menu"
				actionsPlacement="end"
				actionsColumnWidth="44px"
				showActionsOnHover
				sorting={nodeSorting}
				onSortingChange={handleNodeTableSorting}
				manualSorting
				pagination={nodesPagination}
				selectedLabel={t("nodes.selectedCount", { count: selectedNodeIds.length })}
				renderBulkActions={() => (
					<>
						<Button
							size="sm"
							variant="outline"
							onClick={selectAllFilteredNodes}
							isDisabled={allFilteredSelected}
						>
							{t("nodes.selectAllFiltered")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<EnableIconStyled />}
							onClick={selectOnlyActiveNodes}
							isDisabled={
								activeFilteredNodeIds.length === 0 || onlyActiveFilteredSelected
							}
						>
							{t("nodes.selectOnlyActive")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<EnableIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-enable", selectableSelectedNodes())
							}
							isDisabled={Boolean(bulkNodeActionLoading)}
						>
							{t("nodes.enableNode")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<DisableIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-disable", selectableSelectedNodes())
							}
							isDisabled={Boolean(bulkNodeActionLoading)}
						>
							{t("nodes.disableNode")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<ArrowPathIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-reset", selectableSelectedNodes())
							}
							isDisabled={Boolean(bulkNodeActionLoading)}
						>
							{t("nodes.resetUsage")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<ServiceIconStyled />}
							onClick={() =>
								openBulkActionConfirm(
									"bulk-restart",
									selectedConnectedBinaryNodes(),
								)
							}
							isDisabled={
								Boolean(bulkNodeActionLoading) ||
								selectedConnectedBinaryNodes().length === 0
							}
						>
							{t("nodes.restartServiceAction")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<DownloadIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-update", selectedBinaryNodes())
							}
							isDisabled={
								Boolean(bulkNodeActionLoading) || selectedBinaryNodes().length === 0
							}
						>
							{t("nodes.updateServiceAction")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<CoreIconStyled />}
							onClick={() =>
								setVersionDialogTarget({
									type: "bulk",
									nodes: selectedConnectedBinaryNodes(),
								})
							}
							isDisabled={
								Boolean(bulkNodeActionLoading) ||
								selectedConnectedBinaryNodes().length === 0
							}
						>
							{t("nodes.updateCoreAction")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<GeoIconStyled />}
							onClick={() =>
								setGeoDialogTarget({
									type: "bulk",
									nodes: selectedConnectedBinaryNodes(),
								})
							}
							isDisabled={
								Boolean(bulkNodeActionLoading) ||
								selectedConnectedBinaryNodes().length === 0
							}
						>
							{t("nodes.updateGeoAction")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<ArrowPathIconStyled />}
							onClick={() =>
								openBulkActionConfirm(
									"bulk-reboot",
									selectedConnectedBinaryNodes(),
								)
							}
							isDisabled={
								Boolean(bulkNodeActionLoading) ||
								selectedConnectedBinaryNodes().length === 0
							}
						>
							{t("nodes.rebootHostAction")}
						</Button>
						<Button
							size="sm"
							colorScheme="red"
							variant="outline"
							leftIcon={<DeleteIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-delete", selectableSelectedNodes())
							}
							isDisabled={Boolean(bulkNodeActionLoading)}
						>
							{t("delete")}
						</Button>
					</>
				)}
				tableProps={{
					w: "full",
					sx: {
						tableLayout: "auto",
						"& th, & td": {
							px: { base: 1.5, xl: 2 },
							py: 2,
							verticalAlign: "middle",
						},
					},
				}}
			/>
			<CoreVersionDialog
				isOpen={Boolean(versionDialogTarget)}
				onClose={closeVersionDialog}
				onSubmit={handleVersionSubmit}
				currentVersion={versionDialogCurrentVersion}
				title={versionDialogTitle}
				description={versionDialogDescription}
				allowPersist={false}
				isSubmitting={versionDialogLoading}
			/>
			<GeoUpdateDialog
				isOpen={Boolean(geoDialogTarget)}
				onClose={closeGeoDialog}
				onSubmit={handleGeoSubmit}
				title={geoDialogTitle}
				showMasterOptions={false}
				isSubmitting={geoDialogLoading}
			/>
			<ConfirmDialog
				isOpen={Boolean(serviceActionConfirm)}
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
				isLoading={serviceActionConfirmLoading}
			/>
			<ConfirmDialog
				isOpen={isDeleteConfirmOpen}
				onClose={handleCloseDeleteConfirm}
				onConfirm={confirmDeleteNode}
				title={t("delete")}
				description={renderHostImpactMessage(
					t("deleteNode.prompt", {
						name:
							deleteCandidate?.name ??
							deleteCandidate?.address ??
							t("nodes.thisNode"),
					}),
					deleteHostImpact,
				)}
				confirmLabel={t("delete")}
				colorScheme="red"
				isLoading={isDeletingNode || hostCleanupLoading}
				isConfirmDisabled={!deleteCandidate}
			/>

			<ConfirmDialog
				isOpen={isResetConfirmOpen}
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
				isLoading={isResettingUsage}
				isConfirmDisabled={!resetCandidate}
			/>

			<NodeFormModal
				isOpen={isAddNodeOpen}
				onClose={() => setAddNodeOpen(false)}
				mutate={addNodeMutate}
				isLoading={isAdding}
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
				isOpen={!!editingNode}
				onClose={() => setEditingNode(null)}
				node={editingNode || undefined}
				defaultInboundTags={defaultInboundSummaries}
				mutate={updateNodeMutate}
				isLoading={isUpdating}
			/>
			{newNodeCertificate && (
				<Modal isOpen onClose={() => setNewNodeCertificate(null)} size="md">
					<ModalOverlay bg="blackAlpha.500" backdropFilter="blur(12px)" />
					<ModalContent
						bg={nodePanelBg}
						borderWidth="1px"
						borderColor={nodePanelBorder}
						borderRadius="2xl"
						boxShadow="2xl"
						overflow="hidden"
						mx={{ base: 4, sm: 0 }}
						maxW={{ base: "calc(100vw - 32px)", sm: "520px" }}
					>
						<ModalHeader px={6} pt={6} pb={2}>
							<HStack spacing={3}>
								<Box
									display="inline-flex"
									alignItems="center"
									justifyContent="center"
									w={10}
									h={10}
									borderRadius="full"
									bg="primary.50"
									color="primary.600"
									_dark={{ bg: "primary.900", color: "primary.200" }}
								>
									<CertificateIconStyled />
								</Box>
								<Text>{t("nodes.newNodePublicKeyTitle")}</Text>
							</HStack>
						</ModalHeader>
						<ModalCloseButton />
						<ModalBody px={6} pb={2}>
							<VStack align="stretch" spacing={4}>
								<Text
									fontSize="sm"
									color="gray.600"
									_dark={{ color: "gray.300" }}
								>
									{t("nodes.newNodePublicKeyDesc")}
								</Text>
								<Box borderWidth="1px" borderRadius="lg" overflow="hidden">
									<HStack
										justify="space-between"
										align="center"
										px={4}
										py={3}
										bg="gray.50"
										_dark={{ bg: "gray.800" }}
									>
										<VStack align="flex-start" spacing={0}>
											<Text fontWeight="semibold">
												{t("nodes.installBundleLabel")}
											</Text>
											{newNodeCertificate.name && (
												<Text
													fontSize="xs"
													color="gray.500"
													_dark={{ color: "gray.400" }}
												>
													{newNodeCertificate.name}
												</Text>
											)}
										</VStack>
										<HStack spacing={2}>
											<Button
												size="sm"
												variant="outline"
												leftIcon={<CopyIconStyled />}
												onClick={() => {
													if (!generatedCertificateBundleValue) return;
													copyGeneratedCertificateBundle();
													toast({
														title: t("copied"),
														status: "success",
														isClosable: true,
														position: "top",
														duration: 2000,
													});
												}}
												isDisabled={!generatedCertificateBundleValue}
											>
												{generatedCertificateBundleCopied ? t("copied") : t("copy")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												leftIcon={<DownloadIconStyled />}
												onClick={() => {
													if (!generatedCertificateBundleValue) return;
													const blob = new Blob([generatedCertificateBundleValue], {
														type: "text/plain",
													});
													const url = URL.createObjectURL(blob);
													const anchor = document.createElement("a");
													anchor.href = url;
													anchor.download = "node_install_bundle.pem";
													anchor.click();
													URL.revokeObjectURL(url);
												}}
												isDisabled={!generatedCertificateBundleValue}
											>
												{t("nodes.download-node-install-bundle")}
											</Button>
										</HStack>
									</HStack>
									<Box
										px={4}
										py={3}
										bg="white"
										_dark={{ bg: "gray.900" }}
										fontFamily="mono"
										fontSize="xs"
										whiteSpace="pre-wrap"
										wordBreak="break-word"
										maxH="280px"
										overflow="auto"
									>
										{generatedCertificateBundleValue}
									</Box>
								</Box>
							</VStack>
						</ModalBody>
						<ModalFooter
							bg="blackAlpha.50"
							_dark={{ bg: "whiteAlpha.50" }}
							borderTopWidth="1px"
							borderColor={nodePanelBorder}
							px={6}
							py={4}
						>
							<Button
								onClick={() => setNewNodeCertificate(null)}
								colorScheme="primary"
							>
								{t("close")}
							</Button>
						</ModalFooter>
					</ModalContent>
				</Modal>
			)}
		</VStack>
	);
};

export default NodesPage;
