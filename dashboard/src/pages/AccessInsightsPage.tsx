import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	ButtonGroup,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	Spinner,
	Switch,
	Text,
	Tooltip,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { OperatorIdentity } from "components/OperatorIdentity";
import {
	DataTable,
	type DataTableColumn,
	PageHeader,
	ResourceListCard,
} from "components/ui";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type {
	AccessInsightClient,
	AccessInsightsResponse,
} from "types/AccessInsights";

const PAGE_SIZE = 30;
const REFRESH_INTERVAL = 15_000;

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
					t(
						"pages.accessInsights.errors.loadFailed",
						"Failed to load access insights",
					),
			);
		} finally {
			setLoading(false);
		}
	}, [appliedSearch, canView, t]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!autoRefresh || !canView) return;
		const timer = window.setInterval(() => void load(), REFRESH_INTERVAL);
		return () => window.clearInterval(timer);
	}, [autoRefresh, canView, load]);

	const items = data?.items || [];
	const totalIPs = useMemo(
		() =>
			new Set(items.flatMap((item) => uniqueStrings(item.sources || []))).size,
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

	const columns = useMemo<DataTableColumn<AccessInsightClient>[]>(
		() => [
			{
				id: "user",
				header: t("user", "User"),
				accessor: "user_label",
				isPrimary: true,
				priority: "primary",
				width: "190px",
				minWidth: "160px",
				mobilePriority: 0,
				cell: (client) => (
					<VStack align="start" spacing={0.5} minW={0}>
						<Text fontWeight="semibold" noOfLines={1} maxW="full">
							{client.user_label}
						</Text>
						<Text fontSize="xs" color="panel.textMuted">
							{t("pages.accessInsights.connections", "Connections")}:{" "}
							{client.connections}
						</Text>
					</VStack>
				),
			},
			{
				id: "ips",
				header: t("pages.accessInsights.ips", "IPs"),
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
						<VStack align="stretch" spacing={2} minW={0}>
							{sources.map((ip) => {
								const operator = operatorByIP.get(ip);
								const nodes = uniqueStrings(client.source_nodes?.[ip] || []);
								return (
									<HStack key={ip} align="center" spacing={2} minW={0}>
										<Box minW="112px">
											<Text
												dir="ltr"
												fontFamily="mono"
												fontSize="xs"
												fontWeight="semibold"
											>
												{ip}
											</Text>
											{nodes.length ? (
												<Text
													fontSize="xs"
													color="panel.textMuted"
													noOfLines={1}
												>
													{nodes.join(", ")}
												</Text>
											) : null}
										</Box>
										<OperatorIdentity
											shortName={operator?.short_name}
											owner={operator?.owner}
											compact
										/>
									</HStack>
								);
							})}
						</VStack>
					);
				},
			},
			{
				id: "protocols",
				header: t("pages.accessInsights.protocols", "Protocols"),
				accessor: (client) =>
					client.platforms.map((item) => item.platform).join(", "),
				priority: "high",
				width: "210px",
				minWidth: "170px",
				mobilePriority: 2,
				cell: (client) => (
					<HStack spacing={1.5} flexWrap="wrap">
						{client.platforms.map((protocol) => (
							<Badge
								key={protocol.platform}
								colorScheme={protocolColor(protocol.platform)}
								borderRadius="md"
							>
								{protocol.platform} · {protocol.connections}
							</Badge>
						))}
					</HStack>
				),
			},
			{
				id: "nodes",
				header: t("pages.accessInsights.nodes", "Nodes"),
				accessor: (client) => client.nodes?.join(", ") || "-",
				priority: "medium",
				width: "180px",
				minWidth: "150px",
				truncate: true,
				tooltip: true,
				mobilePriority: 3,
			},
			{
				id: "last_seen",
				header: t("pages.accessInsights.lastSeen", "Last seen"),
				accessor: "last_seen",
				priority: "medium",
				width: "155px",
				minWidth: "145px",
				mobilePriority: 4,
				cell: (client) => (
					<Text dir="ltr" fontSize="xs" whiteSpace="nowrap">
						{dayjs(client.last_seen).format("YYYY-MM-DD HH:mm:ss")}
					</Text>
				),
			},
		],
		[t],
	);

	if (!getUserIsSuccess) {
		return (
			<VStack spacing={4} align="center" py={10}>
				<Spinner size="lg" />
			</VStack>
		);
	}

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
	const pagination =
		totalPages > 1 ? (
			<HStack justify="space-between" w="full">
				<Text fontSize="sm" color="panel.textMuted">
					{page + 1} / {totalPages}
				</Text>
				<ButtonGroup size="sm" isAttached variant="outline">
					<Button
						onClick={() => setPage((current) => Math.max(0, current - 1))}
						isDisabled={page === 0}
					>
						{t("previous", "Previous")}
					</Button>
					<Button
						onClick={() =>
							setPage((current) => Math.min(totalPages - 1, current + 1))
						}
						isDisabled={page >= totalPages - 1}
					>
						{t("next", "Next")}
					</Button>
				</ButtonGroup>
			</HStack>
		) : null;

	return (
		<VStack spacing={4} align="stretch">
			<PageHeader
				title={t("pages.accessInsights.title", "Live Access Insights")}
				description={t(
					"pages.accessInsights.liveSubtitle",
					"Active users across Xray, OpenVPN, WireGuard, L2TP, IKEv2, and Cisco AnyConnect.",
				)}
			/>

			<ResourceListCard
				title={t("pages.accessInsights.onlineSessions", "Online sessions")}
				summaryItems={[
					{
						label: t("pages.accessInsights.onlineUsers", "Online users"),
						value: items.length,
						colorScheme: "green",
					},
					{
						label: t("pages.accessInsights.uniqueIps", "Unique IPs"),
						value: totalIPs,
						colorScheme: "blue",
					},
					{
						label: t("pages.accessInsights.activeNodes", "Active nodes"),
						value: totalNodes,
						colorScheme: "cyan",
					},
				]}
				actions={
					<HStack spacing={3}>
						<HStack spacing={2}>
							<Switch
								isChecked={autoRefresh}
								onChange={(event) => setAutoRefresh(event.target.checked)}
								aria-label={t(
									"pages.accessInsights.autoRefresh",
									"Auto refresh",
								)}
							/>
							<Text fontSize="sm">
								{t("pages.accessInsights.autoRefresh", "Auto refresh")}
							</Text>
						</HStack>
						<Tooltip label={t("refresh", "Refresh")}>
							<IconButton
								aria-label={t("refresh", "Refresh")}
								icon={<ArrowPathIcon width={18} />}
								onClick={() => void load()}
								isLoading={loading}
								size="sm"
								variant="ghost"
							/>
						</Tooltip>
					</HStack>
				}
				footerActions={
					protocolTotals.length ? (
						<HStack spacing={1.5} flexWrap="wrap">
							{protocolTotals.map(([protocol, count]) => (
								<Badge
									key={protocol}
									colorScheme={protocolColor(protocol)}
									borderRadius="md"
								>
									{protocol} · {count}
								</Badge>
							))}
						</HStack>
					) : undefined
				}
			>
				<HStack
					as="form"
					onSubmit={(event) => {
						event.preventDefault();
						applySearch();
					}}
					spacing={2}
					maxW="520px"
				>
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
			</ResourceListCard>

			<DataTable
				ariaLabel={t("pages.accessInsights.onlineSessions", "Online sessions")}
				data={visibleItems}
				columns={columns}
				getRowId={(client) => client.user_key}
				isLoading={loading}
				loadingRows={8}
				error={error || undefined}
				emptyState={
					<Text fontSize="sm" color="panel.textMuted" textAlign="center">
						{t("pages.accessInsights.noData", "No recent connections found.")}
					</Text>
				}
				pagination={pagination}
				mobileBreakpoint="lg"
				tableProps={{
					w: "full",
					sx: {
						tableLayout: "fixed",
						"& th, & td": {
							px: { base: 2, xl: 2.5 },
							py: 2.5,
							verticalAlign: "middle",
						},
					},
				}}
			/>
		</VStack>
	);
};

export default AccessInsightsPage;
