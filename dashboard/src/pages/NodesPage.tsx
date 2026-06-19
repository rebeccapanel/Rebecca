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
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
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
): boolean => {
	const current = normalizeVersion(currentVersion);
	const latest = normalizeVersion(latestVersion);
	return Boolean(current && latest && current !== latest);
};

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
		: "Unlimited";

const formatNodeSpeed = (value?: number | null) =>
	value !== null && value !== undefined ? `${formatBytes(value, 2)}/s` : "-";

const formatNodeUptime = (value?: number | null) =>
	value !== null && value !== undefined && Number.isFinite(value) && value > 0
		? formatDuration(value)
		: "-";

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
	| { type: "bulk" };

type GeoDialogTarget = { type: "node"; node: NodeType };

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
	const [pageSize, setPageSize] = useState(12);
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
	const latestNodeVersion =
		nodeUpdateChannel === "dev"
			? maintenanceInfo?.node_update?.latest_dev?.tag || ""
			: maintenanceInfo?.node_update?.latest_release?.tag || "";
	const isNodeUpdateAvailable =
		normalizeVersion(latestNodeVersion) &&
		normalizeVersion(currentNodeVersion) &&
		normalizeVersion(latestNodeVersion) !==
			normalizeVersion(currentNodeVersion);

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
		const confirmed = window.confirm(
			t(
				"nodes.restartServiceConfirm",
				"Send a restart request to {{name}}? Services will be interrupted briefly.",
				{ name: label },
			),
		);
		if (!confirmed) return;
		restartServiceMutate(node);
	};

	const handleUpdateNodeService = (node: NodeType) => {
		if (!node?.id) return;
		const label = node.name || node.address || t("nodes.thisNode", "this node");
		const confirmed = window.confirm(
			t(
				"nodes.updateServiceConfirm",
				"Send an update request to {{name}}? The node will download updates and restart.",
				{ name: label },
			),
		);
		if (!confirmed) return;
		updateServiceMutate({
			...node,
			channel: node.node_update_channel === "dev" ? "dev" : nodeUpdateChannel,
		});
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
			const targetNodes = (nodes ?? []).filter(
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
			: false;

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
					{currentNodeVersion ? (
						<Tag size="sm" colorScheme="gray">
							{t("nodes.nodeServiceVersionTag", {
								version: currentNodeVersion,
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
				direction={{ base: "column", lg: "row" }}
				spacing={{ base: 3, lg: 4 }}
				alignItems={{ base: "stretch", lg: "center" }}
				justifyContent="space-between"
				w="full"
				borderWidth="1px"
				borderColor={nodePanelBorder}
				borderRadius="md"
				bg={nodePanelBg}
				p={3}
			>
				<VStack align="flex-start" spacing={1}>
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
				<Stack
					direction={{ base: "column", md: "row" }}
					spacing={{ base: 3, md: 3 }}
					alignItems={{ base: "stretch", md: "center" }}
					justifyContent="flex-end"
					w={{ base: "full", lg: "auto" }}
				>
					<HStack
						spacing={2}
						alignItems="center"
						justifyContent="flex-end"
						w={{ base: "full", md: "auto" }}
						flexWrap="wrap"
					>
						<InputGroup size="sm" maxW={{ base: "full", md: "260px" }}>
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
							w={{ base: "full", sm: "150px" }}
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
							w={{ base: "full", sm: "150px" }}
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
							w={{ base: "full", sm: "170px" }}
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
						<Tooltip label={t("nodes.viewList", "List view")}>
							<IconButton
								aria-label={t("nodes.viewList", "List view")}
								icon={<ListViewIcon />}
								variant={viewMode === "list" ? "solid" : "ghost"}
								colorScheme={viewMode === "list" ? "primary" : undefined}
								size="sm"
								onClick={() => setViewMode("list")}
							/>
						</Tooltip>
						<Tooltip label={t("nodes.viewGrid", "Grid view")}>
							<IconButton
								aria-label={t("nodes.viewGrid", "Grid view")}
								icon={<GridViewIcon />}
								variant={viewMode === "grid" ? "solid" : "ghost"}
								colorScheme={viewMode === "grid" ? "primary" : undefined}
								size="sm"
								onClick={() => setViewMode("grid")}
							/>
						</Tooltip>
					</HStack>
					<Stack
						direction={{ base: "column", sm: "row" }}
						spacing={2}
						justify="flex-end"
						alignItems={{ base: "flex-end", sm: "center" }}
					>
						<Button
							leftIcon={<TutorialIconStyled />}
							variant="outline"
							size="sm"
							onClick={() =>
								navigate("/tutorials?focus=section-nodes-admin-guide")
							}
							w={{ base: "auto", sm: "auto" }}
							px={{ base: 4, sm: 4 }}
						>
							{t("nodes.nodeTutorial", "Node tutorial")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setVersionDialogTarget({ type: "bulk" })}
							isDisabled={!hasConnectedNodes || !hostActionsAvailable}
							w={{ base: "auto", sm: "auto" }}
							px={{ base: 4, sm: 4 }}
						>
							{t("nodes.updateAllNodesCore")}
						</Button>
						<Button
							leftIcon={<AddIconStyled />}
							colorScheme="primary"
							size="sm"
							onClick={() => setAddNodeOpen(true)}
							w={{ base: "auto", sm: "auto" }}
							px={{ base: 4, sm: 5 }}
						>
							{t("nodes.addNode")}
						</Button>
					</Stack>
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
					overflowX="auto"
				>
					<Table size="sm" variant="simple" minW="1120px">
						<Thead bg={nodePanelBg}>
							<Tr>
								<Th
									minW="220px"
									cursor="pointer"
									onClick={() => handleSort("name")}
								>
									{sortLabel("name", t("nodes.columns.name", "Name"))}
								</Th>
								<Th
									minW="130px"
									cursor="pointer"
									onClick={() => handleSort("status")}
								>
									{sortLabel("status", t("nodes.columns.status", "Status"))}
								</Th>
								<Th minW="150px">{t("nodes.columns.address", "Address")}</Th>
								<Th minW="130px">
									{t("nodes.columns.xrayVersion", "Xray version")}
								</Th>
								<Th minW="150px">
									{t("nodes.columns.nodeRuntime", "Node / install")}
								</Th>
								<Th
									minW="120px"
									cursor="pointer"
									onClick={() => handleSort("uptime")}
								>
									{sortLabel("uptime", t("nodes.columns.uptime", "Uptime"))}
								</Th>
								<Th
									minW="150px"
									cursor="pointer"
									onClick={() => handleSort("usage")}
								>
									{sortLabel(
										"usage",
										t("nodes.columns.trafficLimit", "Traffic / Limit"),
									)}
								</Th>
								<Th
									minW="130px"
									cursor="pointer"
									onClick={() => handleSort("bandwidth")}
								>
									{sortLabel(
										"bandwidth",
										t("nodes.columns.bandwidth", "Upload / Download"),
									)}
								</Th>
								<Th
									minW="110px"
									cursor="pointer"
									onClick={() => handleSort("cpu")}
								>
									{sortLabel("cpu", t("nodes.columns.cpu", "CPU"))}
								</Th>
								<Th
									minW="130px"
									cursor="pointer"
									onClick={() => handleSort("ram")}
								>
									{sortLabel("ram", t("nodes.columns.ram", "RAM"))}
								</Th>
								<Th minW="160px">
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
								const nodeRuntimeVersion =
									node.node_binary_tag || node.node_service_version;
								const nodeServiceUpdateAvailable =
									getNodeServiceUpdateAvailable(
										nodeRuntimeVersion,
										latestNodeVersion,
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
										: t("nodes.unlimited", "Unlimited")
								}`;
								const nodeRemainingDataDisplay =
									node.data_limit != null && node.data_limit > 0
										? formatNodeBytes(
												Math.max(node.data_limit - totalUsage, 0),
												2,
											)
										: null;
								const nodeCPUDisplay = `${formatCPUFrequency(
									node.cpu_frequency_hz,
								)} / ${formatNodePercent(node.cpu_usage_percent)}`;
								const nodeRAMDisplay = `${formatNodeBytes(
									node.memory_used,
									2,
								)} / ${formatNodeBytes(node.memory_total, 2)}`;
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
											<HStack align="center" spacing={3}>
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
												<VStack align="flex-start" spacing={1} minW={0}>
													<HStack spacing={2} align="center" flexWrap="wrap">
														<Text
															fontWeight="semibold"
															maxW="220px"
															noOfLines={2}
															wordBreak="break-word"
														>
															{node.name ||
																t("nodes.unnamedNode", "Unnamed node")}
														</Text>
													</HStack>
													<Text fontSize="xs" color="gray.500">
														{t("nodes.id", "ID")}: {node.id ?? EMPTY_CELL_VALUE}
													</Text>
													{node.note && (
														<Text
															fontSize="xs"
															color="gray.500"
															maxW="240px"
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
													{nodeRuntimeVersion
														? t("nodes.nodeServiceVersionTag", {
																version: nodeRuntimeVersion,
															})
														: t(
																"nodes.nodeServiceVersionUnknown",
														"Node version unknown",
															)}
												</Tag>
												<Text fontSize="xs" color="gray.500">
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
											<Text fontWeight="medium">{nodeUptimeDisplay}</Text>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<Text fontWeight="medium">{nodeTrafficLimitDisplay}</Text>
												{nodeRemainingDataDisplay && (
													<Text fontSize="xs" color="gray.500">
														{t("nodes.remainingData", "Remaining data")}:{" "}
														{nodeRemainingDataDisplay}
													</Text>
												)}
											</VStack>
										</Td>
										<Td>
											<Text fontWeight="medium">{nodeBandwidthDisplay}</Text>
										</Td>
										<Td>
											<Text fontWeight="medium">{nodeCPUDisplay}</Text>
										</Td>
										<Td>
											<Text fontWeight="medium">{nodeRAMDisplay}</Text>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<HStack
													spacing={1}
													maxW="180px"
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
															maxW="180px"
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
									<Td colSpan={11}>
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
							const nodeRuntimeVersion =
								node.node_binary_tag || node.node_service_version;
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
									: t("nodes.unlimited", "Unlimited")
							}`;
							const nodeCPUDisplay = `${formatCPUFrequency(
								node.cpu_frequency_hz,
							)} / ${formatNodePercent(node.cpu_usage_percent)}`;
							const nodeRAMDisplay = `${formatNodeBytes(
								node.memory_used,
								2,
							)} / ${formatNodeBytes(node.memory_total, 2)}`;
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
											{nodeServiceUpdateAvailable && (
												<Tag
													as="button"
													type="button"
													display="inline-flex"
													alignItems="center"
													justifyContent="center"
													h="24px"
													fontSize="12px"
													fontWeight="700"
													borderRadius="9999px"
													px="10px"
													bg="rgba(237, 137, 54, 0.16)"
													color="rgb(237, 137, 54)"
													cursor={(!nodeId || !nodeHostActionsAvailable || isUpdatingMaintenance) ? "not-allowed" : "pointer"}
													opacity={(!nodeId || !nodeHostActionsAvailable || isUpdatingMaintenance) ? 0.6 : 1}
													whiteSpace="nowrap"
													gap="6px"
													transition="background 0.2s ease-in-out"
													_hover={{ bg: (!nodeId || !nodeHostActionsAvailable || isUpdatingMaintenance) ? "rgba(237, 137, 54, 0.16)" : "rgba(237, 137, 54, 0.28)" }}
													onClick={() => {
														if (nodeId && nodeHostActionsAvailable && !isUpdatingMaintenance) {
															handleUpdateNodeService(node);
														}
													}}
												>
													{isUpdatingMaintenance ? (
														<Spinner size="xs" display="block" />
													) : (
														<DownloadIconStyled w="14px" h="14px" display="block" flexShrink={0} />
													)}
													<span style={{ position: "relative", top: "2px" }}>
														{t("nodes.nodeUpdateAvailable", "Update available")}
													</span>
												</Tag>
											)}
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
													whiteSpace="nowrap"
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
											<Tag colorScheme="blue" size="sm" whiteSpace="nowrap">
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
												whiteSpace="nowrap"
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
												whiteSpace="nowrap"
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
												whiteSpace="nowrap"
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
												whiteSpace="nowrap"
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
												whiteSpace="nowrap"
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
										<Box>
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
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.runtime", "Runtime")}
											</Text>
											<Text fontWeight="medium" lineHeight="short">
												{nodeRuntimeVersion
													? t("nodes.nodeServiceVersionTag", {
															version: nodeRuntimeVersion,
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
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.uptime", "Uptime")}
											</Text>
											<Text fontWeight="medium">{nodeUptimeDisplay}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.trafficLimit", "Traffic / Limit")}
											</Text>
											<Text fontWeight="medium">{nodeTrafficLimitDisplay}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.bandwidthSpeed", "Upload / Download")}
											</Text>
											<Text fontWeight="medium">{nodeBandwidthDisplay}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.cpu", "CPU")}
											</Text>
											<Text fontWeight="medium">{nodeCPUDisplay}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.ram", "RAM")}
											</Text>
											<Text fontWeight="medium">{nodeRAMDisplay}</Text>
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
			<AlertDialog
				isOpen={isDeleteConfirmOpen}
				leastDestructiveRef={cancelDeleteRef}
				onClose={handleCloseDeleteConfirm}
			>
				<AlertDialogOverlay>
					<AlertDialogContent>
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
					<AlertDialogContent>
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
