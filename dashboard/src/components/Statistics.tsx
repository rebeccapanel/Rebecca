import {
	Badge,
	Box,
	type BoxProps,
	Button,
	chakra,
	Flex,
	HStack,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Progress,
	SimpleGrid,
	Stack,
	Tag,
	Text,
	useColorMode,
	useColorModeValue,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import type { TFunction } from "i18next";
import { type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "react-query";
import { fetch } from "service/http";
import type { SystemStats } from "types/System";
import { formatBytes, numberWithCommas } from "utils/formatByte";
import { formatDuration } from "utils/formatDuration";
import { getAPIWebSocketURL } from "utils/websocket";
import { ChartBox } from "./common/ChartBox";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export const StatisticsQueryKey = "statistics-query-key";

import { AdminRole } from "types/Admin";

const iconProps = {
	baseStyle: {
		w: 5,
		h: 5,
		position: "relative",
		zIndex: "2",
	},
};

const DownloadIcon = chakra(ArrowDownTrayIcon, iconProps);
const UploadIcon = chakra(ArrowUpTrayIcon, iconProps);

const useSystemMetricsStream = (enabled = true) => {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}
		const url = getAPIWebSocketURL("/system/metrics", { interval: 3 });
		if (!url) {
			return;
		}
		let closed = false;
		let ws: WebSocket | null = null;
		let reconnectTimer: number | undefined;

		const connect = () => {
			ws = new WebSocket(url);
			ws.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data);
					const stats = payload?.stats ?? payload;
					if (!stats || typeof stats !== "object" || !("version" in stats)) {
						return;
					}
					queryClient.setQueryData<SystemStats>(StatisticsQueryKey, stats);
				} catch (error) {
					console.error("Unable to parse system metrics stream payload", error);
				}
			};
			ws.onerror = () => {
				ws?.close();
			};
			ws.onclose = () => {
				if (!closed) {
					reconnectTimer = window.setTimeout(connect, 3000);
				}
			};
		};

		connect();
		return () => {
			closed = true;
			if (reconnectTimer) {
				window.clearTimeout(reconnectTimer);
			}
			ws?.close();
		};
	}, [enabled, queryClient]);
};

const formatNumberValue = (value: number) =>
	numberWithCommas(value) ?? value.toString();
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const getUsageColorScheme = (percent: number) => {
	if (percent >= 80) return "red";
	if (percent >= 60) return "yellow";
	return "green";
};
const normalizeVersion = (value?: string | null) => {
	if (!value) return "";
	const trimmed = value.trim();
	if (trimmed.toLowerCase().startsWith("dev-")) {
		return trimmed.toLowerCase();
	}
	return trimmed.replace(/^v+/i, "").split(/[-_]/)[0].trim();
};

const HISTORY_INTERVALS = [
	{ labelKey: "historyInterval.2m", seconds: 120 },
	{ labelKey: "historyInterval.10m", seconds: 600 },
	{ labelKey: "historyInterval.30m", seconds: 1800 },
	{ labelKey: "historyInterval.1h", seconds: 3600 },
	{ labelKey: "historyInterval.3h", seconds: 10800 },
	{ labelKey: "historyInterval.5h", seconds: 18000 },
];

type CpuMemoryHistoryPayload = {
	type: "cpu" | "memory";
	title: string;
	metricLabel: string;
	entries: SystemStats["cpu_history"];
};

type NetworkHistoryPayload = {
	type: "network";
	title: string;
	entries: SystemStats["network_history"];
};

type PanelHistoryPayload = {
	type: "panel";
	title: string;
	cpuEntries: SystemStats["panel_cpu_history"];
	memoryEntries: SystemStats["panel_memory_history"];
};

type HistoryModalPayload =
	| CpuMemoryHistoryPayload
	| NetworkHistoryPayload
	| PanelHistoryPayload;

