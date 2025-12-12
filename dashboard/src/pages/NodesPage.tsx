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
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Tag,
	Text,
	Tooltip,
	useClipboard,
	useDisclosure,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	PlusIcon as AddIcon,
	ArrowDownTrayIcon,
	ArrowPathIcon,
	TrashIcon as DeleteIcon,
	DocumentDuplicateIcon,
	PencilIcon as EditIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
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
import { fetch as apiFetch } from "service/http";
import type { Status as UserStatus } from "types/User";
import { formatBytes } from "utils/formatByte";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { DeleteNodeModal } from "../components/DeleteNodeModal";
import { GeoUpdateDialog } from "../components/GeoUpdateDialog";
import { NodeFormModal } from "../components/NodeFormModal";
import { NodeModalStatusBadge } from "../components/NodeModalStatusBadge";

const normalizeVersion = (value?: string | null) => {
	if (!value) return "";
	// Remove leading 'v' or 'vv', remove '-alpha', '-beta', '-rc' etc. suffixes, and trim
	return value.trim().replace(/^v+/i, "").split(/[-_]/)[0].trim();
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

const BYTES_IN_GB = 1024 ** 3;

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

export const NodesPage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canManageNodes =
		getUserIsSuccess && Boolean(userData.permissions?.sections.nodes);
	const { onEditingNodes } = useDashboard();
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
		setDeletingNode,
	} = useNodes();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [editingNode, setEditingNode] = useState<NodeType | null>(null);
	const [isAddNodeOpen, setAddNodeOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
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
	const masterResetCancelRef = useRef<HTMLButtonElement | null>(null);

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
	const latestNodeRelease = useQuery({
		queryKey: ["node-latest-release"],
		queryFn: async () => {
			const response = await window.fetch(
				"https://api.github.com/repos/rebeccapanel/Rebecca-node/releases/latest",
				{ headers: { Accept: "application/vnd.github+json" } },
			);
			if (!response.ok) throw new Error("Failed to load latest node release");
			return response.json();
		},
		refetchOnWindowFocus: false,
		staleTime: 5 * 60 * 1000,
		retry: 1,
		enabled: canManageNodes,
	});

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

	const currentNodeVersion = useMemo(
		() =>
			nodes?.find((nodeItem) => nodeItem.node_service_version)
				?.node_service_version ?? "",
		[nodes],
	);
	const latestNodeVersion =
		latestNodeRelease.data?.tag_name || latestNodeRelease.data?.name || "";
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
		updateServiceMutate(node);
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
			<Stack spacing={1}>
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
					</HStack>
					<Stack
						direction={{ base: "column", sm: "row" }}
						spacing={2}
						justify="flex-end"
						alignItems={{ base: "flex-end", sm: "center" }}
					>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setVersionDialogTarget({ type: "bulk" })}
							isDisabled={!hasConnectedNodes}
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

			{isLoading ? (
				<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
					{Array.from({ length: 3 }, (_, idx) => `nodes-skeleton-${idx}`).map(
						(skeletonKey) => (
							<Box
								key={skeletonKey}
								borderWidth="1px"
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
			) : (
				<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
					{masterMatchesSearch && (
						<Box
							key="master-node"
							borderWidth="1px"
							borderRadius="lg"
							p={6}
							boxShadow="sm"
							_hover={{ boxShadow: "md" }}
							transition="box-shadow 0.2s ease-in-out"
						>
							{isMasterCardLoading ? (
								<VStack spacing={3} align="center" justify="center">
									<Spinner />
									<Text
										fontSize="sm"
										color="gray.500"
										_dark={{ color: "gray.400" }}
									>
										{t("loading")}
									</Text>
								</VStack>
							) : masterErrorMessage ? (
								<VStack spacing={3} align="stretch">
									<Text
										fontSize="sm"
										color="gray.500"
										_dark={{ color: "gray.400" }}
									>
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
									<Text
										fontSize="sm"
										color="gray.500"
										_dark={{ color: "gray.400" }}
									>
										{t(
											"nodes.masterLoadFailed",
											"Unable to load master details.",
										)}
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
											<Tag colorScheme="purple" size="sm">
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
										<Text
											fontSize="sm"
											color="gray.500"
											_dark={{ color: "gray.400" }}
										>
											{coreStats?.started
												? t("nodes.masterStartedAt", {
														date: dayjs(coreStats.started)
															.local()
															.format("YYYY-MM-DD HH:mm"),
													})
												: t(
														"nodes.masterStartedUnknown",
														"Start time unavailable",
													)}
										</Text>
									</Stack>
									{masterState.message && (
										<Alert
											status="warning"
											variant="left-accent"
											borderRadius="md"
										>
											<AlertIcon />
											<AlertDescription fontSize="sm">
												{masterState.message}
											</AlertDescription>
										</Alert>
									)}
									<Divider />
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.totalUsage", "Total usage")}
											</Text>
											<Text fontWeight="medium">{masterUsageDisplay}</Text>
										</Box>
										<Box>
											<Text
												fontSize="xs"
												textTransform="uppercase"
												color="gray.500"
											>
												{t("nodes.dataLimitLabel", "Data limit")}
											</Text>
											<Text fontWeight="medium">{masterDataLimitDisplay}</Text>
										</Box>
										{masterRemainingDisplay && (
											<Box>
												<Text
													fontSize="xs"
													textTransform="uppercase"
													color="gray.500"
												>
													{t("nodes.remainingData", "Remaining data")}
												</Text>
												<Text fontWeight="medium">
													{masterRemainingDisplay}
												</Text>
											</Box>
										)}
										{masterUpdatedAt && (
											<Box>
												<Text
													fontSize="xs"
													textTransform="uppercase"
													color="gray.500"
												>
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
											<Input
												type="number"
												step="0.01"
												min={0}
												inputMode="decimal"
												value={masterLimitInput}
												onChange={(event) =>
													handleMasterLimitInputChange(event.target.value)
												}
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
											isDisabled={
												masterDataLimit === null || isUpdatingMasterLimit
											}
											isLoading={
												isUpdatingMasterLimit && masterDataLimit === null
											}
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
							)}
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
							const statusBadge = (
								<NodeModalStatusBadge status={status} compact />
							);
							const statusDisplay =
								status === "error" && node.message ? (
									<Tooltip
										label={node.message}
										hasArrow
										placement="top"
										openDelay={300}
									>
										<Box as="span">{statusBadge}</Box>
									</Tooltip>
								) : (
									statusBadge
								);

							return (
								<Box
									key={node.id ?? node.name}
									borderWidth="1px"
									borderRadius="lg"
									p={6}
									boxShadow="sm"
									_hover={{ boxShadow: "md" }}
									transition="box-shadow 0.2s ease-in-out"
								>
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
													<Tag colorScheme="blue" size="sm">
														{node.xray_version
															? `Xray ${node.xray_version}`
															: t("nodes.versionUnknown", "Version unknown")}
													</Tag>
													<Tag colorScheme="green" size="sm">
														{node.node_service_version
															? t("nodes.nodeServiceVersionTag", {
																	version: node.node_service_version,
																})
															: t(
																	"nodes.nodeServiceVersionUnknown",
																	"Node version unknown",
																)}
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
														isDisabled={!nodeId}
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
													isDisabled={!nodeId}
												>
													{t("nodes.updateGeoAction", "Update geo")}
												</Button>
												<Button
													size="xs"
													variant="ghost"
													colorScheme="orange"
													onClick={() => handleRestartNodeService(node)}
													isLoading={isRestartingMaintenance}
													isDisabled={!nodeId}
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
													isDisabled={!nodeId}
												>
													{t(
														"nodes.updateServiceAction",
														"Update node service",
													)}
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
												<Text fontWeight="medium">{node.address}</Text>
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
												<Text fontWeight="medium">
													{node.usage_coefficient}
												</Text>
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
												<IconButton
													aria-label={t("delete")}
													icon={<DeleteIconStyled />}
													colorScheme="red"
													onClick={() => setDeletingNode(node)}
												/>
											</ButtonGroup>
										</HStack>
									</VStack>
								</Box>
							);
						})
					) : (
						<Box
							borderWidth="1px"
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
			<DeleteNodeModal
				deleteCallback={() => queryClient.invalidateQueries(FetchNodesQueryKey)}
			/>
		</VStack>
	);
};

export default NodesPage;
