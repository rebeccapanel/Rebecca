import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	Code,
	FormControl,
	FormHelperText,
	FormLabel,
	Grid,
	GridItem,
	HStack,
	Input,
	SimpleGrid,
	Stack,
	Text,
	Textarea,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	CheckCircleIcon,
	ExclamationCircleIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import AdvancedUserActions from "components/AdvancedUserActions";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { PageHeader, PageTabs } from "components/ui";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fetch } from "service/http";
import {
	AdminManagementPermission,
	AdminRole,
	UserPermissionToggle,
} from "types/Admin";
import type {
	AdvancedUserActionPayload,
	AdvancedUserActionScopeStatus,
	DataLimitResetStrategy,
	UserCreateWithService,
} from "types/User";
import { isUserManagementLocked } from "utils/adminTraffic";

type BulkTab = "create" | "edit" | "delete" | "permissions";
type UsernameMode = "sequence" | "list";
type DeleteMode = "list" | "conditions";
type DeleteCondition = "last_online" | "status_age" | "created_before";
type BatchResult = {
	username: string;
	ok: boolean;
	detail: string;
};

const MAX_BATCH_SIZE = 500;
const USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,32}$/;
const deleteConditionOptions: DeleteCondition[] = [
	"last_online",
	"status_age",
	"created_before",
];
const deleteStatusOptions: AdvancedUserActionScopeStatus[] = [
	"active",
	"on_hold",
	"limited",
	"expired",
	"disabled",
];

