import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Alert } from "components/ui/alert";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";
import type { SortingState } from "@tanstack/react-table";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";

import { Activity, Eye } from "lucide-react";
import { OperatorIdentity } from "components/OperatorIdentity";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { OverviewBand } from "components/ui/overview-band";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "components/ui/dialog";
import { RefreshSplitButton } from "components/users/RefreshSplitButton";
import { useIntervalRefresh } from "hooks/useIntervalRefresh";
import { DataTable, PageLoadingSkeleton, DataTableColumn } from "components/ui";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type {
	AccessInsightClient,
	AccessInsightsResponse,
} from "types/AccessInsights";
import { filterAccessInsightItems } from "utils/accessInsights";
import { formatBytes } from "utils/formatByte";
import {
	addSearchMatchQuery,
	DEFAULT_SEARCH_MATCH_OPTIONS,
} from "utils/searchMatch";

const PAGE_SIZE = 30;

const uniqueStrings = (values: string[]) =>
	Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const protocolColor = (protocol: string) => {
	switch (protocol.toLowerCase()) {
		case "openvpn":
			return "green";
		case "wireguard":
			return "cyan";
		case "l2tp/ipsec":
			return "orange";
		case "ikev2":
			return "purple";
		case "cisco anyconnect":
			return "red";
		default:
			return "blue";
	}
};

const protocolTone = ["bg-panel-accent", "bg-panel-success", "bg-panel-info", "bg-panel-warning", "bg-panel-text-muted/60"];

const DetailTile: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
	<div className="flex min-w-0 flex-col items-start gap-1 rounded-lg border bg-panel-surface px-3 py-2">
		<span className="text-[0.6875rem] font-medium text-panel-text-muted">{label}</span>
		<div className="min-w-0 max-w-full text-sm font-semibold">{children}</div>
	</div>
);