const HistoryModal: FC<{
	isOpen: boolean;
	onClose: () => void;
	payload: HistoryModalPayload | null;
	intervalSeconds: number;
	onIntervalChange: (value: number) => void;
	t: TFunction;
}> = ({ isOpen, onClose, payload, intervalSeconds, onIntervalChange, t }) => {
	const { colorMode } = useColorMode();
	const latestTimestamp = useMemo(() => {
		if (!payload) return Math.floor(Date.now() / 1000);
		const extractLatest = (entries: Array<{ timestamp: number }>) =>
			entries.length ? entries[entries.length - 1].timestamp : null;
		if (payload.type === "network") {
			return extractLatest(payload.entries) ?? Math.floor(Date.now() / 1000);
		}
		if (payload.type === "panel") {
			return (
				extractLatest(payload.cpuEntries) ??
				extractLatest(payload.memoryEntries) ??
				Math.floor(Date.now() / 1000)
			);
		}
		return extractLatest(payload.entries) ?? Math.floor(Date.now() / 1000);
	}, [payload]);
	const cutoff = latestTimestamp - intervalSeconds;
	const filteredStandardEntries = useMemo(() => {
		if (!payload || payload.type === "network" || payload.type === "panel") {
			return [];
		}
		const entries = payload.entries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredNetworkEntries = useMemo(() => {
		if (!payload || payload.type !== "network") {
			return [];
		}
		const entries = payload.entries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredPanelCpu = useMemo(() => {
		if (!payload || payload.type !== "panel") return [];
		const entries = payload.cpuEntries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredPanelMemory = useMemo(() => {
		if (!payload || payload.type !== "panel") return [];
		const entries = payload.memoryEntries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const chartSeries = useMemo(() => {
		if (!payload) {
			return [];
		}
		if (payload.type === "network") {
			return [
				{
					name: t("networkIncoming"),
					data: filteredNetworkEntries.map((entry) => [
						entry.timestamp * 1000,
						entry.incoming,
					]),
				},
				{
					name: t("networkOutgoing"),
					data: filteredNetworkEntries.map((entry) => [
						entry.timestamp * 1000,
						entry.outgoing,
					]),
				},
			];
		}
		if (payload.type === "panel") {
			return [
				{
					name: t("cpuUsage"),
					data: filteredPanelCpu.map((entry) => [
						entry.timestamp * 1000,
						entry.value,
					]),
				},
				{
					name: t("memoryUsage"),
					data: filteredPanelMemory.map((entry) => [
						entry.timestamp * 1000,
						entry.value,
					]),
				},
			];
		}
		return [
			{
				name: payload.metricLabel,
				data: filteredStandardEntries.map((entry) => [
					entry.timestamp * 1000,
					entry.value,
				]),
			},
		];
	}, [
		filteredStandardEntries,
		filteredNetworkEntries,
		filteredPanelCpu,
		filteredPanelMemory,
		payload,
		t,
	]);

	const options = useMemo(
		() => ({
			chart: {
				type: "line" as const,
				animations: { enabled: false },
				toolbar: { show: false },
				zoom: { enabled: false },
				background: "transparent",
			},
			theme: { mode: colorMode },
			stroke: { curve: "smooth" as const },
			xaxis: {
				type: "datetime" as const,
				labels: {
					datetimeFormatter: { hour: "HH:mm" },
				},
			},
			yaxis: {
				decimalsInFloat: 0,
			},
			tooltip: {
				x: { format: "HH:mm:ss" },
			},
		}),
		[colorMode],
	);

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
			<ModalOverlay />
			<XrayModalContent>
				<XrayModalHeader>
					{t("historyModalTitle", { metric: payload?.title ?? "" })}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<Stack spacing={3}>
						<Flex wrap="wrap" gap={2}>
							{HISTORY_INTERVALS.map((interval) => (
								<Button
									key={interval.seconds}
									size="sm"
									variant={
										intervalSeconds === interval.seconds ? "solid" : "outline"
									}
									onClick={() => onIntervalChange(interval.seconds)}
								>
									{t(interval.labelKey)}
								</Button>
							))}
						</Flex>
						<Chart
							options={options}
							series={chartSeries}
							type="line"
							height={300}
						/>
					</Stack>
				</XrayModalBody>
				<XrayModalFooter>
					<Button onClick={onClose}>{t("close")}</Button>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};

const HistorySparkline: FC<{ values: number[]; accent?: string }> = ({
	values,
	accent,
}) => {
	const defaultColor = useColorModeValue("gray.600", "gray.300");
	const normalized = values.length ? values : [0];
	const maxValue = Math.max(...normalized, 1);
	const normalizedBars = normalized.map((value, idx) => ({
		value,
		id: `${idx}-${value}`,
	}));

	return (
		<HStack
			alignItems="flex-end"
			spacing="2px"
			mt={2}
			minH="42px"
			w="full"
			overflow="hidden"
		>
			{normalizedBars.map(({ value, id }) => {
				const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
				const height = Math.max(4, Math.round((heightPct / 100) * 40));
				return (
					<Box
						key={id}
						flex="0 1 4px"
						minW="2px"
						maxW="4px"
						h={`${height}px`}
						bg={accent ?? defaultColor}
						borderRadius="1px"
						transition="all 0.2s"
					/>
				);
			})}
		</HStack>
	);
};

const UsageMetricCard: FC<{
	label: string;
	percent: number;
	detail?: string;
	history?: number[];
	onOpen?: () => void;
	actionLabel?: string;
}> = ({ label, percent, detail, history, onOpen, actionLabel }) => {
	const colorScheme = getUsageColorScheme(percent);
	const safePercent = clampPercent(percent);
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const mutedColor = useColorModeValue("gray.600", "gray.400");
	const valueColor = useColorModeValue(
		`${colorScheme}.600`,
		`${colorScheme}.300`,
	);
	const accentBg = useColorModeValue(
		`${colorScheme}.50`,
		"rgba(255, 255, 255, 0.04)",
	);
	const accent = useColorModeValue(
		`${colorScheme}.400`,
		`${colorScheme}.300`,
	);

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			overflow="hidden"
			p={3}
			minH={history ? "126px" : "96px"}
		>
			<Stack spacing={2}>
				<HStack justifyContent="space-between" alignItems="center" gap={3}>
					<Text fontSize="xs" fontWeight="semibold" color={labelColor}>
						{label}
					</Text>
					{onOpen && actionLabel && (
						<Button size="xs" variant="outline" onClick={onOpen} flexShrink={0}>
							{actionLabel}
						</Button>
					)}
				</HStack>
				<HStack justifyContent="space-between" alignItems="baseline" gap={3}>
					<Text fontSize="2xl" lineHeight="1" fontWeight="800" color={valueColor}>
						{Math.max(0, percent).toFixed(1)}%
					</Text>
					{detail && (
						<Text
							fontSize="xs"
							color={mutedColor}
							className="rb-usage-pair"
							textAlign="end"
						>
							{detail}
						</Text>
					)}
				</HStack>
				<Progress
					value={safePercent}
					colorScheme={colorScheme}
					bg={accentBg}
					borderRadius="full"
					h="7px"
				/>
				{history && <HistorySparkline values={history} accent={accent} />}
			</Stack>
		</Box>
	);
};

const SpeedItem: FC<{
	icon: ReactNode;
	label: string;
	value: string;
	colorScheme: "blue" | "green";
}> = ({ icon, label, value, colorScheme }) => {
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const iconBg = useColorModeValue(`${colorScheme}.50`, "whiteAlpha.100");
	const iconColor = useColorModeValue(
		`${colorScheme}.600`,
		`${colorScheme}.300`,
	);

	return (
		<HStack
			alignItems="center"
			spacing={3}
			borderRadius="md"
			bg={iconBg}
			px={3}
			py={2.5}
			minH="76px"
		>
			<Box color={iconColor} flexShrink={0}>
				{icon}
			</Box>
			<Box minW={0}>
				<Text fontSize="xs" fontWeight="semibold" color={labelColor}>
					{label}
				</Text>
				<Text fontSize={{ base: "lg", md: "xl" }} fontWeight="800" mt={1}>
					{value}
				</Text>
			</Box>
		</HStack>
	);
};

const NetworkSpeedCard: FC<{
	incoming: number;
	outgoing: number;
	t: TFunction;
	onOpen: () => void;
}> = ({ incoming, outgoing, t, onOpen }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.600", "gray.400");

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			p={3}
		>
			<Stack spacing={3}>
				<HStack justifyContent="space-between" alignItems="center" gap={3}>
					<Text fontSize="xs" fontWeight="semibold" color={labelColor}>
						{t("networkHistory")}
					</Text>
					<Button size="xs" variant="outline" onClick={onOpen} flexShrink={0}>
						{t("viewHistory")}
					</Button>
				</HStack>
				<SimpleGrid columns={{ base: 1, sm: 2 }} gap={3}>
					<SpeedItem
						icon={<DownloadIcon />}
						label={t("incomingSpeed")}
						value={`${formatBytes(incoming)}/s`}
						colorScheme="green"
					/>
					<SpeedItem
						icon={<UploadIcon />}
						label={t("outgoingSpeed")}
						value={`${formatBytes(outgoing)}/s`}
						colorScheme="blue"
					/>
				</SimpleGrid>
			</Stack>
		</Box>
	);
};

const MetricBadge: FC<{
	label: string;
	value: ReactNode;
	colorScheme?: string;
	valueClassName?: string;
	helper?: string;
}> = ({ label, value, colorScheme = "gray", valueClassName, helper }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const helperColor = useColorModeValue("gray.500", "gray.400");
	const valueColor = useColorModeValue(
		colorScheme === "gray" ? "gray.800" : `${colorScheme}.600`,
		colorScheme === "gray" ? "gray.100" : `${colorScheme}.300`,
	);
	const accent = useColorModeValue(
		colorScheme === "gray" ? "gray.300" : `${colorScheme}.400`,
		colorScheme === "gray" ? "whiteAlpha.400" : `${colorScheme}.300`,
	);

	return (
		<Box
			px={3}
			py={2}
			borderRadius="md"
			borderWidth="1px"
			borderColor={borderColor}
			bg={bg}
			position="relative"
			overflow="hidden"
			minH="76px"
			_before={{
				content: '""',
				position: "absolute",
				insetInlineStart: 0,
				insetBlockStart: 0,
				w: "3px",
				h: "full",
				bg: accent,
			}}
		>
			<Text fontSize="xs" fontWeight="semibold" color={labelColor}>
				{label}
			</Text>
			<Text mt={1} fontWeight="semibold" color={valueColor}>
				{valueClassName ? (
					<chakra.span className={valueClassName}>{value}</chakra.span>
				) : (
					value
				)}
			</Text>
			{helper ? (
				<Text mt={1} fontSize="xs" color={helperColor}>
					{helper}
				</Text>
			) : null}
		</Box>
	);
};

const SystemOverviewCard: FC<{
	data: SystemStats;
	t: TFunction;
	onOpenHistory: (payload: HistoryModalPayload) => void;
}> = ({ data, t, onOpenHistory }) => {
	const cpuHistoryValues = data.cpu_history.map((entry) => entry.value);
	const memoryHistoryValues = data.memory_history.map((entry) => entry.value);
	const hasSwap = data.swap.current > 0 || data.swap.total > 0;
	const latestPanelRelease = useQuery({
		queryKey: ["panel-latest-release"],
		queryFn: async () => {
			const response = await window.fetch(
				"https://api.github.com/repos/rebeccapanel/Rebecca/releases/latest",
				{ headers: { Accept: "application/vnd.github+json" } },
			);
			if (!response.ok) throw new Error("Failed to load latest panel release");
			return response.json();
		},
		refetchOnWindowFocus: false,
		staleTime: 5 * 60 * 1000,
		retry: 1,
	});
	const latestPanelVersion =
		latestPanelRelease.data?.tag_name || latestPanelRelease.data?.name || "";
	const isPanelUpdateAvailable =
		normalizeVersion(latestPanelVersion) &&
		normalizeVersion(data.version) &&
		normalizeVersion(latestPanelVersion) !== normalizeVersion(data.version);
	return (
		<ChartBox
			title={t("systemOverview")}
			headerActions={
				<Wrap spacing={2} justify={{ base: "flex-start", md: "flex-end" }}>
					<WrapItem>
						<Tag colorScheme="gray">v{data.version}</Tag>
					</WrapItem>
					{latestPanelVersion && (
						<WrapItem>
							<Tag colorScheme={isPanelUpdateAvailable ? "green" : "blue"}>
								{isPanelUpdateAvailable
									? t("system.updateAvailable", {
											version: latestPanelVersion,
										})
									: t("system.latestRelease", {
											version: latestPanelVersion,
										})}
							</Tag>
						</WrapItem>
					)}
					<WrapItem>
						<Tag colorScheme="gray">
							{t("loadAverage")}:{" "}
							{data.load_avg.length
								? data.load_avg.map((value) => value.toFixed(2)).join(" | ")
								: "-"}
						</Tag>
					</WrapItem>
				</Wrap>
			}
		>
			<Stack spacing={4}>
				<SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
					<UsageMetricCard
						label={t("cpuUsage")}
						percent={data.cpu_usage}
						history={cpuHistoryValues}
						actionLabel={t("viewHistory")}
						onOpen={() =>
							onOpenHistory({
								type: "cpu",
								title: t("cpuUsage"),
								metricLabel: t("cpuUsage"),
								entries: data.cpu_history,
							})
						}
					/>
					<UsageMetricCard
						label={t("memoryUsage")}
						percent={data.memory.percent}
						detail={`${formatBytes(data.memory.current)} / ${formatBytes(data.memory.total)}`}
						history={memoryHistoryValues}
						actionLabel={t("viewHistory")}
						onOpen={() =>
							onOpenHistory({
								type: "memory",
								title: t("memoryUsage"),
								metricLabel: t("memoryUsage"),
								entries: data.memory_history,
							})
						}
					/>
					<UsageMetricCard
						label={t("diskUsage")}
						percent={data.disk.percent}
						detail={`${formatBytes(data.disk.current)} / ${formatBytes(data.disk.total)}`}
					/>
				</SimpleGrid>
				<NetworkSpeedCard
					incoming={data.incoming_bandwidth_speed}
					outgoing={data.outgoing_bandwidth_speed}
					t={t}
					onOpen={() =>
						onOpenHistory({
							type: "network",
							title: t("networkHistory"),
							entries: data.network_history,
						})
					}
				/>
				{hasSwap && (
					<UsageMetricCard
						label={t("swapUsage")}
						percent={data.swap.percent}
						detail={`${formatBytes(data.swap.current)} / ${formatBytes(data.swap.total)}`}
					/>
				)}
				<Stack
					direction={{ base: "column", md: "row" }}
					spacing={2}
					flexWrap="wrap"
					alignItems="flex-start"
				>
					<Tag colorScheme="green">
						{t("systemUptime")}: {formatDuration(data.uptime_seconds)}
					</Tag>
					<Tag colorScheme="blue">
						{t("panelUptime")}: {formatDuration(data.panel_uptime_seconds)}
					</Tag>
				</Stack>
				{data.last_xray_error && (
					<Box
						mt={4}
						p={4}
						borderRadius="md"
						bg="red.50"
						borderWidth="1px"
						borderColor="red.200"
						_dark={{
							bg: "rgba(239, 68, 68, 0.1)",
							borderColor: "red.800",
						}}
					>
						<HStack spacing={2} mb={2} alignItems="center">
							<Text
								fontSize="sm"
								fontWeight="semibold"
								color="red.600"
								_dark={{ color: "red.400" }}
							>
								{t("coreError", "Core Error")}:
							</Text>
						</HStack>
						<Text
							fontSize="sm"
							color="red.700"
							fontFamily="mono"
							whiteSpace="pre-wrap"
							wordBreak="break-word"
							_dark={{ color: "red.300" }}
						>
							{data.last_xray_error}
						</Text>
					</Box>
				)}
				{data.last_telegram_error && (
					<Box
						mt={4}
						p={4}
						borderRadius="md"
						bg="orange.50"
						borderWidth="1px"
						borderColor="orange.200"
						_dark={{
							bg: "rgba(237, 137, 54, 0.1)",
							borderColor: "orange.800",
						}}
					>
						<HStack
							spacing={2}
							mb={2}
							alignItems="center"
							justifyContent="space-between"
						>
							<Text
								fontSize="sm"
								fontWeight="semibold"
								color="orange.600"
								_dark={{ color: "orange.400" }}
							>
								{t("telegramError", "Telegram Error")}:
							</Text>
							<Button
								size="xs"
								colorScheme="orange"
								variant="outline"
								onClick={() => {
									window.location.href = "/integrations";
								}}
							>
								{t("goToTelegramSettings", "Go to Telegram Settings")}
							</Button>
						</HStack>
						<Text
							fontSize="sm"
							color="orange.700"
							fontFamily="mono"
							whiteSpace="pre-wrap"
							wordBreak="break-word"
							_dark={{ color: "orange.300" }}
						>
							{data.last_telegram_error}
						</Text>
					</Box>
				)}
			</Stack>
		</ChartBox>
	);
};

const PanelOverviewCard: FC<{
	data: SystemStats;
	t: TFunction;
	onOpenHistory: (payload: HistoryModalPayload) => void;
}> = ({ data, t, onOpenHistory }) => {
	const panelCpuHistory = data.panel_cpu_history.map((entry) => entry.value);
	const panelMemoryHistory = data.panel_memory_history.map(
		(entry) => entry.value,
	);
	return (
		<ChartBox
			title={t("panelUsage")}
			headerActions={
				<Badge colorScheme={data.xray_running ? "green" : "red"}>
					{data.xray_running ? t("status.running") : t("status.stopped")}
				</Badge>
			}
		>
			<Stack spacing={4}>
				<SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
					<UsageMetricCard
						label={t("cpuUsage")}
						percent={data.panel_cpu_percent}
						history={panelCpuHistory}
						actionLabel={t("viewHistory")}
						onOpen={() =>
							onOpenHistory({
								type: "panel",
								title: t("panelUsage"),
								cpuEntries: data.panel_cpu_history,
								memoryEntries: data.panel_memory_history,
							})
						}
					/>
					<UsageMetricCard
						label={t("memoryUsage")}
						percent={data.panel_memory_percent}
						history={panelMemoryHistory}
						actionLabel={t("viewHistory")}
						onOpen={() =>
							onOpenHistory({
								type: "panel",
								title: t("panelUsage"),
								cpuEntries: data.panel_cpu_history,
								memoryEntries: data.panel_memory_history,
							})
						}
					/>
				</SimpleGrid>
				<SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
					<MetricBadge
						label={t("threads")}
						value={formatNumberValue(data.app_threads)}
						colorScheme="purple"
					/>
					<MetricBadge
						label={t("appMemory")}
						value={formatBytes(data.app_memory)}
						colorScheme="blue"
					/>
				</SimpleGrid>
			</Stack>
		</ChartBox>
	);
};

const UsersOverviewCard: FC<{
	data: SystemStats;
	t: TFunction;
}> = ({ data, t }) => (
	<ChartBox title={t("usersOverview")}>
		<Stack spacing={4}>
			<MetricBadge
				label={t("totalUsersLabel")}
				value={formatNumberValue(data.total_user)}
				colorScheme="blue"
			/>
			<SimpleGrid columns={{ base: 1, sm: 2 }} gap={3}>
				<MetricBadge
					label={t("status.active")}
					value={formatNumberValue(data.users_active)}
					colorScheme="green"
				/>
				<MetricBadge
					label={t("status.disabled")}
					value={formatNumberValue(data.users_disabled)}
					colorScheme="red"
				/>
				<MetricBadge
					label={t("status.expired")}
					value={formatNumberValue(data.users_expired)}
					colorScheme="orange"
				/>
				<MetricBadge
					label={t("status.limited")}
					value={formatNumberValue(data.users_limited)}
					colorScheme="yellow"
				/>
				<MetricBadge
					label={t("status.on_hold")}
					value={formatNumberValue(data.users_on_hold)}
					colorScheme="purple"
				/>
			</SimpleGrid>
		</Stack>
	</ChartBox>
);

const YourUsageCard: FC<{
	data?: SystemStats["personal_usage"];
	t: TFunction;
}> = ({ data, t }) => {
	if (!data) return null;
	const usageLabel =
		data.traffic_basis === "created_traffic"
			? t("dashboard.currentCreatedTraffic", "Current created traffic")
			: t("dashboard.currentUserUsage", "Current user usage");
	const usageHelper =
		data.traffic_basis === "created_traffic"
			? t(
					"dashboard.currentCreatedTrafficHint",
					"Traffic counted against your created-traffic limit.",
				)
			: t(
					"dashboard.currentUserUsageHint",
					"Traffic currently counted against your user data limit.",
				);
	return (
		<ChartBox title={t("yourUsage")}>
			<Stack spacing={4}>
				<SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
					<MetricBadge
						label={t("totalUsersLabel")}
						value={formatNumberValue(data.total_users)}
						colorScheme="blue"
					/>
					<MetricBadge
						label={usageLabel}
						value={formatBytes(data.consumed_bytes)}
						colorScheme="green"
						helper={usageHelper}
					/>
				</SimpleGrid>
			</Stack>
		</ChartBox>
	);
};

const AdminOverviewCard: FC<{
	data?: SystemStats["admin_overview"];
	t: TFunction;
}> = ({ data, t }) => {
	if (!data) return null;
	return (
		<ChartBox title={t("adminOverview")}>
			<Stack spacing={4}>
				<SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
					<MetricBadge
						label={t("totalAdmins")}
						value={formatNumberValue(data.total_admins)}
						colorScheme="blue"
					/>
					<MetricBadge
						label={t("sudoAdmins")}
						value={formatNumberValue(data.sudo_admins)}
						colorScheme="purple"
					/>
					<MetricBadge
						label={t("fullAccessAdmins")}
						value={formatNumberValue(data.full_access_admins)}
						colorScheme="green"
					/>
					<MetricBadge
						label={t("standardAdmins")}
						value={formatNumberValue(data.standard_admins)}
						colorScheme="orange"
					/>
				</SimpleGrid>
				{data.top_admin_username && (
					<Box>
						<Text fontSize="sm" color="gray.500">
							{t("topAdmin")}:{" "}
							<Text as="span" fontWeight="semibold">
								{data.top_admin_username}
							</Text>
						</Text>
						<Text fontSize="sm" color="gray.500">
							{t("topAdminUsage")}: {formatBytes(data.top_admin_usage)}
						</Text>
					</Box>
				)}
			</Stack>
		</ChartBox>
	);
};

export const Statistics: FC<BoxProps> = (props) => {
	const { version } = useDashboard();
	const { userData } = useGetUser();
	const { t } = useTranslation();
	const { data: systemData } = useQuery<SystemStats>({
		queryKey: StatisticsQueryKey,
		queryFn: () => fetch("/system"),
		onSuccess: ({ version: currentVersion }) => {
			if (version !== currentVersion)
				useDashboard.setState({ version: currentVersion });
		},
	});
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

	const canSeeGlobal =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;

	const openHistory = (payload: HistoryModalPayload) => {
		setHistoryPayload(payload);
	};

	const userCards: ReactNode[] = [];
	if (systemData) {
		userCards.push(
			<UsersOverviewCard key="users-overview" data={systemData} t={t} />,
		);
	}
	const personalUsageCard = systemData?.personal_usage && (
		<YourUsageCard key="your-usage" data={systemData.personal_usage} t={t} />
	);
	if (personalUsageCard) {
		userCards.push(personalUsageCard);
	}
	const userGridColumns = userCards.length > 1 ? 2 : 1;

	return (
		<Stack spacing={4} width="full" {...props}>
			{systemData && (
				<>
					<SystemOverviewCard
						data={systemData}
						t={t}
						onOpenHistory={openHistory}
					/>
					<PanelOverviewCard
						data={systemData}
						t={t}
						onOpenHistory={openHistory}
					/>
				</>
			)}
			{userCards.length > 0 && (
				<SimpleGrid columns={{ base: 1, md: userGridColumns }} gap={4}>
					{userCards}
				</SimpleGrid>
			)}
			{canSeeGlobal && systemData && (
				<AdminOverviewCard data={systemData.admin_overview} t={t} />
			)}
			<HistoryModal
				isOpen={Boolean(historyPayload)}
				onClose={() => setHistoryPayload(null)}
				payload={historyPayload}
				intervalSeconds={historyInterval}
				onIntervalChange={setHistoryInterval}
				t={t}
			/>
		</Stack>
	);
};