const parseUsernameList = (value: string) =>
	Array.from(
		new Set(
			value
				.split(/[\n,]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	).slice(0, MAX_BATCH_SIZE);

const errorDetail = (error: unknown) => {
	if (!error || typeof error !== "object")
		return String(error || "Unknown error");
	const record = error as {
		data?: { detail?: string };
		response?: { _data?: { detail?: string } };
		message?: string;
	};
	return (
		record.data?.detail ||
		record.response?._data?.detail ||
		record.message ||
		"Unknown error"
	);
};

const runLimited = async (
	usernames: string[],
	worker: (username: string) => Promise<void>,
) => {
	const results = new Array<BatchResult>(usernames.length);
	let cursor = 0;
	const runner = async () => {
		while (cursor < usernames.length) {
			const index = cursor++;
			const username = usernames[index];
			try {
				await worker(username);
				results[index] = { username, ok: true, detail: "Completed" };
			} catch (error) {
				results[index] = { username, ok: false, detail: errorDetail(error) };
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(4, usernames.length) }, () => runner()),
	);
	return results;
};

const Surface = ({ children }: { children: React.ReactNode }) => (
	<Box
		borderWidth="1px"
		borderColor="panel.border"
		borderRadius="8px"
		bg="panel.surface"
		p={{ base: 4, md: 5 }}
	>
		{children}
	</Box>
);

const Results = ({ results }: { results: BatchResult[] }) => {
	const { t } = useTranslation();
	if (!results.length) return null;
	const succeeded = results.filter((result) => result.ok).length;
	return (
		<Surface>
			<HStack justify="space-between" align="flex-start" mb={3}>
				<Box>
					<Text fontWeight="semibold">
						{t("bulkActions.results.title")}
					</Text>
					<Text color="panel.textSecondary" fontSize="sm">
						{t("bulkActions.results.summary", { success: succeeded, failed: results.length - succeeded })}
					</Text>
				</Box>
				<Badge colorScheme={succeeded === results.length ? "green" : "orange"}>
					{succeeded}/{results.length}
				</Badge>
			</HStack>
			<Stack spacing={0} borderTopWidth="1px" borderColor="panel.border">
				{results.map((result) => (
					<HStack
						key={result.username}
						justify="space-between"
						align="flex-start"
						gap={4}
						py={2.5}
						borderBottomWidth="1px"
						borderColor="panel.border"
					>
						<HStack minW={0}>
							<Box color={result.ok ? "green.400" : "red.400"} flexShrink={0}>
								{result.ok ? (
									<CheckCircleIcon width={18} />
								) : (
									<ExclamationCircleIcon width={18} />
								)}
							</Box>
							<Code bg="transparent" color="inherit" noOfLines={1}>
								{result.username}
							</Code>
						</HStack>
						<Text
							fontSize="sm"
							color={result.ok ? "panel.textSecondary" : "red.400"}
							textAlign="end"
						>
							{result.detail}
						</Text>
					</HStack>
				))}
			</Stack>
		</Surface>
	);
};

const BulkCreatePanel = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { refetchUsers } = useDashboard();
	const { serviceOptions, fetchServiceOptions, isOptionsLoading } =
		useServicesStore();
	const [mode, setMode] = useState<UsernameMode>("sequence");
	const [prefix, setPrefix] = useState("user");
	const [suffix, setSuffix] = useState("");
	const [start, setStart] = useState("1");
	const [count, setCount] = useState("10");
	const [padding, setPadding] = useState("3");
	const [list, setList] = useState("");
	const [serviceID, setServiceID] = useState("");
	const [status, setStatus] = useState<"active" | "on_hold">("active");
	const [dataLimit, setDataLimit] = useState("0");
	const [validityDays, setValidityDays] = useState("30");
	const [ipLimit, setIPLimit] = useState("0");
	const [autoDeleteDays, setAutoDeleteDays] = useState("0");
	const [resetStrategy, setResetStrategy] =
		useState<DataLimitResetStrategy>("no_reset");
	const [note, setNote] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [results, setResults] = useState<BatchResult[]>([]);

	useEffect(() => {
		if (!serviceOptions.length) void fetchServiceOptions({ limit: 1000 });
	}, [fetchServiceOptions, serviceOptions.length]);

	const usernames = useMemo(() => {
		if (mode === "list") return parseUsernameList(list);
		const parsedStart = Math.max(0, Math.floor(Number(start) || 0));
		const parsedCount = Math.min(
			MAX_BATCH_SIZE,
			Math.max(0, Math.floor(Number(count) || 0)),
		);
		const parsedPadding = Math.min(
			8,
			Math.max(0, Math.floor(Number(padding) || 0)),
		);
		return Array.from({ length: parsedCount }, (_, index) => {
			const serial = String(parsedStart + index).padStart(parsedPadding, "0");
			return `${prefix}${serial}${suffix}`;
		});
	}, [count, list, mode, padding, prefix, start, suffix]);

	const invalidNames = usernames.filter(
		(username) => !USERNAME_PATTERN.test(username),
	);
	const canSubmit =
		usernames.length > 0 &&
		invalidNames.length === 0 &&
		Number(serviceID) > 0 &&
		(status !== "on_hold" || Number(validityDays) > 0);

	const handleCreate = async () => {
		if (!canSubmit) return;
		setIsRunning(true);
		setResults([]);
		const now = Math.floor(Date.now() / 1000);
		const days = Math.max(0, Number(validityDays) || 0);
		const limitBytes = Math.max(0, Number(dataLimit) || 0) * 1024 ** 3;
		const normalizedIPLimit = Math.max(0, Math.floor(Number(ipLimit) || 0));
		const normalizedAutoDelete = Math.max(
			0,
			Math.floor(Number(autoDeleteDays) || 0),
		);
		const batchResults = await runLimited(usernames, async (username) => {
			const body: UserCreateWithService = {
				username,
				service_id: Number(serviceID),
				status,
				expire: status === "active" && days > 0 ? now + days * 86400 : 0,
				data_limit: Math.round(limitBytes),
				ip_limit: normalizedIPLimit,
				data_limit_reset_strategy: limitBytes > 0 ? resetStrategy : "no_reset",
				on_hold_expire_duration:
					status === "on_hold" ? Math.round(days * 86400) : null,
				note: note.replaceAll("{username}", username),
				telegram_id: null,
				contact_number: null,
				flow: null,
				auto_delete_in_days:
					normalizedAutoDelete > 0 ? normalizedAutoDelete : null,
			};
			await fetch("/v2/users", { method: "POST", body });
		});
		setResults(batchResults);
		setIsRunning(false);
		void refetchUsers(true);
		const succeeded = batchResults.filter((result) => result.ok).length;
		toast({
			title: t("bulkActions.create.completed"),
			description: t("bulkActions.results.summary", { success: succeeded, failed: batchResults.length - succeeded }),
			status: succeeded === batchResults.length ? "success" : "warning",
			isClosable: true,
		});
	};

	return (
		<VStack spacing={4} align="stretch" maxW="1080px">
			<Surface>
				<Stack spacing={5}>
					<Box>
						<Text fontWeight="semibold">
							{t("bulkActions.create.usernames")}
						</Text>
						<Text color="panel.textSecondary" fontSize="sm" mt={1}>
							{t("bulkActions.create.usernamesHelp")}
						</Text>
					</Box>
					<PageTabs
						px={0}
						tabs={[
							{
								value: "sequence",
								label: t("bulkActions.create.sequence"),
								isActive: mode === "sequence",
								onClick: () => setMode("sequence"),
							},
							{
								value: "list",
								label: t("bulkActions.create.list"),
								isActive: mode === "list",
								onClick: () => setMode("list"),
							},
						]}
					/>
					{mode === "sequence" ? (
						<Grid
							templateColumns={{ base: "1fr", md: "repeat(6, 1fr)" }}
							gap={3}
						>
							<GridItem colSpan={{ base: 1, md: 2 }}>
								<FormControl>
									<FormLabel>
										{t("bulkActions.create.prefix")}
									</FormLabel>
									<Input
										value={prefix}
										onChange={(event) => setPrefix(event.target.value)}
									/>
								</FormControl>
							</GridItem>
							<GridItem colSpan={{ base: 1, md: 2 }}>
								<FormControl>
									<FormLabel>
										{t("bulkActions.create.suffix")}
									</FormLabel>
									<Input
										value={suffix}
										onChange={(event) => setSuffix(event.target.value)}
									/>
								</FormControl>
							</GridItem>
							<GridItem colSpan={{ base: 1, md: 2 }}>
								<FormControl>
									<FormLabel>
										{t("bulkActions.create.start")}
									</FormLabel>
									<Input
										type="number"
										min={0}
										value={start}
										onChange={(event) => setStart(event.target.value)}
									/>
								</FormControl>
							</GridItem>
							<GridItem colSpan={{ base: 1, md: 2 }}>
								<FormControl>
									<FormLabel>
										{t("bulkActions.create.count")}
									</FormLabel>
									<Input
										type="number"
										min={1}
										max={MAX_BATCH_SIZE}
										value={count}
										onChange={(event) => setCount(event.target.value)}
									/>
								</FormControl>
							</GridItem>
							<GridItem colSpan={{ base: 1, md: 2 }}>
								<FormControl>
									<FormLabel>
										{t("bulkActions.create.padding")}
									</FormLabel>
									<Input
										type="number"
										min={0}
										max={8}
										value={padding}
										onChange={(event) => setPadding(event.target.value)}
									/>
								</FormControl>
							</GridItem>
						</Grid>
					) : (
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.listLabel")}
							</FormLabel>
							<Textarea
								value={list}
								onChange={(event) => setList(event.target.value)}
								placeholder={t("bulkActions.create.listPlaceholder")}
								rows={7}
								fontFamily="mono"
							/>
							<FormHelperText>
								{t("bulkActions.create.listHelp")}
							</FormHelperText>
						</FormControl>
					)}
				</Stack>
			</Surface>

			<Surface>
				<Stack spacing={4}>
					<Box>
						<Text fontWeight="semibold">
							{t("bulkActions.create.defaults")}
						</Text>
						<Text color="panel.textSecondary" fontSize="sm" mt={1}>
							{t("bulkActions.create.defaultsHelp")}
						</Text>
					</Box>
					<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
						<FormControl isRequired>
							<FormLabel>
								{t("bulkActions.create.service")}
							</FormLabel>
							<Select
								value={serviceID}
								onChange={(event) => setServiceID(event.target.value)}
								isDisabled={isOptionsLoading}
							>
								<option value="">
									{t("bulkActions.create.selectService")}
								</option>
								{serviceOptions
									.filter((service) => service.has_hosts && !service.broken)
									.map((service) => (
										<option key={service.id} value={service.id}>
											{service.name}
										</option>
									))}
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.status")}
							</FormLabel>
							<Select
								value={status}
								onChange={(event) =>
									setStatus(event.target.value as "active" | "on_hold")
								}
							>
								<option value="active">{t("active")}</option>
								<option value="on_hold">{t("userDialog.onHoldActive")}</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.dataLimit")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								step="0.1"
								value={dataLimit}
								onChange={(event) => setDataLimit(event.target.value)}
							/>
							<FormHelperText>
								{t("bulkActions.create.gbZero")}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.validity")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={validityDays}
								onChange={(event) => setValidityDays(event.target.value)}
							/>
							<FormHelperText>
								{status === "on_hold"
									? t("bulkActions.create.onHoldDays")
									: t("bulkActions.create.daysZero")}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.ipLimit")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={ipLimit}
								onChange={(event) => setIPLimit(event.target.value)}
							/>
							<FormHelperText>
								{t("bulkActions.create.zeroUnlimited")}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.reset")}
							</FormLabel>
							<Select
								value={resetStrategy}
								onChange={(event) =>
									setResetStrategy(event.target.value as DataLimitResetStrategy)
								}
								isDisabled={Number(dataLimit) <= 0}
							>
								<option value="no_reset">{t("noReset")}</option>
								<option value="day">{t("userDialog.resetStrategyDaily")}</option>
								<option value="week">{t("userDialog.resetStrategyWeekly")}</option>
								<option value="month">{t("userDialog.resetStrategyMonthly")}</option>
								<option value="year">{t("yearly")}</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.autoDelete")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={autoDeleteDays}
								onChange={(event) => setAutoDeleteDays(event.target.value)}
							/>
							<FormHelperText>
								{t("bulkActions.create.autoDeleteHelp")}
							</FormHelperText>
						</FormControl>
					</SimpleGrid>
					<FormControl>
						<FormLabel>
							{t("bulkActions.create.note")}
						</FormLabel>
						<Input
							value={note}
							onChange={(event) => setNote(event.target.value)}
							placeholder={t("bulkActions.create.notePlaceholder")}
						/>
						<FormHelperText>
							{t("bulkActions.create.noteHelp")}
						</FormHelperText>
					</FormControl>
				</Stack>
			</Surface>

			<Surface>
				<HStack
					justify="space-between"
					align="flex-start"
					gap={4}
					flexWrap="wrap"
				>
					<Box minW={0}>
						<Text fontWeight="semibold">
							{t("bulkActions.preview")} ({usernames.length})
						</Text>
						<HStack mt={2} spacing={2} flexWrap="wrap">
							{usernames.slice(0, 12).map((username) => (
								<Code
									key={username}
									colorScheme={USERNAME_PATTERN.test(username) ? "gray" : "red"}
								>
									{username}
								</Code>
							))}
							{usernames.length > 12 && (
								<Text fontSize="sm" color="panel.textSecondary">
									+{usernames.length - 12}
								</Text>
							)}
						</HStack>
						{invalidNames.length > 0 && (
							<Text color="red.400" fontSize="sm" mt={2}>
								{t("bulkActions.invalidUsernames", { count: invalidNames.length })}
							</Text>
						)}
					</Box>
					<Button
						colorScheme="primary"
						leftIcon={<PlusIcon width={18} />}
						onClick={handleCreate}
						isLoading={isRunning}
						isDisabled={!canSubmit}
					>
						{t("bulkActions.create.submit", { count: usernames.length })}
					</Button>
				</HStack>
			</Surface>
			<Results results={results} />
		</VStack>
	);
};

const BulkDeletePanel = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { performBulkUserAction, refetchUsers } = useDashboard();
	const [list, setList] = useState("");
	const [mode, setMode] = useState<DeleteMode>("list");
	const [conditions, setConditions] = useState<DeleteCondition[]>([
		"status_age",
	]);
	const [lastOnlineDays, setLastOnlineDays] = useState("");
	const [statusAgeDays, setStatusAgeDays] = useState("");
	const [createdBeforeDays, setCreatedBeforeDays] = useState("");
	const [statuses, setStatuses] = useState<AdvancedUserActionScopeStatus[]>([
		"expired",
	]);
	const [previewCount, setPreviewCount] = useState<number | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const usernames = useMemo(() => parseUsernameList(list), [list]);
	const invalidNames = usernames.filter(
		(username) => !USERNAME_PATTERN.test(username),
	);

	const resetPreview = () => {
		setPreviewCount(null);
		setConfirmed(false);
	};

	const toggleCondition = (condition: DeleteCondition) => {
		setConditions((current) =>
			current.includes(condition)
				? current.filter((item) => item !== condition)
				: [...current, condition],
		);
		resetPreview();
	};

	const toggleStatus = (status: AdvancedUserActionScopeStatus) => {
		setStatuses((current) =>
			current.includes(status)
				? current.filter((item) => item !== status)
				: [...current, status],
		);
		resetPreview();
	};

	const buildPayload = (): AdvancedUserActionPayload | null => {
		if (mode === "list") {
			if (!usernames.length || invalidNames.length) return null;
			return { action: "delete_users", usernames };
		}
		if (!conditions.length) return null;
		const parseDays = (value: string) => Math.floor(Number(value));
		const payload: AdvancedUserActionPayload = { action: "delete_users" };
		if (conditions.includes("last_online")) {
			const value = parseDays(lastOnlineDays);
			if (!Number.isFinite(value) || value <= 0) return null;
			payload.last_online_days = value;
		}
		if (conditions.includes("status_age")) {
			const value = parseDays(statusAgeDays);
			if (!Number.isFinite(value) || value <= 0 || !statuses.length) return null;
			payload.status_age_days = value;
			payload.scope = statuses;
		}
		if (conditions.includes("created_before")) {
			const value = parseDays(createdBeforeDays);
			if (!Number.isFinite(value) || value <= 0) return null;
			payload.created_before_days = value;
		}
		return payload;
	};

	const payload = buildPayload();

	const handlePreview = async () => {
		if (!payload) return;
		setIsRunning(true);
		try {
			const result = await performBulkUserAction({ ...payload, dry_run: true });
			setPreviewCount(result.count);
			setConfirmed(false);
		} catch (error) {
			toast({
				title: t("bulkActions.delete.previewFailed"),
				description: errorDetail(error),
				status: "error",
				isClosable: true,
			});
		} finally {
			setIsRunning(false);
		}
	};

	const handleDelete = async () => {
		if (!confirmed || previewCount === null || !payload) return;
		setIsRunning(true);
		try {
			const result = await performBulkUserAction(payload);
			toast({
				title: t("bulkActions.delete.completed"),
				description: t("bulkActions.delete.completedDescription", { count: result.count }),
				status: "success",
				isClosable: true,
			});
			setPreviewCount(null);
			setConfirmed(false);
			void refetchUsers(true);
		} catch (error) {
			toast({
				title: t("bulkActions.delete.failed"),
				description: errorDetail(error),
				status: "error",
				isClosable: true,
			});
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<VStack spacing={4} align="stretch" maxW="860px">
			<Alert status="error" variant="subtle" borderRadius="8px">
				<AlertIcon />
				{t("bulkActions.delete.warning")}
			</Alert>
			<Surface>
				<Stack spacing={4}>
					<PageTabs
						px={0}
						tabs={[
							{
								value: "list",
								label: t("bulkActions.delete.byUsernames"),
								isActive: mode === "list",
								onClick: () => {
									setMode("list");
									resetPreview();
								},
							},
							{
								value: "conditions",
								label: t("bulkActions.delete.byConditions"),
								isActive: mode === "conditions",
								onClick: () => {
									setMode("conditions");
									resetPreview();
								},
							},
						]}
					/>
					{mode === "list" ? (
						<>
							<FormControl>
								<FormLabel>
									{t("bulkActions.delete.usernames")}
								</FormLabel>
								<Textarea
									value={list}
									onChange={(event) => {
										setList(event.target.value);
										resetPreview();
									}}
									rows={8}
									fontFamily="mono"
									placeholder={t("bulkActions.create.listPlaceholder")}
								/>
								<FormHelperText>
									{t("bulkActions.create.listHelp")}
								</FormHelperText>
							</FormControl>
							{invalidNames.length > 0 && (
								<Text color="red.400" fontSize="sm">
									{t("bulkActions.invalidUsernames", { count: invalidNames.length })}
								</Text>
							)}
						</>
					) : (
						<Stack spacing={4}>
							<Box>
								<Text fontWeight="semibold">
									{t("bulkActions.delete.conditionsTitle")}
								</Text>
								<Text color="panel.textSecondary" fontSize="sm" mt={1}>
									{t("bulkActions.delete.conditionsHelp")}
								</Text>
							</Box>
							{conditions.map((condition) => (
								<Box
									key={condition}
									borderWidth="1px"
									borderColor="panel.border"
									borderRadius="6px"
									p={3}
								>
									<Stack spacing={3}>
										<HStack justify="space-between">
											<Text fontWeight="medium">
												{condition === "last_online"
													? t("bulkActions.delete.lastOnline")
													: condition === "status_age"
														? t("bulkActions.delete.statusAge")
														: t("bulkActions.delete.createdBefore")}
											</Text>
											<Button
												size="xs"
												variant="ghost"
												leftIcon={<TrashIcon width={14} />}
												onClick={() => toggleCondition(condition)}
											>
												{t("remove")}
											</Button>
										</HStack>
										<FormControl>
											<FormLabel fontSize="sm">
												{condition === "last_online"
													? t("bulkActions.delete.lastOnlineLabel")
													: condition === "status_age"
														? t("bulkActions.delete.statusAgeLabel")
														: t("bulkActions.delete.createdBeforeLabel")}
											</FormLabel>
											<Input
												type="number"
												min={1}
												value={
													condition === "last_online"
														? lastOnlineDays
														: condition === "status_age"
															? statusAgeDays
															: createdBeforeDays
												}
												onChange={(event) => {
													if (condition === "last_online") setLastOnlineDays(event.target.value);
													else if (condition === "status_age") setStatusAgeDays(event.target.value);
													else setCreatedBeforeDays(event.target.value);
													resetPreview();
												}}
											/>
										</FormControl>
										{condition === "status_age" && (
											<Box>
												<Text fontSize="sm" fontWeight="medium" mb={2}>
													{t("bulkActions.delete.statuses")}
												</Text>
												<HStack spacing={3} flexWrap="wrap">
													{deleteStatusOptions.map((status) => (
														<Checkbox
															key={status}
															isChecked={statuses.includes(status)}
															onChange={() => toggleStatus(status)}
														>
															{t(`filters.advancedActions.scopeStatuses.${status}`, status)}
														</Checkbox>
													))}
												</HStack>
											</Box>
										)}
									</Stack>
								</Box>
							))}
							{conditions.length < deleteConditionOptions.length && (
								<Select
									value=""
									onChange={(event) => {
										const next = event.target.value as DeleteCondition;
										if (deleteConditionOptions.includes(next)) toggleCondition(next);
									}}
								>
									<option value="">
										{t("bulkActions.delete.addCondition")}
									</option>
									{deleteConditionOptions
										.filter((condition) => !conditions.includes(condition))
										.map((condition) => (
											<option key={condition} value={condition}>
												{condition === "last_online"
													? t("bulkActions.delete.lastOnline")
													: condition === "status_age"
														? t("bulkActions.delete.statusAge")
														: t("bulkActions.delete.createdBefore")}
											</option>
										))}
								</Select>
							)}
						</Stack>
					)}
					{previewCount !== null && (
						<Alert
							status={
								previewCount > MAX_BATCH_SIZE
									? "error"
									: previewCount > 0
										? "warning"
										: "info"
							}
							borderRadius="6px"
						>
							<AlertIcon />
							{previewCount > MAX_BATCH_SIZE
								? t("bulkActions.delete.tooMany", { count: previewCount, max: MAX_BATCH_SIZE })
								: t("bulkActions.delete.preview", { count: previewCount })}
						</Alert>
					)}
					<HStack spacing={3} flexWrap="wrap">
						<Button
							variant="outline"
							onClick={handlePreview}
							isLoading={isRunning}
							isDisabled={!payload}
						>
							{t("bulkActions.delete.previewAction")}
						</Button>
						{previewCount !== null &&
							previewCount > 0 &&
							previewCount <= MAX_BATCH_SIZE && (
							<Checkbox
								isChecked={confirmed}
								onChange={(event) => setConfirmed(event.target.checked)}
							>
								{t("bulkActions.delete.confirm", { count: previewCount })}
							</Checkbox>
						)}
					</HStack>
					<Button
						alignSelf="flex-start"
						colorScheme="red"
						leftIcon={<TrashIcon width={18} />}
						isLoading={isRunning}
						isDisabled={
							!confirmed ||
							previewCount === null ||
							previewCount === 0 ||
							previewCount > MAX_BATCH_SIZE ||
							!payload
						}
						onClick={handleDelete}
					>
						{t("bulkActions.delete.submit", { count: previewCount ?? 0 })}
					</Button>
				</Stack>
			</Surface>
		</VStack>
	);
};

const BulkPermissionsPanel = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const bulkUpdateStandardPermissions = useAdminsStore(
		(store) => store.bulkUpdateStandardPermissions,
	);
	const [permissions, setPermissions] = useState<UserPermissionToggle[]>([
		UserPermissionToggle.Create,
		UserPermissionToggle.Delete,
		UserPermissionToggle.ResetUsage,
		UserPermissionToggle.Revoke,
	]);
	const [isRunning, setIsRunning] = useState(false);
	const options = useMemo(
		() => [
			{ key: UserPermissionToggle.Create, label: t("admins.bulkPermissions.create") },
			{ key: UserPermissionToggle.Delete, label: t("admins.bulkPermissions.delete") },
			{ key: UserPermissionToggle.ResetUsage, label: t("admins.bulkPermissions.resetUsage") },
			{ key: UserPermissionToggle.Revoke, label: t("admins.bulkPermissions.revoke") },
			{ key: UserPermissionToggle.CreateOnHold, label: t("admins.bulkPermissions.createOnHold") },
			{ key: UserPermissionToggle.AllowUnlimitedData, label: t("admins.bulkPermissions.allowUnlimitedData") },
			{ key: UserPermissionToggle.AllowUnlimitedExpire, label: t("admins.bulkPermissions.allowUnlimitedExpire") },
			{ key: UserPermissionToggle.AllowNextPlan, label: t("admins.bulkPermissions.allowNextPlan") },
			{ key: UserPermissionToggle.AdvancedActions, label: t("admins.bulkPermissions.advancedActions") },
			{ key: UserPermissionToggle.SetFlow, label: t("admins.bulkPermissions.setFlow") },
			{ key: UserPermissionToggle.AllowCustomKey, label: t("admins.bulkPermissions.allowCustomKey") },
		],
		[t],
	);

	const apply = async (mode: "disable" | "restore") => {
		if (!permissions.length) return;
		setIsRunning(true);
		try {
			const result = await bulkUpdateStandardPermissions({ mode, permissions });
			toast({
				title: t("admins.bulkPermissions.success"),
				description: t("admins.bulkPermissions.successDescription", { count: result.updated ?? 0 }),
				status: "success",
				isClosable: true,
			});
		} catch (error) {
			toast({
				title: t("admins.bulkPermissions.error"),
				description: errorDetail(error),
				status: "error",
				isClosable: true,
			});
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<VStack spacing={4} align="stretch" maxW="1080px">
			<Alert status="warning" borderRadius="8px">
				<AlertIcon />
				{t("admins.bulkPermissions.subtitle")}
			</Alert>
			<Surface>
				<Stack spacing={5}>
					<Box>
						<Text fontWeight="semibold">
							{t("admins.bulkPermissions.title")}
						</Text>
						<Text color="panel.textSecondary" fontSize="sm" mt={1}>
							{t("admins.bulkPermissions.help")}
						</Text>
					</Box>
					<CheckboxGroup
						value={permissions}
						onChange={(values) => setPermissions(values as UserPermissionToggle[])}
					>
						<SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={3}>
							{options.map((option) => (
								<Checkbox key={option.key} value={option.key}>
									{option.label}
								</Checkbox>
							))}
						</SimpleGrid>
					</CheckboxGroup>
					<HStack spacing={3} flexWrap="wrap">
						<Button
							colorScheme="red"
							onClick={() => apply("disable")}
							isLoading={isRunning}
							isDisabled={!permissions.length}
						>
							{t("admins.bulkPermissions.disable")}
						</Button>
						<Button
							variant="outline"
							onClick={() => apply("restore")}
							isLoading={isRunning}
							isDisabled={!permissions.length}
						>
							{t("admins.bulkPermissions.restore")}
						</Button>
					</HStack>
				</Stack>
			</Surface>
		</VStack>
	);
};

export const BulkActionsPage = () => {
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const { userData } = useGetUser();
	const permissions = userData.permissions?.users;
	const privileged = userData.role === AdminRole.FullAccess;
	const canEditAdmins = Boolean(
		userData.permissions?.admin_management?.[AdminManagementPermission.Edit] ||
			privileged,
	);
	const locked = isUserManagementLocked(userData);
	const allowedTabs = useMemo(
		() =>
			[
				(privileged || permissions?.[UserPermissionToggle.Create]) && "create",
				(privileged || permissions?.[UserPermissionToggle.AdvancedActions]) &&
					"edit",
				(privileged || permissions?.[UserPermissionToggle.Delete]) && "delete",
				canEditAdmins && "permissions",
			].filter(Boolean) as BulkTab[],
		[canEditAdmins, permissions, privileged],
	);
	const hashTab = location.hash.replace(/^#/, "") as BulkTab;
	const activeTab = allowedTabs.includes(hashTab) ? hashTab : allowedTabs[0];

	useEffect(() => {
		if (activeTab && location.hash !== `#${activeTab}`) {
			navigate({ hash: activeTab }, { replace: true });
		}
	}, [activeTab, location.hash, navigate]);

	const setTab = (tab: BulkTab) => navigate({ hash: tab });

	return (
		<VStack spacing={4} align="stretch" dir={i18n.dir(i18n.language)}>
			<PageHeader
				title={t("bulkActions.title")}
				description={t("bulkActions.subtitle")}
			/>
			{allowedTabs.length > 0 && (
				<PageTabs
						tabs={allowedTabs.map((tab) => ({
							value: tab,
							label: t(
								`bulkActions.tabs.${tab}`,
								tab === "permissions" ? "Admin permissions" : tab,
							),
						isActive: activeTab === tab,
						onClick: () => setTab(tab),
					}))}
				/>
			)}
			{locked && activeTab !== "permissions" ? (
				<Alert status="warning" borderRadius="8px">
					<AlertIcon />
					{t("bulkActions.locked")}
				</Alert>
			) : activeTab === "create" ? (
				<BulkCreatePanel />
			) : activeTab === "edit" ? (
				<Box maxW="1080px">
					<AdvancedUserActions embedded />
				</Box>
			) : activeTab === "delete" ? (
				<BulkDeletePanel />
			) : activeTab === "permissions" ? (
				<BulkPermissionsPanel />
			) : (
				<Alert status="info" borderRadius="8px">
					<AlertIcon />
					{t("bulkActions.noPermission")}
				</Alert>
			)}
		</VStack>
	);
};

export default BulkActionsPage;
