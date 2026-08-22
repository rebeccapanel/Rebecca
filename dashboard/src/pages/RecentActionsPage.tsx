import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Divider,
	HStack,
	Input,
	InputGroup,
	InputLeftElement,
	SimpleGrid,
	Spinner,
	Stack,
	Text,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ArrowUturnLeftIcon,
	CheckCircleIcon,
	EyeIcon,
	KeyIcon,
	MagnifyingGlassIcon,
	NoSymbolIcon,
	PencilSquareIcon,
	PlusCircleIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { JsonEditor } from "components/JsonEditor";
import { Pagination } from "components/Pagination";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
	PageHeader,
	ResourceListCard,
} from "components/ui";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import debounce from "lodash.debounce";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { fetch } from "service/http";
import { AdminRole, AdminSudoScope } from "types/Admin";
import { buildJsonDiff } from "utils/jsonDiff";
import {
	getRecentActionsPerPageLimitSize,
	setRecentActionsPerPageLimitSize,
} from "utils/userPreferenceStorage";

type RecentActionOperation =
	| "created"
	| "deleted"
	| "updated"
	| "disabled"
	| "enabled"
	| "reset"
	| "regenerated";

type RecentActionPreview = {
	field?: string;
	before?: string;
	after?: string;
	delta?: string;
	operation?: RecentActionOperation;
	resource?: string;
};

type RecentActionValueChange = Required<
	Pick<RecentActionPreview, "field" | "before" | "after">
> & {
	delta?: string;
};

type RecentAction = {
	id: number;
	action_type: string;
	resource_type: string;
	resource_key: string;
	actor_username: string;
	auth_source: string;
	summary: string;
	rollback_status:
		| "available"
		| "undone"
		| "expired"
		| "conflict"
		| "unsupported";
	created_at: string;
	snapshot_expires_at?: string | null;
	preview?: RecentActionPreview;
	affected_resources?: string[];
};

type RecentActionsResponse = {
	actions: RecentAction[];
	total?: number;
	next_before_id?: number | null;
	action_types?: string[];
	resource_types?: string[];
};

type RecentActionDetail = {
	action: RecentAction;
	snapshot_available: boolean;
	before?: unknown;
	after?: unknown;
	config_changes?: RecentActionConfigChange[];
	config_previews?: RecentActionConfigDisplay[];
	changes?: RecentActionValueChange[];
	affected_resources?: string[];
};

type RecentActionConfigChange = {
	target_id: string;
	path: string;
	kind?: string;
	before?: unknown;
	after?: unknown;
	before_exists: boolean;
	after_exists: boolean;
};

type RecentActionConfigDisplay = RecentActionConfigChange & {
	changed_paths?: string[];
};

const statusTone = (status: RecentAction["rollback_status"]) => {
	switch (status) {
		case "available":
			return "green";
		case "undone":
			return "blue";
		case "conflict":
			return "red";
		case "expired":
			return "orange";
		default:
			return "gray";
	}
};

const actionOperation = (actionType: string) => {
	if (actionType.includes(".create")) return "created" as const;
	if (actionType.includes(".delete")) return "deleted" as const;
	if (actionType.includes(".disable")) return "disabled" as const;
	if (actionType.includes(".enable")) return "enabled" as const;
	if (actionType === "node.usage_reset") return "reset" as const;
	if (actionType === "node.certificate_regenerate")
		return "regenerated" as const;
	return "updated" as const;
};

const actionLifecycle = (action: RecentAction) => {
	return {
		operation: action.preview?.operation ?? actionOperation(action.action_type),
		resource: action.preview?.resource ?? action.resource_type,
	};
};

const nodeRuntimeActionTypes = new Set([
	"node.reconnect",
	"node.restart",
	"node.sync",
	"node.runtime_update",
	"node.geo_update",
	"node.service_restart",
	"node.service_update",
	"node.host_reboot",
]);

const actionOperationVisual = (
	operation: RecentActionOperation,
	actionType: string,
) => {
	if (nodeRuntimeActionTypes.has(actionType))
		return { color: "blue.400", icon: <ArrowPathIcon width={18} /> };
	switch (operation) {
		case "created":
			return { color: "green.400", icon: <PlusCircleIcon width={18} /> };
		case "deleted":
			return { color: "red.400", icon: <TrashIcon width={18} /> };
		case "disabled":
			return { color: "orange.400", icon: <NoSymbolIcon width={18} /> };
		case "enabled":
			return { color: "green.400", icon: <CheckCircleIcon width={18} /> };
		case "reset":
			return { color: "orange.400", icon: <ArrowPathIcon width={18} /> };
		case "regenerated":
			return { color: "blue.400", icon: <KeyIcon width={18} /> };
		default:
			return { color: "blue.400", icon: <PencilSquareIcon width={18} /> };
	}
};

