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
	VStack,
	useColorMode,
	useColorModeValue,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
	CircleStackIcon,
	ClockIcon,
	CpuChipIcon,
	ExclamationTriangleIcon,
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
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "react-query";
import { fetch } from "service/http";
import { AdminRole } from "types/Admin";
import type { SystemStats } from "types/System";
import type { UsersListResponse } from "types/User";
import { formatBytes, numberWithCommas } from "utils/formatByte";
import { mergeLiveSystemStats } from "utils/systemMetrics";
import { getAPIWebSocketURL } from "utils/websocket";
import { DashboardMaintenanceControls } from "./DashboardMaintenanceControls";

export const StatisticsQueryKey = "statistics-query-key";

const HistoryChart = lazy(() => import("react-apexcharts"));

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
		const parts: string[] = [formatUnit(days, "dashboard.system.durationDay", "dashboard.system.durationDays")];
		if (hours > 0) {
			parts.push(formatUnit(hours, "dashboard.system.durationHour", "dashboard.system.durationHours"));
		}
		if (minutes > 0) {
			parts.push(formatUnit(minutes, "dashboard.system.durationMinute", "dashboard.system.durationMinutes"));
		}
		if (parts.length === 1) return parts[0];
		if (parts.length === 2) return parts.join(andWord);
		return parts.slice(0, -1).join(commaWord) + andWord + parts[parts.length - 1];
	}

	if (hours > 0) {
		const hStr = formatUnit(hours, "dashboard.system.durationHour", "dashboard.system.durationHours");
		if (minutes > 0) {
			const mStr = formatUnit(minutes, "dashboard.system.durationMinute", "dashboard.system.durationMinutes");
			return `${hStr}${andWord}${mStr}`;
		}
		return hStr;
	}

	if (minutes > 0) {
		const mStr = formatUnit(minutes, "dashboard.system.durationMinute", "dashboard.system.durationMinutes");
		if (remSeconds > 0) {
			const sStr = formatUnit(remSeconds, "dashboard.system.durationSecond", "dashboard.system.durationSeconds");
			return `${mStr}${andWord}${sStr}`;
		}
		return mStr;
	}

	return formatUnit(remSeconds, "dashboard.system.durationSecond", "dashboard.system.durationSeconds");
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
				try {
					const payload = JSON.parse(event.data);
					const stats = payload?.stats ?? payload;
					if (!stats || typeof stats !== "object" || !("version" in stats)) return;
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

const sanitizeSystemStats = (value: SystemStats | undefined): SystemStats | null => {
	if (!value || typeof value !== "object") return null;
	const raw = value as any;
	return {
		...value,
		version: String(raw.version ?? ""),
		cpu_cores: toFiniteNumber(raw.cpu_cores),
		cpu_threads: toFiniteNumber(raw.cpu_threads),
		cpu_frequency_hz: toFiniteNumber(raw.cpu_frequency_hz),
		cpu_usage: toFiniteNumber(raw.cpu_usage),
		total_user: toFiniteNumber(raw.total_user),
		online_users: toFiniteNumber(raw.online_users),
		online_users_usage: toFiniteNumber(raw.online_users_usage),
		online_users_upload_speed: toFiniteNumber(raw.online_users_upload_speed),
		online_users_download_speed: toFiniteNumber(raw.online_users_download_speed),
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
		memory: safeUsageStats(raw.memory),
		swap: safeUsageStats(raw.swap),
		disk: safeUsageStats(raw.disk),
		load_avg: Array.isArray(raw.load_avg) ? raw.load_avg.map((item: unknown) => toFiniteNumber(item)) : [],
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

const expandShortData = <T extends { timestamp: number }>(entries: T[]): T[] => {
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
}> = ({ isOpen, onClose, payload, intervalSeconds, onIntervalChange, t, isRTL = false }) => {
	const { colorMode } = useColorMode();
	const [isSwitchingInterval, setIsSwitchingInterval] = useState(false);
	const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
	const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 4, width: 0 });
	const gridColor = useColorModeValue("rgba(0,0,0,0.06)", "rgba(255,255,255,0.06)");
	const mutedTextColor = useColorModeValue("#64748b", "#94a3b8");

	const activeIntervalIndex = HISTORY_INTERVALS.findIndex((i) => i.seconds === intervalSeconds);

	useEffect(() => {
		const targetEl = tabRefs.current[activeIntervalIndex];
		if (targetEl) {
			setPillStyle({
				left: targetEl.offsetLeft,
				width: targetEl.offsetWidth,
			});
		}
	}, [activeIntervalIndex]);

	const { latestTimestamp, availableSpan } = useMemo(() => {
		if (!payload) return { latestTimestamp: Math.floor(Date.now() / 1000), availableSpan: 120 };
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

		if (!timestamps.length) return { latestTimestamp: Math.floor(Date.now() / 1000), availableSpan: 120 };
		const maxT = Math.max(...timestamps);
		const minT = Math.min(...timestamps);
		return { latestTimestamp: maxT, availableSpan: Math.max(120, maxT - minT) };
	}, [payload]);

	const cutoff = latestTimestamp - intervalSeconds;

	const chartSeries = useMemo(() => {
		if (!payload) return [];
		if (payload.type === "network" && payload.networkEntries) {
			const filtered = payload.networkEntries.filter((e) => e.timestamp >= cutoff);
			const rawData = filtered.length >= 1 ? filtered : payload.networkEntries;
			const finalData = expandShortData(rawData);
			return [
				{
					name: t("dashboard.system.networkIncoming"),
					data: finalData.map((e) => [e.timestamp * 1000, e.incoming]),
				},
				{
					name: t("dashboard.system.networkOutgoing"),
					data: finalData.map((e) => [e.timestamp * 1000, e.outgoing]),
				},
			];
		}
		if (payload.type === "panel") {
			const filteredCpu = (payload.cpuEntries || []).filter((e) => e.timestamp >= cutoff);
			const filteredMem = (payload.memoryEntries || []).filter((e) => e.timestamp >= cutoff);
			const rawCpu = filteredCpu.length >= 1 ? filteredCpu : payload.cpuEntries || [];
			const rawMem = filteredMem.length >= 1 ? filteredMem : payload.memoryEntries || [];
			const finalCpu = expandShortData(rawCpu);
			const finalMem = expandShortData(rawMem);
			return [
				{
					name: `${t("dashboard.system.cpuUsage")} (Panel CPU %)`,
					data: finalCpu.map((e) => [e.timestamp * 1000, e.value]),
				},
				{
					name: `${t("dashboard.system.memoryUsage")} (Panel RAM %)`,
					data: finalMem.map((e) => [e.timestamp * 1000, e.value]),
				},
			];
		}
		if (payload.entries) {
			const filtered = payload.entries.filter((e) => e.timestamp >= cutoff);
			const rawEntries = filtered.length >= 1 ? filtered : payload.entries;
			const finalEntries = expandShortData(rawEntries);
			return [
				{
					name: payload.metricLabel ?? payload.title,
					data: finalEntries.map((e) => [e.timestamp * 1000, e.value]),
				},
			];
		}
		return [];
	}, [payload, cutoff, t]);

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
					bottom: 0,
					left: 5,
				},
			},
			xaxis: {
				type: "datetime",
				axisBorder: { show: false },
				axisTicks: { show: false },
				tickPlacement: "between",
				labels: {
					style: { colors: mutedTextColor, fontSize: "11px", fontFamily: "inherit" },
					datetimeUTC: false,
					format: intervalSeconds <= 1800 ? "HH:mm:ss" : "HH:mm",
					hideOverlappingLabels: true,
				},
			},
			yaxis: {
				min: isNetwork ? undefined : computedMin,
				max: isNetwork ? undefined : computedMax,
				forceNiceScale: isNetwork,
				tickAmount: 5,
				labels: {
					offsetX: 0,
					style: { colors: mutedTextColor, fontSize: "11px", fontFamily: "inherit" },
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
				labels: { colors: mutedTextColor },
				itemMargin: { horizontal: 12, vertical: 6 },
				markers: {
					offsetX: isRTL ? 6 : -6,
					offsetY: 0,
				},
				formatter: (seriesName: string) => {
					return isRTL ? `\u200E${seriesName}\u00A0\u00A0` : `\u00A0\u00A0${seriesName}`;
				},
				onItemClick: {
					toggleDataSeries: true,
				},
				onItemHover: {
					highlightDataSeries: true,
				},
			},
			tooltip: {
				theme: colorMode,
				custom: ({ series, seriesIndex, dataPointIndex, w }) => {
					const timestamp = w.globals.seriesX[seriesIndex]?.[dataPointIndex];
					const dateStr = timestamp
						? new Date(timestamp).toLocaleTimeString(isRTL ? "fa-IR" : "en-US", {
								hour12: false,
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							})
						: "";

					const linesHtml = w.globals.seriesNames
						.map((name: string, i: number) => {
							const val = series[i]?.[dataPointIndex];
							if (val === undefined || Number.isNaN(val)) return "";
							const color = w.globals.colors[i] || "var(--rb-panel-accent)";
							const displayVal = isNetwork ? `${formatBytes(val, 2)}/s` : `${Math.round(val * 10) / 10}%`;
							return `
								<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px;">
									<div style="display: flex; align-items: center; gap: 6px;">
										<span style="width: 7px; height: 7px; border-radius: 50%; background: ${color}; box-shadow: 0 0 6px ${color}88; flex-shrink: 0;"></span>
										<span style="color: var(--chakra-colors-panel-textSecondary, #94a3b8); font-size: 11px; font-weight: 500;">${name}</span>
									</div>
									<span style="color: var(--chakra-colors-panel-text, #ffffff); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; direction: ltr;">${displayVal}</span>
								</div>
							`;
						})
						.join("");

					return `
						<div style="
							background: rgba(22, 23, 28, 0.9);
							backdrop-filter: blur(16px);
							-webkit-backdrop-filter: blur(16px);
							outline: 1px solid rgba(255, 255, 255, 0.1);
							outline-offset: -1px;
							border-radius: 12px;
							padding: 8px 12px;
							box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.6), inset 0 1px 1px 0 rgba(255, 255, 255, 0.1);
							direction: ${isRTL ? "rtl" : "ltr"};
							font-family: inherit;
							min-width: 140px;
						">
							<div style="color: var(--chakra-colors-panel-textMuted, #64748b); font-size: 10px; font-weight: 600; direction: ltr; text-align: ${isRTL ? "right" : "left"}; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 4px; margin-bottom: 4px;">
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
		],
	);

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside" isCentered>
			<ModalOverlay bg="blackAlpha.700" backdropFilter="blur(16px)" />
			<ModalContent
				bg="panel.surface"
				borderWidth="1px"
				borderColor="panel.border"
				borderRadius="20px"
				boxShadow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.08), 0 32px 80px rgba(0,0,0,0.6)"
				mx={{ base: 3, sm: 6 }}
				overflow="hidden"
			>
				<ModalHeader
					display="flex"
					alignItems="center"
					justifyContent="space-between"
					px={{ base: 4, md: 6 }}
					py={{ base: 3.5, md: 4 }}
					borderBottomWidth="1px"
					borderColor="panel.border"
					fontSize="sm"
					fontWeight="700"
				>
					<Text color="panel.text">{t("dashboard.history.modalTitle", { metric: payload?.title ?? "" })}</Text>
					<ModalCloseButton position="static" size="sm" />
				</ModalHeader>
				<ModalBody px={{ base: 4, md: 6 }} py={{ base: 4, md: 5 }}>
					<Stack spacing={4}>
						<Box
							p={1}
							borderRadius="full"
							bg="panel.elevated"
							w="fit-content"
							position="relative"
							display="inline-flex"
							alignItems="center"
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
										duration: 0.32,
									}}
									style={{
										position: "absolute",
										top: 4,
										bottom: 4,
										borderRadius: "9999px",
										backgroundColor: "var(--chakra-colors-panel-surface)",
										boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
										zIndex: 1,
										pointerEvents: "none",
									}}
								/>
							)}
							{HISTORY_INTERVALS.map((interval, idx) => {
								const isAvailable = idx === 0 || availableSpan >= interval.seconds * 0.5;
								const isActive = intervalSeconds === interval.seconds;
								return (
									<Box
										key={interval.seconds}
										ref={(el: HTMLDivElement | null) => {
											tabRefs.current[idx] = el;
										}}
										position="relative"
										display="inline-flex"
										alignItems="center"
									>
										<Button
											size="xs"
											h="26px"
											px={3.5}
											borderRadius="full"
											variant="ghost"
											bg="transparent !important"
											color={isActive ? "panel.text" : "panel.textMuted"}
											fontWeight={isActive ? "700" : "500"}
											fontSize="11px"
											position="relative"
											zIndex={2}
											opacity={isAvailable ? 1 : 0.4}
											cursor={isAvailable ? "pointer" : "not-allowed"}
											_hover={{
												md: {
													color: "panel.text",
												},
											}}
											onClick={() => {
												if (isAvailable && intervalSeconds !== interval.seconds) {
													setIsSwitchingInterval(true);
													onIntervalChange(interval.seconds);
													setTimeout(() => setIsSwitchingInterval(false), 300);
												}
											}}
										>
											{t(interval.labelKey)}
										</Button>
									</Box>
								);
							})}
						</Box>
						<Box
							minH="280px"
							w="100%"
							position="relative"
							dir="ltr"
							sx={{
								"& .apexcharts-canvas": {
									direction: "ltr !important",
								},
								"& .apexcharts-yaxis-label": {
									direction: "ltr !important",
								},
								"& .apexcharts-legend-series.apexcharts-inactive-legend": {
									opacity: "0.45 !important",
									pointerEvents: "auto",
								},
								"& .apexcharts-legend-series.apexcharts-inactive-legend:hover": {
									opacity: "0.75 !important",
								},
								"& .apexcharts-canvas:has(.apexcharts-inactive-legend:hover) .apexcharts-series": {
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
										transition={{ duration: 0.2, ease: "easeInOut" }}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											backgroundColor: "rgba(10, 12, 16, 0.7)",
											backdropFilter: "blur(6px)",
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
								animate={{ opacity: isSwitchingInterval ? 0.3 : 1 }}
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
									{chartSeries.length > 0 && isOpen && (
										<HistoryChart
											key={`${payload?.title}-${intervalSeconds}-${colorMode}`}
											options={options}
											series={chartSeries}
											type="area"
											height={280}
											width="100%"
										/>
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
	footerLeft?: string;
	footerRight?: string;
	onHistory?: () => void;
	historyLabel?: string;
	isRTL?: boolean;
	parentNoHover?: boolean;
}> = ({
	label,
	icon,
	value,
	totalValue,
	percent,
	metaUnit,
	metaValue,
	footerLeft,
	footerRight,
	onHistory,
	historyLabel,
	isRTL = false,
	parentNoHover = false,
}) => {
	const { colorMode } = useColorMode();
	const safe = clampPercent(percent);
	const accent = "var(--rb-panel-accent)";
	const criticalColor = safe >= 90 ? "#ef4444" : safe >= 75 ? "#f59e0b" : accent;

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
			boxShadow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px -6px rgba(0, 0, 0, 0.12)"
			transition="border-color 0.25s ease, background-color 0.25s ease, box-shadow 0.25s ease"
			_hover={{
				md: {
					borderColor: "panel.borderStrong",
					bg: "panel.elevated",
					boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.08), 0 12px 32px -4px rgba(0, 0, 0, 0.22)",
				},
			}}
		>
			<Box>
				<Flex justify="space-between" align="center" mb={3}>
					<HStack spacing={2.5} align="center">
						<Flex
							w="32px"
							h="32px"
							align="center"
							justify="center"
							borderRadius="9px"
							bg="panel.elevated"
							color="panel.textSecondary"
							flexShrink={0}
						>
							{icon}
						</Flex>
						<Text fontSize="13px" fontWeight="600" color="panel.textSecondary" noOfLines={1}>
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
							borderRadius="full"
							bg="panel.elevated"
							color={colorMode === "light" ? "panel.textSecondary" : "panel.textMuted"}
							fontWeight={colorMode === "light" ? "600" : "500"}
							transition="all 0.2s ease"
							_groupHover={{
								md: {
									bg: "panel.surface",
									color: colorMode === "light" ? "panel.text" : "panel.textSecondary",
								},
							}}
							_hover={{
								md: {
									bg: "panel.border !important",
									color: "panel.text !important",
								},
							}}
							_active={{
								bg: "panel.borderStrong !important",
							}}
							onClick={onHistory}
						>
							{historyLabel}
						</Button>
					)}
				</Flex>

				<Flex align="baseline" gap={1.5} mb={1} wrap="nowrap" justify="flex-start">
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
								sx={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}
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
										sx={{ fontVariantNumeric: "tabular-nums", unicodeBidi: "isolate" }}
									>
										{metaValue}
									</Text>
									<Text fontSize="12px" fontWeight="600" color="panel.textMuted">
										{metaUnit}
									</Text>
								</Flex>
							)}
						</Flex>
					)}
				</Flex>
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
					value={safe}
					size="xs"
					borderRadius="full"
					bg="panel.elevated"
					transition="background-color 0.25s ease"
					_hover={{
						bg: "panel.surface",
					}}
					_groupHover={
						parentNoHover
							? undefined
							: {
									bg: "panel.surface",
								}
					}
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
						_groupHover={{
							bg: "panel.surface",
							color: "panel.textSecondary",
						}}
					>
						<Text as="span" dir="ltr" sx={{ fontVariantNumeric: "tabular-nums" }}>
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
}> = ({
	children,
	title,
	action,
	noHover = false,
}) => (
	<Box
		role="group"
		bg="panel.surface"
		borderWidth="1px"
		borderColor="panel.border"
		borderRadius="20px"
		overflow="hidden"
		boxShadow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px -6px rgba(0, 0, 0, 0.12)"
		transition="border-color 0.25s ease, background-color 0.25s ease, box-shadow 0.25s ease"
		_hover={
			noHover
				? undefined
				: {
						md: {
							borderColor: "panel.borderStrong",
							bg: "panel.elevated",
							boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.08), 0 12px 32px -4px rgba(0, 0, 0, 0.22)",
						},
					}
		}
	>
		{(title || action) && (
			<Flex
				px={{ base: 4, sm: 5, md: 6 }}
				py={3.5}
				align="center"
				justify="space-between"
				borderBottomWidth="1px"
				borderColor="panel.border"
			>
				{title && (
					<Text fontSize="13px" fontWeight="700" color="panel.text" letterSpacing="-0.01em">
						{title}
					</Text>
				)}
				{action}
			</Flex>
		)}
		<Box px={{ base: 4, sm: 5, md: 6 }} py={4}>
			{children}
		</Box>
	</Box>
);

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
					const newHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
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

const SpeedItem: FC<{ icon: ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
	<Flex align="center" justify="space-between" gap={3}>
		<HStack spacing={2.5} color="panel.textMuted">
			<Flex w="28px" h="28px" align="center" justify="center" borderRadius="8px" bg="panel.elevated" flexShrink={0}>
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

	const systemData = useMemo(() => sanitizeSystemStats(rawSystemData), [rawSystemData]);
	useSystemMetricsStream(true);

	useEffect(() => {
		if (systemData?.version && version !== systemData.version) {
			useDashboard.setState({ version: systemData.version });
		}
	}, [systemData?.version, version]);

	const [historyPayload, setHistoryPayload] = useState<HistoryModalPayload | null>(null);
	const [historyInterval, setHistoryInterval] = useState(HISTORY_INTERVALS[0].seconds);
	const [userTab, setUserTab] = useState<"all" | "mine">("all");
	const { colorMode } = useColorMode();

	const canSeeGlobal = userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;

	const openHistory = (payload: HistoryModalPayload) => {
		setHistoryInterval(HISTORY_INTERVALS[0].seconds);
		setHistoryPayload(payload);
	};

	const redErrorBg = useColorModeValue("red.50", "rgba(220,38,38,0.08)");
	const redErrorBorder = useColorModeValue("red.200", "rgba(220,38,38,0.2)");
	const redErrorColor = useColorModeValue("red.900", "red.200");
	const orangeErrorBg = useColorModeValue("orange.50", "rgba(234,88,12,0.08)");
	const orangeErrorBorder = useColorModeValue("orange.200", "rgba(234,88,12,0.2)");
	const orangeErrorColor = useColorModeValue("orange.900", "orange.200");

	if (!systemData) {
		return (
			<Flex justify="center" align="center" minH="60vh" w="full">
				<VStack spacing={4}>
					<Spinner size="lg" color="panel.accent" thickness="2px" speed="0.8s" />
					<Text fontSize="13px" color="panel.textMuted">{t("loading")}</Text>
				</VStack>
			</Flex>
		);
	}

	const activePercent =
		systemData.total_user > 0
			? formatPercent((systemData.users_active / systemData.total_user) * 100, isRTL)
			: formatPercent(0, isRTL);
	const onlinePercent =
		systemData.total_user > 0
			? formatPercent((systemData.online_users / systemData.total_user) * 100, isRTL)
			: formatPercent(0, isRTL);

	const myTotalUsers = myUsersData?.total ?? systemData.personal_usage?.total_users ?? 0;
	const myActiveUsers = myUsersData?.active_total ?? myUsersData?.status_breakdown?.active ?? myTotalUsers;
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
	const myOnHoldUsers = myUsersData?.status_breakdown?.on_hold ?? myUsersList.filter((u) => u.status === "on_hold").length;
	const myLimitedUsers = myUsersData?.status_breakdown?.limited ?? myUsersList.filter((u) => u.status === "limited").length;
	const myExpiredUsers = myUsersData?.status_breakdown?.expired ?? myUsersList.filter((u) => u.status === "expired").length;
	const myOnlineUploadSpeed = myUsersList.reduce((sum, u) => sum + (Number(u.upload_speed) || 0), 0);
	const myOnlineDownloadSpeed = myUsersList.reduce((sum, u) => sum + (Number(u.download_speed) || 0), 0);
	const myActiveUsersUsedTraffic = myUsersList.reduce((sum, u) => sum + (Number(u.used_traffic) || 0), 0);

	const panelInfo = maintenanceInfo?.panel;
	const exactVersion =
		panelInfo?.tag ||
		panelInfo?.update?.current ||
		(systemData.channel?.toLowerCase() === "dev" ? "dev" : systemData.version) ||
		"-";

	return (
		<Stack
			spacing={{ base: 4, md: 5 }}
			w="full"
			dir={isRTL ? "rtl" : "ltr"}
			{...props}
		>
			<Flex align="center" justify="space-between" flexWrap="wrap" gap={3} px={1}>
				<Flex
					wrap="wrap"
					gap={{ base: 2.5, md: 1 }}
					sx={{
						flexDirection: "column",
						alignItems: "flex-start",
						"@media screen and (max-width: 767px)": {
							flexDirection: "row",
							alignItems: "center",
						},
						"@media screen and (min-width: 768px) and (max-width: 991px)": {
							"body:has([data-sidebar-collapsed='true']) &": {
								flexDirection: "row",
								alignItems: "center",
							},
							"body:not(:has([data-sidebar-collapsed='true'])) &": {
								flexDirection: "column",
								alignItems: "flex-start",
							},
						},
						"@media screen and (min-width: 992px)": {
							flexDirection: "column",
							alignItems: "flex-start",
						},
					}}
				>
					<Text fontSize={{ base: "18px", md: "20px" }} fontWeight="700" color="panel.text" letterSpacing="-0.02em">
						{t("dashboard.system.overview")}
					</Text>
					<Flex align="center" gap={2} direction="row">
						<Box
							w="6px"
							h="6px"
							borderRadius="full"
							bg={systemData.xray_running ? "#22c55e" : "#ef4444"}
							sx={{
								animation: systemData.xray_running ? "livePulse 2.4s ease-in-out infinite" : "none",
								"@keyframes livePulse": {
									"0%,100%": { opacity: 0.5 },
									"50%": { opacity: 1 },
								},
							}}
						/>
						<Text fontSize="12px" color="panel.textSecondary" fontWeight="600">
							{systemData.xray_running ? t("dashboard.system.statusRunning") : t("dashboard.system.statusStopped")}
						</Text>
						{exactVersion && exactVersion !== "-" && (
							<HStack spacing={1.5} align="center" color="panel.textSecondary" fontSize="12px" fontWeight="600">
								<Text as="span">·</Text>
								<Text as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
									{exactVersion}
								</Text>
							</HStack>
						)}
					</Flex>
				</Flex>
				<DashboardMaintenanceControls channel={systemData.channel} version={systemData.version} />
			</Flex>

			<SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} gap={{ base: 3, md: 4 }}>
				<ResourceCard
					label={t("dashboard.system.cpuUsage")}
					icon={<CpuChipIcon width={16} />}
					value={formatPercent(systemData.cpu_usage, false)}
					percent={systemData.cpu_usage}
					metaValue={formatNumberValue(systemData.cpu_cores)}
					metaUnit={t("dashboard.system.core")}
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

			<SimpleGrid columns={{ base: 1, md: 2 }} gap={{ base: 3, md: 4 }}>
				<SectionCard
					title={
						<HStack spacing={2.5}>
							<Flex w="26px" h="26px" align="center" justify="center" borderRadius="7px" bg="panel.elevated" color="panel.textSecondary">
								<SignalIcon width={14} />
							</Flex>
							<span>{t("dashboard.system.bandwidthSpeed")}</span>
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
							color={colorMode === "light" ? "panel.textSecondary" : "panel.textMuted"}
							fontWeight={colorMode === "light" ? "600" : "500"}
							transition="all 0.2s ease"
							_groupHover={{
								md: {
									bg: "panel.surface",
									color: colorMode === "light" ? "panel.text" : "panel.textSecondary",
								},
							}}
							_hover={{
								md: {
									bg: "panel.border !important",
									color: "panel.text !important",
								},
							}}
							_active={{
								bg: "panel.borderStrong !important",
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
					}
				>
					<Stack spacing={3}>
						<SpeedItem
							icon={<ArrowDownTrayIcon width={13} />}
							label={t("dashboard.system.incomingSpeed")}
							value={`${formatBytes(systemData.incoming_bandwidth_speed)}/s`}
						/>
						<SpeedItem
							icon={<ArrowUpTrayIcon width={13} />}
							label={t("dashboard.system.outgoingSpeed")}
							value={`${formatBytes(systemData.outgoing_bandwidth_speed)}/s`}
						/>
					</Stack>
				</SectionCard>

				<SectionCard
					title={
						<HStack spacing={2.5}>
							<Flex w="26px" h="26px" align="center" justify="center" borderRadius="7px" bg="panel.elevated" color="panel.textSecondary">
								<ClockIcon width={14} />
							</Flex>
							<span>{t("dashboard.system.uptime")}</span>
						</HStack>
					}
				>
					<Stack spacing={3}>
						<Flex align="center" justify="space-between" gap={3}>
							<HStack spacing={2.5} color="panel.textMuted">
								<Flex w="28px" h="28px" align="center" justify="center" borderRadius="8px" bg="panel.elevated" flexShrink={0}>
									<ServerStackIcon width={13} />
								</Flex>
								<Text fontSize="13px" fontWeight="600" color="panel.textSecondary">
									{t("dashboard.system.systemUptime")}
								</Text>
							</HStack>
							{formatLocalizedDuration(systemData.uptime_seconds, t, isRTL)}
						</Flex>
						<Flex align="center" justify="space-between" gap={3}>
							<HStack spacing={2.5} color="panel.textMuted">
								<Flex w="28px" h="28px" align="center" justify="center" borderRadius="8px" bg="panel.elevated" flexShrink={0}>
									<CircleStackIcon width={13} />
								</Flex>
								<Text fontSize="13px" fontWeight="600" color="panel.textSecondary">
									{t("dashboard.system.panelUptime")}
								</Text>
							</HStack>
							{formatLocalizedDuration(systemData.panel_uptime_seconds, t, isRTL)}
						</Flex>
					</Stack>
				</SectionCard>
			</SimpleGrid>

			{(systemData.last_xray_error || systemData.last_telegram_error) && (
				<Stack spacing={3}>
					{systemData.last_xray_error && (
						<Box p={4} borderRadius="14px" bg={redErrorBg} borderWidth="1px" borderColor={redErrorBorder}>
							<HStack spacing={2} mb={2} color={redErrorColor}>
								<ExclamationTriangleIcon width={15} />
								<Text fontSize="12px" fontWeight="700">
									{t("dashboard.system.coreError")}
								</Text>
							</HStack>
							<Text fontSize="12px" fontFamily="mono" color={redErrorColor} wordBreak="break-word" lineHeight="tall" opacity={0.85}>
								{systemData.last_xray_error}
							</Text>
						</Box>
					)}
					{systemData.last_telegram_error && (
						<Box p={4} borderRadius="14px" bg={orangeErrorBg} borderWidth="1px" borderColor={orangeErrorBorder}>
							<Flex align="center" justify="space-between" mb={2} flexWrap="wrap" gap={2}>
								<HStack spacing={2} color={orangeErrorColor}>
									<ExclamationTriangleIcon width={15} />
									<Text fontSize="12px" fontWeight="700">{t("dashboard.system.telegramError")}</Text>
								</HStack>
								<Button
									size="xs"
									colorScheme="orange"
									variant="ghost"
									borderRadius="full"
									fontSize="11px"
									h="22px"
									px={2.5}
									onClick={() => {
										window.location.href = "/settings";
									}}
								>
									{t("dashboard.system.goToTelegramSettings")}
								</Button>
							</Flex>
							<Text fontSize="12px" fontFamily="mono" color={orangeErrorColor} wordBreak="break-word" lineHeight="tall" opacity={0.85}>
								{systemData.last_telegram_error}
							</Text>
						</Box>
					)}
				</Stack>
			)}

			<SectionCard
				noHover
				title={
					<HStack spacing={2.5}>
						<Flex w="26px" h="26px" align="center" justify="center" borderRadius="7px" bg="panel.elevated" color="panel.textSecondary">
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
						color="panel.textMuted"
						fontWeight="500"
						transition="all 0.2s ease"
						_hover={{
							bg: "panel.border !important",
							color: "panel.text !important",
						}}
						_active={{
							bg: "panel.borderStrong !important",
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
						parentNoHover
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
						parentNoHover
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
						<Flex w="26px" h="26px" align="center" justify="center" borderRadius="7px" bg="panel.elevated" color="panel.textSecondary">
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
							borderRadius="8px"
							position="relative"
							transition="all 0.25s ease"
							_groupHover={{
								bg: "panel.surface",
							}}
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
											borderRadius: "6px",
											backgroundColor: "var(--rb-panel-accent)",
											border: "1px solid var(--rb-panel-accent)",
											boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
											zIndex: 1,
										}}
										transition={{
											type: "tween",
											ease: "easeInOut",
											duration: 0.25,
										}}
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
									color={userTab === "all" ? "white" : "panel.text"}
									position="relative"
									zIndex={2}
									transition="all 0.2s ease"
									_hover={{
										md: {
											color: userTab === "all" ? "white" : "panel.text",
										},
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
											borderRadius: "6px",
											backgroundColor: "var(--rb-panel-accent)",
											border: "1px solid var(--rb-panel-accent)",
											boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
											zIndex: 1,
										}}
										transition={{
											type: "tween",
											ease: "easeInOut",
											duration: 0.25,
										}}
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
									color={userTab === "mine" ? "white" : "panel.text"}
									position="relative"
									zIndex={2}
									transition="all 0.2s ease"
									_hover={{
										md: {
											color: userTab === "mine" ? "white" : "panel.text",
										},
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
							<StatRow label={t("dashboard.users.total")} value={systemData.total_user} tagColor="#3b82f6" />
							<StatRow label={t("dashboard.users.active")} value={systemData.users_active} tag={activePercent} tagColor="#22c55e" />
							<StatRow
								label={t("dashboard.users.online")}
								value={systemData.online_users}
								tag={onlinePercent}
								tagColor="#06b6d4"
								helper={
									systemData.online_users_upload_speed || systemData.online_users_download_speed
										? `↑ ${formatBytes(systemData.online_users_upload_speed)}/s · ↓ ${formatBytes(systemData.online_users_download_speed)}/s`
										: undefined
								}
							/>
							<StatRow label={t("dashboard.users.onHold")} value={systemData.users_on_hold} tagColor="#a855f7" />
							<StatRow label={t("dashboard.users.limited")} value={systemData.users_limited} tagColor="#f59e0b" />
							<StatRow label={t("dashboard.users.expired")} value={systemData.users_expired} tagColor="#f97316" />
						</Stack>
					) : (
						<Stack spacing={0}>
							<StatRow label={t("dashboard.users.total")} value={myTotalUsers} tagColor="#3b82f6" />
							<StatRow label={t("dashboard.users.active")} value={myActiveUsers} tag={myActivePercent} tagColor="#22c55e" />
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
							<StatRow label={t("dashboard.users.onHold")} value={myOnHoldUsers} tagColor="#a855f7" />
							<StatRow label={t("dashboard.users.limited")} value={myLimitedUsers} tagColor="#f59e0b" />
							<StatRow label={t("dashboard.users.expired")} value={myExpiredUsers} tagColor="#f97316" />
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
							<Flex w="26px" h="26px" align="center" justify="center" borderRadius="7px" bg="panel.elevated" color="panel.textSecondary">
								<ShieldCheckIcon width={14} />
							</Flex>
							<span>{t("dashboard.admins")}</span>
						</HStack>
					}
				>
					<Stack spacing={0}>
						<StatRow label={t("dashboard.admins.total")} value={systemData.admin_overview.total_admins} tagColor="#3b82f6" />
						<StatRow label={t("dashboard.admins.fullAccess")} value={systemData.admin_overview.full_access_admins} tagColor="#f59e0b" />
						<StatRow label={t("dashboard.admins.sudo")} value={systemData.admin_overview.sudo_admins} tagColor="#a855f7" />
						<StatRow label={t("dashboard.admins.standard")} value={systemData.admin_overview.standard_admins} tagColor="#22c55e" />
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
