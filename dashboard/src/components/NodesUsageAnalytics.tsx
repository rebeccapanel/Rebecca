import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Spinner } from "components/ui/spinner";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { useColorMode } from "lib/color-mode";

import { InfoIcon } from "components/common/InfoIcon";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ChartBox } from "components/common/ChartBox";
import {
	DateRangePicker,
	type DateRangeValue,
} from "components/common/DateRangePicker";
import { buildUsageAreaOptions } from "components/usage/usageChartOptions";
import { useNodes, useNodesQuery } from "contexts/NodesContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { AdminManagementPermission, AdminRole } from "types/Admin";
import { formatBytes } from "utils/formatByte";
import {
	buildRangeFromPreset,
	dateRangeValueToUsageRange as dateRangeValueToRangeState,
	usageRangeToDateRangeValue as rangeStateToDateRangeValue,
	type UsageRange as RangeState,
	type UsageRangePreset as UsagePreset,
} from "utils/usageRange";
import { createUsageConfig } from "./UsageFilter";

dayjs.extend(utc);

type NodeUsageSlice = {
	nodeId: number;
	nodeName: string;
	total: number;
};

type DailyUsagePoint = {
	date: string;
	used_traffic: number;
};

const FALLBACK_PRESET: UsagePreset = {
	key: "30d",
	label: "30d",
	amount: 30,
	unit: "day",
};

const formatTimeseriesLabel = (value: string) => {
	if (!value) return value;
	const hasTime = value.includes(" ");
	const normalized = hasTime ? value.replace(" ", "T") : value;
	const parsed = dayjs.utc(normalized);
	if (!parsed.isValid()) {
		return value;
	}
	return hasTime
		? parsed.local().format("MM-DD HH:mm")
		: parsed.format("YYYY-MM-DD");
};

const formatApiStart = (date: Date) =>
	dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss");
const formatApiEnd = (date: Date) =>
	dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss");

