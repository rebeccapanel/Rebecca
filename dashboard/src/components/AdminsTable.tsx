import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "components/ui/dialog";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { toast } from "components/ui/sonner";
import { withClass } from "lib/withClass";
import { SlidersHorizontal, RefreshCw, Key, Pencil, Play, CirclePlus, ShieldCheck, Trash2, Ban, History, Tags } from "lucide-react";
import { LabelsDialog } from "components/labels/LabelsDialog";
import { TagChips } from "components/labels/TagChips";

import { useDisclosure } from "hooks/useDisclosure";
import { useIntervalRefresh } from "hooks/useIntervalRefresh";

import { useBreakpointValue } from "hooks/useBreakpointValue";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import type { SortingState } from "@tanstack/react-table";
import { useAdminsStore } from "contexts/AdminsContext";
import { AddTrafficDialog } from "components/AddTrafficDialog";
import { AdminsOverviewBand } from "components/admins/AdminsOverviewBand";
import { adminsOverviewSelection, nextAdminsFiltersForOverview } from "utils/adminsOverview";
import { DataTableColumnMenu } from "components/ui/DataTableColumnMenu";
import { RefreshSplitButton } from "components/users/RefreshSplitButton";
import { useContainerMinWidths } from "hooks/useContainerMinWidths";
import useGetUser from "hooks/useGetUser";
import {
	type FC,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type { Admin } from "types/Admin";
import {
	AdminManagementPermission,
	AdminRole,
	AdminStatus,
	AdminTrafficLimitMode,
} from "types/Admin";
import { formatBytes } from "utils/formatByte";
import { summarizeAdmins } from "utils/resourceSummary";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { copyTextToClipboard } from "utils/clipboard";
import { AdminApiKeysDialog } from "./AdminApiKeysDialog";
import { AdminDetailsPanel } from "./AdminDetailsPanel";
import AdminPermissionsModal from "./AdminPermissionsModal";
import { AdminSecurityDialog } from "./AdminSecurityDialog";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { UserExpiryCountdown, UserUsageBar } from "./users";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
} from "./ui";

const ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted";
const ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY = "admin_time_limit_exhausted";
const QUICK_ACTIONS_MIN_TABLE_WIDTH = 1250;
const SPEED_MIN_TABLE_WIDTH = 1280;
type AdminSpeedMap = Record<
	string,
	{ upload_speed: number; download_speed: number }
>;

const ResetIcon = withClass(RefreshCw, "[stroke-width:2px] w-3 h-3");
const DisableIcon = withClass(Ban, "[stroke-width:2px] w-3 h-3");
const EnableIcon = withClass(Play, "[stroke-width:2px] w-3 h-3");
const DeleteIcon = withClass(Trash2, "[stroke-width:2px] w-3 h-3");
const QuickPassIcon = withClass(Key, "[stroke-width:2px] w-3 h-3");
const TrafficIcon = withClass(CirclePlus, "[stroke-width:2px] w-3 h-3");

const AdminStatusBadge: FC<{ status: AdminStatus }> = ({ status }) => {
	const { t } = useTranslation();

	return (
		<p className={cn("text-[0.875rem] font-semibold capitalize", status === AdminStatus.Active ? "text-green-400" : "text-red-400")}>
			{status === AdminStatus.Active
				? t("status.active")
				: t("admins.disabledLabel")}
		</p>
	);
};

const AdminRoleBadge: FC<{ role: AdminRole }> = ({ role }) => {
	const { t } = useTranslation();
	const roleStyles = {
		[AdminRole.FullAccess]: {
			color: "text-yellow-800",
			darkColor: "dark:text-yellow-200",
			label: t("admins.roles.fullAccess"),
		},
		[AdminRole.Sudo]: {
			color: "text-purple-800",
			darkColor: "dark:text-purple-200",
			label: t("admins.roles.sudo"),
		},
		[AdminRole.Reseller]: {
			color: "text-blue-800",
			darkColor: "dark:text-blue-200",
			label: t("admins.roles.reseller"),
		},
		[AdminRole.Standard]: {
			color: "text-gray-800",
			darkColor: "dark:text-gray-200",
			label: t("admins.roles.standard"),
		},
	}[role];

	return (
		<span className={cn(roleStyles.color, roleStyles.darkColor, "text-[0.75rem] font-medium")}>
			{roleStyles.label}
		</span>
	);
};

const pickLeader = (list: Admin[], value: (admin: Admin) => number) => {
	let best: { username: string; value: number } | null = null;
	for (const admin of list) {
		const current = value(admin);
		if (current > 0 && (!best || current > best.value)) best = { username: admin.username, value: current };
	}
	return best;
};

const formatCount = (value: number | null | undefined, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value ?? 0);

const getAdminEffectiveUsage = (admin: Admin) =>
	admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
		? (admin.created_traffic ?? 0)
		: (admin.users_usage ?? 0);

const getAdminIsExpired = (admin: Admin, nowUnix: number) =>
	admin.disabled_reason === ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY ||
	(typeof admin.expire === "number" &&
		admin.expire > 0 &&
		admin.expire <= nowUnix);

const getAdminIsLimited = (admin: Admin) =>
	admin.disabled_reason === ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY ||
	(admin.data_limit !== null &&
		admin.data_limit !== undefined &&
		admin.data_limit > 0 &&
		getAdminEffectiveUsage(admin) >= admin.data_limit);

