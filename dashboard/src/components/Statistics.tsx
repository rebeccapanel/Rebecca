import {
	Box,
	type BoxProps,
	Button,
	Flex,
	HStack,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Progress,
	SimpleGrid,
	Spinner,
	Stack,
	Text,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
	ChartBarIcon,
	CircleStackIcon,
	ClockIcon,
	CpuChipIcon,
	ServerStackIcon,
	ShieldCheckIcon,
	SignalIcon,
	UserGroupIcon,
} from "@heroicons/react/24/outline";
import type { ApexOptions } from "apexcharts";
import { useDashboard } from "contexts/DashboardContext";
import { AnimatePresence, motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import type { TFunction } from "i18next";
import {
	type FC,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "react-query";
import { fetch, reportAPIError, useAPIRequestErrors } from "service/http";
import { AdminRole } from "types/Admin";
import type { SystemStats } from "types/System";
import type { UsersListResponse } from "types/User";
import { formatBytes, numberWithCommas } from "utils/formatByte";
import { mergeLiveSystemStats } from "utils/systemMetrics";
import { dashboardDiagnostics } from "utils/diagnostics";
import { getAPIWebSocketURL } from "utils/websocket";
import { DashboardMaintenanceControls } from "./DashboardMaintenanceControls";
import { SystemDiagnostics, useSystemDiagnostics } from "./SystemDiagnostics";

export const StatisticsQueryKey = "statistics-query-key";

import HistoryChart from "react-apexcharts";

type MaintenanceInfo = {
	panel?: {
		image?: string;
		tag?: string | null;
		mode?: string;
		install_mode?: string;
		channel?: string;
		update?: {
			current?: string | null;
			available?: boolean;
			target?: string | null;
			latest_release?: { tag?: string | null } | null;
			latest_dev?: { tag?: string | null } | null;
			error?: string | null;
		} | null;
	} | null;
};

const formatDurationText = (seconds: number, t: TFunction): string => {
	if (!seconds || seconds <= 0) {
		return `0 ${t("dashboard.system.durationSeconds")}`;
	}

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remSeconds = Math.floor(seconds % 60);

	const andWord = t("dashboard.system.durationAnd");
	const commaWord = t("dashboard.system.durationComma");

	const formatUnit = (val: number, singleKey: string, pluralKey: string) => {
		const unitStr = val === 1 ? t(singleKey) : t(pluralKey);
		return `${val} ${unitStr}`;
	};

	if (days > 0) {
		const parts: string[] = [
			formatUnit(
				days,
				"dashboard.system.durationDay",
				"dashboard.system.durationDays",
			),
		];
		if (hours > 0) {
			parts.push(
				formatUnit(
					hours,
					"dashboard.system.durationHour",
					"dashboard.system.durationHours",
				),
			);
		}
		if (minutes > 0) {
			parts.push(
				formatUnit(
					minutes,
					"dashboard.system.durationMinute",
					"dashboard.system.durationMinutes",
				),
			);
		}
		if (parts.length === 1) return parts[0];
		if (parts.length === 2) return parts.join(andWord);
		return (
			parts.slice(0, -1).join(commaWord) + andWord + parts[parts.length - 1]
		);
	}

	if (hours > 0) {
		const hStr = formatUnit(
			hours,
			"dashboard.system.durationHour",
			"dashboard.system.durationHours",
		);
		if (minutes > 0) {
			const mStr = formatUnit(
				minutes,
				"dashboard.system.durationMinute",
				"dashboard.system.durationMinutes",
			);
			return `${hStr}${andWord}${mStr}`;
		}
		return hStr;
	}

	if (minutes > 0) {
		const mStr = formatUnit(
			minutes,
			"dashboard.system.durationMinute",
			"dashboard.system.durationMinutes",
		);
		if (remSeconds > 0) {
			const sStr = formatUnit(
				remSeconds,
				"dashboard.system.durationSecond",
				"dashboard.system.durationSeconds",
			);
			return `${mStr}${andWord}${sStr}`;
		}
		return mStr;
	}

	return formatUnit(
		remSeconds,
		"dashboard.system.durationSecond",
		"dashboard.system.durationSeconds",
	);
};

const formatLocalizedDuration = (
	seconds: number,
	t: TFunction,
	isRTL = false,
): ReactNode => {
	const text = formatDurationText(seconds, t);
	return (
		<Text
			fontSize="13px"
			fontWeight="700"
			letterSpacing="-0.01em"
			color="panel.text"
			dir={isRTL ? "rtl" : "ltr"}
			sx={{ unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums" }}
		>
			{text}
		</Text>
	);
};

const useSystemMetricsStream = (enabled = true) => {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled || typeof window === "undefined") return;
		const url = getAPIWebSocketURL("/system/metrics", { interval: 3 });
		if (!url) return;
		let closed = false;
		let ws: WebSocket | null = null;
		let reconnectTimer: number | undefined;

		const connect = () => {
			ws = new WebSocket(url);
			ws.onmessage = (event) => {
				if (
					typeof document !== "undefined" &&
					document.visibilityState === "hidden"
				)
					return;
				try {
					const payload = JSON.parse(event.data);
					if (payload?.error) {
						reportAPIError("STREAM /system/metrics", payload);
						return;
					}
					const stats = payload?.stats ?? payload;
					if (!stats || typeof stats !== "object" || !("version" in stats))
						return;
					useAPIRequestErrors.getState().clear("STREAM /system/metrics");
					queryClient.setQueryData<SystemStats>(StatisticsQueryKey, (current) =>
						mergeLiveSystemStats(current, stats),
					);
				} catch (error) {
					console.error("Unable to parse system metrics stream payload", error);
				}
			};
			ws.onerror = () => ws?.close();
			ws.onclose = () => {
				if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
			};
		};

		connect();
		return () => {
			closed = true;
			if (reconnectTimer) window.clearTimeout(reconnectTimer);
			ws?.close();
		};
	}, [enabled, queryClient]);
};

const toFiniteNumber = (value: unknown, fallback = 0) => {
	const next = Number(value);
	return Number.isFinite(next) ? next : fallback;
};

const safeHistory = (value: unknown): SystemStats["cpu_history"] =>
	Array.isArray(value)
		? value.map((entry) => ({
				timestamp: toFiniteNumber((entry as any)?.timestamp),
				value: toFiniteNumber((entry as any)?.value),
			}))
		: [];

const safeNetworkHistory = (value: unknown): SystemStats["network_history"] =>
	Array.isArray(value)
		? value.map((entry) => ({
				timestamp: toFiniteNumber((entry as any)?.timestamp),
				incoming: toFiniteNumber((entry as any)?.incoming),
				outgoing: toFiniteNumber((entry as any)?.outgoing),
			}))
		: [];

const safeUsageStats = (value: unknown): SystemStats["memory"] => {
	const raw = value && typeof value === "object" ? (value as any) : {};
	return {
		current: toFiniteNumber(raw.current),
		total: toFiniteNumber(raw.total),
		percent: toFiniteNumber(raw.percent),
	};
};

const sanitizeSystemStats = (
	value: SystemStats | undefined,
): SystemStats | null => {
	if (!value || typeof value !== "object") return null;
	const raw = value as any;
	return {
		...value,
		version: String(raw.version ?? ""),
		os: typeof raw.os === "string" ? raw.os : undefined,
		cpu_cores: toFiniteNumber(raw.cpu_cores),
		cpu_threads: toFiniteNumber(raw.cpu_threads),
		cpu_frequency_hz: toFiniteNumber(raw.cpu_frequency_hz),
		cpu_usage: toFiniteNumber(raw.cpu_usage),
		total_user: toFiniteNumber(raw.total_user),
		online_users: toFiniteNumber(raw.online_users),
		online_users_usage: toFiniteNumber(raw.online_users_usage),
		online_users_upload_speed: toFiniteNumber(raw.online_users_upload_speed),
		online_users_download_speed: toFiniteNumber(
			raw.online_users_download_speed,
		),
		users_active: toFiniteNumber(raw.users_active),
		users_on_hold: toFiniteNumber(raw.users_on_hold),
		users_disabled: toFiniteNumber(raw.users_disabled),
		users_expired: toFiniteNumber(raw.users_expired),
		users_limited: toFiniteNumber(raw.users_limited),
		incoming_bandwidth: toFiniteNumber(raw.incoming_bandwidth),
		outgoing_bandwidth: toFiniteNumber(raw.outgoing_bandwidth),
		panel_total_bandwidth: toFiniteNumber(raw.panel_total_bandwidth),
		incoming_bandwidth_speed: toFiniteNumber(raw.incoming_bandwidth_speed),
		outgoing_bandwidth_speed: toFiniteNumber(raw.outgoing_bandwidth_speed),
		total_incoming_bandwidth_speed: toFiniteNumber(raw.total_incoming_bandwidth_speed),
		total_outgoing_bandwidth_speed: toFiniteNumber(raw.total_outgoing_bandwidth_speed),
		memory: safeUsageStats(raw.memory),
		swap: safeUsageStats(raw.swap),
		disk: safeUsageStats(raw.disk),
		load_avg: Array.isArray(raw.load_avg)
			? raw.load_avg.map((item: unknown) => toFiniteNumber(item))
			: [],
		uptime_seconds: toFiniteNumber(raw.uptime_seconds),
		panel_uptime_seconds: toFiniteNumber(raw.panel_uptime_seconds),
		xray_uptime_seconds: toFiniteNumber(raw.xray_uptime_seconds),
		xray_running: Boolean(raw.xray_running),
		xray_version: raw.xray_version ?? null,
		app_memory: toFiniteNumber(raw.app_memory),
		app_threads: toFiniteNumber(raw.app_threads),
		panel_cpu_percent: toFiniteNumber(raw.panel_cpu_percent),
		panel_memory_percent: toFiniteNumber(raw.panel_memory_percent),
		cpu_history: safeHistory(raw.cpu_history),
		memory_history: safeHistory(raw.memory_history),
		swap_history: safeHistory(raw.swap_history),
		disk_history: safeHistory(raw.disk_history),
		network_history: safeNetworkHistory(raw.network_history),
		panel_cpu_history: safeHistory(raw.panel_cpu_history),
		panel_memory_history: safeHistory(raw.panel_memory_history),
		personal_usage:
			raw.personal_usage && typeof raw.personal_usage === "object"
				? {
						total_users: toFiniteNumber(raw.personal_usage.total_users),
						consumed_bytes: toFiniteNumber(raw.personal_usage.consumed_bytes),
						built_bytes: toFiniteNumber(raw.personal_usage.built_bytes),
						reset_bytes: toFiniteNumber(raw.personal_usage.reset_bytes),
						traffic_basis: raw.personal_usage.traffic_basis,
					}
				: {
						total_users: 0,
						consumed_bytes: 0,
						built_bytes: 0,
						reset_bytes: 0,
						traffic_basis: "used_traffic",
					},
		admin_overview:
			raw.admin_overview && typeof raw.admin_overview === "object"
				? {
						total_admins: toFiniteNumber(raw.admin_overview.total_admins),
						sudo_admins: toFiniteNumber(raw.admin_overview.sudo_admins),
						full_access_admins: toFiniteNumber(
							raw.admin_overview.full_access_admins,
						),
						standard_admins: toFiniteNumber(raw.admin_overview.standard_admins),
						top_admin_username: raw.admin_overview.top_admin_username ?? null,
						top_admin_usage: toFiniteNumber(raw.admin_overview.top_admin_usage),
					}
				: {
						total_admins: 0,
						sudo_admins: 0,
						full_access_admins: 0,
						standard_admins: 0,
						top_admin_username: null,
						top_admin_usage: 0,
					},
	};
};

const formatNumberValue = (value?: number | null) => numberWithCommas(value);
const formatPercent = (val: number, _isRTL = false): string => {
	if (!Number.isFinite(val)) return "0%";
	const rounded = Math.round(val * 10) / 10;
	const formatted = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
	return `${formatted}%`;
};
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const HISTORY_INTERVALS = [
	{ labelKey: "dashboard.history.interval.2m", seconds: 120 },
	{ labelKey: "dashboard.history.interval.10m", seconds: 600 },
	{ labelKey: "dashboard.history.interval.30m", seconds: 1800 },
	{ labelKey: "dashboard.history.interval.1h", seconds: 3600 },
	{ labelKey: "dashboard.history.interval.3h", seconds: 10800 },
	{ labelKey: "dashboard.history.interval.5h", seconds: 18000 },
];

type HistoryModalPayload = {
	type: "cpu" | "memory" | "network" | "panel" | "panelCpu" | "panelMemory";
	title: string;
	metricLabel?: string;
	entries?: Array<{ timestamp: number; value: number }>;
	networkEntries?: SystemStats["network_history"];
	cpuEntries?: SystemStats["panel_cpu_history"];
	memoryEntries?: SystemStats["panel_memory_history"];
};

const expandShortData = <T extends { timestamp: number }>(
	entries: T[],
): T[] => {
	if (entries.length === 1) {
		const single = entries[0];
		const synthesizedBefore = { ...single, timestamp: single.timestamp - 2 };
		return [synthesizedBefore, single];
	}
	return entries;
};

const HistoryModal: FC<{
	isOpen: boolean;
	onClose: () => void;
	payload: HistoryModalPayload | null;
	intervalSeconds: number;
	onIntervalChange: (value: number) => void;
	t: TFunction;
	isRTL?: boolean;
}> = ({
	isOpen,
	onClose,
	payload,
	intervalSeconds,
	onIntervalChange,
	t,
	isRTL = false,
}) => {
	const { colorMode } = useColorMode();
	const [isSwitchingInterval, setIsSwitchingInterval] = useState(false);
	const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
	const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({
		left: 4,
		width: 0,
	});
	const gridColor = useColorModeValue(
		"rgba(0,0,0,0.06)",
		"rgba(255,255,255,0.06)",
	);
	const mutedTextColor = useColorModeValue("#64748b", "#94a3b8");

	const activeIntervalIndex = HISTORY_INTERVALS.findIndex(
		(i) => i.seconds === intervalSeconds,
	);

	const MetricIcon = useMemo(() => {
		switch (payload?.type) {
			case "cpu":
				return CpuChipIcon;
			case "memory":
				return CircleStackIcon;
			case "network":
				return SignalIcon;
			case "panel":
			case "panelCpu":
			case "panelMemory":
				return ServerStackIcon;
			default:
				return ChartBarIcon;
		}
	}, [payload?.type]);

	useEffect(() => {
		if (!isOpen) return;
		const timer = setTimeout(() => {
			const targetEl = tabRefs.current[activeIntervalIndex];
			if (targetEl) {
				setPillStyle({
					left: targetEl.offsetLeft,
					width: targetEl.offsetWidth,
				});
			}
		}, 50);
		return () => clearTimeout(timer);
	}, [activeIntervalIndex, isOpen]);

	const { latestTimestamp, availableSpan } = useMemo(() => {
		if (!payload) {
			const now = Math.floor(Date.now() / 1000);
			return {
				latestTimestamp: now,
				earliestTimestamp: now - 120,
				availableSpan: 120,
			};
		}
		let timestamps: number[] = [];
		if (payload.type === "network" && payload.networkEntries?.length) {
			timestamps = payload.networkEntries.map((e) => e.timestamp);
		} else if (payload.type === "panel") {
			const cTs = (payload.cpuEntries || []).map((e) => e.timestamp);
			const mTs = (payload.memoryEntries || []).map((e) => e.timestamp);
			timestamps = [...cTs, ...mTs];
		} else if (payload.entries?.length) {
			timestamps = payload.entries.map((e) => e.timestamp);
		}

		if (!timestamps.length) {
			const now = Math.floor(Date.now() / 1000);
			return {
				latestTimestamp: now,
				earliestTimestamp: now - 120,
				availableSpan: 120,
			};
		}
		const maxT = Math.max(...timestamps);
		const minT = Math.min(...timestamps);
		return {
			latestTimestamp: maxT,
			earliestTimestamp: minT,
			availableSpan: Math.max(1, maxT - minT),
		};
	}, [payload]);

	const effectiveSpan =
		intervalSeconds === 120
			? Math.min(120, availableSpan)
			: Math.max(
					intervalSeconds * 0.5,
					Math.min(intervalSeconds, availableSpan),
				);

	const cutoff = latestTimestamp - effectiveSpan;

	const { chartSeries, actualMinTs, actualMaxTs } = useMemo(() => {
		if (!payload)
			return {
				chartSeries: [],
				actualMinTs: cutoff,
				actualMaxTs: latestTimestamp,
			};

		let seriesList: { name: string; data: [number, number][] }[] = [];
		let allTs: number[] = [];

		if (payload.type === "network" && payload.networkEntries) {
			const filtered = payload.networkEntries.filter(
				(e) => e.timestamp >= cutoff,
			);
			const rawData = filtered.length >= 1 ? filtered : payload.networkEntries;
			const finalData = expandShortData(rawData);
			allTs = finalData.map((e) => e.timestamp);
			seriesList = [
				{
					name: t("dashboard.system.networkIncoming"),
					data: finalData.map((e) => [e.timestamp * 1000, e.incoming]),
				},
				{
					name: t("dashboard.system.networkOutgoing"),
					data: finalData.map((e) => [e.timestamp * 1000, e.outgoing]),
				},
			];
		} else if (payload.type === "panel") {
			const filteredCpu = (payload.cpuEntries || []).filter(
				(e) => e.timestamp >= cutoff,
			);
			const filteredMem = (payload.memoryEntries || []).filter(
				(e) => e.timestamp >= cutoff,
			);
			const rawCpu =
				filteredCpu.length >= 1 ? filteredCpu : payload.cpuEntries || [];
			const rawMem =
				filteredMem.length >= 1 ? filteredMem : payload.memoryEntries || [];
			const finalCpu = expandShortData(rawCpu);
			const finalMem = expandShortData(rawMem);
			allTs = [
				...finalCpu.map((e) => e.timestamp),
				...finalMem.map((e) => e.timestamp),
			];
			seriesList = [
				{
					name: `${t("dashboard.system.cpuUsage")} (Panel CPU %)`,
					data: finalCpu.map((e) => [e.timestamp * 1000, e.value]),
				},
				{
					name: `${t("dashboard.system.memoryUsage")} (Panel RAM %)`,
					data: finalMem.map((e) => [e.timestamp * 1000, e.value]),
				},
			];
		} else if (payload.entries) {
			const filtered = payload.entries.filter((e) => e.timestamp >= cutoff);
			const rawEntries = filtered.length >= 1 ? filtered : payload.entries;
			const finalEntries = expandShortData(rawEntries);
			allTs = finalEntries.map((e) => e.timestamp);
			seriesList = [
				{
					name: payload.metricLabel ?? payload.title,
					data: finalEntries.map((e) => [e.timestamp * 1000, e.value]),
				},
			];
		}

		const minTs = allTs.length ? Math.min(...allTs) : cutoff;
		const maxTs = allTs.length ? Math.max(...allTs) : latestTimestamp;

		return {
			chartSeries: seriesList,
			actualMinTs: minTs,
			actualMaxTs: maxTs,
		};
	}, [payload, cutoff, latestTimestamp, t]);

	const hasEnoughPoints = useMemo(() => {
		if (!payload) return false;
		let totalPoints = 0;
		if (payload.type === "network" && payload.networkEntries) {
			totalPoints = payload.networkEntries.filter(
				(e) => e.timestamp >= cutoff,
			).length;
		} else if (payload.type === "panel") {
			const cLen = (payload.cpuEntries || []).filter(
				(e) => e.timestamp >= cutoff,
			).length;
			const mLen = (payload.memoryEntries || []).filter(
				(e) => e.timestamp >= cutoff,
			).length;
			totalPoints = Math.max(cLen, mLen);
		} else if (payload.entries) {
			totalPoints = payload.entries.filter((e) => e.timestamp >= cutoff).length;
		}
		return totalPoints >= 2;
	}, [payload, cutoff]);

	const isNetwork = payload?.type === "network";

	const { computedMin, computedMax } = useMemo(() => {
		if (isNetwork || !chartSeries.length) {
			return { computedMin: undefined, computedMax: undefined };
		}
		let maxVal = 0;
		let minVal = 100;
		for (const series of chartSeries) {
			for (const pt of series.data) {
				const v = pt[1];
				if (Number.isFinite(v)) {
					if (v > maxVal) maxVal = v;
					if (v < minVal) minVal = v;
				}
			}
		}
		if (maxVal === 0 && minVal === 100) {
			return { computedMin: 0, computedMax: 10 };
		}
		const dynamicMax = Math.min(100, Math.ceil(maxVal * 1.15) || 10);
		const dynamicMin = Math.max(0, Math.floor(minVal * 0.85));
		return {
			computedMin: dynamicMin,
			computedMax: dynamicMax,
		};
	}, [isNetwork, chartSeries]);

	const options: ApexOptions = useMemo(
		() => ({
			chart: {
				type: "area",
				animations: {
					enabled: true,
					easing: "easeinout",
					speed: 300,
					animateGradually: { enabled: true, delay: 50 },
					dynamicAnimation: { enabled: true, speed: 250 },
				},
				toolbar: { show: false },
				zoom: { enabled: false },
				background: "transparent",
				fontFamily: "inherit",
				sparkline: { enabled: false },
			},
			colors: isNetwork
				? ["#3b82f6", "#10b981"]
				: ["var(--rb-panel-accent)", "#8b5cf6", "#f59e0b", "#ec4899"],
			fill: {
				type: "gradient",
				gradient: {
					shadeIntensity: 1,
					opacityFrom: 0.28,
					opacityTo: 0.02,
					stops: [0, 100],
				},
			},
			dataLabels: { enabled: false },
			theme: { mode: colorMode },
			stroke: { curve: "smooth", width: 2 },
			grid: {
				borderColor: gridColor,
				strokeDashArray: 3,
				xaxis: { lines: { show: false } },
				yaxis: { lines: { show: true } },
				padding: {
					top: 0,
					right: 8,
					bottom: 12,
					left: 5,
				},
			},
			xaxis: {
				type: "numeric",
				min: actualMinTs * 1000,
				max: actualMaxTs * 1000,
				tickAmount: 5,
				axisBorder: { show: false },
				axisTicks: { show: false },
				labels: {
					style: {
						colors: mutedTextColor,
						fontSize: "11px",
						fontFamily: "inherit",
					},
					hideOverlappingLabels: true,
					formatter: (val: string, timestamp?: number) => {
						const num = timestamp !== undefined ? timestamp : Number(val);
						if (!num || !Number.isFinite(num)) return val || "";
						const d = new Date(num);
						const h = String(d.getHours()).padStart(2, "0");
						const m = String(d.getMinutes()).padStart(2, "0");
						const s = String(d.getSeconds()).padStart(2, "0");
						return intervalSeconds === 120 ? `${h}:${m}:${s}` : `${h}:${m}`;
					},
				},
			},
			yaxis: {
				min: isNetwork ? undefined : computedMin,
				max: isNetwork ? undefined : computedMax,
				forceNiceScale: isNetwork,
				tickAmount: 5,
				labels: {
					offsetX: 0,
					style: {
						colors: mutedTextColor,
						fontSize: "11px",
						fontFamily: "inherit",
					},
					formatter: (val: number) => {
						if (!Number.isFinite(val)) return "0";
						if (isNetwork) {
							return formatBytes(val, 1);
						}
						return `${Math.round(val * 10) / 10}%`;
					},
				},
			},
			legend: {
				position: "bottom",
				offsetY: 0,
				labels: { colors: mutedTextColor },
				itemMargin: { horizontal: 8, vertical: 6 },
				markers: {
					offsetX: 0,
					offsetY: 0,
				},
				formatter: (seriesName: string) => seriesName,
				onItemClick: {
					toggleDataSeries: true,
				},
				onItemHover: {
					highlightDataSeries: true,
				},
			},
			tooltip: {
				custom: ({ series, seriesIndex, dataPointIndex, w }) => {
					const timestamp = w.globals.seriesX[seriesIndex]?.[dataPointIndex];
					const dateStr = timestamp
						? new Date(timestamp).toLocaleTimeString(
								isRTL ? "fa-IR" : "en-US",
								{
									hour12: false,
									hour: "2-digit",
									minute: "2-digit",
									second: "2-digit",
								},
							)
						: "";

					const linesHtml = w.globals.seriesNames
						.map((name: string, i: number) => {
							const val = series[i]?.[dataPointIndex];
							if (val === undefined || Number.isNaN(val)) return "";
							const color = w.globals.colors[i] || "var(--rb-panel-accent)";
							const displayVal = isNetwork
								? `${formatBytes(val, 2)}/s`
								: `${Math.round(val * 10) / 10}%`;
							return `
								<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px;">
									<div style="display: flex; align-items: center; gap: 6px;">
										<span style="width: 7px; height: 7px; border-radius: 50%; background: ${color}; box-shadow: 0 0 6px ${color}88; flex-shrink: 0;"></span>
										<span style="color: var(--rb-panel-text-secondary, #d0d0d0); font-size: 11px; font-weight: 500;">${name}</span>
									</div>
									<span style="color: var(--rb-panel-text, #f5f5f5); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; direction: ltr;">${displayVal}</span>
								</div>
							`;
						})
						.join("");

					return `
										<div style="
											background: var(--rb-panel-elevated, #2f2f2f);
											border: 1px solid var(--rb-panel-border, #3a3a3a);
											border-radius: 12px;
											background-clip: padding-box;
											padding: 8px 12px;
											box-shadow: ${colorMode === "light" ? "0 8px 20px -4px rgba(0, 0, 0, 0.12)" : "0 8px 24px -4px rgba(0, 0, 0, 0.35)"};
											direction: ${isRTL ? "rtl" : "ltr"};
											font-family: inherit;
											min-width: 140px;
										">
											<div style="color: var(--rb-panel-text-muted, #8a8a8a); font-size: 10px; font-weight: 600; direction: ltr; text-align: ${isRTL ? "right" : "left"}; border-bottom: 1px solid var(--rb-panel-border, #3a3a3a); padding-bottom: 4px; margin-bottom: 4px;">
												${dateStr}
											</div>
											${linesHtml}
										</div>
									`;
				},
			},
		}),
		[
			colorMode,
			gridColor,
			mutedTextColor,
			intervalSeconds,
			isNetwork,
			isRTL,
			computedMin,
			computedMax,
			actualMinTs,
			actualMaxTs,
		],
	);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="2xl"
			scrollBehavior="inside"
			isCentered
		>
			<ModalOverlay bg="blackAlpha.700" />
			<ModalContent
				data-modal-centered="true"
				bg="panel.surface"
				borderWidth="1px"
				borderColor="panel.border"
				borderRadius="20px"
				boxShadow={
					colorMode === "light"
						? "0 20px 40px -8px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
						: "0 24px 48px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
				}
				mx={{ base: 3, sm: 6 }}
				overflow="hidden"
			>
				<ModalHeader
					px={{ base: 4, md: 6 }}
					pt={{ base: 4, md: 5 }}
					pb={{ base: 3.5, md: 4 }}
					borderBottomWidth="1px"
					borderColor="panel.border"
				>
					<Flex align="center" justify="space-between">
						<HStack spacing={3} align="center">
							<Flex
								w="36px"
								h="36px"
								align="center"
								justify="center"
								borderRadius="12px"
								bg="color-mix(in srgb, var(--rb-panel-accent) 12%, transparent)"
								color="var(--rb-panel-accent)"
								border="1px solid"
								borderColor="color-mix(in srgb, var(--rb-panel-accent) 25%, transparent)"
								boxShadow="0 2px 8px color-mix(in srgb, var(--rb-panel-accent) 15%, transparent)"
								flexShrink={0}
							>
								<MetricIcon width={18} height={18} />
							</Flex>
							<Box>
								<Text
									fontSize="15px"
									fontWeight="700"
									color="panel.text"
									lineHeight="1.2"
								>
									{t("dashboard.history.modalTitle", {
										metric: payload?.title ?? "",
									})}
								</Text>
								<Text
									fontSize="11px"
									fontWeight="500"
									color="panel.textMuted"
									mt={0.5}
								>
									{payload?.metricLabel
										? `${payload.title} (${payload.metricLabel})`
										: payload?.title}
								</Text>
							</Box>
						</HStack>
						<ModalCloseButton position="static" size="sm" />
					</Flex>
				</ModalHeader>
				<ModalBody px={{ base: 4, md: 6 }} py={{ base: 4, md: 5 }}>
					<Stack spacing={4}>
						{hasEnoughPoints && (
							<Box
								dir={isRTL ? "rtl" : "ltr"}
								p="3px"
								borderRadius="10px"
								bg="panel.elevated"
								w={{ base: "full", md: "fit-content" }}
								maxW="100%"
								overflowX="auto"
								position="relative"
								display="inline-flex"
								alignItems="center"
								justifySelf="center"
								mx="auto"
								sx={{
									"&::-webkit-scrollbar": {
										display: "none",
									},
									scrollbarWidth: "none",
								}}
							>
								{pillStyle.width > 0 && (
									<motion.div
										animate={{
											left: pillStyle.left,
											width: pillStyle.width,
										}}
										transition={{
											type: "tween",
											ease: [0.16, 1, 0.3, 1],
											duration: 0.22,
										}}
										style={{
											position: "absolute",
											top: 3,
											bottom: 3,
											borderRadius: "8px",
											backgroundColor: "var(--rb-panel-accent, #2563eb)",
											opacity: 0.16,
											boxShadow:
												colorMode === "light"
													? "inset 0 0 0 1px rgba(37, 99, 235, 0.35)"
													: "inset 0 0 0 1px rgba(59, 130, 246, 0.4)",
											zIndex: 1,
											pointerEvents: "none",
										}}
									/>
								)}
								{HISTORY_INTERVALS.map((interval, idx) => {
									const isAvailable =
										idx === 0 || availableSpan >= interval.seconds * 0.5;
									const isActive = intervalSeconds === interval.seconds;
									return (
										<Box
											key={interval.seconds}
											ref={(el: HTMLDivElement | null) => {
												tabRefs.current[idx] = el;
											}}
											flex={{ base: "1 1 0", md: "none" }}
											position="relative"
											display="inline-flex"
											alignItems="center"
											justifyContent="center"
										>
											<Button
												size="xs"
												h="26px"
												w="full"
												px={{ base: 1, sm: 3 }}
												borderRadius="8px"
												variant="ghost"
												bg="transparent !important"
												color={isActive ? "panel.text" : "panel.textMuted"}
												fontWeight={isActive ? "700" : "500"}
												fontSize={{ base: "10px", sm: "11px" }}
												whiteSpace="nowrap"
												position="relative"
												zIndex={2}
												opacity={isAvailable ? 1 : 0.4}
												cursor={isAvailable ? "pointer" : "not-allowed"}
												transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
												_hover={{
													md: {
														color: "panel.text",
													},
												}}
												_active={{
													transform: "scale(0.97)",
												}}
												_focusVisible={{
													outline: "2px solid var(--rb-panel-accent)",
													outlineOffset: "2px",
												}}
												onClick={() => {
													if (
														isAvailable &&
														intervalSeconds !== interval.seconds
													) {
														setIsSwitchingInterval(true);
														onIntervalChange(interval.seconds);
														setTimeout(
															() => setIsSwitchingInterval(false),
															300,
														);
													}
												}}
											>
												{t(interval.labelKey)}
											</Button>
										</Box>
									);
								})}
							</Box>
						)}
						<Box
							minH="300px"
							w="100%"
							position="relative"
							dir="ltr"
							pb={2}
							sx={{
								"& .apexcharts-canvas": {
									direction: "ltr !important",
								},
								"& .apexcharts-yaxis-label": {
									direction: "ltr !important",
								},
								"& .apexcharts-legend": {
									direction: "ltr !important",
									display: "flex !important",
									justifyContent: "center !important",
									gap: "18px !important",
								},
								"& .apexcharts-legend-series": {
									display: "inline-flex !important",
									alignItems: "center !important",
									flexDirection: isRTL ? "row !important" : "row !important",
									gap: "6px !important",
									margin: "0 !important",
								},
								"& .apexcharts-legend-marker": {
									order: isRTL ? 2 : 1,
									margin: "0 !important",
									position: "relative !important",
									top: "auto !important",
									left: "auto !important",
									right: "auto !important",
									bottom: "auto !important",
									transform: "none !important",
								},
								"& .apexcharts-legend-text": {
									order: isRTL ? 1 : 2,
									margin: "0 !important",
									padding: "0 !important",
									position: "relative !important",
									top: "auto !important",
									left: "auto !important",
									right: "auto !important",
									bottom: "auto !important",
								},
								"& .apexcharts-xaxistooltip": {
									display: "none !important",
								},
								"& .apexcharts-tooltip": {
									background: "transparent !important",
									border: "none !important",
									boxShadow: "none !important",
									overflow: "visible !important",
								},
								"& .apexcharts-tooltip.apexcharts-theme-light": {
									background: "transparent !important",
									border: "none !important",
									boxShadow: "none !important",
								},
								"& .apexcharts-tooltip.apexcharts-theme-dark": {
									background: "transparent !important",
									border: "none !important",
									boxShadow: "none !important",
								},
								"& .apexcharts-legend-series.apexcharts-inactive-legend": {
									opacity: "0.45 !important",
									pointerEvents: "auto",
								},
								"& .apexcharts-legend-series.apexcharts-inactive-legend:hover":
									{
										opacity: "0.75 !important",
									},
								"& .apexcharts-canvas:has(.apexcharts-inactive-legend:hover) .apexcharts-series":
									{
										opacity: "1 !important",
									},
							}}
						>
							<AnimatePresence>
								{isSwitchingInterval && (
									<motion.div
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.15, ease: "easeInOut" }}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											backgroundColor: "rgba(10, 12, 16, 0.85)",
											borderRadius: "16px",
											zIndex: 10,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<Spinner size="md" color="panel.accent" thickness="2.5px" />
									</motion.div>
								)}
							</AnimatePresence>
							<motion.div
								animate={{ opacity: isSwitchingInterval ? 0 : 1 }}
								transition={{ duration: 0.25, ease: "easeInOut" }}
								style={{ width: "100%", height: "100%" }}
							>
								<Suspense
									fallback={
										<Flex h="280px" align="center" justify="center">
											<Spinner size="md" color="panel.accent" />
										</Flex>
									}
								>
									{hasEnoughPoints && isOpen ? (
										<HistoryChart
											key={`${payload?.title}-${intervalSeconds}-${colorMode}`}
											options={options}
											series={chartSeries}
											type="area"
											height={300}
											width="100%"
										/>
									) : (
										<Flex
											h="300px"
											align="center"
											justify="center"
											direction="column"
											gap={2}
										>
											<Text fontSize="13px" color="panel.textMuted">
												{t("noData")}
											</Text>
										</Flex>
									)}
								</Suspense>
							</motion.div>
						</Box>
					</Stack>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};

