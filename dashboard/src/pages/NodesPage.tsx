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
	InputRightElement,
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
import { NumericInput } from "components/common/NumericInput";
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
import type { Status as UserStatus } from "types/User";
import { formatBytes } from "utils/formatByte";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { DeleteConfirmPopover } from "../components/DeleteConfirmPopover";
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

interface MasterNodeSummary {
	status: NodeType["status"];
	message?: string | null;
	data_limit?: number | null;
	uplink: number;
	downlink: number;
	total_usage: number;
	remaining_data?: number | null;
	limit_exceeded: boolean;
	updated_at?: string | null;
}

const formatDataLimitForInput = (value?: number | null): string => {
	if (value === null || value === undefined) {
		return "";
	}
	const gbValue = value / BYTES_IN_GB;
	if (!Number.isFinite(gbValue)) {
		return "";
	}
	const rounded = Math.round(gbValue * 100) / 100;
	return rounded.toString();
};

const convertLimitInputToBytes = (value: string): number | null | undefined => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const numeric = Number(trimmed);
	if (!Number.isFinite(numeric) || numeric < 0) {
		return undefined;
	}
	if (numeric === 0) {
		return null;
	}
	return Math.round(numeric * BYTES_IN_GB);
};

const formatCellValue = (value?: string | number | null): string => {
	if (value === null || value === undefined || value === "") {
		return EMPTY_CELL_VALUE;
	}
	return String(value);
};

const uniqueValues = (items: string[]): string[] =>
	Array.from(new Set(items.filter(Boolean)));

const getConfigInbounds = (config: NodeType["xray_config"]): string[] => {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return [];
	}

	const inbounds = (config as { inbounds?: unknown }).inbounds;
	if (!Array.isArray(inbounds)) {
		return [];
	}

	return inbounds
		.map((inbound) => {
			if (!inbound || typeof inbound !== "object") {
				return "";
			}
			const item = inbound as {
				tag?: unknown;
				remark?: unknown;
			};
			return typeof item.tag === "string" && item.tag
				? item.tag
				: typeof item.remark === "string" && item.remark
					? item.remark
					: "inbound";
		})
		.filter(Boolean);
};

const getNodeServiceUpdateAvailable = (
	currentVersion?: string | null,
	latestVersion?: string | null,
): boolean => {
	const current = normalizeVersion(currentVersion);
	const latest = normalizeVersion(latestVersion);
	return Boolean(current && latest && current !== latest);
};

const NodeInboundTags: FC<{
	tags: string[];
	emptyLabel: string;
	detailsLabel: string;
}> = ({ tags, emptyLabel, detailsLabel }) => {
	const visibleTags = tags.slice(0, 3);
	const hiddenTags = tags.slice(3);

	if (!tags.length) {
		return <Text color="gray.400">{emptyLabel}</Text>;
	}

	return (
		<HStack spacing={1.5} align="center" flexWrap="wrap">
			{visibleTags.map((tag) => (
				<Tag key={tag} size="sm" colorScheme="teal">
					{tag}
				</Tag>
			))}
			{hiddenTags.length > 0 && (
				<Popover
					trigger="hover"
					placement="bottom-start"
					openDelay={120}
					closeDelay={120}
					isLazy
				>
					<PopoverTrigger>
						<Tag
							size="sm"
							colorScheme="teal"
							variant="outline"
							cursor="default"
						>
							+{hiddenTags.length}
						</Tag>
					</PopoverTrigger>
					<PopoverContent w="auto" minW="180px" maxW="320px" p={2}>
						<PopoverArrow />
						<PopoverBody p={1}>
							<VStack align="stretch" spacing={1}>
								<Text fontSize="xs" fontWeight="semibold" color="gray.500">
									{detailsLabel}
								</Text>
								<HStack spacing={1.5} align="center" flexWrap="wrap">
									{tags.map((tag) => (
										<Tag key={tag} size="sm" colorScheme="teal">
											{tag}
										</Tag>
									))}
								</HStack>
							</VStack>
						</PopoverBody>
					</PopoverContent>
				</Popover>
			)}
		</HStack>
	);
};

interface CoreStatsResponse {
	version: string | null;
	started: string | null;
	logs_websocket?: string;
}

type VersionDialogTarget =
	| { type: "master" }
	| { type: "node"; node: NodeType }
	| { type: "bulk" };

