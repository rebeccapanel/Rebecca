import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Alert } from "components/ui/alert";
import { Spinner } from "components/ui/spinner";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";
import { RefreshCw, Undo2, CircleCheck, Eye, Key, Ban, SquarePen, CirclePlus, Trash2 } from "lucide-react";
import type { SortingState } from "@tanstack/react-table";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";

import { PanelSelect as Select } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { OverviewBand } from "components/ui/overview-band";
import { JsonEditor } from "components/JsonEditor";
import { Pagination } from "components/Pagination";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
} from "components/ui";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import debounce from "lodash.debounce";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { fetch } from "service/http";
import { AdminRole, AdminSudoScope } from "types/Admin";
import { buildJsonDiff } from "utils/jsonDiff";
import {
	addSearchMatchQuery,
	DEFAULT_SEARCH_MATCH_OPTIONS,
} from "utils/searchMatch";
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
		return { color: "var(--color-blue-400)", icon: <RefreshCw className="w-[18px]" /> };
	switch (operation) {
		case "created":
			return { color: "var(--color-green-400)", icon: <CirclePlus className="w-[18px]" /> };
		case "deleted":
			return { color: "var(--color-red-400)", icon: <Trash2 className="w-[18px]" /> };
		case "disabled":
			return { color: "var(--color-orange-400)", icon: <Ban className="w-[18px]" /> };
		case "enabled":
			return { color: "var(--color-green-400)", icon: <CircleCheck className="w-[18px]" /> };
		case "reset":
			return { color: "var(--color-orange-400)", icon: <RefreshCw className="w-[18px]" /> };
		case "regenerated":
			return { color: "var(--color-blue-400)", icon: <Key className="w-[18px]" /> };
		default:
			return { color: "var(--color-blue-400)", icon: <SquarePen className="w-[18px]" /> };
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
		<div dir="ltr" className="grid grid-cols-1 xl:grid-cols-2 gap-4">
			<div className="min-w-0!">
				<p className="font-medium mb-2">
					{t("recentActions.before")}
				</p>
				<div className="h-[360px] xl:h-[440px]">
					<JsonEditor json={before} onChange={() => undefined} readOnly showToolbar={false} highlightLines={beforeChangedLines} highlightVariant="removed" highlightRanges={beforeHighlightRanges} />
				</div>
			</div>
			<div className="min-w-0!">
				<p className="font-medium mb-2">
					{t("recentActions.after")}
				</p>
				<div className="h-[360px] xl:h-[440px]">
					<JsonEditor json={after} onChange={() => undefined} readOnly showToolbar={false} highlightLines={afterChangedLines} highlightVariant="added" highlightRanges={afterHighlightRanges} />
				</div>
			</div>
		</div>
	);
};

