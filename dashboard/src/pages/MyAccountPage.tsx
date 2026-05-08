import {
	Badge,
	Box,
	Button,
	chakra,
	Flex,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputRightElement,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	SimpleGrid,
	Spinner,
	Stat,
	StatLabel,
	StatNumber,
	Table,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	useClipboard,
	useColorMode,
	useColorModeValue,
	useDisclosure,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ClipboardIcon,
	EyeIcon,
	EyeSlashIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import type { ApexOptions } from "apexcharts";
import { ChartBox } from "components/common/ChartBox";
import {
	DateRangePicker,
	type DateRangeValue,
} from "components/common/DateRangePicker";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import useGetUser from "hooks/useGetUser";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	changeMyAccountPassword,
	createApiKey,
	deleteApiKey,
	getAdminNodesUsage,
	getMyAccount,
	listApiKeys,
} from "service/myaccount";
import { AdminRole } from "types/Admin";
import type { AdminApiKey } from "types/ApiKey";
import type {
	MyAccountNodeUsage,
	MyAccountResponse,
	MyAccountServiceLimit,
	MyAccountTrafficBasis,
	MyAccountUsagePoint,
} from "types/MyAccount";
import { formatBytes } from "utils/formatByte";

dayjs.extend(utc);
const CopyIcon = chakra(ClipboardIcon, { baseStyle: { w: 4, h: 4 } });

const formatTimeseriesLabel = (value: string) => {
	if (!value) return value;
	const hasTime = value.includes(" ");
	const normalized = hasTime ? value.replace(" ", "T") : value;
	const parsed = dayjs.utc(normalized);
	if (!parsed.isValid()) return value;
	return hasTime
		? parsed.local().format("MM-DD HH:mm")
		: parsed.format("YYYY-MM-DD");
};

const buildDailyUsageOptions = (
	colorMode: string,
	categories: string[],
): ApexOptions => {
	const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
	return {
		chart: { type: "area", toolbar: { show: false }, zoom: { enabled: false } },
		dataLabels: { enabled: false },
		stroke: { curve: "smooth", width: 2 },
		fill: {
			type: "gradient",
			gradient: {
				shadeIntensity: 1,
				opacityFrom: 0.35,
				opacityTo: 0.05,
				stops: [0, 80, 100],
			},
		},
		grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
		xaxis: {
			categories,
			labels: { style: { colors: categories.map(() => axisColor) } },
			axisBorder: { show: false },
			axisTicks: { show: false },
		},
		yaxis: {
			labels: {
				formatter: (value: number) => formatBytes(Number(value) || 0, 1),
				style: { colors: [axisColor] },
			},
		},
		tooltip: {
			theme: colorMode === "dark" ? "dark" : "light",
			shared: true,
			fillSeriesColor: false,
			y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) },
		},
		colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
	};
};

const buildDonutOptions = (
	colorMode: string,
	labels: string[],
): ApexOptions => ({
	labels,
	legend: {
		position: "bottom",
		labels: { colors: colorMode === "dark" ? "#d8dee9" : "#1a202c" },
	},
	tooltip: {
		y: {
			formatter: (value: number) => formatBytes(Number(value) || 0, 2),
		},
	},
	colors: [
		"#3182CE",
		"#63B3ED",
		"#ED8936",
		"#38A169",
		"#9F7AEA",
		"#F6AD55",
		"#4299E1",
		"#E53E3E",
		"#D53F8C",
		"#805AD5",
	],
});

type StatsCardProps = {
	label: string;
	value: string;
	helper?: string;
	accentColor?: string;
};

const StatsCard: React.FC<StatsCardProps> = ({
	label,
	value,
	helper,
	accentColor = "primary.400",
}) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");

	return (
		<Stat
			p={4}
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			position="relative"
			overflow="hidden"
		>
			<Box
				position="absolute"
				insetInlineStart={0}
				top={0}
				bottom={0}
				w="3px"
				bg={accentColor}
			/>
			<StatLabel color={labelColor} fontSize="xs" fontWeight="semibold">
				{label}
			</StatLabel>
			<StatNumber mt={1} fontSize="xl" lineHeight="1.2">
				{value}
			</StatNumber>
			{helper && (
				<Text mt={2} fontSize="xs" color={labelColor}>
					{helper}
				</Text>
			)}
		</Stat>
	);
};