const recentActionLabelKeys: Record<string, string> = {
	"node.usage_reset": "recentActions.actions.nodeUsageReset",
	"node.certificate_regenerate":
		"recentActions.actions.nodeCertificateRegenerated",
	"node.reconnect": "recentActions.actions.nodeReconnected",
	"node.restart": "recentActions.actions.nodeCoreRestarted",
	"node.sync": "recentActions.actions.nodeConfigurationSynced",
	"node.runtime_update": "recentActions.actions.nodeCoreUpdateStarted",
	"node.geo_update": "recentActions.actions.nodeGeoUpdated",
	"node.service_restart": "recentActions.actions.nodeServiceRestarted",
	"node.service_update": "recentActions.actions.nodeServiceUpdated",
	"node.host_reboot": "recentActions.actions.nodeHostRebooted",
};

const recentActionResourceKeys = new Set([
	"host",
	"admin",
	"node",
	"inbound",
	"outbound",
	"service",
	"xray_config",
	"routing",
	"routing_rule",
	"balancer",
	"dns",
	"dns_server",
	"dns_host",
	"log",
	"api",
	"policy",
	"stats",
	"transport",
	"reverse_proxy",
	"metrics",
	"observatory",
	"burst_observatory",
	"fake_dns",
	"services",
]);

const recentActionFieldKeys = new Set([
	"name",
	"role",
	"status",
	"data_limit",
	"users_limit",
	"expire",
	"traffic_limit_mode",
	"service_limits",
	"show_user_traffic",
	"tag",
	"protocol",
	"address",
	"port",
	"settings",
	"servers",
	"rules",
	"domains",
	"domain",
	"network",
	"security",
	"host",
	"path",
	"sni",
	"alpn",
	"fingerprint",
	"flow",
	"loglevel",
	"access",
	"error",
	"listen",
	"services",
	"strategy",
	"outboundTag",
	"inboundTag",
	"balancerTag",
	"domainStrategy",
	"queryStrategy",
	"clientIp",
	"expectIPs",
	"subjectSelector",
	"probeUrl",
	"probeInterval",
	"type",
	"request",
	"response",
	"header",
]);

const resourceTranslationKey = (resource: string) =>
	recentActionResourceKeys.has(resource)
		? `recentActions.resources.${resource}`
		: "recentActions.resources.configuration";

const changedFieldTranslationKey = (path?: string) => {
	const field = path?.split("/").filter(Boolean).at(-1);
	return field && recentActionFieldKeys.has(field)
		? `recentActions.fields.${field}`
		: undefined;
};

const configChangePaths = (change: RecentActionConfigDisplay) =>
	change.changed_paths ?? [change.path];

const actionTypeResource = (actionType: string) => {
	switch (actionType.split(".")[0]) {
		case "host":
		case "inbound":
		case "outbound":
		case "service":
		case "admin":
		case "node":
			return actionType.split(".")[0];
		case "xray":
			return "xray_config";
		default:
			return "configuration";
	}
};

const changedPaths = (
	before: unknown,
	after: unknown,
	path = "",
	output: string[] = [],
) => {
	if (output.length >= 40) return output;
	if (Object.is(before, after)) return output;
	if (
		before &&
		after &&
		typeof before === "object" &&
		typeof after === "object" &&
		!Array.isArray(before) &&
		!Array.isArray(after)
	) {
		const left = before as Record<string, unknown>;
		const right = after as Record<string, unknown>;
		const keys = Array.from(
			new Set([...Object.keys(left), ...Object.keys(right)]),
		).sort();
		for (const key of keys)
			changedPaths(left[key], right[key], `${path}/${key}`, output);
		return output;
	}
	output.push(path || "/");
	return output;
};