const AccessInsightsPage: FC = () => {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const { userData, getUserIsSuccess } = useGetUser();
	const canView =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const [data, setData] = useState<AccessInsightsResponse | null>(null);
	const [search, setSearch] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [protocolFilter, setProtocolFilter] = useState("");
	const [nodeFilter, setNodeFilter] = useState("");
	const [page, setPage] = useState(0);
	const [loading, setLoading] = useState(false);
	const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
	const [error, setError] = useState("");
	const [selectedClient, setSelectedClient] =
		useState<AccessInsightClient | null>(null);
	const requestAbortRef = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		if (!canView) return;
		requestAbortRef.current?.abort();
		const abortController = new AbortController();
		requestAbortRef.current = abortController;
		setLoading(true);
		setError("");
		try {
			const query = new URLSearchParams({
				limit: "500",
				window_seconds: "300",
			});
			if (searchQuery) query.set("search", searchQuery);
			addSearchMatchQuery(query, searchMatch);
			const response = await fetch<AccessInsightsResponse>(
				`/core/access/insights/multi-node?${query.toString()}`,
				{ signal: abortController.signal },
			);
			if (!abortController.signal.aborted) setData(response);
		} catch (requestError: any) {
			if (abortController.signal.aborted) return;
			setError(
				requestError?.data?.detail ||
					requestError?.message ||
					t("pages.accessInsights.errors.loadFailed"),
			);
		} finally {
			if (requestAbortRef.current === abortController) {
				requestAbortRef.current = null;
				setLoading(false);
			}
		}
	}, [canView, searchQuery, searchMatch, t]);

	useEffect(
		() => () => {
			requestAbortRef.current?.abort();
		},
		[],
	);

	useEffect(() => {
		const timer = window.setTimeout(() => setSearchQuery(search.trim()), 250);
		return () => window.clearTimeout(timer);
	}, [search]);

	useEffect(() => {
		void load();
	}, [load]);

	useIntervalRefresh(autoRefreshInterval, canView, () => {
		if (document.visibilityState === "visible" && navigator.onLine) void load();
	});

	const items = data?.items || [];
	const protocolOptions = useMemo(
		() =>
			uniqueStrings(
				items.flatMap((item) =>
					item.platforms.map((platform) => platform.platform),
				),
			).sort(),
		[items],
	);
	const nodeOptions = useMemo(
		() => uniqueStrings(items.flatMap((item) => item.nodes || [])).sort(),
		[items],
	);
	const filteredItems = useMemo(
		() =>
			filterAccessInsightItems(items, {
				node: nodeFilter,
				protocol: protocolFilter,
			}),
		[items, nodeFilter, protocolFilter],
	);
	const totalIPs = useMemo(
		() =>
			new Set(
				filteredItems.flatMap((item) => uniqueStrings(item.sources || [])),
			).size,
		[filteredItems],
	);
	const totalNodes = useMemo(
		() => new Set(filteredItems.flatMap((item) => item.nodes || [])).size,
		[filteredItems],
	);
	const protocolTotals = useMemo(() => {
		const totals = new Map<string, number>();
		filteredItems.forEach((item) => {
			item.platforms.forEach((platform) => {
				totals.set(
					platform.platform,
					(totals.get(platform.platform) || 0) + platform.connections,
				);
			});
		});
		return Array.from(totals.entries()).sort(
			(left, right) => right[1] - left[1],
		);
	}, [filteredItems]);
	const totalConnections = protocolTotals.reduce((sum, [, count]) => sum + count, 0);
	const totalTraffic = filteredItems.reduce(
		(sum, item) => sum + Number(item.used_traffic || 0),
		0,
	);
	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
	const visibleItems = filteredItems.slice(
		page * PAGE_SIZE,
		(page + 1) * PAGE_SIZE,
	);

	useEffect(() => {
		setPage((current) => Math.min(current, totalPages - 1));
	}, [totalPages]);

	const overview = {
		total: {
			label: t("pages.accessInsights.onlineUsers"),
			value: data?.online_total ?? 0,
			caption: `${t("pages.accessInsights.connections")}: ${totalConnections}`,
		},
		rows: [
			{ key: "ips", label: t("pages.accessInsights.uniqueIps"), value: totalIPs, tone: "bg-panel-accent" },
			{ key: "nodes", label: t("pages.accessInsights.activeNodes"), value: totalNodes, tone: "bg-panel-success" },
		],
		distribution: {
			label: t("pages.accessInsights.protocols"),
			segments: protocolTotals.slice(0, 4).map(([protocol, count], index) => ({
				key: protocol,
				label: protocol,
				value: count,
				tone: protocolTone[index],
			})).concat(
				protocolTotals.length > 4
					? [{
							key: "other",
							label: t("overview.other"),
							value: protocolTotals.slice(4).reduce((sum, [, count]) => sum + count, 0),
							tone: protocolTone[4],
						}]
					: [],
			),
		},
		extra: {
			label: t("dataUsage"),
			value: formatBytes(totalTraffic),
			caption: `${t("pages.accessInsights.onlineSessions")}: ${filteredItems.length}`,
		},
	};

	const [accessSorting, setAccessSorting] = useState<SortingState>([]);
	const columns = useMemo<DataTableColumn<AccessInsightClient>[]>(
		() => [
			{
				id: "user",
				header: t("user"),
				accessor: "user_label",
				isPrimary: true,
				priority: "primary",
				width: "190px",
				minWidth: "160px",
				mobilePriority: 0,
				cell: (client) => (
					<div className="flex flex-col items-start gap-0.5 min-w-0!">
						<p className="font-semibold truncate max-w-full">
							{client.user_label}
						</p>
						<p className="text-[0.75rem] text-panel-text-muted">
							{t("pages.accessInsights.connections")}: {client.connections}
						</p>
					</div>
				),
			},
			{
				id: "ips",
				header: t("pages.accessInsights.ips"),
				accessor: (client) => client.sources?.join(", ") || "",
				priority: "high",
				width: "270px",
				minWidth: "230px",
				multiline: true,
				mobilePriority: 1,
				mobileSummary: true,
				cell: (client) => {
					const operatorByIP = new Map(
						(client.operators || []).map((operator) => [operator.ip, operator]),
					);
					const sources = uniqueStrings(client.sources || []);
					return (
						<div className="flex flex-col items-stretch gap-2 min-w-0!">
							{sources.slice(0, 3).map((ip) => {
								const operator = operatorByIP.get(ip);
								const nodes = uniqueStrings(client.source_nodes?.[ip] || []);
								return (
									<div key={ip} className="flex flex-row items-center gap-2 min-w-0!">
										<div className="min-w-[112px]!">
											<p dir="ltr" className="font-mono text-[0.75rem] font-semibold">
												{ip}
											</p>
											{nodes.length ? (
												<p className="text-[0.75rem] text-panel-text-muted truncate">
													{nodes.join(", ")}
												</p>
											) : null}
										</div>
										<OperatorIdentity
											shortName={operator?.short_name}
											owner={operator?.owner}
											compact
										/>
									</div>
								);
							})}
							{sources.length > 3 ? (
								<p className="text-[0.75rem] text-panel-text-muted">
									+{sources.length - 3}
								</p>
							) : null}
						</div>
					);
				},
			},
			{
				id: "protocols",
				header: t("pages.accessInsights.protocols"),
				accessor: (client) =>
					client.platforms.map((item) => item.platform).join(", "),
				priority: "high",
				width: "210px",
				minWidth: "170px",
				mobilePriority: 2,
				cell: (client) => (
					<div className="flex flex-row items-center gap-1.5 flex-wrap">
						{client.platforms.map((protocol) => (
							<Badge key={protocol.platform} className={cn(toneClass(protocolColor(protocol.platform)), "rounded-md")}>
								{protocol.platform} · {protocol.connections}
							</Badge>
						))}
					</div>
				),
			},
			{
				id: "last_seen",
				header: t("pages.accessInsights.lastSeen"),
				accessor: "last_seen",
				priority: "medium",
				width: "155px",
				minWidth: "145px",
				mobilePriority: 3,
				cell: (client) => (
					<p dir="ltr" className="text-[0.75rem] whitespace-nowrap">
						{dayjs(client.last_seen).format("YYYY-MM-DD HH:mm:ss")}
					</p>
				),
			},
			{
				id: "details",
				header: t("details"),
				priority: "medium",
				width: "92px",
				minWidth: "86px",
				mobilePriority: 4,
				cell: (client) => (
					<Button onClick={() => setSelectedClient(client)} variant="ghost" size="xs">{<Eye className="w-[15px]" />}
						{t("details")}
					</Button>
				),
			},
		],
		[t],
	);

	if (!getUserIsSuccess) {
		return <PageLoadingSkeleton />;
	}

	if (!canView) {
		return (
			<div className="p-6">
				<Alert className="rounded-md">
					<TriangleAlert className="size-4" aria-hidden="true" />
					{t("pages.accessInsights.noPermission")}
				</Alert>
			</div>
		);
	}

	const pagination =
		totalPages > 1 ? (
			<div className="flex flex-row items-center gap-2 justify-between w-full">
				<p className="text-[0.875rem] text-panel-text-muted">
					{page + 1} / {totalPages}
				</p>
				<div className="inline-flex items-center gap-2">
					<Button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
						{t("previous")}
					</Button>
					<Button onClick={() =>
							setPage((current) => Math.min(totalPages - 1, current + 1))
						} disabled={page >= totalPages - 1}>
						{t("next")}
					</Button>
				</div>
			</div>
		) : null;
	const selectedSources = uniqueStrings(selectedClient?.sources || []);
	const selectedOperatorByIP = new Map(
		(selectedClient?.operators || []).map((operator) => [
			operator.ip,
			operator,
		]),
	);
	const selectedLimit = Number(selectedClient?.data_limit || 0);
	const selectedUsage = Number(selectedClient?.used_traffic || 0);
	const selectedRemaining =
		selectedLimit > 0 ? Math.max(selectedLimit - selectedUsage, 0) : null;
	const selectedUsagePercent =
		selectedLimit > 0
			? Math.min((selectedUsage / selectedLimit) * 100, 100)
			: 0;

	return (
		<div dir={isRTL ? "rtl" : "ltr"} data-dir={isRTL ? "rtl" : "ltr"} className="flex flex-col gap-5 items-stretch">
			<div className="flex flex-col gap-3">
				<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
					<OverviewBand
						total={overview.total}
						rows={overview.rows}
						distribution={overview.distribution}
						extra={overview.extra}
						locale={locale}
					/>
					<div className="border-t border-panel-border! p-3">
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="flex min-w-0 flex-1 flex-row items-center gap-2">
								<SearchInput containerProps={{ className: "min-w-0 flex-1" }} value={search} onChange={(event) => {
										setSearch(event.target.value);
										setPage(0);
									}} placeholder={t("pages.accessInsights.liveSearch")} matchOptions={searchMatch} onMatchOptionsChange={(options) => {
										setSearchMatch(options);
										setPage(0);
									}} />
								<DataTableSortMenu
									options={buildSortOptions(columns, visibleItems)}
									sorting={accessSorting}
									onSortingChange={setAccessSorting}
								/>
							</div>
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 md:flex md:shrink-0 md:flex-row">
								<Select value={protocolFilter} onChange={(event) => {
										setProtocolFilter(event.target.value);
										setPage(0);
									}} aria-label={t("pages.accessInsights.allProtocols")} className="w-full md:w-[170px]">
									<option value="">{t("pages.accessInsights.allProtocols")}</option>
									{protocolOptions.map((protocol) => (
										<option key={protocol} value={protocol}>
											{protocol}
										</option>
									))}
								</Select>
								<Select value={nodeFilter} onChange={(event) => {
										setNodeFilter(event.target.value);
										setPage(0);
									}} aria-label={t("pages.accessInsights.allNodes")} className="w-full md:w-[170px]">
									<option value="">{t("pages.accessInsights.allNodes")}</option>
									{nodeOptions.map((node) => (
										<option key={node} value={node}>
											{node}
										</option>
									))}
								</Select>
								<RefreshSplitButton
									onRefresh={() => void load()}
									loading={loading}
									interval={autoRefreshInterval}
									onIntervalChange={setAutoRefreshInterval}
								/>
							</div>
						</div>
					</div>
				</div>

				<DataTable
					ariaLabel={t("pages.accessInsights.onlineSessions")}
					data={visibleItems}
					columns={columns}
					sorting={accessSorting}
					onSortingChange={setAccessSorting}
					showSortMenu={false}
					getRowId={(client) => client.user_key}
					loading={loading}
					loadingRows={8}
					error={error || undefined}
					emptyState={
						<p className="text-[0.875rem] text-panel-text-muted text-center">
							{t("pages.accessInsights.noData")}
						</p>
					}
					pagination={pagination}
					mobileBreakpoint="md"
					dir={isRTL ? "rtl" : "ltr"}
					tableProps={{
						className: cn(isRTL ? "rb-rtl-table" : undefined, "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5") }}
				/>
			</div>

			<Dialog open={selectedClient !== null} onOpenChange={(open) => { if (!open) setSelectedClient(null); }}>
				<DialogContent
					dir={isRTL ? "rtl" : "ltr"}
					className="flex max-h-[min(760px,calc(100dvh-10rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0"
				>
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Activity className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{t("details")}: {selectedClient?.user_label || ""}
							</DialogTitle>
							<DialogDescription className="truncate">
								{selectedClient?.service_name || "-"}
							</DialogDescription>
						</div>
					</DialogHeader>
					{selectedClient ? (
						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<div className="flex flex-col gap-5">
								<div className="grid grid-cols-2 gap-2 md:grid-cols-4">
									<DetailTile label={t("status")}>
										<Badge className={toneClass(selectedClient.user_status === "active" ? "green" : "gray")}>
											{t(`status.${selectedClient.user_status || "active"}`, {
												defaultValue: selectedClient.user_status || "-",
											})}
										</Badge>
									</DetailTile>
									<DetailTile label={t("service")}>
										<span className="truncate">{selectedClient.service_name || "-"}</span>
									</DetailTile>
									<DetailTile label={t("pages.accessInsights.connections")}>
										{selectedClient.connections}
									</DetailTile>
									<DetailTile label={t("expire")}>
										<span dir="ltr">
											{selectedClient.expire
												? dayjs.unix(selectedClient.expire).format("YYYY-MM-DD HH:mm")
												: t("admins.expireNotSet")}
										</span>
									</DetailTile>
								</div>

								<section className="flex flex-col gap-3 rounded-lg border bg-card/40 p-3.5">
									<div className="flex flex-row items-center justify-between gap-2">
										<p className="text-sm font-semibold">{t("dataUsage")}</p>
										<p dir="ltr" className="text-xs text-muted-foreground">
											{formatBytes(selectedUsage)} /{" "}
											{selectedLimit > 0 ? formatBytes(selectedLimit) : t("unlimited")}
										</p>
									</div>
									<div className="h-2 overflow-hidden rounded-full bg-panel-border">
										<div
											className={cn("h-full rounded-full transition-[width] duration-500", selectedUsagePercent >= 90 ? "bg-panel-danger" : "bg-panel-success")}
											style={{ width: `${selectedUsagePercent}%` }}
										/>
									</div>
									<p dir="ltr" className="text-xs text-muted-foreground">
										{t("remaining")}:{" "}
										{selectedRemaining === null ? t("unlimited") : formatBytes(selectedRemaining)}
									</p>
								</section>

								<section className="flex flex-col gap-2">
									<div className="flex flex-row items-center justify-between gap-2">
										<p className="text-sm font-semibold">{t("pages.accessInsights.ips")}</p>
										<Badge>{selectedSources.length}</Badge>
									</div>
									<div className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border">
										{selectedSources.map((ip) => {
											const operator = selectedOperatorByIP.get(ip);
											const nodes = uniqueStrings(selectedClient.source_nodes?.[ip] || []);
											return (
												<div key={ip} className="flex flex-row items-center gap-2 border-b px-3 py-2 last:border-b-0">
													<div className="min-w-[132px] md:min-w-[180px]">
														<p dir="ltr" className="font-mono text-xs font-semibold">
															{ip}
														</p>
														{nodes.length ? (
															<p className="truncate text-xs text-muted-foreground">{nodes.join(", ")}</p>
														) : null}
													</div>
													<OperatorIdentity shortName={operator?.short_name} owner={operator?.owner} compact />
												</div>
											);
										})}
									</div>
								</section>
							</div>
						</div>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
};

export default AccessInsightsPage;
