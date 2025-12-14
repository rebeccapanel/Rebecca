import {
	Box,
	Button,
	chakra,
	Flex,
	Grid,
	GridItem,
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
};

const StatsCard: React.FC<StatsCardProps> = ({ label, value }) => (
	<Stat
		p={4}
		borderWidth="1px"
		borderRadius="lg"
		bg="surface.light"
		_dark={{ bg: "surface.dark" }}
	>
		<StatLabel>{label}</StatLabel>
		<StatNumber fontSize="lg">{value}</StatNumber>
	</Stat>
);

const ChangePasswordModal: React.FC<{
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (current: string, next: string) => Promise<void>;
}> = ({ isOpen, onClose, onSubmit }) => {
	const { t } = useTranslation();
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
							<InputGroup>
								<Input
									placeholder={t("myaccount.currentPassword")}
									type={showCurrent ? "text" : "password"}
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
								/>
								<InputRightElement>
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
								<InputGroup>
									<Input
										placeholder={t("myaccount.newPassword")}
										type={showNew ? "text" : "password"}
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
									/>
									<InputRightElement>
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
	const { t } = useTranslation();
	const toast = useToast();
	const modal = useDisclosure();
	const apiKeyModal = useDisclosure();
	const queryClient = useQueryClient();
	const { colorMode } = useColorMode();
	const { userData } = useGetUser();
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

	const { data, isLoading, isFetching } = useQuery<MyAccountResponse>(
		["myaccount", range.start, range.end],
		() =>
			getMyAccount({
				start: `${dayjs(range.start).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
				end: `${dayjs(range.end).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
			}),
		{ keepPreviousData: true },
	);
	const username = userData?.username;
	const isFullAccess = userData?.role === AdminRole.FullAccess;
	const baseSelfPermissions = userData?.permissions?.self_permissions || {
		self_myaccount: true,
		self_change_password: true,
		self_api_keys: true,
	};
	const selfPermissions = isFullAccess
		? { self_myaccount: true, self_change_password: true, self_api_keys: true }
		: baseSelfPermissions;
	const { data: nodesData } = useQuery(
		["myaccount-nodes", username, range.start, range.end],
		() =>
			username
				? getAdminNodesUsage(username, {
						start: `${dayjs(range.start).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
						end: `${dayjs(range.end).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
					})
				: Promise.resolve({ usages: [] }),
		{ keepPreviousData: true, enabled: Boolean(username) },
	);
	const mutation = useMutation(changeMyAccountPassword, {
		onSuccess: () => {
			queryClient.invalidateQueries("myaccount");
		},
	});
	const apiKeysQuery = useQuery<AdminApiKey[]>(
		["myaccount-api-keys"],
		listApiKeys,
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
				name: t("myaccount.dailyUsage", "Daily usage"),
				data: dailyUsagePoints.map((p) => p.used_traffic),
			},
		],
		[dailyUsagePoints, t],
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

	if (isLoading || !data) {
		return (
			<Flex justify="center" align="center" py={10}>
				<Spinner />
			</Flex>
		);
	}

	if (!selfPermissions.self_myaccount) {
		return (
			<VStack spacing={3} align="start">
				<Text fontSize="lg" fontWeight="semibold">
					{t("myaccount.forbiddenTitle")}
				</Text>
				<Text color="gray.500" _dark={{ color: "gray.400" }}>
					{t("myaccount.forbiddenDescription")}
				</Text>
			</VStack>
		);
	}

	const used = data.used_traffic || 0;
	const totalData = data.data_limit ?? 0;
	const remainingData = data.remaining_data ?? Math.max(totalData - used, 0);
	const usersLimit = data.users_limit ?? 0;
	const remainingUsers = data.remaining_users ?? 0;

	return (
		<VStack spacing={4} align="stretch">
			<HStack justify="space-between" align="center">
				<Box>
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("myaccount.title")}
					</Text>
					<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
						{t("myaccount.subtitle")}
					</Text>
				</Box>
				{isFetching && (
					<HStack spacing={2}>
						<Spinner size="sm" />
						<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
							{t("loading")}
						</Text>
					</HStack>
				)}
			</HStack>

			<Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
				<GridItem>
					<Text fontWeight="semibold" mb={2}>
						{t("myaccount.dataUsage")}
					</Text>
					<SimpleGrid columns={{ base: 1, sm: 3 }} spacing={3}>
						<StatsCard
							label={t("myaccount.usedData")}
							value={formatBytes(used, 2)}
						/>
						<StatsCard
							label={t("myaccount.remainingData")}
							value={
								data.data_limit === null
									? t("myaccount.unlimited")
									: formatBytes(remainingData, 2)
							}
						/>
						<StatsCard
							label={t("myaccount.totalData")}
							value={
								data.data_limit === null
									? t("myaccount.unlimited")
									: formatBytes(totalData, 2)
							}
						/>
					</SimpleGrid>
				</GridItem>
				<GridItem>
					<Text fontWeight="semibold" mb={2}>
						{t("myaccount.userLimits")}
					</Text>
					<SimpleGrid columns={{ base: 1, sm: 3 }} spacing={3}>
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
				</GridItem>
			</Grid>

			<Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={4}>
				<GridItem>
					<ChartBox
						title={t("myaccount.dailyUsage")}
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
						<Text
							fontSize="sm"
							color="gray.500"
							_dark={{ color: "gray.400" }}
							mb={3}
						>
							{t("nodes.totalUsage", "Total usage")}:{" "}
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
							<Text color="gray.500" _dark={{ color: "gray.400" }}>
								{t("noData")}
							</Text>
						)}
					</ChartBox>
				</GridItem>
				<GridItem>
					<ChartBox title={t("myaccount.perNodeUsage")} minH="500px">
						<Text
							fontSize="sm"
							color="gray.500"
							_dark={{ color: "gray.400" }}
							mb={3}
						>
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
							<Text color="gray.500" _dark={{ color: "gray.400" }}>
								{t("noData")}
							</Text>
						)}
					</ChartBox>
				</GridItem>
			</Grid>

			<ChartBox
				title={t("myaccount.apiKeys")}
				headerActions={
					<Button size="sm" colorScheme="primary" onClick={apiKeyModal.onOpen}>
						{t("myaccount.createApiKey")}
					</Button>
				}
			>
				{selfPermissions.self_api_keys ? (
					apiKeysQuery.isLoading ? (
						<HStack>
							<Spinner size="sm" />
							<Text>{t("loading")}</Text>
						</HStack>
					) : (apiKeysQuery.data?.length ?? 0) === 0 ? (
						<Text color="gray.500" _dark={{ color: "gray.400" }}>
							{t("myaccount.noApiKeys")}
						</Text>
					) : (
						<Table size="sm">
							<Thead>
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
										<Td>{key.masked_key ?? "****"}</Td>
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
					)
				) : (
					<Text color="gray.500" _dark={{ color: "gray.400" }}>
						{t("myaccount.apiKeysForbidden")}
					</Text>
				)}
			</ChartBox>

			{selfPermissions.self_change_password && (
				<ChartBox title={t("myaccount.changePasswordCard")}>
					<Text
						fontSize="sm"
						color="gray.500"
						_dark={{ color: "gray.400" }}
						mb={3}
					>
						{t("myaccount.changePasswordHint")}
					</Text>
					<Box maxW="400px">
						<Button colorScheme="primary" onClick={modal.onOpen} w="auto">
							{t("myaccount.changePassword")}
						</Button>
					</Box>
				</ChartBox>
			)}

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

			<ChangePasswordModal
				isOpen={modal.isOpen}
				onClose={modal.onClose}
				onSubmit={handlePasswordChange}
			/>

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
							<Text color="gray.600" _dark={{ color: "gray.300" }}>
								{t("myaccount.deleteApiKeyPrompt")}
							</Text>
							<InputGroup>
								<Input
									placeholder={t("myaccount.currentPassword")}
									type={showDeletePassword ? "text" : "password"}
									value={deletePassword}
									onChange={(e) => setDeletePassword(e.target.value)}
								/>
								<InputRightElement>
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
		</VStack>
	);
};

export default MyAccountPage;