const JsonDiffEditors: FC<{ before: unknown; after: unknown }> = ({
	before,
	after,
}) => {
	const { t } = useTranslation();
	const lines = useMemo(() => buildJsonDiff(before, after), [before, after]);
	const beforeChangedLines = useMemo(
		() =>
			lines.flatMap((line) =>
				line.type === "remove" && line.beforeLine ? [line.beforeLine] : [],
			),
		[lines],
	);
	const afterChangedLines = useMemo(
		() =>
			lines.flatMap((line) =>
				line.type === "add" && line.afterLine ? [line.afterLine] : [],
			),
		[lines],
	);
	const beforeHighlightRanges = useMemo(
		() =>
			lines.flatMap((line) =>
				line.type === "remove" &&
				line.beforeLine &&
				line.highlightStart !== undefined &&
				line.highlightEnd !== undefined
					? [
							{
								line: line.beforeLine,
								start: line.highlightStart,
								end: line.highlightEnd,
							},
						]
					: [],
			),
		[lines],
	);
	const afterHighlightRanges = useMemo(
		() =>
			lines.flatMap((line) =>
				line.type === "add" &&
				line.afterLine &&
				line.highlightStart !== undefined &&
				line.highlightEnd !== undefined
					? [
							{
								line: line.afterLine,
								start: line.highlightStart,
								end: line.highlightEnd,
							},
						]
					: [],
			),
		[lines],
	);

	return (
		<SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4} dir="ltr">
			<Box minW={0}>
				<Text fontWeight="medium" mb={2}>
					{t("recentActions.before")}
				</Text>
				<Box h={{ base: "360px", xl: "440px" }}>
					<JsonEditor
						json={before}
						onChange={() => undefined}
						readOnly
						showToolbar={false}
						minHeight={0}
						highlightLines={beforeChangedLines}
						highlightVariant="removed"
						highlightRanges={beforeHighlightRanges}
					/>
				</Box>
			</Box>
			<Box minW={0}>
				<Text fontWeight="medium" mb={2}>
					{t("recentActions.after")}
				</Text>
				<Box h={{ base: "360px", xl: "440px" }}>
					<JsonEditor
						json={after}
						onChange={() => undefined}
						readOnly
						showToolbar={false}
						minHeight={0}
						highlightLines={afterChangedLines}
						highlightVariant="added"
						highlightRanges={afterHighlightRanges}
					/>
				</Box>
			</Box>
		</SimpleGrid>
	);
};

const ActionPreview: FC<{ preview?: RecentActionPreview }> = ({ preview }) => {
	const { t } = useTranslation();
	if (!preview || preview.operation) {
		return <Text color="panel.textMuted">—</Text>;
	}
	const field = changedFieldTranslationKey(preview.field);
	return (
		<VStack align="start" spacing={0.5} minW={0}>
			{field && (
				<Text fontSize="xs" color="panel.textMuted" noOfLines={1}>
					{t(field)}
				</Text>
			)}
			<HStack spacing={1.5} minW={0} maxW="full">
				<Text color="red.300" textDecoration="line-through" noOfLines={1}>
					{preview.before}
				</Text>
				<Text color="panel.textMuted">→</Text>
				<Text color="green.300" noOfLines={1}>
					{preview.after}
				</Text>
				{preview.delta && (
					<Text color="panel.textMuted" noOfLines={1}>
						({preview.delta})
					</Text>
				)}
			</HStack>
		</VStack>
	);
};

