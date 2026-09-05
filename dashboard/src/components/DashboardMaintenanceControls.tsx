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
	PopoverContent,
	PopoverHeader,
	PopoverTrigger,
	Progress,
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
import { DashboardBackupControls } from "./RebeccaBackupPanel";
import { PanelSelect as Select } from "./common/PanelSelect";

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

const ansiEscapePattern =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip ANSI escape codes from raw terminal logs
	/\u001B|\u009B|[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const cleanTerminalOutput = (logs?: string[]) =>
	(logs || [])
		.join("\n")
		.replace(ansiEscapePattern, "")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip backspace characters from terminal logs
		.replace(/\x08/g, "")
		.trimEnd();

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
	const [selectedChannel, setSelectedChannel] =
		useState<UpdateChannel>("current");
	const [operation, setOperation] = useState<MaintenanceOperation | null>(null);
	const [waitingForAPI, setWaitingForAPI] = useState(false);
	const [isUpdateDialogOpen, setUpdateDialogOpen] = useState(false);
	const [confirmAction, setConfirmAction] = useState<"restart" | "soft-reload" | "update" | null>(null);
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
	const fallbackVersion = channel?.toLowerCase() === "dev" ? "dev" : version;
	const currentVersion =
		panel?.tag || update?.current || fallbackVersion || "-";
	const selectedTarget =
		selectedChannel === "dev"
			? update?.latest_dev?.tag
			: selectedChannel === "latest"
				? update?.latest_release?.tag
				: update?.target;

	useEffect(() => {
		if (panel?.channel === "dev" || panel?.channel === "latest") {
			setSelectedChannel(panel.channel);
		}
	}, [panel?.channel]);

	const clearPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) {
			window.clearInterval(panelReturnPollRef.current);
			panelReturnPollRef.current = null;
		}
	}, []);

	const startPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) return;
		const startedAt = Date.now();
		panelReturnSawOfflineRef.current = false;
		setWaitingForAPI(true);
		panelReturnPollRef.current = window.setInterval(async () => {
			try {
				await fetch<MaintenanceInfo>("/maintenance/info", { timeout: 2500 });
				if (panelReturnSawOfflineRef.current || Date.now() - startedAt > 7000) {
					clearPanelReturnPolling();
					window.location.reload();
				}
			} catch {
				panelReturnSawOfflineRef.current = true;
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
			logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
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
		() => triggerAction("update", { channel: selectedChannel }),
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

	const renderUpdatePopover = () => (
		<Popover
			placement="bottom-end"
			closeOnBlur={true}
			closeOnEsc={true}
			isLazy
		>
			<PopoverTrigger>
				<Button
					size="xs"
					h="32px"
					w="full"
					colorScheme={update?.available ? "primary" : "gray"}
					variant={update?.available ? "solid" : "outline"}
					bg={update?.available ? "var(--rb-panel-accent)" : "transparent"}
					color={update?.available ? "white" : "panel.text"}
					borderColor="panel.border"
					borderRadius="full"
					leftIcon={<ArrowUpTrayIcon width={14} height={14} />}
					isDisabled={!canMaintain || !hostActionsAvailable || info.isLoading}
					fontSize="12px"
					fontWeight="600"
					whiteSpace="nowrap"
				>
					{update?.available
						? t("dashboard.maintenance.updateAvailable")
						: t("dashboard.maintenance.updateAction")}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				w="min(480px, calc(100vw - 24px))"
				maxW="480px"
				borderRadius="2xl"
				boxShadow="0 24px 60px rgba(0,0,0,0.5)"
				bg="panel.surface"
				borderColor="panel.border"
				borderWidth="1px"
				p={1}
				onClick={(e) => e.stopPropagation()}
			>
				<PopoverHeader fontWeight="700" fontSize="13px" py={3} px={4} borderColor="panel.border">
					<Flex justify="space-between" align="center" gap={3}>
						<Text fontSize="13px" fontWeight="700" color="panel.text">{t("dashboard.maintenance.title")}</Text>
						<Button
							size="xs"
							variant="ghost"
							borderRadius="full"
							color="panel.textMuted"
							_hover={{ color: "panel.text", bg: "panel.elevated" }}
							leftIcon={<ArrowPathIcon width={13} height={13} />}
							onClick={() => info.refetch()}
							isLoading={info.isFetching}
						>
							{t("refresh")}
						</Button>
					</Flex>
				</PopoverHeader>
				<PopoverBody p={4}>
					<Stack spacing={4}>
						{info.isLoading && (
							<Flex align="center" justify="center" py={5}>
								<Spinner size="sm" color="panel.accent" />
							</Flex>
						)}
						{info.isError && (
							<Alert status="error" borderRadius="xl" fontSize="13px">
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
							borderRadius="xl"
							bg="panel.elevated"
							borderWidth="1px"
							borderColor="panel.border"
						>
							<Text fontSize="11px" fontWeight="600" color="panel.textMuted" mb={1}>
								{t("dashboard.maintenance.panelVersion")}
							</Text>
							<Text fontSize="13px" fontWeight="700" color="panel.text" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
								{panel?.image
									? `${panel.image} (${currentVersion})`
									: currentVersion}
							</Text>
						</Box>
						{info.isSuccess && !hostActionsAvailable && (
							<Alert status="warning" borderRadius="xl" fontSize="13px">
								<AlertIcon />
								<Text fontSize="12px">
									{t("dashboard.maintenance.binaryMigrationRequired")}
								</Text>
							</Alert>
						)}
						{update?.available && (
							<Alert status="success" borderRadius="xl" fontSize="13px">
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
							<Alert status="warning" borderRadius="xl" fontSize="13px">
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
								<FormLabel fontSize="12px" fontWeight="600" color="panel.textSecondary">
									{t("dashboard.maintenance.updateChannel")}
								</FormLabel>
								<Select
									size="sm"
									portalled={false}
									value={selectedChannel}
									onChange={(event) => {
										setSelectedChannel(
											event.target.value as UpdateChannel,
										);
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
						{selectedChannel === "dev" && hostActionsAvailable && (
							<Alert status="warning" borderRadius="xl" fontSize="12px">
								<AlertIcon />
								<Text fontSize="12px">
									{t("dashboard.maintenance.devChannelWarning")}
								</Text>
							</Alert>
						)}
						<Flex gap={2} flexWrap="wrap" justify="flex-end" pt={2} borderTopWidth="1px" borderColor="panel.border">
							<Button
								size="xs"
								h="30px"
								px={3.5}
								variant="outline"
								borderRadius="full"
								borderColor="panel.border"
								color="panel.text"
								_hover={{ bg: "panel.elevated", borderColor: "panel.borderStrong" }}
								onClick={() => setConfirmAction("soft-reload")}
								isLoading={reloadMutation.isLoading}
								isDisabled={!hostActionsAvailable}
								fontSize="12px"
								fontWeight="600"
							>
								{t("dashboard.maintenance.softReloadAction")}
							</Button>
							<Button
								size="xs"
								h="30px"
								px={4}
								colorScheme={update?.available ? "primary" : "gray"}
								borderRadius="full"
								onClick={startUpdate}
								isLoading={updateMutation.isLoading}
								isDisabled={!hostActionsAvailable}
								fontSize="12px"
								fontWeight="600"
							>
								{t("dashboard.maintenance.updateAction")}
							</Button>
						</Flex>
					</Stack>
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);

	const isStandardAdminOnly = !canMaintain && !canBackUp;

	return (
		<Flex
			align="center"
			justify={{ base: "center", sm: "flex-end" }}
			w={{ base: "full", sm: "auto" }}
			flexShrink={0}
		>
			<HStack
				display={{ base: "none", sm: "flex" }}
				spacing={2}
				align="center"
				justify="flex-end"
				flexWrap="nowrap"
				flexShrink={0}
			>
				{canMaintain && <Box minW="130px">{renderUpdatePopover()}</Box>}

				{canBackUp && (
					<Box
						minW="90px"
						sx={{
							"& > button": {
								h: "32px !important",
								borderRadius: "full !important",
								fontSize: "12px !important",
								fontWeight: "600 !important",
								borderColor: "panel.border !important",
								color: "panel.text !important",
								whiteSpace: "nowrap !important",
							},
						}}
					>
						<DashboardBackupControls
							isBinaryRuntime={hostActionsAvailable}
							runtimeLoading={info.isLoading}
						/>
					</Box>
				)}

				{canMaintain && (
					<Button
						size="xs"
						h="32px"
						px={3.5}
						colorScheme="red"
						variant="outline"
						borderColor="panel.border"
						color="red.400"
						_hover={{ bg: "rgba(239, 68, 68, 0.1)", borderColor: "red.400" }}
						borderRadius="full"
						leftIcon={<ArrowsRightLeftIcon width={14} height={14} />}
						onClick={() => setConfirmAction("restart")}
						isLoading={restartMutation.isLoading}
						isDisabled={info.isLoading || !hostActionsAvailable}
						fontSize="12px"
						fontWeight="600"
						whiteSpace="nowrap"
					>
						{t("dashboard.maintenance.restartAction")}
					</Button>
				)}
			</HStack>

			{!isStandardAdminOnly && (
				<Stack
					display={{ base: "flex", sm: "none" }}
					spacing={2}
					w="full"
				>
					<Box w="full">
						{renderUpdatePopover()}
					</Box>

					<Flex gap={2} w="full" align="center">
						<Button
							flex="1 1 50%"
							h="32px"
							size="xs"
							colorScheme="red"
							variant="outline"
							borderColor="panel.border"
							color="red.400"
							_hover={{ bg: "rgba(239, 68, 68, 0.1)", borderColor: "red.400" }}
							borderRadius="full"
							leftIcon={<ArrowsRightLeftIcon width={14} height={14} />}
							onClick={() => setConfirmAction("restart")}
							isLoading={restartMutation.isLoading}
							isDisabled={info.isLoading || !hostActionsAvailable}
							fontSize="12px"
							fontWeight="600"
							whiteSpace="nowrap"
						>
							{t("dashboard.maintenance.restartAction")}
						</Button>

						{canBackUp && (
							<Box
								flex="1 1 50%"
								minW={0}
								sx={{
									"& > button": {
										w: "full",
										h: "32px !important",
										borderRadius: "full !important",
										fontSize: "12px !important",
										fontWeight: "600 !important",
										borderColor: "panel.border !important",
										color: "panel.text !important",
										whiteSpace: "nowrap !important",
									},
								}}
							>
								<DashboardBackupControls
									isBinaryRuntime={hostActionsAvailable}
									runtimeLoading={info.isLoading}
								/>
							</Box>
						)}
					</Flex>
				</Stack>
			)}

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
				<ModalOverlay bg="blackAlpha.700" backdropFilter="blur(16px)" />
				<ModalContent
					borderRadius="24px"
					overflow="hidden"
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					boxShadow="0 24px 60px -12px rgba(0, 0, 0, 0.45), inset 0 1px 1px 0 rgba(255, 255, 255, 0.08)"
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
											transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
											style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
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
										<Text fontSize="11px" color="panel.textMuted" fontWeight="500">
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
								borderRadius="16px"
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
												? t(`dashboard.maintenance.phase.${operation.phase}`, operation.phase)
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

								<Text fontSize="12px" color="panel.textSecondary" fontWeight="500" mb={3}>
									{operation?.error
										? operation.error
										: operation?.message
											? t(`dashboard.maintenance.message.${operation.message.replace(/[^a-zA-Z]/g, "")}`, operation.message)
											: t("dashboard.maintenance.message.preparingUpdate")}
								</Text>

								<Progress
									value={typeof operation?.progress === "number" ? operation.progress : undefined}
									isIndeterminate={typeof operation?.progress !== "number" && !operation?.error && operation?.phase !== "completed"}
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
								<Text fontSize="12px" color="panel.textMuted" textAlign="center">
									{t("dashboard.maintenance.autoRefreshAfterRestart")}
								</Text>
							)}

							<Box
								borderRadius="16px"
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
										<CommandLineIcon width={14} height={14} color="var(--rb-panel-accent)" />
										<Text fontSize="11px" fontWeight="600" color="panel.textSecondary" lineHeight="1">
											{t("dashboard.maintenance.liveLogs")}
										</Text>
									</Flex>
									<Tooltip
										label={logsCopied ? t("dashboard.maintenance.logsCopied") : t("dashboard.maintenance.copyLogs")}
										fontSize="10px"
										openDelay={300}
										closeOnClick={false}
										closeOnMouseDown
									>
										<IconButton
											aria-label={t("dashboard.maintenance.copyLogs")}
											tabIndex={-1}
											icon={logsCopied ? <CheckIcon width={13} /> : <ClipboardIcon width={13} />}
											size="xs"
											variant="ghost"
											h="22px"
											w="22px"
											minW="22px"
											borderRadius="6px"
											color={logsCopied ? "green.500" : "panel.textMuted"}
											_hover={{ color: "panel.text" }}
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
									as="pre"
									maxH="220px"
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
									{cleanTerminalOutput(operation?.logs) || t("dashboard.maintenance.waitingForOutput")}
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
				<ModalOverlay bg="blackAlpha.600" backdropFilter="blur(6px)" />
				<ModalContent
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					borderRadius="2xl"
					boxShadow="0 24px 60px rgba(0,0,0,0.4)"
					mx={4}
				>
					<ModalHeader fontSize="md" fontWeight="700" color="panel.text" pb={2}>
						{confirmAction === "restart"
							? t("dashboard.maintenance.restartConfirmTitle")
							: confirmAction === "soft-reload"
								? t("dashboard.maintenance.softReloadConfirmTitle")
								: t("dashboard.maintenance.updateConfirmTitle")}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody py={3}>
						<Text fontSize="13px" color="panel.textSecondary" lineHeight="tall">
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
					</ModalBody>
					<ModalFooter gap={2} pt={3}>
						<Button
							variant="ghost"
							size="sm"
							borderRadius="full"
							color="panel.textMuted"
							onClick={() => setConfirmAction(null)}
						>
							{t("cancel")}
						</Button>
						<Button
							colorScheme={confirmAction === "restart" ? "red" : selectedChannel === "dev" && confirmAction === "update" ? "orange" : "primary"}
							size="sm"
							borderRadius="full"
							px={5}
							isLoading={restartMutation.isLoading || reloadMutation.isLoading || updateMutation.isLoading}
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