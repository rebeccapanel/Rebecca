import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	SimpleGrid,
	Spinner,
	Stack,
	Stat,
	StatLabel,
	StatNumber,
	Switch,
	Table,
	TableContainer,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type {
	AccessInsightClient,
	AccessInsightsResponse,
} from "types/AccessInsights";
import IrancellSvg from "../assets/operators/irancell-svgrepo-com.svg";
import MciSvg from "../assets/operators/mci-svgrepo-com.svg";
import RightelSvg from "../assets/operators/rightel-svgrepo-com.svg";
import TciSvg from "../assets/operators/tci-svgrepo-com.svg";

const PAGE_SIZE = 30;
const REFRESH_INTERVAL = 15_000;

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

const operatorIcon = (name: string) => {
	const value = name.toLowerCase();
	const source = value.includes("irancell")
		? IrancellSvg
		: value.includes("hamrah") || value.includes("mci")
			? MciSvg
			: value.includes("rightel")
				? RightelSvg
				: value.includes("mokhaberat") || value.includes("tci")
					? TciSvg
					: null;
	return source ? <Box as="img" src={source} alt="" boxSize="18px" /> : null;
};

const AccessInsightsPage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canView =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const [data, setData] = useState<AccessInsightsResponse | null>(null);
	const [search, setSearch] = useState("");
	const [appliedSearch, setAppliedSearch] = useState("");
	const [page, setPage] = useState(0);
	const [loading, setLoading] = useState(false);
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		if (!canView) return;
		setLoading(true);
		setError("");
		try {
			const query = new URLSearchParams({
				limit: "500",
				window_seconds: "300",
			});
			if (appliedSearch.trim()) query.set("search", appliedSearch.trim());
			setData(
				await fetch<AccessInsightsResponse>(
					`/core/access/insights/multi-node?${query.toString()}`,
				),
			);
		} catch (requestError: any) {
			setError(
				requestError?.data?.detail ||
					requestError?.message ||
					t("pages.accessInsights.errors.loadFailed", "Failed to load access insights"),
			);
		} finally {
			setLoading(false);
		}
	}, [appliedSearch, canView, t]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (!autoRefresh || !canView) return;
		const timer = window.setInterval(load, REFRESH_INTERVAL);
		return () => window.clearInterval(timer);
	}, [autoRefresh, canView, load]);

	const items = data?.items || [];
	const totalIPs = useMemo(
		() => new Set(items.flatMap((item) => item.sources || [])).size,
		[items],
	);
	const totalNodes = useMemo(
		() => new Set(items.flatMap((item) => item.nodes || [])).size,
		[items],
	);
	const protocolTotals = useMemo(
		() =>
			Object.entries(data?.platform_counts || {}).sort(
				(left, right) => right[1] - left[1],
			),
		[data?.platform_counts],
	);
	const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
	const visibleItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	useEffect(() => {
		setPage((current) => Math.min(current, totalPages - 1));
	}, [totalPages]);

	if (!canView) {
		return (
			<Box p={6}>
				<Alert status="warning" borderRadius="md">
					<AlertIcon />
					{t(
						"pages.accessInsights.noPermission",
						"You do not have access to Xray insights.",
					)}
				</Alert>
			</Box>
		);
	}

	const applySearch = () => {
		setPage(0);
		setAppliedSearch(search);
	};

	return (
		<Box p={{ base: 4, md: 6 }}>
			<Stack spacing={5}>
				<HStack
					align={{ base: "flex-start", md: "center" }}
					justify="space-between"
					flexWrap="wrap"
					gap={3}
				>
					<Box>
						<Text fontSize="2xl" fontWeight="700">
							{t("pages.accessInsights.title", "Live Access Insights")}
						</Text>
						<Text mt={1} color="panel.textMuted" fontSize="sm">
							{t(
								"pages.accessInsights.liveSubtitle",
								"Active users across Xray, OpenVPN, WireGuard, L2TP, IKEv2, and Cisco AnyConnect.",
							)}
						</Text>
					</Box>
					<HStack spacing={3}>
						<HStack spacing={2}>
							<Switch
								isChecked={autoRefresh}
								onChange={(event) => setAutoRefresh(event.target.checked)}
								aria-label={t("pages.accessInsights.autoRefresh", "Auto refresh")}
							/>
							<Text fontSize="sm">
								{t("pages.accessInsights.autoRefresh", "Auto refresh")}
							</Text>
						</HStack>
						<Tooltip label={t("refresh", "Refresh")}>
							<IconButton
								aria-label={t("refresh", "Refresh")}
								icon={<ArrowPathIcon width={18} />}
								onClick={load}
								isLoading={loading}
								size="sm"
							/>
						</Tooltip>
					</HStack>
				</HStack>

				<HStack as="form" onSubmit={(event) => { event.preventDefault(); applySearch(); }} spacing={2} maxW="520px">
					<InputGroup>
						<InputLeftElement pointerEvents="none">
							<MagnifyingGlassIcon width={18} />
						</InputLeftElement>
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t(
								"pages.accessInsights.liveSearch",
								"Search user, IP, node, or protocol",
							)}
						/>
					</InputGroup>
					<Button type="submit" flexShrink={0}>
						{t("search", "Search")}
					</Button>
				</HStack>

				{error ? (
					<Alert status="error" borderRadius="md">
						<AlertIcon />
						{error}
					</Alert>
				) : null}

				<SimpleGrid columns={{ base: 1, sm: 3 }} spacing={3}>
					<Stat borderWidth="1px" borderColor="panel.border" borderRadius="md" p={4}>
						<StatLabel>{t("pages.accessInsights.onlineUsers", "Online users")}</StatLabel>
						<StatNumber>{items.length}</StatNumber>
					</Stat>
					<Stat borderWidth="1px" borderColor="panel.border" borderRadius="md" p={4}>
						<StatLabel>{t("pages.accessInsights.uniqueIps", "Unique IPs")}</StatLabel>
						<StatNumber>{totalIPs}</StatNumber>
					</Stat>
					<Stat borderWidth="1px" borderColor="panel.border" borderRadius="md" p={4}>
						<StatLabel>{t("pages.accessInsights.activeNodes", "Active nodes")}</StatLabel>
						<StatNumber>{totalNodes}</StatNumber>
					</Stat>
				</SimpleGrid>

				{protocolTotals.length ? (
					<HStack spacing={2} flexWrap="wrap">
						{protocolTotals.map(([protocol, count]) => (
							<Badge key={protocol} colorScheme={protocolColor(protocol)} px={2.5} py={1} borderRadius="md">
								{protocol} · {count}
							</Badge>
						))}
					</HStack>
				) : null}

				<TableContainer borderWidth="1px" borderColor="panel.border" borderRadius="md">
					<Table size="sm">
						<Thead>
							<Tr>
								<Th>{t("user", "User")}</Th>
								<Th>{t("pages.accessInsights.ips", "IPs")}</Th>
								<Th>{t("pages.accessInsights.protocols", "Protocols")}</Th>
								<Th>{t("pages.accessInsights.nodes", "Nodes")}</Th>
								<Th>{t("pages.accessInsights.lastSeen", "Last seen")}</Th>
							</Tr>
						</Thead>
						<Tbody>
							{visibleItems.map((client) => (
								<AccessInsightRow key={client.user_key} client={client} />
							))}
						</Tbody>
					</Table>
					{loading && !data ? (
						<HStack justify="center" py={10}>
							<Spinner size="sm" />
							<Text color="panel.textMuted">{t("loading", "Loading...")}</Text>
						</HStack>
					) : !loading && !items.length ? (
						<Text py={10} textAlign="center" color="panel.textMuted">
							{t("pages.accessInsights.noData", "No recent connections found.")}
						</Text>
					) : null}
				</TableContainer>

				{totalPages > 1 ? (
					<HStack justify="space-between">
						<Text fontSize="sm" color="panel.textMuted">
							{page + 1} / {totalPages}
						</Text>
						<HStack>
							<Button size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} isDisabled={page === 0}>
								{t("previous", "Previous")}
							</Button>
							<Button size="sm" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} isDisabled={page >= totalPages - 1}>
								{t("next", "Next")}
							</Button>
						</HStack>
					</HStack>
				) : null}
			</Stack>
		</Box>
	);
};