const average = (values: number[]) =>
	values.length
		? values.reduce((total, value) => total + value, 0) / values.length
		: 0;
const peak = (values: number[]) => (values.length ? Math.max(...values) : 0);

const ResourceCard: FC<{
	label: string;
	icon: ReactNode;
	value: string;
	totalValue?: string;
	percent: number;
	metaUnit?: string;
	metaValue?: string | number;
	subMeta?: ReactNode;
	footerLeft?: string;
	footerRight?: string;
	onHistory?: () => void;
	historyLabel?: string;
	isRTL?: boolean;
}> = ({
	label,
	icon,
	value,
	totalValue,
	percent,
	metaUnit,
	metaValue,
	subMeta,
	footerLeft,
	footerRight,
	onHistory,
	historyLabel,
	isRTL = false,
}) => {
	const { colorMode } = useColorMode();
	const safe = clampPercent(percent);
	const accent = "var(--rb-panel-accent)";
	const criticalColor =
		safe >= 90 ? "#ef4444" : safe >= 75 ? "#f59e0b" : accent;

	const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (window.innerWidth <= 768) return;
		const rect = e.currentTarget.getBoundingClientRect();
		e.currentTarget.style.setProperty(
			"--mouse-x",
			`${e.clientX - rect.left}px`,
		);
		e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
		e.currentTarget.style.setProperty("--mouse-opacity", "1");

		const swappables = e.currentTarget.querySelectorAll<HTMLElement>(
			"[data-rb-icon], [data-rb-swap], [data-rb-progress]",
		);
		const RADIUS = 210;
		for (const el of swappables) {
			const rect = el.getBoundingClientRect();
			const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
			const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
			const dist = Math.hypot(dx, dy);
			if (dist < RADIUS) {
				const t = 1 - dist / RADIUS;
				const proximity = t ** 1.15;
				el.style.setProperty("--proximity", proximity.toFixed(3));
			} else {
				el.style.removeProperty("--proximity");
			}
		}
	};

	const handleMouseLeave = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (window.innerWidth <= 768) return;
		e.currentTarget.style.setProperty("--mouse-opacity", "0");
		const swappables = e.currentTarget.querySelectorAll<HTMLElement>(
			"[data-rb-icon], [data-rb-swap], [data-rb-progress]",
		);
		for (const el of swappables) {
			el.style.setProperty(
				"transition",
				"background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease",
			);
			el.style.removeProperty("--proximity");
			setTimeout(() => {
				el.style.removeProperty("transition");
			}, 260);
		}
	};

	return (
		<Box
			role="group"
			bg="panel.surface"
			borderWidth="1px"
			borderColor="panel.border"
			borderRadius="20px"
			p={{ base: 4, sm: 5 }}
			position="relative"
			overflow="hidden"
			display="flex"
			flexDirection="column"
			justifyContent="space-between"
			boxShadow={
				colorMode === "light"
					? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
					: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
			}
			transition="border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			sx={{
				"& [data-rb-icon], & [data-rb-swap]": {
					transition:
						"border-color 0.16s ease, box-shadow 0.16s ease",
				},
				"@media screen and (min-width: 768px)": {
					"& [data-rb-icon]": {
						bg:
							colorMode === "light"
								? "color-mix(in srgb, var(--rb-panel-surface, #ffffff) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #eef0f3)) !important"
								: "color-mix(in srgb, var(--rb-panel-surface, #242424) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #2f2f2f)) !important",
						color:
							colorMode === "light"
								? "color-mix(in srgb, var(--rb-panel-text, #17191c) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #4f5661)) !important"
								: "color-mix(in srgb, var(--rb-panel-text, #f5f5f5) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #b8b8b8)) !important",
						boxShadow:
							colorMode === "light"
								? "0 1px 3px rgba(0, 0, 0, 0.04), inset 0 0 0 1px color-mix(in srgb, var(--rb-panel-border, #d8dce2) calc(var(--proximity, 0) * 100%), transparent) !important"
								: "none",
					},
					"& [data-rb-icon]:focus-visible": {
						"--proximity": "1",
					},
					"& [data-rb-icon] svg, & [data-rb-icon] *": {
						color: "currentColor !important",
						stroke: "currentColor",
					},
					"& [data-rb-swap]": {
						bg:
							colorMode === "light"
								? "color-mix(in srgb, var(--rb-panel-surface, #ffffff) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #eef0f3)) !important"
								: "color-mix(in srgb, var(--rb-panel-surface, #242424) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #2f2f2f)) !important",
						boxShadow:
							colorMode === "light"
								? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 0 0 1px color-mix(in srgb, var(--rb-panel-border, #d8dce2) calc(var(--proximity, 0) * 100%), transparent) !important"
								: "none",
					},
					"& [data-rb-swap]:focus-visible": {
						"--proximity": "1",
					},
					"& [data-rb-swap][data-rb-swap-text]": {
						color:
							colorMode === "light"
								? "color-mix(in srgb, var(--rb-panel-text, #17191c) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #4f5661)) !important"
								: "color-mix(in srgb, var(--rb-panel-text-secondary, #b8b8b8) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-muted, #8a8a8a)) !important",
					},
					"& [data-rb-progress]": {
						bg:
							colorMode === "light"
								? "color-mix(in srgb, var(--rb-panel-surface, #ffffff) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #eef0f3)) !important"
								: "color-mix(in srgb, var(--rb-panel-surface, #242424) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #2f2f2f)) !important",
						boxShadow:
							colorMode === "light"
								? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 0 0 1px color-mix(in srgb, var(--rb-panel-border, #d8dce2) calc(var(--proximity, 0) * 100%), transparent) !important"
								: "none",
						transition: "background-color 0.2s ease, box-shadow 0.2s ease",
					},
					"& [data-rb-progress] > div": {
						filter: "saturate(calc(1 + var(--proximity, 0) * 0.4)) brightness(calc(1 + var(--proximity, 0) * 0.2))",
						boxShadow: "0 0 calc(var(--proximity, 0) * 8px) currentColor",
						transition: "filter 0.2s ease, box-shadow 0.2s ease",
					},
				},
			}}
			_hover={{
				md: {
					borderColor: "panel.borderStrong",
					boxShadow:
						colorMode === "light"
							? "0 6px 20px -4px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.9)"
							: "inset 0 1px 0 0 rgba(255, 255, 255, 0.12)",
				},
			}}
		>
			<Box
				position="absolute"
				inset={0}
				pointerEvents="none"
				borderRadius="20px"
				opacity="var(--mouse-opacity, 0)"
				transition="opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
				bg={
					colorMode === "light"
						? "radial-gradient(420px circle at var(--mouse-x, -999px) var(--mouse-y, -999px), rgba(0, 0, 0, 0.08), transparent 75%)"
						: "radial-gradient(420px circle at var(--mouse-x, -999px) var(--mouse-y, -999px), rgba(255, 255, 255, 0.07), transparent 75%)"
				}
				zIndex={0}
			/>
			<Box position="relative" zIndex={1} w="full">
				<Flex justify="space-between" align="center" mb={3}>
					<HStack spacing={2.5} align="center">
						<Flex
							w="32px"
							h="32px"
							align="center"
							justify="center"
							borderRadius="10px"
							bg="panel.elevated"
							color="panel.textSecondary"
							flexShrink={0}
							data-rb-icon=""
						>
							{icon}
						</Flex>
						<Text
							fontSize="13px"
							fontWeight="600"
							color="panel.textSecondary"
							noOfLines={1}
						>
							{label}
						</Text>
					</HStack>
					{onHistory && (
						<Button
							size="xs"
							h="22px"
							px={2}
							fontSize="11px"
							variant="ghost"
							borderRadius="8px"
							bg="panel.elevated"
							color={
								colorMode === "light"
									? "panel.textSecondary"
									: "panel.textMuted"
							}
							fontWeight={colorMode === "light" ? "600" : "500"}
							transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
							data-rb-swap=""
							_hover={{
								md: {
									bg: "panel.border !important",
									color: "panel.text !important",
								},
							}}
							_active={{
								bg: "panel.borderStrong !important",
								transform: "scale(0.97)",
							}}
							_focusVisible={{
								outline: "2px solid var(--rb-panel-accent)",
								outlineOffset: "2px",
							}}
							position="relative"
							_after={{
								content: '""',
								position: "absolute",
								top: "-10px",
								bottom: "-10px",
								left: "-10px",
								right: "-10px",
							}}
							onClick={onHistory}
						>
							{historyLabel}
						</Button>
					)}
				</Flex>

				<Flex
					align="baseline"
					gap={1.5}
					mb={1}
					wrap="nowrap"
					justify="flex-start"
				>
					{totalValue ? (
						<Flex
							dir="ltr"
							align="baseline"
							gap={1.5}
							sx={{ unicodeBidi: "isolate" }}
						>
							<Text
								fontSize={{ base: "20px", sm: "22px" }}
								fontWeight="800"
								color="panel.text"
								letterSpacing="-0.02em"
								lineHeight="1.1"
								sx={{ fontVariantNumeric: "tabular-nums" }}
							>
								{value}
							</Text>
							<Text
								fontSize="13px"
								fontWeight="600"
								color="panel.textMuted"
								sx={{ fontVariantNumeric: "tabular-nums" }}
							>
								/ {totalValue}
							</Text>
						</Flex>
					) : (
						<Flex align="baseline" gap={1.5} wrap="wrap">
							<Text
								fontSize={{ base: "20px", sm: "22px" }}
								fontWeight="800"
								color="panel.text"
								letterSpacing="-0.02em"
								lineHeight="1.1"
								dir="ltr"
								sx={{
									fontVariantNumeric: "tabular-nums",
									unicodeBidi: "isolate",
								}}
							>
								{value}
							</Text>
							{metaValue !== undefined && metaUnit && (
								<Flex
									align="center"
									dir={isRTL ? "rtl" : "ltr"}
									gap={1}
									sx={{ unicodeBidi: "isolate" }}
								>
									<Text
										fontSize="13px"
										fontWeight="600"
										color="panel.textMuted"
										dir="ltr"
										sx={{
											fontVariantNumeric: "tabular-nums",
											unicodeBidi: "isolate",
										}}
									>
										{metaValue}
									</Text>
									<Text
										fontSize="12px"
										fontWeight="600"
										color="panel.textMuted"
									>
										{metaUnit}
									</Text>
								</Flex>
							)}
						</Flex>
					)}
				</Flex>
				{subMeta && <Box mt={0.5}>{subMeta}</Box>}
			</Box>

			<Box mt={3}>
				<Flex justify="space-between" align="center" mb={1.5}>
					<Text
						fontSize="11px"
						fontWeight="600"
						color="panel.textMuted"
						dir="ltr"
						sx={{ unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums" }}
					>
						{formatPercent(safe, false)}
					</Text>
				</Flex>
				<Progress
					data-rb-progress=""
					value={safe}
					size="xs"
					borderRadius="full"
					bg="panel.elevated"
					sx={{
						"& > div": {
							bg: criticalColor,
							transition: "width 0.6s ease, background-color 0.4s ease",
							borderRadius: "full",
						},
					}}
				/>
				{(footerLeft || footerRight) && (
					<Flex
						justify="space-between"
						align="center"
						mt={2}
						fontSize="11px"
						fontWeight="500"
						color="panel.textMuted"
						dir={isRTL ? "rtl" : "ltr"}
						sx={{ unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums" }}
					>
						<Text noOfLines={1}>{footerLeft}</Text>
						<Text noOfLines={1}>{footerRight}</Text>
					</Flex>
				)}
			</Box>
		</Box>
	);
};

const StatRow: FC<{
	label: string;
	value: string | number;
	dimLabel?: boolean;
	accent?: boolean;
	tag?: string;
	tagColor?: string;
	helper?: string;
}> = ({ label, value, dimLabel, accent, tag, tagColor, helper }) => {
	const accentColor = "var(--rb-panel-accent)";
	return (
		<Flex
			align="center"
			justify="space-between"
			py={2.5}
			borderBottomWidth="1px"
			borderColor="panel.border"
			_last={{ borderBottomWidth: 0 }}
			gap={3}
		>
			<HStack spacing={3} minW={0} flexWrap="nowrap">
				{tagColor && (
					<Box
						flexShrink={0}
						w="7px"
						h="7px"
						borderRadius="full"
						bg={tagColor}
						me="3px"
						boxShadow={`0 0 6px ${tagColor}88`}
					/>
				)}
				<Text
					fontSize="13px"
					fontWeight="600"
					color={dimLabel ? "panel.textMuted" : "panel.textSecondary"}
					noOfLines={1}
				>
					{label}
				</Text>
				{tag && (
					<Flex
						as="span"
						align="center"
						justify="center"
						fontSize="10px"
						px={1.5}
						py={0.5}
						borderRadius="md"
						bg="panel.elevated"
						color="panel.textMuted"
						fontWeight="600"
						dir="ltr"
						transition="all 0.25s ease"
						data-rb-swap=""
						data-rb-swap-text=""
					>
						<Text
							as="span"
							dir="ltr"
							sx={{ fontVariantNumeric: "tabular-nums" }}
						>
							{tag.endsWith("%") ? `${tag.slice(0, -1)}%` : tag}
						</Text>
					</Flex>
				)}
			</HStack>
			<VStack align="flex-end" spacing={0} flexShrink={0}>
				<Text
					fontSize="13px"
					fontWeight="700"
					color={accent ? accentColor : "panel.text"}
					dir="ltr"
					sx={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}
				>
					{typeof value === "number" ? formatNumberValue(value) : value}
				</Text>
				{helper && (
					<Text
						fontSize="10px"
						color="panel.textMuted"
						dir="ltr"
						sx={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}
					>
						{helper}
					</Text>
				)}
			</VStack>
		</Flex>
	);
};

const SectionCard: FC<{
	children: ReactNode;
	title?: ReactNode;
	action?: ReactNode;
	noHover?: boolean;
	roleGroup?: boolean;
}> = ({ children, title, action, noHover = false, roleGroup = true }) => {
	const { colorMode } = useColorMode();

	const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (noHover || window.innerWidth <= 768) return;
		const rect = e.currentTarget.getBoundingClientRect();
		e.currentTarget.style.setProperty(
			"--mouse-x",
			`${e.clientX - rect.left}px`,
		);
		e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
		e.currentTarget.style.setProperty("--mouse-opacity", "1");

		const swappables = e.currentTarget.querySelectorAll<HTMLElement>(
			"[data-rb-icon], [data-rb-swap]",
		);
		const RADIUS = 210;
		for (const el of swappables) {
			const elRect = el.getBoundingClientRect();
			const dx = Math.max(elRect.left - e.clientX, 0, e.clientX - elRect.right);
			const dy = Math.max(elRect.top - e.clientY, 0, e.clientY - elRect.bottom);
			const dist = Math.hypot(dx, dy);
			if (dist < RADIUS) {
				const t = 1 - dist / RADIUS;
				const proximity = t ** 1.15;
				el.style.setProperty("--proximity", proximity.toFixed(3));
			} else {
				el.style.removeProperty("--proximity");
			}
		}
	};

	const handleMouseLeave = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (noHover || window.innerWidth <= 768) return;
		e.currentTarget.style.setProperty("--mouse-opacity", "0");
		const swappables = e.currentTarget.querySelectorAll<HTMLElement>(
			"[data-rb-icon], [data-rb-swap]",
		);
		for (const el of swappables) {
			el.style.setProperty(
				"transition",
				"background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
			);
			el.style.removeProperty("--proximity");
			setTimeout(() => {
				el.style.removeProperty("transition");
			}, 260);
		}
	};

	return (
		<Box
			role={roleGroup ? "group" : undefined}
			bg="panel.surface"
			borderWidth="1px"
			borderColor="panel.border"
			borderRadius="20px"
			position="relative"
			overflow="hidden"
			boxShadow={
				colorMode === "light"
					? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
					: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
			}
			transition="border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			sx={{
				"& [data-rb-icon], & [data-rb-swap]": {
					transition:
						"border-color 0.16s ease, box-shadow 0.16s ease",
				},
				...(noHover
					? {}
					: {
							"@media screen and (min-width: 768px)": {
								"& [data-rb-icon]": {
									bg:
										colorMode === "light"
											? "color-mix(in srgb, var(--rb-panel-surface, #ffffff) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #eef0f3)) !important"
											: "color-mix(in srgb, var(--rb-panel-surface, #242424) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #2f2f2f)) !important",
									color:
										colorMode === "light"
											? "color-mix(in srgb, var(--rb-panel-text, #17191c) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #4f5661)) !important"
											: "color-mix(in srgb, var(--rb-panel-text, #f5f5f5) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #b8b8b8)) !important",
									boxShadow:
										colorMode === "light"
											? "0 1px 3px rgba(0, 0, 0, 0.04), inset 0 0 0 1px color-mix(in srgb, var(--rb-panel-border, #d8dce2) calc(var(--proximity, 0) * 100%), transparent) !important"
											: "none",
								},
								"& [data-rb-icon]:focus-visible": {
									"--proximity": "1",
								},
								"& [data-rb-icon] svg, & [data-rb-icon] *": {
									color: "currentColor !important",
									stroke: "currentColor",
								},
								"& [data-rb-swap]": {
									bg:
										colorMode === "light"
											? "color-mix(in srgb, var(--rb-panel-surface, #ffffff) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #eef0f3)) !important"
											: "color-mix(in srgb, var(--rb-panel-surface, #242424) calc(var(--proximity, 0) * 100%), var(--rb-panel-elevated, #2f2f2f)) !important",
									boxShadow:
										colorMode === "light"
											? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 0 0 1px color-mix(in srgb, var(--rb-panel-border, #d8dce2) calc(var(--proximity, 0) * 100%), transparent) !important"
											: "none",
								},
								"& [data-rb-swap]:focus-visible": {
									"--proximity": "1",
								},
								"& [data-rb-swap][data-rb-swap-text]": {
									color:
										colorMode === "light"
											? "color-mix(in srgb, var(--rb-panel-text, #17191c) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-secondary, #4f5661)) !important"
											: "color-mix(in srgb, var(--rb-panel-text-secondary, #b8b8b8) calc(var(--proximity, 0) * 100%), var(--rb-panel-text-muted, #8a8a8a)) !important",
								},
							},
						}),
			}}
			data-rb-iconswap={noHover ? undefined : ""}
			_hover={
				noHover
					? undefined
					: {
							md: {
								borderColor: "panel.borderStrong",
								boxShadow:
									colorMode === "light"
										? "0 6px 20px -4px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.9)"
										: "inset 0 1px 0 0 rgba(255, 255, 255, 0.12)",
							},
						}
			}
		>
			{!noHover && (
				<Box
					position="absolute"
					inset={0}
					pointerEvents="none"
					borderRadius="20px"
					opacity="var(--mouse-opacity, 0)"
					transition="opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
					bg={
						colorMode === "light"
							? "radial-gradient(550px circle at var(--mouse-x, -999px) var(--mouse-y, -999px), rgba(0, 0, 0, 0.08), transparent 75%)"
							: "radial-gradient(550px circle at var(--mouse-x, -999px) var(--mouse-y, -999px), rgba(255, 255, 255, 0.07), transparent 75%)"
					}
					zIndex={0}
				/>
			)}
			{(title || action) && (
				<Flex
					position="relative"
					zIndex={1}
					px={{ base: 4, sm: 5, md: 6 }}
					py={3.5}
					align="center"
					justify="space-between"
					borderBottomWidth="1px"
					borderColor="panel.border"
				>
					{title && (
						<Text
							fontSize="13px"
							fontWeight="700"
							color="panel.text"
							letterSpacing="-0.01em"
						>
							{title}
						</Text>
					)}
					{action}
				</Flex>
			)}
			<Box position="relative" zIndex={1} px={{ base: 4, sm: 5, md: 6 }} py={4}>
				{children}
			</Box>
		</Box>
	);
};

const AnimatedHeightWrapper: FC<{
	children: ReactNode;
	activeKey: string;
}> = ({ children, activeKey }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | "auto">("auto");

	useEffect(() => {
		if (containerRef.current) {
			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const newHeight =
						entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
					if (newHeight > 0) {
						setHeight(newHeight);
					}
				}
			});

			resizeObserver.observe(containerRef.current);
			return () => resizeObserver.disconnect();
		}
	}, []);

	return (
		<motion.div
			animate={{ height }}
			transition={{
				duration: 0.7,
				ease: [0.22, 1, 0.36, 1],
			}}
			style={{ overflow: "hidden" }}
		>
			<div ref={containerRef}>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={activeKey}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{
							opacity: { duration: 0.12, ease: "linear" },
						}}
					>
						{children}
					</motion.div>
				</AnimatePresence>
			</div>
		</motion.div>
	);
};