export const RecentActionsPage: FC = () => {
	const { t, i18n } = useTranslation();
	const queryClient = useQueryClient();
	const { userData, getUserIsSuccess } = useGetUser();
	const canView =
		getUserIsSuccess &&
		(userData.role === AdminRole.FullAccess ||
			(userData.role === AdminRole.Sudo &&
				Boolean(userData.permissions?.sudo?.[AdminSudoScope.Xray])));
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(() =>
		getRecentActionsPerPageLimitSize(),
	);
	const [selectedID, setSelectedID] = useState<number | null>(null);
	const [search, setSearch] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [actionTypesFilter, setActionTypesFilter] = useState<string[]>([]);
	const [resourceTypesFilter, setResourceTypesFilter] = useState<string[]>([]);
	const [statusesFilter, setStatusesFilter] = useState<string[]>([]);
	const [dayFilter, setDayFilter] = useState("");
	const resetPagination = useCallback(() => {
		setPageIndex(0);
		setSelectedID(null);
	}, []);
	const debouncedSearchChange = useMemo(
		() =>
			debounce((value: string) => {
				setSearchQuery(value.trim());
				resetPagination();
			}, 300),
		[resetPagination],
	);
	useEffect(
		() => () => debouncedSearchChange.cancel(),
		[debouncedSearchChange],
	);

	const actionsQueryString = useMemo(() => {
		const params = new URLSearchParams({
			limit: String(pageSize),
			offset: String(pageIndex * pageSize),
		});
		if (searchQuery) params.set("search", searchQuery);
		if (dayFilter) params.set("day", dayFilter);
		for (const value of actionTypesFilter) params.append("action_type", value);
		for (const value of resourceTypesFilter)
			params.append("resource_type", value);
		for (const value of statusesFilter) params.append("status", value);
		return params.toString();
	}, [
		actionTypesFilter,
		dayFilter,
		pageIndex,
		pageSize,
		resourceTypesFilter,
		searchQuery,
		statusesFilter,
	]);
	const actionsQuery = useQuery(
		["recent-actions", actionsQueryString],
		() =>
			fetch<RecentActionsResponse>(
				`/core/recent-actions?${actionsQueryString}`,
			),
		{
			enabled: canView,
			staleTime: 15_000,
			refetchOnWindowFocus: false,
			keepPreviousData: true,
		},
	);
	const detailQuery = useQuery(
		["recent-action", selectedID],
		() => fetch<RecentActionDetail>(`/core/recent-actions/${selectedID}`),
		{ enabled: canView && selectedID !== null, refetchOnWindowFocus: false },
	);
	const rollbackMutation = useMutation(
		(id: number) =>
			fetch(`/core/recent-actions/${id}/rollback`, { method: "POST" }),
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries("recent-actions");
				if (selectedID !== null) {
					await queryClient.invalidateQueries(["recent-action", selectedID]);
				}
			},
		},
	);

	const actions = actionsQuery.data?.actions ?? [];
	const totalActions = actionsQuery.data?.total ?? actions.length;
	useEffect(() => {
		const lastPage = Math.max(0, Math.ceil(totalActions / pageSize) - 1);
		if (pageIndex > lastPage) setPageIndex(lastPage);
	}, [pageIndex, pageSize, totalActions]);
	const selectedAction =
		selectedID === null
			? undefined
			: actions.find((action) => action.id === selectedID);
	const actionTypes = useMemo(
		() =>
			actionsQuery.data?.action_types ??
			Array.from(new Set(actions.map((action) => action.action_type))).sort(),
		[actions, actionsQuery.data?.action_types],
	);
	const actionTypeLabel = useCallback((type: string) => {
		const labelKey = recentActionLabelKeys[type];
		if (labelKey) return t(labelKey);
		const resource = t(resourceTranslationKey(actionTypeResource(type)));
		return t(`recentActions.operations.${actionOperation(type)}`, { resource });
	}, [t]);
	const resourceTypes = useMemo(
		() =>
			actionsQuery.data?.resource_types ??
			Array.from(new Set(actions.map((action) => action.resource_type))).sort(),
		[actions, actionsQuery.data?.resource_types],
	);

	const rollback = (action: RecentAction) => {
		if (!window.confirm(t("recentActions.rollbackConfirm"))) return;
		rollbackMutation.mutate(action.id);
	};
	const toggleDetails = useCallback((actionID: number) => {
		setSelectedID((current) => (current === actionID ? null : actionID));
	}, []);
	const changePageSize = (value: string | string[]) => {
		const next = Number(Array.isArray(value) ? value[0] : value);
		if (![10, 20, 30, 50, 100].includes(next)) return;
		setPageSize(next);
		setRecentActionsPerPageLimitSize(String(next));
		resetPagination();
	};
	const columns = useMemo<DataTableColumn<RecentAction>[]>(
		() => [
			{
				id: "action",
				header: t("recentActions.columns.action"),
				isPrimary: true,
				priority: "primary",
				minWidth: "190px",
				cell: (action) => {
					const lifecycle = actionLifecycle(action);
					const operation = lifecycle.operation;
					const visual = actionOperationVisual(operation, action.action_type);
					const label =
						(action.affected_resources?.length ?? 0) > 1 ||
						(action.action_type === "node.service_update" &&
							action.resource_key.endsWith(" nodes"))
							? action.summary
							: actionTypeLabel(action.action_type);
					return (
						<HStack align="start" spacing={2.5} minW={0}>
							<Box color={visual.color} mt={0.5} flexShrink={0}>
								{visual.icon}
							</Box>
							<VStack align="start" spacing={0} minW={0}>
								<Text fontWeight="semibold" noOfLines={1} maxW="full">
									{label}
								</Text>
							</VStack>
						</HStack>
					);
				},
			},
			{
				id: "resource",
				header: t("recentActions.columns.resource"),
				priority: "high",
				minWidth: "180px",
				cell: (action) => {
					const resourceType = actionLifecycle(action).resource;
					return (
						<VStack align="start" spacing={1} minW={0}>
							<Badge variant="subtle">
								{t(resourceTranslationKey(resourceType))}
							</Badge>
							<Text
								fontFamily="mono"
								fontSize="xs"
								color="panel.textMuted"
								noOfLines={1}
							>
								{action.resource_key}
							</Text>
						</VStack>
					);
				},
			},
			{
				id: "preview",
				header: t("recentActions.columns.preview"),
				priority: "high",
				minWidth: "220px",
				mobileSummary: true,
				cell: (action) => <ActionPreview preview={action.preview} />,
			},
			{
				id: "status",
				header: t("recentActions.columns.status"),
				priority: "medium",
				minWidth: "140px",
				cell: (action) => (
					<Badge colorScheme={statusTone(action.rollback_status)}>
						{t(`recentActions.status.${action.rollback_status}`)}
					</Badge>
				),
			},
			{
				id: "actor",
				header: t("recentActions.columns.actor"),
				priority: "medium",
				minWidth: "140px",
				cell: (action) => (
					<VStack align="start" spacing={0}>
						<Text fontWeight="medium">{action.actor_username}</Text>
						<Text fontSize="xs" color="panel.textMuted">
							{action.auth_source}
						</Text>
					</VStack>
				),
			},
			{
				id: "created",
				header: t("recentActions.columns.time"),
				priority: "low",
				hideBelow: "xl",
				minWidth: "160px",
				accessor: "created_at",
				sortable: true,
				cell: (action) => (
					<Text fontSize="sm" dir="ltr">
						{dayjs(action.created_at).format("YYYY-MM-DD HH:mm")}
					</Text>
				),
			},
		],
		[actionTypeLabel, t],
	);
	const rowActions = (
		action: RecentAction,
	): DataTableRowAction<RecentAction>[] => [
		{
			id: "details",
			label: t("recentActions.details"),
			icon: <EyeIcon width={16} />,
			onClick: () => toggleDetails(action.id),
		},
		...(action.rollback_status === "available"
			? [
					{
						id: "rollback",
						label: t("recentActions.rollback"),
						icon: <ArrowUturnLeftIcon width={16} />,
						isDanger: true,
						onClick: () => rollback(action),
					},
				]
			: []),
	];

	if (!canView) {
		return (
			<Alert status="error" borderRadius="md">
				<AlertIcon />
				{t("recentActions.noPermission")}
			</Alert>
		);
	}

	const detail = detailQuery.data;
	const eventChanges = detail?.changes ?? [];
	const affectedResources =
		detail?.affected_resources?.length
			? detail.affected_resources
			: (selectedAction?.affected_resources ?? []);
	const configChanges = detail?.config_changes ?? [];
	const configPreviews = detail?.config_previews ?? [];
	const displayConfigChanges: RecentActionConfigDisplay[] =
		configPreviews.length > 0 ? configPreviews : configChanges;
	const diffPaths =
		displayConfigChanges.length > 0
			? displayConfigChanges.flatMap(configChangePaths)
			: detail?.snapshot_available
				? changedPaths(detail.before, detail.after)
				: [];
	const diffPathLabels = Array.from(
		new Set(
			diffPaths
				.map(changedFieldTranslationKey)
				.filter((key): key is string => Boolean(key)),
		),
	);
	const rollbackError = rollbackMutation.error as {
		data?: { detail?: string; conflict_paths?: string[] };
		message?: string;
	} | null;
	const rollbackErrorDetail =
		rollbackError?.data?.detail || rollbackError?.message;
	const rollbackConflictPaths = rollbackError?.data?.conflict_paths ?? [];
	const renderDetailPanel = () => (
		<Box borderTopWidth="1px" borderColor="panel.border" pt={4}>
			<Text fontWeight="semibold" mb={4}>
				{t("recentActions.changePreview")}
			</Text>
			{detailQuery.isLoading ? (
				<HStack justify="center" py={10}>
					<Spinner />
				</HStack>
			) : detailQuery.isError ? (
				<Alert status="error">
					<AlertIcon />
					{t("recentActions.loadFailed")}
				</Alert>
			) : detail?.snapshot_available || affectedResources.length > 0 ? (
				<Stack spacing={4}>
					{eventChanges.length > 0 && (
						<Stack spacing={2}>
							<Text fontSize="sm" color="panel.textSecondary">
								{t("recentActions.changedValues")}
							</Text>
							{eventChanges.map((change) => {
								const labelKey = changedFieldTranslationKey(change.field);
								return (
									<HStack key={change.field} spacing={2} flexWrap="wrap">
										<Text fontSize="sm" minW="140px" color="panel.textMuted">
											{labelKey ? t(labelKey) : change.field.replaceAll("_", " ")}
										</Text>
										<Text color="red.300" textDecoration="line-through">
											{change.before}
										</Text>
										<Text color="panel.textMuted">→</Text>
										<Text color="green.300">{change.after}</Text>
										{change.delta && (
											<Text color="panel.textMuted">({change.delta})</Text>
										)}
									</HStack>
								);
							})}
						</Stack>
					)}
					{affectedResources.length > 0 && (
						<Box>
							<Text fontSize="sm" color="panel.textSecondary" mb={2}>
								{t("recentActions.affectedResources")}
							</Text>
							<HStack spacing={2} flexWrap="wrap">
								{affectedResources.map((resource) => (
									<Badge key={resource} variant="subtle">
										{resource}
									</Badge>
								))}
							</HStack>
						</Box>
					)}
					{diffPathLabels.length > 0 && (
						<Box>
							<Text fontSize="sm" color="panel.textSecondary" mb={2}>
								{t("recentActions.changedPaths")}
							</Text>
							<HStack spacing={2} flexWrap="wrap">
								{diffPathLabels.map((label) => (
									<Badge key={label} colorScheme="orange">
										{t(label)}
									</Badge>
								))}
							</HStack>
						</Box>
					)}
					{displayConfigChanges.length > 0 ? (
						<Stack spacing={4}>
							{displayConfigChanges.map((change, index) => {
								const paths = configChangePaths(change);
								const labels = Array.from(
									new Set(
										paths
											.map(changedFieldTranslationKey)
											.filter((key): key is string => Boolean(key)),
									),
								);
								return (
									<Box
										key={`${change.target_id}-${change.path}-${index}`}
										borderWidth="1px"
										borderColor="panel.border"
										borderRadius="md"
										p={3}
									>
										{labels.length > 0 && (
											<Text fontSize="sm" color="panel.textSecondary" mb={3}>
												{labels.map((label) => t(label)).join(" · ")}
											</Text>
										)}
										<JsonDiffEditors
											before={change.before_exists ? change.before : undefined}
											after={change.after_exists ? change.after : undefined}
										/>
									</Box>
								);
							})}
						</Stack>
					) : eventChanges.length === 0 && affectedResources.length === 0 ? (
						<JsonDiffEditors before={detail?.before} after={detail?.after} />
					) : null}
				</Stack>
			) : (
				<Alert status="info">
					<AlertIcon />
					{t(
						detail?.action.rollback_status === "unsupported"
							? "recentActions.historyOnly"
							: "recentActions.snapshotExpired",
					)}
				</Alert>
			)}
			{rollbackMutation.isError && (
				<>
					<Divider my={4} />
					<Alert status="error">
						<AlertIcon />
						<Stack spacing={2}>
							<Text>{rollbackErrorDetail || t("recentActions.rollbackFailed")}</Text>
							{rollbackConflictPaths.length > 0 && (
								<HStack spacing={2} flexWrap="wrap">
									{rollbackConflictPaths.map((path) => (
										<Badge key={path} colorScheme="red">
											{path}
										</Badge>
									))}
								</HStack>
							)}
						</Stack>
					</Alert>
				</>
			)}
		</Box>
	);

	return (
		<VStack
			spacing={4}
			align="stretch"
			dir={i18n.dir(i18n.language)}
			pb={{ base: 8, md: 16 }}
		>
			<PageHeader
				title={t("recentActions.title")}
				description={t("recentActions.description")}
				actions={
					<Button
						leftIcon={<ArrowPathIcon width={16} />}
						variant="outline"
						onClick={() => void actionsQuery.refetch()}
						isLoading={actionsQuery.isFetching}
					>
						{t("recentActions.refresh")}
					</Button>
				}
			/>

			<ResourceListCard
				title={t("recentActions.title")}
				summaryItems={[
					{ label: t("total"), value: totalActions },
					{
						label: t("usersPage.filtered"),
						value: totalActions,
						colorScheme: "green",
					},
				]}
			>
				<Stack
					direction={{ base: "column", xl: "row" }}
					spacing={2}
					align="stretch"
				>
					<InputGroup size="sm" w={{ base: "full", md: "300px" }}>
						<InputLeftElement pointerEvents="none">
							<MagnifyingGlassIcon width={16} />
						</InputLeftElement>
						<Input
							value={search}
							onChange={(event) => {
								setSearch(event.target.value);
								debouncedSearchChange(event.target.value);
							}}
							placeholder={t("recentActions.searchPlaceholder")}
							aria-label={t("recentActions.searchPlaceholder")}
						/>
					</InputGroup>
					<Select
						mode="multiple"
						size="sm"
						value={actionTypesFilter}
						onValueChange={(value) => {
							setActionTypesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}}
						options={actionTypes.map((type) => ({
							label: actionTypeLabel(type),
							value: type,
						}))}
						placeholder={t("recentActions.filters.allActions")}
						aria-label={t("recentActions.filters.action")}
						w={{ base: "full", xl: "240px" }}
					/>
					<Select
						mode="multiple"
						size="sm"
						value={resourceTypesFilter}
						onValueChange={(value) => {
							setResourceTypesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}}
						options={resourceTypes.map((type) => ({
							label: t(resourceTranslationKey(type)),
							value: type,
						}))}
						placeholder={t("recentActions.filters.allResources")}
						aria-label={t("recentActions.filters.resource")}
						w={{ base: "full", xl: "220px" }}
					/>
					<Select
						mode="multiple"
						size="sm"
						value={statusesFilter}
						onValueChange={(value) => {
							setStatusesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}}
						options={[
							"available",
							"undone",
							"expired",
							"conflict",
							"unsupported",
						].map((value) => ({
							label: t(`recentActions.status.${value}`),
							value,
						}))}
						placeholder={t("recentActions.filters.allStatuses")}
						aria-label={t("recentActions.filters.status")}
						w={{ base: "full", xl: "190px" }}
					/>
					<Input
						type="date"
						size="sm"
						value={dayFilter}
						onChange={(event) => {
							setDayFilter(event.target.value);
							resetPagination();
						}}
						aria-label={t("recentActions.filters.day")}
						w={{ base: "full", xl: "170px" }}
					/>
				</Stack>
			</ResourceListCard>

			<DataTable
				ariaLabel={t("recentActions.title")}
				data={actions}
				columns={columns}
				getRowId={(action) => String(action.id)}
				isLoading={actionsQuery.isLoading}
				loadingRows={8}
				error={actionsQuery.isError ? t("recentActions.loadFailed") : undefined}
				emptyState={
					<Text fontSize="sm" color="panel.textMuted" textAlign="center">
						{actions.length
							? t("recentActions.noMatching")
							: t("recentActions.empty")}
					</Text>
				}
				rowActions={rowActions}
				renderRowActions={(action) => (
					<HStack spacing={2} justify="flex-end">
						<Button
							size="sm"
							variant="outline"
							leftIcon={<EyeIcon width={16} />}
							onClick={() => toggleDetails(action.id)}
						>
							{t("recentActions.details")}
						</Button>
						{action.rollback_status === "available" && (
							<Button
								size="sm"
								colorScheme="orange"
								leftIcon={<ArrowUturnLeftIcon width={16} />}
								onClick={() => rollback(action)}
								isLoading={
									rollbackMutation.isLoading &&
									rollbackMutation.variables === action.id
								}
							>
								{t("recentActions.rollback")}
							</Button>
						)}
					</HStack>
				)}
				actionsDisplay="inline"
				actionsColumnWidth="210px"
				actionsAlwaysVisible
				onRowClick={(action) => toggleDetails(action.id)}
				isRowExpanded={(action) => action.id === selectedID}
				renderExpandedRow={renderDetailPanel}
				mobileBreakpoint="md"
				pagination={
					<Pagination
						total={totalActions}
						limit={pageSize}
						offset={pageIndex * pageSize}
						onPageChange={(page) => {
							setPageIndex(page);
							setSelectedID(null);
						}}
						onPageSizeChange={(next) => changePageSize(String(next))}
					/>
				}
			/>
		</VStack>
	);
};
