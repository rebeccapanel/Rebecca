import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert } from "components/ui/alert";
import { Button } from "components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "components/ui/popover";
import { Progress } from "components/ui/progress";
import { toast } from "components/ui/sonner";
import { Spinner } from "components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "components/ui/tooltip";
import useGetUser from "hooks/useGetUser";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import {
	ArrowUpCircle,
	Check,
	CircleAlert,
	CircleCheck,
	Clipboard,
	RefreshCw,
	RotateCcw,
	RotateCw,
	Terminal,
	TriangleAlert,
	X,
} from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import { AdminRole } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import {
	type BuildCatalog,
	BuildVersionSelect,
} from "./BuildVersionSelect";
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

const ESC_CHAR = String.fromCharCode(27);
const CSI_CHAR = String.fromCharCode(155);
const BEL_CHAR = String.fromCharCode(7);
const BS_CHAR = String.fromCharCode(8);

const ansiEscapePattern = new RegExp(
	`${ESC_CHAR}|${CSI_CHAR}|[${ESC_CHAR}${CSI_CHAR}][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?${BEL_CHAR})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))`,
	"g",
);
const backspacePattern = new RegExp(BS_CHAR, "g");

const cleanTerminalOutput = (logs?: string[]) =>
	(logs || [])
		.join("\n")
		.replace(ansiEscapePattern, "")
		.replace(backspacePattern, "")
		.trimEnd();

export interface DashboardMaintenanceControlsProps {
	channel?: string;
	version: string;
}