type GeoDialogTarget = { type: "master" } | { type: "node"; node: NodeType };

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
		updateMasterNode,
		resetMasterUsage,
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
	const [updatingMasterCore, setUpdatingMasterCore] = useState(false);
	const [updatingBulkCore, setUpdatingBulkCore] = useState(false);
	const [updatingMasterGeo, setUpdatingMasterGeo] = useState(false);
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
		name?: string | null;
	} | null>(null);
	const generatedCertificateValue = newNodeCertificate?.certificate ?? "";
	const {
		onCopy: copyGeneratedCertificate,
		hasCopied: generatedCertificateCopied,
	} = useClipboard(generatedCertificateValue);
	const {
		isOpen: isResetConfirmOpen,
		onOpen: openResetConfirm,
		onClose: closeResetConfirm,
	} = useDisclosure();
	const cancelResetRef = useRef<HTMLButtonElement | null>(null);
	const [masterLimitInput, setMasterLimitInput] = useState<string>("");
	const [masterLimitDirty, setMasterLimitDirty] = useState(false);
	const {
		isOpen: isMasterResetOpen,
		onOpen: openMasterReset,
		onClose: closeMasterReset,
	} = useDisclosure();
	const {
		isOpen: isMasterEditOpen,
		onOpen: openMasterEdit,
		onClose: closeMasterEdit,
	} = useDisclosure();
	const masterResetCancelRef = useRef<HTMLButtonElement | null>(null);

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

	const {
		data: coreStats,
		isLoading: isCoreLoading,
		refetch: refetchCoreStats,
		error: coreError,
	} = useQuery<CoreStatsResponse>(
		["core-stats"],
		() => apiFetch<CoreStatsResponse>("/core"),
		{
			refetchOnWindowFocus: false,
			enabled: canManageNodes,
		},
	);

	const {
		data: masterState,
		isLoading: isMasterStateLoading,
		error: masterStateError,
		refetch: refetchMasterState,
	} = useQuery<MasterNodeSummary>(
		["master-node-state"],
		() => apiFetch<MasterNodeSummary>("/node/master"),
		{
			refetchInterval: canManageNodes && isEditingNodes ? 3000 : undefined,
			refetchOnWindowFocus: false,
			enabled: canManageNodes,
		},
	);
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

	useEffect(() => {
		if (!masterState) {
			return;
		}
		if (masterLimitDirty) {
			const parsedValue = convertLimitInputToBytes(masterLimitInput);
			const currentLimit = masterState.data_limit ?? null;
			if (parsedValue !== currentLimit) {
				return;
			}
		}
		const formatted = formatDataLimitForInput(masterState.data_limit ?? null);
		setMasterLimitInput(formatted);
		if (masterLimitDirty) {
			setMasterLimitDirty(false);
		}
	}, [masterState, masterLimitDirty, masterLimitInput]);

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
			setAddNodeOpen(false);
			if (createdNode?.node_certificate) {
				setNewNodeCertificate({
					certificate: createdNode.node_certificate,
					name: createdNode.name,
				});
			}
		},
		onError: (err) => {
			generateErrorMessage(err, toast);
		},
		onSettled: () => {
			setAddNodeOpen(false);
		},
	});

	const { isLoading: isUpdating, mutate: updateNodeMutate } = useMutation(
		updateNode,
		{
			onSuccess: () => {
				generateSuccessMessage(t("nodes.nodeUpdated"), toast);
				queryClient.invalidateQueries(FetchNodesQueryKey);
				refetchNodes();
				setEditingNode(null);
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
			onSettled: () => {
				setEditingNode(null);
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

	const { isLoading: isUpdatingMasterLimit, mutate: updateMasterLimitMutate } =
		useMutation(updateMasterNode, {
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.masterLimitUpdateSuccess", "Master data limit saved"),
					toast,
				);
				refetchMasterState();
				setMasterLimitDirty(false);
				closeMasterEdit();
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
		});

	const { isLoading: isResettingMasterUsage, mutate: resetMasterUsageMutate } =
		useMutation(resetMasterUsage, {
			onSuccess: () => {
				generateSuccessMessage(
					t("nodes.resetMasterUsageSuccess", "Master usage reset"),
					toast,
				);
				refetchMasterState();
				closeMasterReset();
			},
			onError: (err) => {
				generateErrorMessage(err, toast);
			},
		});

	const parsedMasterLimit = useMemo(
		() => convertLimitInputToBytes(masterLimitInput),
		[masterLimitInput],
	);
	const currentMasterLimit = masterState?.data_limit ?? null;
	const masterLimitInvalid = parsedMasterLimit === undefined;
	const hasMasterLimitChanged =
		parsedMasterLimit !== undefined && parsedMasterLimit !== currentMasterLimit;
	const isMasterCardLoading = isCoreLoading || isMasterStateLoading;
	const masterErrorMessage = useMemo(() => {
		if (coreError instanceof Error) return coreError.message;
		if (typeof coreError === "string") return coreError;
		if (masterStateError instanceof Error) return masterStateError.message;
		if (typeof masterStateError === "string") return masterStateError;
		return undefined;
	}, [coreError, masterStateError]);
	const masterTotalUsage = masterState?.total_usage ?? 0;
	const masterDataLimit = masterState?.data_limit ?? null;
	const masterRemainingBytes = masterState?.remaining_data ?? null;
	const masterUpdatedAt = masterState?.updated_at
		? dayjs(masterState.updated_at).local().format("YYYY-MM-DD HH:mm")
		: null;
	const masterStatus: UserStatus = (masterState?.status ??
		"error") as UserStatus;
	const masterUsageDisplay = formatBytes(masterTotalUsage, 2);
	const masterDataLimitDisplay =
		masterDataLimit !== null && masterDataLimit > 0
			? formatBytes(masterDataLimit, 2)
			: t("nodes.unlimited", "Unlimited");
	const masterRemainingDisplay =
		masterRemainingBytes !== null && masterRemainingBytes !== undefined
			? formatBytes(masterRemainingBytes, 2)
			: null;
	const nodeGridColumns = useMemo(() => ({ base: 1, md: 2, xl: 3 }), []);

	const handleMasterLimitInputChange = (value: string) => {
		setMasterLimitDirty(true);
		setMasterLimitInput(value);
	};

	const handleMasterLimitSave = () => {
		if (masterLimitInvalid || parsedMasterLimit === undefined) {
			generateErrorMessage(
				t(
					"nodes.dataLimitValidation",
					"Data limit must be a non-negative number",
				),
				toast,
			);
			return;
		}
		updateMasterLimitMutate({ data_limit: parsedMasterLimit ?? null });
	};

	const handleMasterLimitClear = () => {
		setMasterLimitDirty(true);
		setMasterLimitInput("");
		updateMasterLimitMutate({ data_limit: null });
	};

	const handleResetMasterUsageRequest = () => {
		openMasterReset();
	};

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

		if (versionDialogTarget.type === "master") {
			setUpdatingMasterCore(true);
			try {
				await apiFetch("/core/xray/update", {
					method: "POST",
					body: { version, persist_env: Boolean(persist) },
				});
				generateSuccessMessage(
					t("nodes.coreVersionDialog.masterUpdateSuccess", { version }),
					toast,
				);
				await Promise.all([
					refetchCoreStats(),
					queryClient.invalidateQueries(FetchNodesQueryKey),
				]);
				closeVersionDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingMasterCore(false);
			}
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

		if (geoDialogTarget.type === "master") {
			setUpdatingMasterGeo(true);
			try {
				await apiFetch("/core/geo/update", { method: "POST", body });
				generateSuccessMessage(t("nodes.geoDialog.masterUpdateSuccess"), toast);
				closeGeoDialog();
			} catch (err) {
				generateErrorMessage(err, toast);
			} finally {
				setUpdatingMasterGeo(false);
			}
			return;
		}

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
		if (!term) return nodes;
		return nodes.filter((node) => {
			const name = (node.name ?? "").toLowerCase();
			const address = (node.address ?? "").toLowerCase();
			const version = (node.xray_version ?? "").toLowerCase();
			return (
				name.includes(term) || address.includes(term) || version.includes(term)
			);
		});
	}, [nodes, searchTerm]);

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
	const masterLabel = t("nodes.masterNode", "Master");
	const normalizedSearch = searchTerm.trim().toLowerCase();
	const masterMatchesSearch =
		!normalizedSearch ||
		masterLabel.toLowerCase().includes(normalizedSearch) ||
		(coreStats?.version ?? "").toLowerCase().includes(normalizedSearch);

	const versionDialogLoading =
		versionDialogTarget?.type === "master"
			? updatingMasterCore
			: versionDialogTarget?.type === "node"
				? versionDialogTarget.node.id != null &&
					updatingCoreNodeId === versionDialogTarget.node.id
				: versionDialogTarget?.type === "bulk"
					? updatingBulkCore
					: false;

	const geoDialogLoading =
		geoDialogTarget?.type === "master"
			? updatingMasterGeo
			: geoDialogTarget?.type === "node"
				? geoDialogTarget.node.id != null &&
					updatingGeoNodeId === geoDialogTarget.node.id
				: false;

	const versionDialogTitle =
		versionDialogTarget?.type === "master"
			? t("nodes.coreVersionDialog.masterTitle")
			: versionDialogTarget?.type === "bulk"
				? t("nodes.coreVersionDialog.bulkTitle")
				: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeTitle", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode", "Unnamed node"),
						})
					: "";

	const versionDialogDescription =
		versionDialogTarget?.type === "master"
			? t("nodes.coreVersionDialog.masterDescription")
			: versionDialogTarget?.type === "bulk"
				? t("nodes.coreVersionDialog.bulkDescription")
				: versionDialogTarget?.type === "node"
					? t("nodes.coreVersionDialog.nodeDescription", {
							name:
								versionDialogTarget.node.name ??
								t("nodes.unnamedNode", "Unnamed node"),
						})
					: "";

	const versionDialogCurrentVersion =
		versionDialogTarget?.type === "master"
			? (coreStats?.version ?? "")
			: versionDialogTarget?.type === "node"
				? (versionDialogTarget.node.xray_version ?? "")
				: "";

	const geoDialogTitle =
		geoDialogTarget?.type === "master"
			? t("nodes.geoDialog.masterTitle")
			: geoDialogTarget?.type === "node"
				? t("nodes.geoDialog.nodeTitle", {
						name:
							geoDialogTarget.node.name ??
							t("nodes.unnamedNode", "Unnamed node"),
					})
				: "";

	const masterContent = isMasterCardLoading ? (
		<VStack spacing={3} align="center" justify="center">
			<Spinner />
			<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
				{t("loading")}
			</Text>
		</VStack>
	) : masterErrorMessage ? (
		<VStack spacing={3} align="stretch">
			<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
				{masterErrorMessage}
			</Text>
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					refetchCoreStats();
					refetchMasterState();
				}}
			>
				{t("refresh", "Refresh")}
			</Button>
		</VStack>
	) : !masterState ? (
		<VStack spacing={3} align="stretch">
			<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
				{t("nodes.masterLoadFailed", "Unable to load master details.")}
			</Text>
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					refetchCoreStats();
					refetchMasterState();
				}}
			>
				{t("refresh", "Refresh")}
			</Button>
		</VStack>
	) : (
		<VStack align="stretch" spacing={4}>
			<Stack spacing={2}>
				<HStack spacing={3} align="center" flexWrap="wrap">
					<Text fontWeight="semibold" fontSize="lg">
						{masterLabel}
					</Text>
					<Tag
						as="button"
						type="button"
						colorScheme="purple"
						size="sm"
						cursor="pointer"
						_hover={{ opacity: 0.82 }}
						onClick={() => setVersionDialogTarget({ type: "master" })}
					>
						{coreStats?.version
							? `Xray ${coreStats.version}`
							: t("nodes.versionUnknown", "Version unknown")}
					</Tag>
				</HStack>
				<HStack spacing={2} align="center">
					<NodeModalStatusBadge status={masterStatus} compact />
					{masterState.limit_exceeded && (
						<Tag colorScheme="red" size="sm">
							{t("nodes.limitReached", "Limit reached")}
						</Tag>
					)}
				</HStack>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{coreStats?.started
						? t("nodes.masterStartedAt", {
								date: dayjs(coreStats.started)
									.local()
									.format("YYYY-MM-DD HH:mm"),
							})
						: t("nodes.masterStartedUnknown", "Start time unavailable")}
				</Text>
			</Stack>
			{masterState.message && (
				<Alert status="warning" variant="left-accent" borderRadius="md">
					<AlertIcon />
					<AlertDescription fontSize="sm">
						{masterState.message}
					</AlertDescription>
				</Alert>
			)}
			<Divider />
			<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
				<Box>
					<Text fontSize="xs" textTransform="uppercase" color="gray.500">
						{t("nodes.totalUsage", "Total usage")}
					</Text>
					<Text fontWeight="medium">{masterUsageDisplay}</Text>
				</Box>
				<Box>
					<Text fontSize="xs" textTransform="uppercase" color="gray.500">
						{t("nodes.dataLimitLabel", "Data limit")}
					</Text>
					<Text fontWeight="medium">{masterDataLimitDisplay}</Text>
				</Box>
				{masterRemainingDisplay && (
					<Box>
						<Text fontSize="xs" textTransform="uppercase" color="gray.500">
							{t("nodes.remainingData", "Remaining data")}
						</Text>
						<Text fontWeight="medium">{masterRemainingDisplay}</Text>
					</Box>
				)}
				{masterUpdatedAt && (
					<Box>
						<Text fontSize="xs" textTransform="uppercase" color="gray.500">
							{t("nodes.lastUpdated", "Last updated")}
						</Text>
						<Text fontWeight="medium">{masterUpdatedAt}</Text>
					</Box>
				)}
			</SimpleGrid>
			<Stack
				direction={{ base: "column", md: "row" }}
				spacing={2}
				align={{ base: "stretch", md: "center" }}
			>
				<InputGroup size="sm" maxW={{ base: "full", md: "240px" }}>
					<NumericInput
						step={0.01}
						min={0}
						value={masterLimitInput}
						onChange={(value) => handleMasterLimitInputChange(value)}
						placeholder={t(
							"nodes.dataLimitPlaceholder",
							"e.g., 500 (empty = unlimited)",
						)}
					/>
					<InputRightElement pointerEvents="none">
						<Text fontSize="xs" color="gray.500">
							GB
						</Text>
					</InputRightElement>
				</InputGroup>
				<Button
					colorScheme="primary"
					size="sm"
					onClick={handleMasterLimitSave}
					isDisabled={
						!hasMasterLimitChanged ||
						masterLimitInvalid ||
						isUpdatingMasterLimit
					}
					isLoading={isUpdatingMasterLimit}
				>
					{t("save", "Save")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleMasterLimitClear}
					isDisabled={masterDataLimit === null || isUpdatingMasterLimit}
					isLoading={isUpdatingMasterLimit && masterDataLimit === null}
				>
					{t("nodes.clearDataLimit", "Clear limit")}
				</Button>
			</Stack>
			{masterLimitInvalid && (
				<Text fontSize="xs" color="red.500">
					{t(
						"nodes.dataLimitValidation",
						"Data limit must be a non-negative number",
					)}
				</Text>
			)}
			<Stack
				direction={{ base: "column", sm: "row" }}
				spacing={2}
				flexWrap="wrap"
			>
				<Button
					size="sm"
					variant="outline"
					colorScheme="primary"
					onClick={() => setVersionDialogTarget({ type: "master" })}
					isLoading={updatingMasterCore}
					isDisabled={!hostActionsAvailable}
					flex={{ base: "1", sm: "0 1 auto" }}
					minW={{ base: "full", sm: "auto" }}
					whiteSpace="normal"
					wordBreak="break-word"
				>
					{t("nodes.coreVersionDialog.updateMasterButton")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setGeoDialogTarget({ type: "master" })}
					isLoading={updatingMasterGeo}
					isDisabled={!hostActionsAvailable}
					flex={{ base: "1", sm: "0 1 auto" }}
					minW={{ base: "full", sm: "auto" }}
					whiteSpace="normal"
					wordBreak="break-word"
				>
					{t("nodes.geoDialog.updateMasterButton")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					colorScheme="red"
					onClick={handleResetMasterUsageRequest}
					isLoading={isResettingMasterUsage}
					flex={{ base: "1", sm: "0 1 auto" }}
					minW={{ base: "full", sm: "auto" }}
					whiteSpace="normal"
					wordBreak="break-word"
				>
					{t("nodes.resetUsage", "Reset usage")}
				</Button>
			</Stack>
		</VStack>
	);

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
						"Manage your master and satellite nodes. Update core versions, control availability, and edit node settings.",
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
				<Text fontWeight="semibold">
					{t("nodes.manageNodesHeader", "Node list")}
				</Text>
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
					<Table size="sm" variant="simple" minW="1680px">
						<Thead bg={nodePanelBg}>
							<Tr>
								<Th minW="180px">{t("nodes.columns.name", "Name")}</Th>
								<Th minW="170px">{t("nodes.columns.address", "Address")}</Th>
								<Th minW="180px">{t("nodes.columns.ports", "Ports")}</Th>
								<Th minW="130px">{t("nodes.columns.status", "Status")}</Th>
								<Th minW="240px">{t("nodes.columns.inbounds", "Inbounds")}</Th>
								<Th minW="140px">
									{t("nodes.columns.xrayVersion", "Xray version")}
								</Th>
								<Th minW="150px">
									{t("nodes.columns.nodeVersion", "Node version")}
								</Th>
								<Th minW="170px">{t("nodes.columns.install", "Install")}</Th>
								<Th minW="210px">{t("nodes.columns.traffic", "Traffic")}</Th>
								<Th minW="240px">{t("nodes.columns.limit", "Limit")}</Th>
								<Th minW="150px">
									{t("nodes.columns.coefficient", "Coefficient")}
								</Th>
								<Th minW="210px">{t("nodes.columns.proxy", "Proxy")}</Th>
								<Th minW="220px">
									{t("nodes.columns.certificate", "Certificate")}
								</Th>
							</Tr>
						</Thead>
						<Tbody>
							{masterMatchesSearch && (
								<Tr key="master-node-table">
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
														minW="220px"
														maxW="calc(100vw - 24px)"
														maxH="min(70vh, 420px)"
														overflowY="auto"
													>
														<MenuItem
															icon={<EditIconStyled />}
															onClick={openMasterEdit}
														>
															{t("edit")}
														</MenuItem>
														<MenuItem
															icon={<CoreIconStyled />}
															onClick={() =>
																setVersionDialogTarget({ type: "master" })
															}
															isDisabled={!hostActionsAvailable}
														>
															{t("nodes.updateCoreAction")}
														</MenuItem>
														<MenuItem
															icon={<GeoIconStyled />}
															onClick={() =>
																setGeoDialogTarget({ type: "master" })
															}
															isDisabled={!hostActionsAvailable}
														>
															{t("nodes.updateGeoAction", "Update geo")}
														</MenuItem>
														<MenuItem
															icon={<ArrowPathIconStyled />}
															color="red.500"
															onClick={handleResetMasterUsageRequest}
														>
															{t("nodes.resetUsage", "Reset usage")}
														</MenuItem>
													</MenuList>
												</Portal>
											</Menu>
											<VStack align="flex-start" spacing={1}>
												<Text fontWeight="semibold">{masterLabel}</Text>
												<Text
													fontSize="xs"
													color="gray.500"
													_dark={{ color: "gray.400" }}
												>
													{t("nodes.thisNode", "this node")}
												</Text>
											</VStack>
										</HStack>
									</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
									<Td>
										<VStack align="flex-start" spacing={2}>
											<NodeModalStatusBadge status={masterStatus} compact />
											{masterState?.limit_exceeded && (
												<Tag colorScheme="red" size="sm">
													{t("nodes.limitReached", "Limit reached")}
												</Tag>
											)}
										</VStack>
									</Td>
									<Td>
										<NodeInboundTags
											tags={defaultInboundSummaries}
											emptyLabel={t(
												"nodes.noInboundsConfigured",
												"No inbounds configured",
											)}
											detailsLabel={t("nodes.inbounds", "Inbounds")}
										/>
									</Td>
									<Td>
										<Tag
											as="button"
											type="button"
											colorScheme="purple"
											size="sm"
											cursor="pointer"
											_hover={{ opacity: 0.82 }}
											onClick={() => setVersionDialogTarget({ type: "master" })}
										>
											{coreStats?.version
												? `Xray ${coreStats.version}`
												: t("nodes.versionUnknown", "Version unknown")}
										</Tag>
									</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
									<Td>
										<Tag size="sm" colorScheme="gray">
											{panelInstallMode}
										</Tag>
									</Td>
									<Td>
										<VStack align="flex-start" spacing={1}>
											<Text fontWeight="medium">{masterUsageDisplay}</Text>
											<Text fontSize="xs" color="gray.500">
												{t("nodes.uplink", "Uplink")}:{" "}
												{formatBytes(masterState?.uplink ?? 0, 2)}
											</Text>
											<Text fontSize="xs" color="gray.500">
												{t("nodes.downlink", "Downlink")}:{" "}
												{formatBytes(masterState?.downlink ?? 0, 2)}
											</Text>
										</VStack>
									</Td>
									<Td>
										<VStack align="flex-start" spacing={1}>
											<Text fontWeight="medium">{masterDataLimitDisplay}</Text>
											{masterRemainingDisplay && (
												<Text fontSize="xs" color="gray.500">
													{t("nodes.remainingData", "Remaining data")}:{" "}
													{masterRemainingDisplay}
												</Text>
											)}
										</VStack>
									</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
									<Td>{EMPTY_CELL_VALUE}</Td>
								</Tr>
							)}
							{filteredNodes.map((node) => {
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
								const remainingData =
									node.data_limit != null && node.data_limit > 0
										? Math.max(node.data_limit - totalUsage, 0)
										: null;
								const customInbounds = uniqueValues(
									getConfigInbounds(node.xray_config),
								);
								const inboundSummaries = customInbounds.length
									? customInbounds
									: defaultInboundSummaries;
								const proxyLabel =
									node.proxy_enabled && node.proxy_type
										? `${node.proxy_type} ${formatCellValue(
												node.proxy_host,
											)}:${formatCellValue(node.proxy_port)}`
										: t("nodes.proxyDisabled", "Disabled");
								const certificateCopyValue =
									node.node_certificate || node.certificate_public_key || "";
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
															<DeleteConfirmPopover
																message={t("deleteNode.prompt", {
																	name: node.name,
																})}
																isLoading={isDeletingNode}
																onConfirm={() => deleteNodeMutate(node)}
															>
																<MenuItem
																	icon={<DeleteIconStyled />}
																	color="red.500"
																>
																	{t("delete")}
																</MenuItem>
															</DeleteConfirmPopover>
														</MenuList>
													</Portal>
												</Menu>
												<VStack align="flex-start" spacing={1}>
													<Text fontWeight="semibold">
														{node.name ||
															t("nodes.unnamedNode", "Unnamed node")}
													</Text>
													<Text fontSize="xs" color="gray.500">
														{t("nodes.id", "ID")}: {node.id ?? EMPTY_CELL_VALUE}
													</Text>
												</VStack>
											</HStack>
										</Td>
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
											<VStack align="flex-start" spacing={1}>
												<Text dir="ltr">
													{t("nodes.nodePort", "Node port")}:{" "}
													{formatCellValue(node.port)}
												</Text>
												<Text fontSize="xs" color="gray.500" dir="ltr">
													{t("nodes.nodeAPIPort", "API port")}:{" "}
													{formatCellValue(node.api_port)}
												</Text>
												{node.use_nobetci && (
													<Text fontSize="xs" color="gray.500" dir="ltr">
														{t("nodes.nobetciPort", "Nobetci")}:{" "}
														{formatCellValue(node.nobetci_port)}
													</Text>
												)}
											</VStack>
										</Td>
										<Td>{statusDisplay}</Td>
										<Td>
											<NodeInboundTags
												tags={inboundSummaries}
												emptyLabel={t(
													"nodes.noInboundsConfigured",
													"No inbounds configured",
												)}
												detailsLabel={t("nodes.inbounds", "Inbounds")}
											/>
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
											<VStack align="flex-start" spacing={1}>
												<Tag size="sm" colorScheme="gray">
													{formatCellValue(node.node_install_mode)}
												</Tag>
												<Text fontSize="xs" color="gray.500">
													{t("nodes.updateChannel", "Channel")}:{" "}
													{formatCellValue(node.node_update_channel)}
												</Text>
											</VStack>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<Text fontWeight="medium">
													{formatBytes(totalUsage, 2)}
												</Text>
												<Text fontSize="xs" color="gray.500">
													{t("nodes.uplink", "Uplink")}:{" "}
													{formatBytes(node.uplink ?? 0, 2)}
												</Text>
												<Text fontSize="xs" color="gray.500">
													{t("nodes.downlink", "Downlink")}:{" "}
													{formatBytes(node.downlink ?? 0, 2)}
												</Text>
											</VStack>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<Text fontWeight="medium">
													{node.data_limit != null && node.data_limit > 0
														? formatBytes(node.data_limit, 2)
														: t("nodes.unlimited", "Unlimited")}
												</Text>
												{remainingData !== null && (
													<Text fontSize="xs" color="gray.500">
														{t("nodes.remainingData", "Remaining data")}:{" "}
														{formatBytes(remainingData, 2)}
													</Text>
												)}
											</VStack>
										</Td>
										<Td>{formatCellValue(node.usage_coefficient)}</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<Tag
													size="sm"
													colorScheme={node.proxy_enabled ? "green" : "gray"}
												>
													{proxyLabel}
												</Tag>
												{node.proxy_username && (
													<Text fontSize="xs" color="gray.500">
														{node.proxy_username}
													</Text>
												)}
											</VStack>
										</Td>
										<Td>
											<VStack align="flex-start" spacing={1}>
												<HStack
													spacing={1}
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
							{!masterMatchesSearch && filteredNodes.length === 0 && (
								<Tr>
									<Td colSpan={13}>
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
					{masterMatchesSearch && (
						<Box
							key="master-node"
							bg={nodeCardBg}
							borderWidth="1px"
							borderColor={nodeCardBorder}
							borderRadius="lg"
							p={6}
							boxShadow="sm"
							_hover={{ boxShadow: "md" }}
							transition="box-shadow 0.2s ease-in-out"
						>
							{masterContent}
						</Box>
					)}

					{filteredNodes.length > 0 ? (
						filteredNodes.map((node) => {
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
							const nodeServiceUpdateAvailable = getNodeServiceUpdateAvailable(
								nodeRuntimeVersion,
								latestNodeVersion,
							);
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
											<Text fontWeight="semibold" fontSize="lg">
												{node.name || t("nodes.unnamedNode", "Unnamed node")}
											</Text>
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
										<HStack spacing={2} flexWrap="wrap">
											{statusDisplay}
											<HStack spacing={1} align="center">
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
											</HStack>
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
									<SimpleGrid columns={{ base: 1, sm: 2 }} spacingY={2}>
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
												{t("nodes.nodePort")}
											</Text>
											<Text fontWeight="medium">{node.port}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.nodeAPIPort")}
											</Text>
											<Text fontWeight="medium">{node.api_port}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.usageCoefficient", "Usage coefficient")}
											</Text>
											<Text fontWeight="medium">{node.usage_coefficient}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.totalUsage", "Total usage")}
											</Text>
											<Text fontWeight="medium">
												{formatBytes(
													(node.uplink ?? 0) + (node.downlink ?? 0),
													2,
												)}
											</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.dataLimitLabel", "Data limit")}
											</Text>
											<Text fontWeight="medium">
												{node.data_limit != null && node.data_limit > 0
													? formatBytes(node.data_limit, 2)
													: t("nodes.unlimited", "Unlimited")}
											</Text>
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
											<DeleteConfirmPopover
												message={t("deleteNode.prompt", {
													name: node.name,
												})}
												isLoading={isDeletingNode}
												onConfirm={() => deleteNodeMutate(node)}
											>
												<IconButton
													aria-label={t("delete")}
													icon={<DeleteIconStyled />}
													colorScheme="red"
												/>
											</DeleteConfirmPopover>
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

			<CoreVersionDialog
				isOpen={Boolean(versionDialogTarget)}
				onClose={closeVersionDialog}
				onSubmit={handleVersionSubmit}
				currentVersion={versionDialogCurrentVersion}
				title={versionDialogTitle}
				description={versionDialogDescription}
				allowPersist={versionDialogTarget?.type === "master"}
				isSubmitting={versionDialogLoading}
			/>
			<GeoUpdateDialog
				isOpen={Boolean(geoDialogTarget)}
				onClose={closeGeoDialog}
				onSubmit={handleGeoSubmit}
				title={geoDialogTitle}
				showMasterOptions={geoDialogTarget?.type === "master"}
				isSubmitting={geoDialogLoading}
			/>
			<Modal isOpen={isMasterEditOpen} onClose={closeMasterEdit} size="md">
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>{t("nodes.editMasterNode", "Edit master")}</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.500">
								{t("nodes.dataLimitLabel", "Data limit")}
							</Text>
							<InputGroup size="sm">
								<NumericInput
									step={0.01}
									min={0}
									value={masterLimitInput}
									onChange={(value) => handleMasterLimitInputChange(value)}
									placeholder={t(
										"nodes.dataLimitPlaceholder",
										"e.g., 500 (empty = unlimited)",
									)}
								/>
								<InputRightElement pointerEvents="none">
									<Text fontSize="xs" color="gray.500">
										GB
									</Text>
								</InputRightElement>
							</InputGroup>
							{masterLimitInvalid && (
								<Text fontSize="xs" color="red.500">
									{t(
										"nodes.dataLimitValidation",
										"Data limit must be a non-negative number",
									)}
								</Text>
							)}
						</VStack>
					</ModalBody>
					<ModalFooter gap={2}>
						<Button variant="ghost" size="sm" onClick={closeMasterEdit}>
							{t("cancel", "Cancel")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleMasterLimitClear}
							isDisabled={masterDataLimit === null || isUpdatingMasterLimit}
							isLoading={isUpdatingMasterLimit && masterDataLimit === null}
						>
							{t("nodes.clearDataLimit", "Clear limit")}
						</Button>
						<Button
							colorScheme="primary"
							size="sm"
							onClick={handleMasterLimitSave}
							isDisabled={
								!hasMasterLimitChanged ||
								masterLimitInvalid ||
								isUpdatingMasterLimit
							}
							isLoading={isUpdatingMasterLimit}
						>
							{t("save", "Save")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
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

			<AlertDialog
				isOpen={isMasterResetOpen}
				leastDestructiveRef={masterResetCancelRef}
				onClose={closeMasterReset}
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
									name: masterLabel,
								},
							)}
						</AlertDialogBody>

						<AlertDialogFooter>
							<Button ref={masterResetCancelRef} onClick={closeMasterReset}>
								{t("cancel", "Cancel")}
							</Button>
							<Button
								colorScheme="red"
								onClick={() => resetMasterUsageMutate()}
								ml={3}
								isLoading={isResettingMasterUsage}
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
			/>
			<NodeFormModal
				isOpen={!!editingNode}
				onClose={() => setEditingNode(null)}
				node={editingNode || undefined}
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
												{t("nodes.certificateLabel")}
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
													if (!generatedCertificateValue) return;
													copyGeneratedCertificate();
													toast({
														title: t("copied"),
														status: "success",
														isClosable: true,
														position: "top",
														duration: 2000,
													});
												}}
												isDisabled={!generatedCertificateValue}
											>
												{generatedCertificateCopied ? t("copied") : t("copy")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												leftIcon={<DownloadIconStyled />}
												onClick={() => {
													if (!generatedCertificateValue) return;
													const blob = new Blob([generatedCertificateValue], {
														type: "text/plain",
													});
													const url = URL.createObjectURL(blob);
													const anchor = document.createElement("a");
													anchor.href = url;
													anchor.download = "node_certificate.pem";
													anchor.click();
													URL.revokeObjectURL(url);
												}}
												isDisabled={!generatedCertificateValue}
											>
												{t("nodes.download-node-certificate")}
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
										{generatedCertificateValue}
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
