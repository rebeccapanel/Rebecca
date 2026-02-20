import {
	Box,
	Button,
	Card,
	CardBody,
	CardHeader,
	Collapse,
	chakra,
	Flex,
	HStack,
	IconButton,
	Progress,
	Select,
	SimpleGrid,
	Skeleton,
	SkeletonText,
	Stack,
	Table,
	type TableProps,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	useBreakpointValue,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	CheckIcon,
	ChevronDownIcon,
	ClipboardIcon,
	ClockIcon,
	LinkIcon,
	NoSymbolIcon,
	PencilIcon,
	PlusCircleIcon,
	QrCodeIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { LockClosedIcon } from "@heroicons/react/24/solid";
import { ReactComponent as AddFileIcon } from "assets/add_file.svg";
import classNames from "classnames";
import { resetStrategy, statusColors } from "constants/UserSettings";
import { type FilterType, useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import React, {
	type ChangeEvent,
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import CopyToClipboard from "react-copy-to-clipboard";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import { AdminRole, AdminStatus, UserPermissionToggle } from "types/Admin";
import type { User, UserListItem } from "types/User";
import { relativeExpiryDate } from "utils/dateFormatter";
import { formatBytes } from "utils/formatByte";
import { generateUserLinks } from "utils/userLinks";
import { OnlineBadge } from "./OnlineBadge";
import { OnlineStatus } from "./OnlineStatus";
import { StatusBadge } from "./StatusBadge";

type TranslateFn = (key: string, defaultValue?: string) => string;

const EmptySectionIcon = chakra(AddFileIcon);

const createStableKey = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
};

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
const SortIcon = chakra(ChevronDownIcon, {
	baseStyle: {
		width: "15px",
		height: "15px",
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

type SummaryStatProps = {
	label: string;
	value: string | number;
	helper?: string;
	accentColor?: string;
	isMobile?: boolean;
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

const SummaryStat: FC<SummaryStatProps> = ({
	label,
	value,
	helper,
	accentColor = "primary.500",
	isMobile = false,
}) => {
	const glassBg = useColorModeValue(
		"rgba(255, 255, 255, 0.76)",
		"rgba(16, 20, 28, 0.72)",
	);
	const glassBorder = useColorModeValue(
		"rgba(255, 255, 255, 0.48)",
		"rgba(255, 255, 255, 0.14)",
	);
	const glassShadow = useColorModeValue(
		"0 18px 36px -24px rgba(15, 23, 42, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.65)",
		"0 16px 32px -22px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
	);
	const baseBorder = useColorModeValue("light-border", "whiteAlpha.200");
	return (
		<Box
			borderWidth="1px"
			borderColor={isMobile ? glassBorder : baseBorder}
			borderRadius="xl"
			p={4}
			bg={isMobile ? glassBg : "surface.light"}
			backdropFilter={isMobile ? "saturate(175%) blur(16px)" : undefined}
			sx={
				isMobile
					? { WebkitBackdropFilter: "saturate(175%) blur(16px)" }
					: undefined
			}
			boxShadow={isMobile ? glassShadow : undefined}
			transform={isMobile ? "translateY(-1px)" : undefined}
			transition="transform 0.2s ease, box-shadow 0.2s ease"
			position="relative"
			overflow="hidden"
			_dark={
				isMobile
					? {
							bg: glassBg,
							borderColor: glassBorder,
						}
					: { bg: "surface.dark", borderColor: "whiteAlpha.200" }
			}
			_before={
				isMobile
					? {
							content: '""',
							position: "absolute",
							inset: "0",
							background:
								"linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 55%, rgba(255,255,255,0))",
							opacity: 0.6,
							pointerEvents: "none",
						}
					: undefined
			}
		>
			<Text fontSize="sm" color="gray.700" _dark={{ color: "gray.300" }}>
				{label}
			</Text>
			<Text
				mt={1}
				fontWeight="bold"
				fontSize="2xl"
				color={accentColor}
				dir="ltr"
				sx={{ unicodeBidi: "isolate" }}
			>
				{value}
			</Text>
			{helper ? (
				<Text
					mt={1}
					fontSize="xs"
					color="gray.600"
					_dark={{ color: "gray.400" }}
				>
					{helper}
				</Text>
			) : null}
		</Box>
	);
};

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
		<Stack spacing={1}>
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
				spacing={2}
				flexWrap="wrap"
				fontSize="xs"
				color="gray.600"
				_dark={{ color: "gray.400" }}
				dir={isRTL ? "rtl" : "ltr"}
			>
				<Text>
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
				<HStack spacing={1}>
					<Text>{t("usersTable.total")}:</Text>
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{formatBytes(totalUsedTraffic)}
					</chakra.span>
				</HStack>
			</HStack>
		</Stack>
	);
};

export type SortType = {
	sort: string;
	column: string;
};
export const Sort: FC<SortType> = ({ sort, column }) => {
	if (sort.includes(column))
		return (
			<SortIcon
				transform={sort.startsWith("-") ? undefined : "rotate(180deg)"}
			/>
		);
	return null;
};

type UsersTableProps = TableProps;
export const UsersTable: FC<UsersTableProps> = (props) => {
	const {
		filters,
		users: usersResponse,
		onEditingUser,
		onFilterChange,
		loading,
		isUserLimitReached,
		onDeletingUser,
		resetDataUsage,
		revokeSubscription,
		refetchUsers,
	} = useDashboard();

	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const locale = i18n.language || "en";
	const toast = useToast();
	const dialogBg = useColorModeValue("surface.light", "surface.dark");
	const dialogBorderColor = useColorModeValue("light-border", "gray.700");

	const { userData } = useGetUser();
	const hasElevatedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const isAdminDisabled = Boolean(
		!hasElevatedRole && userData.status === AdminStatus.Disabled,
	);
	const canCreateUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const canDeleteUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Delete]);
	const canResetUsage =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.ResetUsage]);
	const canRevokeSub =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Revoke]);
	const disabledReason = userData.disabled_reason;

	const rowsToRender = filters.limit || 10;
	const skeletonKeys = useMemo(
		() => Array.from({ length: rowsToRender }, () => createStableKey()),
		[rowsToRender],
	);
	const isFiltered = usersResponse.users.length !== usersResponse.total;
	const isDesktop = useBreakpointValue({ base: false, lg: true }) ?? false;
	const isMobile = useBreakpointValue({ base: true, md: false }) ?? false;
	const hasSearchQuery = Boolean(filters.search?.trim());
	// On mobile, only hide cards while a search is loading; show results once data arrives.
	const hideMobileCardsDuringSearch = !isDesktop && hasSearchQuery && loading;
	const [contextMenu, setContextMenu] = useState<{
		visible: boolean;
		x: number;
		y: number;
		user: UserListItem | null;
	}>({
		visible: false,
		x: 0,
		y: 0,
		user: null,
	});
	const [menuSize, setMenuSize] = useState<{ w: number; h: number }>({
		w: 0,
		h: 0,
	});
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const [contextAction, setContextAction] = useState<string | null>(null);

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
	const handleStatusFilter = (e: ChangeEvent<HTMLSelectElement>) => {
		const nextStatus = (
			e.target.value.length > 0 ? e.target.value : undefined
		) as FilterType["status"];
		onFilterChange({
			status: nextStatus,
			offset: 0,
		});
	};

	const closeContextMenu = useCallback(() => {
		setContextMenu({ visible: false, x: 0, y: 0, user: null });
	}, []);

	useEffect(() => {
		if (!contextMenu.visible) return;
		const handleClick = (event: Event) => {
			if (contextMenuRef.current?.contains(event.target as Node)) {
				return;
			}
			closeContextMenu();
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closeContextMenu();
			}
		};
		const handlePointer = (event: Event) => {
			if (!contextMenuRef.current) {
				closeContextMenu();
				return;
			}
			if (contextMenuRef.current.contains(event.target as Node)) {
				return;
			}
			closeContextMenu();
		};
		const handleScroll = () => closeContextMenu();
		window.addEventListener("click", handleClick, true);
		window.addEventListener("mousedown", handlePointer, true);
		window.addEventListener("contextmenu", handlePointer, true);
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("scroll", handleScroll, true);
		return () => {
			window.removeEventListener("click", handleClick, true);
			window.removeEventListener("mousedown", handlePointer, true);
			window.removeEventListener("contextmenu", handlePointer, true);
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("scroll", handleScroll, true);
		};
	}, [contextMenu.visible, closeContextMenu]);

	useEffect(() => {
		if (!contextMenu.visible) return;
		const el = contextMenuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.width !== menuSize.w || rect.height !== menuSize.h) {
			setMenuSize({ w: rect.width, h: rect.height });
		}
		const padding = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let nextX = contextMenu.x;
		let nextY = contextMenu.y;
		if (nextX + rect.width > vw - padding) {
			nextX = Math.max(padding, vw - rect.width - padding);
		}
		if (nextY + rect.height > vh - padding) {
			nextY = Math.max(padding, vh - rect.height - padding);
		}
		if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
			setContextMenu((prev) => ({ ...prev, x: nextX, y: nextY }));
		}
	}, [contextMenu, menuSize.w, menuSize.h]);

	const handleRowContextMenu = (
		event: React.MouseEvent,
		user: UserListItem,
	) => {
		if (!isDesktop) return;
		const pos = { x: event.clientX, y: event.clientY };
		const sameSpot =
			contextMenu.visible &&
			Math.abs(pos.x - contextMenu.x) < 4 &&
			Math.abs(pos.y - contextMenu.y) < 4;
		if (sameSpot) {
			closeContextMenu();
			return; // allow browser default menu
		}
		const allowTraffic =
			canCreateUsers && user.data_limit !== null && user.data_limit !== 0;
		const allowExpire =
			canCreateUsers &&
			user.expire !== null &&
			user.expire !== 0 &&
			user.expire !== undefined;
		const hasActions =
			canCreateUsers ||
			canDeleteUsers ||
			canResetUsage ||
			canRevokeSub ||
			allowTraffic ||
			allowExpire;
		if (!hasActions) {
			return;
		}
		event.preventDefault();
		setContextMenu({
			visible: true,
			x: pos.x,
			y: pos.y,
			user,
		});
	};

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
		setContextAction("traffic");
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
		if (!canCreateUsers || user.status === "disabled") return;
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

	const { className, sx, ...restProps } = props;
	const normalizedSx = Array.isArray(sx)
		? Object.assign({}, ...sx)
		: (sx as Record<string, unknown> | undefined);
	const baseTableSx: Record<string, unknown> = {
		width: "100%",
		borderCollapse: "collapse",
		borderSpacing: 0,
		"& th, & td": {
			paddingInlineStart: "14px",
			paddingInlineEnd: "14px",
			paddingTop: "12px",
			paddingBottom: "12px",
			verticalAlign: "middle",
		},
	};
	const tableClassName = isRTL
		? classNames(className, "rb-rtl-table")
		: className;
	const tableProps = {
		...restProps,
		className: tableClassName,
		sx: {
			...baseTableSx,
			...(isRTL
				? {
						"& th, & td": {
							...(baseTableSx["& th, & td"] as object),
							borderLeft: "0 !important",
							borderRight: "0 !important",
						},
					}
				: {}),
			...(normalizedSx || {}),
		},
	};

	const baseColumns: Array<
		"username" | "status" | "service" | "usage" | "actions"
	> = ["username", "status", "service", "usage", "actions"];
	const columnsToRender = isRTL ? baseColumns.slice().reverse() : baseColumns;
	const cellAlign = isRTL ? "right" : "left";
	const actionsAlign = isRTL ? "left" : "right";
	if (import.meta.env.MODE !== "production" && isRTL) {
		const first = columnsToRender[0];
		const last = columnsToRender[columnsToRender.length - 1];
		if (first !== "actions" || last !== "username") {
			console.warn("RTL users table columns misordered", columnsToRender);
		}
	}

	const userUsage = userData.users_usage ?? null;
	const filteredUsageTotal = usersResponse.usage_total ?? null;
	const activeUsersCount =
		statusBreakdown.active ?? usersResponse.active_total ?? 0;
	const summaryItems: SummaryStatProps[] = [
		{
			label: t("usersTable.total"),
			value: formatCount(usersResponse.total, locale),
			accentColor: isUserLimitReached ? "red.400" : "primary.500",
		},
		{
			label: t("status.active"),
			value: formatCount(activeUsersCount, locale),
			accentColor: "green.400",
		},
		{
			label: t("status.on_hold"),
			value: formatCount(statusBreakdown.on_hold ?? 0, locale),
			accentColor: "orange.400",
		},
		{
			label: t("status.limited"),
			value: formatCount(statusBreakdown.limited ?? 0, locale),
			accentColor: "yellow.500",
		},
		{
			label: t("status.expired"),
			value: formatCount(statusBreakdown.expired ?? 0, locale),
			accentColor: "red.400",
		},
		{
			label: t("status.online", "Online"),
			value: formatCount(usersResponse.online_total ?? 0, locale),
			accentColor: "teal.400",
		},
	];

	const usageForSummary = filteredUsageTotal ?? userUsage;

	if (usageForSummary !== null) {
		summaryItems.push({
			label: t("UsersUsage", "Users Usage"),
			value: formatBytes(usageForSummary),
			accentColor: "primary.500",
		});
	}

	const summaryColumns = Math.min(Math.max(summaryItems.length, 1), 4);

	const desktopTable = (
		<Table
			key={isRTL ? "rtl-desktop" : "ltr-desktop"}
			variant="simple"
			dir={isRTL ? "rtl" : "ltr"}
			width="100%"
			w="full"
			{...tableProps}
		>
			<Thead>
				{(() => {
					const headers: Record<string, JSX.Element> = {
						username: (
							<Th
								minW="200px"
								cursor="pointer"
								onClick={handleSort.bind(null, "username")}
								textAlign={cellAlign}
							>
								<HStack
									spacing={3}
									align="center"
									justify="flex-start"
									flexDirection={isRTL ? "row-reverse" : "row"}
								>
									<Box
										w="10px"
										h="10px"
										borderRadius="full"
										borderWidth="1px"
										borderColor="transparent"
										flexShrink={0}
									/>
									<HStack spacing={2} align="center">
										<span>{t("username")}</span>
										<Sort sort={filters.sort} column="username" />
									</HStack>
								</HStack>
							</Th>
						),
						status: (
							<Th
								minW="170px"
								width="180px"
								textAlign={cellAlign}
								cursor="pointer"
								onClick={handleSort.bind(null, "expire")}
							>
								<Flex
									align="center"
									justify="flex-start"
									gap={2}
									dir={isRTL ? "rtl" : "ltr"}
								>
									<span>{t("usersTable.status")}</span>
									<Sort sort={filters.sort} column="expire" />
								</Flex>
							</Th>
						),
						service: (
							<Th minW="140px" textAlign={cellAlign}>
								{t("usersTable.service", "Service")}
							</Th>
						),
						usage: (
							<Th
								minW="240px"
								textAlign={cellAlign}
								cursor="pointer"
								onClick={handleSort.bind(null, "used_traffic")}
							>
								<HStack spacing={2} align="center">
									<span>{t("usersTable.dataUsage")}</span>
									<Sort sort={filters.sort} column="used_traffic" />
								</HStack>
							</Th>
						),
						actions: (
							<Th
								minW="170px"
								width="180px"
								textAlign={actionsAlign}
								data-actions="true"
							/>
						),
					};

					return (
						<Tr>
							{columnsToRender.map((key) => (
								<React.Fragment key={`header-${key}`}>
									{headers[key]}
								</React.Fragment>
							))}
						</Tr>
					);
				})()}
			</Thead>
			<Tbody>
				{loading
					? skeletonKeys.map((rowKey) => {
							const cells = {
								username: (
									<Td textAlign={cellAlign}>
										<SkeletonText
											noOfLines={1}
											width="50%"
											textAlign={cellAlign}
										/>
										<SkeletonText noOfLines={1} width="30%" mt={2} />
									</Td>
								),
								status: (
									<Td textAlign={cellAlign}>
										<Skeleton height="16px" width="120px" />
									</Td>
								),
								service: (
									<Td textAlign={cellAlign}>
										<SkeletonText noOfLines={1} width="60%" />
									</Td>
								),
								usage: (
									<Td textAlign={cellAlign}>
										<Skeleton height="16px" width="220px" />
									</Td>
								),
								actions: (
									<Td textAlign={actionsAlign} width="180px" minW="170px">
										<HStack
											justify="flex-start"
											align="center"
											spacing={2}
											dir={isRTL ? "rtl" : "ltr"}
										>
											<Skeleton height="16px" width="32px" />
											<Skeleton height="16px" width="32px" />
										</HStack>
									</Td>
								),
							};
							return (
								<Tr key={`skeleton-desktop-${rowKey}`}>
									{columnsToRender.map((key) => (
										<React.Fragment key={`${rowKey}-${key}`}>
											{cells[key]}
										</React.Fragment>
									))}
								</Tr>
							);
						})
					: usersResponse.users.map((user) => {
							const cells = {
								username: (
									<Td textAlign={cellAlign}>
										<HStack
											spacing={3}
											align="flex-start"
											flexDirection={isRTL ? "row-reverse" : "row"}
											justify="flex-start"
										>
											<OnlineBadge lastOnline={user.online_at ?? null} />
											<Box minW={0}>
												<Text
													fontWeight="semibold"
													noOfLines={1}
													dir="ltr"
													sx={{ unicodeBidi: "isolate" }}
												>
													{user.username}
												</Text>
												<CreatedByText
													show={hasElevatedRole}
													adminUsername={user.admin_username}
												/>
												<OnlineStatus lastOnline={user.online_at ?? null} />
											</Box>
										</HStack>
									</Td>
								),
								status: (
									<Td textAlign={cellAlign} minW="170px" width="180px">
										<Flex
											align="center"
											justify="flex-start"
											dir={isRTL ? "rtl" : "ltr"}
											w="full"
										>
											<StatusBadge
												expiryDate={user.expire}
												status={user.status}
											/>
										</Flex>
									</Td>
								),
								service: (
									<Td textAlign={cellAlign}>
										<Text
											fontSize="sm"
											color={user.service_name ? "gray.800" : "gray.500"}
											_dark={{
												color: user.service_name ? "gray.100" : "gray.500",
											}}
											noOfLines={1}
										>
											{user.service_name ??
												t("usersTable.defaultService", "Default")}
										</Text>
									</Td>
								),
								usage: (
									<Td textAlign={cellAlign}>
										<UsageMeter
											status={user.status}
											totalUsedTraffic={user.lifetime_used_traffic}
											dataLimitResetStrategy={user.data_limit_reset_strategy}
											used={user.used_traffic}
											total={user.data_limit}
											isRTL={isRTL}
											t={t}
										/>
									</Td>
								),
								actions: (
									<Td
										textAlign={actionsAlign}
										width="180px"
										minW="170px"
										data-actions="true"
										dir={isRTL ? "rtl" : "ltr"}
									>
										<HStack justify="flex-start" align="center" spacing={2}>
											<ActionButtons
												user={user}
												isRTL={isRTL}
												onEdit={
													canCreateUsers ? () => onEditingUser(user) : undefined
												}
												onDelete={
													canDeleteUsers
														? () => onDeletingUser(user)
														: undefined
												}
											/>
										</HStack>
									</Td>
								),
							};
							return (
								<Tr
									key={user.username}
									className={classNames("interactive")}
									onClick={() => {
										if (canCreateUsers) {
											onEditingUser(user);
										}
									}}
									onContextMenu={(event) => handleRowContextMenu(event, user)}
									cursor={canCreateUsers ? "pointer" : "default"}
								>
									{columnsToRender.map((key) => (
										<React.Fragment key={`${user.username}-${key}`}>
											{cells[key]}
										</React.Fragment>
									))}
								</Tr>
							);
						})}
				{!loading && usersResponse.users.length === 0 && (
					<Tr>
						<Td colSpan={5} borderBottom="0">
							<EmptySection
								isFiltered={isFiltered}
								isCreateDisabled={isAdminDisabled || !canCreateUsers}
							/>
						</Td>
					</Tr>
				)}
			</Tbody>
		</Table>
	);

	const mobileList = (
		<VStack
			key={isRTL ? "rtl-mobile" : "ltr-mobile"}
			spacing={3}
			align="stretch"
		>
			{hideMobileCardsDuringSearch
				? null
				: loading
					? skeletonKeys.map((key) => (
							<Box
								key={key}
								borderWidth="1px"
								borderColor="light-border"
								bg="surface.light"
								_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
								borderRadius="xl"
								p={4}
							>
								<Stack spacing={3}>
									<SkeletonText noOfLines={1} width="50%" />
									<Skeleton height="16px" width="80px" />
									<Skeleton height="8px" width="100%" />
									<HStack justify="flex-end" spacing={2}>
										<Skeleton height="16px" width="32px" />
										<Skeleton height="16px" width="32px" />
									</HStack>
								</Stack>
							</Box>
						))
					: usersResponse.users.map((user) => (
							<MobileUserCard
								key={user.username}
								user={user}
								canEdit={canCreateUsers}
								onEdit={() => onEditingUser(user)}
								onDelete={
									canDeleteUsers ? () => onDeletingUser(user) : undefined
								}
								isRTL={isRTL}
								showCreator={hasElevatedRole}
								t={t}
							/>
						))}
			{!loading && usersResponse.users.length === 0 && (
				<EmptySection
					isFiltered={isFiltered}
					isCreateDisabled={isAdminDisabled || !canCreateUsers}
				/>
			)}
		</VStack>
	);

	return (
		<VStack
			spacing={4}
			align="stretch"
			dir={isRTL ? "rtl" : "ltr"}
			data-dir={isRTL ? "rtl" : "ltr"}
		>
			{isDesktop && (
				<SimpleGrid
					columns={{
						base: 1,
						sm: Math.min(summaryColumns, 2),
						xl: summaryColumns,
					}}
					gap={3}
				>
					{summaryItems.map((item, idx) => (
						<SummaryStat key={`${item.label}-${idx}`} {...item} />
					))}
				</SimpleGrid>
			)}
			<Box position="relative">
				<Card
					borderWidth="1px"
					borderColor="light-border"
					bg="surface.light"
					_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
					filter={isAdminDisabled ? "blur(4px)" : undefined}
					pointerEvents={isAdminDisabled ? "none" : undefined}
					aria-hidden={isAdminDisabled ? true : undefined}
				>
					<CardHeader
						borderBottomWidth="1px"
						borderColor="light-border"
						_dark={{ borderColor: "whiteAlpha.200" }}
						pb={3}
					>
						<Stack spacing={3}>
							<Flex
								align={{ base: "flex-start", md: "center" }}
								justify="space-between"
								gap={3}
								flexWrap="wrap"
							>
								<VStack align="flex-start" spacing={0}>
									<Text fontWeight="semibold">{t("users")}</Text>
									<Text
										fontSize="sm"
										color="gray.600"
										_dark={{ color: "gray.400" }}
									>
										{t("usersTable.total")}:{" "}
										<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
											{formatCount(usersResponse.total, locale)}
										</chakra.span>
										{isFiltered ? ` • ${t("usersPage.filtered")}` : ""}
									</Text>
								</VStack>
								<HStack spacing={2} align="center">
									<Text
										fontSize="sm"
										color="gray.600"
										_dark={{ color: "gray.400" }}
									>
										{t("usersTable.status")}
									</Text>
									<Select
										value={filters.status ?? ""}
										fontSize="sm"
										onChange={handleStatusFilter}
										minW={{ base: "160px", md: "200px" }}
									>
										<option value="">
											{t("usersPage.statusAll", "All statuses")}
										</option>
										<option value="active">{t("status.active")}</option>
										<option value="on_hold">{t("status.on_hold")}</option>
										<option value="disabled">{t("status.disabled")}</option>
										<option value="limited">{t("status.limited")}</option>
										<option value="expired">{t("status.expired")}</option>
									</Select>
								</HStack>
							</Flex>
							{!isDesktop && !(isMobile && hasSearchQuery) && (
								<SimpleGrid columns={{ base: 2 }} gap={3}>
									{summaryItems.map((item, idx) => (
										<SummaryStat
											key={`${item.label}-${idx}`}
											{...item}
											isMobile={isMobile}
										/>
									))}
								</SimpleGrid>
							)}
						</Stack>
					</CardHeader>
					<CardBody
						px={{
							base: 3,
							md: 4,
						}}
						py={{
							base: 3,
							md: 4,
						}}
					>
						<Box
							w="full"
							px={{
								base: 2,
								md: 0,
							}}
						>
							<Box
								w="full"
								borderWidth="1px"
								borderRadius="xl"
								overflow="hidden"
							>
								{isDesktop ? desktopTable : mobileList}
							</Box>
						</Box>
					</CardBody>
				</Card>
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
			{contextMenu.visible && contextMenu.user && (
				<Box
					position="fixed"
					top={contextMenu.y}
					left={contextMenu.x}
					bg={dialogBg}
					borderWidth="1px"
					borderColor={dialogBorderColor}
					borderRadius="md"
					boxShadow="lg"
					zIndex={1500}
					minW="220px"
					onClick={(e) => e.stopPropagation()}
					onContextMenu={(e) => {
						e.preventDefault();
						closeContextMenu();
					}}
					ref={contextMenuRef}
				>
					<Stack spacing={1} p={2}>
						{canCreateUsers && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<EditIcon />}
								onClick={() => {
									onEditingUser(contextMenu.user!);
									closeContextMenu();
								}}
							>
								{t("userDialog.editUser", "Edit user")}
							</Button>
						)}
						{canCreateUsers && contextMenu.user.status !== "disabled" && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<RevokeIcon />}
								onClick={() => handleDisableUser(contextMenu.user!)}
								isLoading={contextAction === "disable"}
							>
								{t("usersTable.disableUser", "Disable user")}
							</Button>
						)}
						{canResetUsage && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<ResetIcon />}
								onClick={() => handleResetUsage(contextMenu.user!)}
								isLoading={contextAction === "reset"}
							>
								{t("usersTable.resetUsage", "Reset usage")}
							</Button>
						)}
						{canRevokeSub && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<RevokeIcon />}
								onClick={() => handleRevokeSub(contextMenu.user!)}
								isLoading={contextAction === "revoke"}
							>
								{t("usersTable.revokeSub", "Revoke subscription")}
							</Button>
						)}
						{canCreateUsers &&
							contextMenu.user.data_limit !== null &&
							contextMenu.user.data_limit !== 0 && (
								<Button
									variant="ghost"
									justifyContent="flex-start"
									leftIcon={<TrafficIcon />}
									onClick={() => handleAdjustTraffic(contextMenu.user!, 10)}
									isLoading={contextAction === "traffic"}
								>
									{t("usersTable.add10Gb", "Add 10 GB")}
								</Button>
							)}
						{canCreateUsers &&
							contextMenu.user.expire !== null &&
							contextMenu.user.expire !== 0 &&
							contextMenu.user.expire !== undefined && (
								<Button
									variant="ghost"
									justifyContent="flex-start"
									leftIcon={<ExtendIcon />}
									onClick={() => handleExtendExpire(contextMenu.user!, 30)}
									isLoading={contextAction === "expire"}
								>
									{t("usersTable.add30Days", "Add 30 days")}
								</Button>
							)}
						{canDeleteUsers && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								colorScheme="red"
								leftIcon={<DeleteIcon />}
								onClick={() => {
									onDeletingUser(contextMenu.user!);
									closeContextMenu();
								}}
							>
								{t("deleteUser.title", "Delete user")}
							</Button>
						)}
					</Stack>
				</Box>
			)}
		</VStack>
	);
};