const ActionPreview: FC<{ preview?: RecentActionPreview }> = ({ preview }) => {
	const { t } = useTranslation();
	if (!preview || preview.operation) {
		return <p className="text-panel-text-muted">—</p>;
	}
	const field = changedFieldTranslationKey(preview.field);
	return (
		<div className="flex flex-col items-start gap-0.5 min-w-0!">
			{field && (
				<p className="text-[0.75rem] text-panel-text-muted truncate">
					{t(field)}
				</p>
			)}
			<div className="flex flex-row items-center gap-1.5 min-w-0! max-w-full">
				<p className="text-red-300 line-through truncate">
					{preview.before}
				</p>
				<p className="text-panel-text-muted">→</p>
				<p className="text-green-300 truncate">
					{preview.after}
				</p>
				{preview.delta && (
					<p className="text-panel-text-muted truncate">
						({preview.delta})
					</p>
				)}
			</div>
		</div>
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
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
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
		addSearchMatchQuery(params, searchMatch);
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
		searchMatch,
		statusesFilter,
	]);
	const actionsQuery = useQuery({ queryKey: ["recent-actions", actionsQueryString], queryFn: () =>
			fetch<RecentActionsResponse>(
				`/core/recent-actions?${actionsQueryString}`,
			), enabled: canView,
			staleTime: 15_000,
			refetchOnWindowFocus: false,
			placeholderData: keepPreviousData, });
	const detailQuery = useQuery({ queryKey: ["recent-action", selectedID], queryFn: () => fetch<RecentActionDetail>(`/core/recent-actions/${selectedID}`), enabled: canView && selectedID !== null, refetchOnWindowFocus: false });
	const rollbackMutation = useMutation({ mutationFn: (id: number) =>
			fetch(`/core/recent-actions/${id}/rollback`, { method: "POST" }), onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: ["recent-actions"] });
				if (selectedID !== null) {
					await queryClient.invalidateQueries({ queryKey: ["recent-action", selectedID] });
				}
			}, });

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
	const actionTypeLabel = useCallback(
		(type: string) => {
		const labelKey = recentActionLabelKeys[type];
		if (labelKey) return t(labelKey);
		const resource = t(resourceTranslationKey(actionTypeResource(type)));
			return t(`recentActions.operations.${actionOperation(type)}`, {
				resource,
			});
		},
		[t],
	);
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
	const [recentSorting, setRecentSorting] = useState<SortingState>([]);
	const columns = useMemo<DataTableColumn<RecentAction>[]>(
		() => [
			{
				id: "action",
				sortValue: (action) => action.action_type ?? "",
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
						<div className="flex flex-row items-start gap-2.5 min-w-0!">
							<div style={{ color: visual.color }} className="mt-0.5 shrink-0">
								{visual.icon}
							</div>
							<div className="flex flex-col items-start gap-0 min-w-0!">
								<p className="font-semibold truncate max-w-full">
									{label}
								</p>
							</div>
						</div>
					);
				},
			},
			{
				id: "resource",
				sortValue: (action) => action.resource_key ?? "",
				header: t("recentActions.columns.resource"),
				priority: "high",
				minWidth: "180px",
				cell: (action) => {
					const resourceType = actionLifecycle(action).resource;
					return (
						<div className="flex flex-col items-start gap-1 min-w-0!">
							<Badge>
								{t(resourceTranslationKey(resourceType))}
							</Badge>
							<p className="font-mono text-[0.75rem] text-panel-text-muted truncate">
								{action.resource_key}
							</p>
						</div>
					);
				},
			},
			{
				id: "preview",
				sortValue: (action) => action.preview ?? "",
				header: t("recentActions.columns.preview"),
				priority: "high",
				minWidth: "220px",
				mobileSummary: true,
				cell: (action) => <ActionPreview preview={action.preview} />,
			},
			{
				id: "status",
				sortValue: (action) => action.rollback_status ?? "",
				header: t("recentActions.columns.status"),
				priority: "medium",
				minWidth: "140px",
				cell: (action) => (
					<Badge className={toneClass(statusTone(action.rollback_status))}>
						{t(`recentActions.status.${action.rollback_status}`)}
					</Badge>
				),
			},
			{
				id: "actor",
				sortValue: (action) => action.actor_username ?? "",
				header: t("recentActions.columns.actor"),
				priority: "medium",
				minWidth: "140px",
				cell: (action) => (
					<div className="flex flex-col items-start gap-0">
						<p className="font-medium">{action.actor_username}</p>
						<p className="text-[0.75rem] text-panel-text-muted">
							{action.auth_source}
						</p>
					</div>
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
					<p dir="ltr" className="text-[0.875rem]">
						{dayjs(action.created_at).format("YYYY-MM-DD HH:mm")}
					</p>
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
			icon: <Eye className="w-[16px]" />,
			onClick: () => toggleDetails(action.id),
		},
		...(action.rollback_status === "available"
			? [
					{
						id: "rollback",
						label: t("recentActions.rollback"),
						icon: <Undo2 className="w-[16px]" />,
						isDanger: true,
						onClick: () => rollback(action),
					},
				]
			: []),
	];

	if (!canView) {
		return (
			<Alert variant="destructive" className="rounded-md">
				<CircleAlert className="size-4" aria-hidden="true" />
				{t("recentActions.noPermission")}
			</Alert>
		);
	}

	const detail = detailQuery.data;
	const eventChanges = detail?.changes ?? [];
	const affectedResources = detail?.affected_resources?.length
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
		<div className="border-t border-panel-border! pt-4">
			<p className="font-semibold mb-4">
				{t("recentActions.changePreview")}
			</p>
			{detailQuery.isLoading ? (
				<div className="flex flex-row items-center gap-2 justify-center py-10">
					<Spinner />
				</div>
			) : detailQuery.isError ? (
				<Alert variant="destructive">
					<CircleAlert className="size-4" aria-hidden="true" />
					{t("recentActions.loadFailed")}
				</Alert>
			) : detail?.snapshot_available || affectedResources.length > 0 ? (
				<div className="flex flex-col gap-4">
					{eventChanges.length > 0 && (
						<div className="flex flex-col gap-2">
							<p className="text-[0.875rem] text-panel-text-secondary">
								{t("recentActions.changedValues")}
							</p>
							{eventChanges.map((change) => {
								const labelKey = changedFieldTranslationKey(change.field);
								return (
									<div key={change.field} className="flex flex-row items-center gap-2 flex-wrap">
										<p className="text-[0.875rem] min-w-[140px]! text-panel-text-muted">
											{labelKey
												? t(labelKey)
												: change.field.replaceAll("_", " ")}
										</p>
										<p className="text-red-300 line-through">
											{change.before}
										</p>
										<p className="text-panel-text-muted">→</p>
										<p className="text-green-300">{change.after}</p>
										{change.delta && (
											<p className="text-panel-text-muted">({change.delta})</p>
										)}
									</div>
								);
							})}
						</div>
					)}
					{affectedResources.length > 0 && (
						<div>
							<p className="text-[0.875rem] text-panel-text-secondary mb-2">
								{t("recentActions.affectedResources")}
							</p>
							<div className="flex flex-row items-center gap-2 flex-wrap">
								{affectedResources.map((resource) => (
									<Badge key={resource}>
										{resource}
									</Badge>
								))}
							</div>
						</div>
					)}
					{diffPathLabels.length > 0 && (
						<div>
							<p className="text-[0.875rem] text-panel-text-secondary mb-2">
								{t("recentActions.changedPaths")}
							</p>
							<div className="flex flex-row items-center gap-2 flex-wrap">
								{diffPathLabels.map((label) => (
									<Badge key={label} className="bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-500/20 dark:text-orange-200">
										{t(label)}
									</Badge>
								))}
							</div>
						</div>
					)}
					{displayConfigChanges.length > 0 ? (
						<div className="flex flex-col gap-4">
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
									<div key={`${change.target_id}-${change.path}-${index}`} className="border border-panel-border! rounded-md p-3">
										{labels.length > 0 && (
											<p className="text-[0.875rem] text-panel-text-secondary mb-3">
												{labels.map((label) => t(label)).join(" · ")}
											</p>
										)}
										<JsonDiffEditors
											before={change.before_exists ? change.before : undefined}
											after={change.after_exists ? change.after : undefined}
										/>
									</div>
								);
							})}
						</div>
					) : eventChanges.length === 0 && affectedResources.length === 0 ? (
						<JsonDiffEditors before={detail?.before} after={detail?.after} />
					) : null}
				</div>
			) : (
				<Alert>
					<Info className="size-4" aria-hidden="true" />
					{t(
						detail?.action.rollback_status === "unsupported"
							? "recentActions.historyOnly"
							: "recentActions.snapshotExpired",
					)}
				</Alert>
			)}
			{rollbackMutation.isError && (
				<>
					<hr className="my-4 w-full border-0 border-b border-panel-border! opacity-60" />
					<Alert variant="destructive">
						<CircleAlert className="size-4" aria-hidden="true" />
						<div className="flex flex-col gap-2">
							<p>
								{rollbackErrorDetail || t("recentActions.rollbackFailed")}
							</p>
							{rollbackConflictPaths.length > 0 && (
								<div className="flex flex-row items-center gap-2 flex-wrap">
									{rollbackConflictPaths.map((path) => (
										<Badge key={path} className="bg-destructive/10 text-destructive">
											{path}
										</Badge>
									))}
								</div>
							)}
						</div>
					</Alert>
				</>
			)}
		</div>
	);

	const locale = i18n.language || "en";
	const statusTones: Record<string, string> = {
		available: "bg-panel-success",
		undone: "bg-panel-info",
		expired: "bg-panel-text-muted/60",
		conflict: "bg-panel-danger",
		unsupported: "bg-panel-warning",
	};
	const statusCount = (status: string) => actions.filter((action) => action.rollback_status === status).length;
	const overview = {
		total: { label: t("recentActions.title"), value: totalActions },
		rows: [
			{ key: "available", label: t("recentActions.status.available"), value: statusCount("available"), tone: statusTones.available },
			{ key: "conflict", label: t("recentActions.status.conflict"), value: statusCount("conflict"), tone: statusTones.conflict },
		],
		distribution: {
			label: t("recentActions.filters.status"),
			segments: Object.keys(statusTones).map((status) => ({
				key: status,
				label: t(`recentActions.status.${status}`),
				value: statusCount(status),
				tone: statusTones[status],
			})),
		},
		extra: { label: t("usersPage.filtered"), value: actions.length },
	};

	return (
		<div dir={i18n.dir(i18n.language)} className="flex flex-col gap-4 items-stretch pb-8 md:pb-16">
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand total={overview.total} rows={overview.rows} distribution={overview.distribution} extra={overview.extra} locale={locale} />
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						<div className="min-w-0 flex-1"><div className="grid grid-cols-2 gap-2 items-stretch xl:flex xl:flex-row">
					<SearchInput containerProps={{ className: "col-span-2 w-full md:w-[340px]" }} value={search} onChange={(event) => {
								setSearch(event.target.value);
								debouncedSearchChange(event.target.value);
							}} placeholder={t("recentActions.searchPlaceholder")} aria-label={t("recentActions.searchPlaceholder")} matchOptions={searchMatch} onMatchOptionsChange={(options) => {
							setSearchMatch(options);
							resetPagination();
						}} />
					<Select mode="multiple" size="sm" value={actionTypesFilter} onValueChange={(value) => {
							setActionTypesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}} options={actionTypes.map((type) => ({
							label: actionTypeLabel(type),
							value: type,
						}))} placeholder={t("recentActions.filters.allActions")} aria-label={t("recentActions.filters.action")} className="w-full xl:w-[240px]" />
					<Select mode="multiple" size="sm" value={resourceTypesFilter} onValueChange={(value) => {
							setResourceTypesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}} options={resourceTypes.map((type) => ({
							label: t(resourceTranslationKey(type)),
							value: type,
						}))} placeholder={t("recentActions.filters.allResources")} aria-label={t("recentActions.filters.resource")} className="w-full xl:w-[220px]" />
					<Select mode="multiple" size="sm" value={statusesFilter} onValueChange={(value) => {
							setStatusesFilter(Array.isArray(value) ? value : [value]);
							resetPagination();
						}} options={[
							"available",
							"undone",
							"expired",
							"conflict",
							"unsupported",
						].map((value) => ({
							label: t(`recentActions.status.${value}`),
							value,
						}))} placeholder={t("recentActions.filters.allStatuses")} aria-label={t("recentActions.filters.status")} className="w-full xl:w-[190px]" />
					<Input type="date" value={dayFilter} onChange={(event) => {
							setDayFilter(event.target.value);
							resetPagination();
						}} aria-label={t("recentActions.filters.day")} className="w-full xl:w-[170px]" />
				</div></div>
						<div className="flex shrink-0 items-center justify-end gap-1.5">
							<DataTableSortMenu options={buildSortOptions(columns, actions)} sorting={recentSorting} onSortingChange={setRecentSorting} />
							<Button onClick={() => void actionsQuery.refetch()} variant="outline" loading={actionsQuery.isFetching}>{<RefreshCw className="w-[16px]" />}
								{t("recentActions.refresh")}
							</Button>
						</div>
					</div>
				</div>
			</div>

			<DataTable
				ariaLabel={t("recentActions.title")}
				data={actions}
				columns={columns}
				sorting={recentSorting}
				onSortingChange={setRecentSorting}
				showSortMenu={false}
				getRowId={(action) => String(action.id)}
				loading={actionsQuery.isLoading}
				loadingRows={8}
				error={actionsQuery.isError ? t("recentActions.loadFailed") : undefined}
				emptyState={
					<p className="text-[0.875rem] text-panel-text-muted text-center">
						{actions.length
							? t("recentActions.noMatching")
							: t("recentActions.empty")}
					</p>
				}
				rowActions={rowActions}
				renderRowActions={(action) => (
					<div className="flex flex-row items-center gap-2 justify-end">
						<Button onClick={() => toggleDetails(action.id)} variant="outline" size="sm">{<Eye className="w-[16px]" />}
							{t("recentActions.details")}
						</Button>
						{action.rollback_status === "available" && (
							<Button onClick={() => rollback(action)} size="sm" loading={
									rollbackMutation.isPending &&
									rollbackMutation.variables === action.id
								} className="bg-orange-600 text-white shadow-xs hover:bg-orange-700">{<Undo2 className="w-[16px]" />}
								{t("recentActions.rollback")}
							</Button>
						)}
					</div>
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
		</div>
	);
};
