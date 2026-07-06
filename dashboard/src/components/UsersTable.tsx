import {
	Box,
	Button,
	chakra,
	Flex,
	HStack,
	IconButton,
	MenuItem,
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
	CalendarDaysIcon,
	ChartBarIcon,
	CheckIcon,
	ChevronRightIcon,
	CircleStackIcon,
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
import { resetStrategy } from "constants/UserSettings";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import {
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
import { generateUserLinks } from "utils/userLinks";
import {
	DataTable,
	ResourceListCard,
	RowActionsMenu,
	type DataTableColumn,
	type DataTableRowAction,
	type ResourceSummaryItem,
	type RowActionItem,
} from "./ui";
import { DeleteConfirmPopover } from "./DeleteConfirmPopover";
import { OnlineStatus } from "./OnlineStatus";
import { StatusBadge } from "./StatusBadge";
import {
	formatUsagePair,
	UserAdminChip,
	UserCardActions,
	UserExpiryCountdown,
	UserStatusAvatar,
	UserUsageBar,
} from "./users";

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
const UsageHistoryIcon = chakra(ChartBarIcon, iconProps);
const DataLimitIcon = chakra(CircleStackIcon, iconProps);
const ExpiryIcon = chakra(CalendarDaysIcon, iconProps);

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

// Plain text on purpose: the expanded card sits right under the collapsed
// row, which already shows the usage bar and percentage.
const MobileUsageDetail: FC<{
	used: number;
	total: number | null;
}> = ({ used, total }) => (
	<Text
		fontSize="sm"
		fontWeight="semibold"
		color="panel.text"
		dir="ltr"
		noOfLines={1}
		sx={{ unicodeBidi: "isolate" }}
	>
		{formatUsagePair(used, total)}
	</Text>
);

// Adapts the table's row-action descriptors into the shape the shared
// RowActionsMenu ("...") expects, binding each callback to the given row.
// Lets the desktop inline actions reuse the exact mobile overflow menu.
const toMenuItems = (
	actions: DataTableRowAction<UserListItem>[],
	row: UserListItem,
): RowActionItem[] =>
	actions.map((action) => ({
		id: action.id,
		label: action.label,
		icon: action.icon,
		color: action.color,
		isDanger: action.isDanger,
		isDisabled:
			typeof action.isDisabled === "function"
				? action.isDisabled(row)
				: action.isDisabled,
		onClick: action.onClick ? () => action.onClick?.(row) : undefined,
		render: action.render
			? (onClose: () => void) => action.render?.(row, onClose)
			: undefined,
	}));

const getUsageResetLabel = (
	user: UserListItem,
	t: (key: string) => string,
): string | undefined => {
	const isUnlimited = user.data_limit === 0 || user.data_limit === null;
	if (
		isUnlimited ||
		!user.data_limit_reset_strategy ||
		user.data_limit_reset_strategy === "no_reset"
	) {
		return undefined;
	}
	return t(
		`userDialog.resetStrategy${getResetStrategy(user.data_limit_reset_strategy)}`,
	);
};

type UsersTableProps = BoxProps & {
	toolbar?: ReactNode;
	/** Rendered in the header of the list summary card (e.g. refresh). */
	headerActions?: ReactNode;
};

export const UsersTable: FC<UsersTableProps> = ({
	toolbar,
	headerActions,
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
	// One toast shape for every action in this section: top entrance, closable.
	const notify = useCallback(
		(
			title: string,
			status: "success" | "error",
			options?: { description?: string; duration?: number },
		) =>
			toast({
				title,
				status,
				description: options?.description,
				duration: options?.duration ?? 2500,
				isClosable: true,
				position: "top",
			}),
		[toast],
	);
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
	const useCompactUsageCell =
		useBreakpointValue({ base: true, lg: true, xl: false }) ?? true;
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
			notify(t("usersTable.resetUsage", "Usage reset"), "success");
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleRevokeSub = async (user: UserListItem) => {
		setContextAction("revoke");
		try {
			await revokeSubscription(user);
			notify(t("usersTable.revokeSub", "Subscription revoked"), "success");
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
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
			notify(t("usersTable.addTrafficSuccess", "Traffic updated"), "success");
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
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
			notify(
				t("usersTable.extendExpireSuccess", "Expiration extended"),
				"success",
			);
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
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
			notify(t("usersTable.disableUser", "Disable user"), "success");
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
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
			notify(t("usersTable.enableUser", "Enable user"), "success");
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleDeleteUser = useCallback(
		async (user: UserListItem) => {
			setContextAction("delete");
			try {
				await deleteUser(user);
				notify(
					t("deleteUser.deleteSuccess", { username: user.username }),
					"success",
					{ duration: 3000 },
				);
				refetchUsers(true);
			} catch (error: any) {
				notify(error?.data?.detail || error?.message || t("error"), "error");
			} finally {
				setContextAction(null);
				closeContextMenu();
			}
		},
		[closeContextMenu, deleteUser, notify, refetchUsers, t],
	);

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
			notify(successLabel, "success", {
				description: t("usersTable.bulkActionCount", "{{count}} users updated", {
					count: users.length,
				}),
			});
			clearSelectedUsers();
			refetchUsers(true);
		} catch (error: any) {
			notify(error?.data?.detail || error?.message || t("error"), "error");
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
				headerInset: "44px",
				mobilePriority: 0,
				mobileMetaLabel: t("username"),
				cell: (user) => (
					<HStack
						spacing={2.5}
						align="center"
						dir="ltr"
						flexDirection="row"
						justify="flex-start"
						minW={0}
						maxW="full"
						w="full"
					>
						<UserStatusAvatar
							username={user.username}
							status={user.status}
							lastOnline={user.online_at ?? null}
						/>
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
							<HStack
								className="rb-user-username-meta"
								spacing={1.5}
								minW={0}
								maxW="full"
								overflow="hidden"
							>
								<UserAdminChip
									show={hasPrivilegedRole}
									adminUsername={user.admin_username}
								/>
								<OnlineStatus
									lastOnline={user.online_at ?? null}
									withMargin={false}
									compact
								/>
							</HStack>
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
				cell: (user) => <UserExpiryCountdown expire={user.expire} />,
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
					<MobileUsageDetail
						used={user.used_traffic}
						total={user.data_limit}
					/>
				),
				cell: (user) =>
					useCompactUsageCell ? (
						<UserUsageBar used={user.used_traffic} total={user.data_limit} />
					) : (
						<UserUsageBar
							variant="detailed"
							used={user.used_traffic}
							total={user.data_limit}
							lifetimeUsed={user.lifetime_used_traffic}
							lifetimeLabel={t("usersTable.lifetimeUsage")}
							resetLabel={getUsageResetLabel(user, t)}
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

		// Fixed primary-action bar at the bottom of the expanded mobile card;
		// the generic all-actions strip is hidden for this page via CSS and
		// every action stays available in the card's "..." menu.
		columns.push({
			id: "card_actions",
			header: "",
			desktopVisible: false,
			mobileVisible: true,
			mobilePriority: 9,
			mobileMetaLabel: "",
			cell: (user) => (
				<UserCardActions
					user={user}
					onEdit={canOpenUserDialog ? () => onEditingUser(user) : undefined}
					onDelete={
						canDeleteUserActions && canDeleteUserByTrafficCap(userData, user)
							? () => handleDeleteUser(user)
							: undefined
					}
				/>
			),
		});

		return columns;
	}, [
		canDeleteUserActions,
		canOpenUserDialog,
		canViewTraffic,
		handleDeleteUser,
		hasPrivilegedRole,
		onEditingUser,
		t,
		useCompactUsageCell,
		userData,
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
			notify(successLabel, "success", { duration: 1200 });
			return true;
		} catch {
			notify(t("usersTable.copyFailed", "Copy failed"), "error", {
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

		// Reuses the edit dialog's existing Usage tab (chart + /user/{u}/usage).
		if (canViewTraffic) {
			actions.push({
				id: "usage-history",
				label: t("usersTable.usageHistory", "Usage history"),
				icon: <UsageHistoryIcon />,
				onClick: () => onEditingUser(user, 1),
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

		// Absolute data-limit editor (PUT data_limit) — complements the
		// relative "Add traffic" action above.
		if (canMutateUsers) {
			actions.push({
				id: "set-data-limit",
				label: t("usersTable.setDataLimit", "Set data limit"),
				icon: <DataLimitIcon />,
				onClick: () =>
					useDashboard.setState({
						quickEditUser: { user, field: "data_limit" },
					}),
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

		// Absolute expiry editor (PUT expire) — complements "Add 30 days".
		if (canMutateUsers) {
			actions.push({
				id: "set-expiry",
				label: t("usersTable.setExpiry", "Set custom expiry"),
				icon: <ExpiryIcon />,
				onClick: () =>
					useDashboard.setState({
						quickEditUser: { user, field: "expire" },
					}),
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
				actions={headerActions}
			/>

			{/* Sticky so search and quick filters stay reachable while scrolling. */}
			{toolbar && <Box className="rb-users-toolbar">{toolbar}</Box>}

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
								menuActions={toMenuItems(getUserRowActions(user), user)}
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
						actionsColumnWidth="210px"
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
	// Full overflow action set for the trailing "..." menu (desktop parity
	// with the mobile card); omitted where there is nothing extra to show.
	menuActions?: RowActionItem[];
};

const ActionButtons: FC<ActionButtonsProps> = ({
	user,
	onDelete,
	onEdit,
	isRTL,
	menuActions,
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
			{menuActions && menuActions.length > 0 && (
				<RowActionsMenu actions={menuActions} label={t("actions", "Actions")} />
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