const MiniMetric: React.FC<{ label: string; value: string }> = ({
	label,
	value,
}) => {
	const labelColor = useColorModeValue("gray.500", "gray.400");
	return (
		<Box>
			<Text fontSize="xs" color={labelColor} fontWeight="semibold">
				{label}
			</Text>
			<Text mt={1} fontWeight="semibold">
				{value}
			</Text>
		</Box>
	);
};

const getTrafficLabels = (
	t: (key: string, fallback?: string) => string,
	basis: MyAccountTrafficBasis,
) => {
	const isCreated = basis === "created_traffic";
	return {
		sectionTitle: isCreated
			? t("myaccount.createdTrafficSection", "Created traffic")
			: t("myaccount.dataUsage"),
		usedLabel: isCreated
			? t("myaccount.createdTraffic", "Created traffic")
			: t("myaccount.usedData"),
		remainingLabel: isCreated
			? t("myaccount.remainingTraffic", "Remaining traffic")
			: t("myaccount.remainingData"),
		totalLabel: isCreated
			? t("myaccount.trafficLimit", "Traffic limit")
			: t("myaccount.totalData"),
		dailyChartTitle: isCreated
			? t("myaccount.dailyCreatedTraffic", "Daily created traffic")
			: t("myaccount.dailyUsage"),
		dailyTotalLabel: isCreated
			? t("myaccount.totalCreatedTraffic", "Total created traffic")
			: t("nodes.totalUsage", "Total usage"),
		modeLabel: isCreated
			? t("myaccount.serviceModeCreated", "Created traffic")
			: t("myaccount.serviceModeUsed", "Used traffic"),
	};
};

const ServiceLimitPanel: React.FC<{
	service: MyAccountServiceLimit;
	colorMode: string;
	t: (key: string, fallback?: string) => string;
}> = ({ service, colorMode, t }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const subBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const labels = getTrafficLabels(t, service.traffic_basis);
	const dailyPoints = service.daily_usage ?? [];
	const dailyTotal = dailyPoints.reduce(
		(sum, point) => sum + Number(point.used_traffic || 0),
		0,
	);
	const categories = dailyPoints.map((point) =>
		formatTimeseriesLabel(point.date),
	);
	const series = [
		{
			name: labels.dailyChartTitle,
			data: dailyPoints.map((point) => point.used_traffic),
		},
	];
	const limit = service.data_limit ?? 0;
	const remaining =
		service.remaining_data ?? Math.max(limit - service.used_traffic, 0);
	const usersLimit = service.users_limit ?? 0;
	const remainingUsers =
		service.remaining_users ??
		Math.max(usersLimit - service.current_users_count, 0);

	return (
		<Box borderWidth="1px" borderColor={borderColor} borderRadius="md" bg={bg}>
			<HStack justify="space-between" align="start" mb={4} spacing={3}>
				<Box minW={0} px={4} pt={4}>
					<Text fontWeight="semibold" noOfLines={1}>
						{service.service_name}
					</Text>
					<Text fontSize="xs" color={labelColor}>
						{t("myaccount.serviceLimit", "Service limit")}
					</Text>
				</Box>
				<Box px={4} pt={4}>
					<Badge
						borderRadius="md"
						colorScheme={
							service.traffic_basis === "created_traffic" ? "purple" : "blue"
						}
					>
						{labels.modeLabel}
					</Badge>
				</Box>
			</HStack>

			<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} px={4} pb={4}>
				<MiniMetric
					label={labels.usedLabel}
					value={formatBytes(service.used_traffic, 2)}
				/>
				<MiniMetric
					label={labels.remainingLabel}
					value={
						service.data_limit === null
							? t("myaccount.unlimited")
							: formatBytes(remaining, 2)
					}
				/>
				<MiniMetric
					label={labels.totalLabel}
					value={
						service.data_limit === null
							? t("myaccount.unlimited")
							: formatBytes(limit, 2)
					}
				/>
				<MiniMetric
					label={t("myaccount.createdUsers")}
					value={`${service.current_users_count}`}
				/>
				<MiniMetric
					label={t("myaccount.remainingUsers")}
					value={
						service.users_limit === null
							? t("myaccount.unlimited")
							: `${Math.max(remainingUsers, 0)}`
					}
				/>
				<MiniMetric
					label={t("myaccount.totalUsers")}
					value={
						service.users_limit === null
							? t("myaccount.unlimited")
							: `${usersLimit}`
					}
				/>
			</SimpleGrid>

			<Box borderTopWidth="1px" borderTopColor={borderColor} bg={subBg} p={4}>
				<Text fontSize="sm" color={labelColor} mb={2}>
					{labels.dailyTotalLabel}:{" "}
					<chakra.span fontWeight="semibold">
						{formatBytes(dailyTotal, 2)}
					</chakra.span>
				</Text>
				{series[0].data.length ? (
					<ReactApexChart
						options={buildDailyUsageOptions(colorMode, categories)}
						series={series as any}
						type="area"
						height={220}
					/>
				) : (
					<Text color={labelColor}>{t("noData")}</Text>
				)}
			</Box>
		</Box>
	);
};

