import {
	Box,
	Button,
	chakra,
	Flex,
	HStack,
	IconButton,
	MenuItem,
	Progress,
	Stack,
	type BoxProps,
	Text,
	Tooltip,
	useBreakpointValue,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	CheckIcon,
	ChevronRightIcon,
	ClipboardIcon,
	ClockIcon,
	LinkIcon,
	NoSymbolIcon,
	PencilIcon,
	PlusCircleIcon,
	QrCodeIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import type { SortingState } from "@tanstack/react-table";
import { LockClosedIcon } from "@heroicons/react/24/solid";
import { ReactComponent as AddFileIcon } from "assets/add_file.svg";
import { resetStrategy, statusColors } from "constants/UserSettings";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import React, {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import { AdminRole, AdminStatus, UserPermissionToggle } from "types/Admin";
import type { User, UserListItem } from "types/User";
import {
	canDeleteUserByTrafficCap,
	canViewUserTraffic,
	isUserManagementLocked,
} from "utils/adminTraffic";
import { copyTextToClipboard } from "utils/clipboard";
import { formatBytes } from "utils/formatByte";
import { relativeExpiryDate } from "utils/dateFormatter";
import { generateUserLinks } from "utils/userLinks";
import {
	DataTable,
	ResourceListCard,
	type DataTableColumn,
	type DataTableRowAction,
	type ResourceSummaryItem,
} from "./ui";
import { DeleteConfirmPopover } from "./DeleteConfirmPopover";
import { OnlineBadge } from "./OnlineBadge";
import { OnlineStatus } from "./OnlineStatus";
import { StatusBadge } from "./StatusBadge";

type TranslateFn = (
	key: string,
	defaultValueOrOptions?: string | Record<string, unknown>,
) => string;

const EmptySectionIcon = chakra(AddFileIcon);

const iconProps = {
	baseStyle: {
		w: {
			base: 4,
			md: 5,
		},
		h: {
			base: 4,
			md: 5,
		},
	},
};
const CopyIcon = chakra(ClipboardIcon, iconProps);
const SubscriptionLinkIcon = chakra(LinkIcon, iconProps);
const QRIcon = chakra(QrCodeIcon, iconProps);
const CopiedIcon = chakra(CheckIcon, iconProps);
const EditIcon = chakra(PencilIcon, iconProps);
const DeleteIcon = chakra(TrashIcon, {
	baseStyle: {
		width: "18px",
		height: "18px",
	},
});
const LockOverlayIcon = chakra(LockClosedIcon, {
	baseStyle: {
		width: {
			base: 16,
			md: 20,
		},
		height: {
			base: 16,
			md: 20,
		},
	},
});
const ResetIcon = chakra(ArrowPathIcon, iconProps);
const RevokeIcon = chakra(NoSymbolIcon, iconProps);
const TrafficIcon = chakra(PlusCircleIcon, iconProps);
const ExtendIcon = chakra(ClockIcon, iconProps);

type UsageMeterProps = {
	used: number;
	total: number | null;
	totalUsedTraffic: number;
	dataLimitResetStrategy: string | null;
	status: string;
	isRTL: boolean;
	t: TranslateFn;
};

type CreatedByTextProps = {
	show: boolean;
	adminUsername?: string | null;
};

const CreatedByText: FC<CreatedByTextProps> = ({ show, adminUsername }) => {
	const { t } = useTranslation();
	if (!show || !adminUsername) return null;

	return (
		<Text
			fontSize="xs"
			color="gray.500"
			_dark={{ color: "gray.400" }}
			dir="ltr"
			sx={{ unicodeBidi: "isolate" }}
			lineHeight="1.2"
			textAlign="start"
		>
			{t("usersTable.by", "by")}{" "}
			<chakra.span color="primary.500" fontWeight="medium">
				{adminUsername}
			</chakra.span>
		</Text>
	);
};

const getResetStrategy = (strategy: string): string => {
	const entry = resetStrategy.find((item) => item.value === strategy);
	return entry?.title ?? "No";
};

const formatCount = (value: number | null | undefined, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value ?? 0);

const formatUsernamePreview = (username: string, maxLength = 20) =>
	username.length > maxLength
		? `${username.slice(0, Math.max(4, maxLength - 4))}...`
		: username;

const formatCompactUsagePair = (used: number, total: number | null) => {
	const [usedValue, usedUnit] = formatBytes(used, 2, true);
	if (total === 0 || total === null) return `${usedValue}${usedUnit}/∞`;

	const [totalValue, totalUnit] = formatBytes(total, 2, true);
	if (usedUnit === totalUnit) return `${usedValue}/${totalValue}${totalUnit}`;
	return `${usedValue}${usedUnit}/${totalValue}${totalUnit}`;
};

const CompactUsageMeter: FC<Pick<UsageMeterProps, "used" | "total">> = ({
	used,
	total,
}) => (
	<Text
		fontSize="sm"
		fontWeight="semibold"
		color="panel.text"
		dir="ltr"
		noOfLines={1}
		sx={{ unicodeBidi: "isolate" }}
	>
		{formatCompactUsagePair(used, total)}
	</Text>
);

const MobileExpiryDetail: FC<{
	expire?: number | null;
	t: TranslateFn;
}> = ({ expire, t }) => {
	const expiry = relativeExpiryDate(expire, { compact: true });
	if (!expiry.time) {
		return (
			<Text fontSize="sm" color="panel.textMuted">
				-
			</Text>
		);
	}
	return (
		<Text
			fontSize="sm"
			fontWeight="semibold"
			color="panel.text"
			dir="auto"
			noOfLines={1}
		>
			{t(expiry.status === "expires" ? "expires" : "expired", {
				time: expiry.time,
			})}
		</Text>
	);
};

const MobileLifetimeDetail: FC<{
	totalUsedTraffic: number;
}> = ({ totalUsedTraffic }) => (
	<Text
		fontSize="sm"
		fontWeight="semibold"
		color="panel.text"
		dir="ltr"
		noOfLines={1}
		sx={{ unicodeBidi: "isolate" }}
	>
		{formatBytes(totalUsedTraffic)}
	</Text>
);

const UsageMeter: FC<UsageMeterProps> = ({
	used,
	total,
	totalUsedTraffic,
	dataLimitResetStrategy,
	status,
	isRTL,
	t,
}) => {
	const isUnlimited = total === 0 || total === null;
	const percentage = isUnlimited
		? 0
		: Math.min((used / (total || 1)) * 100, 100);
	const resetLabel =
		!isUnlimited &&
		dataLimitResetStrategy &&
		dataLimitResetStrategy !== "no_reset"
			? t(`userDialog.resetStrategy${getResetStrategy(dataLimitResetStrategy)}`)
			: undefined;
	const colorScheme = statusColors[status]?.bandWidthColor ?? "primary";
	const reached = !isUnlimited && percentage >= 100;
	const usedLabel = formatBytes(used);
	const totalLabel = isUnlimited ? "∞" : formatBytes(total ?? 0);

	return (
		<Stack
			spacing={1}
			h="42px"
			minH="42px"
			justify="center"
			w="full"
			maxW="full"
			overflow="hidden"
		>
			<Progress
				value={isUnlimited ? 0 : percentage}
				isIndeterminate={isUnlimited}
				size="sm"
				colorScheme={reached ? "red" : colorScheme}
				borderRadius="full"
				bg="gray.100"
				_dark={{ bg: "gray.700" }}
				sx={isRTL ? { direction: "rtl" } : undefined}
			/>
			<HStack
				justify="space-between"
				spacing={3}
				flexWrap="nowrap"
				fontSize="xs"
				color="gray.600"
				_dark={{ color: "gray.400" }}
				dir="ltr"
				whiteSpace="nowrap"
				overflow="hidden"
				w="full"
				minW={0}
			>
				<Text noOfLines={1} minW={0} flex="1 1 auto" textAlign="start">
					<chakra.span className="rb-usage-pair">
						<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
							{usedLabel}
						</chakra.span>{" "}
						/{" "}
						<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
							{totalLabel}
						</chakra.span>
					</chakra.span>
					{resetLabel ? ` · ${resetLabel}` : ""}
				</Text>
				<HStack spacing={1} flexShrink={0} justify="flex-end" textAlign="end">
					<Text noOfLines={1}>{t("usersTable.lifetimeUsage")}:</Text>
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{formatBytes(totalUsedTraffic)}
					</chakra.span>
				</HStack>
			</HStack>
		</Stack>
	);
};

type UsersTableProps = BoxProps & {
	toolbar?: ReactNode;
	footerActions?: ReactNode;
};

export const UsersTable: FC<UsersTableProps> = ({
	toolbar,
	footerActions,
	...props
}) => {
	const {
		filters,
		users: usersResponse,
		onEditingUser,
		onFilterChange,
		loading,
		isUserLimitReached,
		deleteUser,
		resetDataUsage,
		revokeSubscription,
		refetchUsers,
		setQRCode,
		setSubLink,
		linkTemplates,
	} = useDashboard();

	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const locale = i18n.language || "en";
	const toast = useToast();
	const dialogBg = useColorModeValue("panel.surface", "panel.surface");
	const dialogBorderColor = useColorModeValue("panel.border", "panel.border");

	const { userData } = useGetUser();
	const hasPrivilegedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const userManagementLocked = isUserManagementLocked(userData);
	const canViewTraffic = canViewUserTraffic(userData);
	const isAdminDisabled = Boolean(
		!hasPrivilegedRole && userData.status === AdminStatus.Disabled,
	);
	const canCreateUsers =
		hasFullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const canDeleteUsers =
		hasFullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Delete]);
	const canResetUsage =
		hasFullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.ResetUsage]);
	const canRevokeSub =
		hasFullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Revoke]);
	const canOpenUserDialog =
		!isAdminDisabled && (canCreateUsers || hasFullAccess);
	const canToggleUserStatus =
		!isAdminDisabled &&
		(canCreateUsers || hasFullAccess || userManagementLocked);
	const canMutateUsers =
		!isAdminDisabled && canCreateUsers && !userManagementLocked;
	const canDeleteUserActions = !isAdminDisabled && canDeleteUsers;
	const canResetUsageActions =
		!isAdminDisabled &&
		canResetUsage &&
		canViewTraffic &&
		!userManagementLocked;
	const canRevokeSubActions =
		!isAdminDisabled && canRevokeSub && !userManagementLocked;
	const disabledReason = userData.disabled_reason;

	const rowsToRender = filters.limit || 10;
	const isFiltered = usersResponse.users.length !== usersResponse.total;
	const isDesktop = useBreakpointValue({ base: false, lg: true }) ?? false;
	const isMobile = useBreakpointValue({ base: true, md: false }) ?? false;
	const useCompactUsageCell =
		useBreakpointValue({ base: true, lg: true, xl: false }) ?? true;
	const hasSearchQuery = Boolean(filters.search?.trim());
	const hasUsageScopeFilter = Boolean(
		filters.search?.trim() ||
			filters.status ||
			(filters.advancedFilters && filters.advancedFilters.length > 0) ||
			filters.owner ||
			filters.serviceId,
	);
	const [contextAction, setContextAction] = useState<string | null>(null);
	const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
	const [bulkAction, setBulkAction] = useState<string | null>(null);

	const visibleUsernames = useMemo(
		() => usersResponse.users.map((user) => user.username),
		[usersResponse.users],
	);
	const visibleUsernameSet = useMemo(
		() => new Set(visibleUsernames),
		[visibleUsernames],
	);
	const selectedUsernameSet = useMemo(
		() => new Set(selectedUsernames),
		[selectedUsernames],
	);
	const selectedUsers = useMemo(
		() =>
			usersResponse.users.filter((user) =>
				selectedUsernameSet.has(user.username),
			),
		[usersResponse.users, selectedUsernameSet],
	);

	useEffect(() => {
		setSelectedUsernames((prev) =>
			prev.filter((username) => visibleUsernameSet.has(username)),
		);
	}, [visibleUsernameSet]);

	const clearSelectedUsers = () => setSelectedUsernames([]);

	const statusBreakdown = useMemo(() => {
		if (usersResponse.status_breakdown) {
			return usersResponse.status_breakdown;
		}
		const summary: Record<string, number> = {};
		usersResponse.users.forEach((user) => {
			summary[user.status] = (summary[user.status] ?? 0) + 1;
		});
		return summary;
	}, [usersResponse.status_breakdown, usersResponse.users]);

	const handleSort = (column: string) => {
		let newSort = filters.sort;
		if (newSort.includes(column)) {
			if (newSort.startsWith("-")) {
				newSort = "-created_at";
			} else {
				newSort = `-${column}`;
			}
		} else {
			newSort = column;
		}
		onFilterChange({
			sort: newSort,
			offset: 0,
		});
	};

	const closeContextMenu = useCallback(() => undefined, []);

	const handleResetUsage = async (user: UserListItem) => {
		setContextAction("reset");
		try {
			await resetDataUsage(user);
			toast({
				title: t("usersTable.resetUsage", "Usage reset"),
				status: "success",
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleRevokeSub = async (user: UserListItem) => {
		setContextAction("revoke");
		try {
			await revokeSubscription(user);
			toast({
				title: t("usersTable.revokeSub", "Subscription revoked"),
				status: "success",
			});
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleAdjustTraffic = async (user: UserListItem, gigabytes: number) => {
		const currentLimit = user.data_limit;
		if (!currentLimit || currentLimit <= 0) {
			return;
		}
		setContextAction(`traffic-${gigabytes}`);
		try {
			const delta = gigabytes * 1024 * 1024 * 1024;
			const nextLimit = currentLimit + delta;
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body: { data_limit: nextLimit },
			});
			toast({
				title: t("usersTable.addTrafficSuccess", "Traffic updated"),
				status: "success",
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleExtendExpire = async (user: UserListItem, days: number) => {
		if (user.expire === null || user.expire === 0 || user.expire === undefined)
			return;
		setContextAction("expire");
		try {
			const secondsToAdd = days * 86400;
			const nextExpire = Math.floor(user.expire + secondsToAdd);
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body: { expire: nextExpire },
			});
			toast({
				title: t("usersTable.extendExpireSuccess", "Expiration extended"),
				status: "success",
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleDisableUser = async (user: UserListItem) => {
		if (!canToggleUserStatus || user.status === "disabled") return;
		setContextAction("disable");
		try {
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body: { status: "disabled" },
			});
			toast({
				title: t("usersTable.disableUser", "Disable user"),
				status: "success",
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleEnableUser = async (user: UserListItem) => {
		if (!canToggleUserStatus || user.status !== "disabled") return;
		setContextAction("enable");
		try {
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body: { status: "active" },
			});
			toast({
				title: t("usersTable.enableUser", "Enable user"),
				status: "success",
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleDeleteUser = async (user: UserListItem) => {
		setContextAction("delete");
		try {
			await deleteUser(user);
			toast({
				title: t("deleteUser.deleteSuccess", { username: user.username }),
				status: "success",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const runBulkUserAction = async (
		action: string,
		users: UserListItem[],
		handler: (user: UserListItem) => Promise<unknown>,
		successLabel: string,
	) => {
		if (!users.length || bulkAction) return;
		setBulkAction(action);
		try {
			await Promise.all(users.map((user) => handler(user)));
			toast({
				title: successLabel,
				description: t("usersTable.bulkActionCount", "{{count}} users updated", {
					count: users.length,
				}),
				status: "success",
			});
			clearSelectedUsers();
			refetchUsers(true);
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
			});
		} finally {
			setBulkAction(null);
		}
	};

	const bulkDisableTargets = selectedUsers.filter(
		(user) => user.status !== "disabled",
	);
	const bulkEnableTargets = selectedUsers.filter(
		(user) => user.status === "disabled",
	);
	const bulkDeleteTargets = selectedUsers.filter((user) =>
		canDeleteUserByTrafficCap(userData, user),
	);

	const handleBulkDisable = () =>
		runBulkUserAction(
			"disable",
			bulkDisableTargets,
			(user) =>
				fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
					method: "PUT",
					body: { status: "disabled" },
				}),
			t("usersTable.disableUser", "Disable user"),
		);

	const handleBulkEnable = () =>
		runBulkUserAction(
			"enable",
			bulkEnableTargets,
			(user) =>
				fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
					method: "PUT",
					body: { status: "active" },
				}),
			t("usersTable.enableUser", "Enable user"),
		);

	const handleBulkReset = () =>
		runBulkUserAction(
			"reset",
			selectedUsers,
			(user) => resetDataUsage(user),
			t("usersTable.resetUsage", "Usage reset"),
		);

	const handleBulkRevoke = () =>
		runBulkUserAction(
			"revoke",
			selectedUsers,
			(user) => revokeSubscription(user),
			t("usersTable.revokeSub", "Subscription revoked"),
		);

	const handleBulkDelete = () =>
		runBulkUserAction(
			"delete",
			bulkDeleteTargets,
			(user) => deleteUser(user),
			t("deleteUser.title", "Delete user"),
		);

	const userColumns = useMemo<DataTableColumn<UserListItem>[]>(() => {
		const columns: DataTableColumn<UserListItem>[] = [
			{
				id: "username",
				header: t("username"),
				accessor: "username",
				sortable: true,
				isPrimary: true,
				priority: "primary",
				width: { lg: "150px", xl: "168px" },
				minWidth: "148px",
				maxWidth: "188px",
				truncate: true,
				tooltip: true,
				multiline: true,
				cellAlign: "start",
				headerInset: "20px",
				mobilePriority: 0,
				mobileMetaLabel: t("username"),
				cell: (user) => (
					<HStack
						spacing={1.5}
						align="center"
						dir="ltr"
						flexDirection="row"
						justify="flex-start"
						minW={0}
						maxW="full"
						w="full"
					>
						<Box
							className="rb-user-online-indicator"
							flex="0 0 20px"
							w="20px"
							display="flex"
							alignItems="center"
							justifyContent="center"
							overflow="visible"
						>
							<OnlineBadge lastOnline={user.online_at ?? null} />
						</Box>
						<Box
							minW={0}
							flex="1 1 auto"
							maxW="full"
							py={0.5}
							lineHeight="short"
							textAlign="left"
							overflow="hidden"
						>
							<Text
								fontWeight="semibold"
								noOfLines={1}
								maxW="full"
								color="panel.text"
								dir="ltr"
								sx={{ unicodeBidi: "isolate" }}
								_hover={canOpenUserDialog ? { color: "panel.accent" } : undefined}
							>
								{formatUsernamePreview(user.username)}
							</Text>
							<CreatedByText
								show={hasPrivilegedRole}
								adminUsername={user.admin_username}
							/>
							<OnlineStatus lastOnline={user.online_at ?? null} />
						</Box>
					</HStack>
				),
			},
			{
				id: "expire",
				header: t("usersTable.status"),
				sortable: true,
				priority: "high",
				width: { lg: "128px", xl: "138px" },
				minWidth: "112px",
				maxWidth: "148px",
				headerAlign: "center",
				cellAlign: "start",
				headerInset: "16px",
				mobilePriority: 1,
				mobileMetaLabel: t("usersTable.status"),
				mobileDetailCell: (user) => (
					<StatusBadge
						expiryDate={null}
						status={user.status}
						compact
					/>
				),
				cell: (user) => (
					<Flex align="center" justify="flex-start" dir="ltr" w="full">
						<StatusBadge
							expiryDate={user.expire}
							status={user.status}
							compact
							detailPlacement="inline"
						/>
					</Flex>
				),
			},
			{
				id: "expiry",
				header: t("usersTable.expire"),
				desktopVisible: false,
				mobileVisible: true,
				mobilePriority: 2,
				mobileMetaLabel: t("usersTable.expire"),
				cell: (user) => (
					<MobileExpiryDetail expire={user.expire} t={t} />
				),
			},
			{
				id: "service",
				header: t("usersTable.service", "Service"),
				accessor: (user) =>
					user.service_name ?? t("usersTable.defaultService", "Default"),
				priority: "medium",
				hideBelow: "xl",
				width: "118px",
				minWidth: "96px",
				maxWidth: "138px",
				truncate: true,
				tooltip: true,
				mobilePriority: 3,
				mobileVisible: true,
				mobileMetaLabel: t("usersTable.service", "Service"),
				cell: (user) => (
					<Text
						fontSize="sm"
						color={user.service_name ? "panel.text" : "panel.textMuted"}
						noOfLines={1}
						maxW="full"
					>
						{user.service_name ?? t("usersTable.defaultService", "Default")}
					</Text>
				),
			},
		];

		if (canViewTraffic) {
			columns.push({
				id: "used_traffic",
				header: t("usersTable.dataUsage"),
				sortable: true,
				priority: "high",
				hideBelow: "lg",
				width: "clamp(104px, 16vw, 240px)",
				minWidth: "104px",
				maxWidth: "240px",
				headerAlign: "center",
				cellAlign: "start",
				mobileVisible: true,
				mobileSummary: true,
				mobilePriority: 4,
				mobileMetaLabel: t("usersTable.dataUsage"),
				mobileDetailCell: (user) => (
					<CompactUsageMeter
						used={user.used_traffic}
						total={user.data_limit}
					/>
				),
				cell: (user) =>
					useCompactUsageCell ? (
						<CompactUsageMeter
							used={user.used_traffic}
							total={user.data_limit}
						/>
					) : (
						<UsageMeter
							status={user.status}
							totalUsedTraffic={user.lifetime_used_traffic}
							dataLimitResetStrategy={user.data_limit_reset_strategy}
							used={user.used_traffic}
							total={user.data_limit}
							isRTL={isRTL}
							t={t}
						/>
					),
			});
			columns.push({
				id: "lifetime_used_traffic",
				header: t("usersTable.lifetimeUsage"),
				desktopVisible: false,
				mobileVisible: true,
				mobilePriority: 5,
				mobileMetaLabel: t("usersTable.lifetimeUsage"),
				cell: (user) => (
					<MobileLifetimeDetail totalUsedTraffic={user.lifetime_used_traffic} />
				),
			});
		}

		return columns;
	}, [
		canOpenUserDialog,
		canViewTraffic,
		hasPrivilegedRole,
		isRTL,
		t,
		useCompactUsageCell,
	]);

	const userSorting = useMemo<SortingState>(() => {
		const currentSort = filters.sort || "";
		const desc = currentSort.startsWith("-");
		const id = desc ? currentSort.slice(1) : currentSort;
		if (!id) return [];
		return [{ id, desc }];
	}, [filters.sort]);

	const handleUserTableSorting = (nextSorting: SortingState) => {
		const next = nextSorting[0];
		if (!next) return;
		handleSort(next.id);
	};

	const formatUserLink = (link?: string | null) => {
		if (!link) return "";
		return link.startsWith("/") ? window.location.origin + link : link;
	};

	const copyUserText = async (text: string, successLabel: string) => {
		if (!text) return false;
		try {
			await copyTextToClipboard(text);
			toast({
				title: successLabel,
				status: "success",
				duration: 1200,
			});
			return true;
		} catch {
			toast({
				title: t("usersTable.copyFailed", "Copy failed"),
				status: "error",
				duration: 1600,
			});
			return false;
		}
	};

	const getUserRowActions = (
		user: UserListItem,
	): DataTableRowAction<UserListItem>[] => {
		const subscriptionLink = formatUserLink(user.subscription_url);
		const configLinks = generateUserLinks(user, linkTemplates);
		const configLinksText = configLinks.join("\n");
		const actions: DataTableRowAction<UserListItem>[] = [
			{
				id: "copy-subscription",
				label: t("usersTable.copyLink", "Copy link"),
				icon: <SubscriptionLinkIcon />,
				isDisabled: !subscriptionLink,
				onClick: () =>
					copyUserText(
						subscriptionLink,
						t("usersTable.copied", "Copied"),
					),
			},
			{
				id: "copy-configs",
				label: t("usersTable.copyConfigs", "Copy configs"),
				icon: <CopyIcon />,
				isDisabled: configLinks.length === 0,
				onClick: () =>
					copyUserText(
						configLinksText,
						t("usersTable.copied", "Copied"),
					),
			},
			{
				id: "qr",
				label: t("usersTable.qrCode", "QR Code"),
				icon: <QRIcon />,
				onClick: () => {
					setQRCode(configLinks, user.username);
					setSubLink(subscriptionLink);
				},
			},
		];

		if (canOpenUserDialog) {
			actions.push({
				id: "edit",
				label: t("userDialog.editUser", "Edit user"),
				icon: <EditIcon />,
				onClick: () => onEditingUser(user),
			});
		}

		if (canToggleUserStatus && user.status !== "disabled") {
			actions.push({
				id: "disable",
				label: t("usersTable.disableUser", "Disable user"),
				icon: <RevokeIcon />,
				isDisabled: contextAction === "disable",
				onClick: () => handleDisableUser(user),
			});
		}

		if (canToggleUserStatus && user.status === "disabled") {
			actions.push({
				id: "enable",
				label: t("usersTable.enableUser", "Enable user"),
				icon: <CheckIcon width={16} />,
				isDisabled: contextAction === "enable",
				onClick: () => handleEnableUser(user),
			});
		}

		if (canResetUsageActions) {
			actions.push({
				id: "reset",
				label: t("usersTable.resetUsage", "Reset usage"),
				icon: <ResetIcon />,
				isDisabled: contextAction === "reset",
				onClick: () => handleResetUsage(user),
			});
		}

		if (canRevokeSubActions) {
			actions.push({
				id: "revoke",
				label: t("usersTable.revokeSub", "Revoke subscription"),
				icon: <RevokeIcon />,
				isDisabled: contextAction === "revoke",
				onClick: () => handleRevokeSub(user),
			});
		}

		if (canMutateUsers && user.data_limit !== null && user.data_limit !== 0) {
			actions.push({
				id: "add-traffic",
				label: t("usersTable.addTraffic", "Add traffic"),
				render: (_row, onClose) => (
					<Box position="relative" role="group">
						<MenuItem
							icon={<TrafficIcon />}
							isDisabled={contextAction?.startsWith("traffic-")}
							closeOnSelect={false}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
						>
							<HStack w="full" justify="space-between" spacing={3}>
								<Text as="span" noOfLines={1}>
									{t("usersTable.addTraffic", "Add traffic")}
								</Text>
								<ChevronRightIcon
									width={14}
									style={{
										flexShrink: 0,
										transform: isRTL ? "rotate(180deg)" : undefined,
									}}
								/>
							</HStack>
						</MenuItem>
						<Stack
							display="none"
							_groupHover={{ display: "flex" }}
							position="absolute"
							top={0}
							left={isRTL ? "auto" : "100%"}
							right={isRTL ? "100%" : "auto"}
							minW="140px"
							spacing={1}
							p={2}
							bg={dialogBg}
							borderWidth="1px"
							borderColor={dialogBorderColor}
							borderRadius="md"
							boxShadow="lg"
							zIndex={2501}
						>
							{[1, 2, 3, 5, 10].map((gigabytes) => (
								<MenuItem
									key={gigabytes}
									isDisabled={contextAction === `traffic-${gigabytes}`}
									onClick={(event) => {
										event.stopPropagation();
										onClose();
										handleAdjustTraffic(user, gigabytes);
									}}
								>
									{t("usersTable.addGb", "Add {{count}} GB", {
										count: gigabytes,
									})}
								</MenuItem>
							))}
						</Stack>
					</Box>
				),
			});
		}

		if (
			canMutateUsers &&
			user.expire !== null &&
			user.expire !== 0 &&
			user.expire !== undefined
		) {
			actions.push({
				id: "extend-expire",
				label: t("usersTable.add30Days", "Add 30 days"),
				icon: <ExtendIcon />,
				isDisabled: contextAction === "expire",
				onClick: () => handleExtendExpire(user, 30),
			});
		}

		if (canDeleteUserActions && canDeleteUserByTrafficCap(userData, user)) {
			actions.push({
				id: "delete",
				label: t("deleteUser.title", "Delete user"),
				icon: <DeleteIcon />,
				isDanger: true,
				render: (_row, onClose) => (
					<DeleteConfirmPopover
						message={t("deleteUser.prompt", { username: user.username })}
						onConfirm={async () => {
							onClose();
							await handleDeleteUser(user);
						}}
					>
						<MenuItem
							icon={<DeleteIcon />}
							color="red.400"
							onClick={(event) => event.stopPropagation()}
						>
							{t("deleteUser.title", "Delete user")}
						</MenuItem>
					</DeleteConfirmPopover>
				),
			});
		}

		return actions;
	};

	const filteredUsageTotal = usersResponse.usage_total ?? null;
	const activeUsersCount =
		statusBreakdown.active ?? usersResponse.active_total ?? 0;
	const summaryItems: ResourceSummaryItem[] = [
		{
			label: t("usersTable.total"),
			value: formatCount(usersResponse.total, locale),
			colorScheme: isUserLimitReached ? "red" : "gray",
		},
		{
			label: t("status.active"),
			value: formatCount(activeUsersCount, locale),
			colorScheme: "green",
		},
		{
			label: t("status.on_hold"),
			value: formatCount(statusBreakdown.on_hold ?? 0, locale),
			colorScheme: "orange",
		},
		{
			label: t("status.limited"),
			value: formatCount(statusBreakdown.limited ?? 0, locale),
			colorScheme: "yellow",
		},
		{
			label: t("status.expired"),
			value: formatCount(statusBreakdown.expired ?? 0, locale),
			colorScheme: "red",
		},
		{
			label: t("status.online", "Online"),
			value: formatCount(usersResponse.online_total ?? 0, locale),
			colorScheme: "teal",
		},
	];

	const usageForSummary = canViewTraffic ? filteredUsageTotal : null;

	if (usageForSummary !== null) {
		summaryItems.push({
			label: hasUsageScopeFilter
				? t("usersTable.filteredUsage", "Filtered usage")
				: t("usersTable.listUsage", "Listed users usage"),
			value: formatBytes(usageForSummary),
			colorScheme: "blue",
			helper: hasUsageScopeFilter
				? t(
						"usersTable.filteredUsageHelper",
						"Sum of user traffic in the current filters.",
					)
				: t(
						"usersTable.listUsageHelper",
						"Sum of user traffic in the current visible scope.",
					),
		});
	}

	return (
		<VStack
			spacing={4}
			align="stretch"
			dir={isRTL ? "rtl" : "ltr"}
			data-dir={isRTL ? "rtl" : "ltr"}
			pb={selectedUsers.length > 0 ? { base: 32, md: 24 } : 0}
			{...props}
		>
			<ResourceListCard
				title={t("usersTable.listHeader", "User list")}
				summaryItems={summaryItems}
				footerActions={footerActions}
			>
				{toolbar}
			</ResourceListCard>

			<Box position="relative">
				<Stack
					spacing={3}
					filter={isAdminDisabled ? "blur(4px)" : undefined}
					pointerEvents={isAdminDisabled ? "none" : undefined}
					aria-hidden={isAdminDisabled ? true : undefined}
				>
					<DataTable
						ariaLabel={t("users", "Users")}
						data={usersResponse.users}
						columns={userColumns}
						getRowId={(user) => user.username}
						isLoading={loading}
						loadingRows={rowsToRender}
						emptyState={
							<EmptySection
								isFiltered={isFiltered}
								isCreateDisabled={
									isAdminDisabled || !canCreateUsers || userManagementLocked
								}
							/>
						}
						enableSelection
						selectedRowIds={selectedUsernames}
						selectedRows={selectedUsers}
						selectedCount={selectedUsers.length}
						onSelectionChange={(rowIds) => setSelectedUsernames(rowIds)}
						rowActions={getUserRowActions}
						renderRowActions={(user) => (
							<ActionButtons
								user={user}
								isRTL={isRTL}
								onEdit={
									canOpenUserDialog ? () => onEditingUser(user) : undefined
								}
								onDelete={
									canDeleteUserActions &&
									canDeleteUserByTrafficCap(userData, user)
										? () => handleDeleteUser(user)
										: undefined
								}
							/>
						)}
						actionsDisplay="inline"
						actionsPlacement="end"
						actionsColumnWidth="174px"
						actionsAlwaysVisible
						onRowClick={
							canOpenUserDialog ? (user) => onEditingUser(user) : undefined
						}
						sorting={userSorting}
						onSortingChange={handleUserTableSorting}
						manualSorting
						dir={isRTL ? "rtl" : "ltr"}
						selectedLabel={t("usersTable.selectedCount", {
							defaultValue: "{{count}} selected",
							count: selectedUsers.length,
						})}
						renderBulkActions={() => (
							<>
								{canToggleUserStatus && (
									<Button
										size="sm"
										variant="outline"
										leftIcon={<RevokeIcon />}
										onClick={handleBulkDisable}
										isLoading={bulkAction === "disable"}
										isDisabled={
											Boolean(bulkAction) || bulkDisableTargets.length === 0
										}
									>
										{t("usersTable.disableUser", "Disable user")}
									</Button>
								)}
								{canToggleUserStatus && (
									<Button
										size="sm"
										variant="outline"
										leftIcon={<CheckIcon width={16} />}
										onClick={handleBulkEnable}
										isLoading={bulkAction === "enable"}
										isDisabled={
											Boolean(bulkAction) || bulkEnableTargets.length === 0
										}
									>
										{t("usersTable.enableUser", "Enable user")}
									</Button>
								)}
								{canResetUsageActions && (
									<Button
										size="sm"
										variant="outline"
										leftIcon={<ResetIcon />}
										onClick={handleBulkReset}
										isLoading={bulkAction === "reset"}
										isDisabled={Boolean(bulkAction) || selectedUsers.length === 0}
									>
										{t("usersTable.resetUsage", "Reset usage")}
									</Button>
								)}
								{canRevokeSubActions && (
									<Button
										size="sm"
										variant="outline"
										leftIcon={<RevokeIcon />}
										onClick={handleBulkRevoke}
										isLoading={bulkAction === "revoke"}
										isDisabled={Boolean(bulkAction) || selectedUsers.length === 0}
									>
										{t("usersTable.revokeSub", "Revoke subscription")}
									</Button>
								)}
								{canDeleteUserActions && (
									<DeleteConfirmPopover
										message={t(
											"usersTable.bulkDeletePrompt",
											"Delete selected users?",
										)}
										onConfirm={handleBulkDelete}
									>
										<Button
											size="sm"
											colorScheme="red"
											variant="outline"
											leftIcon={<DeleteIcon />}
											isLoading={bulkAction === "delete"}
											isDisabled={
												Boolean(bulkAction) ||
												bulkDeleteTargets.length === 0
											}
										>
											{t("delete", "Delete")}
										</Button>
									</DeleteConfirmPopover>
								)}
							</>
						)}
						tableProps={{
							w: "full",
							sx: {
								"& th, & td": {
									px: { base: 2, xl: 3 },
									py: { base: 2.5, xl: 2.5 },
									verticalAlign: "middle",
								},
							},
						}}
					/>
				</Stack>
				{isAdminDisabled && (
					<Flex
						position="absolute"
						inset={0}
						align="center"
						justify="center"
						direction="column"
						textAlign="center"
						px={6}
						py={8}
						bg="rgba(255, 255, 255, 0.85)"
						_dark={{ bg: "rgba(15, 23, 42, 0.9)" }}
						zIndex="overlay"
					>
						<LockOverlayIcon color="red.400" mb={6} />
						<Text fontSize="xl" fontWeight="bold" mb={3}>
							{t("usersTable.adminDisabledTitle", "Your account is disabled")}
						</Text>
						<Text maxW="480px" color="gray.600" _dark={{ color: "gray.200" }}>
							{disabledReason ||
								t(
									"usersTable.adminDisabledDescription",
									"Please contact the sudo admin to regain access.",
								)}
						</Text>
					</Flex>
				)}
			</Box>
		</VStack>
	);
};

type ActionButtonsUser = User | UserListItem;
type ActionButtonsProps = {
	user: ActionButtonsUser;
	onDelete?: () => void | Promise<void>;
	onEdit?: () => void;
	isRTL?: boolean;
};

const ActionButtons: FC<ActionButtonsProps> = ({
	user,
	onDelete,
	onEdit,
	isRTL,
}) => {
	const { t } = useTranslation();
	const { setQRCode, setSubLink, linkTemplates } = useDashboard();

	const userLinks = generateUserLinks(user, linkTemplates);
	const formatLink = (link?: string | null) => {
		if (!link) return "";
		return link.startsWith("/") ? window.location.origin + link : link;
	};
	const subscriptionLink = formatLink(user.subscription_url);
	const configLinksText = userLinks.join("\n");
	const hasConfigLinks = userLinks.length > 0;

	const [copied, setCopied] = useState(false);
	const [copiedConfigs, setCopiedConfigs] = useState(false);
	useEffect(() => {
		if (copied) {
			setTimeout(() => {
				setCopied(false);
			}, 1000);
		}
	}, [copied]);
	useEffect(() => {
		if (copiedConfigs) {
			setTimeout(() => {
				setCopiedConfigs(false);
			}, 1000);
		}
	}, [copiedConfigs]);

	return (
		<HStack
			dir={isRTL ? "rtl" : "ltr"}
			justifyContent={isRTL ? "flex-start" : "flex-end"}
			spacing={1}
			flexWrap="nowrap"
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<Tooltip label={copied ? t("usersTable.copied") : t("usersTable.copyLink")}>
				<span>
					<IconButton
						aria-label={t("usersTable.copyLink")}
						icon={copied ? <CopiedIcon /> : <SubscriptionLinkIcon />}
						variant="ghost"
						size="sm"
						minW="30px"
						h="30px"
						isDisabled={!subscriptionLink}
						onClick={() => {
							void copyTextToClipboard(subscriptionLink)
								.then(() => {
									setCopied(true);
								})
								.catch(() => undefined);
						}}
					/>
				</span>
			</Tooltip>
			<Tooltip
				label={
					copiedConfigs ? t("usersTable.copied") : t("usersTable.copyConfigs")
				}
			>
				<span>
					<IconButton
						aria-label={t("usersTable.copyConfigs")}
						icon={copiedConfigs ? <CopiedIcon /> : <CopyIcon />}
						variant="ghost"
						size="sm"
						minW="30px"
						h="30px"
						isDisabled={!hasConfigLinks}
						onClick={() => {
							void copyTextToClipboard(configLinksText)
								.then(() => setCopiedConfigs(true))
								.catch(() => undefined);
						}}
					/>
				</span>
			</Tooltip>
			<Tooltip label={t("usersTable.qrCode", "QR Code")}>
				<IconButton
					aria-label={t("usersTable.qrCode", "QR Code")}
					icon={<QRIcon />}
					variant="ghost"
					size="sm"
					minW="30px"
					h="30px"
					onClick={() => {
						const links = generateUserLinks(user, linkTemplates);
						setQRCode(links, user.username);
						setSubLink(subscriptionLink);
					}}
				/>
			</Tooltip>
			{onEdit && (
				<Tooltip label={t("userDialog.editUser")}>
					<IconButton
						aria-label={t("userDialog.editUser")}
						icon={<EditIcon />}
						variant="ghost"
						size="sm"
						minW="30px"
						h="30px"
						onClick={onEdit}
					/>
				</Tooltip>
			)}
			{onDelete && (
				<DeleteConfirmPopover
					message={t("deleteUser.prompt", { username: user.username })}
					onConfirm={onDelete}
				>
					<IconButton
						aria-label={t("deleteUser.title")}
						icon={<DeleteIcon />}
						variant="ghost"
						size="sm"
						minW="30px"
						h="30px"
						color="red.400"
						_hover={{ color: "red.300", bg: "whiteAlpha.100" }}
					/>
				</DeleteConfirmPopover>
			)}
		</HStack>
	);
};

type EmptySectionProps = {
	isFiltered: boolean;
	isCreateDisabled: boolean;
};

const EmptySection: FC<EmptySectionProps> = ({
	isFiltered,
	isCreateDisabled,
}) => {
	const { t } = useTranslation();
	const { onCreateUser } = useDashboard();
	const handleCreate = () => {
		if (isCreateDisabled) {
			return;
		}
		onCreateUser(true);
	};
	return (
		<Box
			padding="5"
			py="8"
			display="flex"
			alignItems="center"
			flexDirection="column"
			gap={4}
			w="full"
			borderWidth="1px"
			borderColor="light-border"
			borderRadius="lg"
			bg="surface.light"
			_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
		>
			<EmptySectionIcon
				maxHeight="200px"
				maxWidth="200px"
				_dark={{
					'path[fill="#fff"]': {
						fill: "gray.800",
					},
					'path[fill="#f2f2f2"], path[fill="#e6e6e6"], path[fill="#ccc"]': {
						fill: "gray.700",
					},
					'circle[fill="#3182CE"]': {
						fill: "primary.300",
					},
				}}
				_light={{
					'path[fill="#f2f2f2"], path[fill="#e6e6e6"], path[fill="#ccc"]': {
						fill: "gray.300",
					},
					'circle[fill="#3182CE"]': {
						fill: "primary.500",
					},
				}}
			/>
			<Text fontWeight="medium" color="gray.600" _dark={{ color: "gray.400" }}>
				{isFiltered ? t("usersTable.noUserMatched") : t("usersTable.noUser")}
			</Text>
			{!isFiltered && !isCreateDisabled && (
				<Button size="sm" colorScheme="primary" onClick={handleCreate}>
					{t("createUser")}
				</Button>
			)}
		</Box>
	);
};