const SpeedItem: FC<{
	icon: ReactNode;
	label: string;
	value: string;
}> = ({ icon, label, value }) => {
	return (
		<Flex align="center" justify="space-between" gap={3}>
			<HStack spacing={2.5} color="panel.textMuted">
				<Flex
					w="28px"
					h="28px"
					align="center"
					justify="center"
					borderRadius="10px"
					bg="panel.elevated"
					flexShrink={0}
					data-rb-icon=""
				>
					{icon}
				</Flex>
				<Text fontSize="13px" fontWeight="600" color="panel.textSecondary">
					{label}
				</Text>
			</HStack>
			<Text
				fontSize="13px"
				fontWeight="700"
				letterSpacing="-0.01em"
				color="panel.text"
				dir="ltr"
				sx={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}
			>
				{value}
			</Text>
		</Flex>
	);
};

export const Statistics: FC<BoxProps> = (props) => {
	const { version } = useDashboard();
	const { userData } = useGetUser();
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	const { data: rawSystemData } = useQuery<SystemStats>({
		queryKey: StatisticsQueryKey,
		queryFn: () => fetch("/system"),
		onSuccess: (stats) => {
			const currentVersion = stats?.version;
			if (currentVersion && version !== currentVersion) {
				useDashboard.setState({ version: currentVersion });
			}
		},
	});

	const { data: maintenanceInfo } = useQuery<MaintenanceInfo>(
		["dashboard-maintenance-info"],
		() => fetch<MaintenanceInfo>("/maintenance/info", { timeout: 8000 }),
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
			retry: false,
		},
	);

	const { data: myUsersData } = useQuery<UsersListResponse>(
		["dashboard-my-users-stats", userData.username],
		() =>
			fetch<UsersListResponse>("/users", {
				query: { admin: userData.username, limit: 1000 },
			}),
		{
			enabled: Boolean(userData.username),
			staleTime: 10_000,
			refetchInterval: 15_000,
		},
	);

	const systemData = useMemo(
		() => sanitizeSystemStats(rawSystemData),
		[rawSystemData],
	);
	useSystemMetricsStream(true);

	useEffect(() => {
		if (systemData?.version && version !== systemData.version) {
			useDashboard.setState({ version: systemData.version });
		}
	}, [systemData?.version, version]);

	const [historyPayload, setHistoryPayload] =
		useState<HistoryModalPayload | null>(null);
	const [historyInterval, setHistoryInterval] = useState(
		HISTORY_INTERVALS[0].seconds,
	);
	const [userTab, setUserTab] = useState<"all" | "mine">("all");
	const [bandwidthScope, setBandwidthScope] = useState<"master" | "total">("total");
	const { colorMode } = useColorMode();

	const canSeeGlobal =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const showTotalBandwidth = canSeeGlobal && bandwidthScope === "total";
	const diagnosticsQuery = useSystemDiagnostics(canSeeGlobal);
	const criticalIssues = dashboardDiagnostics(
		diagnosticsQuery.data || [],
		diagnosticsQuery.isSuccess ? undefined : systemData || undefined,
	);
	const hasXrayError = criticalIssues.some(
		(issue) =>
			issue.resource_type === "node" ||
			(issue.resource_type === "node_service" && issue.resource === "xray"),
	);

	const openHistory = (payload: HistoryModalPayload) => {
		setHistoryInterval(HISTORY_INTERVALS[0].seconds);
		setHistoryPayload(payload);
	};

	if (!systemData) {
		return (
			<Stack
				spacing={{ base: 4, md: 5 }}
				w="full"
				dir={isRTL ? "rtl" : "ltr"}
				sx={{
					"@keyframes rbGlassPulse": {
						"0%, 100%": {
							opacity: 0.42,
							transform: "scale(1)",
						},
						"50%": {
							opacity: 0.78,
							transform: "scale(1.002)",
						},
					},
					"& .rb-glass-item": {
						animation: "rbGlassPulse 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
					},
				}}
			>
				{canSeeGlobal && <SystemDiagnostics issues={criticalIssues} criticalOnly />}
				<Flex
					align="center"
					justify="space-between"
					px={1}
					py={0.5}
					flexWrap="wrap"
					gap={3}
				>
					<VStack align="flex-start" spacing={1.5}>
						<Box
							className="rb-glass-item"
							w={{ base: "140px", sm: "170px" }}
							h="24px"
							borderRadius="8px"
							bg="panel.surface"
							borderWidth="1px"
							borderColor="panel.border"
						/>
						<HStack spacing={1.5}>
							<Box
								className="rb-glass-item"
								w="65px"
								h="18px"
								borderRadius="full"
								bg="panel.surface"
								borderWidth="1px"
								borderColor="panel.border"
							/>
							<Box
								className="rb-glass-item"
								w="80px"
								h="18px"
								borderRadius="full"
								bg="panel.surface"
								borderWidth="1px"
								borderColor="panel.border"
							/>
						</HStack>
					</VStack>

					<HStack spacing={2} align="center">
						<Box
							className="rb-glass-item"
							w={{ base: "70px", sm: "90px" }}
							h="32px"
							borderRadius="full"
							bg="panel.surface"
							borderWidth="1px"
							borderColor="panel.border"
						/>
						<Box
							className="rb-glass-item"
							w={{ base: "70px", sm: "90px" }}
							h="32px"
							borderRadius="full"
							bg="panel.surface"
							borderWidth="1px"
							borderColor="panel.border"
						/>
					</HStack>
				</Flex>

				<SimpleGrid
					columns={{ base: 1, sm: 2, xl: 4 }}
					gap={{ base: 3, md: 4 }}
					sx={{
						"@media screen and (min-width: 768px) and (max-width: 910px)": {
							"body:not(:has([data-sidebar-collapsed='true'])) &": {
								gridTemplateColumns: "1fr !important",
							},
						},
					}}
				>
					{[1, 2, 3, 4].map((i) => (
						<Box
							key={i}
							className="rb-glass-item"
							bg="panel.surface"
							borderRadius="20px"
							borderWidth="1px"
							borderColor="panel.border"
							p={{ base: 4, sm: 5 }}
							minH={{ base: "125px", md: "140px" }}
							display="flex"
							flexDirection="column"
							justifyContent="space-between"
							boxShadow={
								colorMode === "light"
									? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
									: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
							}
							backdropFilter="blur(8px)"
						>
							<Flex justify="space-between" align="center" mb={2}>
								<HStack spacing={2.5}>
									<Box
										w="32px"
										h="32px"
										borderRadius="10px"
										bg="panel.elevated"
										flexShrink={0}
									/>
									<Box
										w={i === 1 ? "75px" : i === 2 ? "65px" : "85px"}
										h="16px"
										borderRadius="md"
										bg="panel.elevated"
									/>
								</HStack>
								<Box
									w="45px"
									h="20px"
									borderRadius="full"
									bg="panel.elevated"
								/>
							</Flex>

							<Stack spacing={2} mt={2}>
								<Box
									w={i === 1 ? "110px" : "90px"}
									h="26px"
									borderRadius="md"
									bg="panel.elevated"
								/>
								<Box
									w="full"
									h="4px"
									borderRadius="full"
									bg="panel.elevated"
									opacity={0.6}
								/>
							</Stack>
						</Box>
					))}
				</SimpleGrid>

				<SimpleGrid
					columns={{ base: 1, md: 2 }}
					gap={{ base: 3, md: 4 }}
					sx={{
						"@media screen and (min-width: 768px) and (max-width: 910px)": {
							"body:not(:has([data-sidebar-collapsed='true'])) &": {
								gridTemplateColumns: "1fr !important",
							},
						},
					}}
				>
					<Box
						className="rb-glass-item"
						bg="panel.surface"
						borderRadius="20px"
						borderWidth="1px"
						borderColor="panel.border"
						overflow="hidden"
						boxShadow={
							colorMode === "light"
								? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
								: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
						}
						backdropFilter="blur(8px)"
					>
						<Flex
							px={{ base: 4, sm: 5, md: 6 }}
							py={3.5}
							justify="space-between"
							align="center"
							borderBottomWidth="1px"
							borderColor="panel.border"
						>
							<HStack spacing={2.5}>
								<Box w="26px" h="26px" borderRadius="7px" bg="panel.elevated" />
								<Box w="110px" h="16px" borderRadius="md" bg="panel.elevated" />
							</HStack>
							<Box w="75px" h="22px" borderRadius="full" bg="panel.elevated" />
						</Flex>
						<Box p={{ base: 4, sm: 5, md: 6 }}>
							<Stack spacing={3}>
								<Flex justify="space-between" align="center" gap={3}>
									<HStack spacing={2.5}>
										<Box
											w="28px"
											h="28px"
											borderRadius="8px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box w="85px" h="15px" borderRadius="md" bg="panel.elevated" />
									</HStack>
									<Box w="75px" h="16px" borderRadius="md" bg="panel.elevated" />
								</Flex>
								<Flex justify="space-between" align="center" gap={3}>
									<HStack spacing={2.5}>
										<Box
											w="28px"
											h="28px"
											borderRadius="8px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box w="90px" h="15px" borderRadius="md" bg="panel.elevated" />
									</HStack>
									<Box w="75px" h="16px" borderRadius="md" bg="panel.elevated" />
								</Flex>
							</Stack>
						</Box>
					</Box>

					<Box
						className="rb-glass-item"
						bg="panel.surface"
						borderRadius="20px"
						borderWidth="1px"
						borderColor="panel.border"
						overflow="hidden"
						boxShadow={
							colorMode === "light"
								? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
								: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
						}
						backdropFilter="blur(8px)"
					>
						<Flex
							px={{ base: 4, sm: 5, md: 6 }}
							py={3.5}
							justify="space-between"
							align="center"
							borderBottomWidth="1px"
							borderColor="panel.border"
						>
							<HStack spacing={2.5}>
								<Box w="26px" h="26px" borderRadius="7px" bg="panel.elevated" />
								<Box w="90px" h="16px" borderRadius="md" bg="panel.elevated" />
							</HStack>
						</Flex>
						<Box p={{ base: 4, sm: 5, md: 6 }}>
							<Stack spacing={3}>
								<Flex justify="space-between" align="center" gap={3}>
									<HStack spacing={2.5}>
										<Box
											w="28px"
											h="28px"
											borderRadius="8px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box w="95px" h="15px" borderRadius="md" bg="panel.elevated" />
									</HStack>
									<Box w="80px" h="16px" borderRadius="md" bg="panel.elevated" />
								</Flex>
								<Flex justify="space-between" align="center" gap={3}>
									<HStack spacing={2.5}>
										<Box
											w="28px"
											h="28px"
											borderRadius="8px"
											bg="panel.elevated"
											flexShrink={0}
										/>
										<Box w="90px" h="15px" borderRadius="md" bg="panel.elevated" />
									</HStack>
									<Box w="80px" h="16px" borderRadius="md" bg="panel.elevated" />
								</Flex>
							</Stack>
						</Box>
					</Box>
				</SimpleGrid>

				<Box
					className="rb-glass-item"
					bg="panel.surface"
					borderRadius="20px"
					borderWidth="1px"
					borderColor="panel.border"
					overflow="hidden"
					boxShadow={
						colorMode === "light"
							? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
							: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
					}
					backdropFilter="blur(8px)"
				>
					<Flex
						px={{ base: 4, sm: 5, md: 6 }}
						py={3.5}
						justify="space-between"
						align="center"
						borderBottomWidth="1px"
						borderColor="panel.border"
					>
						<HStack spacing={2.5}>
							<Box w="26px" h="26px" borderRadius="8px" bg="panel.elevated" />
							<Box w="110px" h="16px" borderRadius="md" bg="panel.elevated" />
						</HStack>
						<Box w="75px" h="22px" borderRadius="full" bg="panel.elevated" />
					</Flex>
					<Box p={{ base: 4, sm: 5, md: 6 }}>
						<SimpleGrid columns={{ base: 1, sm: 2 }} gap={{ base: 3, md: 4 }}>
							{[1, 2].map((i) => (
								<Box
									key={i}
									bg="panel.surface"
									borderRadius="14px"
									borderWidth="1px"
									borderColor="panel.border"
									p={{ base: 4, sm: 5 }}
									display="flex"
									flexDirection="column"
									justifyContent="space-between"
									boxShadow={
										colorMode === "light"
											? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
											: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
									}
								>
									<Box>
										<Flex justify="space-between" align="center" mb={3}>
											<HStack spacing={2.5} align="center">
												<Box
													w="32px"
													h="32px"
													borderRadius="10px"
													bg="panel.elevated"
													flexShrink={0}
												/>
												<Box
													w={i === 1 ? "120px" : "130px"}
													h="16px"
													borderRadius="md"
													bg="panel.elevated"
												/>
											</HStack>
										</Flex>
										<Flex align="baseline" gap={1.5} mb={1}>
											<Box
												w="55px"
												h="24px"
												borderRadius="md"
												bg="panel.elevated"
											/>
											<Box
												w="45px"
												h="16px"
												borderRadius="md"
												bg="panel.elevated"
											/>
										</Flex>
									</Box>
									<Box mt={3}>
										<Flex justify="space-between" align="center" mb={1.5}>
											<Box
												w="32px"
												h="13px"
												borderRadius="sm"
												bg="panel.elevated"
											/>
										</Flex>
										<Box
											w="full"
											h="4px"
											borderRadius="full"
											bg="panel.elevated"
										/>
										<Flex
											justify="space-between"
											align="center"
											mt={2.5}
											pt={2.5}
											borderTopWidth="1px"
											borderColor="panel.border"
										>
											<Box
												w="75px"
												h="14px"
												borderRadius="sm"
												bg="panel.elevated"
											/>
											<Box
												w="70px"
												h="14px"
												borderRadius="sm"
												bg="panel.elevated"
											/>
										</Flex>
									</Box>
								</Box>
							))}
						</SimpleGrid>
					</Box>
				</Box>

				<Box
					className="rb-glass-item"
					bg="panel.surface"
					borderRadius="20px"
					borderWidth="1px"
					borderColor="panel.border"
					overflow="hidden"
					boxShadow={
						colorMode === "light"
							? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
							: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
					}
					backdropFilter="blur(8px)"
				>
					<Flex
						px={{ base: 4, sm: 5, md: 6 }}
						py={3.5}
						justify="space-between"
						align="center"
						borderBottomWidth="1px"
						borderColor="panel.border"
					>
						<HStack spacing={2.5}>
							<Box w="26px" h="26px" borderRadius="8px" bg="panel.elevated" />
							<Box w="90px" h="16px" borderRadius="md" bg="panel.elevated" />
						</HStack>
						<HStack
							spacing={0.5}
							bg="panel.elevated"
							p={0.5}
							borderRadius="10px"
						>
							<Box w="65px" h="22px" borderRadius="8px" bg="panel.surface" />
							<Box w="60px" h="22px" borderRadius="8px" bg="transparent" />
						</HStack>
					</Flex>
					<Box p={{ base: 4, sm: 5, md: 6 }}>
						<Stack spacing={0}>
							{[
								{
									id: "skel-u-total",
									hasTag: false,
									hasHelper: false,
									labelW: "55px",
									valW: "35px",
								},
								{
									id: "skel-u-active",
									hasTag: true,
									hasHelper: false,
									labelW: "55px",
									valW: "35px",
								},
								{
									id: "skel-u-online",
									hasTag: true,
									hasHelper: true,
									labelW: "55px",
									valW: "35px",
								},
								{
									id: "skel-u-onhold",
									hasTag: false,
									hasHelper: false,
									labelW: "65px",
									valW: "30px",
								},
								{
									id: "skel-u-limited",
									hasTag: false,
									hasHelper: false,
									labelW: "70px",
									valW: "30px",
								},
								{
									id: "skel-u-expired",
									hasTag: false,
									hasHelper: false,
									labelW: "75px",
									valW: "30px",
								},
							].map((row, idx) => (
								<Flex
									key={row.id}
									justify="space-between"
									align="center"
									py={2.5}
									borderBottomWidth={idx === 5 ? "0" : "1px"}
									borderColor="panel.border"
								>
									<HStack spacing={3} minW={0}>
										<Box
											w="7px"
											h="7px"
											borderRadius="full"
											bg="panel.elevated"
											me="3px"
											flexShrink={0}
										/>
										<Box
											w={row.labelW}
											h="14px"
											borderRadius="md"
											bg="panel.elevated"
										/>
										{row.hasTag && (
											<Box
												w="36px"
												h="18px"
												borderRadius="md"
												bg="panel.elevated"
											/>
										)}
									</HStack>
									<VStack align="flex-end" spacing={0.5} flexShrink={0}>
										<Box
											w={row.valW}
											h="16px"
											borderRadius="md"
											bg="panel.elevated"
										/>
										{row.hasHelper && (
											<Box
												w="100px"
												h="12px"
												borderRadius="sm"
												bg="panel.elevated"
												mt={0.5}
											/>
										)}
									</VStack>
								</Flex>
							))}
						</Stack>
					</Box>
				</Box>

				{canSeeGlobal && (
					<Box
						className="rb-glass-item"
						bg="panel.surface"
						borderRadius="20px"
						borderWidth="1px"
						borderColor="panel.border"
						overflow="hidden"
						boxShadow={
							colorMode === "light"
								? "0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)"
								: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)"
						}
						backdropFilter="blur(8px)"
					>
						<Flex
							px={{ base: 4, sm: 5, md: 6 }}
							py={3.5}
							justify="space-between"
							align="center"
							borderBottomWidth="1px"
							borderColor="panel.border"
						>
							<HStack spacing={2.5}>
								<Box w="26px" h="26px" borderRadius="7px" bg="panel.elevated" />
								<Box w="85px" h="16px" borderRadius="md" bg="panel.elevated" />
							</HStack>
						</Flex>
						<Box p={{ base: 4, sm: 5, md: 6 }}>
							<Stack spacing={0}>
								{[
									{ id: "skel-a-total", labelW: "75px", valW: "40px" },
									{ id: "skel-a-full", labelW: "85px", valW: "40px" },
									{ id: "skel-a-sudo", labelW: "65px", valW: "40px" },
									{ id: "skel-a-standard", labelW: "80px", valW: "40px" },
									{ id: "skel-a-top", labelW: "75px", valW: "120px" },
								].map((row, idx) => (
									<Flex
										key={row.id}
										justify="space-between"
										align="center"
										py={2.5}
										borderBottomWidth={idx === 4 ? "0" : "1px"}
										borderColor="panel.border"
									>
										<HStack spacing={3} minW={0}>
											<Box
												w="7px"
												h="7px"
												borderRadius="full"
												bg="panel.elevated"
												me="3px"
												flexShrink={0}
											/>
											<Box
												w={row.labelW}
												h="14px"
												borderRadius="md"
												bg="panel.elevated"
											/>
										</HStack>
										<Box
											w={row.valW}
											h="16px"
											borderRadius="md"
											bg="panel.elevated"
										/>
									</Flex>
								))}
							</Stack>
						</Box>
					</Box>
				)}
			</Stack>
		);
	}

	const activePercent =
		systemData.total_user > 0
			? formatPercent(
					(systemData.users_active / systemData.total_user) * 100,
					isRTL,
				)
			: formatPercent(0, isRTL);
	const onlinePercent =
		systemData.total_user > 0
			? formatPercent(
					(systemData.online_users / systemData.total_user) * 100,
					isRTL,
				)
			: formatPercent(0, isRTL);

	const myTotalUsers =
		myUsersData?.total ?? systemData.personal_usage?.total_users ?? 0;
	const myActiveUsers =
		myUsersData?.active_total ??
		myUsersData?.status_breakdown?.active ??
		myTotalUsers;
	const myOnlineUsers = myUsersData?.online_total ?? 0;

	const myActivePercent =
		myTotalUsers > 0
			? formatPercent((myActiveUsers / myTotalUsers) * 100, isRTL)
			: formatPercent(0, isRTL);
	const myOnlinePercent =
		myTotalUsers > 0
			? formatPercent((myOnlineUsers / myTotalUsers) * 100, isRTL)
			: formatPercent(0, isRTL);

	const myUsersList = myUsersData?.users ?? [];
	const myOnHoldUsers =
		myUsersData?.status_breakdown?.on_hold ??
		myUsersList.filter((u) => u.status === "on_hold").length;
	const myLimitedUsers =
		myUsersData?.status_breakdown?.limited ??
		myUsersList.filter((u) => u.status === "limited").length;
	const myExpiredUsers =
		myUsersData?.status_breakdown?.expired ??
		myUsersList.filter((u) => u.status === "expired").length;
	const myOnlineUploadSpeed = myUsersList.reduce(
		(sum, u) => sum + (Number(u.upload_speed) || 0),
		0,
	);
	const myOnlineDownloadSpeed = myUsersList.reduce(
		(sum, u) => sum + (Number(u.download_speed) || 0),
		0,
	);
	const myActiveUsersUsedTraffic = myUsersList.reduce(
		(sum, u) => sum + (Number(u.used_traffic) || 0),
		0,
	);

	const panelInfo = maintenanceInfo?.panel;
	const exactVersion =
		panelInfo?.tag ||
		panelInfo?.update?.current ||
		(systemData.channel?.toLowerCase() === "dev"
			? "dev"
			: systemData.version) ||
		"-";

	return (
		<Stack
			spacing={{ base: 4, md: 5 }}
			w="full"
			dir={isRTL ? "rtl" : "ltr"}
			{...props}
		>
			{canSeeGlobal && (
				<SystemDiagnostics issues={criticalIssues} criticalOnly />
			)}
			<Flex
				align="center"
				justify="space-between"
				flexWrap="wrap"
				gap={3}
				px={1}
				sx={{
					"@media screen and (max-width: 599.98px)": {
						flexWrap: "wrap !important",
						alignItems: "flex-start !important",
					},
					"@media screen and (min-width: 600px) and (max-width: 1040px)": {
						flexWrap: "wrap !important",
						alignItems: "flex-start !important",
					},
					"@media screen and (min-width: 1040.02px)": {
						"body:has([data-sidebar-collapsed='true']) &, body[data-sidebar-collapsed='true'] &":
							{
								flexWrap: "nowrap !important",
								alignItems: "center !important",
							},
						"body:not([data-sidebar-collapsed='true']):not(:has([data-sidebar-collapsed='true'])) &":
							{
								flexWrap: "wrap !important",
								alignItems: "flex-start !important",
							},
					},
					"@media screen and (min-width: 1220px)": {
						flexWrap: "nowrap !important",
						alignItems: "center !important",
					},
				}}
			>
				<Flex
					gap={{ base: 1.5, md: 2 }}
					sx={{
						flexDirection: "column",
						alignItems: "flex-start",
						"@media screen and (max-width: 599.98px)": {
							flexDirection: "column !important",
							alignItems: "flex-start !important",
							width: "100% !important",
							gap: "6px !important",
						},
						"@media screen and (min-width: 600px) and (max-width: 1040px)": {
							flexDirection: "row !important",
							alignItems: "center !important",
							width: "100% !important",
							gap: "12px !important",
						},
						"@media screen and (min-width: 1040.02px)": {
							"body:has([data-sidebar-collapsed='true']) &, body[data-sidebar-collapsed='true'] &":
								{
									flexDirection: "column !important",
									alignItems: "flex-start !important",
									width: "auto !important",
									gap: "6px !important",
								},
							"body:not([data-sidebar-collapsed='true']):not(:has([data-sidebar-collapsed='true'])) &":
								{
									flexDirection: "row !important",
									alignItems: "center !important",
									width: "100% !important",
									gap: "12px !important",
								},
						},
						"@media screen and (min-width: 1220px)": {
							flexDirection: "column !important",
							alignItems: "flex-start !important",
							width: "auto !important",
							gap: "6px !important",
						},
					}}
				>
					<Text
						fontSize={{ base: "18px", md: "20px" }}
						fontWeight="700"
						color="panel.text"
						letterSpacing="-0.02em"
						whiteSpace="nowrap"
						flexShrink={0}
					>
						{t("dashboard.system.overview")}
					</Text>
					<Flex align="center" gap={2} direction="row" flexWrap="nowrap" flexShrink={0}>
						<Box
							w="7px"
							h="7px"
							borderRadius="full"
							bg={
								systemData.xray_running && !hasXrayError ? "#22c55e" : "#ef4444"
							}
							sx={{
								animation:
									systemData.xray_running && !hasXrayError
										? "livePulse 3.5s ease-in-out infinite"
										: "none",
								boxShadow:
									systemData.xray_running && !hasXrayError
										? "0 0 5px rgba(34, 197, 94, 0.4)"
										: "0 0 5px rgba(239, 68, 68, 0.4)",
								"@keyframes livePulse": {
									"0%, 100%": { opacity: 0.65, transform: "scale(1)" },
									"50%": {
										opacity: 1,
										transform: "scale(1.08)",
										boxShadow: "0 0 8px rgba(34, 197, 94, 0.6)",
									},
								},
							}}
						/>
						<Text fontSize="12px" color="panel.textSecondary" fontWeight="600">
							{hasXrayError
								? t("diagnostics.statusError")
								: systemData.xray_running
									? t("dashboard.system.statusRunning")
									: t("dashboard.system.statusStopped")}
						</Text>
						{systemData.os && (
							<HStack
								spacing={1.5}
								align="center"
								color="panel.textSecondary"
								fontSize="12px"
								fontWeight="600"
							>
								<Text as="span">·</Text>
								<Text as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
									{systemData.os}
								</Text>
							</HStack>
						)}
						{exactVersion && exactVersion !== "-" && (
							<HStack
								spacing={1.5}
								align="center"
								color="panel.textSecondary"
								fontSize="12px"
								fontWeight="600"
							>
								<Text as="span">·</Text>
								<Text as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
									{exactVersion}
								</Text>
							</HStack>
						)}
					</Flex>
				</Flex>
				<DashboardMaintenanceControls
					channel={systemData.channel}
					version={systemData.version}
				/>
			</Flex>

			<SimpleGrid
				columns={{ base: 1, sm: 2, xl: 4 }}
				gap={{ base: 3, md: 4 }}
				sx={{
					"@media screen and (min-width: 768px) and (max-width: 910px)": {
						"body:not(:has([data-sidebar-collapsed='true'])) &": {
							gridTemplateColumns: "1fr !important",
						},
					},
				}}
			>
				<ResourceCard
					label={t("dashboard.system.cpuUsage")}
					icon={<CpuChipIcon width={16} />}
					value={formatPercent(systemData.cpu_usage, false)}
					percent={systemData.cpu_usage}
					metaValue={formatNumberValue(systemData.cpu_cores)}
					metaUnit={t("dashboard.system.core")}
					subMeta={
						systemData.load_avg && systemData.load_avg.length >= 3 ? (
							<Flex
								align="center"
								gap={1.5}
								fontSize="11px"
								fontWeight="500"
								color="panel.textMuted"
								dir={isRTL ? "rtl" : "ltr"}
							>
								<Text as="span">{t("loadAverage")}:</Text>
								<Text
									as="span"
									dir="ltr"
									sx={{
										fontVariantNumeric: "tabular-nums",
										unicodeBidi: "isolate",
									}}
								>
									{systemData.load_avg
										.slice(0, 3)
										.map((v) => v.toFixed(2))
										.join(" · ")}
								</Text>
							</Flex>
						) : undefined
					}
					footerLeft={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.cpu_history.map((e) => e.value)), isRTL)}`}
					footerRight={`${t("dashboard.system.peak")}: ${formatPercent(peak(systemData.cpu_history.map((e) => e.value)), isRTL)}`}
					historyLabel={t("dashboard.system.viewHistory")}
					isRTL={isRTL}
					onHistory={() =>
						openHistory({
							type: "cpu",
							title: t("dashboard.system.cpuUsage"),
							metricLabel: t("dashboard.system.cpuUsage"),
							entries: systemData.cpu_history,
						})
					}
				/>
				<ResourceCard
					label={t("dashboard.system.memoryUsage")}
					icon={<ServerStackIcon width={16} />}
					value={formatBytes(systemData.memory.current, 1)}
					totalValue={formatBytes(systemData.memory.total, 1)}
					percent={systemData.memory.percent}
					footerLeft={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.memory_history.map((e) => e.value)), isRTL)}`}
					footerRight={`${t("dashboard.system.peak")}: ${formatPercent(peak(systemData.memory_history.map((e) => e.value)), isRTL)}`}
					historyLabel={t("dashboard.system.viewHistory")}
					isRTL={isRTL}
					onHistory={() =>
						openHistory({
							type: "memory",
							title: t("dashboard.system.memoryUsage"),
							metricLabel: t("dashboard.system.memoryUsage"),
							entries: systemData.memory_history,
						})
					}
				/>
				<ResourceCard
					label={t("dashboard.system.swapUsage")}
					icon={<CircleStackIcon width={16} />}
					value={formatBytes(systemData.swap.current, 1)}
					totalValue={formatBytes(systemData.swap.total, 1)}
					percent={systemData.swap.percent}
					footerLeft={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.swap_history.map((e) => e.value)), isRTL)}`}
					footerRight={`${t("dashboard.system.peak")}: ${formatPercent(peak(systemData.swap_history.map((e) => e.value)), isRTL)}`}
					isRTL={isRTL}
				/>
				<ResourceCard
					label={t("dashboard.system.diskUsage")}
					icon={<CircleStackIcon width={16} />}
					value={formatBytes(systemData.disk.current, 1)}
					totalValue={formatBytes(systemData.disk.total, 1)}
					percent={systemData.disk.percent}
					footerLeft={`${t("dashboard.system.free")}: ${formatBytes(Math.max(0, systemData.disk.total - systemData.disk.current), 1)}`}
					footerRight={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.disk_history.map((e) => e.value)), isRTL)}`}
					isRTL={isRTL}
				/>
			</SimpleGrid>

			<SimpleGrid
				columns={{ base: 1, md: 2 }}
				gap={{ base: 3, md: 4 }}
				sx={{
					"@media screen and (min-width: 768px) and (max-width: 910px)": {
						"body:not(:has([data-sidebar-collapsed='true'])) &": {
							gridTemplateColumns: "1fr !important",
						},
					},
				}}
			>
				<SectionCard
					title={
						<HStack spacing={2.5}>
							<Flex
								w="26px"
								h="26px"
								align="center"
								justify="center"
								borderRadius="7px"
								bg="panel.elevated"
								color="panel.textSecondary"
								data-rb-icon=""
							>
								<SignalIcon width={14} />
							</Flex>
							<span>{t("dashboard.system.bandwidthSpeed")}</span>
						</HStack>
					}
					action={
						<HStack spacing={2}>
							{canSeeGlobal ? (
								<HStack spacing={0.5} bg="panel.elevated" p={0.5} borderRadius="8px" position="relative" transition="all 0.25s ease">
									<Box position="relative">
										{bandwidthScope === "master" && (
											<motion.div
												layoutId="bandwidthScopeTabPill"
												style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: "6px", backgroundColor: "var(--rb-panel-accent)", border: "1px solid var(--rb-panel-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.12)", zIndex: 1 }}
												transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
											/>
										)}
										<Button
											size="xs"
											h="22px"
											px={2.5}
											borderRadius="6px"
											fontSize="11px"
											fontWeight="600"
											variant="ghost"
											bg="transparent !important"
											color={bandwidthScope === "master" ? "white" : "panel.text"}
											position="relative"
											zIndex={2}
											transition="all 0.2s ease"
											_focusVisible={{ outline: "2px solid var(--rb-panel-accent)", outlineOffset: "2px" }}
											onClick={() => setBandwidthScope("master")}
										>
											{t("dashboard.system.bandwidthScope.master")}
										</Button>
									</Box>
									<Box position="relative">
										{bandwidthScope === "total" && (
											<motion.div
												layoutId="bandwidthScopeTabPill"
												style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: "6px", backgroundColor: "var(--rb-panel-accent)", border: "1px solid var(--rb-panel-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.12)", zIndex: 1 }}
												transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
											/>
										)}
										<Button
											size="xs"
											h="22px"
											px={2.5}
											borderRadius="6px"
											fontSize="11px"
											fontWeight="600"
											variant="ghost"
											bg="transparent !important"
											color={bandwidthScope === "total" ? "white" : "panel.text"}
											position="relative"
											zIndex={2}
											transition="all 0.2s ease"
											_focusVisible={{ outline: "2px solid var(--rb-panel-accent)", outlineOffset: "2px" }}
											onClick={() => setBandwidthScope("total")}
											title={t("dashboard.system.bandwidthScope.totalHint")}
										>
											{t("dashboard.system.bandwidthScope.total")}
										</Button>
									</Box>
								</HStack>
							) : null}
							{!showTotalBandwidth ? (
								<Button
									size="xs"
									h="22px"
									px={2.5}
									fontSize="11px"
									variant="ghost"
									borderRadius="full"
									bg="panel.elevated"
									color={
										colorMode === "light"
											? "panel.textSecondary"
											: "panel.textMuted"
									}
									fontWeight={colorMode === "light" ? "600" : "500"}
									transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
									data-rb-swap=""
									_hover={{
										md: {
											bg: "panel.border !important",
											color: "panel.text !important",
										},
									}}
									_active={{
										bg: "panel.borderStrong !important",
										transform: "scale(0.97)",
									}}
									_focusVisible={{
										outline: "2px solid var(--rb-panel-accent)",
										outlineOffset: "2px",
									}}
									position="relative"
									_after={{
										content: '""',
										position: "absolute",
										top: "-10px",
										bottom: "-10px",
										left: "-10px",
										right: "-10px",
									}}
									onClick={() =>
										openHistory({
											type: "network",
											title: t("dashboard.system.bandwidthSpeed"),
											networkEntries: systemData.network_history,
										})
									}
								>
									{t("dashboard.system.viewHistory")}
								</Button>
							) : null}
						</HStack>
					}
				>
					<Stack spacing={3}>
						<SpeedItem
							icon={<ArrowDownTrayIcon width={13} />}
							label={t("dashboard.system.incomingSpeed")}
							value={`${formatBytes(showTotalBandwidth ? (systemData.total_incoming_bandwidth_speed ?? 0) : systemData.incoming_bandwidth_speed)}/s`}
						/>
						<SpeedItem
							icon={<ArrowUpTrayIcon width={13} />}
							label={t("dashboard.system.outgoingSpeed")}
							value={`${formatBytes(showTotalBandwidth ? (systemData.total_outgoing_bandwidth_speed ?? 0) : systemData.outgoing_bandwidth_speed)}/s`}
						/>
					</Stack>
				</SectionCard>

				<SectionCard
					title={
						<HStack spacing={2.5}>
							<Flex
								w="26px"
								h="26px"
								align="center"
								justify="center"
								borderRadius="7px"
								bg="panel.elevated"
								color="panel.textSecondary"
								data-rb-icon=""
							>
								<ClockIcon width={14} />
							</Flex>
							<span>{t("dashboard.system.uptime")}</span>
						</HStack>
					}
				>
					<Stack spacing={3}>
						<Flex align="center" justify="space-between" gap={3}>
							<HStack spacing={2.5} color="panel.textMuted">
								<Flex
									w="28px"
									h="28px"
									align="center"
									justify="center"
									borderRadius="8px"
									bg="panel.elevated"
									flexShrink={0}
									data-rb-icon=""
								>
									<ServerStackIcon width={13} />
								</Flex>
								<Text
									fontSize="13px"
									fontWeight="600"
									color="panel.textSecondary"
								>
									{t("dashboard.system.systemUptime")}
								</Text>
							</HStack>
							{formatLocalizedDuration(systemData.uptime_seconds, t, isRTL)}
						</Flex>
						<Flex align="center" justify="space-between" gap={3}>
							<HStack spacing={2.5} color="panel.textMuted">
								<Flex
									w="28px"
									h="28px"
									align="center"
									justify="center"
									borderRadius="8px"
									bg="panel.elevated"
									flexShrink={0}
									data-rb-icon=""
								>
									<CircleStackIcon width={13} />
								</Flex>
								<Text
									fontSize="13px"
									fontWeight="600"
									color="panel.textSecondary"
								>
									{t("dashboard.system.panelUptime")}
								</Text>
							</HStack>
							{formatLocalizedDuration(
								systemData.panel_uptime_seconds,
								t,
								isRTL,
							)}
						</Flex>
					</Stack>
				</SectionCard>
			</SimpleGrid>

			<SectionCard
				noHover
				roleGroup={false}
				title={
					<HStack spacing={2.5}>
						<Flex
							w="26px"
							h="26px"
							align="center"
							justify="center"
							borderRadius="7px"
							bg="panel.elevated"
							color="panel.textSecondary"
							data-rb-icon=""
						>
							<CpuChipIcon width={14} />
						</Flex>
						<span>{t("dashboard.system.panelUsage")}</span>
					</HStack>
				}
				action={
					<Button
						size="xs"
						h="22px"
						px={2.5}
						fontSize="11px"
						variant="ghost"
						borderRadius="full"
						bg="panel.elevated"
						color={
							colorMode === "light" ? "panel.textSecondary" : "panel.textMuted"
						}
						fontWeight={colorMode === "light" ? "600" : "500"}
						transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
						_hover={{
							md: {
								bg: "panel.border !important",
								color: "panel.text !important",
							},
						}}
						_active={{
							bg: "panel.borderStrong !important",
							transform: "scale(0.97)",
						}}
						_focusVisible={{
							outline: "2px solid var(--rb-panel-accent)",
							outlineOffset: "2px",
						}}
						position="relative"
						_after={{
							content: '""',
							position: "absolute",
							top: "-10px",
							bottom: "-10px",
							left: "-10px",
							right: "-10px",
						}}
						onClick={() =>
							openHistory({
								type: "panel",
								title: t("dashboard.system.panelUsage"),
								cpuEntries: systemData.panel_cpu_history,
								memoryEntries: systemData.panel_memory_history,
							})
						}
					>
						{t("dashboard.system.viewHistory")}
					</Button>
				}
			>
				<SimpleGrid columns={{ base: 1, sm: 2 }} gap={{ base: 3, md: 4 }}>
					<ResourceCard
						label={`${t("dashboard.system.cpuUsage")} (Panel)`}
						icon={<CpuChipIcon width={16} />}
						value={formatPercent(systemData.panel_cpu_percent, false)}
						percent={systemData.panel_cpu_percent}
						metaValue={formatNumberValue(systemData.app_threads)}
						metaUnit={t("dashboard.system.thread")}
						footerLeft={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.panel_cpu_history.map((e) => e.value)), isRTL)}`}
						footerRight={`${t("dashboard.system.peak")}: ${formatPercent(peak(systemData.panel_cpu_history.map((e) => e.value)), isRTL)}`}
						isRTL={isRTL}
					/>
					<ResourceCard
						label={`${t("dashboard.system.memoryUsage")} (Panel)`}
						icon={<ServerStackIcon width={16} />}
						value={formatBytes(systemData.app_memory, 1)}
						totalValue={formatBytes(systemData.memory.total, 1)}
						percent={systemData.panel_memory_percent}
						footerLeft={`${t("dashboard.system.average")}: ${formatPercent(average(systemData.panel_memory_history.map((e) => e.value)), isRTL)}`}
						footerRight={`${t("dashboard.system.peak")}: ${formatPercent(peak(systemData.panel_memory_history.map((e) => e.value)), isRTL)}`}
						isRTL={isRTL}
					/>
				</SimpleGrid>
			</SectionCard>

			<SectionCard
				title={
					<HStack spacing={2.5}>
						<Flex
							w="28px"
							h="28px"
							align="center"
							justify="center"
							borderRadius="10px"
							bg="panel.elevated"
							color="panel.textSecondary"
							transition="background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
							data-rb-icon=""
						>
							<UserGroupIcon width={14} />
						</Flex>
						<span>{t("dashboard.users")}</span>
					</HStack>
				}
				action={
					canSeeGlobal ? (
						<HStack
							spacing={0.5}
							bg="panel.elevated"
							p={0.5}
							borderRadius="10px"
							position="relative"
							transition="background-color 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease"
							data-rb-swap=""
						>
							<Box position="relative">
								{userTab === "all" && (
									<motion.div
										layoutId="usersOverviewTabPill"
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											borderRadius: "8px",
											backgroundColor: "var(--rb-panel-accent)",
											border: "1px solid var(--rb-panel-accent)",
											zIndex: 1,
										}}
										transition={{
											type: "tween",
											ease: [0.16, 1, 0.3, 1],
											duration: 0.22,
										}}
									/>
								)}
								<Button
									size="xs"
									h="22px"
									px={2.5}
									borderRadius="8px"
									fontSize="11px"
									fontWeight="600"
									variant="ghost"
									bg="transparent !important"
									color={userTab === "all" ? "white" : "panel.textSecondary"}
									position="relative"
									zIndex={2}
									transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
									_hover={{
										md: {
											color: userTab === "all" ? "white" : "panel.text",
										},
									}}
									_active={{
										transform: "scale(0.97)",
									}}
									_focusVisible={{
										outline: "2px solid var(--rb-panel-accent)",
										outlineOffset: "2px",
									}}
									onClick={() => setUserTab("all")}
								>
									{t("dashboard.users.allUsers")}
								</Button>
							</Box>
							<Box position="relative">
								{userTab === "mine" && (
									<motion.div
										layoutId="usersOverviewTabPill"
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											borderRadius: "8px",
											backgroundColor: "var(--rb-panel-accent)",
											border: "1px solid var(--rb-panel-accent)",
											zIndex: 1,
										}}
										transition={{
											type: "tween",
											ease: [0.16, 1, 0.3, 1],
											duration: 0.22,
										}}
									/>
								)}
								<Button
									size="xs"
									h="22px"
									px={2.5}
									borderRadius="8px"
									fontSize="11px"
									fontWeight="600"
									variant="ghost"
									bg="transparent !important"
									color={userTab === "mine" ? "white" : "panel.textSecondary"}
									position="relative"
									zIndex={2}
									transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
									_hover={{
										md: {
											color: userTab === "mine" ? "white" : "panel.text",
										},
									}}
									_active={{
										transform: "scale(0.97)",
									}}
									_focusVisible={{
										outline: "2px solid var(--rb-panel-accent)",
										outlineOffset: "2px",
									}}
									onClick={() => setUserTab("mine")}
								>
									{t("dashboard.users.myUsers")}
								</Button>
							</Box>
						</HStack>
					) : undefined
				}
			>
				<AnimatedHeightWrapper activeKey={userTab}>
					{canSeeGlobal && userTab === "all" ? (
						<Stack spacing={0}>
							<StatRow
								label={t("dashboard.users.total")}
								value={systemData.total_user}
								tagColor="#3b82f6"
							/>
							<StatRow
								label={t("dashboard.users.active")}
								value={systemData.users_active}
								tag={activePercent}
								tagColor="#22c55e"
							/>
							<StatRow
								label={t("dashboard.users.online")}
								value={systemData.online_users}
								tag={onlinePercent}
								tagColor="#06b6d4"
								helper={
									systemData.online_users_upload_speed ||
									systemData.online_users_download_speed
										? `↑ ${formatBytes(systemData.online_users_upload_speed)}/s · ↓ ${formatBytes(systemData.online_users_download_speed)}/s`
										: undefined
								}
							/>
							<StatRow
								label={t("dashboard.users.onHold")}
								value={systemData.users_on_hold}
								tagColor="#a855f7"
							/>
							<StatRow
								label={t("dashboard.users.limited")}
								value={systemData.users_limited}
								tagColor="#f59e0b"
							/>
							<StatRow
								label={t("dashboard.users.expired")}
								value={systemData.users_expired}
								tagColor="#f97316"
							/>
						</Stack>
					) : (
						<Stack spacing={0}>
							<StatRow
								label={t("dashboard.users.total")}
								value={myTotalUsers}
								tagColor="#3b82f6"
							/>
							<StatRow
								label={t("dashboard.users.active")}
								value={myActiveUsers}
								tag={myActivePercent}
								tagColor="#22c55e"
							/>
							<StatRow
								label={t("dashboard.users.online")}
								value={myOnlineUsers}
								tag={myOnlinePercent}
								tagColor="#06b6d4"
								helper={
									myOnlineUploadSpeed || myOnlineDownloadSpeed
										? `↑ ${formatBytes(myOnlineUploadSpeed)}/s · ↓ ${formatBytes(myOnlineDownloadSpeed)}/s`
										: undefined
								}
							/>
							<StatRow
								label={t("dashboard.users.onHold")}
								value={myOnHoldUsers}
								tagColor="#a855f7"
							/>
							<StatRow
								label={t("dashboard.users.limited")}
								value={myLimitedUsers}
								tagColor="#f59e0b"
							/>
							<StatRow
								label={t("dashboard.users.expired")}
								value={myExpiredUsers}
								tagColor="#f97316"
							/>
							<StatRow
								label={t("dashboard.users.currentUserUsage")}
								value={formatBytes(myActiveUsersUsedTraffic, 1)}
								tagColor="#3b82f6"
							/>
							{systemData.personal_usage?.reset_bytes ? (
								<StatRow
									label={t("dashboard.users.resetData")}
									value={formatBytes(systemData.personal_usage.reset_bytes, 1)}
									tagColor="#f59e0b"
								/>
							) : null}
						</Stack>
					)}
				</AnimatedHeightWrapper>
			</SectionCard>

			{canSeeGlobal && systemData.admin_overview && (
				<SectionCard
					title={
						<HStack spacing={2.5}>
							<Flex
								w="26px"
								h="26px"
								align="center"
								justify="center"
								borderRadius="7px"
								bg="panel.elevated"
								color="panel.textSecondary"
								data-rb-icon=""
							>
								<ShieldCheckIcon width={14} />
							</Flex>
							<span>{t("dashboard.admins")}</span>
						</HStack>
					}
				>
					<Stack spacing={0}>
						<StatRow
							label={t("dashboard.admins.total")}
							value={systemData.admin_overview.total_admins}
							tagColor="#3b82f6"
						/>
						<StatRow
							label={t("dashboard.admins.fullAccess")}
							value={systemData.admin_overview.full_access_admins}
							tagColor="#f59e0b"
						/>
						<StatRow
							label={t("dashboard.admins.sudo")}
							value={systemData.admin_overview.sudo_admins}
							tagColor="#a855f7"
						/>
						<StatRow
							label={t("dashboard.admins.standard")}
							value={systemData.admin_overview.standard_admins}
							tagColor="#22c55e"
						/>
						{systemData.admin_overview.top_admin_username && (
							<StatRow
								label={t("dashboard.admins.topAdmin")}
								value={`${systemData.admin_overview.top_admin_username} · ${formatBytes(systemData.admin_overview.top_admin_usage)}`}
								dimLabel
								accent
							/>
						)}
					</Stack>
				</SectionCard>
			)}

			<HistoryModal
				isOpen={Boolean(historyPayload)}
				onClose={() => setHistoryPayload(null)}
				payload={historyPayload}
				intervalSeconds={historyInterval}
				onIntervalChange={setHistoryInterval}
				t={t}
				isRTL={isRTL}
			/>
		</Stack>
	);
};
