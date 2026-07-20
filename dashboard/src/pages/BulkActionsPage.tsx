import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Checkbox,
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
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fetch } from "service/http";
import { AdminRole, UserPermissionToggle } from "types/Admin";
import type { DataLimitResetStrategy, UserCreateWithService } from "types/User";
import { isUserManagementLocked } from "utils/adminTraffic";

type BulkTab = "create" | "edit" | "delete";
type UsernameMode = "sequence" | "list";
type BatchResult = {
	username: string;
	ok: boolean;
	detail: string;
};

const MAX_BATCH_SIZE = 500;
const USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,32}$/;

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
						{t("bulkActions.results.title", "Operation results")}
					</Text>
					<Text color="panel.textSecondary" fontSize="sm">
						{t("bulkActions.results.summary", {
							success: succeeded,
							failed: results.length - succeeded,
							defaultValue: "{{success}} completed, {{failed}} failed",
						})}
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
			title: t("bulkActions.create.completed", "Bulk creation completed"),
			description: t("bulkActions.results.summary", {
				success: succeeded,
				failed: batchResults.length - succeeded,
				defaultValue: "{{success}} completed, {{failed}} failed",
			}),
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
							{t("bulkActions.create.usernames", "Usernames")}
						</Text>
						<Text color="panel.textSecondary" fontSize="sm" mt={1}>
							{t(
								"bulkActions.create.usernamesHelp",
								"Generate a numbered sequence or enter exact usernames. Duplicates are removed before submission.",
							)}
						</Text>
					</Box>
					<PageTabs
						px={0}
						tabs={[
							{
								value: "sequence",
								label: t("bulkActions.create.sequence", "Numbered sequence"),
								isActive: mode === "sequence",
								onClick: () => setMode("sequence"),
							},
							{
								value: "list",
								label: t("bulkActions.create.list", "Username list"),
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
										{t("bulkActions.create.prefix", "Prefix")}
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
										{t("bulkActions.create.suffix", "Suffix")}
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
										{t("bulkActions.create.start", "Starts at")}
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
										{t("bulkActions.create.count", "Count")}
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
										{t("bulkActions.create.padding", "Number width")}
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
								{t("bulkActions.create.listLabel", "Usernames")}
							</FormLabel>
							<Textarea
								value={list}
								onChange={(event) => setList(event.target.value)}
								placeholder={t(
									"bulkActions.create.listPlaceholder",
									"alice\nbob\ncustomer-003",
								)}
								rows={7}
								fontFamily="mono"
							/>
							<FormHelperText>
								{t(
									"bulkActions.create.listHelp",
									"Use one username per line or separate names with commas. Maximum 500 users per run.",
								)}
							</FormHelperText>
						</FormControl>
					)}
				</Stack>
			</Surface>

			<Surface>
				<Stack spacing={4}>
					<Box>
						<Text fontWeight="semibold">
							{t("bulkActions.create.defaults", "Shared user settings")}
						</Text>
						<Text color="panel.textSecondary" fontSize="sm" mt={1}>
							{t(
								"bulkActions.create.defaultsHelp",
								"These values are applied to every username in this run.",
							)}
						</Text>
					</Box>
					<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
						<FormControl isRequired>
							<FormLabel>
								{t("bulkActions.create.service", "Service")}
							</FormLabel>
							<Select
								value={serviceID}
								onChange={(event) => setServiceID(event.target.value)}
								isDisabled={isOptionsLoading}
							>
								<option value="">
									{t("bulkActions.create.selectService", "Select a service")}
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
								{t("bulkActions.create.status", "Initial status")}
							</FormLabel>
							<Select
								value={status}
								onChange={(event) =>
									setStatus(event.target.value as "active" | "on_hold")
								}
							>
								<option value="active">{t("active", "Active")}</option>
								<option value="on_hold">{t("onHold", "On hold")}</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.dataLimit", "Data limit")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								step="0.1"
								value={dataLimit}
								onChange={(event) => setDataLimit(event.target.value)}
							/>
							<FormHelperText>
								{t("bulkActions.create.gbZero", "GB; use 0 for unlimited")}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.validity", "Validity")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={validityDays}
								onChange={(event) => setValidityDays(event.target.value)}
							/>
							<FormHelperText>
								{status === "on_hold"
									? t(
											"bulkActions.create.onHoldDays",
											"Days after first connection",
										)
									: t(
											"bulkActions.create.daysZero",
											"Days from now; use 0 for unlimited",
										)}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.ipLimit", "IP limit")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={ipLimit}
								onChange={(event) => setIPLimit(event.target.value)}
							/>
							<FormHelperText>
								{t("bulkActions.create.zeroUnlimited", "Use 0 for unlimited")}
							</FormHelperText>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.reset", "Traffic reset")}
							</FormLabel>
							<Select
								value={resetStrategy}
								onChange={(event) =>
									setResetStrategy(event.target.value as DataLimitResetStrategy)
								}
								isDisabled={Number(dataLimit) <= 0}
							>
								<option value="no_reset">{t("noReset", "No reset")}</option>
								<option value="day">{t("daily", "Daily")}</option>
								<option value="week">{t("weekly", "Weekly")}</option>
								<option value="month">{t("monthly", "Monthly")}</option>
								<option value="year">{t("yearly", "Yearly")}</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("bulkActions.create.autoDelete", "Auto-delete after")}
							</FormLabel>
							<Input
								type="number"
								min={0}
								value={autoDeleteDays}
								onChange={(event) => setAutoDeleteDays(event.target.value)}
							/>
							<FormHelperText>
								{t(
									"bulkActions.create.autoDeleteHelp",
									"Days after expiry or limitation; use 0 to disable",
								)}
							</FormHelperText>
						</FormControl>
					</SimpleGrid>
					<FormControl>
						<FormLabel>
							{t("bulkActions.create.note", "Note template")}
						</FormLabel>
						<Input
							value={note}
							onChange={(event) => setNote(event.target.value)}
							placeholder={t(
								"bulkActions.create.notePlaceholder",
								"Batch {username}",
							)}
						/>
						<FormHelperText>
							{t(
								"bulkActions.create.noteHelp",
								"Use {username} to insert each generated username.",
							)}
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
							{t("bulkActions.preview", "Preview")} ({usernames.length})
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
								{t("bulkActions.invalidUsernames", {
									count: invalidNames.length,
									defaultValue: "{{count}} usernames are invalid.",
								})}
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
						{t("bulkActions.create.submit", {
							count: usernames.length,
							defaultValue: "Create {{count}} users",
						})}
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
	const { refetchUsers } = useDashboard();
	const [list, setList] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [results, setResults] = useState<BatchResult[]>([]);
	const usernames = useMemo(() => parseUsernameList(list), [list]);
	const invalidNames = usernames.filter(
		(username) => !USERNAME_PATTERN.test(username),
	);

	const handleDelete = async () => {
		if (!confirmed || !usernames.length || invalidNames.length) return;
		setIsRunning(true);
		setResults([]);
		const batchResults = await runLimited(usernames, async (username) => {
			await fetch(`/user/${encodeURIComponent(username)}`, {
				method: "DELETE",
			});
		});
		setResults(batchResults);
		setIsRunning(false);
		setConfirmed(false);
		void refetchUsers(true);
		const succeeded = batchResults.filter((result) => result.ok).length;
		toast({
			title: t("bulkActions.delete.completed", "Bulk deletion completed"),
			description: t("bulkActions.results.summary", {
				success: succeeded,
				failed: batchResults.length - succeeded,
				defaultValue: "{{success}} completed, {{failed}} failed",
			}),
			status: succeeded === batchResults.length ? "success" : "warning",
			isClosable: true,
		});
	};

	return (
		<VStack spacing={4} align="stretch" maxW="860px">
			<Alert status="error" variant="subtle" borderRadius="8px">
				<AlertIcon />
				{t(
					"bulkActions.delete.warning",
					"Deleted users cannot be restored. Only the exact usernames entered below are affected.",
				)}
			</Alert>
			<Surface>
				<Stack spacing={4}>
					<FormControl>
						<FormLabel>
							{t("bulkActions.delete.usernames", "Usernames to delete")}
						</FormLabel>
						<Textarea
							value={list}
							onChange={(event) => {
								setList(event.target.value);
								setConfirmed(false);
							}}
							rows={10}
							fontFamily="mono"
							placeholder={t(
								"bulkActions.create.listPlaceholder",
								"alice\nbob\ncustomer-003",
							)}
						/>
						<FormHelperText>
							{t(
								"bulkActions.create.listHelp",
								"Use one username per line or separate names with commas. Maximum 500 users per run.",
							)}
						</FormHelperText>
					</FormControl>
					{invalidNames.length > 0 && (
						<Text color="red.400" fontSize="sm">
							{t("bulkActions.invalidUsernames", {
								count: invalidNames.length,
								defaultValue: "{{count}} usernames are invalid.",
							})}
						</Text>
					)}
					<Checkbox
						isChecked={confirmed}
						onChange={(event) => setConfirmed(event.target.checked)}
					>
						{t("bulkActions.delete.confirm", {
							count: usernames.length,
							defaultValue:
								"I understand that {{count}} users will be deleted.",
						})}
					</Checkbox>
					<Button
						alignSelf="flex-start"
						colorScheme="red"
						leftIcon={<TrashIcon width={18} />}
						isLoading={isRunning}
						isDisabled={
							!confirmed || !usernames.length || invalidNames.length > 0
						}
						onClick={handleDelete}
					>
						{t("bulkActions.delete.submit", {
							count: usernames.length,
							defaultValue: "Delete {{count}} users",
						})}
					</Button>
				</Stack>
			</Surface>
			<Results results={results} />
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
	const locked = isUserManagementLocked(userData);
	const allowedTabs = useMemo(
		() =>
			[
				(privileged || permissions?.[UserPermissionToggle.Create]) && "create",
				(privileged || permissions?.[UserPermissionToggle.AdvancedActions]) &&
					"edit",
				(privileged || permissions?.[UserPermissionToggle.Delete]) && "delete",
			].filter(Boolean) as BulkTab[],
		[permissions, privileged],
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
				title={t("bulkActions.title", "Bulk Actions")}
				description={t(
					"bulkActions.subtitle",
					"Create, update, or delete multiple users in one controlled run.",
				)}
			/>
			{allowedTabs.length > 0 && (
				<PageTabs
					tabs={allowedTabs.map((tab) => ({
						value: tab,
						label: t(`bulkActions.tabs.${tab}`, tab),
						isActive: activeTab === tab,
						onClick: () => setTab(tab),
					}))}
				/>
			)}
			{locked ? (
				<Alert status="warning" borderRadius="8px">
					<AlertIcon />
					{t(
						"bulkActions.locked",
						"User management is currently unavailable for this account.",
					)}
				</Alert>
			) : activeTab === "create" ? (
				<BulkCreatePanel />
			) : activeTab === "edit" ? (
				<Box maxW="1080px">
					<AdvancedUserActions embedded />
				</Box>
			) : activeTab === "delete" ? (
				<BulkDeletePanel />
			) : (
				<Alert status="info" borderRadius="8px">
					<AlertIcon />
					{t(
						"bulkActions.noPermission",
						"You do not have permission to use bulk actions.",
					)}
				</Alert>
			)}
		</VStack>
	);
};

export default BulkActionsPage;