type AdminsTableProps = ComponentPropsWithoutRef<"table"> & {
	toolbar?: ReactNode;
	headerActions?: ReactNode;
};

export const AdminsTable: FC<AdminsTableProps> = ({
	toolbar,
	headerActions,
	...props
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const locale = i18n.language || "en";
	
	const { userData } = useGetUser();
	const dialogBg = "bg-surface-light dark:bg-surface-dark";
	const dialogBorderColor = "border-light-border! dark:border-gray-700!";
	const adminOptions = useAdminsStore((state) => state.adminOptions);
	const admins = useAdminsStore((state) => state.admins);
	const loading = useAdminsStore((state) => state.loading);
	const total = useAdminsStore((state) => state.total);
	const filters = useAdminsStore((state) => state.filters);
	const onFilterChange = useAdminsStore((state) => state.onFilterChange);
	const fetchAdmins = useAdminsStore((state) => state.fetchAdmins);
	const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
	const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5_000);
	useIntervalRefresh(autoRefreshInterval, true, () => void fetchAdmins(undefined, { force: true }));
	const deleteAdmin = useAdminsStore((state) => state.deleteAdmin);
	const resetUsage = useAdminsStore((state) => state.resetUsage);
	const resetDeletedUsersUsage = useAdminsStore(
		(state) => state.resetDeletedUsersUsage,
	);
	const disableAdmin = useAdminsStore((state) => state.disableAdmin);
	const enableAdmin = useAdminsStore((state) => state.enableAdmin);
	const fetchAdminOptions = useAdminsStore((state) => state.fetchAdminOptions);
	const updateAdmin = useAdminsStore((state) => state.updateAdmin);
	const openAdminDialog = useAdminsStore((state) => state.openAdminDialog);
	const {
		isOpen: isDisableDialogOpen,
		onOpen: openDisableDialog,
		onClose: closeDisableDialog,
	} = useDisclosure();
	const {
		isOpen: isDeleteDialogOpen,
		onOpen: openDeleteDialog,
		onClose: closeDeleteDialog,
	} = useDisclosure();
	const {
		isOpen: isPermissionsModalOpen,
		onOpen: openPermissionsModal,
		onClose: closePermissionsModal,
	} = useDisclosure();
	const [adminToDisable, setAdminToDisable] = useState<Admin | null>(null);
	const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
	const [disableReason, setDisableReason] = useState("");
	const [actionState, setActionState] = useState<{
		type:
			| "reset"
			| "resetDeleted"
			| "disableAdmin"
			| "enableAdmin"
			| "quickPassword"
			| "deleteAdmin";
		username: string;
	} | null>(null);
	const [adminForPermissions, setAdminForPermissions] = useState<Admin | null>(
		null,
	);
	const [contextAction, setContextAction] = useState<string | null>(null);
	const [trafficAdmin, setTrafficAdmin] = useState<Admin | null>(null);
	const [quickPassInfo, setQuickPassInfo] = useState<{
		username: string;
		password: string;
	} | null>(null);
	const [selectedAdminUsernames, setSelectedAdminUsernames] = useState<
		string[]
	>([]);
	const {
		isOpen: isQuickPassOpen,
		onOpen: openQuickPassModal,
		onClose: closeQuickPassModal,
	} = useDisclosure();
	const {
		isOpen: isQuickPassConfirmOpen,
		onOpen: openQuickPassConfirm,
		onClose: closeQuickPassConfirm,
	} = useDisclosure();
	const [quickPassAdmin, setQuickPassAdmin] = useState<Admin | null>(null);
	const [resetConfirmation, setResetConfirmation] = useState<{
		admin: Admin;
		type: "usage" | "deleted";
	} | null>(null);
	const [securityAdmin, setSecurityAdmin] = useState<Admin | null>(null);
	const [labelsAdmin, setLabelsAdmin] = useState<Admin | null>(null);
	const securityDialog = useDisclosure();
	const [apiKeysAdmin, setAPIKeysAdmin] = useState<Admin | null>(null);
	const apiKeysDialog = useDisclosure();

	const currentAdminUsername = userData.username;
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const canManageAPIKeys = hasFullAccess || userData.role === AdminRole.Sudo;
	const adminManagement = userData.permissions?.admin_management;
	const canEditAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.Edit] || hasFullAccess,
	);
	const canManageSudoAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.ManageSudo] || hasFullAccess,
	);
	const canManageSessions = Boolean(
		adminManagement?.[AdminManagementPermission.ManageSessions] ||
			hasFullAccess,
	);
	const canManage2FA = Boolean(
		adminManagement?.[AdminManagementPermission.Manage2FA] || hasFullAccess,
	);
	const canManageSecurityFor = (target: Admin) => {
		if (hasFullAccess) return true;
		if (target.role === AdminRole.FullAccess) return false;
		if (target.role === AdminRole.Sudo && !canManageSudoAdmins) return false;
		return canManageSessions || canManage2FA;
	};
	const canManageAPIKeysFor = (target: Admin) =>
		canManageAPIKeys && target.role !== AdminRole.FullAccess;
	const canManageAdminAccount = (target: Admin) => {
		if (target.username === currentAdminUsername) {
			return true;
		}
		if (target.role === AdminRole.FullAccess) {
			return false;
		}
		if (!canEditAdmins) {
			return false;
		}
		if (target.role === AdminRole.Sudo) {
			return canManageSudoAdmins;
		}
		return true;
	};
	const visibleAdminUsernameSet = useMemo(
		() => new Set(admins.map((admin) => admin.username)),
		[admins],
	);
	const selectedAdmins = useMemo(
		() =>
			admins.filter((admin) => selectedAdminUsernames.includes(admin.username)),
		[admins, selectedAdminUsernames],
	);

	useEffect(() => {
		setSelectedAdminUsernames((current) =>
			current.filter((username) => visibleAdminUsernameSet.has(username)),
		);
	}, [visibleAdminUsernameSet]);

	const handleDeleteAdmin = async (admin: Admin) => {
		try {
			await deleteAdmin(admin.username);
			generateSuccessMessage(t("admins.deleteSuccess"), toast);
			fetchAdmins();
			return true;
		} catch (error) {
			generateErrorMessage(error, toast);
			return false;
		}
	};

	const runResetUsage = async (admin: Admin) => {
		setActionState({ type: "reset", username: admin.username });
		try {
			await resetUsage(admin.username);
			generateSuccessMessage(t("admins.resetUsageSuccess"), toast);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
	};

	const runResetDeletedUsersUsage = async (admin: Admin) => {
		setActionState({ type: "resetDeleted", username: admin.username });
		try {
			await resetDeletedUsersUsage(admin.username);
			generateSuccessMessage(t("admins.resetDeletedUsageSuccess"), toast);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
	};

	const confirmUsageReset = async () => {
		if (!resetConfirmation) return;
		if (resetConfirmation.type === "deleted") {
			await runResetDeletedUsersUsage(resetConfirmation.admin);
		} else {
			await runResetUsage(resetConfirmation.admin);
		}
		setResetConfirmation(null);
	};

	const startDisableAdmin = (admin: Admin) => {
		setAdminToDisable(admin);
		setDisableReason("");
		openDisableDialog();
	};

	const closeDisableDialogAndReset = () => {
		closeDisableDialog();
		setAdminToDisable(null);
		setDisableReason("");
	};

	const handleOpenPermissionsModal = (admin: Admin) => {
		setAdminForPermissions(admin);
		openPermissionsModal();
	};

	const handleClosePermissionsModal = () => {
		setAdminForPermissions(null);
		closePermissionsModal();
	};

	const closeDeleteDialogAndReset = () => {
		closeDeleteDialog();
		setAdminToDelete(null);
	};
	const startDeleteAdmin = (admin: Admin) => {
		setAdminToDelete(admin);
		openDeleteDialog();
	};
	const confirmDeleteAdmin = async () => {
		if (!adminToDelete) {
			return;
		}
		setActionState({ type: "deleteAdmin", username: adminToDelete.username });
		try {
			const deleted = await handleDeleteAdmin(adminToDelete);
			if (deleted) {
				closeDeleteDialogAndReset();
			}
		} finally {
			setActionState(null);
		}
	};
	const handleCloseQuickPass = () => {
		setQuickPassInfo(null);
		closeQuickPassModal();
	};

	useEffect(() => {
		fetchAdminOptions(undefined, { force: false });
	}, [fetchAdminOptions]);

	const handleAddTrafficToAdmin = async (admin: Admin, deltaBytes: number) => {
		try {
			await updateAdmin(admin.username, { data_limit: (admin.data_limit ?? 0) + deltaBytes });
			generateSuccessMessage(t("admins.addTrafficSuccess"), toast);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
			throw error;
		}
	};

	const generateRandomPassword = (length = 12) => {
		const characters =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const charactersLength = characters.length;
		let result = "";
		for (let i = 0; i < length; i += 1) {
			const randomIndex = Math.floor(Math.random() * charactersLength);
			result += characters[randomIndex];
		}
		return result;
	};

	const confirmDisableAdmin = async () => {
		if (!adminToDisable) {
			return;
		}
		const reason = disableReason.trim();
		if (reason.length < 3) {
			return;
		}
		setActionState({ type: "disableAdmin", username: adminToDisable.username });
		try {
			await disableAdmin(adminToDisable.username, reason);
			generateSuccessMessage(t("admins.disableAdminSuccess"), toast);
			closeDisableDialogAndReset();
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
	};

	const handleQuickPassword = async (admin: Admin) => {
		if (!canManageAdminAccount(admin)) {
			return;
		}
		setQuickPassAdmin(admin);
		openQuickPassConfirm();
	};

	const confirmQuickPassword = async () => {
		if (!quickPassAdmin) return;
		setContextAction("quickPassword");
		const newPassword = generateRandomPassword(12);
		try {
			await updateAdmin(quickPassAdmin.username, { password: newPassword });
			setQuickPassInfo({
				username: quickPassAdmin.username,
				password: newPassword,
			});
			closeQuickPassConfirm();
			setQuickPassAdmin(null);
			openQuickPassModal();
			generateSuccessMessage(t("admins.quickPasswordSuccess"), toast);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setContextAction(null);
		}
	};

	const handleEnableAdmin = async (admin: Admin) => {
		setActionState({ type: "enableAdmin", username: admin.username });
		try {
			await enableAdmin(admin.username);
			generateSuccessMessage(t("admins.enableAdminSuccess"), toast);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
	};
	const getAdminRowMeta = (admin: Admin) => {
		const canManage = canManageAdminAccount(admin);
		const canChangeStatus =
			canManage && admin.username !== currentAdminUsername;
		const hasDataLimitDisabledReason =
			admin.disabled_reason === ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY;
		const hasTimeLimitDisabledReason =
			admin.disabled_reason === ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY;
		const disabledReasonLabel = admin.disabled_reason
			? hasDataLimitDisabledReason
				? t("admins.disabledReason.dataLimitExceeded")
				: hasTimeLimitDisabledReason
					? t("admins.disabledReason.timeLimitExceeded")
					: admin.disabled_reason
			: null;
		return {
			canManage,
			showDisable: canChangeStatus && admin.status !== AdminStatus.Disabled,
			showEnable: canChangeStatus && admin.status === AdminStatus.Disabled,
			enableBlocked:
				getAdminIsLimited(admin) ||
				getAdminIsExpired(admin, Math.floor(Date.now() / 1000)),
			showDelete: canChangeStatus,
			showAddTraffic:
				canManage &&
				admin.data_limit !== null &&
				admin.data_limit !== 0 &&
				admin.data_limit !== undefined,
			hasDataLimitDisabledReason,
			hasTimeLimitDisabledReason,
			disabledReasonLabel,
		};
	};
	const { className, ...restProps } = props;
	const baseTableSx: Record<string, unknown> = {
		width: "100%",
		"& th, & .rb-data-table-row > td": {
			whiteSpace: "nowrap",
			paddingInline: "clamp(6px, 0.8vw, 14px) !important",
			verticalAlign: "middle",
		},
		"& th.rb-select-cell, & td.rb-select-cell, & th.rb-actions-cell, & td.rb-actions-cell":
			{
				paddingInline: "4px !important",
			},
		"& th[data-col='quick_actions'], & td[data-col='quick_actions']": {
			paddingInlineEnd: "0px !important",
		},
	};
	const tableClassName = isRTL
		? cn(className, "rb-rtl-table")
		: className;
	const tableProps = {
		...restProps,
		className: tableClassName,
		sx: { ...baseTableSx },
	};

	const summaryData = useMemo(() => {
		const hasCompleteSummary =
			adminOptions.length > 0 || total <= admins.length;
		const summaryAdmins = hasCompleteSummary
			? adminOptions.length
				? adminOptions
				: admins
			: [];
		const nowUnix = Math.floor(Date.now() / 1000);
		const expiredCount = summaryAdmins.filter((admin) =>
			getAdminIsExpired(admin, nowUnix),
		).length;
		const limitedCount = summaryAdmins.filter(
			(admin) => !getAdminIsExpired(admin, nowUnix) && getAdminIsLimited(admin),
		).length;
		const totals = hasCompleteSummary ? summarizeAdmins(summaryAdmins) : null;
		return {
			totalCount: adminOptions.length || total,
			topUsage: totals ? pickLeader(summaryAdmins, getAdminEffectiveUsage) : null,
			topUsers: totals ? pickLeader(summaryAdmins, (admin) => admin.users_count ?? 0) : null,
			topOnline: totals ? pickLeader(summaryAdmins, (admin) => admin.online_users ?? 0) : null,
			usersTotal: totals ? totals.users : null,
			onlineUsersTotal: totals ? totals.online : null,
			usageTotal: totals ? totals.usage : null,
			fullAccessCount: hasCompleteSummary
				? summaryAdmins.filter((admin) => admin.role === AdminRole.FullAccess)
						.length
				: null,
			sudoCount: hasCompleteSummary
				? summaryAdmins.filter((admin) => admin.role === AdminRole.Sudo).length
				: null,
			resellerCount: hasCompleteSummary
				? summaryAdmins.filter((admin) => admin.role === AdminRole.Reseller)
						.length
				: null,
			standardCount: hasCompleteSummary
				? summaryAdmins.filter((admin) => admin.role === AdminRole.Standard)
						.length
				: null,
			activeCount: hasCompleteSummary
				? summaryAdmins.filter(
						(admin) =>
							admin.status === AdminStatus.Active &&
							!getAdminIsExpired(admin, nowUnix) &&
							!getAdminIsLimited(admin),
					).length
				: null,
			expiredCount: hasCompleteSummary ? expiredCount : null,
			limitedCount: hasCompleteSummary ? limitedCount : null,
			disabledCount: hasCompleteSummary
				? summaryAdmins.filter(
						(admin) =>
							admin.status === AdminStatus.Disabled &&
							!getAdminIsExpired(admin, nowUnix) &&
							!getAdminIsLimited(admin),
					).length
				: null,
		};
	}, [adminOptions, admins, total]);

	const skeletonCount = filters.limit || 5;
	const adminSorting = useMemo<SortingState>(() => {
		const currentSort = filters.sort || "";
		const desc = currentSort.startsWith("-");
		const id = desc ? currentSort.slice(1) : currentSort;
		return id ? [{ id, desc }] : [];
	}, [filters.sort]);

	const isWide = useBreakpointValue({ base: false, xl: true }) ?? false;
	const [adminSpeeds, setAdminSpeeds] = useState<AdminSpeedMap>({});
	useEffect(() => {
		let active = true;
		const loadSpeeds = () => {
			fetch<AdminSpeedMap>("/admins/speeds")
				.then((data) => {
					if (active) setAdminSpeeds(data || {});
				})
				.catch(() => undefined);
		};
		loadSpeeds();
		const timer = window.setInterval(loadSpeeds, 5000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, []);
	const [tableSectionRef, [, showSpeed]] =
		useContainerMinWidths(QUICK_ACTIONS_MIN_TABLE_WIDTH, SPEED_MIN_TABLE_WIDTH);
	const rowActionsRef = useRef<(admin: Admin) => DataTableRowAction<Admin>[]>(
		() => [],
	);

	const adminColumns = useMemo<DataTableColumn<Admin>[]>(
		() => [
			{
				id: "username",
				width: "140px",
				minWidth: "136px",
				maxWidth: "176px",
				header: t("username"),
				menuLabel: t("username"),
				accessor: "username",
				sortable: true,
				isPrimary: true,
				priority: "primary",
				truncate: true,
				tooltip: true,
				cellAlign: "start",
				mobilePriority: 0,
				mobileMetaLabel: t("username"),
				cell: (admin) => (
					<p dir="ltr" className="font-semibold truncate max-w-[10rem] [unicode-bidi:isolate] text-panel-text">
						{admin.username}
					</p>
				),
			},
			{
				id: "status",
				width: "104px",
				minWidth: "96px",
				maxWidth: "120px",
				header: t("status"),
				menuLabel: t("status"),
				priority: "high",
				headerAlign: "center",
				mobilePriority: 1,
				mobileMetaLabel: t("status"),
				cell: (admin) => <AdminStatusBadge status={admin.status} />,
			},
			{
				id: "group",
				width: "120px",
				minWidth: "96px",
				maxWidth: "150px",
				header: t("groups.group"),
				menuLabel: t("groups.group"),
				priority: "medium",
				truncate: true,
				tooltip: true,
				accessor: (admin) => admin.group?.name ?? "",
				mobilePriority: 3,
				mobileMetaLabel: t("groups.group"),
				cell: (admin) => (
					<p className={cn("text-[0.875rem] truncate max-w-full", admin.group ? "text-panel-text" : "text-panel-text-muted")}>
						{admin.group?.name ?? "–"}
					</p>
				),
			},
			{
				id: "tags",
				width: "170px",
				minWidth: "120px",
				maxWidth: "220px",
				header: t("tags.title"),
				menuLabel: t("tags.title"),
				priority: "low",
				mobilePriority: 4,
				mobileMetaLabel: t("tags.title"),
				cell: (admin) => <TagChips tags={admin.tags} limit={2} />,
			},
			{
				id: "role",
				width: "104px",
				minWidth: "92px",
				maxWidth: "120px",
				header: t("core.role"),
				menuLabel: t("core.role"),
				priority: "medium",
				mobilePriority: 2,
				mobileMetaLabel: t("core.role"),
				cell: (admin) => <AdminRoleBadge role={admin.role} />,
			},
			{
				id: "users_count",
				width: "92px",
				minWidth: "84px",
				maxWidth: "112px",
				header: t("admins.details.activeLabel"),
				menuLabel: t("admins.details.activeLabel"),
				sortable: true,
				priority: "high",
				headerAlign: "center",
				mobilePriority: 3,
				mobileMetaLabel: t("admins.details.activeLabel"),
				cell: (admin) => (
					<p dir="ltr" className="text-[0.875rem] font-semibold [unicode-bidi:isolate]">
						{formatCount(admin.active_users ?? 0, locale)}
						<span className="text-panel-text-muted font-medium">
							/{formatCount(admin.users_count ?? 0, locale)}
						</span>
					</p>
				),
			},
			{
				id: "online",
				width: "72px",
				minWidth: "68px",
				maxWidth: "80px",
				header: t("admins.details.onlineLabel"),
				menuLabel: t("admins.details.onlineLabel"),
				priority: "medium",
				headerAlign: "center",
				mobilePriority: 4,
				mobileMetaLabel: t("admins.details.onlineLabel"),
				cell: (admin) => (
					<p className="text-[0.875rem] text-green-600 dark:text-green-400 font-semibold">
						{formatCount(admin.online_users ?? 0, locale)}
					</p>
				),
			},
			{
				id: "services",
				width: "104px",
				minWidth: "92px",
				maxWidth: "116px",
				header: t("services.title"),
				menuLabel: t("services.title"),
				priority: "medium",
				desktopVisible: isWide,
				mobilePriority: 5,
				mobileMetaLabel: t("services.title"),
				cell: (admin) => (
					<p className="text-[0.875rem] truncate">
						{admin.services?.length
							? formatCount(admin.services.length, locale)
							: t("filters.advanced.serviceAll")}
					</p>
				),
			},
			{
				id: "data_usage",
				width: "clamp(180px, 14vw, 220px)",
				minWidth: "180px",
				maxWidth: "220px",
				header: t("usersTable.traffic"),
				menuLabel: t("usersTable.traffic"),
				sortable: true,
				priority: "high",
				cellAlign: "start",
				mobilePriority: 6,
				mobileSummary: true,
				mobileMetaLabel: t("usersTable.traffic"),
				cell: (admin) => (
					<div className="w-full min-w-0">
						<UserUsageBar
							variant="stacked"
							used={getAdminEffectiveUsage(admin)}
							total={admin.data_limit ?? null}
						/>
					</div>
				),
			},
			{
				id: "speed",
				width: "112px",
				minWidth: "104px",
				maxWidth: "128px",
				header: t("summary.speed"),
				menuLabel: t("summary.speed"),
				priority: "medium",
				desktopVisible: showSpeed,
				hideOnMobile: true,
				cell: (admin) => {
					const speed = adminSpeeds[String(admin.id)];
					return (
						<div dir="ltr" className="flex flex-col gap-0 whitespace-nowrap text-[0.75rem] [font-variant-numeric:tabular-nums] [unicode-bidi:isolate]">
							<p className="text-teal-400">
								↑ {formatBytes(speed?.upload_speed ?? 0)}/s
							</p>
							<p className="text-blue-400">
								↓ {formatBytes(speed?.download_speed ?? 0)}/s
							</p>
						</div>
					);
				},
			},
			{
				id: "remaining_traffic",
				width: "120px",
				minWidth: "108px",
				maxWidth: "132px",
				header: t("usersTable.remainingTraffic"),
				menuLabel: t("usersTable.remainingTraffic"),
				priority: "medium",
				desktopVisible: isWide,
				mobilePriority: 7,
				mobileMetaLabel: t("usersTable.remainingTraffic"),
				cell: (admin) => (
					<p dir="ltr" className={cn("leading-[1]", !admin.data_limit ? "text-[1.25rem]" : "text-[0.875rem]", !admin.data_limit ? "font-semibold" : "", !admin.data_limit ? "text-panel-text-muted" : "text-panel-text")}>
						{!admin.data_limit
							? <><span aria-hidden="true">∞</span><span className="sr-only">{t("unlimited")}</span></>
							: formatBytes(
									Math.max(admin.data_limit - getAdminEffectiveUsage(admin), 0),
								)}
					</p>
				),
			},
			{
				id: "expire",
				width: "120px",
				minWidth: "108px",
				maxWidth: "132px",
				header: t("expire"),
				menuLabel: t("expire"),
				priority: "medium",
				mobilePriority: 8,
				mobileMetaLabel: t("expire"),
				cell: (admin) => <UserExpiryCountdown expire={admin.expire} />,
			},
		],
		[adminSpeeds, isWide, showSpeed, locale, t],
	);

	const adminRowActions = (admin: Admin): DataTableRowAction<Admin>[] => {
		const meta = getAdminRowMeta(admin);
		const actions: DataTableRowAction<Admin>[] = [];

		if (meta.canManage) {
			actions.push(
				{
					id: "edit",
					pinned: true,
					label: t("edit"),
					icon: <Pencil className="w-[16px]" />,
					onClick: () => openAdminDialog(admin),
				},
				{
					id: "labels",
					label: t("labels.menu"),
					icon: <Tags className="w-[16px]" />,
					onClick: () => setLabelsAdmin(admin),
				},
				{
					id: "history",
					label: t("adminHistory.tab"),
					icon: <History className="w-[16px]" />,
					onClick: () => openAdminDialog(admin, "history"),
				},
				{
					id: "permissions",
					pinned: true,
					label: t("admins.editPermissionsButton"),
					icon: <SlidersHorizontal className="w-[16px]" />,
					onClick: () => handleOpenPermissionsModal(admin),
				},
				{
					id: "reset",
					label: t("admins.resetUsage"),
					icon: <ResetIcon />,
					onClick: () => setResetConfirmation({ admin, type: "usage" }),
					disabled:
						actionState?.username === admin.username &&
						actionState?.type === "reset",
				},
			);
		}

		if (canManageSecurityFor(admin)) {
			actions.push({
				id: "security",
				label: t("admins.security.action"),
				icon: <ShieldCheck className="w-[16px]" />,
				onClick: () => {
					setSecurityAdmin(admin);
					securityDialog.onOpen();
				},
			});
		}

		if (canManageAPIKeysFor(admin)) {
			actions.push({
				id: "apiKeys",
				label: t("admins.apiKeys.action"),
				icon: <Key className="w-[16px]" />,
				onClick: () => {
					setAPIKeysAdmin(admin);
					apiKeysDialog.onOpen();
				},
			});
		}

		if (meta.canManage && (admin.deleted_users_usage ?? 0) > 0) {
			actions.push({
				id: "resetDeleted",
				label: t("admins.resetDeletedUsage"),
				icon: <QuickPassIcon />,
				onClick: () => setResetConfirmation({ admin, type: "deleted" }),
				disabled:
					actionState?.username === admin.username &&
					actionState?.type === "resetDeleted",
			});
		}

		if (meta.showEnable) {
			actions.push({
				id: "enable",
				pinned: true,
				label: t("admins.enableAdmin"),
				icon: <EnableIcon />,
				onClick: () => handleEnableAdmin(admin),
				disabled:
					meta.enableBlocked ||
					(actionState?.username === admin.username &&
						actionState?.type === "enableAdmin"),
				disabledReason: meta.enableBlocked
					? t("admins.enableBlockedByLimits")
					: undefined,
			});
		}

		if (meta.showDisable) {
			actions.push({
				id: "disable",
				pinned: true,
				label: t("admins.disableAdmin"),
				icon: <DisableIcon />,
				onClick: () => startDisableAdmin(admin),
				disabled:
					actionState?.username === admin.username &&
					actionState?.type === "disableAdmin",
			});
		}

		if (meta.showAddTraffic) {
			actions.push({
				id: "addTraffic",
				label: t("services.userActions.traffic.add"),
				icon: <TrafficIcon />,
				onClick: () => setTrafficAdmin(admin),
			});
		}

		if (meta.canManage) {
			actions.push({
				id: "quickPassword",
				label: t("admins.quickPassword"),
				icon: <QuickPassIcon />,
				onClick: () => handleQuickPassword(admin),
				disabled: contextAction === "quickPassword",
			});
		}

		if (meta.showDelete) {
			actions.push({
				id: "delete",
				pinned: true,
				label: t("delete"),
				icon: <DeleteIcon />,
				onClick: () => startDeleteAdmin(admin),
				disabled:
					actionState?.username === admin.username &&
					actionState?.type === "deleteAdmin",
				isDanger: true,
			});
		}

		return actions;
	};
	rowActionsRef.current = adminRowActions;

	const [expandedAdminUsername, setExpandedAdminUsername] = useState<string | null>(null);
	const isDesktop = useBreakpointValue({ base: false, md: true }) ?? false;
	const renderExpandedAdmin = (admin: Admin) => {
		const actions = adminRowActions(admin).filter(Boolean);
		return (
			<div className="rb-resource-expanded">
				<AdminDetailsPanel
					admin={admin}
					actions={
						// biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control
							// biome-ignore lint/a11y/useKeyWithClickEvents: same wrapper, no key action
							<div onClick={(event) => event.stopPropagation()} className="flex items-center justify-end gap-1 flex-wrap rb-resource-expanded-actions">
							<div className="flex flex-row items-center gap-1 flex-wrap rb-inline-actions">
								{actions.map((action) => (
									<Tooltip key={action.id}>
<TooltipTrigger asChild>
										<span>
											<Button aria-label={String(action.label)} disabled={typeof action.disabled === "function" ? action.disabled(admin) : action.disabled} onClick={() => action.onClick?.(admin)} variant="ghost" size="sm" className={cn("size-8 p-0", "min-w-[30px]! h-[30px]")}>{action.icon}</Button>
										</span>
									</TooltipTrigger>
<TooltipContent>{action.label}</TooltipContent>
</Tooltip>
								))}
							</div>
						</div>
					}
				/>
			</div>
		);
	};

	return (
		<>
			<div className="flex flex-col gap-3">
				<div className="overflow-hidden rounded-xl border border-panel-border! bg-panel-surface">
					<AdminsOverviewBand
						total={summaryData.totalCount}
						topUsage={summaryData.topUsage}
						topUsers={summaryData.topUsers}
						topOnline={summaryData.topOnline}
						active={summaryData.activeCount}
						expired={summaryData.expiredCount}
						limited={summaryData.limitedCount}
						disabled={summaryData.disabledCount}
						fullAccess={summaryData.fullAccessCount}
						sudo={summaryData.sudoCount}
						reseller={summaryData.resellerCount}
						standard={summaryData.standardCount}
						locale={locale}
					selection={adminsOverviewSelection(filters)}
					onSelect={(target) => onFilterChange(nextAdminsFiltersForOverview(filters, target))}
					/>
					<div className="border-t border-panel-border! p-3">
						<div className="flex flex-wrap items-center gap-2">
							<div className="max-sm:contents sm:flex-[1_1_240px] min-w-0!">{toolbar}</div>
							<div className="flex flex-row items-center gap-1 shrink-0">
								<DataTableColumnMenu columns={adminColumns} visibility={columnVisibility} onChange={setColumnVisibility} />
								<RefreshSplitButton
									onRefresh={() => void fetchAdmins(undefined, { force: true })}
									loading={loading}
									interval={autoRefreshInterval}
									onIntervalChange={setAutoRefreshInterval}
								/>
								{headerActions}
							</div>
						</div>
					</div>
				</div>

				<div ref={tableSectionRef} className="rb-admins-section">
				<DataTable
					ariaLabel={t("admins")}
					data={admins}
					columns={adminColumns}
					columnVisibility={columnVisibility}
					getRowId={(admin) => admin.username}
					loading={loading}
					loadingRows={skeletonCount}
					emptyState={
						<p className="text-[0.875rem] text-panel-text-muted text-center">
							{t("admins.noAdmins")}
						</p>
					}
					enableSelection
					selectedRowIds={selectedAdminUsernames}
					selectedRows={selectedAdmins}
					selectedCount={selectedAdminUsernames.length}
					onSelectionChange={(rowIds) => setSelectedAdminUsernames(rowIds)}
					selectedLabel={t("admins.selectedCount", {
						count: selectedAdminUsernames.length,
					})}
					rowActions={adminRowActions}

					actionsPlacement="end"
					actionsColumnWidth="max-content"
					actionsAlwaysVisible

									onRowClick={isDesktop ? (admin) => setExpandedAdminUsername((current) => (current === admin.username ? null : admin.username)) : undefined}
									isRowExpanded={isDesktop ? (admin) => expandedAdminUsername === admin.username : undefined}
									renderExpandedRow={isDesktop ? renderExpandedAdmin : undefined}
					sorting={adminSorting}
					manualSorting
					showSortMenu={false}
					dir={isRTL ? "rtl" : "ltr"}
					mobileBreakpoint="md"
					tableProps={tableProps}
				/>
				</div>
			</div>

			<ConfirmDialog
				open={Boolean(resetConfirmation)}
				onClose={() => setResetConfirmation(null)}
				onConfirm={confirmUsageReset}
				title={t(
					resetConfirmation?.type === "deleted"
						? "admins.resetDeletedUsage"
						: "admins.resetUsage",
					"Reset usage",
				)}
				description={t("admins.resetUsageConfirm", {
					username: resetConfirmation?.admin.username ?? "",
				})}
				confirmLabel={t("reset")}
				loading={
					actionState?.type === "reset" || actionState?.type === "resetDeleted"
				}
			/>

			<ConfirmDialog
				open={isDeleteDialogOpen}
				onClose={closeDeleteDialogAndReset}
				onConfirm={confirmDeleteAdmin}
				title={t("delete")}
				description={t("admins.confirmDeleteMessage", {
					username: adminToDelete?.username ?? "",
				})}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={actionState?.type === "deleteAdmin"}
				isConfirmDisabled={!adminToDelete}
			/>

			<ConfirmDialog
				open={isQuickPassConfirmOpen}
				onClose={() => {
					if (contextAction === "quickPassword") return;
					closeQuickPassConfirm();
					setQuickPassAdmin(null);
				}}
				onConfirm={confirmQuickPassword}
				title={t("admins.quickPasswordConfirmTitle")}
				description={t("admins.quickPasswordConfirm", {
					username: quickPassAdmin?.username ?? "",
				})}
				confirmLabel={t("admins.quickPasswordAction")}
				colorScheme="primary"
				loading={contextAction === "quickPassword"}
			/>

			<Dialog open={isQuickPassOpen} onOpenChange={(open) => { if (!open) (handleCloseQuickPass)(); }}>
				
				<DialogContent className={cn("border rounded-2xl shadow-2xl overflow-hidden mx-4 sm:mx-0 max-w-[calc(100vw_-_32px)] sm:max-w-[440px]", dialogBg, dialogBorderColor)}>
					<DialogHeader className="px-6 pt-6 pb-2">
						<div className="flex flex-row items-center gap-3">
							<div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-primary-200">
								<QuickPassIcon />
							</div>
							<p>{t("admins.quickPasswordModal.title")}</p>
						</div>
					</DialogHeader>
					
					<div className={cn("px-5 py-4 overflow-y-auto", "px-6 pb-2")}>
						<div className="flex flex-col gap-3">
							<div>
								<p className="text-[0.875rem] text-gray-500">
									{t("username")}
								</p>
								<Input value={quickPassInfo?.username ?? ""} readOnly />
							</div>
							<div>
								<p className="text-[0.875rem] text-gray-500">
									{t("admins.quickPasswordModal.password")}
								</p>
								<div className="relative flex w-full items-center">
									<Input value={quickPassInfo?.password ?? ""} readOnly />
									<div className="absolute inset-y-0 end-0 z-10 flex items-center pe-3">
										<Button onClick={async () => {
												if (quickPassInfo?.password) {
													try {
														await copyTextToClipboard(quickPassInfo.password);
														toast.success(t("copied"), { duration: 1200 });
													} catch (error) {
														generateErrorMessage(error, toast);
													}
												}
											}} variant="ghost" size="sm">
											{t("copy")}
										</Button>
									</div>
								</div>
							</div>
							<p className="text-[0.75rem] text-orange-400">
								{t("admins.quickPasswordModal.notice")}
							</p>
						</div>
					</div>
					<DialogFooter className={cn("bg-blackAlpha-50 dark:bg-whiteAlpha-50 border-t px-6 py-4", dialogBorderColor)}>
						<Button onClick={handleCloseQuickPass}>
							{t("close")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={isDisableDialogOpen}
				onClose={closeDisableDialogAndReset}
				onConfirm={confirmDisableAdmin}
				title={t("admins.disableAdminTitle")}
				description={
					<div className="flex flex-col gap-3">
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-300">
							{t("admins.disableAdminMessage", {
								username: adminToDisable?.username ?? "",
							})}
						</p>
						<Textarea value={disableReason} onChange={(event) => setDisableReason(event.target.value)} />
					</div>
				}
				confirmLabel={t("admins.disableAdminConfirm")}
				colorScheme="red"
				isConfirmDisabled={disableReason.trim().length < 3}
				loading={
					actionState?.type === "disableAdmin" &&
					actionState?.username === adminToDisable?.username
				}
			/>
			<AdminPermissionsModal
				open={isPermissionsModalOpen}
				onClose={handleClosePermissionsModal}
				admin={adminForPermissions}
			/>
			<LabelsDialog
				open={labelsAdmin !== null}
				onClose={() => setLabelsAdmin(null)}
				type="admin"
				entityKey={labelsAdmin?.id ?? 0}
				entityName={labelsAdmin?.username ?? ""}
				current={labelsAdmin ? { group: labelsAdmin.group ?? null, tags: labelsAdmin.tags ?? [] } : null}
				onSaved={() => fetchAdmins(undefined, { force: true })}
			/>
			<AdminSecurityDialog
				admin={securityAdmin}
				open={securityDialog.isOpen}
				onClose={() => {
					securityDialog.onClose();
					setSecurityAdmin(null);
				}}
				canManageSessions={canManageSessions}
				canManage2FA={canManage2FA}
				onChanged={() => fetchAdmins(undefined, { force: true })}
			/>
			<AdminApiKeysDialog
				admin={apiKeysAdmin}
				open={apiKeysDialog.isOpen}
				onClose={() => {
					apiKeysDialog.onClose();
					setAPIKeysAdmin(null);
				}}
			/>
			<AddTrafficDialog
				target={trafficAdmin ? { kind: "admin", name: trafficAdmin.username } : null}
				onClose={() => setTrafficAdmin(null)}
				onApply={(deltaBytes) => (trafficAdmin ? handleAddTrafficToAdmin(trafficAdmin, deltaBytes) : Promise.resolve())}
			/>
		</>
	);
};
