import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	ButtonGroup,
	Divider,
	HStack,
	Input,
	InputGroup,
	InputLeftElement,
	Spinner,
	Progress,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	EyeIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { OperatorIdentity } from "components/OperatorIdentity";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { AppDialog } from "components/dialogs/AppDialog";
import {
	DataTable,
	type DataTableColumn,
	PageHeader,
	ResourceListCard,
	ResourceRefreshButton,
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
import { filterAccessInsightItems } from "utils/accessInsights";
import { formatBytes } from "utils/formatByte";

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
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const { userData, getUserIsSuccess } = useGetUser();
	const canView =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const [data, setData] = useState<AccessInsightsResponse | null>(null);
	const [search, setSearch] = useState("");
	const [appliedSearch, setAppliedSearch] = useState("");
	const [protocolFilter, setProtocolFilter] = useState("");
	const [nodeFilter, setNodeFilter] = useState("");
	const [page, setPage] = useState(0);
	const [loading, setLoading] = useState(false);
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [error, setError] = useState("");
	const [selectedClient, setSelectedClient] =
		useState<AccessInsightClient | null>(null);

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
					t("pages.accessInsights.errors.loadFailed"),
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
			new Set(filteredItems.flatMap((item) => uniqueStrings(item.sources || [])))
				.size,
		[filteredItems],
	);
	const totalNodes = useMemo(
		() => new Set(filteredItems.flatMap((item) => item.nodes || [])).size,
		[filteredItems],
	);
	const protocolTotals = useMemo(
		() => {
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
		},
		[filteredItems],
	);
	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
	const visibleItems = filteredItems.slice(
		page * PAGE_SIZE,
		(page + 1) * PAGE_SIZE,
	);

	useEffect(() => {
		setPage((current) => Math.min(current, totalPages - 1));
	}, [totalPages]);

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
					<VStack align="start" spacing={0.5} minW={0}>
						<Text fontWeight="semibold" noOfLines={1} maxW="full">
							{client.user_label}
						</Text>
						<Text fontSize="xs" color="panel.textMuted">
							{t("pages.accessInsights.connections")}:{" "}
							{client.connections}
						</Text>
					</VStack>
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
						<VStack align="stretch" spacing={2} minW={0}>
						{sources.slice(0, 3).map((ip) => {
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
						{sources.length > 3 ? (
							<Text fontSize="xs" color="panel.textMuted">
								+{sources.length - 3}
							</Text>
						) : null}
					</VStack>
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
				id: "last_seen",
				header: t("pages.accessInsights.lastSeen"),
				accessor: "last_seen",
				priority: "medium",
				width: "155px",
				minWidth: "145px",
				mobilePriority: 3,
				cell: (client) => (
					<Text dir="ltr" fontSize="xs" whiteSpace="nowrap">
						{dayjs(client.last_seen).format("YYYY-MM-DD HH:mm:ss")}
					</Text>
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
					<Button
						size="xs"
						variant="ghost"
						leftIcon={<EyeIcon width={15} />}
						onClick={() => setSelectedClient(client)}
					>
						{t("details")}
					</Button>
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
					{t("pages.accessInsights.noPermission")}
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
						{t("previous")}
					</Button>
					<Button
						onClick={() =>
							setPage((current) => Math.min(totalPages - 1, current + 1))
						}
						isDisabled={page >= totalPages - 1}
					>
						{t("next")}
					</Button>
				</ButtonGroup>
			</HStack>
		) : null;
	const selectedSources = uniqueStrings(selectedClient?.sources || []);
	const selectedOperatorByIP = new Map(
		(selectedClient?.operators || []).map((operator) => [operator.ip, operator]),
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
		<VStack
			spacing={5}
			align="stretch"
			dir={isRTL ? "rtl" : "ltr"}
			data-dir={isRTL ? "rtl" : "ltr"}
		>
			<PageHeader
				title={t("pages.accessInsights.title")}
				description={t("pages.accessInsights.liveSubtitle")}
			/>

			<Stack spacing={3}>
				<ResourceListCard
					title={t("pages.accessInsights.onlineSessions")}
					summaryItems={[
						{
							label: t("pages.accessInsights.onlineUsers"),
							value: data?.online_total ?? 0,
							colorScheme: "green",
						},
						{
							label: t("pages.accessInsights.uniqueIps"),
							value: totalIPs,
							colorScheme: "blue",
						},
						{
							label: t("pages.accessInsights.activeNodes"),
							value: totalNodes,
							colorScheme: "cyan",
						},
					]}
					actions={
						<HStack spacing={3} justify={{ base: "space-between", xl: "end" }}>
							<HStack spacing={2}>
								<Switch
									isChecked={autoRefresh}
									onChange={(event) => setAutoRefresh(event.target.checked)}
									aria-label={t("pages.accessInsights.autoRefresh")}
								/>
								<Text fontSize="sm">
									{t("pages.accessInsights.autoRefresh")}
								</Text>
							</HStack>
							<ResourceRefreshButton
								aria-label={t("refresh")}
								label={t("refresh")}
								icon={<ArrowPathIcon width={18} />}
								onClick={() => void load()}
								isLoading={loading}
							/>
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
					<Stack
						as="form"
						onSubmit={(event) => {
							event.preventDefault();
							applySearch();
						}}
						direction={{ base: "column", lg: "row" }}
						spacing={2}
						w="full"
						maxW="760px"
					>
						<InputGroup flex="1">
							<InputLeftElement pointerEvents="none">
								<MagnifyingGlassIcon width={18} />
							</InputLeftElement>
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t("pages.accessInsights.liveSearch")}
							/>
						</InputGroup>
						<Select
							value={protocolFilter}
							onChange={(event) => {
								setProtocolFilter(event.target.value);
								setPage(0);
							}}
							aria-label={t("pages.accessInsights.allProtocols")}
							w={{ base: "full", md: "180px" }}
						>
							<option value="">
								{t("pages.accessInsights.allProtocols")}
							</option>
							{protocolOptions.map((protocol) => (
								<option key={protocol} value={protocol}>
									{protocol}
								</option>
							))}
						</Select>
						<Select
							value={nodeFilter}
							onChange={(event) => {
								setNodeFilter(event.target.value);
								setPage(0);
							}}
							aria-label={t("pages.accessInsights.allNodes")}
							w={{ base: "full", md: "180px" }}
						>
							<option value="">{t("pages.accessInsights.allNodes")}</option>
							{nodeOptions.map((node) => (
								<option key={node} value={node}>
									{node}
								</option>
							))}
						</Select>
						<Button type="submit" flexShrink={0}>
							{t("search")}
						</Button>
					</Stack>
				</ResourceListCard>

				<DataTable
					ariaLabel={t("pages.accessInsights.onlineSessions")}
					data={visibleItems}
					columns={columns}
					getRowId={(client) => client.user_key}
					isLoading={loading}
					loadingRows={8}
					error={error || undefined}
					emptyState={
						<Text fontSize="sm" color="panel.textMuted" textAlign="center">
							{t("pages.accessInsights.noData")}
						</Text>
					}
					pagination={pagination}
					mobileBreakpoint="lg"
					dir={isRTL ? "rtl" : "ltr"}
					tableProps={{
						className: isRTL ? "rb-rtl-table" : undefined,
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
			</Stack>

			<AppDialog
				isOpen={selectedClient !== null}
				onClose={() => setSelectedClient(null)}
				isCentered
				size="xl"
				title={`${t("details")}: ${selectedClient?.user_label || ""}`}
				contentProps={{ maxH: "min(760px, calc(100dvh - 2rem))" }}
				bodyProps={{ pb: 6 }}
			>
				{selectedClient ? (
					<Stack spacing={5}>
						<SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
							<Box>
								<Text fontSize="xs" color="panel.textMuted">
									{t("status")}
								</Text>
								<Badge
									mt={1}
									colorScheme={
										selectedClient.user_status === "active" ? "green" : "gray"
									}
								>
									{t(`status.${selectedClient.user_status || "active"}`, {
										defaultValue: selectedClient.user_status || "-",
									})}
								</Badge>
							</Box>
							<Box>
								<Text fontSize="xs" color="panel.textMuted">
									{t("service")}
								</Text>
								<Text mt={1} fontSize="sm" fontWeight="semibold" noOfLines={1}>
									{selectedClient.service_name || "-"}
								</Text>
							</Box>
							<Box>
								<Text fontSize="xs" color="panel.textMuted">
									{t("pages.accessInsights.connections")}
								</Text>
								<Text mt={1} fontSize="sm" fontWeight="semibold">
									{selectedClient.connections}
								</Text>
							</Box>
							<Box>
								<Text fontSize="xs" color="panel.textMuted">
									{t("expire")}
								</Text>
								<Text mt={1} fontSize="sm" fontWeight="semibold" dir="ltr">
									{selectedClient.expire
										? dayjs.unix(selectedClient.expire).format("YYYY-MM-DD HH:mm")
										: t("admins.expireNotSet")}
								</Text>
							</Box>
						</SimpleGrid>

						<Box>
							<HStack justify="space-between" mb={2}>
								<Text fontSize="sm" fontWeight="semibold">
									{t("dataUsage")}
								</Text>
								<Text fontSize="xs" color="panel.textMuted" dir="ltr">
									{formatBytes(selectedUsage)} / {selectedLimit > 0 ? formatBytes(selectedLimit) : t("unlimited")}
								</Text>
							</HStack>
							<Progress
								value={selectedUsagePercent}
								isAnimated={false}
								size="sm"
								borderRadius="full"
								colorScheme={selectedUsagePercent >= 90 ? "red" : "green"}
							/>
							<Text mt={2} fontSize="xs" color="panel.textMuted" dir="ltr">
								{t("remaining")}: {selectedRemaining === null ? t("unlimited") : formatBytes(selectedRemaining)}
							</Text>
						</Box>

						<Divider />
						<Box>
							<HStack justify="space-between" mb={2}>
								<Text fontSize="sm" fontWeight="semibold">
									{t("pages.accessInsights.ips")}
								</Text>
								<Badge variant="subtle">{selectedSources.length}</Badge>
							</HStack>
							<VStack align="stretch" spacing={0} maxH="320px" overflowY="auto">
								{selectedSources.map((ip) => {
									const operator = selectedOperatorByIP.get(ip);
									const nodes = uniqueStrings(selectedClient.source_nodes?.[ip] || []);
									return (
										<HStack
											key={ip}
											py={2}
											borderBottomWidth="1px"
											borderColor="panel.border"
											align="center"
										>
											<Box minW={{ base: "132px", md: "180px" }}>
												<Text dir="ltr" fontFamily="mono" fontSize="xs" fontWeight="semibold">
													{ip}
												</Text>
												{nodes.length ? (
													<Text fontSize="xs" color="panel.textMuted" noOfLines={1}>
														{nodes.join(", ")}
													</Text>
												) : null}
											</Box>
											<OperatorIdentity shortName={operator?.short_name} owner={operator?.owner} compact />
										</HStack>
									);
								})}
							</VStack>
						</Box>
					</Stack>
				) : null}
			</AppDialog>
		</VStack>
	);
};

export default AccessInsightsPage;