const NodesUsageAnalytics: FC = () => {
	const { t } = useTranslation();
	
	const { colorMode } = useColorMode();
	const { data: nodes } = useNodesQuery();
	const fetchNodesUsage = useNodes((state) => state.fetchNodesUsage);
	const { userData } = useGetUser();

	const presets = useMemo<UsagePreset[]>(
		() => [
			{
				key: "24h",
				label: t("nodes.range24h"),
				amount: 24,
				unit: "hour",
			},
			{
				key: "7d",
				label: t("nodes.range7d"),
				amount: 7,
				unit: "day",
			},
			{
				key: "30d",
				label: t("nodes.range30d"),
				amount: 30,
				unit: "day",
			},
			{
				key: "90d",
				label: t("nodes.range90d"),
				amount: 90,
				unit: "day",
			},
		],
		[t],
	);
	const defaultPreset =
		presets.find((preset) => preset.key === "30d") ??
		presets[0] ??
		FALLBACK_PRESET;

	const [nodesUsageRange, setNodesUsageRange] = useState<RangeState>(() =>
		buildRangeFromPreset(defaultPreset),
	);
	const [nodeUsageSlices, setNodeUsageSlices] = useState<NodeUsageSlice[]>([]);
	const [nodeUsageLoading, setNodeUsageLoading] = useState(false);

	const [nodeDailyRange, setNodeDailyRange] = useState<RangeState>(() =>
		buildRangeFromPreset(defaultPreset),
	);
	const [nodeDailySelectedNodeId, setNodeDailySelectedNodeId] = useState<
		number | null
	>(null);
	const [nodeDailyLoading, setNodeDailyLoading] = useState(false);
	const [nodeDailyPoints, setNodeDailyPoints] = useState<DailyUsagePoint[]>([]);
	const [nodeDailyMeta, setNodeDailyMeta] = useState<{
		nodeName: string;
		nodeId: number;
	} | null>(null);

	const [adminDonutRange, setAdminDonutRange] = useState<RangeState>(() =>
		buildRangeFromPreset(defaultPreset),
	);
	const [adminDailyRange, setAdminDailyRange] = useState<RangeState>(() =>
		buildRangeFromPreset(defaultPreset),
	);
	const [adminOptions, setAdminOptions] = useState<string[]>([]);
	const [selectedAdminDaily, setSelectedAdminDaily] = useState<string | null>(
		null,
	);
	const [selectedAdminTotals, setSelectedAdminTotals] = useState<string | null>(
		null,
	);

	const [adminDailySlices, setAdminDailySlices] = useState<NodeUsageSlice[]>(
		[],
	);
	const [adminTotalsSlices, setAdminTotalsSlices] = useState<NodeUsageSlice[]>(
		[],
	);
	const [adminDonutLoading, setAdminDonutLoading] = useState(false);
	const [selectedAdminNodeId, setSelectedAdminNodeId] = useState<number | null>(
		null,
	);
	const [adminDailyLoading, setAdminDailyLoading] = useState(false);
	const [adminDailyPoints, setAdminDailyPoints] = useState<DailyUsagePoint[]>(
		[],
	);
	const [adminDailyMeta, setAdminDailyMeta] = useState<{
		nodeName: string | null;
		nodeId: number;
	} | null>(null);

	const parseNodeUsageSlices = useCallback(
		(raw: any): NodeUsageSlice[] => {
			if (!raw) return [];
			const values = Array.isArray(raw) ? raw : Object.values(raw);
			return values.map((entry: any) => {
				const traffic =
					entry?.used_traffic != null
						? Number(entry.used_traffic)
						: Number(entry?.uplink ?? 0) + Number(entry?.downlink ?? 0);
				return {
					nodeId: Number(entry?.node_id ?? 0),
					nodeName: entry?.node_name ?? t("nodes.unknownNode"),
					total: traffic,
				};
			});
		},
		[t],
	);

	const handleNodesUsageChange = useCallback((value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setNodesUsageRange(rangeState);
	}, []);

	const handleNodeDailyChange = useCallback((value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setNodeDailyRange(rangeState);
	}, []);

	const handleAdminDailyChange = useCallback((value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setAdminDailyRange(rangeState);
	}, []);

	const handleAdminDonutChange = useCallback((value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setAdminDonutRange(rangeState);
	}, []);
	const totalNodeUsage = useMemo(
		() => nodeUsageSlices.reduce((sum, slice) => sum + slice.total, 0),
		[nodeUsageSlices],
	);

	const nodeUsageChart = useMemo(() => {
		const activeSlices = nodeUsageSlices.filter((slice) => slice.total > 0);
		const series = activeSlices.map((slice) => slice.total);
		const labels = activeSlices.map((slice) => slice.nodeName);
		return createUsageConfig(
			colorMode,
			`${t("userDialog.total")} ${formatBytes(totalNodeUsage || 0, 2)}`,
			series,
			labels,
		);
	}, [colorMode, nodeUsageSlices, t, totalNodeUsage]);

	const nodeDailyCategories = useMemo(
		() => nodeDailyPoints.map((point) => formatTimeseriesLabel(point.date)),
		[nodeDailyPoints],
	);

	const nodeDailySeries = useMemo(
		() => [
			{
				name: t("nodes.usedTrafficSeries"),
				data: nodeDailyPoints.map((point) => point.used_traffic),
			},
		],
		[nodeDailyPoints, t],
	);

	const nodeDailyTotal = useMemo(
		() => nodeDailyPoints.reduce((sum, point) => sum + point.used_traffic, 0),
		[nodeDailyPoints],
	);

	const nodeDailyChartConfig = useMemo(
		() => ({
			options: buildUsageAreaOptions(colorMode, nodeDailyCategories),
			series: nodeDailySeries,
		}),
		[colorMode, nodeDailyCategories, nodeDailySeries],
	);

	const totalAdminUsage = useMemo(
		() => adminTotalsSlices.reduce((sum, slice) => sum + slice.total, 0),
		[adminTotalsSlices],
	);

	const adminDonutChart = useMemo(() => {
		const activeSlices = adminTotalsSlices.filter((slice) => slice.total > 0);
		const series = activeSlices.map((slice) => slice.total);
		const labels = activeSlices.map((slice) => slice.nodeName);
		return createUsageConfig(
			colorMode,
			`${t("userDialog.total")} ${formatBytes(totalAdminUsage || 0, 2)}`,
			series,
			labels,
		);
	}, [adminTotalsSlices, colorMode, t, totalAdminUsage]);

	const adminDailyCategories = useMemo(
		() => adminDailyPoints.map((point) => formatTimeseriesLabel(point.date)),
		[adminDailyPoints],
	);

	const adminDailySeries = useMemo(
		() => [
			{
				name: t("nodes.usedTrafficSeries"),
				data: adminDailyPoints.map((point) => point.used_traffic),
			},
		],
		[adminDailyPoints, t],
	);

	const adminDailyTotal = useMemo(
		() => adminDailyPoints.reduce((sum, point) => sum + point.used_traffic, 0),
		[adminDailyPoints],
	);

	const adminDailyChartConfig = useMemo(
		() => ({
			options: buildUsageAreaOptions(colorMode, adminDailyCategories),
			series: adminDailySeries,
		}),
		[colorMode, adminDailyCategories, adminDailySeries],
	);

	const nodeDailyOptions = useMemo(() => {
		const options: { value: number; label: string }[] = [];
		const seen = new Set<number>();

		nodeUsageSlices.forEach((slice) => {
			if (slice.nodeId > 0 && slice.total > 0 && !seen.has(slice.nodeId)) {
				seen.add(slice.nodeId);
				options.push({ value: slice.nodeId, label: slice.nodeName });
			}
		});

		return options.sort((a, b) => a.label.localeCompare(b.label));
	}, [nodeUsageSlices]);

	const adminNodeOptions = useMemo(() => {
		const options: { value: number; label: string }[] = [];
		const seen = new Set<number>();

		adminDailySlices.forEach((slice) => {
			if (slice.nodeId > 0 && !seen.has(slice.nodeId)) {
				seen.add(slice.nodeId);
				options.push({ value: slice.nodeId, label: slice.nodeName });
			}
		});

		if (Array.isArray(nodes)) {
			nodes.forEach((node) => {
				if (node?.id && !seen.has(node.id)) {
					seen.add(node.id);
					options.push({ value: node.id, label: node.name });
				}
			});
		}

		return options.sort((a, b) => a.label.localeCompare(b.label));
	}, [adminDailySlices, nodes]);

	const adminSelectOptions = useMemo(
		() =>
			adminOptions.map((username) => ({ value: username, label: username })),
		[adminOptions],
	);

	const nodesById = useMemo(() => {
		const map = new Map<number, string>();
		if (Array.isArray(nodes)) {
			nodes.forEach((node) => {
				if (node?.id != null) {
					map.set(node.id, node.name);
				}
			});
		}
		return map;
	}, [nodes]);
	useEffect(() => {
		let cancelled = false;
		setNodeUsageLoading(true);
		fetchNodesUsage({
			start: formatApiStart(nodesUsageRange.start),
			end: formatApiEnd(nodesUsageRange.end),
		})
			.then((data: any) => {
				if (cancelled) return;
				const slices = parseNodeUsageSlices(data?.usages);
				setNodeUsageSlices(slices);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("Error fetching usage data:", err);
				setNodeUsageSlices([]);
				toast.error(t("errorFetchingData"), { duration: 3000 });
			})
			.finally(() => {
				if (!cancelled) {
					setNodeUsageLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [fetchNodesUsage, nodesUsageRange, parseNodeUsageSlices, toast, t]);

	useEffect(() => {
		const canViewAllAdmins =
			Boolean(
				userData.permissions?.admin_management?.[
					AdminManagementPermission.View
				],
			) || userData.role === AdminRole.FullAccess;
		if (!userData?.username) return;
		setSelectedAdminDaily((prev) => prev ?? userData.username);
		setSelectedAdminTotals((prev) => prev ?? userData.username);
		if (!canViewAllAdmins) {
			setAdminOptions([userData.username]);
		}
	}, [userData]);

	useEffect(() => {
		const canViewAllAdmins =
			Boolean(
				userData?.permissions?.admin_management?.[
					AdminManagementPermission.View
				],
			) || userData?.role === AdminRole.FullAccess;
		if (!userData?.username || !canViewAllAdmins) return;
		let cancelled = false;
		apiFetch("/admins")
			.then((payload: any) => {
				if (cancelled) return;
				const adminsList = Array.isArray(payload)
					? payload
					: Array.isArray(payload?.admins)
						? payload.admins
						: [];
				const usernames: string[] = adminsList
					.map((admin: any) => admin?.username)
					.filter(
						(username: unknown): username is string =>
							typeof username === "string",
					);

				const uniqueUsernames = Array.from(new Set(usernames)).sort((a, b) =>
					a.localeCompare(b),
				);

				if (!uniqueUsernames.length && userData?.username) {
					setAdminOptions([userData.username]);
					return;
				}

				setAdminOptions(uniqueUsernames);
				setSelectedAdminDaily((prev) => {
					if (prev && uniqueUsernames.includes(prev)) {
						return prev;
					}
					return uniqueUsernames[0] ?? prev ?? null;
				});
				setSelectedAdminTotals((prev) => {
					if (prev && uniqueUsernames.includes(prev)) {
						return prev;
					}
					return uniqueUsernames[0] ?? prev ?? null;
				});
			})
			.catch((err) => {
				console.error("Error fetching admins:", err);
			});

		return () => {
			cancelled = true;
		};
	}, [
		userData?.permissions?.admin_management,
		userData?.role,
		userData?.username,
	]);

	useEffect(() => {
		const validNodes = nodeUsageSlices.filter(
			(slice) => slice.nodeId > 0 && slice.total > 0,
		);
		if (!validNodes.length) {
			setNodeDailySelectedNodeId(null);
			return;
		}
		if (
			nodeDailySelectedNodeId !== null &&
			validNodes.some((slice) => slice.nodeId === nodeDailySelectedNodeId)
		) {
			return;
		}
		const topNode = [...validNodes].sort((a, b) => b.total - a.total)[0]?.nodeId;
		setNodeDailySelectedNodeId(topNode ?? validNodes[0]?.nodeId ?? null);
	}, [nodeDailySelectedNodeId, nodeUsageSlices]);

	useEffect(() => {
		setSelectedAdminNodeId(null);
	}, []);

	useEffect(() => {
		if (!selectedAdminDaily) {
			setAdminDailySlices([]);
			setSelectedAdminNodeId(null);
			return;
		}

		let cancelled = false;
		const query = {
			start: formatApiStart(adminDailyRange.start),
			end: formatApiEnd(adminDailyRange.end),
		};

		apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/nodes`, {
			query,
		})
			.then((data: any) => {
				if (cancelled) return;
				const slices = parseNodeUsageSlices(data?.usages);
				setAdminDailySlices(slices);
				setSelectedAdminNodeId((prev) => {
					if (prev !== null) {
						return prev;
					}
					const top = slices
						.filter((slice) => slice.nodeId !== 0)
						.sort((a, b) => b.total - a.total)[0]?.nodeId;
					if (typeof top === "number") {
						return top;
					}
					return slices[0]?.nodeId ?? 0;
				});
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("Error fetching daily admin nodes:", err);
				setAdminDailySlices([]);
				setSelectedAdminNodeId(null);
				toast.error(t("errorFetchingData"), { duration: 3000 });
			});

		return () => {
			cancelled = true;
		};
	}, [selectedAdminDaily, adminDailyRange, parseNodeUsageSlices, toast, t]);

	useEffect(() => {
		if (!selectedAdminTotals) {
			setAdminTotalsSlices([]);
			setAdminDonutLoading(false);
			return;
		}

		let cancelled = false;
		setAdminDonutLoading(true);
		apiFetch(`/admin/${encodeURIComponent(selectedAdminTotals)}/usage/nodes`, {
			query: {
				start: formatApiStart(adminDonutRange.start),
				end: formatApiEnd(adminDonutRange.end),
			},
		})
			.then((data: any) => {
				if (cancelled) return;
				const slices = parseNodeUsageSlices(data?.usages);
				setAdminTotalsSlices(slices);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("Error fetching admin totals nodes:", err);
				setAdminTotalsSlices([]);
				toast.error(t("errorFetchingData"), { duration: 3000 });
			})
			.finally(() => {
				if (!cancelled) {
					setAdminDonutLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [selectedAdminTotals, adminDonutRange, parseNodeUsageSlices, toast, t]);

	useEffect(() => {
		if (nodeDailySelectedNodeId === null) {
			setNodeDailyPoints([]);
			setNodeDailyMeta(null);
			return;
		}

		let cancelled = false;
		setNodeDailyLoading(true);

		const query: Record<string, string> = {
			start: formatApiStart(nodeDailyRange.start),
			end: formatApiEnd(nodeDailyRange.end),
		};
		if (nodeDailyRange.unit === "hour") {
			query.granularity = "hour";
		}

		apiFetch(`/node/${nodeDailySelectedNodeId}/usage/daily`, { query })
			.then((data: any) => {
				if (cancelled) return;
				const usages = Array.isArray(data?.usages) ? data.usages : [];
				const mapped = usages.map((entry: any) => ({
					date: entry?.date ?? "",
					used_traffic: Number(entry?.used_traffic ?? 0),
				}));
				setNodeDailyPoints(mapped);
				const fallbackName =
					data?.node_name ??
					nodesById.get(nodeDailySelectedNodeId) ??
					t("nodes.unknownNode");
				setNodeDailyMeta({
					nodeName: fallbackName,
					nodeId: data?.node_id ?? nodeDailySelectedNodeId,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("Error fetching node daily usage:", err);
				setNodeDailyPoints([]);
				toast.error(t("errorFetchingData"), { duration: 3000 });
			})
			.finally(() => {
				if (!cancelled) {
					setNodeDailyLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [nodeDailySelectedNodeId, nodeDailyRange, nodesById, toast, t]);

	useEffect(() => {
		if (!selectedAdminDaily) {
			setAdminDailyPoints([]);
			setAdminDailyMeta(null);
			return;
		}
		if (selectedAdminNodeId === null) {
			setAdminDailyPoints([]);
			setAdminDailyMeta(null);
			return;
		}

		let cancelled = false;
		setAdminDailyLoading(true);
		const query: Record<string, string | number> = {
			start: formatApiStart(adminDailyRange.start),
			end: formatApiEnd(adminDailyRange.end),
		};

		if (selectedAdminNodeId !== undefined && selectedAdminNodeId !== null) {
			query.node_id = selectedAdminNodeId;
		}

		if (adminDailyRange.unit === "hour") {
			query.granularity = "hour";
		}

		apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/chart`, {
			query,
		})
			.then((data: any) => {
				if (cancelled) return;
				const usages = Array.isArray(data?.usages) ? data.usages : [];
				const mapped = usages.map((entry: any) => ({
					date: entry?.date ?? "",
					used_traffic: Number(entry?.used_traffic ?? 0),
				}));
				setAdminDailyPoints(mapped);
				setAdminDailyMeta({
					nodeName:
						data?.node_name ??
						adminNodeOptions.find(
							(option) => option.value === selectedAdminNodeId,
						)?.label ??
						null,
					nodeId: data?.node_id ?? selectedAdminNodeId,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("Error fetching admin usage chart:", err);
				setAdminDailyPoints([]);
				toast.error(t("errorFetchingData"), { duration: 3000 });
			})
			.finally(() => {
				if (!cancelled) {
					setAdminDailyLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [
		selectedAdminDaily,
		selectedAdminNodeId,
		adminDailyRange,
		adminNodeOptions,
		t,
		toast,
	]);
	const dateRangePresets = useMemo(
		() =>
			presets.map((p) => ({
				key: p.key,
				label: p.label,
				amount: p.amount,
				unit: (p.unit === "hour" ? "hour" : p.unit === "day" ? "day" : "day") as
					| "hour"
					| "day"
					| "week"
					| "month",
			})),
		[presets],
	);

	return (
		<div className="flex flex-col gap-6 items-stretch">
			<ChartBox
				title={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="flex flex-row gap-2 items-center">
							<p className="font-semibold">{t("nodes.trafficOverview")}</p>
							<InfoIcon aria-label="info" className="text-gray-500 dark:text-gray-400 cursor-help" />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("nodes.trafficOverviewTooltip")}</TooltipContent>
</Tooltip>
				}
				headerActions={
					<DateRangePicker
						value={rangeStateToDateRangeValue(nodesUsageRange)}
						onChange={handleNodesUsageChange}
						presets={dateRangePresets}
						defaultPreset="30d"
					/>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
						{t("usage.selectedRangeTotal")}:{" "}
						<span className="font-medium">
							{formatBytes(totalNodeUsage || 0, 2)}
						</span>
					</p>
				</div>
				{nodeUsageLoading ? (
					<div className="flex flex-col items-center gap-3">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
							{t("loading")}
						</p>
					</div>
				) : nodeUsageChart.series.length ? (
					<ReactApexChart options={nodeUsageChart.options} series={nodeUsageChart.series} type="donut" height={360} />
				) : (
					<p className="text-center text-gray-500 dark:text-gray-400">
						{t("noData")}
					</p>
				)}
			</ChartBox>

			<ChartBox
				title={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="flex flex-row gap-2 items-center">
							<p className="font-semibold">{t("nodes.perDayUsage")}</p>
							<InfoIcon aria-label="info" className="text-gray-500 dark:text-gray-400 cursor-help" />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("nodes.perDayUsageTooltip")}</TooltipContent>
</Tooltip>
				}
				headerActions={
					<div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center justify-end w-full">
						<Select size="sm" value={nodeDailySelectedNodeId ?? ""} onChange={(event) => {
								const value = event.target.value;
								if (!value) {
									setNodeDailySelectedNodeId(null);
									return;
								}
								const parsed = Number(value);
								setNodeDailySelectedNodeId(
									Number.isFinite(parsed) && parsed > 0 ? parsed : null,
								);
							}} placeholder={t("nodes.selectNode")} disabled={nodeDailyOptions.length === 0} className="md:min-w-[180px]! w-full md:w-auto">
							{nodeDailyOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<DateRangePicker
							value={rangeStateToDateRangeValue(nodeDailyRange)}
							onChange={handleNodeDailyChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
						{t("nodes.selectedNode")}:{" "}
						<span className="font-medium">
							{nodeDailyMeta?.nodeName ?? t("nodes.unknownNode")}
						</span>{" "}
						{t("nodes.totalLabel")}:{" "}
						<span className="font-medium">
							{formatBytes(nodeDailyTotal || 0, 2)}
						</span>
					</p>
				</div>
				{nodeDailyLoading ? (
					<div className="flex flex-col items-center gap-3">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
							{t("loading")}
						</p>
					</div>
				) : nodeDailySeries[0]?.data?.length ? (
					<ReactApexChart options={nodeDailyChartConfig.options} series={nodeDailyChartConfig.series} type="area" height={360} />
				) : (
					<p className="text-center text-gray-500 dark:text-gray-400">
						{t("noData")}
					</p>
				)}
			</ChartBox>

			<ChartBox
				title={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="flex flex-row gap-2 items-center">
							<p className="font-semibold">{t("nodes.adminUsageChart")}</p>
							<InfoIcon aria-label="info" className="text-gray-500 dark:text-gray-400 cursor-help" />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("nodes.adminUsageChartTooltip")}</TooltipContent>
</Tooltip>
				}
				headerActions={
					<div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center justify-end w-full">
						<Select size="sm" value={selectedAdminDaily ?? ""} onChange={(event) =>
								setSelectedAdminDaily(event.target.value || null)
							} disabled={adminSelectOptions.length === 0} className="md:min-w-[160px]! w-full md:w-auto">
							{adminSelectOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<Select size="sm" value={selectedAdminNodeId ?? ""} onChange={(event) => {
								const value = event.target.value;
								if (value === "") {
									setSelectedAdminNodeId(null);
									return;
								}
								const parsed = Number(value);
								setSelectedAdminNodeId(Number.isNaN(parsed) ? null : parsed);
							}} placeholder={t("nodes.selectNode")} className="md:min-w-[180px]! w-full md:w-auto">
							{adminNodeOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<DateRangePicker
							value={rangeStateToDateRangeValue(adminDailyRange)}
							onChange={handleAdminDailyChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
						{t("nodes.selectedAdmin")}:{" "}
						<span className="font-medium">
							{selectedAdminDaily ?? "-"}
						</span>{" "}
						{t("nodes.selectedNode")}:{" "}
						<span className="font-medium">
							{adminDailyMeta?.nodeName ?? t("nodes.unknownNode")}
						</span>{" "}
						{t("nodes.totalLabel")}:{" "}
						<span className="font-medium">
							{formatBytes(adminDailyTotal || 0, 2)}
						</span>
					</p>
				</div>
				{adminDailyLoading ? (
					<div className="flex flex-col items-center gap-3">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
							{t("loading")}
						</p>
					</div>
				) : adminDailySeries[0]?.data?.length ? (
					<ReactApexChart options={adminDailyChartConfig.options} series={adminDailyChartConfig.series} type="area" height={360} />
				) : (
					<p className="text-center text-gray-500 dark:text-gray-400">
						{t("noData")}
					</p>
				)}
			</ChartBox>

			<ChartBox
				title={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="flex flex-row gap-2 items-center">
							<p className="font-semibold">{t("nodes.perAdminUsage")}</p>
							<InfoIcon aria-label="info" className="text-gray-500 dark:text-gray-400 cursor-help" />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("nodes.perAdminUsageTooltip")}</TooltipContent>
</Tooltip>
				}
				headerActions={
					<div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center justify-end w-full">
						<Select size="sm" value={selectedAdminTotals ?? ""} onChange={(event) =>
								setSelectedAdminTotals(event.target.value || null)
							} disabled={adminSelectOptions.length === 0} className="md:min-w-[160px]! w-full md:w-auto">
							{adminSelectOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<DateRangePicker
							value={rangeStateToDateRangeValue(adminDonutRange)}
							onChange={handleAdminDonutChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
						{t("nodes.selectedAdmin")}:{" "}
						<span className="font-medium">
							{selectedAdminTotals ?? "-"}
						</span>{" "}
						{t("nodes.totalLabel")}:{" "}
						<span className="font-medium">
							{formatBytes(totalAdminUsage || 0, 2)}
						</span>
					</p>
				</div>
				{adminDonutLoading ? (
					<div className="flex flex-col items-center gap-3">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
							{t("loading")}
						</p>
					</div>
				) : adminDonutChart.series.length ? (
					<ReactApexChart options={adminDonutChart.options} series={adminDonutChart.series} type="donut" height={360} />
				) : (
					<p className="text-center text-gray-500 dark:text-gray-400">
						{t("noData")}
					</p>
				)}
			</ChartBox>
		</div>
	);
};

export default NodesUsageAnalytics;