const ServiceBalanceCard: React.FC<{
	service: MyAccountServiceLimit;
	t: (key: string, fallback?: string) => string;
}> = ({ service, t }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const labels = getTrafficLabels(t, service.traffic_basis);
	const limit = service.data_limit ?? 0;
	const remaining =
		service.remaining_data ?? Math.max(limit - service.used_traffic, 0);
	const remainingText =
		service.data_limit === null
			? t("myaccount.unlimited")
			: formatBytes(remaining, 2);
	const limitText =
		service.data_limit === null
			? t("myaccount.unlimited")
			: formatBytes(limit, 2);

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			p={4}
			bg={bg}
		>
			<HStack justify="space-between" align="start" spacing={3} mb={3}>
				<Box minW={0}>
					<Text fontSize="xs" color={labelColor} fontWeight="semibold">
						{t("myaccount.service", "Service")}
					</Text>
					<Text fontWeight="semibold" fontSize="lg" noOfLines={1}>
						{service.service_name}
					</Text>
				</Box>
				<Badge
					borderRadius="md"
					colorScheme={
						service.traffic_basis === "created_traffic" ? "purple" : "blue"
					}
				>
					{labels.modeLabel}
				</Badge>
			</HStack>
			<Text fontSize="2xl" fontWeight="bold">
				{remainingText}
			</Text>
			<Text fontSize="sm" color={labelColor}>
				{t("myaccount.remainingFromService", "remaining from this service")}
			</Text>
			<SimpleGrid columns={2} spacing={3} mt={4}>
				<MiniMetric
					label={labels.usedLabel}
					value={formatBytes(service.used_traffic, 2)}
				/>
				<MiniMetric label={labels.totalLabel} value={limitText} />
			</SimpleGrid>
		</Box>
	);
};