type UserCardProps = {
	user: UserListItem;
	onEdit: () => void;
	canEdit: boolean;
	onDelete?: () => void;
	isRTL: boolean;
	showCreator: boolean;
	t: TranslateFn;
};

const _UserCard: FC<UserCardProps> = ({
	user,
	onEdit,
	canEdit,
	onDelete,
	isRTL,
	showCreator,
	t,
}) => (
	<Box
		borderWidth="1px"
		borderColor="light-border"
		bg="surface.light"
		_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
		borderRadius="xl"
		p={4}
		dir={isRTL ? "rtl" : "ltr"}
	>
		<Stack spacing={4}>
			<HStack justify="space-between" align="flex-start" spacing={3}>
				<HStack spacing={3} align="center" minW={0}>
					<OnlineBadge lastOnline={user.online_at ?? null} />
					<Box minW={0}>
						<Text
							fontWeight="semibold"
							noOfLines={1}
							dir="ltr"
							sx={{ unicodeBidi: "isolate" }}
						>
							{user.username}
						</Text>
						<CreatedByText
							show={showCreator}
							adminUsername={user.admin_username}
						/>
						<OnlineStatus lastOnline={user.online_at ?? null} />
					</Box>
				</HStack>
				<StatusBadge expiryDate={user.expire} status={user.status} />
			</HStack>
			<HStack justify="space-between" align="flex-start" spacing={4}>
				<Box>
					<Text fontSize="xs" color="gray.600" _dark={{ color: "gray.400" }}>
						{t("usersTable.service", "Service")}
					</Text>
					<Text
						fontWeight="medium"
						color={user.service_name ? "gray.800" : "gray.500"}
						_dark={{ color: user.service_name ? "gray.100" : "gray.500" }}
						noOfLines={1}
					>
						{user.service_name ?? t("usersTable.defaultService", "Default")}
					</Text>
				</Box>
				<Box textAlign={isRTL ? "left" : "right"}>
					<Text fontSize="xs" color="gray.600" _dark={{ color: "gray.400" }}>
						{t("usersTable.status")}
					</Text>
					<Text
						fontWeight="medium"
						color="gray.800"
						_dark={{ color: "gray.100" }}
					>
						{t(`status.${user.status}`, user.status)}
					</Text>
				</Box>
			</HStack>
			<UsageMeter
				status={user.status}
				totalUsedTraffic={user.lifetime_used_traffic}
				dataLimitResetStrategy={user.data_limit_reset_strategy}
				used={user.used_traffic}
				total={user.data_limit}
				isRTL={isRTL}
				t={t}
			/>
			<HStack justify="space-between" align="center" spacing={3}>
				<ActionButtons
					user={user}
					isRTL={isRTL}
					onEdit={canEdit ? onEdit : undefined}
					onDelete={onDelete}
				/>
			</HStack>
		</Stack>
	</Box>
);

