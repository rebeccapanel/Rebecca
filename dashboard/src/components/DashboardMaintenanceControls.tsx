import {
	Alert,
	AlertIcon,
	Box,
	Button,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	IconButton,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Popover,
	PopoverBody,
	PopoverCloseButton,
	PopoverContent,
	PopoverHeader,
	PopoverTrigger,
	Portal,
	Progress,
	SimpleGrid,
	Spinner,
	Stack,
	Text,
	Tooltip,
	useColorModeValue,
	useToast,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ArrowsRightLeftIcon,
	ArrowUpTrayIcon,
	CheckIcon,
	ClipboardIcon,
	CommandLineIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "react-query";
import { fetch } from "service/http";
import { AdminRole } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { getAPIWebSocketURL } from "utils/websocket";
import { type BuildCatalog, BuildVersionSelect } from "./BuildVersionSelect";
import { PanelSelect as Select } from "./common/PanelSelect";
import { DashboardBackupControls } from "./RebeccaBackupPanel";

type UpdateChannel = "current" | "latest" | "dev";
type MaintenanceAction = "update" | "restart" | "soft-reload";

type MaintenanceOperation = {
	id?: string;
	action?: string;
	phase?: string;
	message?: string;
	progress?: number | null;
	running?: boolean;
	restarting?: boolean;
	needs_reload?: boolean;
	error?: string;
	logs?: string[];
};

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

const shouldWaitForPanelReturn = (operation?: MaintenanceOperation | null) =>
	Boolean(
		operation?.restarting ||
			operation?.needs_reload ||
			operation?.phase === "restarting",
	);

const createRegex = (pattern: string) => new RegExp(pattern, "g");
const ansiEscapePattern = createRegex(
	"(?:\\u001b|\\x1b)\\[[0-9;]*[a-zA-Z]|\\[(?:\\d{1,3}(?:;\\d{1,3})*)?m|\\x08|\\x0d",
);

const isCurlNoise = (line: string): boolean => {
	const trimmed = line.trim();
	if (!trimmed) return false;
	if (
		trimmed.includes("% Total") ||
		trimmed.includes("Dload Upload") ||
		trimmed.includes("Dload  Upload")
	)
		return true;
	if (trimmed.includes("--:--:--")) return true;
	if (/^\d+\s+[\d.]+[kMGT]?\s+\d+\s+[\d.]+[kMGT]?\s+/.test(trimmed)) return true;
	return false;
};

const cleanTerminalOutput = (logs?: string[]): string => {
	if (!logs || logs.length === 0) return "";
	const lines = logs.join("\n").split("\n");
	const cleaned: string[] = [];
	for (const rawLine of lines) {
		const line = rawLine.replace(ansiEscapePattern, "").trimEnd();
		if (isCurlNoise(line)) continue;
		if (
			!line.trim() &&
			cleaned.length > 0 &&
			!cleaned[cleaned.length - 1].trim()
		)
			continue;
		cleaned.push(line);
	}
	return cleaned.join("\n").trim();
};

const formatTerminalLine = (line: string, index: number) => {
	const trimmed = line.trim();
	let color = "panel.text";
	let fontWeight = "400";
	if (
		trimmed.startsWith("rebecca ") ||
		trimmed.startsWith("$ ") ||
		trimmed.startsWith("> ")
	) {
		color = "var(--rb-panel-accent)";
		fontWeight = "600";
	} else if (
		trimmed.includes("successfully") ||
		trimmed.includes("installed successfully") ||
		trimmed.includes("updated successfully")
	) {
		color = "#22c55e";
		fontWeight = "600";
	} else if (
		trimmed.includes("Warning") ||
		trimmed.includes("warning") ||
		trimmed.includes("No bundled")
	) {
		color = "#f59e0b";
	} else if (
		trimmed.includes("error") ||
		trimmed.includes("Error") ||
		trimmed.includes("failed")
	) {
		color = "#ef4444";
		fontWeight = "600";
	} else if (
		trimmed.startsWith("Updating ") ||
		trimmed.startsWith("Restarting ")
	) {
		color = "#38bdf8";
	}
	return (
		<Text
			as="span"
			key={`${index}-${line.slice(0, 16)}`}
			display="block"
			color={color}
			fontWeight={fontWeight}
		>
			{line}
		</Text>
	);
};

export const DashboardMaintenanceControls = ({
	channel,
	version,
}: {
	channel?: string;
	version: string;
}) => {
	const { t } = useTranslation();
	const toast = useToast();
	const { userData, getUserIsSuccess } = useGetUser();
	const canMaintain =
		getUserIsSuccess &&
		(userData.role === AdminRole.FullAccess ||
			(userData.role === AdminRole.Sudo &&
				Boolean(userData.permissions?.sudo.maintenance)));
	const canBackUp =
		getUserIsSuccess &&
		(userData.role === AdminRole.FullAccess ||
			(userData.role === AdminRole.Sudo &&
				Boolean(userData.permissions?.sudo.backups)));
	const outputBg = useColorModeValue("gray.50", "blackAlpha.400");
	const outputBorder = useColorModeValue("gray.200", "whiteAlpha.200");
	const cardHighlight = useColorModeValue(
		"0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
		"inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
	);
	const [selectedChannel, setSelectedChannel] =
		useState<UpdateChannel>("current");
	const [selectedVersion, setSelectedVersion] = useState("");
	const [operation, setOperation] = useState<MaintenanceOperation | null>(null);
	const [waitingForAPI, setWaitingForAPI] = useState(false);
	const [isUpdateDialogOpen, setUpdateDialogOpen] = useState(false);
	const [isMobileMaintenanceOpen, setIsMobileMaintenanceOpen] = useState(false);
	const [confirmAction, setConfirmAction] = useState<
		"restart" | "soft-reload" | "update" | null
	>(null);
	const [logsCopied, setLogsCopied] = useState(false);
	const logsContainerRef = useRef<HTMLDivElement | null>(null);
	const panelReturnPollRef = useRef<number | null>(null);
	const panelReturnSawOfflineRef = useRef(false);
	const devUpdateTimerRef = useRef<number | null>(null);

	const info = useQuery<MaintenanceInfo>(
		["dashboard-maintenance-info"],
		() => fetch<MaintenanceInfo>("/maintenance/info", { timeout: 8000 }),
		{
			enabled: canMaintain || canBackUp,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
			retry: false,
		},
	);
	const panel = info.data?.panel;
	const update = panel?.update;
	const installMode = panel?.mode || panel?.install_mode;
	const hostActionsAvailable = installMode === "binary";
	const builds = useQuery<BuildCatalog>(
		["maintenance-builds", "panel"],
		() =>
			fetch<BuildCatalog>("/maintenance/builds?target=panel", {
				timeout: 12000,
			}),
		{
			enabled: canMaintain && hostActionsAvailable,
			refetchOnWindowFocus: false,
			staleTime: 10 * 60 * 1000,
			retry: false,
		},
	);
	const fallbackVersion = channel?.toLowerCase() === "dev" ? "dev" : version;
	const currentVersion =
		panel?.tag || update?.current || fallbackVersion || "-";
	const selectedTarget =
		selectedVersion ||
		(selectedChannel === "dev"
			? update?.latest_dev?.tag
			: selectedChannel === "latest"
				? update?.latest_release?.tag
				: update?.target);

	useEffect(() => {
		if (panel?.channel === "dev" || panel?.channel === "latest") {
			setSelectedChannel(panel.channel);
		}
	}, [panel?.channel]);

	const selectBuildVersion = (value: string) => {
		setSelectedVersion(value);
		if (!value) return;
		const build = [
			...(builds.data?.stable ?? []),
			...(builds.data?.dev ?? []),
		].find((item) => item.version === value);
		if (build) setSelectedChannel(build.channel === "dev" ? "dev" : "latest");
	};

	const clearPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) {
			window.clearInterval(panelReturnPollRef.current);
			panelReturnPollRef.current = null;
		}
	}, []);

	const startPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) return;
		const startedAt = Date.now();
		let readyChecks = 0;
		panelReturnSawOfflineRef.current = false;
		setWaitingForAPI(true);
		panelReturnPollRef.current = window.setInterval(async () => {
			let up = true;
			try {
				await fetch("/auth/session", { timeout: 2500 });
			} catch (error) {
				const status = (error as { response?: { status?: number } })?.response?.status;
				up = status === 401 || status === 403;
			}
			if (!up) {
				panelReturnSawOfflineRef.current = true;
				readyChecks = 0;
				return;
			}
			const elapsed = Date.now() - startedAt;
			if (!panelReturnSawOfflineRef.current && elapsed < 30000) return;
			readyChecks += 1;
			if (readyChecks >= 2 || elapsed > 180000) {
				clearPanelReturnPolling();
				window.location.reload();
			}
		}, 2000);
	}, [clearPanelReturnPolling]);

	useEffect(() => () => clearPanelReturnPolling(), [clearPanelReturnPolling]);
	useEffect(
		() => () => {
			if (devUpdateTimerRef.current !== null) {
				window.clearTimeout(devUpdateTimerRef.current);
			}
		},
		[],
	);

	useEffect(() => {
		if (!operation?.id || waitingForAPI) return;
		const url = getAPIWebSocketURL("/maintenance/status", { id: operation.id });
		if (!url) return;
		const socket = new WebSocket(url);
		socket.onmessage = (event) => {
			try {
				const status = JSON.parse(event.data) as MaintenanceOperation;
				if (status.id !== operation.id) return;
				setOperation(status);
				if (shouldWaitForPanelReturn(status)) startPanelReturnPolling();
				if (
					status.action === "update" &&
					!status.running &&
					!status.error &&
					!shouldWaitForPanelReturn(status)
				) {
					window.location.reload();
				}
			} catch {}
		};
		return () => socket.close();
	}, [operation?.id, startPanelReturnPolling, waitingForAPI]);

	useEffect(() => {
		if (operation?.logs && logsContainerRef.current) {
			logsContainerRef.current.scrollTop =
				logsContainerRef.current.scrollHeight;
		}
	}, [operation?.logs]);

	const triggerAction = async (
		action: MaintenanceAction,
		body?: Record<string, unknown>,
	) => {
		try {
			const result = await fetch<{ operation?: MaintenanceOperation }>(
				`/maintenance/${action}`,
				{ method: "POST", body, timeout: 3000 },
			);
			return { wentOffline: false, operation: result.operation };
		} catch (error: any) {
			if (!error?.response) return { wentOffline: true };
			throw error;
		}
	};

	const handleSuccess = (
		action: MaintenanceAction,
		result: { wentOffline: boolean; operation?: MaintenanceOperation },
	) => {
		const nextOperation = result.operation || {
			action,
			phase: result.wentOffline ? "restarting" : "queued",
			message: result.wentOffline
				? t("dashboard.maintenance.waitingForAPI")
				: t("dashboard.maintenance.queued"),
			restarting: result.wentOffline,
		};
		setOperation(nextOperation);
		generateSuccessMessage(
			t(
				action === "update"
					? "dashboard.maintenance.updateTriggered"
					: action === "restart"
						? "dashboard.maintenance.restartTriggered"
						: "dashboard.maintenance.softReloadTriggered",
			),
			toast,
		);
		if (result.wentOffline || shouldWaitForPanelReturn(nextOperation)) {
			startPanelReturnPolling();
		}
		window.setTimeout(() => info.refetch(), 6000);
	};

	const updateMutation = useMutation(
		() =>
			triggerAction("update", {
				channel: selectedChannel,
				...(selectedVersion ? { version: selectedVersion } : {}),
			}),
		{
			retry: false,
			onSuccess: (result) => handleSuccess("update", result),
			onError: (error) => {
				setUpdateDialogOpen(false);
				generateErrorMessage(error, toast);
			},
		},
	);
	const restartMutation = useMutation(() => triggerAction("restart"), {
		retry: false,
		onSuccess: (result) => handleSuccess("restart", result),
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});
	const reloadMutation = useMutation(() => triggerAction("soft-reload"), {
		retry: false,
		onSuccess: (result) => handleSuccess("soft-reload", result),
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const executeUpdate = () => {
		setOperation(null);
		setUpdateDialogOpen(true);
		updateMutation.mutate();
	};

	const startUpdate = () => {
		setConfirmAction("update");
	};

	const renderMaintenanceBodyContent = (onClose?: () => void) => (
		<Stack spacing={4}>
			{info.isLoading && (
				<Flex align="center" justify="center" py={5}>
					<Spinner size="sm" color="panel.accent" />
				</Flex>
			)}
			{info.isError && (
				<Alert status="error" borderRadius="14px" fontSize="13px">
					<AlertIcon />
					<Text fontSize="12px">
						{t("dashboard.maintenance.updateCheckFailed", {
							error:
								(info.error as Error)?.message ||
								t("dashboard.system.genericError"),
						})}
					</Text>
				</Alert>
			)}
			<Box
				p={3.5}
				borderRadius="14px"
				bg="panel.elevated"
				borderWidth="1px"
				borderColor="panel.border"
			>
				<Text
					fontSize="11px"
					fontWeight="600"
					color="panel.textMuted"
					mb={1}
				>
					{t("dashboard.maintenance.panelVersion")}
				</Text>
				<Text
					fontSize="13px"
					fontWeight="700"
					color="panel.text"
					dir="ltr"
					sx={{ unicodeBidi: "isolate" }}
				>
					{panel?.image
						? `${panel.image} (${currentVersion})`
						: currentVersion}
				</Text>
			</Box>
			{info.isSuccess && !hostActionsAvailable && (
				<Alert status="warning" borderRadius="14px" fontSize="13px">
					<AlertIcon />
					<Text fontSize="12px">
						{t("dashboard.maintenance.binaryMigrationRequired")}
					</Text>
				</Alert>
			)}
			{update?.available && (
				<Alert status="success" borderRadius="14px" fontSize="13px">
					<AlertIcon />
					<Text fontSize="12px">
						{t("dashboard.maintenance.updateAvailableNotice", {
							current: update.current || currentVersion,
							target: selectedTarget || update.target || "-",
						})}
					</Text>
				</Alert>
			)}
			{update?.error && (
				<Alert status="warning" borderRadius="14px" fontSize="13px">
					<AlertIcon />
					<Text fontSize="12px">
						{t("dashboard.maintenance.updateCheckFailed", {
							error: update.error,
						})}
					</Text>
				</Alert>
			)}
			{hostActionsAvailable && (
				<FormControl>
					<FormLabel
						fontSize="12px"
						fontWeight="600"
						color="panel.textSecondary"
					>
						{t("dashboard.maintenance.updateChannel")}
					</FormLabel>
					<Select
						size="sm"
						portalled={false}
						borderRadius="10px"
						value={selectedChannel}
						onChange={(event) => {
							setSelectedChannel(event.target.value as UpdateChannel);
							setSelectedVersion("");
						}}
					>
						<option value="current">
							{t("dashboard.maintenance.updateChannelCurrent")}
						</option>
						<option value="latest">
							{t("dashboard.maintenance.updateChannelLatest")}
						</option>
						<option value="dev">
							{t("dashboard.maintenance.updateChannelDev")}
						</option>
					</Select>
					<FormHelperText fontSize="11px" color="panel.textMuted">
						{selectedTarget
							? t("dashboard.maintenance.updateTargetHint", {
									version: selectedTarget,
								})
							: t("dashboard.maintenance.updateTargetUnknown")}
					</FormHelperText>
				</FormControl>
			)}
			{hostActionsAvailable && (
				<BuildVersionSelect
					catalog={builds.data}
					value={selectedVersion}
					onChange={selectBuildVersion}
				/>
			)}
			{selectedChannel === "dev" && hostActionsAvailable && (
				<Alert status="warning" borderRadius="14px" fontSize="12px">
					<AlertIcon />
					<Text fontSize="12px">
						{t("dashboard.maintenance.devChannelWarning")}
					</Text>
				</Alert>
			)}
			<Flex
				gap={2}
				flexWrap="wrap"
				justify="flex-end"
				pt={2}
				borderTopWidth="1px"
				borderColor="panel.border"
			>
				<Button
					flex={{ base: "1 1 0", sm: "0 1 auto" }}
					minW={0}
					size="xs"
					h="32px"
					px={3.5}
					variant="outline"
					borderRadius="12px"
					borderColor="panel.border"
					color="panel.text"
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
					_hover={{
						md: {
							bg: "panel.elevated",
							borderColor: "panel.borderStrong",
						},
					}}
					_active={{ transform: "scale(0.96)" }}
					onClick={() => {
						onClose?.();
						setConfirmAction("soft-reload");
					}}
					isLoading={reloadMutation.isLoading}
					isDisabled={!hostActionsAvailable}
					fontSize="12px"
					fontWeight="600"
					whiteSpace="nowrap"
				>
					{t("dashboard.maintenance.softReloadAction")}
				</Button>
				<Button
					flex={{ base: "1 1 0", sm: "0 1 auto" }}
					minW={0}
					size="xs"
					h="32px"
					px={3.5}
					colorScheme={update?.available ? "primary" : "gray"}
					borderRadius="12px"
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
					_active={{ transform: "scale(0.96)" }}
					onClick={() => {
						onClose?.();
						startUpdate();
					}}
					isLoading={updateMutation.isLoading}
					isDisabled={!hostActionsAvailable}
					fontSize="12px"
					fontWeight="600"
				>
					{t("dashboard.maintenance.updateAction")}
				</Button>
			</Flex>
		</Stack>
	);

	const renderUpdatePopover = (width?: string) => (
		<Popover
			placement="bottom-end"
			closeOnBlur={true}
			closeOnEsc={true}
			autoFocus={false}
			returnFocusOnClose={false}
			isLazy
		>
			<PopoverTrigger>
				<Button
					size="xs"
					h="32px"
					minW={{ base: "full", sm: width ? width : "auto" }}
					w={width ?? { base: "full", sm: "auto" }}
					px={{ base: 3.5, md: 2.5, lg: 3.5 }}
					colorScheme={update?.available ? "primary" : "gray"}
					variant={update?.available ? "solid" : "outline"}
					bg={update?.available ? "var(--rb-panel-accent)" : "transparent"}
					color={update?.available ? "white" : "panel.text"}
					borderColor="panel.border"
					borderRadius="12px"
					isDisabled={!canMaintain || !hostActionsAvailable}
					whiteSpace="nowrap"
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
					_active={{ transform: "scale(0.96)" }}
				>
					<HStack spacing={1.5} align="center" justify="center" w="full">
						<Box
							as="span"
							display="inline-flex"
							alignItems="center"
							justifyContent="center"
							flexShrink={0}
						>
							<ArrowUpTrayIcon width={15} height={15} />
						</Box>
						<Text as="span" fontSize="12px" fontWeight="600" lineHeight="none">
							{update?.available
								? t("dashboard.maintenance.updateAvailable")
								: t("dashboard.maintenance.updateAction")}
						</Text>
					</HStack>
				</Button>
			</PopoverTrigger>
			<Portal>
				<PopoverContent
					data-maintenance-popover="true"
					w="min(480px, calc(100vw - 24px))"
					maxW="480px"
					borderRadius="20px"
					boxShadow={cardHighlight}
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					p={1}
					onClick={(e) => e.stopPropagation()}
				>
					<PopoverHeader
						fontWeight="700"
						fontSize="13px"
						py={3}
						px={4}
						borderColor="panel.border"
					>
						<Flex justify="space-between" align="center" gap={3}>
							<Text fontSize="13px" fontWeight="700" color="panel.text">
								{t("dashboard.maintenance.title")}
							</Text>
							<Flex align="center" gap={2}>
								<Button
									size="xs"
									variant="ghost"
									borderRadius="8px"
									color="panel.textMuted"
									transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
									_hover={{ md: { color: "panel.text", bg: "panel.elevated" } }}
									_active={{ transform: "scale(0.96)" }}
									leftIcon={<ArrowPathIcon width={13} height={13} />}
									onClick={(e) => {
										e.stopPropagation();
										info.refetch();
									}}
									isLoading={info.isFetching}
								>
									{t("refresh")}
								</Button>
								<PopoverCloseButton
									position="static"
									top="auto"
									insetInlineEnd="auto"
									m={0}
									size="xs"
									w="24px"
									h="24px"
									borderRadius="8px"
									color="panel.textMuted"
									display={{ base: "flex", md: "none" }}
									alignItems="center"
									justifyContent="center"
									transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
									_hover={{ md: { color: "panel.text", bg: "panel.elevated" } }}
									_active={{ transform: "scale(0.96)" }}
								/>
							</Flex>
						</Flex>
					</PopoverHeader>
					<PopoverBody p={4}>
						{renderMaintenanceBodyContent()}
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);

	const renderRestartButton = (isFullWidth = false) => (
		<Button
			size="xs"
			h="32px"
			w={isFullWidth ? "full" : { base: "full", sm: "auto" }}
			minW={isFullWidth ? undefined : { base: "full", sm: "auto" }}
			px={{ base: 3.5, md: 2.5, lg: 3.5 }}
			colorScheme="red"
			variant="outline"
			borderColor="panel.border"
			color="red.400"
			transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
			_hover={{
				md: { bg: "rgba(239, 68, 68, 0.1)", borderColor: "red.400" },
			}}
			_active={{
				bg: "rgba(239, 68, 68, 0.16)",
				borderColor: "red.400",
				transform: "scale(0.96)",
			}}
			borderRadius="12px"
			onClick={() => setConfirmAction("restart")}
			isLoading={restartMutation.isLoading}
			isDisabled={info.isLoading || !hostActionsAvailable}
			whiteSpace="nowrap"
		>
			<HStack
				spacing={1.5}
				align="center"
				justify="center"
				w={isFullWidth ? "full" : undefined}
			>
				<Box
					as="span"
					display="inline-flex"
					alignItems="center"
					justifyContent="center"
					flexShrink={0}
				>
					<ArrowsRightLeftIcon width={15} height={15} />
				</Box>
				<Text
					as="span"
					fontSize="12px"
					fontWeight="600"
					lineHeight="none"
				>
					{t("dashboard.maintenance.restartAction")}
				</Text>
			</HStack>
		</Button>
	);

	const renderMobileTriggerButton = () => (
		<Button
			size="xs"
			h="32px"
			w="full"
			px={3.5}
			colorScheme={update?.available ? "primary" : "gray"}
			variant={update?.available ? "solid" : "outline"}
			bg={update?.available ? "var(--rb-panel-accent)" : "transparent"}
			color={update?.available ? "white" : "panel.text"}
			borderColor="panel.border"
			borderRadius="12px"
			isDisabled={!canMaintain || !hostActionsAvailable}
			whiteSpace="nowrap"
			transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
			_active={{ transform: "scale(0.96)" }}
			onClick={() => setIsMobileMaintenanceOpen(true)}
		>
			<HStack spacing={1.5} align="center" justify="center" w="full">
				<Box
					as="span"
					display="inline-flex"
					alignItems="center"
					justifyContent="center"
					flexShrink={0}
				>
					<ArrowUpTrayIcon width={15} height={15} />
				</Box>
				<Text as="span" fontSize="12px" fontWeight="600" lineHeight="none">
					{update?.available
						? t("dashboard.maintenance.updateAvailable")
						: t("dashboard.maintenance.updateAction")}
				</Text>
			</HStack>
		</Button>
	);

	const isStandardAdminOnly = !canMaintain && !canBackUp;

	return (
		<Flex
			align="center"
			justify={{ base: "center", sm: "flex-end" }}
			w="full"
			sx={{
				"@media screen and (min-width: 600px)": {
					width: "auto !important",
				},
				"@media screen and (max-width: 599.98px)": {
					width: "100% !important",
				},
			}}
			flexShrink={0}
		>
			<HStack
				spacing={2}
				align="center"
				justify="flex-end"
				flexWrap="nowrap"
				flexShrink={0}
				display="none"
				sx={{
					"@media screen and (min-width: 600px)": {
						display: "flex !important",
					},
				}}
			>
				{canMaintain && renderUpdatePopover()}

				{canBackUp && (
					<DashboardBackupControls
						isBinaryRuntime={hostActionsAvailable}
						runtimeLoading={info.isLoading}
					/>
				)}

				{canMaintain && renderRestartButton(false)}
			</HStack>

			{!isStandardAdminOnly && (
				<Stack
					spacing={2}
					w="full"
					display="none"
					sx={{
						"@media screen and (max-width: 599.98px)": {
							display: "flex !important",
						},
					}}
				>
					<Box w="full">{renderMobileTriggerButton()}</Box>

					{(canBackUp || canMaintain) && (
						<SimpleGrid
							columns={canBackUp && canMaintain ? 2 : 1}
							spacing={2}
							w="full"
						>
							{canBackUp && (
								<DashboardBackupControls
									width="full"
									isBinaryRuntime={hostActionsAvailable}
									runtimeLoading={info.isLoading}
								/>
							)}
							{canMaintain && renderRestartButton(true)}
						</SimpleGrid>
					)}
				</Stack>
			)}

			<Modal
				isOpen={isMobileMaintenanceOpen}
				onClose={() => setIsMobileMaintenanceOpen(false)}
				isCentered
			>
				<ModalOverlay bg="blackAlpha.700" />
				<ModalContent
					data-modal-centered="true"
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					borderRadius="20px"
					boxShadow={cardHighlight}
					mx="auto"
					my="auto"
					w={{ base: "calc(100vw - 32px)", sm: "480px" }}
					maxW="480px"
					maxH="88dvh"
					overflow="hidden"
				>
					<ModalHeader
						data-no-extra-padding="true"
						py={3}
						px={4}
						pe="4 !important"
						ps="4 !important"
						borderBottomWidth="1px"
						borderColor="panel.border"
					>
						<Flex justify="space-between" align="center" gap={3}>
							<Text fontSize="13px" fontWeight="700" color="panel.text">
								{t("dashboard.maintenance.title")}
							</Text>
							<IconButton
								aria-label="Close"
								icon={<XMarkIcon width={16} height={16} />}
								size="xs"
								variant="ghost"
								borderRadius="8px"
								w="28px"
								h="28px"
								minW="28px"
								position="static"
								m={0}
								marginInlineEnd="-4px"
								onClick={() => setIsMobileMaintenanceOpen(false)}
								color="panel.textMuted"
								_hover={{ md: { color: "panel.text", bg: "panel.elevated" } }}
								_active={{ transform: "scale(0.96)" }}
							/>
						</Flex>
					</ModalHeader>
					<ModalBody p={4} overflowY="auto">
						{renderMaintenanceBodyContent(() => setIsMobileMaintenanceOpen(false))}
					</ModalBody>
				</ModalContent>
			</Modal>

			<Modal
				isOpen={isUpdateDialogOpen}
				onClose={() => {
					if (operation?.error) setUpdateDialogOpen(false);
				}}
				closeOnEsc={Boolean(operation?.error)}
				closeOnOverlayClick={false}
				isCentered
				size="xl"
			>
				<ModalOverlay bg="blackAlpha.700" />
				<ModalContent
					data-modal-centered="true"
					borderRadius="20px"
					overflow="hidden"
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					boxShadow={cardHighlight}
					mx={4}
				>
					<ModalHeader
						px={6}
						pt={6}
						pb={4}
						borderBottom="1px solid"
						borderColor="panel.border"
					>
						<Flex align="center" justify="space-between">
							<HStack spacing={3}>
								<Flex
									w="36px"
									h="36px"
									align="center"
									justify="center"
									borderRadius="12px"
									bg="panel.elevated"
									color="var(--rb-panel-accent)"
									border="1px solid"
									borderColor="panel.border"
								>
									{operation?.error ? (
										<ArrowPathIcon width={18} />
									) : operation?.phase === "completed" ? (
										<CheckIcon width={18} />
									) : (
										<motion.div
											animate={{ rotate: 360 }}
											transition={{
												repeat: Infinity,
												duration: 2,
												ease: "linear",
											}}
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											<ArrowPathIcon width={18} />
										</motion.div>
									)}
								</Flex>
								<Box>
									<Text fontSize="15px" fontWeight="700" color="panel.text">
										{t("dashboard.maintenance.updateProgressTitle")}
									</Text>
									<HStack spacing={2} mt={0.5}>
										<Text
											fontSize="11px"
											color="panel.textMuted"
											fontWeight="500"
										>
											{currentVersion}
										</Text>
										{selectedTarget && (
											<>
												<Text fontSize="11px" color="panel.textMuted">
													{document.documentElement.dir === "rtl" ? "←" : "→"}
												</Text>
												<Text
													fontSize="11px"
													color="var(--rb-panel-accent)"
													fontWeight="700"
													dir="ltr"
													sx={{ unicodeBidi: "isolate" }}
												>
													{selectedTarget}
												</Text>
											</>
										)}
									</HStack>
								</Box>
							</HStack>
							{operation?.error && <ModalCloseButton position="static" />}
						</Flex>
					</ModalHeader>

					<ModalBody px={6} py={5}>
						<Stack spacing={4}>
							<Box
								p={4}
								borderRadius="14px"
								bg="panel.elevated"
								border="1px solid"
								borderColor="panel.border"
								transition="all 0.3s ease"
							>
								<Flex align="center" justify="space-between" mb={2}>
									<HStack spacing={2.5}>
										<Flex
											w="8px"
											h="8px"
											borderRadius="full"
											bg={
												operation?.error
													? "red.500"
													: operation?.phase === "completed"
														? "green.500"
														: "var(--rb-panel-accent)"
											}
											boxShadow={
												operation?.error
													? "0 0 10px rgba(239, 68, 68, 0.6)"
													: operation?.phase === "completed"
														? "0 0 10px rgba(34, 197, 94, 0.6)"
														: "0 0 10px var(--rb-panel-accent)"
											}
										/>
										<Text fontSize="13px" fontWeight="700" color="panel.text">
											{operation?.phase
												? t(
														`dashboard.maintenance.phase.${operation.phase}`,
														operation.phase,
													)
												: t("dashboard.maintenance.phase.queued")}
										</Text>
									</HStack>
									{typeof operation?.progress === "number" && (
										<Text
											fontSize="12px"
											fontWeight="700"
											color="var(--rb-panel-accent)"
											dir="ltr"
											sx={{ fontVariantNumeric: "tabular-nums" }}
										>
											{Math.round(operation.progress)}%
										</Text>
									)}
								</Flex>

								<Text
									fontSize="12px"
									color="panel.textSecondary"
									fontWeight="500"
									mb={3}
								>
									{operation?.error
										? operation.error
										: operation?.message
											? t(
													`dashboard.maintenance.message.${operation.message.replace(/[^a-zA-Z]/g, "")}`,
													operation.message,
												)
											: t("dashboard.maintenance.message.preparingUpdate")}
								</Text>

								<Progress
									value={
										typeof operation?.progress === "number"
											? operation.progress
											: undefined
									}
									isIndeterminate={
										typeof operation?.progress !== "number" &&
										!operation?.error &&
										operation?.phase !== "completed"
									}
									borderRadius="full"
									h="6px"
									bg="panel.surface"
									sx={{
										"& > div": {
											background: operation?.error
												? "var(--chakra-colors-red-500)"
												: operation?.phase === "completed"
													? "var(--chakra-colors-green-500)"
													: "var(--rb-panel-accent)",
											transition: "width 0.4s ease",
										},
									}}
								/>
							</Box>

							{waitingForAPI && (
								<Text
									fontSize="12px"
									color="panel.textMuted"
									textAlign="center"
								>
									{t("dashboard.maintenance.autoRefreshAfterRestart")}
								</Text>
							)}

							<Box
								borderRadius="14px"
								bg={outputBg}
								border="1px solid"
								borderColor={outputBorder}
								overflow="hidden"
							>
								<Flex
									align="center"
									justify="space-between"
									px={3.5}
									py={2}
									borderBottom="1px solid"
									borderColor={outputBorder}
									bg="panel.elevated"
								>
									<Flex align="center" gap={2}>
										<CommandLineIcon
											width={14}
											height={14}
											color="var(--rb-panel-accent)"
										/>
										<Text
											fontSize="11px"
											fontWeight="600"
											color="panel.textSecondary"
											lineHeight="1"
										>
											{t("dashboard.maintenance.liveLogs")}
										</Text>
									</Flex>
									<Tooltip
										label={
											logsCopied
												? t("dashboard.maintenance.logsCopied")
												: t("dashboard.maintenance.copyLogs")
										}
										fontSize="10px"
										openDelay={300}
										closeOnClick={false}
										closeOnMouseDown
									>
										<IconButton
											aria-label={t("dashboard.maintenance.copyLogs")}
											tabIndex={-1}
											icon={
												logsCopied ? (
													<CheckIcon width={13} />
												) : (
													<ClipboardIcon width={13} />
												)
											}
											size="xs"
											variant="ghost"
											h="22px"
											w="22px"
											minW="22px"
											borderRadius="6px"
											color={logsCopied ? "green.500" : "panel.textMuted"}
											_hover={{ md: { color: "panel.text" } }}
											onClick={() => {
												const logs = cleanTerminalOutput(operation?.logs);
												if (logs) {
													navigator.clipboard.writeText(logs);
													setLogsCopied(true);
													setTimeout(() => setLogsCopied(false), 2000);
												}
											}}
										/>
									</Tooltip>
								</Flex>

								<Box
									ref={logsContainerRef}
									as="div"
									h="220px"
									overflowY="auto"
									p={3.5}
									fontSize="11px"
									fontFamily="'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace"
									lineHeight="1.6"
									color="panel.text"
									dir="ltr"
									textAlign="left"
									whiteSpace="pre-wrap"
									wordBreak="break-all"
									sx={{
										"&::-webkit-scrollbar": {
											width: "6px",
										},
										"&::-webkit-scrollbar-thumb": {
											background: "rgba(255, 255, 255, 0.12)",
											borderRadius: "3px",
										},
									}}
								>
									{cleanTerminalOutput(operation?.logs) ? (
										cleanTerminalOutput(operation?.logs)
											.split("\n")
											.map((line, index) => formatTerminalLine(line, index))
									) : (
										<Text color="panel.textMuted">
											{t("dashboard.maintenance.waitingForOutput")}
										</Text>
									)}
								</Box>
							</Box>
						</Stack>
					</ModalBody>
				</ModalContent>
			</Modal>

			<Modal
				isOpen={confirmAction !== null}
				onClose={() => setConfirmAction(null)}
				isCentered
				size="md"
			>
				<ModalOverlay bg="blackAlpha.700" />
				<ModalContent
					data-modal-centered="true"
					className="rb-confirm-dialog-content"
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					borderRadius="20px"
					boxShadow={cardHighlight}
					mx="auto"
					my="auto"
					w={{ base: "calc(100vw - 32px)", sm: "440px" }}
					maxW="440px"
					overflow="hidden"
				>
					<ModalHeader
						px={5}
						pt={5}
						pb={3}
					>
						<Flex align="center" justify="space-between" w="full">
							<HStack spacing={3} flex="1" minW="0">
								<Flex
									w="36px"
									h="36px"
									align="center"
									justify="center"
									borderRadius="10px"
									bg={
										confirmAction === "restart"
											? "rgba(239, 68, 68, 0.12)"
											: confirmAction === "soft-reload"
												? "rgba(245, 158, 11, 0.12)"
												: "panel.elevated"
									}
									color={
										confirmAction === "restart"
											? "red.400"
											: confirmAction === "soft-reload"
												? "orange.400"
												: "var(--rb-panel-accent)"
									}
									border="1px solid"
									borderColor={
										confirmAction === "restart"
											? "rgba(239, 68, 68, 0.25)"
											: confirmAction === "soft-reload"
												? "rgba(245, 158, 11, 0.25)"
												: "panel.border"
									}
									flexShrink={0}
								>
									{confirmAction === "restart" ? (
										<ArrowsRightLeftIcon width={18} height={18} />
									) : confirmAction === "soft-reload" ? (
										<ArrowPathIcon width={18} height={18} />
									) : (
										<ArrowUpTrayIcon width={18} height={18} />
									)}
								</Flex>
								<Box minW={0} flex="1">
									<Text fontSize="15px" fontWeight="700" color="panel.text">
										{confirmAction === "restart"
											? t("dashboard.maintenance.restartConfirmTitle")
											: confirmAction === "soft-reload"
												? t("dashboard.maintenance.softReloadConfirmTitle")
												: t("dashboard.maintenance.updateConfirmTitle")}
									</Text>
									<Text
										fontSize="11px"
										fontWeight="500"
										color="panel.textMuted"
									>
										{confirmAction === "restart"
											? t("dashboard.maintenance.restartAction")
											: confirmAction === "soft-reload"
												? t("dashboard.maintenance.softReloadAction")
												: t("dashboard.maintenance.updateAction")}
									</Text>
								</Box>
							</HStack>
							<IconButton
								aria-label="Close"
								icon={<XMarkIcon width={16} height={16} />}
								size="xs"
								variant="ghost"
								borderRadius="8px"
								w="28px"
								h="28px"
								minW="28px"
								onClick={() => setConfirmAction(null)}
								color="panel.textMuted"
								_hover={{ md: { color: "panel.text", bg: "panel.elevated" } }}
								_active={{ transform: "scale(0.96)" }}
							/>
						</Flex>
					</ModalHeader>
					<ModalBody px={6} py={5}>
						<Stack spacing={4}>
							<Text
								fontSize="13px"
								color="panel.textSecondary"
								lineHeight="tall"
							>
								{confirmAction === "restart"
									? t("dashboard.maintenance.restartConfirmDescription")
									: confirmAction === "soft-reload"
										? t("dashboard.maintenance.softReloadConfirmDescription")
										: selectedChannel === "dev"
											? t("dashboard.maintenance.updateDevConfirmDescription")
											: t("dashboard.maintenance.updateConfirmDescription", {
													target: selectedTarget || update?.target || "-",
												})}
							</Text>
							{confirmAction === "update" && selectedVersion && (
								<Alert status="warning" borderRadius="14px" fontSize="12px">
									<AlertIcon />
									<Text>{t("dashboard.maintenance.versionSwitchWarning")}</Text>
								</Alert>
							)}
						</Stack>
					</ModalBody>
					<ModalFooter
						gap={2.5}
						px={6}
						py={4}
						borderTopWidth="1px"
						borderColor="panel.border"
						bg="panel.elevated"
					>
						<Button
							variant="ghost"
							size="sm"
							borderRadius="10px"
							color="panel.textSecondary"
							fontWeight="600"
							fontSize="12.5px"
							onClick={() => setConfirmAction(null)}
							_hover={{ md: { bg: "panel.surface", color: "panel.text" } }}
						>
							{t("cancel")}
						</Button>
						<Button
							colorScheme={
								confirmAction === "restart"
									? "red"
									: selectedChannel === "dev" && confirmAction === "update"
										? "orange"
										: "primary"
							}
							size="sm"
							borderRadius="10px"
							px={5}
							h="34px"
							fontWeight="600"
							fontSize="12.5px"
							isLoading={
								restartMutation.isLoading ||
								reloadMutation.isLoading ||
								updateMutation.isLoading
							}
							onClick={() => {
								const act = confirmAction;
								setConfirmAction(null);
								if (act === "restart") restartMutation.mutate();
								if (act === "soft-reload") reloadMutation.mutate();
								if (act === "update") executeUpdate();
							}}
						>
							{t("confirm")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</Flex>
	);
};