const ChangePasswordModal: React.FC<{
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (current: string, next: string) => Promise<void>;
}> = ({ isOpen, onClose, onSubmit }) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const toast = useToast();
	const [showCurrent, setShowCurrent] = useState(false);
	const [showNew, setShowNew] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [isSubmitting, setSubmitting] = useState(false);

	const generateRandomString = useCallback((length: number) => {
		const characters =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const charactersLength = characters.length;

		if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
			const randomValues = new Uint32Array(length);
			window.crypto.getRandomValues(randomValues);
			return Array.from(
				randomValues,
				(value) => characters[value % charactersLength],
			).join("");
		}

		return Array.from({ length }, () => {
			const index = Math.floor(Math.random() * charactersLength);
			return characters[index];
		}).join("");
	}, []);

	const handleGeneratePassword = () => {
		const randomPassword = generateRandomString(12);
		setNewPassword(randomPassword);
	};

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			await onSubmit(currentPassword, newPassword);
			toast({
				title: t("myaccount.passwordUpdated"),
				status: "success",
			});
			setCurrentPassword("");
			setNewPassword("");
			onClose();
		} catch (error: any) {
			toast({
				title: error?.detail || t("error"),
				status: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} isCentered>
			<ModalOverlay />
			<ModalContent>
				<ModalHeader>{t("myaccount.changePassword")}</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<VStack spacing={4} align="stretch">
						<Box maxW="420px">
							<InputGroup dir={isRTL ? "rtl" : "ltr"}>
								<Input
									placeholder={t("myaccount.currentPassword")}
									type={showCurrent ? "text" : "password"}
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
									paddingInlineEnd="2.75rem"
								/>
								<InputRightElement
									insetInlineEnd="0.5rem"
									right="auto"
									left="auto"
								>
									<IconButton
										aria-label={
											showCurrent
												? t("admins.hidePassword")
												: t("admins.showPassword")
										}
										size="sm"
										variant="ghost"
										icon={
											showCurrent ? (
												<EyeSlashIcon width={16} />
											) : (
												<EyeIcon width={16} />
											)
										}
										onClick={() => setShowCurrent(!showCurrent)}
									/>
								</InputRightElement>
							</InputGroup>
						</Box>
						<Box maxW="420px">
							<HStack spacing={2}>
								<InputGroup dir={isRTL ? "rtl" : "ltr"}>
									<Input
										placeholder={t("myaccount.newPassword")}
										type={showNew ? "text" : "password"}
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
										paddingInlineEnd="2.75rem"
									/>
									<InputRightElement
										insetInlineEnd="0.5rem"
										right="auto"
										left="auto"
									>
										<IconButton
											aria-label={
												showNew
													? t("admins.hidePassword")
													: t("admins.showPassword")
											}
											size="sm"
											variant="ghost"
											icon={
												showNew ? (
													<EyeSlashIcon width={16} />
												) : (
													<EyeIcon width={16} />
												)
											}
											onClick={() => setShowNew(!showNew)}
										/>
									</InputRightElement>
								</InputGroup>
								<IconButton
									aria-label={t("admins.generatePassword")}
									size="md"
									variant="outline"
									icon={<SparklesIcon width={20} />}
									onClick={handleGeneratePassword}
								/>
							</HStack>
						</Box>
					</VStack>
				</ModalBody>
				<ModalFooter>
					<Button mr={3} onClick={onClose} variant="ghost">
						{t("cancel")}
					</Button>
					<Button
						colorScheme="primary"
						onClick={handleSubmit}
						isLoading={isSubmitting}
						isDisabled={!newPassword}
					>
						{t("save")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

export const MyAccountPage: React.FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const toast = useToast();
	const modal = useDisclosure();
	const apiKeyModal = useDisclosure();
	const queryClient = useQueryClient();
	const { colorMode } = useColorMode();
	const panelBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const { userData, getUserIsSuccess } = useGetUser();
	const { onCopy, setValue: setClipboardValue } = useClipboard("");
	const [range, setRange] = useState<DateRangeValue>(() => {
		const end = dayjs().utc().endOf("day");
		const start = end.subtract(30, "day").startOf("day");
		return {
			start: start.toDate(),
			end: end.toDate(),
			presetKey: "1m",
			key: "1m",
		};
	});

	const username = userData?.username;
	const isFullAccess = userData?.role === AdminRole.FullAccess;
	const defaultSelfPermissions = {
		self_myaccount: false,
		self_change_password: false,
		self_api_keys: false,
	};
	const baseSelfPermissions =
		userData?.permissions?.self_permissions ?? defaultSelfPermissions;
	const selfPermissions = isFullAccess
		? { self_myaccount: true, self_change_password: true, self_api_keys: true }
		: baseSelfPermissions;

	const { data, isLoading, isFetching } = useQuery<MyAccountResponse>(
		["myaccount", range.start, range.end],
		() =>
			getMyAccount({
				start: `${dayjs(range.start).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
				end: `${dayjs(range.end).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
			}),
		{
			keepPreviousData: true,
			enabled: selfPermissions.self_myaccount && getUserIsSuccess,
		},
	);
	const trafficBasis = data?.traffic_basis ?? "used_traffic";
	const isCreatedTrafficBasis = trafficBasis === "created_traffic";
	const isPerServiceLimits = Boolean(data?.use_service_traffic_limits);
	const { data: nodesData } = useQuery(
		["myaccount-nodes", username, range.start, range.end],
		() =>
			username
				? getAdminNodesUsage(username, {
						start: `${dayjs(range.start).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
						end: `${dayjs(range.end).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
					})
				: Promise.resolve({ usages: [] }),
		{
			keepPreviousData: true,
			enabled:
				selfPermissions.self_myaccount &&
				Boolean(username) &&
				getUserIsSuccess &&
				data?.traffic_basis === "used_traffic" &&
				!data?.use_service_traffic_limits,
		},
	);
	const mutation = useMutation(changeMyAccountPassword, {
		onSuccess: () => {
			queryClient.invalidateQueries("myaccount");
		},
	});
	const apiKeysQuery = useQuery<AdminApiKey[]>(
		["myaccount-api-keys"],
		listApiKeys,
		{ enabled: selfPermissions.self_api_keys && getUserIsSuccess },
	);
	const createKeyMutation = useMutation(createApiKey, {
		onSuccess: (data) => {
			queryClient.invalidateQueries("myaccount-api-keys");
			if (data?.api_key) {
				setClipboardValue(data.api_key);
			}
			toast({
				title: t("myaccount.apiKeyCreated"),
				status: "success",
			});
			setGeneratedKey(data?.api_key ?? "");
		},
	});
	const deleteKeyMutation = useMutation(
		({ id, current_password }: { id: number; current_password: string }) =>
			deleteApiKey(id, current_password),
		{
			onSuccess: () => {
				queryClient.invalidateQueries("myaccount-api-keys");
				toast({
					title: t("myaccount.apiKeyDeleted"),
					status: "success",
				});
				deleteModal.onClose();
				setDeleteKeyId(null);
				setDeletePassword("");
				setShowDeletePassword(false);
			},
		},
	);
	const [selectedLifetime, setSelectedLifetime] = useState<string>("1m");
	const [generatedKey, setGeneratedKey] = useState<string>("");
	const hasGeneratedKey = Boolean(generatedKey);
	const deleteModal = useDisclosure();
	const [deletePassword, setDeletePassword] = useState("");
	const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);
	const [showDeletePassword, setShowDeletePassword] = useState(false);

	const handlePasswordChange = async (current: string, next: string) => {
		await mutation.mutateAsync({
			current_password: current,
			new_password: next,
		});
	};

	const dailyUsagePoints: MyAccountUsagePoint[] = useMemo(
		() => data?.daily_usage ?? [],
		[data?.daily_usage],
	);
	const dailyTotal = useMemo(
		() =>
			dailyUsagePoints.reduce((sum, p) => sum + Number(p.used_traffic || 0), 0),
		[dailyUsagePoints],
	);

	const dailyCategories = useMemo(
		() => dailyUsagePoints.map((p) => formatTimeseriesLabel(p.date)),
		[dailyUsagePoints],
	);
	const dailySeries = useMemo(
		() => [
			{
				name: isCreatedTrafficBasis
					? t("myaccount.dailyCreatedTraffic", "Daily created traffic")
					: t("myaccount.dailyUsage", "Daily usage"),
				data: dailyUsagePoints.map((p) => p.used_traffic),
			},
		],
		[dailyUsagePoints, isCreatedTrafficBasis, t],
	);

	// Map backend response (with uplink/downlink) to frontend format (with used_traffic)
	const perNodeUsage: MyAccountNodeUsage[] = useMemo(() => {
		const backendUsages = nodesData?.usages ?? data?.node_usages ?? [];
		return backendUsages.map((item: any) => ({
			node_id: item.node_id ?? null,
			node_name: item.node_name || "Unknown",
			used_traffic: Number(
				item.used_traffic ?? (item.uplink ?? 0) + (item.downlink ?? 0),
			),
		}));
	}, [nodesData?.usages, data?.node_usages]);
	const donutLabels = perNodeUsage.map(
		(item: MyAccountNodeUsage) => item.node_name || "Unknown",
	);
	const donutSeries = perNodeUsage.map(
		(item: MyAccountNodeUsage) => item.used_traffic || 0,
	);
	const perNodeTotal = useMemo(
		() =>
			perNodeUsage.reduce(
				(sum: number, p: MyAccountNodeUsage) =>
					sum + Number(p.used_traffic || 0),
				0,
			),
		[perNodeUsage],
	);

	if (!selfPermissions.self_myaccount) {
		return (
			<VStack
				spacing={3}
				align="start"
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				p={4}
			>
				<Text fontSize="lg" fontWeight="semibold">
					{t("myaccount.forbiddenTitle")}
				</Text>
				<Text color={labelColor}>{t("myaccount.forbiddenDescription")}</Text>
			</VStack>
		);
	}

	if (isLoading || !data) {
		return (
			<Flex justify="center" align="center" py={10}>
				<Spinner />
			</Flex>
		);
	}

	const used = data.used_traffic || 0;
	const totalData = data.data_limit ?? 0;
	const remainingData = data.remaining_data ?? Math.max(totalData - used, 0);
	const usersLimit = data.users_limit ?? 0;
	const remainingUsers = data.remaining_users ?? 0;
	const serviceLimits = data.service_limits ?? [];
	const trafficLabels = getTrafficLabels(t, trafficBasis);
	const usageSectionTitle = isPerServiceLimits
		? t("myaccount.serviceTrafficOverview", "Service traffic overview")
		: trafficLabels.sectionTitle;
	const usedLabel = isPerServiceLimits
		? t("myaccount.totalServiceTraffic", "Total service traffic")
		: trafficLabels.usedLabel;
	const remainingLabel = trafficLabels.remainingLabel;
	const totalLabel = isPerServiceLimits
		? t("myaccount.serviceTrafficLimit", "Service traffic limit")
		: trafficLabels.totalLabel;
	const dailyChartTitle = isPerServiceLimits
		? t("myaccount.dailyServiceTraffic", "Daily service traffic")
		: trafficLabels.dailyChartTitle;
	const dailyTotalLabel = isPerServiceLimits
		? t("myaccount.totalServiceTraffic", "Total service traffic")
		: trafficLabels.dailyTotalLabel;
	const showServiceBalances = isPerServiceLimits || serviceLimits.length > 0;

	return (
		<VStack spacing={4} align="stretch">
			<Box
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				p={{ base: 3, md: 4 }}
			>
				<Flex
					justify="space-between"
					align={{ base: "flex-start", md: "center" }}
					gap={3}
					flexWrap="wrap"
				>
					<Box minW={0}>
						<Text as="h1" fontWeight="semibold" fontSize="2xl">
							{t("myaccount.title")}
						</Text>
						<Text fontSize="sm" color={labelColor}>
							{t("myaccount.subtitle")}
						</Text>
					</Box>
					{isFetching && (
						<HStack spacing={2} color={labelColor}>
							<Spinner size="sm" />
							<Text fontSize="sm">{t("loading")}</Text>
						</HStack>
					)}
				</Flex>
			</Box>

			<SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4}>
				<ChartBox title={usageSectionTitle}>
					<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
						<StatsCard label={usedLabel} value={formatBytes(used, 2)} />
						<StatsCard
							label={remainingLabel}
							value={
								data.data_limit === null
									? t("myaccount.unlimited")
									: formatBytes(remainingData, 2)
							}
						/>
						<StatsCard
							label={totalLabel}
							value={
								data.data_limit === null
									? t("myaccount.unlimited")
									: formatBytes(totalData, 2)
							}
						/>
					</SimpleGrid>
				</ChartBox>
				<ChartBox title={t("myaccount.userLimits")}>
					<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
						<StatsCard
							label={t("myaccount.createdUsers")}
							value={`${data.current_users_count}`}
						/>
						<StatsCard
							label={t("myaccount.remainingUsers")}
							value={
								data.users_limit === null
									? t("myaccount.unlimited")
									: `${Math.max(remainingUsers, 0)}`
							}
						/>
						<StatsCard
							label={t("myaccount.totalUsers")}
							value={
								data.users_limit === null
									? t("myaccount.unlimited")
									: `${usersLimit}`
							}
						/>
					</SimpleGrid>
				</ChartBox>
			</SimpleGrid>

			{showServiceBalances && (
				<ChartBox title={t("myaccount.serviceBalances", "Service balances")}>
					{serviceLimits.length ? (
						<>
							<Text fontSize="sm" color={labelColor} mb={3}>
								{t(
									"myaccount.serviceBalancesHint",
									"Remaining traffic is shown separately for each assigned service.",
								)}
							</Text>
							<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
								{serviceLimits.map((service) => (
									<ServiceBalanceCard
										key={service.service_id}
										service={service}
										t={t}
									/>
								))}
							</SimpleGrid>
						</>
					) : (
						<Text color={labelColor}>{t("noData")}</Text>
					)}
				</ChartBox>
			)}

			<SimpleGrid
				columns={{
					base: 1,
					lg: isCreatedTrafficBasis || isPerServiceLimits ? 1 : 2,
				}}
				spacing={4}
			>
				<Box minW={0}>
					<ChartBox
						title={dailyChartTitle}
						headerActions={
							<DateRangePicker
								value={range}
								onChange={(next) => {
									setRange(next);
								}}
							/>
						}
						minH="500px"
					>
						<Text fontSize="sm" color={labelColor} mb={3}>
							{dailyTotalLabel}:{" "}
							<chakra.span fontWeight="semibold">
								{formatBytes(dailyTotal, 2)}
							</chakra.span>
						</Text>
						{dailySeries[0].data.length ? (
							<ReactApexChart
								options={buildDailyUsageOptions(colorMode, dailyCategories)}
								series={dailySeries as any}
								type="area"
								height={340}
							/>
						) : (
							<Text color={labelColor}>{t("noData")}</Text>
						)}
					</ChartBox>
				</Box>
				{!isCreatedTrafficBasis && !isPerServiceLimits && (
					<Box minW={0}>
						<ChartBox title={t("myaccount.perNodeUsage")} minH="500px">
							<Text fontSize="sm" color={labelColor} mb={3}>
								{t("nodes.totalUsage", "Total usage")}:{" "}
								<chakra.span fontWeight="semibold">
									{formatBytes(perNodeTotal, 2)}
								</chakra.span>
							</Text>
							{perNodeUsage.length > 0 &&
							donutSeries.some((value: number) => value > 0) ? (
								<ReactApexChart
									type="donut"
									height={360}
									options={buildDonutOptions(colorMode, donutLabels)}
									series={donutSeries}
								/>
							) : (
								<Text color={labelColor}>{t("noData")}</Text>
							)}
						</ChartBox>
					</Box>
				)}
			</SimpleGrid>

			{isPerServiceLimits && (
				<ChartBox title={t("myaccount.serviceTrafficLimits", "Service limits")}>
					{serviceLimits.length ? (
						<SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4}>
							{serviceLimits.map((service) => (
								<ServiceLimitPanel
									key={service.service_id}
									service={service}
									colorMode={colorMode}
									t={t}
								/>
							))}
						</SimpleGrid>
					) : (
						<Text color={labelColor}>{t("noData")}</Text>
					)}
				</ChartBox>
			)}

			{selfPermissions.self_api_keys && (
				<ChartBox
					title={t("myaccount.apiKeys")}
					headerActions={
						<Button
							size="sm"
							colorScheme="primary"
							onClick={apiKeyModal.onOpen}
						>
							{t("myaccount.createApiKey")}
						</Button>
					}
				>
					{apiKeysQuery.isLoading ? (
						<HStack>
							<Spinner size="sm" />
							<Text>{t("loading")}</Text>
						</HStack>
					) : (apiKeysQuery.data?.length ?? 0) === 0 ? (
						<Text color={labelColor}>{t("myaccount.noApiKeys")}</Text>
					) : (
						<Box
							overflowX="auto"
							borderWidth="1px"
							borderColor={borderColor}
							borderRadius="md"
						>
							<Table size="sm">
								<Thead bg={panelBg}>
									<Tr>
										<Th>{t("myaccount.apiKeyMasked")}</Th>
										<Th>{t("createdAt")}</Th>
										<Th>{t("expiresAt")}</Th>
										<Th>{t("myaccount.lastUsed")}</Th>
										<Th></Th>
									</Tr>
								</Thead>
								<Tbody>
									{apiKeysQuery.data?.map((key) => (
										<Tr key={key.id}>
											<Td fontWeight="semibold">{key.masked_key ?? "****"}</Td>
											<Td>
												{key.created_at
													? dayjs(key.created_at).format("YYYY-MM-DD HH:mm")
													: "-"}
											</Td>
											<Td>
												{key.expires_at
													? dayjs(key.expires_at).format("YYYY-MM-DD")
													: t("myaccount.never")}
											</Td>
											<Td>
												{key.last_used_at
													? dayjs(key.last_used_at).format("YYYY-MM-DD HH:mm")
													: t("myaccount.neverUsed")}
											</Td>
											<Td textAlign="right">
												<Button
													size="xs"
													colorScheme="red"
													variant="ghost"
													isLoading={deleteKeyMutation.isLoading}
													onClick={() => {
														setDeleteKeyId(key.id);
														setDeletePassword("");
														setShowDeletePassword(false);
														deleteModal.onOpen();
													}}
												>
													{t("delete")}
												</Button>
											</Td>
										</Tr>
									))}
								</Tbody>
							</Table>
						</Box>
					)}
				</ChartBox>
			)}

			{selfPermissions.self_change_password && (
				<ChartBox title={t("myaccount.changePasswordCard")}>
					<Flex
						justify="space-between"
						align={{ base: "stretch", md: "center" }}
						gap={3}
						flexWrap="wrap"
					>
						<Text fontSize="sm" color={labelColor} maxW="720px">
							{t("myaccount.changePasswordHint")}
						</Text>
						<Button colorScheme="primary" onClick={modal.onOpen}>
							{t("myaccount.changePassword")}
						</Button>
					</Flex>
				</ChartBox>
			)}

			{selfPermissions.self_api_keys && (
				<Modal
					isOpen={apiKeyModal.isOpen}
					onClose={() => {
						apiKeyModal.onClose();
						setGeneratedKey("");
					}}
					isCentered
				>
					<ModalOverlay />
					<ModalContent>
						<ModalHeader>{t("myaccount.createApiKey")}</ModalHeader>
						<ModalCloseButton />
						<ModalBody>
							<VStack spacing={4} align="stretch">
								{!hasGeneratedKey && (
									<Box>
										<Text fontWeight="medium" mb={2}>
											{t("myaccount.apiKeyLifetime")}
										</Text>
										<Select
											value={selectedLifetime}
											onChange={(e) => setSelectedLifetime(e.target.value)}
										>
											<option value="1m">{t("myaccount.lifetime1m")}</option>
											<option value="3m">{t("myaccount.lifetime3m")}</option>
											<option value="6m">{t("myaccount.lifetime6m")}</option>
											<option value="12m">{t("myaccount.lifetime12m")}</option>
											<option value="forever">
												{t("myaccount.lifetimeForever")}
											</option>
										</Select>
									</Box>
								)}
								{hasGeneratedKey && (
									<Box>
										<Text fontWeight="medium" mb={1}>
											{t("myaccount.yourApiKey")}
										</Text>
										<HStack>
											<Input value={generatedKey} isReadOnly />
											<IconButton
												aria-label={t("copy")}
												icon={<CopyIcon />}
												onClick={() => {
													setClipboardValue(generatedKey);
													onCopy();
													toast({
														title: t("copied"),
														status: "success",
														duration: 1200,
													});
												}}
											/>
										</HStack>
										<Text fontSize="xs" color="orange.500" mt={2}>
											{t("myaccount.apiKeyWarning")}
										</Text>
									</Box>
								)}
							</VStack>
						</ModalBody>
						<ModalFooter>
							{hasGeneratedKey ? (
								<Button
									colorScheme="primary"
									onClick={() => {
										apiKeyModal.onClose();
										setGeneratedKey("");
									}}
								>
									{t("close")}
								</Button>
							) : (
								<>
									<Button
										variant="ghost"
										mr={3}
										onClick={() => {
											apiKeyModal.onClose();
											setGeneratedKey("");
										}}
									>
										{t("cancel")}
									</Button>
									<Button
										colorScheme="primary"
										isLoading={createKeyMutation.isLoading}
										onClick={() => createKeyMutation.mutate(selectedLifetime)}
										isDisabled={hasGeneratedKey}
									>
										{t("create")}
									</Button>
								</>
							)}
						</ModalFooter>
					</ModalContent>
				</Modal>
			)}

			<ChangePasswordModal
				isOpen={modal.isOpen}
				onClose={modal.onClose}
				onSubmit={handlePasswordChange}
			/>

			{selfPermissions.self_api_keys && (
				<Modal
					isOpen={deleteModal.isOpen}
					onClose={() => {
						deleteModal.onClose();
						setDeleteKeyId(null);
						setDeletePassword("");
						setShowDeletePassword(false);
					}}
					isCentered
				>
					<ModalOverlay />
					<ModalContent>
						<ModalHeader>{t("myaccount.deleteApiKey")}</ModalHeader>
						<ModalCloseButton />
						<ModalBody>
							<VStack spacing={3} align="stretch">
								<Text color={labelColor}>
									{t("myaccount.deleteApiKeyPrompt")}
								</Text>
								<InputGroup dir={isRTL ? "rtl" : "ltr"}>
									<Input
										placeholder={t("myaccount.currentPassword")}
										type={showDeletePassword ? "text" : "password"}
										value={deletePassword}
										onChange={(e) => setDeletePassword(e.target.value)}
										paddingInlineEnd="2.75rem"
									/>
									<InputRightElement
										insetInlineEnd="0.5rem"
										right="auto"
										left="auto"
									>
										<IconButton
											aria-label={
												showDeletePassword
													? t("admins.hidePassword")
													: t("admins.showPassword")
											}
											size="sm"
											variant="ghost"
											icon={
												showDeletePassword ? (
													<EyeSlashIcon width={16} />
												) : (
													<EyeIcon width={16} />
												)
											}
											onClick={() => setShowDeletePassword(!showDeletePassword)}
										/>
									</InputRightElement>
								</InputGroup>
								{deleteKeyMutation.isError && (
									<Text color="red.500" fontSize="sm">
										{t("myaccount.incorrectPassword")}
									</Text>
								)}
							</VStack>
						</ModalBody>
						<ModalFooter>
							<Button
								variant="ghost"
								mr={3}
								onClick={() => {
									deleteModal.onClose();
									setDeleteKeyId(null);
									setDeletePassword("");
									setShowDeletePassword(false);
								}}
							>
								{t("cancel")}
							</Button>
							<Button
								colorScheme="red"
								isLoading={deleteKeyMutation.isLoading}
								isDisabled={!deletePassword || deleteKeyId === null}
								onClick={() => {
									if (deleteKeyId !== null) {
										deleteKeyMutation.mutate({
											id: deleteKeyId,
											current_password: deletePassword,
										} as any);
									}
								}}
							>
								{t("delete")}
							</Button>
						</ModalFooter>
					</ModalContent>
				</Modal>
			)}
		</VStack>
	);
};

export default MyAccountPage;