const MobileUserCard: FC<UserCardProps> = ({
	user,
	onEdit,
	canEdit,
	onDelete,
	isRTL,
	showCreator,
	t,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const toggle = () => setIsOpen((prev) => !prev);
	const expiryInfo = relativeExpiryDate(user.expire);
	const hasExpiry =
		user.expire !== null &&
		user.expire !== undefined &&
		Boolean(expiryInfo.time && expiryInfo.time.length > 0);
	const expiryText = hasExpiry
		? expiryInfo.status === "expires"
			? t("expires", "Expires in {{time}}").replace("{{time}}", expiryInfo.time)
			: t("expired", "Expired {{time}} ago").replace(
					"{{time}}",
					expiryInfo.time,
				)
		: "";
	const usedLabel = formatBytes(user.used_traffic);
	const totalLabel =
		user.data_limit && user.data_limit > 0 ? formatBytes(user.data_limit) : "∞";
	const usageLabelNode = (
		<Text
			fontSize="xs"
			color="gray.500"
			_dark={{ color: "gray.400" }}
			className="rb-usage-pair"
		>
			<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
				{usedLabel}
			</chakra.span>
			{" / "}
			<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
				{totalLabel}
			</chakra.span>
		</Text>
	);

	return (
		<Box
			borderWidth="1px"
			borderColor="light-border"
			bg="surface.light"
			_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
			borderRadius="xl"
			p={3}
			dir={isRTL ? "rtl" : "ltr"}
			onClick={toggle}
			cursor="pointer"
		>
			<Stack spacing={3}>
				<HStack justify="space-between" align="flex-start" spacing={3}>
					<HStack spacing={3} align="flex-start" minW={0}>
						<OnlineBadge lastOnline={user.online_at ?? null} />
						<VStack align="flex-start" spacing={1} minW={0}>
							<Text
								fontWeight="semibold"
								noOfLines={1}
								dir="ltr"
								sx={{ unicodeBidi: "isolate" }}
							>
								{user.username}
							</Text>
							<CreatedByText
								show={showCreator}
								adminUsername={user.admin_username}
							/>
							<OnlineStatus
								lastOnline={user.online_at ?? null}
								withMargin={false}
							/>
							{usageLabelNode}
						</VStack>
					</HStack>
					<VStack
						align="center"
						spacing={1}
						flexShrink={0}
						w="120px"
						maxW="140px"
					>
						<StatusBadge
							expiryDate={user.expire}
							status={user.status}
							showDetail={false}
						/>
						{expiryText ? (
							<Text
								fontSize="xs"
								color="gray.500"
								_dark={{ color: "gray.400" }}
								textAlign="center"
								whiteSpace="normal"
								wordBreak="break-word"
								w="full"
								maxW="inherit"
								lineHeight="1.35"
							>
								{expiryText}
							</Text>
						) : null}
					</VStack>
				</HStack>
				<Collapse in={isOpen} animateOpacity>
					<Stack spacing={3} pt={1}>
						<HStack justify="space-between" align="flex-start" spacing={4}>
							<Box>
								<Text
									fontSize="xs"
									color="gray.600"
									_dark={{ color: "gray.400" }}
								>
									{t("usersTable.service", "Service")}
								</Text>
								<Text
									fontWeight="medium"
									color={user.service_name ? "gray.800" : "gray.500"}
									_dark={{ color: user.service_name ? "gray.100" : "gray.500" }}
									noOfLines={1}
								>
									{user.service_name ??
										t("usersTable.defaultService", "Default")}
								</Text>
							</Box>
							<Box textAlign={isRTL ? "left" : "right"}>
								<Text
									fontSize="xs"
									color="gray.600"
									_dark={{ color: "gray.400" }}
								>
									{t("usersTable.status")}
								</Text>
								<Text
									fontWeight="medium"
									color="gray.800"
									_dark={{ color: "gray.100" }}
								>
									{t(`status.${user.status}`, user.status)}
								</Text>
							</Box>
						</HStack>
						<UsageMeter
							status={user.status}
							totalUsedTraffic={user.lifetime_used_traffic}
							dataLimitResetStrategy={user.data_limit_reset_strategy}
							used={user.used_traffic}
							total={user.data_limit}
							isRTL={isRTL}
							t={t}
						/>
						<HStack
							justify="flex-start"
							align="center"
							spacing={3}
							onClick={(e) => e.stopPropagation()}
						>
							<ActionButtons
								user={user}
								isRTL={isRTL}
								onEdit={canEdit ? onEdit : undefined}
								onDelete={onDelete}
							/>
						</HStack>
					</Stack>
				</Collapse>
			</Stack>
		</Box>
	);
};

type ActionButtonsUser = User | UserListItem;
type ActionButtonsProps = {
	user: ActionButtonsUser;
	onDelete?: () => void;
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
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<CopyToClipboard
				text={subscriptionLink}
				onCopy={() => {
					setCopied(true);
				}}
			>
				<div>
					<Tooltip
						label={copied ? t("usersTable.copied") : t("usersTable.copyLink")}
						placement="top"
					>
						<IconButton
							p="0 !important"
							aria-label="copy subscription link"
							variant="ghost"
							size={{ base: "sm", md: "md" }}
						>
							{copied ? <CopiedIcon /> : <SubscriptionLinkIcon />}
						</IconButton>
					</Tooltip>
				</div>
			</CopyToClipboard>
			<CopyToClipboard
				text={configLinksText}
				onCopy={() => {
					if (hasConfigLinks) setCopiedConfigs(true);
				}}
			>
				<div>
					<Tooltip
						label={
							copiedConfigs
								? t("usersTable.copied")
								: t("usersTable.copyConfigs")
						}
						placement="top"
					>
						<IconButton
							p="0 !important"
							aria-label="copy config links"
							variant="ghost"
							size={{ base: "sm", md: "md" }}
							isDisabled={!hasConfigLinks}
						>
							{copiedConfigs ? <CopiedIcon /> : <CopyIcon />}
						</IconButton>
					</Tooltip>
				</div>
			</CopyToClipboard>
			<Tooltip label="QR Code" placement="top">
				<IconButton
					p="0 !important"
					aria-label="qr code"
					variant="ghost"
					size={{ base: "sm", md: "md" }}
					onClick={() => {
						const links = generateUserLinks(user, linkTemplates);
						setQRCode(links);
						setSubLink(subscriptionLink);
					}}
				>
					<QRIcon />
				</IconButton>
			</Tooltip>
			{onEdit && (
				<Tooltip label={t("userDialog.editUser")} placement="top">
					<IconButton
						p="0 !important"
						aria-label="edit user"
						variant="ghost"
						size={{ base: "sm", md: "md" }}
						onClick={(e) => {
							e.stopPropagation();
							onEdit();
						}}
					>
						<EditIcon />
					</IconButton>
				</Tooltip>
			)}
			{onDelete && (
				<Tooltip label={t("deleteUser.title")} placement="top">
					<IconButton
						p="0 !important"
						aria-label="delete user"
						variant="ghost"
						colorScheme="red"
						size={{ base: "sm", md: "md" }}
						onClick={onDelete}
					>
						<DeleteIcon />
					</IconButton>
				</Tooltip>
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