export const DashboardMaintenanceControls: FC<DashboardMaintenanceControlsProps> = ({
	channel,
	version,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const isDesktop = useMediaQuery("(min-width: 769px)");
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

	const [selectedChannel, setSelectedChannel] =
		useState<UpdateChannel>("current");
	const [selectedVersion, setSelectedVersion] = useState("");
	const [operation, setOperation] = useState<MaintenanceOperation | null>(null);
	const [waitingForAPI, setWaitingForAPI] = useState(false);
	const [isUpdatePopoverOpen, setUpdatePopoverOpen] = useState(false);
	const [isUpdateDialogOpen, setUpdateDialogOpen] = useState(false);
	const [confirmAction, setConfirmAction] =
		useState<MaintenanceAction>("restart");
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const [logsCopied, setLogsCopied] = useState(false);

	const logsContainerRef = useRef<HTMLPreElement | null>(null);
	const panelReturnPollRef = useRef<number | null>(null);
	const panelReturnSawOfflineRef = useRef(false);

	const info = useQuery<MaintenanceInfo>({
		queryKey: ["dashboard-maintenance-info"],
		queryFn: () => fetch<MaintenanceInfo>("/maintenance/info", { timeout: 8000 }),
		enabled: canMaintain || canBackUp,
		refetchOnWindowFocus: false,
		staleTime: 5 * 60 * 1000,
		retry: false,
	});

	const panel = info.data?.panel;
	const update = panel?.update;
	const installMode = panel?.mode || panel?.install_mode;
	const hostActionsAvailable = installMode === "binary";

	const builds = useQuery<BuildCatalog>({
		queryKey: ["maintenance-builds", "panel"],
		queryFn: () =>
			fetch<BuildCatalog>("/maintenance/builds?target=panel", {
				timeout: 12000,
			}),
		enabled: canMaintain && hostActionsAvailable,
		refetchOnWindowFocus: false,
		staleTime: 10 * 60 * 1000,
		retry: false,
	});

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
		if (build) {
			setSelectedChannel(build.channel === "dev" ? "dev" : "latest");
		}
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
				const status = (error as { response?: { status?: number } })?.response
					?.status;
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

	useEffect(() => {
		if (
			!operation?.id ||
			waitingForAPI ||
			operation.error ||
			operation.phase === "completed"
		) {
			return;
		}
		let failures = 0;
		const timer = window.setInterval(async () => {
			try {
				const status = await fetch<MaintenanceOperation>(
					"/maintenance/status",
					{ timeout: 2500 },
				);
				failures = 0;
				if (status.id && status.id !== operation.id) return;
				if (!status.id) {
					startPanelReturnPolling();
					return;
				}
				setOperation(status);
				if (shouldWaitForPanelReturn(status)) startPanelReturnPolling();
			} catch {
				failures += 1;
				if (failures >= 3) startPanelReturnPolling();
			}
		}, 1000);
		return () => window.clearInterval(timer);
	}, [
		operation?.id,
		operation?.error,
		operation?.phase,
		waitingForAPI,
		startPanelReturnPolling,
	]);

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
		} catch (error: unknown) {
			const maybeErr = error as { response?: unknown };
			if (!maybeErr?.response) return { wentOffline: true };
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

	const updateMutation = useMutation({
		mutationFn: () =>
			triggerAction("update", {
				channel: selectedChannel,
				...(selectedVersion ? { version: selectedVersion } : {}),
			}),
		retry: false,
		onSuccess: (result) => handleSuccess("update", result),
		onError: (error) => {
			setUpdateDialogOpen(false);
			generateErrorMessage(error, toast);
		},
	});

	const restartMutation = useMutation({
		mutationFn: () => triggerAction("restart"),
		retry: false,
		onSuccess: (result) => handleSuccess("restart", result),
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const reloadMutation = useMutation({
		mutationFn: () => triggerAction("soft-reload"),
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

	const isStandardAdminOnly = !canMaintain && !canBackUp;
	if (isStandardAdminOnly) {
		return null;
	}

	const openConfirmModal = (action: MaintenanceAction) => {
		setConfirmAction(action);
		setIsConfirmOpen(true);
	};

	const openConfirmFromPopover = (action: "soft-reload" | "update") => {
		setUpdatePopoverOpen(false);
		openConfirmModal(action);
	};

	const maintenanceBody = (
		<div className="flex flex-col gap-3.5 p-4">
			{info.isLoading && (
				<div className="flex items-center justify-center py-5">
					<Spinner className="text-panel-text-secondary" />
				</div>
			)}

			{info.isError && (
				<Alert
					variant="destructive"
					className="rounded-[12px] text-[12px]"
				>
					<CircleAlert className="size-4" aria-hidden="true" />
					<p className="text-[12px] leading-relaxed">
						{t("dashboard.maintenance.updateCheckFailed", {
							error:
								(info.error as Error)?.message ||
								t("dashboard.system.genericError"),
						})}
					</p>
				</Alert>
			)}

			<div className="flex items-center justify-between gap-3 rounded-[12px] bg-panel-elevated/60 px-3.5 py-2.5">
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="text-[11px] font-semibold text-panel-text-muted">
						{t("dashboard.maintenance.panelVersion")}
					</p>
					<p
						dir="ltr"
						className="truncate text-[13px] font-bold text-panel-text tabular-nums [unicode-bidi:isolate]"
					>
						{panel?.image
							? `${panel.image} (${currentVersion})`
							: currentVersion}
					</p>
				</div>
				{panel?.channel && (
					<span
						dir="ltr"
						className="shrink-0 rounded-full bg-panel-surface px-2.5 py-0.5 text-[11px] font-semibold text-panel-text-secondary [unicode-bidi:isolate]"
					>
						{panel.channel}
					</span>
				)}
			</div>

			{info.isSuccess && !hostActionsAvailable && (
				<Alert className="rounded-[12px] text-[12px]">
					<TriangleAlert className="size-4" aria-hidden="true" />
					<p className="text-[12px] leading-relaxed">
						{t("dashboard.maintenance.binaryMigrationRequired")}
					</p>
				</Alert>
			)}

			{update?.available && (
				<Alert className="rounded-[12px] border border-emerald-500/20 bg-emerald-500/8 px-3.5 py-2.5 text-[12px]">
					<CircleCheck
						className="size-4 text-emerald-600 dark:text-emerald-400"
						aria-hidden="true"
					/>
					<p className="text-[12px] leading-relaxed text-panel-text">
						{t("dashboard.maintenance.updateAvailableNotice", {
							current: update.current || currentVersion,
							target: selectedTarget || update.target || "-",
						})}
					</p>
				</Alert>
			)}

			{update?.error && (
				<Alert className="rounded-[12px] text-[12px]">
					<TriangleAlert className="size-4" aria-hidden="true" />
					<p className="text-[12px] leading-relaxed">
						{t("dashboard.maintenance.updateCheckFailed", {
							error: update.error,
						})}
					</p>
				</Alert>
			)}

			{hostActionsAvailable && (
				<Field className="flex flex-col gap-1.5">
					<FieldLabel className="text-[12px] font-semibold text-panel-text-secondary">
						{t("dashboard.maintenance.updateChannel")}
					</FieldLabel>
					<Select
						size="sm"
						portalled={false}
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
					<FieldDescription className="text-[11px] leading-relaxed text-panel-text-muted">
						{selectedTarget
							? t("dashboard.maintenance.updateTargetHint", {
									version: selectedTarget,
								})
							: t("dashboard.maintenance.updateTargetUnknown")}
					</FieldDescription>
				</Field>
			)}

			{hostActionsAvailable && (
				<BuildVersionSelect
					catalog={builds.data}
					value={selectedVersion}
					onChange={selectBuildVersion}
				/>
			)}

			{selectedChannel === "dev" && hostActionsAvailable && (
				<Alert className="rounded-[12px] border border-amber-500/20 bg-amber-500/8 px-3.5 py-2.5 text-[12px]">
					<TriangleAlert
						className="size-4 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
					<p className="text-[12px] leading-relaxed text-panel-text-secondary">
						{t("dashboard.maintenance.devChannelWarning")}
					</p>
				</Alert>
			)}
		</div>
	);

	const maintenanceFooterButtons = (
		<>
			<Button
				type="button"
				onClick={() => openConfirmFromPopover("soft-reload")}
				disabled={!hostActionsAvailable}
				variant="outline"
				size="sm"
				loading={reloadMutation.isPending}
				className="h-8 min-h-8 rounded-[10px] border border-panel-border! bg-panel-elevated/70 px-3.5 has-[>svg]:px-3.5 text-[12px] font-semibold leading-none text-panel-text shadow-none hover:bg-panel-elevated/70 dark:bg-panel-elevated/70 dark:hover:bg-panel-elevated/70 active:scale-[0.97] min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:dark:hover:bg-panel-elevated whitespace-nowrap"
			>
				<RotateCcw className="size-3.5 text-panel-text-secondary" />
				<span>{t("dashboard.maintenance.softReloadAction")}</span>
			</Button>
			<Button
				type="button"
				onClick={() => openConfirmFromPopover("update")}
				disabled={!hostActionsAvailable}
				size="sm"
				loading={updateMutation.isPending}
				className="h-8 min-h-8 rounded-[10px] border border-transparent bg-panel-accent px-3.5 has-[>svg]:px-3.5 text-[12px] font-semibold leading-none text-white shadow-none hover:bg-panel-accent active:scale-[0.97] min-[769px]:hover:bg-panel-accent-hover whitespace-nowrap"
			>
				<ArrowUpCircle className="size-3.5" />
				<span>{t("dashboard.maintenance.updateAction")}</span>
			</Button>
		</>
	);

	const maintenanceRefreshButton = (
		<Button
			type="button"
			onClick={() => info.refetch()}
			variant="ghost"
			size="sm"
			loading={info.isFetching}
			className="h-8 min-h-8 rounded-[10px] px-2.5 has-[>svg]:px-2.5 text-[12px] text-panel-text-muted active:scale-[0.97] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
		>
			<RefreshCw className="size-3.5" />
			<span>{t("refresh")}</span>
		</Button>
	);

	const renderUpdateTrigger = (onClick?: () => void) => (
		<Button
			type="button"
			onClick={onClick}
			disabled={!canMaintain || !hostActionsAvailable || info.isLoading}
			size="xs"
			variant={update?.available ? "default" : "outline"}
			className={cn(
				"h-9 w-full rounded-[12px] px-3.5 transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] min-[769px]:h-8 min-[769px]:w-auto whitespace-nowrap",
				update?.available
					? "border border-panel-accent! bg-panel-accent text-white shadow-[0_2px_10px_color-mix(in_srgb,var(--rb-panel-accent)_28%,transparent)] hover:bg-panel-accent min-[769px]:hover:bg-panel-accent-hover"
					: "border border-panel-border! bg-panel-surface text-panel-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-panel-surface dark:hover:bg-input/30 min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:dark:hover:bg-panel-elevated min-[769px]:hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
			)}
		>
			<span className="inline-flex items-center justify-center gap-1.5">
				<ArrowUpCircle
					strokeWidth={1.9}
					className={cn(
						"size-[13px] shrink-0",
						update?.available ? "text-white" : "text-panel-text-secondary",
					)}
				/>
				<span className="text-[12px] font-semibold leading-none">
					{update?.available
						? t("dashboard.maintenance.updateAvailable")
						: t("dashboard.maintenance.updateAction")}
				</span>
			</span>
		</Button>
	);

	const renderUpdatePopover = () =>
		isDesktop ? (
			<Popover open={isUpdatePopoverOpen} onOpenChange={setUpdatePopoverOpen}>
				<PopoverTrigger asChild>{renderUpdateTrigger()}</PopoverTrigger>
				<PopoverContent
					dir={isRTL ? "rtl" : "ltr"}
					align={isRTL ? "start" : "end"}
					sideOffset={8}
					collisionPadding={12}
					onClick={(e) => e.stopPropagation()}
					className="z-[2500] w-[min(400px,calc(100vw-24px))] max-w-[400px] max-h-[min(calc(var(--radix-popover-content-available-height,76dvh)-8px),calc(100dvh-24px))] overflow-y-auto overscroll-contain rounded-[20px] border border-panel-border! bg-panel-surface p-0 text-panel-text shadow-[0_20px_52px_-12px_rgba(0,0,0,0.46)]"
				>
					<div className="flex items-center justify-between gap-3 border-b border-panel-border/70! px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<ArrowUpCircle className="size-4 shrink-0 text-panel-text-secondary" />
							<p className="truncate text-[13px] font-bold tracking-[-0.01em] text-panel-text">
								{t("dashboard.maintenance.title")}
							</p>
						</div>
						{maintenanceRefreshButton}
					</div>
					{maintenanceBody}
					<div className="flex flex-wrap items-center justify-end gap-2 border-t border-panel-border/70! px-4 py-3">
						{maintenanceFooterButtons}
					</div>
				</PopoverContent>
			</Popover>
		) : (
			<>
				{renderUpdateTrigger(() => setUpdatePopoverOpen(true))}
				<Dialog open={isUpdatePopoverOpen} onOpenChange={setUpdatePopoverOpen}>
					<DialogContent
						dir={isRTL ? "rtl" : "ltr"}
						showCloseButton={false}
						className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-[420px] flex-col gap-0 overflow-hidden rounded-[20px] border border-panel-border! bg-panel-surface p-0 text-panel-text shadow-[0_24px_64px_-12px_rgba(0,0,0,0.48)] sm:w-full sm:max-w-[420px]"
					>
						<DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-panel-border/70! px-5 py-3.5 text-start">
							<div className="flex min-w-0 items-center gap-2.5">
								<ArrowUpCircle className="size-4 shrink-0 text-panel-text-secondary" />
								<DialogTitle className="truncate text-[14px] font-bold tracking-[-0.01em] text-panel-text">
									{t("dashboard.maintenance.title")}
								</DialogTitle>
								<DialogDescription className="sr-only">
									{t("dashboard.maintenance.title")}
								</DialogDescription>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{maintenanceRefreshButton}
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={() => setUpdatePopoverOpen(false)}
									aria-label={t("close")}
									className="size-8 shrink-0 rounded-[10px] text-panel-text-muted transition-[background-color,color,transform] duration-150 active:scale-[0.95] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
								>
									<X className="size-4" />
								</Button>
							</div>
						</DialogHeader>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
							{maintenanceBody}
						</div>
						<DialogFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t border-panel-border/70! px-5 py-3.5">
							{maintenanceFooterButtons}
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</>
		);

	const renderRestartButton = (extraClassName?: string) => (
		<Button
			type="button"
			onClick={() => openConfirmModal("restart")}
			disabled={info.isPending || !hostActionsAvailable}
			variant="outline"
			size="xs"
			loading={restartMutation.isPending}
			className={cn(
				"h-9 rounded-[12px] border border-panel-border! bg-panel-surface px-3.5 text-panel-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-panel-surface dark:hover:bg-input/30 active:scale-[0.97] min-[769px]:h-8 min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:dark:hover:bg-panel-elevated min-[769px]:hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] whitespace-nowrap",
				extraClassName,
			)}
		>
			<span className="inline-flex items-center justify-center gap-1.5">
				<RotateCw
					strokeWidth={1.9}
					className="size-[13px] shrink-0 text-red-600 dark:text-red-400"
				/>
				<span className="text-[12px] font-semibold leading-none text-red-600 dark:text-red-400">
					{t("dashboard.maintenance.restartAction")}
				</span>
			</span>
		</Button>
	);

	return (
		<div className="flex w-full min-[769px]:w-auto shrink-0 items-center justify-end">
			<div className="grid w-full grid-cols-2 gap-2 min-[769px]:flex min-[769px]:w-auto min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-end">
				{canMaintain && (
					<div className="col-span-2 min-[769px]:col-span-1">
						{renderUpdatePopover()}
					</div>
				)}
				{canBackUp && (
					<div className={cn("min-w-0", !canMaintain && "col-span-2")}>
						<DashboardBackupControls
							isBinaryRuntime={hostActionsAvailable}
							runtimeLoading={info.isLoading}
							className="w-full min-[769px]:w-auto"
						/>
					</div>
				)}
				{canMaintain &&
					renderRestartButton(
						cn(
							"w-full min-[769px]:w-auto",
							!canBackUp && "col-span-2 min-[769px]:col-span-1",
						),
					)}
			</div>

			<Dialog
				open={isUpdateDialogOpen}
				onOpenChange={(open) => {
					if (!open) setUpdateDialogOpen(false);
				}}
			>
				<DialogContent
					dir={isRTL ? "rtl" : "ltr"}
					showCloseButton={false}
					className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-[640px] flex-col gap-0 overflow-hidden rounded-[20px] border border-panel-border! bg-panel-surface p-0 text-panel-text shadow-[0_24px_64px_-12px_rgba(0,0,0,0.48)] sm:w-full sm:max-w-[640px]"
				>
					<DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-panel-border/70! px-5 py-3.5 text-start">
						<div className="flex min-w-0 items-center gap-2.5">
							<ArrowUpCircle className="size-4 shrink-0 text-panel-text-secondary" />
							<DialogTitle className="truncate text-[14px] font-bold tracking-[-0.01em] text-panel-text">
								{t("dashboard.maintenance.updateProgressTitle")}
							</DialogTitle>
							<DialogDescription className="sr-only">
								{t("dashboard.maintenance.updateProgressTitle")}
							</DialogDescription>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setUpdateDialogOpen(false)}
							aria-label={t("close")}
							className="size-8 shrink-0 rounded-[10px] text-panel-text-muted transition-[background-color,color,transform] duration-150 active:scale-[0.95] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							<X className="size-4" />
						</Button>
					</DialogHeader>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
						<div className="flex flex-col gap-3.5">
							<div className="flex flex-col gap-3 rounded-[14px] border border-panel-border/75! bg-panel-elevated/45 p-4">
								<div className="flex items-center justify-between gap-3">
									<div className="flex min-w-0 items-center gap-2">
										{operation?.error ? (
											<CircleAlert
												className="size-4 shrink-0 text-red-600 dark:text-red-400"
												aria-hidden="true"
											/>
										) : operation?.phase === "completed" ? (
											<CircleCheck
												className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
												aria-hidden="true"
											/>
										) : (
											<Spinner className="shrink-0 text-panel-text-secondary" />
										)}
										<p className="truncate text-[13px] font-bold text-panel-text">
											{operation?.phase
												? t(
														`dashboard.maintenance.phase.${operation.phase}`,
														operation.phase,
													)
												: t("dashboard.maintenance.phase.queued")}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-2.5 text-[12px]">
										<span
											dir="ltr"
											className="font-semibold text-panel-text-muted tabular-nums [unicode-bidi:isolate]"
										>
											{selectedTarget
												? `${currentVersion} → ${selectedTarget}`
												: currentVersion}
										</span>
										{typeof operation?.progress === "number" && (
											<span
												dir="ltr"
												className="font-bold text-panel-text tabular-nums [unicode-bidi:isolate]"
											>
												{Math.round(operation.progress)}%
											</span>
										)}
									</div>
								</div>
								<Progress
									value={
										typeof operation?.progress === "number"
											? operation.progress
											: undefined
									}
									className="h-1.5 rounded-full"
								/>
								<p className="text-[12px] leading-relaxed text-panel-text-secondary">
									{operation?.error
										? operation.error
										: operation?.message
											? t(
													`dashboard.maintenance.message.${operation.message.replace(/[^a-zA-Z]/g, "")}`,
													operation.message,
												)
											: t("dashboard.maintenance.message.preparingUpdate")}
								</p>
								{waitingForAPI && !operation?.error && (
									<p className="text-[11px] text-panel-text-muted">
										{t("dashboard.maintenance.autoRefreshAfterRestart")}
									</p>
								)}
							</div>

							<div className="flex flex-col overflow-hidden rounded-[14px] border border-panel-border/75! bg-panel-elevated/60">
								<div className="flex items-center justify-between gap-2 border-b border-panel-border/60! px-3.5 py-2">
									<div className="flex items-center gap-2 text-[12px] font-semibold text-panel-text-secondary">
										<Terminal className="size-3.5 text-panel-text-muted" />
										<span>{t("dashboard.maintenance.liveLogs")}</span>
									</div>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												aria-label={t("dashboard.maintenance.copyLogs")}
												onClick={() => {
													const logs = cleanTerminalOutput(operation?.logs);
													if (!logs) return;
													navigator.clipboard.writeText(logs);
													setLogsCopied(true);
													window.setTimeout(() => setLogsCopied(false), 2000);
												}}
												variant="ghost"
												size="xs"
												className="h-7 rounded-[8px] px-2 text-panel-text-muted active:scale-[0.96] min-[769px]:hover:text-panel-text"
											>
												{logsCopied ? (
													<Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
												) : (
													<Clipboard className="size-3.5" />
												)}
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{logsCopied
												? t("dashboard.maintenance.logsCopied")
												: t("dashboard.maintenance.copyLogs")}
										</TooltipContent>
									</Tooltip>
								</div>
								<pre
									ref={logsContainerRef}
									dir="ltr"
									className="max-h-[250px] min-h-[120px] overflow-auto p-3.5 font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-all text-panel-text"
								>
									{cleanTerminalOutput(operation?.logs) ||
										t("dashboard.maintenance.waitingForOutput")}
								</pre>
							</div>
						</div>
					</div>

					<DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-panel-border/70! px-5 py-3.5">
						<Button
							type="button"
							onClick={() => setUpdateDialogOpen(false)}
							variant="ghost"
							size="sm"
							className="h-9 rounded-[12px] px-4 text-[12px] font-semibold text-panel-text-muted hover:bg-transparent dark:hover:bg-transparent active:scale-[0.97] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							{t("close")}
						</Button>
						{(operation?.error || operation?.phase === "completed") && (
							<Button
								type="button"
								onClick={() => window.location.reload()}
								size="sm"
								className="h-9 rounded-[12px] px-4 text-[12px] font-semibold active:scale-[0.97]"
							>
								{t("refresh")}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={isConfirmOpen}
				onOpenChange={setIsConfirmOpen}
			>
				<DialogContent
					dir={isRTL ? "rtl" : "ltr"}
					showCloseButton={false}
					className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-[420px] flex-col gap-0 overflow-hidden rounded-[20px] border border-panel-border! bg-panel-surface p-0 text-panel-text shadow-[0_24px_64px_-12px_rgba(0,0,0,0.48)] sm:w-full sm:max-w-[420px]"
				>
					<DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-panel-border/70! px-5 py-3.5 text-start">
						<div className="flex min-w-0 items-center gap-2.5">
							{confirmAction === "restart" ? (
								<RotateCw className="size-4 shrink-0 text-panel-text-secondary" />
							) : confirmAction === "soft-reload" ? (
								<RotateCcw className="size-4 shrink-0 text-panel-text-secondary" />
							) : (
								<ArrowUpCircle className="size-4 shrink-0 text-panel-text-secondary" />
							)}
							<DialogTitle className="truncate text-[14px] font-bold tracking-[-0.01em] text-panel-text">
								{confirmAction === "restart"
									? t("dashboard.maintenance.restartConfirmTitle")
									: confirmAction === "soft-reload"
										? t("dashboard.maintenance.softReloadConfirmTitle")
										: t("dashboard.maintenance.updateConfirmTitle")}
							</DialogTitle>
							<DialogDescription className="sr-only">
								{confirmAction === "restart"
									? t("dashboard.maintenance.restartConfirmDescription")
									: confirmAction === "soft-reload"
										? t("dashboard.maintenance.softReloadConfirmDescription")
										: t("dashboard.maintenance.updateConfirmDescription", {
												target: selectedTarget || update?.target || "-",
											})}
							</DialogDescription>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setIsConfirmOpen(false)}
							aria-label={t("close")}
							className="size-8 shrink-0 rounded-[10px] text-panel-text-muted transition-[background-color,color,transform] duration-150 active:scale-[0.95] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							<X className="size-4" />
						</Button>
					</DialogHeader>

					<div className="flex flex-col gap-3 px-5 py-4">
						<p className="text-[13px] leading-relaxed text-panel-text-secondary">
							{confirmAction === "restart"
								? t("dashboard.maintenance.restartConfirmDescription")
								: confirmAction === "soft-reload"
									? t("dashboard.maintenance.softReloadConfirmDescription")
									: selectedChannel === "dev"
										? t("dashboard.maintenance.updateDevConfirmDescription")
										: t("dashboard.maintenance.updateConfirmDescription", {
												target: selectedTarget || update?.target || "-",
											})}
						</p>
						{confirmAction === "update" && (
							<div className="flex items-center justify-between gap-3 rounded-[12px] bg-panel-elevated/60 px-3.5 py-2.5 text-[12px]">
								<span className="font-semibold text-panel-text-muted">
									{t("dashboard.maintenance.panelVersion")}
								</span>
								<span
									dir="ltr"
									className="font-bold text-panel-text tabular-nums [unicode-bidi:isolate]"
								>
									{selectedTarget
										? `${currentVersion} → ${selectedTarget}`
										: currentVersion}
								</span>
							</div>
						)}
						{confirmAction === "update" && selectedVersion && (
							<Alert className="rounded-[12px] border border-amber-500/20 bg-amber-500/8 px-3.5 py-2.5 text-[12px]">
								<TriangleAlert
									className="size-4 text-amber-600 dark:text-amber-400"
									aria-hidden="true"
								/>
								<p className="text-[12px] leading-relaxed text-panel-text-secondary">
									{t("dashboard.maintenance.versionSwitchWarning")}
								</p>
							</Alert>
						)}
					</div>

					<DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-panel-border/70! px-5 py-3.5">
						<Button
							type="button"
							onClick={() => setIsConfirmOpen(false)}
							variant="ghost"
							size="sm"
							className="h-9 rounded-[12px] px-4 text-[12px] font-semibold text-panel-text-muted hover:bg-transparent dark:hover:bg-transparent active:scale-[0.97] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							{t("cancel")}
						</Button>
						<Button
							type="button"
							onClick={() => {
								const act = confirmAction;
								setIsConfirmOpen(false);
								if (act === "restart") restartMutation.mutate();
								if (act === "soft-reload") reloadMutation.mutate();
								if (act === "update") executeUpdate();
							}}
							size="sm"
							variant={confirmAction === "restart" ? "destructive" : "default"}
							loading={
								restartMutation.isPending ||
								reloadMutation.isPending ||
								updateMutation.isPending
							}
							className="h-9 rounded-[12px] px-5 text-[12px] font-semibold active:scale-[0.97]"
						>
							{t("confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};
