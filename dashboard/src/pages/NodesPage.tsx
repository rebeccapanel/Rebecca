import {
	Alert,
	AlertDescription,
	AlertDialog,
	AlertDialogBody,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertIcon,
	Box,
	Button,
	ButtonGroup,
	chakra,
	Checkbox,
	Divider,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
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
	Portal,
	Progress,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Table,
	Tag,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
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
	Bars3Icon,
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
	Squares2X2Icon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import {
	FetchNodesQueryKey,
	type NodeType,
	useNodes,
	useNodesQuery,
} from "contexts/NodesContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import { fetch as apiFetch } from "service/http";
import { formatBytes } from "utils/formatByte";
import { formatDuration } from "utils/formatDuration";
import {
	getNodesPerPageLimitSize,
	setNodesPerPageLimitSize,
} from "utils/userPreferenceStorage";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { ConfirmActionDialog } from "../components/ConfirmActionDialog";
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
const GridViewIcon = chakra(Squares2X2Icon, { baseStyle: { w: 4, h: 4 } });
const ListViewIcon = chakra(Bars3Icon, { baseStyle: { w: 4, h: 4 } });
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
	value !== null && value !== undefined && Number.isFinite(value) && value > 0
		? formatDuration(value)
		: "-";

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
		<VStack align="flex-start" spacing={1} minW={0}>
			<Text fontWeight="semibold" fontSize="sm" lineHeight="short" wordBreak="break-word">
				{value}
			</Text>
			{helper && helper !== "-" ? (
				<Text fontSize="xs" color="gray.500" lineHeight="short">
					{helper}
				</Text>
			) : null}
			{progressValue !== undefined && (
				<Progress
					value={progressValue}
					size="xs"
					colorScheme={colorScheme}
					borderRadius="full"
					w="56px"
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

type VersionDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

type GeoDialogTarget =
	| { type: "node"; node: NodeType }
	| { type: "bulk"; nodes?: NodeType[] };

type ServiceActionConfirm =
	| { type: "restart"; node: NodeType; label: string }
	| { type: "update"; node: NodeType; label: string }
	| { type: "update-all"; count: number }
	| {
			type:
				| "bulk-enable"
				| "bulk-disable"
				| "bulk-delete"
				| "bulk-reset"
				| "bulk-update";
			nodes: NodeType[];
			count: number;
		};

type MaintenanceInfo = {
	panel?: { mode?: string; install_mode?: string } | null;
	node_update?: {
		channel?: string;
		latest_release?: { tag?: string | null } | null;
		latest_dev?: { tag?: string | null } | null;
	} | null;
};

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
	const {
		addNode,
		updateNode,
		regenerateNodeCertificate,
		reconnectNode,
		restartNodeService,
		updateNodeService,
		resetNodeUsage,
		deleteNode,
		setDeletingNode,
	} = useNodes();
	const queryClient = useQueryClient();
	const toast = useToast();
	const nodeCardBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const nodeCardBorder = useColorModeValue("blackAlpha.300", "whiteAlpha.300");
	const nodePanelBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const nodePanelBorder = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
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
	const viewModeStorageKey = "nodesViewMode";
	const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
		if (typeof window === "undefined") {
			return "grid";
		}
		const saved = window.localStorage.getItem(viewModeStorageKey);
		return saved === "list" ? "list" : "grid";
	});
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
	const [updatingServiceNodeId, setUpdatingServiceNodeId] = useState<
		number | null
	>(null);
	const [updatingBulkService, setUpdatingBulkService] = useState(false);
	const [serviceActionConfirm, setServiceActionConfirm] =
		useState<ServiceActionConfirm | null>(null);
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
	const cancelResetRef = useRef<HTMLButtonElement | null>(null);
	const [deleteCandidate, setDeleteCandidate] = useState<NodeType | null>(null);
	const {
		isOpen: isDeleteConfirmOpen,
		onOpen: openDeleteConfirm,
		onClose: closeDeleteConfirm,
	} = useDisclosure();
	const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(viewModeStorageKey, viewMode);
		} catch (error) {
			console.warn("Unable to persist nodes view mode", error);
		}
	}, [viewMode]);

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

	const currentNodeVersion = useMemo(() => {
		const versionedNode = nodes?.find(
			(nodeItem) => nodeItem.node_binary_tag || nodeItem.node_service_version,
		);
		return (
			versionedNode?.node_binary_tag ||
			versionedNode?.node_service_version ||
			""
		);
	}, [nodes]);
	const detectedNodeUpdateChannel =
		nodes?.find((nodeItem) => nodeItem.node_update_channel)
			?.node_update_channel || maintenanceInfo?.node_update?.channel;
	const nodeUpdateChannel =
		detectedNodeUpdateChannel === "dev" ? "dev" : "latest";
	const latestNodeVersion = getLatestNodeVersionForChannel(
		maintenanceInfo,
		nodeUpdateChannel,
	);
	const currentNodeDisplayVersion =
		nodeUpdateChannel === "dev" &&
		currentNodeVersion &&
		!/^dev-[0-9a-f]{7,40}$/i.test(currentNodeVersion)
			? `dev (${currentNodeVersion})`
			: currentNodeVersion;
	const isNodeUpdateAvailable =
		getNodeServiceUpdateAvailable(
			currentNodeVersion,
			latestNodeVersion,
			nodeUpdateChannel,
	);

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
					t("nodes.regenerateCertSuccess", "New certificate generated"),
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

	const { isLoading: isResettingUsage, mutate: resetUsageMutate } = useMutation(
		resetNodeUsage,
		{
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.resetUsageSuccess", "Node usage reset"),
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
					t("nodes.restartServiceTriggered", "Node restart requested"),
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
					t("nodes.updateServiceTriggered", "Node update requested"),
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

	const nodeGridColumns = useMemo(() => ({ base: 1, md: 2, xl: 3 }), []);

	const handleToggleNode = (node: NodeType) => {
		if (!node?.id) return;
		const isEnabled = node.status !== "disabled";
		const nextStatus = isEnabled ? "disabled" : "connecting";
		const nodeId = node.id as number;
		setTogglingNodeId(nodeId);
		setPendingStatus((prev) => ({ ...prev, [nodeId]: !isEnabled }));
		toggleNodeStatus({ ...node, status: nextStatus });
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
		const label = node.name || node.address || t("nodes.thisNode", "this node");
		setServiceActionConfirm({ type: "restart", node, label });
	};

	const handleUpdateNodeService = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode", "this node");
		setServiceActionConfirm({ type: "update", node, label });
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
				title: t("nodes.copySuccess", "{{label}} copied", { label }),
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
				title: t(
					"nodes.noBinaryNodesForServiceUpdate",
					"No binary nodes are available for service update.",
				),
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
		if (isRestartingService || isUpdatingService || updatingBulkService) {
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

		if (
			serviceActionConfirm.type === "bulk-enable" ||
			serviceActionConfirm.type === "bulk-disable" ||
			serviceActionConfirm.type === "bulk-delete" ||
			serviceActionConfirm.type === "bulk-reset" ||
			serviceActionConfirm.type === "bulk-update"
		) {
			const actionType = serviceActionConfirm.type;
			const targetNodes = serviceActionConfirm.nodes.filter(
				(node: NodeType) => node.id != null,
			);
			setServiceActionConfirm(null);
			setBulkNodeActionLoading(actionType);
			let successCount = 0;
			let failedCount = 0;
			const completedIDs: number[] = [];
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
						case "bulk-update":
							await apiFetch(`/node/${node.id}/service/update`, {
								method: "POST",
								body: {
									channel: getNodeUpdateChannel(node, nodeUpdateChannel),
								},
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
					t("nodes.bulkActionSuccess", {
						defaultValue: "{{count}} node actions completed.",
						count: successCount,
					}),
					toast,
				);
			}
			if (failedCount > 0) {
				toast({
					title: t("nodes.bulkActionFailed", {
						defaultValue: "{{count}} node actions failed.",
						count: failedCount,
					}),
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
				t(
					"nodes.updateAllNodeServicesTriggered",
					"Node service update requested for {{count}} nodes.",
					{ count: successCount },
				),
				toast,
			);
		}
		if (failedCount > 0) {
			toast({
				title: t(
					"nodes.updateAllNodeServicesFailed",
					"{{count}} node service updates failed.",
					{ count: failedCount },
				),
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
					title: t(
						"nodes.coreVersionDialog.noConnectedNodes",
						"No connected nodes available for update.",
					),
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
						name: targetNode.name ?? t("nodes.unnamedNode", "Unnamed node"),
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
						name: targetNode.name ?? t("nodes.unnamedNode", "Unnamed node"),
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
					title: t(
						"nodes.geoDialog.noConnectedNodes",
						"No selected connected nodes are available for geo update.",
					),
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
						t("nodes.geoDialog.bulkSuccess", {
							defaultValue: "Geo update completed for {{count}} nodes.",
							count: success,
						}),
						toast,
					);
				}
				if (failed > 0) {
					toast({
						title: t("nodes.geoDialog.bulkPartialError", {
							defaultValue: "{{count}} geo updates failed.",
							count: failed,
						}),
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
	const paginatedNodeIds = useMemo(
		() =>
			paginatedNodes
				.map((node) => node.id)
				.filter((id): id is number => id != null),
		[paginatedNodes],
	);
	const allFilteredSelected =
		filteredNodeIds.length > 0 &&
		filteredNodeIds.every((id) => selectedNodeIdSet.has(id));
	const allPageSelected =
		paginatedNodeIds.length > 0 &&
		paginatedNodeIds.every((id) => selectedNodeIdSet.has(id));
	const somePageSelected =
		paginatedNodeIds.some((id) => selectedNodeIdSet.has(id)) &&
		!allPageSelected;

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

	const toggleCurrentPageSelection = (checked: boolean) => {
		setSelectedNodeIds((current) => {
			if (!checked) {
				const pageIDs = new Set(paginatedNodeIds);
				return current.filter((id) => !pageIDs.has(id));
			}
			const next = new Set(current);
			paginatedNodeIds.forEach((id) => next.add(id));
			return Array.from(next);
		});
	};

	const deselectAllNodes = () => {
		setSelectedNodeIds([]);
	};

	const selectableSelectedNodes = () =>
		selectedNodes.filter((node) => node.id != null);

	const selectedBinaryNodes = () =>
		selectableSelectedNodes().filter(
			(node) => node.node_install_mode === "binary",
		);

	const selectedConnectedBinaryNodes = () =>
		selectedBinaryNodes().filter((node) => node.status === "connected");

	const openBulkActionConfirm = (
		type:
			| "bulk-enable"
			| "bulk-disable"
			| "bulk-delete"
			| "bulk-reset"
			| "bulk-update",
		nodesForAction: NodeType[],
	) => {
		if (nodesForAction.length === 0) {
			toast({
				title: t(
					"nodes.noSelectedNodesForAction",
					"No selected nodes can run this action.",
				),
				status: "warning",
				isClosable: true,
				position: "top",
			});
			return;
		}
		setServiceActionConfirm({
			type,
			nodes: nodesForAction,
			count: nodesForAction.length,
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
			? t("nodes.restartServiceAction", "Restart node service")
			: serviceActionConfirm?.type === "update"
				? t("nodes.updateServiceAction", "Update node service")
				: serviceActionConfirm?.type === "update-all"
					? t("nodes.updateAllNodeServices", "Update all node services")
					: serviceActionConfirm?.type === "bulk-enable"
						? t("nodes.bulkEnable", "Enable selected nodes")
						: serviceActionConfirm?.type === "bulk-disable"
							? t("nodes.bulkDisable", "Disable selected nodes")
							: serviceActionConfirm?.type === "bulk-delete"
								? t("nodes.bulkDelete", "Delete selected nodes")
								: serviceActionConfirm?.type === "bulk-reset"
									? t("nodes.bulkResetTraffic", "Reset selected traffic")
									: serviceActionConfirm?.type === "bulk-update"
										? t("nodes.bulkUpdateService", "Update selected services")
					: "";

	const serviceActionConfirmMessage =
		serviceActionConfirm?.type === "restart"
			? t(
					"nodes.restartServiceConfirm",
					"Send a restart request to {{name}}? Services will be interrupted briefly.",
					{ name: serviceActionConfirm.label },
				)
			: serviceActionConfirm?.type === "update"
				? t(
						"nodes.updateServiceConfirm",
						"Send an update request to {{name}}? The node will download updates and restart.",
						{ name: serviceActionConfirm.label },
					)
				: serviceActionConfirm?.type === "update-all"
					? t(
							"nodes.updateAllNodeServicesConfirm",
							"Send update requests to {{count}} binary nodes? Each node will download updates and restart.",
							{ count: serviceActionConfirm.count },
						)
					: serviceActionConfirm?.type === "bulk-enable"
						? t(
								"nodes.bulkEnableConfirm",
								"Enable {{count}} selected nodes?",
								{ count: serviceActionConfirm.count },
							)
						: serviceActionConfirm?.type === "bulk-disable"
							? t(
									"nodes.bulkDisableConfirm",
									"Disable {{count}} selected nodes?",
									{ count: serviceActionConfirm.count },
								)
							: serviceActionConfirm?.type === "bulk-delete"
								? t(
										"nodes.bulkDeleteConfirm",
										"Delete {{count}} selected nodes? This cannot be undone.",
										{ count: serviceActionConfirm.count },
									)
								: serviceActionConfirm?.type === "bulk-reset"
									? t(
											"nodes.bulkResetTrafficConfirm",
											"Reset traffic for {{count}} selected nodes?",
											{ count: serviceActionConfirm.count },
										)
									: serviceActionConfirm?.type === "bulk-update"
										? t(
												"nodes.bulkUpdateServiceConfirm",
												"Update Rebecca-node service on {{count}} selected binary nodes?",
												{ count: serviceActionConfirm.count },
											)
					: "";

	const serviceActionConfirmLabel =
		serviceActionConfirm?.type === "restart"
			? t("nodes.restartServiceAction", "Restart node service")
			: serviceActionConfirm?.type === "update-all"
				? t("nodes.updateAllNodeServices", "Update all node services")
				: serviceActionConfirm?.type === "bulk-enable"
					? t("nodes.enableNode", "Enable node")
					: serviceActionConfirm?.type === "bulk-disable"
						? t("nodes.disableNode", "Disable node")
						: serviceActionConfirm?.type === "bulk-delete"
							? t("delete", "Delete")
							: serviceActionConfirm?.type === "bulk-reset"
								? t("nodes.resetUsage", "Reset usage")
								: serviceActionConfirm?.type === "bulk-update"
									? t("nodes.updateServiceAction", "Update node service")
				: t("nodes.updateServiceAction", "Update node service");

	const serviceActionConfirmLoading =
		isRestartingService ||
		isUpdatingService ||
		updatingBulkService ||
		Boolean(bulkNodeActionLoading);

	const versionDialogTitle =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkTitle")
			: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeTitle", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode", "Unnamed node"),
						})
					: "";

	const versionDialogDescription =
		versionDialogTarget?.type === "bulk"
			? t("nodes.coreVersionDialog.bulkDescription")
			: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeDescription", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode", "Unnamed node"),
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
							t("nodes.unnamedNode", "Unnamed node"),
					})
				: geoDialogTarget?.type === "bulk"
					? t("nodes.geoDialog.bulkTitle", "Update selected nodes geo")
					: "";

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
					{t("nodes.title", "Nodes")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"nodes.noPermission",
						"You do not have permission to manage nodes.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={6} align="stretch">
			<Stack
				spacing={1}
				borderWidth="1px"
				borderColor={nodePanelBorder}
				borderRadius="md"
				bg={nodePanelBg}
				p={4}
			>
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("header.nodes")}
				</Text>
				<Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
					{t(
						"nodes.pageDescription",
						"Manage node availability, update runtime versions, and edit node settings.",
					)}
				</Text>
				<HStack spacing={2} flexWrap="wrap" pt={1}>
					{currentNodeDisplayVersion ? (
						<Tag size="sm" colorScheme="gray">
							{t("nodes.nodeServiceVersionTag", {
								version: currentNodeDisplayVersion,
							})}
						</Tag>
					) : (
						<Tag size="sm" colorScheme="gray">
							{t("nodes.nodeServiceVersionUnknown", "Node version unknown")}
						</Tag>
					)}
					{latestNodeVersion ? (
						<Tag size="sm" colorScheme="blue">
							{t("nodes.latestNodeVersionTag", {
								version: normalizeVersion(latestNodeVersion),
							})}
						</Tag>
					) : null}
					{isNodeUpdateAvailable && (
						<Tag size="sm" colorScheme="green">
							{t("nodes.nodeUpdateAvailable", "Update available")}
						</Tag>
					)}
				</HStack>
			</Stack>

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
							{t("nodes.manageNodesHeader", "Node list")}
						</Text>
						<HStack spacing={2} flexWrap="wrap">
							<Tag size="sm" colorScheme="gray" variant="subtle">
								{t("nodes.summaryTotal", "Total")}: {nodeSummary.total}
							</Tag>
							<Tag size="sm" colorScheme="green" variant="subtle">
								{t("nodes.summaryConnected", "Connected")}:{" "}
								{nodeSummary.connected}
							</Tag>
							<Tag size="sm" colorScheme="gray" variant="subtle">
								{t("nodes.summaryDisabled", "Disabled")}:{" "}
								{nodeSummary.disabled}
							</Tag>
						</HStack>
					</VStack>
					<SimpleGrid
						columns={{ base: 1, sm: 2, lg: 4 }}
						spacing={2}
						w={{ base: "full", xl: "auto" }}
						minW={{ xl: "590px" }}
						maxW={{ xl: "720px" }}
					>
						<Button
							leftIcon={<TutorialIconStyled />}
							variant="outline"
							size="sm"
							w="full"
							onClick={() =>
								navigate("/tutorials?focus=section-nodes-admin-guide")
							}
						>
							{t("nodes.nodeTutorial", "Node tutorial")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							leftIcon={<CoreIconStyled />}
							w="full"
							onClick={() => setVersionDialogTarget({ type: "bulk" })}
							isDisabled={!hasConnectedNodes || !hostActionsAvailable}
						>
							{t("nodes.updateAllNodesCore")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							leftIcon={<DownloadIconStyled />}
							w="full"
							onClick={handleUpdateAllNodeServices}
							isLoading={updatingBulkService}
							isDisabled={
								!hostActionsAvailable || !hasBinaryNodes || updatingBulkService
							}
						>
							{t("nodes.updateAllNodeServices", "Update all node services")}
						</Button>
						<Button
							leftIcon={<AddIconStyled />}
							colorScheme="primary"
							size="sm"
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
						direction={{ base: "column", md: "row" }}
						spacing={2}
						align={{ base: "stretch", md: "center" }}
						flex="1"
						flexWrap="wrap"
					>
						<InputGroup size="sm" w={{ base: "full", md: "260px", xl: "280px" }}>
							<InputLeftElement pointerEvents="none">
								<SearchIcon color="gray.400" />
							</InputLeftElement>
							<Input
								value={searchTerm}
								onChange={(event) => setSearchTerm(event.target.value)}
								placeholder={t("nodes.searchPlaceholder", "Search nodes")}
							/>
						</InputGroup>
						<Select
							size="sm"
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							w={{ base: "full", md: "150px" }}
						>
							<option value="all">{t("nodes.filters.allStatuses", "All status")}</option>
							<option value="connected">{t("status.connected", "Connected")}</option>
							<option value="connecting">{t("status.connecting", "Connecting")}</option>
							<option value="error">{t("status.error", "Error")}</option>
							<option value="disabled">{t("status.disabled", "Disabled")}</option>
							<option value="limited">{t("status.limited", "Limited")}</option>
						</Select>
						<Select
							size="sm"
							value={installModeFilter}
							onChange={(event) => setInstallModeFilter(event.target.value)}
							w={{ base: "full", md: "150px" }}
						>
							<option value="all">{t("nodes.filters.allModes", "All modes")}</option>
							<option value="binary">{t("nodes.installMode.binary", "Binary")}</option>
							<option value="docker">{t("nodes.installMode.docker", "Docker")}</option>
							<option value="unknown">{t("nodes.installMode.unknown", "Unknown")}</option>
						</Select>
						<Select
							size="sm"
							value={`${sortKey}.${sortDirection}`}
							onChange={(event) => {
								const [nextKey, nextDirection] = event.target.value.split(".");
								setSortKey(nextKey as NodeSortKey);
								setSortDirection(nextDirection as NodeSortDirection);
							}}
							w={{ base: "full", md: "170px" }}
						>
							<option value="name.asc">{t("nodes.sort.nameAsc", "Name A-Z")}</option>
							<option value="name.desc">{t("nodes.sort.nameDesc", "Name Z-A")}</option>
							<option value="usage.asc">{t("nodes.sort.usageAsc", "Usage low-high")}</option>
							<option value="usage.desc">{t("nodes.sort.usageDesc", "Usage high-low")}</option>
							<option value="status.asc">{t("nodes.sort.statusAsc", "Status A-Z")}</option>
							<option value="status.desc">{t("nodes.sort.statusDesc", "Status Z-A")}</option>
							<option value="bandwidth.asc">{t("nodes.sort.bandwidthAsc", "Bandwidth low-high")}</option>
							<option value="bandwidth.desc">{t("nodes.sort.bandwidthDesc", "Bandwidth high-low")}</option>
							<option value="cpu.asc">{t("nodes.sort.cpuAsc", "CPU low-high")}</option>
							<option value="cpu.desc">{t("nodes.sort.cpuDesc", "CPU high-low")}</option>
							<option value="ram.asc">{t("nodes.sort.ramAsc", "RAM low-high")}</option>
							<option value="ram.desc">{t("nodes.sort.ramDesc", "RAM high-low")}</option>
						</Select>
					</Stack>
					<HStack
						spacing={1.5}
						flexWrap="wrap"
						justify={{ base: "flex-start", xl: "flex-end" }}
					>
						<Checkbox
							size="sm"
							isChecked={allPageSelected}
							isIndeterminate={somePageSelected}
							onChange={(event) =>
								toggleCurrentPageSelection(event.target.checked)
							}
						>
							{t("nodes.selectPage", "Select page")}
						</Checkbox>
						<Button
							size="sm"
							variant="outline"
							onClick={selectAllFilteredNodes}
							isDisabled={filteredNodeIds.length === 0 || allFilteredSelected}
						>
							{t("nodes.selectAllFiltered", "Select all")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={deselectAllNodes}
							isDisabled={selectedNodeIds.length === 0}
						>
							{t("nodes.deselectAll", "Deselect all")}
						</Button>
						<Tooltip label={t("nodes.refreshNodes", "Refresh nodes")}>
							<IconButton
								aria-label={t("nodes.refreshNodes", "Refresh nodes")}
								icon={<ArrowPathIconStyled />}
								variant="ghost"
								size="sm"
								onClick={() => refetchNodes()}
								isLoading={isFetching}
							/>
						</Tooltip>
						<ButtonGroup size="sm" isAttached variant="outline">
							<Tooltip label={t("nodes.viewList", "List view")}>
								<IconButton
									aria-label={t("nodes.viewList", "List view")}
									icon={<ListViewIcon />}
									variant={viewMode === "list" ? "solid" : "outline"}
									colorScheme={viewMode === "list" ? "primary" : undefined}
									onClick={() => setViewMode("list")}
								/>
							</Tooltip>
							<Tooltip label={t("nodes.viewGrid", "Grid view")}>
								<IconButton
									aria-label={t("nodes.viewGrid", "Grid view")}
									icon={<GridViewIcon />}
									variant={viewMode === "grid" ? "solid" : "outline"}
									colorScheme={viewMode === "grid" ? "primary" : undefined}
									onClick={() => setViewMode("grid")}
								/>
							</Tooltip>
						</ButtonGroup>
					</HStack>
				</Stack>
			</Stack>

			{!hostActionsAvailable && (
				<Alert status="warning" variant="subtle" borderRadius="md">
					<AlertIcon />
					<AlertDescription>
						{t(
							"nodes.binaryMigrationRequired",
							"Core, geo, restart, and update actions are disabled in Docker mode. Migrate the panel and nodes to binary mode to use host-level controls from the web UI.",
						)}
					</AlertDescription>
				</Alert>
			)}

			{selectedNodeIds.length > 0 && (
				<Stack
					direction={{ base: "column", xl: "row" }}
					align={{ base: "stretch", xl: "center" }}
					justify="space-between"
					spacing={3}
					borderWidth="1px"
					borderColor={nodePanelBorder}
					borderRadius="md"
					bg={nodePanelBg}
					p={3}
				>
					<VStack align="flex-start" spacing={1}>
						<Text fontWeight="semibold">
							{t("nodes.selectedCount", {
								defaultValue: "{{count}} nodes selected",
								count: selectedNodeIds.length,
							})}
						</Text>
						<HStack spacing={2} flexWrap="wrap">
							<Button
								size="xs"
								variant="link"
								onClick={selectAllFilteredNodes}
								isDisabled={allFilteredSelected}
							>
								{t("nodes.selectAllFiltered", "Select all")}
							</Button>
							<Button size="xs" variant="link" onClick={deselectAllNodes}>
								{t("nodes.deselectAll", "Deselect all")}
							</Button>
						</HStack>
					</VStack>
					<HStack spacing={2} flexWrap="wrap" justify={{ base: "flex-start", xl: "flex-end" }}>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<EnableIconStyled />}
							onClick={() =>
								openBulkActionConfirm("bulk-enable", selectableSelectedNodes())
							}
							isDisabled={Boolean(bulkNodeActionLoading)}
						>
							{t("nodes.enableNode", "Enable node")}
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
							{t("nodes.disableNode", "Disable node")}
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
							{t("nodes.resetUsage", "Reset usage")}
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
							{t("nodes.updateServiceAction", "Update node service")}
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
							{t("nodes.updateCoreAction", "Update core")}
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
							{t("nodes.updateGeoAction", "Update geo")}
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
							{t("delete", "Delete")}
						</Button>
					</HStack>
				</Stack>
			)}

			{isLoading ? (
				<SimpleGrid columns={nodeGridColumns} spacing={4}>
					{Array.from({ length: 3 }, (_, idx) => `nodes-skeleton-${idx}`).map(
						(skeletonKey) => (
							<Box
								key={skeletonKey}
								bg={nodeCardBg}
								borderWidth="1px"
								borderColor={nodeCardBorder}
								borderRadius="lg"
								p={6}
								boxShadow="sm"
								display="flex"
								alignItems="center"
								justifyContent="center"
							>
								<VStack spacing={3}>
									<Spinner />
									<Text
										fontSize="sm"
										color="gray.500"
										_dark={{ color: "gray.400" }}
									>
										{t("loading")}
									</Text>
								</VStack>
							</Box>
						),
					)}
				</SimpleGrid>
			) : viewMode === "list" ? (
				<Box
					w="full"
					bg={nodeCardBg}
					borderWidth="1px"
					borderColor={nodeCardBorder}
					borderRadius="lg"
					boxShadow="sm"
					overflowX={{ base: "auto", xl: "hidden" }}
				>
					<Table
						size="sm"
						variant="simple"
						w="full"
						minW={{ base: "1120px", xl: "100%" }}
						sx={{
							tableLayout: { base: "auto", xl: "fixed" },
							"& th, & td": {
								px: { base: 3, xl: 2 },
								py: { base: 3, xl: 2.5 },
								verticalAlign: "middle",
							},
							"& th:first-of-type, & td:first-of-type": {
								px: { base: 2, xl: 1.5 },
							},
						}}
					>
						<Thead bg={nodePanelBg}>
							<Tr>
								<Th w={{ base: "40px", xl: "34px" }}>
									<Checkbox
										isChecked={allPageSelected}
										isIndeterminate={somePageSelected}
										onChange={(event) =>
											toggleCurrentPageSelection(event.target.checked)
										}
										aria-label={t(
											"nodes.selectCurrentPage",
											"Select current page",
										)}
									/>
								</Th>
								<Th
									w={{ base: "190px", xl: "13%" }}
									cursor="pointer"
									onClick={() => handleSort("name")}
								>
									{sortLabel("name", t("nodes.columns.name", "Name"))}
								</Th>
								<Th
									w={{ base: "110px", xl: "8%" }}
									cursor="pointer"
									onClick={() => handleSort("status")}
								>
									{sortLabel("status", t("nodes.columns.status", "Status"))}
								</Th>
								<Th w={{ base: "130px", xl: "10%" }}>{t("nodes.columns.address", "Address")}</Th>
								<Th w={{ base: "110px", xl: "7%" }}>
									{t("nodes.columns.xrayVersion", "Xray version")}
								</Th>
								<Th w={{ base: "130px", xl: "10%" }}>
									{t("nodes.columns.nodeRuntime", "Node / install")}
								</Th>
								<Th
									w={{ base: "110px", xl: "8%" }}
									cursor="pointer"
									onClick={() => handleSort("uptime")}
								>
									{sortLabel("uptime", t("nodes.columns.uptime", "Uptime"))}
								</Th>
								<Th
									w={{ base: "140px", xl: "10%" }}
									cursor="pointer"
									onClick={() => handleSort("usage")}
								>
									{sortLabel(
										"usage",
										t("nodes.columns.trafficLimit", "Traffic / Limit"),
									)}
								</Th>
								<Th
									w={{ base: "135px", xl: "10%" }}
									cursor="pointer"
									onClick={() => handleSort("bandwidth")}
								>
									{sortLabel(
										"bandwidth",
										t("nodes.columns.bandwidth", "Upload / Download"),
									)}
								</Th>
								<Th
									w={{ base: "95px", xl: "7%" }}
									cursor="pointer"
									onClick={() => handleSort("cpu")}
								>
									{sortLabel("cpu", t("nodes.columns.cpu", "CPU"))}
								</Th>
								<Th
									w={{ base: "120px", xl: "9%" }}
									cursor="pointer"
									onClick={() => handleSort("ram")}
								>
									{sortLabel("ram", t("nodes.columns.ram", "RAM"))}
								</Th>
								<Th w={{ base: "145px", xl: "8%" }}>
									{t("nodes.columns.certificate", "Certificate")}
								</Th>
							</Tr>
						</Thead>
						<Tbody>
							{paginatedNodes.map((node) => {
								const status = node.status || "error";
								const nodeId = node?.id as number | undefined;
								const isEnabled = status !== "disabled" && status !== "limited";
								const pending =
									nodeId != null ? pendingStatus[nodeId] : undefined;
								const displayEnabled = pending ?? isEnabled;
								const isToggleLoading =
									nodeId != null && togglingNodeId === nodeId && isToggling;
								const isCoreUpdating =
									nodeId != null && updatingCoreNodeId === nodeId;
								const isGeoUpdating =
									nodeId != null && updatingGeoNodeId === nodeId;
								const isRestartingMaintenance =
									isRestartingService &&
									nodeId != null &&
									restartingServiceNodeId === nodeId;
								const isUpdatingMaintenance =
									isUpdatingService &&
									nodeId != null &&
									updatingServiceNodeId === nodeId;
								const nodeHostActionsAvailable =
									hostActionsAvailable && node.node_install_mode === "binary";
								const nodeRuntimeVersion = getNodeRuntimeVersion(node);
								const nodeRuntimeDisplayVersion =
									getNodeRuntimeDisplayVersion(node);
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
								const totalUsage = (node.uplink ?? 0) + (node.downlink ?? 0);
								const nodeInstallLabel =
									[node.node_install_mode, node.node_update_channel]
										.filter(Boolean)
										.join(" / ") || EMPTY_CELL_VALUE;
								const nodeTrafficLimitDisplay = `${formatNodeBytes(
									totalUsage,
									2,
								)} / ${
									node.data_limit != null && node.data_limit > 0
										? formatNodeLimit(node.data_limit)
										: "∞"
								}`;
								const nodeRemainingDataDisplay =
									node.data_limit != null && node.data_limit > 0
										? formatNodeBytes(
												Math.max(node.data_limit - totalUsage, 0),
												2,
											)
										: null;
								const nodeCPUDisplay = formatNodePercent(
									node.cpu_usage_percent,
								);
								const nodeCPUHelper = formatCPUFrequency(
									node.cpu_frequency_hz,
								);
								const nodeRAMDisplay = `${formatNodeBytes(
									node.memory_used,
									2,
								)} / ${formatNodeBytes(node.memory_total, 2)}`;
								const nodeRAMHelper = formatNodePercent(
									node.memory_usage_percent,
								);
								const nodeBandwidthDisplay = `${formatNodeSpeed(
									node.upload_speed,
								)} / ${formatNodeSpeed(node.download_speed)}`;
								const nodeUptimeDisplay = formatNodeUptime(
									node.uptime_seconds,
								);
								const certificateCopyValue = getNodeInstallBundle(node);
								const statusBadge = (
									<NodeModalStatusBadge status={status} compact />
								);
								const statusDisplay =
									status === "error" && node.message ? (
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
									) : (
										statusBadge
									);

								return (
									<Tr key={node.id ?? node.name}>
										<Td>
											{nodeId != null && (
												<Checkbox
													isChecked={selectedNodeIdSet.has(nodeId)}
													onChange={(event) =>
														toggleNodeSelection(
															nodeId,
															event.target.checked,
														)
													}
													aria-label={t("nodes.selectNode", {
														defaultValue: "Select {{name}}",
														name:
															node.name ||
															node.address ||
															t("nodes.thisNode", "this node"),
													})}
												/>
											)}
										</Td>
										<Td>
											<HStack align="center" spacing={1.5} minW={0}>
												<Menu
													placement="bottom-start"
													strategy="fixed"
													autoSelect={false}
												>
													<MenuButton
														as={IconButton}
														size="xs"
														variant="ghost"
														aria-label={t("nodes.actions", "Node actions")}
														icon={<MoreIconStyled />}
														flexShrink={0}
													/>
													<Portal>
														<MenuList
															minW="240px"
															maxW="calc(100vw - 24px)"
															maxH="min(70vh, 420px)"
															overflowY="auto"
														>
															<MenuItem
																icon={<EditIconStyled />}
																onClick={() => setEditingNode(node)}
															>
																{t("edit")}
															</MenuItem>
															<MenuItem
																icon={
																	displayEnabled ? (
																		<DisableIconStyled />
																	) : (
																		<EnableIconStyled />
																	)
																}
																onClick={() => handleToggleNode(node)}
																isDisabled={!nodeId || isToggleLoading}
															>
																{displayEnabled
																	? t("nodes.disableNode", "Disable node")
																	: t("nodes.enableNode", "Enable node")}
															</MenuItem>
															{node.status === "error" && (
																<MenuItem
																	icon={<ArrowPathIconStyled />}
																	onClick={() => reconnect(node)}
																	isDisabled={isReconnecting}
																>
																	{t("nodes.reconnect")}
																</MenuItem>
															)}
															<MenuItem
																icon={<CoreIconStyled />}
																onClick={() =>
																	nodeId &&
																	setVersionDialogTarget({
																		type: "node",
																		node,
																	})
																}
																isDisabled={
																	!nodeId ||
																	!nodeHostActionsAvailable ||
																	isCoreUpdating
																}
															>
																{t("nodes.updateCoreAction")}
															</MenuItem>
															<MenuItem
																icon={<GeoIconStyled />}
																onClick={() =>
																	nodeId &&
																	setGeoDialogTarget({ type: "node", node })
																}
																isDisabled={
																	!nodeId ||
																	!nodeHostActionsAvailable ||
																	isGeoUpdating
																}
															>
																{t("nodes.updateGeoAction", "Update geo")}
															</MenuItem>
															<MenuItem
																icon={<ServiceIconStyled />}
																onClick={() => handleRestartNodeService(node)}
																isDisabled={
																	!nodeId ||
																	!nodeHostActionsAvailable ||
																	isRestartingMaintenance
																}
															>
																{t(
																	"nodes.restartServiceAction",
																	"Restart node service",
																)}
															</MenuItem>
															<MenuItem
																icon={<DownloadIconStyled />}
																onClick={() => handleUpdateNodeService(node)}
																isDisabled={
																	!nodeId ||
																	!nodeHostActionsAvailable ||
																	isUpdatingMaintenance
																}
															>
																{t(
																	"nodes.updateServiceAction",
																	"Update node service",
																)}
															</MenuItem>
															<MenuItem
																icon={<ArrowPathIconStyled />}
																color="red.500"
																onClick={() => handleResetNodeUsage(node)}
																isDisabled={!nodeId}
															>
																{t("nodes.resetUsage", "Reset usage")}
															</MenuItem>
															{node.uses_default_certificate && (
																<MenuItem
																	icon={<CertificateIconStyled />}
																	onClick={() =>
																		nodeId && regenerateNodeCertMutate(node)
																	}
																	isDisabled={
																		!nodeId ||
																		(isRegenerating &&
																			nodeId != null &&
																			regeneratingNodeId === nodeId)
																	}
																>
																	{t(
																		"nodes.generatePrivateCert",
																		"Generate private certificate",
																	)}
																</MenuItem>
															)}
															<MenuItem
																icon={<DeleteIconStyled />}
																color="red.500"
																onClick={() => handleDeleteNodeRequest(node)}
																isDisabled={isDeletingNode}
															>
																{t("delete")}
															</MenuItem>
														</MenuList>
													</Portal>
												</Menu>
												<VStack align="flex-start" spacing={0.5} minW={0} flex="1">
													<HStack spacing={2} align="center" flexWrap="wrap">
														<Text
															fontWeight="semibold"
															maxW={{ base: "160px", xl: "120px", "2xl": "150px" }}
															noOfLines={2}
															wordBreak="break-word"
														>
															{node.name ||
																t("nodes.unnamedNode", "Unnamed node")}
														</Text>
													</HStack>
													<Text fontSize="xs" color="gray.500" lineHeight="short">
														{t("nodes.id", "ID")}: {node.id ?? EMPTY_CELL_VALUE}
													</Text>
													{node.note && (
														<Text
															fontSize="xs"
															color="gray.500"
															maxW={{ base: "170px", xl: "125px", "2xl": "150px" }}
															noOfLines={2}
															wordBreak="break-word"
														>
															{node.note}
														</Text>
													)}
												</VStack>
											</HStack>
										</Td>
										<Td>{statusDisplay}</Td>
										<Td>
											<Tooltip label={t("copy", "Copy")}>
												<Text
													as="button"
													type="button"
													dir="ltr"
													sx={{ unicodeBidi: "isolate" }}
													cursor="pointer"
													textAlign="start"
													maxW="full"
													noOfLines={1}
													_hover={{ color: "primary.500" }}
													onClick={() =>
														copyToClipboard(
															node.address,
															t("nodes.nodeAddress", "Address"),
														)
													}
												>
													{formatCellValue(node.address)}
												</Text>
											</Tooltip>
										</Td>
										<Td>
											<Tag
												as="button"
												type="button"
												colorScheme="blue"
												size="sm"
												cursor="pointer"
												_hover={{ opacity: 0.82 }}
												onClick={() =>
													nodeId &&
													setVersionDialogTarget({ type: "node", node })
												}
											>
												{node.xray_version
													? `Xray ${node.xray_version}`
													: t("nodes.versionUnknown", "Version unknown")}
											</Tag>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<Tag colorScheme="green" size="sm">
													{nodeRuntimeDisplayVersion
														? t("nodes.nodeServiceVersionTag", {
																version: nodeRuntimeDisplayVersion,
															})
														: t(
																"nodes.nodeServiceVersionUnknown",
														"Node version unknown",
															)}
												</Tag>
												<Text fontSize="xs" color="gray.500" noOfLines={1}>
													{nodeInstallLabel}
												</Text>
												{nodeServiceUpdateAvailable && (
													<Button
														size="xs"
														variant="link"
														colorScheme="orange"
														leftIcon={<DownloadIconStyled />}
														onClick={() => handleUpdateNodeService(node)}
														isLoading={isUpdatingMaintenance}
														isDisabled={!nodeId || !nodeHostActionsAvailable}
													>
														{t("nodes.updateAvailable", "Update available")}
													</Button>
												)}
											</VStack>
										</Td>
										<Td>
											<Text fontWeight="medium" fontSize="sm" lineHeight="short">
												{nodeUptimeDisplay}
											</Text>
										</Td>
										<Td>
											<NodeMetricDisplay
												value={nodeTrafficLimitDisplay}
												helper={
													nodeRemainingDataDisplay
														? `${t(
																"nodes.remainingData",
																"Remaining data",
															)}: ${nodeRemainingDataDisplay}`
														: null
												}
												colorScheme="green"
											/>
										</Td>
										<Td>
											<NodeMetricDisplay value={nodeBandwidthDisplay} />
										</Td>
										<Td>
											<NodeMetricDisplay
												value={nodeCPUDisplay}
												helper={nodeCPUHelper}
												percent={node.cpu_usage_percent}
												colorScheme="orange"
											/>
										</Td>
										<Td>
											<NodeMetricDisplay
												value={nodeRAMDisplay}
												helper={nodeRAMHelper}
												percent={node.memory_usage_percent}
												colorScheme="purple"
											/>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<HStack
													spacing={1}
													maxW="full"
													flexWrap="nowrap"
													role={certificateCopyValue ? "button" : undefined}
													tabIndex={certificateCopyValue ? 0 : undefined}
													cursor={certificateCopyValue ? "pointer" : "default"}
													onClick={() =>
														copyToClipboard(
															certificateCopyValue,
															t("nodes.certificateLabel", "Certificate"),
														)
													}
													onKeyDown={(event) => {
														if (
															certificateCopyValue &&
															(event.key === "Enter" || event.key === " ")
														) {
															event.preventDefault();
															copyToClipboard(
																certificateCopyValue,
																t("nodes.certificateLabel", "Certificate"),
															);
														}
													}}
												>
													<Tag
														size="sm"
														flexShrink={1}
														minW={0}
														maxW="88px"
														colorScheme={
															node.uses_default_certificate
																? "orange"
																: node.has_custom_certificate
																	? "green"
																	: "gray"
														}
													>
														{node.uses_default_certificate
															? t("nodes.legacyCertificate", "Legacy shared")
															: node.has_custom_certificate
																? t("nodes.privateCertificate", "Private")
																: EMPTY_CELL_VALUE}
													</Tag>
													<IconButton
														aria-label={t("copy", "Copy")}
														icon={<CopyIconStyled />}
														size="xs"
														variant="ghost"
														isDisabled={!certificateCopyValue}
														pointerEvents="none"
														flexShrink={0}
													/>
												</HStack>
												{node.certificate_public_key && (
													<Tooltip label={node.certificate_public_key}>
														<Text
															as="button"
															type="button"
															fontSize="xs"
															color="gray.500"
															noOfLines={1}
															maxW="full"
															cursor="pointer"
															textAlign="start"
															onClick={() =>
																copyToClipboard(
																	certificateCopyValue,
																	t("nodes.certificateLabel", "Certificate"),
																)
															}
														>
															{node.certificate_public_key}
														</Text>
													</Tooltip>
												)}
											</VStack>
										</Td>
									</Tr>
								);
							})}
							{filteredNodes.length === 0 && (
								<Tr>
									<Td colSpan={12}>
										<Text
											fontSize="sm"
											color="gray.500"
											_dark={{ color: "gray.400" }}
											textAlign="center"
											py={6}
										>
											{t(
												"nodes.noNodesFound",
												"No nodes match the current filters.",
											)}
										</Text>
									</Td>
								</Tr>
							)}
						</Tbody>
					</Table>
				</Box>
			) : (
				<SimpleGrid columns={nodeGridColumns} spacing={4}>
					{filteredNodes.length > 0 ? (
						paginatedNodes.map((node) => {
							const status = node.status || "error";
							const nodeId = node?.id as number | undefined;
							const isEnabled = status !== "disabled" && status !== "limited";
							const pending =
								nodeId != null ? pendingStatus[nodeId] : undefined;
							const displayEnabled = pending ?? isEnabled;
							const isToggleLoading =
								nodeId != null && togglingNodeId === nodeId && isToggling;
							const isCoreUpdating =
								nodeId != null && updatingCoreNodeId === nodeId;
							const isGeoUpdating =
								nodeId != null && updatingGeoNodeId === nodeId;
							const isRestartingMaintenance =
								isRestartingService &&
								nodeId != null &&
								restartingServiceNodeId === nodeId;
							const isUpdatingMaintenance =
								isUpdatingService &&
								nodeId != null &&
								updatingServiceNodeId === nodeId;
							const nodeHostActionsAvailable =
								hostActionsAvailable && node.node_install_mode === "binary";
							const nodeRuntimeDisplayVersion =
								getNodeRuntimeDisplayVersion(node);
							const nodeInstallLabel =
								[node.node_install_mode, node.node_update_channel]
									.filter(Boolean)
									.join(" / ") || "-";
							const nodeTotalUsage = (node.uplink ?? 0) + (node.downlink ?? 0);
							const nodeTrafficLimitDisplay = `${formatNodeBytes(
								nodeTotalUsage,
								2,
							)} / ${
								node.data_limit != null && node.data_limit > 0
									? formatNodeLimit(node.data_limit)
									: "∞"
							}`;
							const nodeCPUDisplay = formatNodePercent(
								node.cpu_usage_percent,
							);
							const nodeCPUHelper = formatCPUFrequency(node.cpu_frequency_hz);
							const nodeRAMDisplay = `${formatNodeBytes(
								node.memory_used,
								2,
							)} / ${formatNodeBytes(node.memory_total, 2)}`;
							const nodeRAMHelper = formatNodePercent(
								node.memory_usage_percent,
							);
							const nodeBandwidthDisplay = `${formatNodeSpeed(
								node.upload_speed,
							)} / ${formatNodeSpeed(node.download_speed)}`;
							const nodeUptimeDisplay = formatNodeUptime(node.uptime_seconds);
							const statusBadge = (
								<NodeModalStatusBadge status={status} compact />
							);
							const statusDisplay =
								status === "error" && node.message ? (
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
								) : (
									statusBadge
								);
							const nodeContent = (
								<VStack align="stretch" spacing={4}>
									<Stack spacing={2}>
										<HStack spacing={3} align="center" flexWrap="wrap">
											{nodeId != null && (
												<Checkbox
													isChecked={selectedNodeIdSet.has(nodeId)}
													onChange={(event) =>
														toggleNodeSelection(
															nodeId,
															event.target.checked,
														)
													}
													aria-label={t("nodes.selectNode", {
														defaultValue: "Select {{name}}",
														name:
															node.name ||
															node.address ||
															t("nodes.thisNode", "this node"),
													})}
												/>
											)}
											<Text
												fontWeight="semibold"
												fontSize="lg"
												noOfLines={2}
												wordBreak="break-word"
												minW={0}
											>
												{node.name || t("nodes.unnamedNode", "Unnamed node")}
											</Text>
											{statusDisplay}
											<Switch
												size="sm"
												colorScheme="primary"
												isChecked={displayEnabled}
												onChange={() => handleToggleNode(node)}
												isDisabled={isToggleLoading}
												aria-label={t(
													"nodes.toggleAvailability",
													"Toggle node availability",
												)}
											/>
											{node.status === "error" && (
												<Button
													size="sm"
													variant="outline"
													leftIcon={<ArrowPathIconStyled />}
													onClick={() => reconnect(node)}
													isLoading={isReconnecting}
												>
													{t("nodes.reconnect")}
												</Button>
											)}
										</HStack>
										{node.note && (
											<Text
												fontSize="sm"
												color="gray.500"
												noOfLines={3}
												wordBreak="break-word"
											>
												{node.note}
											</Text>
										)}
										<HStack spacing={2} flexWrap="wrap">
											<Tag colorScheme="blue" size="sm">
												{node.xray_version
													? `Xray ${node.xray_version}`
													: t("nodes.versionUnknown", "Version unknown")}
											</Tag>
											<Button
												size="xs"
												variant="ghost"
												colorScheme="primary"
												onClick={() =>
													nodeId &&
													setVersionDialogTarget({ type: "node", node })
												}
												isLoading={isCoreUpdating}
												isDisabled={!nodeId || !nodeHostActionsAvailable}
											>
												{t("nodes.updateCoreAction")}
											</Button>
											<Button
												size="xs"
												variant="ghost"
												onClick={() =>
													nodeId && setGeoDialogTarget({ type: "node", node })
												}
												isLoading={isGeoUpdating}
												isDisabled={!nodeId || !nodeHostActionsAvailable}
											>
												{t("nodes.updateGeoAction", "Update geo")}
											</Button>
											<Button
												size="xs"
												variant="ghost"
												colorScheme="orange"
												onClick={() => handleRestartNodeService(node)}
												isLoading={isRestartingMaintenance}
												isDisabled={!nodeId || !nodeHostActionsAvailable}
											>
												{t(
													"nodes.restartServiceAction",
													"Restart node service",
												)}
											</Button>
											<Button
												size="xs"
												variant="ghost"
												colorScheme="teal"
												onClick={() => handleUpdateNodeService(node)}
												isLoading={isUpdatingMaintenance}
												isDisabled={!nodeId || !nodeHostActionsAvailable}
											>
												{t("nodes.updateServiceAction", "Update node service")}
											</Button>
											<Button
												size="xs"
												variant="ghost"
												colorScheme="red"
												onClick={() => handleResetNodeUsage(node)}
												isLoading={
													isResettingUsage &&
													nodeId != null &&
													resettingNodeId === nodeId
												}
												isDisabled={!nodeId}
											>
												{t("nodes.resetUsage", "Reset usage")}
											</Button>
										</HStack>
										{status === "limited" && (
											<Text fontSize="sm" color="red.500">
												{t(
													"nodes.limitedStatusDescription",
													"This node is limited because its data limit is exhausted. Increase the limit or reset usage to reconnect it.",
												)}
											</Text>
										)}
										{node.uses_default_certificate && (
											<Alert
												status="warning"
												borderRadius="md"
												alignItems="flex-start"
												gap={3}
												textAlign="start"
											>
												<AlertIcon mt={0.5} />
												<Box>
													<Text
														fontWeight="semibold"
														fontSize="sm"
														lineHeight="short"
													>
														{t(
															"nodes.legacyCertCardTitle",
															"Legacy shared certificate in use",
														)}
													</Text>
													<Text fontSize="xs" lineHeight="short">
														{t(
															"nodes.legacyCertCardDesc",
															"Generate a private certificate for this node and reinstall it on the node host.",
														)}
													</Text>
													<Button
														size="xs"
														mt={2}
														colorScheme="primary"
														onClick={() =>
															nodeId && regenerateNodeCertMutate(node)
														}
														isLoading={
															isRegenerating &&
															nodeId != null &&
															regeneratingNodeId === nodeId
														}
														isDisabled={!nodeId}
														alignSelf="flex-start"
													>
														{t(
															"nodes.generatePrivateCert",
															"Generate private certificate",
														)}
													</Button>
												</Box>
											</Alert>
										)}
									</Stack>

									<Divider />
									<SimpleGrid
										columns={{ base: 1, sm: 2, lg: 3 }}
										spacingY={2}
										spacingX={3}
									>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.nodeAddress")}
											</Text>
											<Tooltip label={t("copy", "Copy")}>
												<Text
													as="button"
													type="button"
													fontWeight="medium"
													textAlign="start"
													cursor="pointer"
													_hover={{ color: "primary.500" }}
													onClick={() =>
														copyToClipboard(
															node.address,
															t("nodes.nodeAddress", "Address"),
														)
													}
												>
													{node.address}
												</Text>
											</Tooltip>
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.runtime", "Runtime")}
											</Text>
											<Text fontWeight="medium" lineHeight="short">
												{nodeRuntimeDisplayVersion
													? t("nodes.nodeServiceVersionTag", {
															version: nodeRuntimeDisplayVersion,
														})
													: t(
															"nodes.nodeServiceVersionUnknown",
															"Node version unknown",
														)}
											</Text>
											<Text fontSize="xs" color="gray.500">
												{nodeInstallLabel}
											</Text>
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.uptime", "Uptime")}
											</Text>
											<Text fontWeight="medium">{nodeUptimeDisplay}</Text>
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.trafficLimit", "Traffic / Limit")}
											</Text>
											<NodeMetricDisplay
												value={nodeTrafficLimitDisplay}
												colorScheme="green"
											/>
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.bandwidthSpeed", "Upload / Download")}
											</Text>
											<NodeMetricDisplay value={nodeBandwidthDisplay} />
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.cpu", "CPU")}
											</Text>
											<NodeMetricDisplay
												value={nodeCPUDisplay}
												helper={nodeCPUHelper}
												percent={node.cpu_usage_percent}
												colorScheme="orange"
											/>
										</Box>
										<Box p={3} borderWidth="1px" borderRadius="md">
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.ram", "RAM")}
											</Text>
											<NodeMetricDisplay
												value={nodeRAMDisplay}
												helper={nodeRAMHelper}
												percent={node.memory_usage_percent}
												colorScheme="purple"
											/>
										</Box>
									</SimpleGrid>
									<Divider />
									<HStack
										justify="space-between"
										align="center"
										flexWrap="wrap"
										gap={2}
									>
										<Text
											fontSize="xs"
											color="gray.500"
											_dark={{ color: "gray.400" }}
										>
											{t("nodes.id", "ID")}: {node.id ?? "-"}
										</Text>
										<ButtonGroup size="sm" variant="ghost">
											<IconButton
												aria-label={t("edit")}
												icon={<EditIconStyled />}
												onClick={() => setEditingNode(node)}
											/>
											<IconButton
												aria-label={t("delete")}
												icon={<DeleteIconStyled />}
												colorScheme="red"
												onClick={() => handleDeleteNodeRequest(node)}
												isDisabled={isDeletingNode}
											/>
										</ButtonGroup>
									</HStack>
								</VStack>
							);

							return (
								<Box
									key={node.id ?? node.name}
									bg={nodeCardBg}
									borderWidth="1px"
									borderColor={nodeCardBorder}
									borderRadius="lg"
									p={6}
									boxShadow="sm"
									_hover={{ boxShadow: "md" }}
									transition="box-shadow 0.2s ease-in-out"
								>
									{nodeContent}
								</Box>
							);
						})
					) : (
						<Box
							bg={nodeCardBg}
							borderWidth="1px"
							borderColor={nodeCardBorder}
							borderRadius="lg"
							p={6}
							boxShadow="sm"
							display="flex"
							alignItems="center"
							justifyContent="center"
						>
							<Text
								fontSize="sm"
								color="gray.500"
								_dark={{ color: "gray.400" }}
								textAlign="center"
							>
								{t("nodes.noNodesFound", "No nodes match the current filters.")}
							</Text>
						</Box>
					)}
				</SimpleGrid>
			)}

			{filteredNodes.length > 0 && (
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
						{t("nodes.paginationSummary", {
							defaultValue: "Showing {{start}}-{{end}} of {{total}} nodes",
							start: paginationStart,
							end: paginationEnd,
							total: filteredNodes.length,
						})}
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
								{t("previous", "Previous")}
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
								{t("next", "Next")}
							</Button>
						</ButtonGroup>
					</HStack>
				</Stack>
			)}

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
			<ConfirmActionDialog
				isOpen={Boolean(serviceActionConfirm)}
				onClose={closeServiceActionConfirm}
				onConfirm={confirmServiceAction}
				title={serviceActionConfirmTitle}
				message={serviceActionConfirmMessage}
				confirmLabel={serviceActionConfirmLabel}
				cancelLabel={t("cancel", "Cancel")}
				colorScheme={
					serviceActionConfirm?.type === "restart"
						? "orange"
						: serviceActionConfirm?.type === "bulk-delete" ||
								serviceActionConfirm?.type === "bulk-reset"
							? "red"
							: "blue"
				}
				isLoading={serviceActionConfirmLoading}
			/>
			<AlertDialog
				isOpen={isDeleteConfirmOpen}
				leastDestructiveRef={cancelDeleteRef}
				onClose={handleCloseDeleteConfirm}
			>
				<AlertDialogOverlay>
					<AlertDialogContent
						onKeyDown={(event) => {
							if (event.key !== "Enter" || isDeletingNode || !deleteCandidate) {
								return;
							}
							event.preventDefault();
							confirmDeleteNode();
						}}
					>
						<AlertDialogHeader fontSize="lg" fontWeight="bold">
							{t("delete")}
						</AlertDialogHeader>

						<AlertDialogBody>
							{t("deleteNode.prompt", {
								name:
									deleteCandidate?.name ??
									deleteCandidate?.address ??
									t("nodes.thisNode", "this node"),
							})}
						</AlertDialogBody>

						<AlertDialogFooter>
							<Button
								ref={cancelDeleteRef}
								onClick={handleCloseDeleteConfirm}
								isDisabled={isDeletingNode}
							>
								{t("cancel", "Cancel")}
							</Button>
							<Button
								colorScheme="red"
								onClick={confirmDeleteNode}
								ml={3}
								isLoading={isDeletingNode}
								isDisabled={!deleteCandidate}
							>
								{t("delete")}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>

			<AlertDialog
				isOpen={isResetConfirmOpen}
				leastDestructiveRef={cancelResetRef}
				onClose={handleCloseResetConfirm}
			>
				<AlertDialogOverlay>
					<AlertDialogContent
						onKeyDown={(event) => {
							if (event.key !== "Enter" || isResettingUsage || !resetCandidate) {
								return;
							}
							event.preventDefault();
							confirmResetUsage();
						}}
					>
						<AlertDialogHeader fontSize="lg" fontWeight="bold">
							{t("nodes.resetUsage", "Reset usage")}
						</AlertDialogHeader>

						<AlertDialogBody>
							{t(
								"nodes.resetUsageConfirm",
								"Are you sure you want to reset usage for {{name}}?",
								{
									name:
										resetCandidate?.name ??
										resetCandidate?.address ??
										t("nodes.thisNode", "this node"),
								},
							)}
						</AlertDialogBody>

						<AlertDialogFooter>
							<Button ref={cancelResetRef} onClick={handleCloseResetConfirm}>
								{t("cancel", "Cancel")}
							</Button>
							<Button
								colorScheme="red"
								onClick={confirmResetUsage}
								ml={3}
								isLoading={isResettingUsage}
							>
								{t("nodes.resetUsage", "Reset usage")}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>

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
					<ModalOverlay />
					<ModalContent>
						<ModalHeader>{t("nodes.newNodePublicKeyTitle")}</ModalHeader>
						<ModalCloseButton />
						<ModalBody>
							<VStack align="stretch" spacing={4}>
								<Text
									fontSize="sm"
									color="gray.600"
									_dark={{ color: "gray.300" }}
								>
									{t(
										"nodes.newNodePublicKeyDesc",
										"Save this single bundle now. Paste it once into the node installer and the installer will split the certificate and private key automatically.",
									)}
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
												{t(
													"nodes.installBundleLabel",
													"Node install bundle",
												)}
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
												{t(
													"nodes.download-node-install-bundle",
													"Download install bundle",
												)}
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
						<ModalFooter>
							<Button
								onClick={() => setNewNodeCertificate(null)}
								colorScheme="primary"
							>
								{t("close", "Close")}
							</Button>
						</ModalFooter>
					</ModalContent>
				</Modal>
			)}
		</VStack>
	);
};

export default NodesPage;