const AccessInsightRow: FC<{ client: AccessInsightClient }> = ({ client }) => {
	const { t } = useTranslation();
	const operatorByIP = new Map(
		(client.operators || []).map((operator) => [operator.ip, operator]),
	);
	return (
		<Tr>
			<Td verticalAlign="top">
				<Text fontWeight="700">{client.user_label}</Text>
				<Text fontSize="xs" color="panel.textMuted">
					{t("pages.accessInsights.connections", "Connections")}: {client.connections}
				</Text>
			</Td>
			<Td verticalAlign="top">
				<VStack align="start" spacing={1}>
					{(client.sources || []).map((ip) => {
						const operator = operatorByIP.get(ip);
						const label = operator?.short_name || operator?.owner || t("unknown", "Unknown");
						return (
							<Box key={ip}>
								<Text dir="ltr" fontFamily="mono" fontSize="xs" fontWeight="600">{ip}</Text>
								<Tooltip label={operator?.owner || label}>
									<HStack spacing={1.5} mt={0.5} w="fit-content">
										{operatorIcon(label)}
										<Text fontSize="xs" color="panel.textMuted">{label}</Text>
									</HStack>
								</Tooltip>
							</Box>
						);
					})}
				</VStack>
			</Td>
			<Td verticalAlign="top">
				<HStack spacing={1.5} flexWrap="wrap">
					{client.platforms.map((protocol) => (
						<Badge key={protocol.platform} colorScheme={protocolColor(protocol.platform)}>
							{protocol.platform}
						</Badge>
					))}
				</HStack>
			</Td>
			<Td verticalAlign="top">
				<Text fontSize="xs">{(client.nodes || []).join(", ") || "-"}</Text>
			</Td>
			<Td verticalAlign="top" whiteSpace="nowrap">
				<Text fontSize="xs">{dayjs(client.last_seen).format("YYYY-MM-DD HH:mm:ss")}</Text>
			</Td>
		</Tr>
	);
};

export default AccessInsightsPage;
