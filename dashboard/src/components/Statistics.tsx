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
	SimpleGrid,
	Stack,
	Tag,
	Text,
	useColorMode,
	useColorModeValue,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import type { TFunction } from "i18next";
import { type FC, type ReactNode, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { fetch } from "service/http";
import type { SystemStats } from "types/System";
import { formatBytes, numberWithCommas } from "utils/formatByte";
import { formatDuration } from "utils/formatDuration";
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

const ChartIcon = chakra(ChartBarIcon, iconProps);

const formatNumberValue = (value: number) =>
	numberWithCommas(value) ?? value.toString();
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

const HistoryPreview: FC<{
	label: string;
	value: string;
	history: number[];
	accent?: string;
	onOpen?: () => void;
	actionLabel: string;
}> = ({ label, value, history, accent, onOpen, actionLabel }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const mutedColor = useColorModeValue("gray.500", "gray.400");

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			p={3}
		>
			<Stack spacing={1}>
				<HStack justifyContent="space-between" alignItems="center" gap={3}>
					<Box minW={0}>
						<Text fontSize="xs" fontWeight="semibold" color={mutedColor}>
							{label}
						</Text>
						<Text fontSize="xl" fontWeight="semibold" mt={1}>
							{value}
						</Text>
					</Box>
					{onOpen && (
						<Button size="xs" variant="outline" onClick={onOpen} flexShrink={0}>
							{actionLabel}
						</Button>
					)}
				</HStack>
				<HistorySparkline values={history} accent={accent} />
			</Stack>
		</Box>
	);
};

const MetricBadge: FC<{
	label: string;
	value: ReactNode;
	colorScheme?: string;
	valueClassName?: string;
}> = ({ label, value, colorScheme = "gray", valueClassName }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");
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
	const networkHistoryValues = data.network_history.map(
		(entry) => entry.incoming,
	);
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
					<HistoryPreview
						label={t("cpuUsage")}
						value={`${data.cpu_usage.toFixed(1)}%`}
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
					<HistoryPreview
						label={t("memoryUsage")}
						value={`${data.memory.percent.toFixed(1)}%`}
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
					<HistoryPreview
						label={t("networkHistory")}
						value={`${formatBytes(data.incoming_bandwidth_speed)}/s`}
						history={networkHistoryValues}
						actionLabel={t("viewHistory")}
						onOpen={() =>
							onOpenHistory({
								type: "network",
								title: t("networkHistory"),
								entries: data.network_history,
							})
						}
					/>
				</SimpleGrid>
				<SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
					<MetricBadge
						label={t("incomingSpeed")}
						value={`${formatBytes(data.incoming_bandwidth_speed)}/s`}
						colorScheme="green"
					/>
					<MetricBadge
						label={t("outgoingSpeed")}
						value={`${formatBytes(data.outgoing_bandwidth_speed)}/s`}
						colorScheme="blue"
					/>
				</SimpleGrid>
				<SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
					<MetricBadge
						label={t("memoryUsage")}
						value={`${formatBytes(data.memory.current)} / ${formatBytes(data.memory.total)}`}
						valueClassName="rb-usage-pair"
					/>
					<MetricBadge
						label={t("swapUsage")}
						value={`${formatBytes(data.swap.current)} / ${formatBytes(data.swap.total)}`}
						valueClassName="rb-usage-pair"
					/>
					<MetricBadge
						label={t("diskUsage")}
						value={`${formatBytes(data.disk.current)} / ${formatBytes(data.disk.total)}`}
						valueClassName="rb-usage-pair"
					/>
				</SimpleGrid>
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
					<Tag colorScheme="orange">
						{t("xrayUptime")}: {formatDuration(data.xray_uptime_seconds)}
					</Tag>
				</Stack>
				{data.last_xray_error && !data.xray_running && (
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
					<HistoryPreview
						label={t("cpuUsage")}
						value={`${data.panel_cpu_percent.toFixed(1)}%`}
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
					<HistoryPreview
						label={t("memoryUsage")}
						value={`${data.panel_memory_percent.toFixed(1)}%`}
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

const UsersUsageCard: FC<{ value: number; t: TFunction }> = ({ value, t }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const iconBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const iconColor = useColorModeValue("primary.600", "primary.200");
	const mutedColor = useColorModeValue("gray.500", "gray.400");
	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			p={4}
		>
			<HStack justifyContent="space-between" alignItems="center">
				<HStack alignItems="center" spacing={3}>
					<Box p={2} borderRadius="md" bg={iconBg}>
						<ChartIcon color={iconColor} />
					</Box>
					<Text fontSize="xs" fontWeight="semibold" color={mutedColor}>
						{t("dashboard.systemUsage", "System usage")}
					</Text>
				</HStack>
				<Text fontSize="2xl" fontWeight="semibold">
					{formatBytes(value)}
				</Text>
			</HStack>
		</Box>
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
			<UsersUsageCard value={data.panel_total_bandwidth} t={t} />
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
						label={t("consumedData")}
						value={formatBytes(data.consumed_bytes)}
						colorScheme="green"
					/>
					<MetricBadge
						label={t("builtData")}
						value={formatBytes(data.built_bytes)}
						colorScheme="purple"
					/>
					<MetricBadge
						label={t("resetData")}
						value={formatBytes(data.reset_bytes)}
						colorScheme="orange"
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
		queryKey: "statistics-query-key",
		queryFn: () => fetch("/system"),
		refetchInterval: 3_000,
		onSuccess: ({ version: currentVersion }) => {
			if (version !== currentVersion)
				useDashboard.setState({ version: currentVersion });
		},
	});
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
