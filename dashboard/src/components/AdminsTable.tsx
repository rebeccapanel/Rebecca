import {
	AlertDialog,
	AlertDialogBody,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	Box,
	Button,
	Card,
	CardBody,
	CardHeader,
	Collapse,
	chakra,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Skeleton,
	Stack,
	Table,
	type TableProps,
	Tbody,
	Td,
	Text,
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
	Textarea,
	Th,
	Thead,
	Tooltip,
	Tr,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	useClipboard,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	AdjustmentsHorizontalIcon,
	ArrowPathIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	KeyIcon,
	PencilIcon,
	PlusCircleIcon,
	PlayIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/outline";
import { NoSymbolIcon } from "@heroicons/react/24/solid";
import classNames from "classnames";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import {
	cloneElement,
	type FC,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Admin } from "types/Admin";
import { AdminManagementPermission, AdminRole, AdminStatus } from "types/Admin";
import { formatBytes } from "utils/formatByte";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import AdminPermissionsModal from "./AdminPermissionsModal";

const ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted";

const iconProps = {
	baseStyle: {
		strokeWidth: "2px",
		w: 3,
		h: 3,
	},
};

const ActiveAdminStatusIcon = chakra(CheckCircleIcon, iconProps);
const DisabledAdminStatusIcon = chakra(XCircleIcon, iconProps);
const ResetIcon = chakra(ArrowPathIcon, iconProps);
const DisableIcon = chakra(NoSymbolIcon, iconProps);
const EnableIcon = chakra(PlayIcon, iconProps);
const DeleteIcon = chakra(TrashIcon, iconProps);
const QuickPassIcon = chakra(KeyIcon, iconProps);
const AddDataIcon = chakra(PlusCircleIcon, iconProps);

const AdminStatusBadge: FC<{ status: AdminStatus }> = ({ status }) => {
	const { t } = useTranslation();
	const isActive = status === AdminStatus.Active;
	const Icon = isActive ? ActiveAdminStatusIcon : DisabledAdminStatusIcon;

	const badgeStyles = useColorModeValue(
		{
			bg: isActive ? "green.100" : "red.100",
			color: isActive ? "green.800" : "red.800",
		},
		{
			bg: isActive ? "green.900" : "red.900",
			color: isActive ? "green.200" : "red.200",
		},
	);

	return (
		<Box
			display="inline-flex"
			alignItems="center"
			columnGap={1}
			px={2}
			py={0.5}
			borderRadius="md"
			bg={badgeStyles.bg}
			color={badgeStyles.color}
			fontSize="xs"
			fontWeight="medium"
			lineHeight="1"
			w="fit-content"
		>
			<Icon w={3} h={3} />
			<Text textTransform="capitalize">
				{isActive
					? t("status.active", "Active")
					: t("admins.disabledLabel", "Disabled")}
			</Text>
		</Box>
	);
};

type AdminUsageSliderProps = {
	used: number;
	total: number | null;
	lifetimeUsage: number | null;
	isRTL?: boolean;
};

const AdminUsageSlider: FC<AdminUsageSliderProps> = ({
	used,
	total,
	lifetimeUsage,
	isRTL = false,
}) => {
	const { t } = useTranslation();
	const isUnlimited = total === 0 || total === null;
	const percentage = isUnlimited
		? 0
		: Math.min((used / (total || 1)) * 100, 100);
	const reached = !isUnlimited && percentage >= 100;

	return (
		<Stack spacing={1} width="100%">
			<Box
				as="div"
				height="6px"
				borderRadius="full"
				bg="gray.100"
				_dark={{ bg: "gray.700" }}
				overflow="hidden"
				position="relative"
			>
				<Box
					position="absolute"
					insetY={0}
					{...(isRTL ? { right: 0 } : { left: 0 })}
					width={isUnlimited ? "100%" : `${percentage}%`}
					bg={reached ? "red.400" : "primary.500"}
					transition="width 0.2s ease"
				/>
			</Box>
			<HStack
				justify="space-between"
				align="center"
				fontSize="xs"
				fontWeight="medium"
				color="gray.600"
				_dark={{ color: "gray.400" }}
				flexWrap="wrap"
				gap={3}
				dir={isRTL ? "rtl" : "ltr"}
				textAlign={isRTL ? "end" : "start"}
				w="full"
			>
				<Text className="rb-usage-pair">
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{formatBytes(used, 2)}
					</chakra.span>{" "}
					/{" "}
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{isUnlimited ? "∞" : formatBytes(total ?? 0, 2)}
					</chakra.span>
				</Text>
				{lifetimeUsage !== null && lifetimeUsage !== undefined && (
					<Text color="blue.500" _dark={{ color: "blue.300" }}>
						{t("admins.details.lifetime", "Lifetime usage")}:{" "}
						<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
							{formatBytes(lifetimeUsage, 2)}
						</chakra.span>
					</Text>
				)}
			</HStack>
		</Stack>
	);
};

const formatCount = (value: number | null | undefined, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value ?? 0);

const RoleChip: FC<{ label: string; value: number; color: string }> = ({
	label,
	value,
	color,
}) => (
	<HStack
		spacing={2}
		borderWidth="1px"
		borderColor="light-border"
		borderRadius="full"
		px={3}
		py={2}
		bg="surface.light"
		_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
		opacity={value === 0 ? 0.65 : 1}
	>
		<Text fontSize="sm" color={color} fontWeight="semibold">
			{label}
		</Text>
		<Text fontSize="sm" fontWeight="bold" color={color} dir="ltr">
			{value}
		</Text>
	</HStack>
);
export const AdminsTable: FC<TableProps> = (props) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const locale = i18n.language || "en";
	const toast = useToast();
	const { userData } = useGetUser();
	const rowHoverBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const rowSelectedBg = useColorModeValue("primary.50", "primary.900");
	const dialogBg = useColorModeValue("surface.light", "surface.dark");
	const dialogBorderColor = useColorModeValue("light-border", "gray.700");
	const {
		admins,
		loading,
		total,
		filters,
		onFilterChange,
		fetchAdmins,
		deleteAdmin,
		resetUsage,
		disableAdmin,
		enableAdmin,
		updateAdmin,
		openAdminDialog,
		openAdminDetails,
		adminInDetails,
	} = useAdminsStore();
	const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
	const disableCancelRef = useRef<HTMLButtonElement | null>(null);
	const {
		isOpen: isDeleteDialogOpen,
		onOpen: openDeleteDialog,
		onClose: closeDeleteDialog,
	} = useDisclosure();
	const {
		isOpen: isDisableDialogOpen,
		onOpen: openDisableDialog,
		onClose: closeDisableDialog,
	} = useDisclosure();
	const {
		isOpen: isPermissionsModalOpen,
		onOpen: openPermissionsModal,
		onClose: closePermissionsModal,
	} = useDisclosure();
	const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
	const [adminToDisable, setAdminToDisable] = useState<Admin | null>(null);
	const [disableReason, setDisableReason] = useState("");
	const [expandedMobile, setExpandedMobile] = useState<string | null>(null);
	const [actionState, setActionState] = useState<{
		type: "reset" | "disableAdmin" | "enableAdmin" | "quickPassword";
		username: string;
	} | null>(null);
	const [adminForPermissions, setAdminForPermissions] = useState<Admin | null>(
		null,
	);
	const [contextMenu, setContextMenu] = useState<{
		visible: boolean;
		x: number;
		y: number;
		admin: Admin | null;
	}>({
		visible: false,
		x: 0,
		y: 0,
		admin: null,
	});
	const [menuSize, setMenuSize] = useState<{ w: number; h: number }>({
		w: 0,
		h: 0,
	});
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const [contextAction, setContextAction] = useState<string | null>(null);
	const [quickPassInfo, setQuickPassInfo] = useState<{
		username: string;
		password: string;
	} | null>(null);
	const {
		isOpen: isQuickPassOpen,
		onOpen: openQuickPassModal,
		onClose: closeQuickPassModal,
	} = useDisclosure();
	const { onCopy, setValue: setClipboard } = useClipboard("");

	const currentAdminUsername = userData.username;
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const adminManagement = userData.permissions?.admin_management;
	const canEditAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.Edit] || hasFullAccess,
	);
	const canManageSudoAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.ManageSudo] || hasFullAccess,
	);
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

	const handleSort = (
		column: "username" | "users_count" | "data" | "data_usage" | "data_limit",
	) => {
		if (column === "data_usage" || column === "data_limit") {
			const newSort = filters.sort === column ? `-${column}` : column;
			onFilterChange({ sort: newSort, offset: 0 });
		} else {
			const newSort =
				filters.sort === column
					? `-${column}`
					: filters.sort === `-${column}`
						? undefined
						: column;
			onFilterChange({ sort: newSort, offset: 0 });
		}
	};

	const startDeleteDialog = (admin: Admin) => {
		setAdminToDelete(admin);
		openDeleteDialog();
	};

	const handleDeleteAdmin = async () => {
		if (!adminToDelete) return;
		try {
			await deleteAdmin(adminToDelete.username);
			generateSuccessMessage(t("admins.deleteSuccess", "Admin removed"), toast);
			closeDeleteDialog();
			setAdminToDelete(null);
		} catch (error) {
			generateErrorMessage(error, toast);
		}
	};

	const runResetUsage = async (admin: Admin) => {
		setActionState({ type: "reset", username: admin.username });
		try {
			await resetUsage(admin.username);
			generateSuccessMessage(
				t("admins.resetUsageSuccess", "Usage reset"),
				toast,
			);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
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

	const closeContextMenu = () =>
		setContextMenu({ visible: false, x: 0, y: 0, admin: null });
	const handleCloseQuickPass = () => {
		setQuickPassInfo(null);
		closeQuickPassModal();
	};

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
	}, [contextMenu.visible]);

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
		admin: Admin,
		isRowManageable: boolean,
	) => {
		if (!isDesktop) return;
		if (!isRowManageable) return;
		const pos = { x: event.clientX, y: event.clientY };
		const sameSpot =
			contextMenu.visible &&
			Math.abs(pos.x - contextMenu.x) < 4 &&
			Math.abs(pos.y - contextMenu.y) < 4;
		if (sameSpot) {
			closeContextMenu();
			return;
		}
		const canManage = canManageAdminAccount(admin);
		const canChangeStatus = canManage && admin.username !== currentAdminUsername;
		const showDisable = canChangeStatus && admin.status !== AdminStatus.Disabled;
		const showEnable = canChangeStatus && admin.status === AdminStatus.Disabled;
		const showDelete = canChangeStatus;
		const hasActions = canManage || showDisable || showEnable || showDelete;
		if (!hasActions) {
			return;
		}
		event.preventDefault();
		setContextMenu({ visible: true, x: pos.x, y: pos.y, admin });
	};

	const handleContextReset = async (admin: Admin) => {
		setContextAction("reset");
		try {
			await runResetUsage(admin);
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleAddDataLimit = async (admin: Admin, gigabytes: number) => {
		if (
			admin.data_limit === null ||
			admin.data_limit === 0 ||
			admin.data_limit === undefined
		) {
			return;
		}
		setContextAction("addData");
		const delta = gigabytes * 1024 * 1024 * 1024;
		const nextLimit = admin.data_limit + delta;
		try {
			await updateAdmin(admin.username, { data_limit: nextLimit });
			generateSuccessMessage(
				t("admins.addTrafficSuccess", "Data limit updated"),
				toast,
			);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setContextAction(null);
			closeContextMenu();
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
			generateSuccessMessage(
				t("admins.disableAdminSuccess", "Admin disabled"),
				toast,
			);
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
		const confirmText = t(
			"admins.quickPasswordConfirm",
			"Generate a new password for this admin?",
			{ username: admin.username },
		);
		if (!window.confirm(confirmText)) {
			closeContextMenu();
			return;
		}
		setContextAction("quickPassword");
		const newPassword = generateRandomPassword(12);
		try {
			await updateAdmin(admin.username, { password: newPassword });
			setQuickPassInfo({ username: admin.username, password: newPassword });
			openQuickPassModal();
			generateSuccessMessage(
				t("admins.quickPasswordSuccess", "Password updated"),
				toast,
			);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setContextAction(null);
			closeContextMenu();
		}
	};

	const handleEnableAdmin = async (admin: Admin) => {
		setActionState({ type: "enableAdmin", username: admin.username });
		try {
			await enableAdmin(admin.username);
			generateSuccessMessage(
				t("admins.enableAdminSuccess", "Admin re-enabled"),
				toast,
			);
			fetchAdmins();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setActionState(null);
		}
	};
	const SortIndicator = ({ column }: { column: string }) => {
		let isActive = false;
		let isDescending = false;
		if (column === "data") {
			isActive =
				filters.sort?.includes("data_usage") ||
				filters.sort?.includes("data_limit");
			isDescending = isActive && filters.sort?.startsWith("-");
		} else {
			isActive = filters.sort?.includes(column);
			isDescending = isActive && filters.sort?.startsWith("-");
		}
		return (
			<ChevronDownIcon
				style={{
					width: "1rem",
					height: "1rem",
					opacity: isActive ? 1 : 0.35,
					transform:
						isActive && !isDescending ? "rotate(180deg)" : "rotate(0deg)",
					transition: "transform 0.2s",
				}}
			/>
		);
	};

	const baseColumns: Array<
		"username" | "status" | "users_count" | "data" | "actions"
	> = ["username", "status", "users_count", "data", "actions"];
	const columnsToRender = isRTL ? baseColumns.slice().reverse() : baseColumns;
	const cellAlign = isRTL ? "right" : "left";
	const actionsAlign = isRTL ? "left" : "right";
	const isFiltered = admins.length !== total;

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
		sx: { ...baseTableSx, ...(normalizedSx || {}) },
	};
	const isDesktop = useBreakpointValue({ base: false, lg: true }) ?? false;
	const isSearching =
		typeof filters.search === "string" && filters.search.trim().length > 0;
	const hideSummaryCard = !isDesktop && isSearching;

	const summaryData = useMemo(() => {
		const usageTotal = admins.reduce(
			(sum, a) => sum + (a.users_usage ?? 0) + (a.reset_bytes ?? 0),
			0,
		);
		const rolesActive = {
			fullAccessCount: admins.filter(
				(a) =>
					a.role === AdminRole.FullAccess && a.status === AdminStatus.Active,
			).length,
			sudoCount: admins.filter(
				(a) => a.role === AdminRole.Sudo && a.status === AdminStatus.Active,
			).length,
			resellerCount: admins.filter(
				(a) => a.role === AdminRole.Reseller && a.status === AdminStatus.Active,
			).length,
			standardCount: admins.filter(
				(a) => a.role === AdminRole.Standard && a.status === AdminStatus.Active,
			).length,
		};
		const rolesDisabled = {
			fullAccessCount: admins.filter(
				(a) =>
					a.role === AdminRole.FullAccess && a.status === AdminStatus.Disabled,
			).length,
			sudoCount: admins.filter(
				(a) => a.role === AdminRole.Sudo && a.status === AdminStatus.Disabled,
			).length,
			resellerCount: admins.filter(
				(a) =>
					a.role === AdminRole.Reseller && a.status === AdminStatus.Disabled,
			).length,
			standardCount: admins.filter(
				(a) =>
					a.role === AdminRole.Standard && a.status === AdminStatus.Disabled,
			).length,
		};
		return {
			totalCount: total,
			rolesActive,
			rolesDisabled,
			usageTotal,
		};
	}, [admins, total]);

	const mobileList = (
		<VStack spacing={3} align="stretch">
			{loading
				? Array.from({ length: filters.limit || 5 }, (_, idx) => (
						<Box
							key={`skeleton-mobile-${idx}`}
							borderWidth="1px"
							borderColor="light-border"
							bg="surface.light"
							_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
							borderRadius="xl"
							p={3}
						>
							<Stack spacing={2}>
								<Skeleton height="16px" width="50%" />
								<Skeleton height="12px" width="40%" />
								<Skeleton height="8px" width="100%" />
							</Stack>
						</Box>
					))
				: admins.map((admin) => {
						const isExpanded = expandedMobile === admin.username;
						const usersLimitLabel =
							admin.users_limit && admin.users_limit > 0
								? String(admin.users_limit)
								: "∞";
						const activeLabel = `${admin.active_users ?? 0}/${usersLimitLabel}`;
						const usageLabel = `${formatBytes(admin.users_usage ?? 0)} / ${
							admin.data_limit && admin.data_limit > 0
								? formatBytes(admin.data_limit)
								: "∞"
						}`;
						const canManageThisAdmin = canManageAdminAccount(admin);
						const canChangeStatus =
							canManageThisAdmin && admin.username !== currentAdminUsername;
						const showDisableAction =
							canChangeStatus && admin.status !== AdminStatus.Disabled;
						const hasLimitDisabledReason =
							admin.disabled_reason === ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY;
						const disabledReasonLabel = admin.disabled_reason
							? hasLimitDisabledReason
								? t(
										"admins.disabledReason.dataLimitExceeded",
										"Your data limit has been reached",
									)
								: admin.disabled_reason
							: null;
						const showEnableAction =
							canChangeStatus &&
							admin.status === AdminStatus.Disabled &&
							!hasLimitDisabledReason;
						const showDeleteAction = canChangeStatus;

						return (
							<Box
								key={admin.username}
								borderWidth="1px"
								borderColor="light-border"
								bg="surface.light"
								_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
								borderRadius="xl"
								p={3}
								dir={isRTL ? "rtl" : "ltr"}
								onClick={() =>
									setExpandedMobile((prev) =>
										prev === admin.username ? null : admin.username,
									)
								}
								cursor="pointer"
							>
								<Stack spacing={2}>
									<HStack justify="space-between" align="center" spacing={3}>
										<Stack spacing={0} minW={0}>
											<Text
												fontWeight="semibold"
												noOfLines={1}
												dir="ltr"
												sx={{ unicodeBidi: "isolate" }}
											>
												{admin.username}
											</Text>
											<Text
												fontSize="xs"
												color="gray.500"
												_dark={{ color: "gray.400" }}
												className="rb-usage-pair"
											>
												{usageLabel}
											</Text>
										</Stack>
										<AdminStatusBadge status={admin.status} />
									</HStack>
									<Collapse in={isExpanded} animateOpacity>
										<Stack spacing={3} pt={1}>
											<Stack
												spacing={0}
												align={isRTL ? "flex-end" : "flex-start"}
											>
												<Text fontSize="sm" fontWeight="semibold">
													{t("admins.usersManaged", "Managed users")}:{" "}
													{activeLabel}
												</Text>
												{admin.online_users !== null &&
													admin.online_users !== undefined && (
														<Text
															fontSize="xs"
															color="green.600"
															_dark={{ color: "green.400" }}
														>
															{t("admins.details.onlineLabel", "Online")}:{" "}
															{admin.online_users}
														</Text>
													)}
											</Stack>
											<AdminUsageSlider
												isRTL={isRTL}
												used={admin.users_usage ?? 0}
												total={admin.data_limit ?? null}
												lifetimeUsage={admin.lifetime_usage ?? null}
											/>
											{admin.status === AdminStatus.Disabled &&
												disabledReasonLabel && (
													<Text fontSize="xs" color="red.400">
														{disabledReasonLabel}
													</Text>
												)}
											<HStack
												spacing={2}
												justify="flex-start"
												align="center"
												flexWrap="wrap"
												onClick={(event) => event.stopPropagation()}
												dir={isRTL ? "rtl" : "ltr"}
											>
												{canManageThisAdmin && (
													<>
														<Tooltip label={t("edit")}>
															<IconButton
																aria-label={t("edit")}
																icon={<PencilIcon width={20} />}
																variant="ghost"
																size="sm"
																onClick={(event) => {
																	event.stopPropagation();
																	openAdminDialog(admin);
																}}
															/>
														</Tooltip>
														<Tooltip
															label={t(
																"admins.editPermissionsButton",
																"Edit permissions",
															)}
														>
															<IconButton
																aria-label={t(
																	"admins.editPermissionsButton",
																	"Edit permissions",
																)}
																icon={<AdjustmentsHorizontalIcon width={20} />}
																variant="ghost"
																size="sm"
																onClick={(event) => {
																	event.stopPropagation();
																	handleOpenPermissionsModal(admin);
																}}
															/>
														</Tooltip>
														<Tooltip label={t("admins.resetUsage")}>
															<IconButton
																aria-label={t("admins.resetUsage")}
																icon={<ArrowPathIcon width={20} />}
																variant="ghost"
																size="sm"
																isLoading={
																	actionState?.username === admin.username &&
																	actionState?.type === "reset"
																}
																onClick={(event) => {
																	event.stopPropagation();
																	runResetUsage(admin);
																}}
															/>
														</Tooltip>
													</>
												)}
												{showDisableAction && canManageThisAdmin && (
													<Tooltip
														label={t("admins.disableAdmin", "Disable admin")}
													>
														<IconButton
															aria-label={t(
																"admins.disableAdmin",
																"Disable admin",
															)}
															icon={<NoSymbolIcon width={20} />}
															variant="ghost"
															size="sm"
															isLoading={
																actionState?.username === admin.username &&
																actionState?.type === "disableAdmin"
															}
															onClick={(event) => {
																event.stopPropagation();
																startDisableAdmin(admin);
															}}
														/>
													</Tooltip>
												)}
												{showEnableAction && canManageThisAdmin && (
													<Tooltip
														label={t("admins.enableAdmin", "Enable admin")}
													>
														<IconButton
															aria-label={t(
																"admins.enableAdmin",
																"Enable admin",
															)}
															icon={<PlayIcon width={20} />}
															variant="ghost"
															size="sm"
															isLoading={
																actionState?.username === admin.username &&
																actionState?.type === "enableAdmin"
															}
															onClick={(event) => {
																event.stopPropagation();
																handleEnableAdmin(admin);
															}}
														/>
													</Tooltip>
												)}
												{showDeleteAction && canManageThisAdmin && (
													<Tooltip label={t("delete")}>
														<IconButton
															aria-label={t("delete")}
															icon={<TrashIcon width={20} />}
															variant="ghost"
															size="sm"
															colorScheme="red"
															onClick={(event) => {
																event.stopPropagation();
																startDeleteDialog(admin);
															}}
														/>
													</Tooltip>
												)}
											</HStack>
										</Stack>
									</Collapse>
								</Stack>
							</Box>
						);
					})}
			{!loading && admins.length === 0 && (
				<Box py={6}>
					<Text textAlign="center">{t("admins.noAdmins")}</Text>
				</Box>
			)}
		</VStack>
	);

	if (loading && !admins.length) {
		return (
			<Box display="flex" justifyContent="center" alignItems="center" h="200px">
				<Skeleton height="24px" width="180px" />
			</Box>
		);
	}
	return (
		<>
			<Stack spacing={3}>
				<Collapse in={!hideSummaryCard} animateOpacity>
					<Card
						borderWidth="1px"
						borderColor="light-border"
						bg="surface.light"
						_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
					>
						<CardHeader
							borderBottomWidth="1px"
							borderColor="light-border"
							_dark={{ borderColor: "whiteAlpha.200" }}
							pb={3}
						>
							<HStack
								justify="space-between"
								align="center"
								flexWrap="wrap"
								gap={2}
							>
								<HStack spacing={2} align="baseline" flexWrap="wrap">
									<Text fontWeight="semibold">
										{t("admins.manageTab", "Admins")}
									</Text>
									<Text color="gray.500" _dark={{ color: "gray.400" }}>
										·
									</Text>
									<Text
										fontSize="sm"
										color="gray.600"
										_dark={{ color: "gray.400" }}
									>
										{t("admins.totalLabel", "Total")}:{" "}
										<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
											{formatCount(summaryData.totalCount, locale)}
										</chakra.span>
									</Text>
									<Text color="gray.500" _dark={{ color: "gray.400" }}>
										·
									</Text>
									<Text
										fontSize="sm"
										color="gray.600"
										_dark={{ color: "gray.400" }}
									>
										{t("UsersUsage")}:{" "}
										<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
											{formatBytes(summaryData.usageTotal)}
										</chakra.span>
									</Text>
								</HStack>
							</HStack>
						</CardHeader>
						<CardBody>
							<Stack
								spacing={5}
								direction={{ base: "column", lg: "row" }}
								flexWrap="wrap"
								align="flex-start"
							>
								<HStack spacing={3} flexWrap="wrap" align="center">
									<Text fontWeight="semibold">{t("status.active")}</Text>
									<RoleChip
										label={t("admins.roles.fullAccess", "Full access")}
										value={summaryData.rolesActive.fullAccessCount}
										color="yellow.500"
									/>
									<RoleChip
										label={t("admins.roles.sudo", "Sudo")}
										value={summaryData.rolesActive.sudoCount}
										color="purple.400"
									/>
									<RoleChip
										label={t("admins.roles.reseller", "Reseller")}
										value={summaryData.rolesActive.resellerCount}
										color="blue.400"
									/>
									<RoleChip
										label={t("admins.roles.standard", "Standard")}
										value={summaryData.rolesActive.standardCount}
										color="gray.500"
									/>
								</HStack>
								<HStack spacing={3} flexWrap="wrap" align="center">
									<Text fontWeight="semibold">{t("status.disabled")}</Text>
									<RoleChip
										label={t("admins.roles.fullAccess", "Full access")}
										value={summaryData.rolesDisabled.fullAccessCount}
										color="yellow.500"
									/>
									<RoleChip
										label={t("admins.roles.sudo", "Sudo")}
										value={summaryData.rolesDisabled.sudoCount}
										color="purple.400"
									/>
									<RoleChip
										label={t("admins.roles.reseller", "Reseller")}
										value={summaryData.rolesDisabled.resellerCount}
										color="blue.400"
									/>
									<RoleChip
										label={t("admins.roles.standard", "Standard")}
										value={summaryData.rolesDisabled.standardCount}
										color="gray.500"
									/>
								</HStack>
							</Stack>
						</CardBody>
					</Card>
				</Collapse>
				<Box position="relative">
					<Card
						borderWidth="1px"
						borderColor="light-border"
						bg="surface.light"
						_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
					>
						<CardHeader
							borderBottomWidth="1px"
							borderColor="light-border"
							_dark={{ borderColor: "whiteAlpha.200" }}
							pb={3}
						>
							<HStack justify="space-between" align="center" flexWrap="wrap">
								<Stack spacing={0}>
									<Text fontWeight="semibold">
										{t("admins.manageTab", "Admins")}
									</Text>
									<Text
										fontSize="sm"
										color="gray.600"
										_dark={{ color: "gray.400" }}
									>
										{t("admins.totalLabel", "Total")}:{" "}
										<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
											{formatCount(total, locale)}
										</chakra.span>
										{isFiltered ? ` · ${t("usersPage.filtered")}` : ""}
									</Text>
								</Stack>
								<Text
									fontSize="sm"
									color="gray.500"
									_dark={{ color: "gray.400" }}
								>
									{t(
										"admins.pageDescription",
										"View and manage admin accounts. Use this page to create, edit and review admin permissions and recent usage.",
									)}
								</Text>
							</HStack>
						</CardHeader>
						<CardBody px={{ base: 3, md: 4 }} py={{ base: 3, md: 4 }}>
							<Box w="full">
								<Box
									w="full"
									borderWidth="1px"
									borderRadius="xl"
									overflow="hidden"
									overflowX="auto"
								>
									{isDesktop ? (
										<Table
											variant="simple"
											dir={isRTL ? "rtl" : "ltr"}
											width="100%"
											w="full"
											{...tableProps}
										>
											<Thead>
												<Tr>
													{columnsToRender.map((col) => {
														if (col === "username") {
															return (
																<Th
																	key="username"
																	minW="200px"
																	cursor="pointer"
																	onClick={() => handleSort("username")}
																	textAlign={cellAlign}
																>
																	<HStack
																		spacing={2}
																		align="center"
																		justify="flex-start"
																		flexDirection={
																			isRTL ? "row-reverse" : "row"
																		}
																	>
																		<Text>{t("username")}</Text>
																		<SortIndicator column="username" />
																	</HStack>
																</Th>
															);
														}
														if (col === "status") {
															return (
																<Th
																	key="status"
																	minW="140px"
																	textAlign={cellAlign}
																>
																	<Text>{t("status")}</Text>
																</Th>
															);
														}
														if (col === "users_count") {
															return (
																<Th
																	key="users_count"
																	minW="130px"
																	cursor="pointer"
																	onClick={() => handleSort("users_count")}
																	textAlign={cellAlign}
																>
																	<HStack
																		spacing={2}
																		align="center"
																		justify="flex-start"
																		flexDirection={
																			isRTL ? "row-reverse" : "row"
																		}
																	>
																		<Text>
																			{t(
																				"admins.usersManaged",
																				"Managed users",
																			)}
																		</Text>
																		<SortIndicator column="users_count" />
																	</HStack>
																</Th>
															);
														}
														if (col === "data") {
															return (
																<Th
																	key="data"
																	minW="240px"
																	textAlign={cellAlign}
																>
																	<HStack spacing={2} align="center">
																		<Text>
																			{t(
																				"admins.dataUsageHeader",
																				"Usage / Limit",
																			)}
																		</Text>
																		<Menu>
																			<MenuButton
																				as={IconButton}
																				size="xs"
																				variant="ghost"
																				icon={<SortIndicator column="data" />}
																			/>
																			<MenuList>
																				<MenuItem
																					onClick={() =>
																						handleSort("data_usage")
																					}
																				>
																					{t("admins.sortByUsage")}
																				</MenuItem>
																				<MenuItem
																					onClick={() =>
																						handleSort("data_limit")
																					}
																				>
																					{t("admins.sortByLimit")}
																				</MenuItem>
																			</MenuList>
																		</Menu>
																	</HStack>
																</Th>
															);
														}
														return (
															<Th
																key="actions"
																minW="150px"
																width="180px"
																textAlign={actionsAlign}
															/>
														);
													})}
												</Tr>
											</Thead>
											<Tbody>
												{loading
													? Array.from(
															{ length: filters.limit || 5 },
															(_, idx) => {
																const cells = {
																	username: (
																		<Td
																			key={`skeleton-username-${idx}`}
																			textAlign={cellAlign}
																		>
																			<Skeleton height="16px" width="60%" />
																		</Td>
																	),
																	status: (
																		<Td
																			key={`skeleton-status-${idx}`}
																			textAlign={cellAlign}
																		>
																			<Skeleton height="16px" width="80px" />
																		</Td>
																	),
																	users_count: (
																		<Td
																			key={`skeleton-users-${idx}`}
																			textAlign={cellAlign}
																		>
																			<Skeleton height="14px" width="70px" />
																		</Td>
																	),
																	data: (
																		<Td
																			key={`skeleton-data-${idx}`}
																			textAlign={cellAlign}
																		>
																			<Skeleton height="16px" width="120px" />
																		</Td>
																	),
																	actions: (
																		<Td
																			key={`skeleton-actions-${idx}`}
																			textAlign={actionsAlign}
																		>
																			<HStack spacing={2} justify="flex-start">
																				<Skeleton height="16px" width="32px" />
																				<Skeleton height="16px" width="32px" />
																			</HStack>
																		</Td>
																	),
																} as const;
																return (
																	<Tr key={`skeleton-${idx}`}>
																		{columnsToRender.map((key) =>
																			cloneElement(cells[key], { key }),
																		)}
																	</Tr>
																);
															},
														)
													: admins.map((admin, index) => {
															const isSelected =
																adminInDetails?.username === admin.username;
															const usersLimitLabel =
																admin.users_limit && admin.users_limit > 0
																	? String(admin.users_limit)
																	: "∞";
															const activeLabel = `${admin.active_users ?? 0}/${usersLimitLabel}`;
															const canManageThisAdmin =
																canManageAdminAccount(admin);
															const canChangeStatus =
																canManageThisAdmin &&
																admin.username !== currentAdminUsername;
															const showDisableAction =
																canChangeStatus &&
																admin.status !== AdminStatus.Disabled;
															const hasLimitDisabledReason =
																admin.disabled_reason ===
																ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY;
															const disabledReasonLabel = admin.disabled_reason
																? hasLimitDisabledReason
																	? t(
																			"admins.disabledReason.dataLimitExceeded",
																			"Your data limit has been reached",
																		)
																	: admin.disabled_reason
																: null;
															const showEnableAction =
																canChangeStatus &&
																admin.status === AdminStatus.Disabled &&
																!hasLimitDisabledReason;
															const showDeleteAction = canChangeStatus;

															const cells = {
																username: (
																	<Td textAlign={cellAlign}>
																		<Stack
																			spacing={1}
																			align={isRTL ? "flex-end" : "flex-start"}
																		>
																			<HStack
																				spacing={2}
																				align="center"
																				justify="flex-start"
																				flexDirection={
																					isRTL ? "row-reverse" : "row"
																				}
																			>
																				<Text
																					fontWeight="semibold"
																					noOfLines={1}
																					dir="ltr"
																					sx={{ unicodeBidi: "isolate" }}
																				>
																					{admin.username}
																				</Text>
																				<Tooltip
																					label={
																						admin.role === AdminRole.FullAccess
																							? t(
																									"admins.roles.fullAccess",
																									"Full access",
																								)
																							: admin.role === AdminRole.Sudo
																								? t("admins.roles.sudo", "Sudo")
																								: t(
																										"admins.roles.standard",
																										"Standard",
																									)
																					}
																					placement="top"
																				>
																					<Text
																						fontSize="xs"
																						px={2}
																						py={0.5}
																						borderRadius="full"
																						bg={
																							admin.role ===
																							AdminRole.FullAccess
																								? "yellow.100"
																								: admin.role === AdminRole.Sudo
																									? "purple.100"
																									: "gray.100"
																						}
																						color={
																							admin.role ===
																							AdminRole.FullAccess
																								? "yellow.800"
																								: admin.role === AdminRole.Sudo
																									? "purple.800"
																									: "gray.800"
																						}
																						_dark={{
																							bg:
																								admin.role ===
																								AdminRole.FullAccess
																									? "yellow.900"
																									: admin.role ===
																											AdminRole.Sudo
																										? "purple.900"
																										: "gray.700",
																							color:
																								admin.role ===
																								AdminRole.FullAccess
																									? "yellow.200"
																									: admin.role ===
																											AdminRole.Sudo
																										? "purple.200"
																										: "gray.200",
																						}}
																					>
																						{admin.role}
																					</Text>
																				</Tooltip>
																			</HStack>
																			<Text
																				fontSize="xs"
																				color="gray.500"
																				_dark={{ color: "gray.400" }}
																			>
																				{t("admins.idLabel", "ایدی")}:{" "}
																				{admin.id}
																			</Text>
																		</Stack>
																	</Td>
																),
																status: (
																	<Td textAlign={cellAlign}>
																		<Stack
																			spacing={1}
																			align={isRTL ? "flex-end" : "flex-start"}
																			maxW="full"
																		>
																			<AdminStatusBadge status={admin.status} />
																			{admin.status === AdminStatus.Disabled &&
																				disabledReasonLabel && (
																					<Text
																						fontSize="xs"
																						color="red.400"
																						mt={1}
																					>
																						{disabledReasonLabel}
																					</Text>
																				)}
																		</Stack>
																	</Td>
																),
																users_count: (
																	<Td textAlign={cellAlign}>
																		<Stack
																			spacing={0}
																			align={isRTL ? "flex-end" : "flex-start"}
																		>
																			<Text fontSize="sm" fontWeight="semibold">
																				{activeLabel}
																			</Text>
																			{admin.online_users !== null &&
																				admin.online_users !== undefined && (
																					<Text
																						fontSize="xs"
																						color="green.600"
																						_dark={{ color: "green.400" }}
																						mt={1}
																					>
																						{t(
																							"admins.details.onlineLabel",
																							"Online",
																						)}
																						: {admin.online_users}
																					</Text>
																				)}
																		</Stack>
																	</Td>
																),
																data: (
																	<Td textAlign={cellAlign}>
																		<AdminUsageSlider
																			isRTL={isRTL}
																			used={admin.users_usage ?? 0}
																			total={admin.data_limit ?? null}
																			lifetimeUsage={
																				admin.lifetime_usage ?? null
																			}
																		/>
																	</Td>
																),
																actions: (
																	<Td textAlign={actionsAlign}>
																		<HStack
																			spacing={2}
																			justify="flex-start"
																			align="center"
																			flexWrap="wrap"
																			onClick={(event) =>
																				event.stopPropagation()
																			}
																			dir={isRTL ? "rtl" : "ltr"}
																		>
																			{canManageThisAdmin && (
																				<>
																					<Tooltip label={t("edit")}>
																						<IconButton
																							aria-label={t("edit")}
																							icon={<PencilIcon width={20} />}
																							variant="ghost"
																							size="sm"
																							onClick={(event) => {
																								event.stopPropagation();
																								openAdminDialog(admin);
																							}}
																						/>
																					</Tooltip>
																					<Tooltip
																						label={t(
																							"admins.editPermissionsButton",
																							"Edit permissions",
																						)}
																					>
																						<IconButton
																							aria-label={t(
																								"admins.editPermissionsButton",
																								"Edit permissions",
																							)}
																							icon={
																								<AdjustmentsHorizontalIcon
																									width={20}
																								/>
																							}
																							variant="ghost"
																							size="sm"
																							onClick={(event) => {
																								event.stopPropagation();
																								handleOpenPermissionsModal(
																									admin,
																								);
																							}}
																						/>
																					</Tooltip>
																					<Tooltip
																						label={t("admins.resetUsage")}
																					>
																						<IconButton
																							aria-label={t(
																								"admins.resetUsage",
																							)}
																							icon={
																								<ArrowPathIcon width={20} />
																							}
																							variant="ghost"
																							size="sm"
																							isLoading={
																								actionState?.username ===
																									admin.username &&
																								actionState?.type === "reset"
																							}
																							onClick={(event) => {
																								event.stopPropagation();
																								runResetUsage(admin);
																							}}
																						/>
																					</Tooltip>
																				</>
																			)}
																			{showDisableAction &&
																				canManageThisAdmin && (
																					<Tooltip
																						label={t(
																							"admins.disableAdmin",
																							"Disable admin",
																						)}
																					>
																						<IconButton
																							aria-label={t(
																								"admins.disableAdmin",
																								"Disable admin",
																							)}
																							icon={<NoSymbolIcon width={20} />}
																							variant="ghost"
																							size="sm"
																							isLoading={
																								actionState?.username ===
																									admin.username &&
																								actionState?.type ===
																									"disableAdmin"
																							}
																							onClick={(event) => {
																								event.stopPropagation();
																								startDisableAdmin(admin);
																							}}
																						/>
																					</Tooltip>
																				)}
																			{showEnableAction &&
																				canManageThisAdmin && (
																					<Tooltip
																						label={t(
																							"admins.enableAdmin",
																							"Enable admin",
																						)}
																					>
																						<IconButton
																							aria-label={t(
																								"admins.enableAdmin",
																								"Enable admin",
																							)}
																							icon={<PlayIcon width={20} />}
																							variant="ghost"
																							size="sm"
																							isLoading={
																								actionState?.username ===
																									admin.username &&
																								actionState?.type ===
																									"enableAdmin"
																							}
																							onClick={(event) => {
																								event.stopPropagation();
																								handleEnableAdmin(admin);
																							}}
																						/>
																					</Tooltip>
																				)}
																			{showDeleteAction &&
																				canManageThisAdmin && (
																					<Tooltip label={t("delete")}>
																						<IconButton
																							aria-label={t("delete")}
																							icon={<TrashIcon width={20} />}
																							variant="ghost"
																							size="sm"
																							colorScheme="red"
																							onClick={(event) => {
																								event.stopPropagation();
																								startDeleteDialog(admin);
																							}}
																						/>
																					</Tooltip>
																				)}
																		</HStack>
																	</Td>
																),
															} as const;

															return (
																<Tr
																	key={admin.username}
																	className={
																		index === admins.length - 1
																			? "last-row"
																			: undefined
																	}
																	onClick={() => openAdminDetails(admin)}
																	onContextMenu={(event) =>
																		handleRowContextMenu(
																			event,
																			admin,
																			canManageThisAdmin,
																		)
																	}
																	cursor="pointer"
																	bg={isSelected ? rowSelectedBg : undefined}
																	_hover={{ bg: rowHoverBg }}
																	transition="background-color 0.15s ease-in-out"
																>
																	{columnsToRender.map((key) =>
																		cloneElement(cells[key], { key }),
																	)}
																</Tr>
															);
														})}
												{!loading && admins.length === 0 && (
													<Tr>
														<Td colSpan={columnsToRender.length}>
															<Text textAlign="center" py={6}>
																{t("admins.noAdmins")}
															</Text>
														</Td>
													</Tr>
												)}
											</Tbody>
										</Table>
									) : (
										mobileList
									)}
								</Box>
							</Box>
						</CardBody>
					</Card>
				</Box>
			</Stack>

			{contextMenu.visible && contextMenu.admin && (() => {
				const ctxAdmin = contextMenu.admin;
				const canManage = canManageAdminAccount(ctxAdmin);
				const canChangeStatus =
					canManage && ctxAdmin.username !== currentAdminUsername;
				const showDisable =
					canChangeStatus && ctxAdmin.status !== AdminStatus.Disabled;
				const showEnable =
					canChangeStatus && ctxAdmin.status === AdminStatus.Disabled;
				const showDelete = canChangeStatus;
				const showAddTraffic =
					canManage &&
					ctxAdmin.data_limit !== null &&
					ctxAdmin.data_limit !== 0 &&
					ctxAdmin.data_limit !== undefined;
				return (
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
						{canManage && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<PencilIcon width={16} />}
								onClick={() => {
									openAdminDialog(ctxAdmin);
									closeContextMenu();
								}}
							>
								{t("admins.editAction", "Edit")}
							</Button>
						)}
						{canManage && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<ResetIcon />}
								onClick={() => handleContextReset(ctxAdmin)}
								isLoading={contextAction === "reset"}
							>
								{t("admins.resetUsage", "Reset usage")}
							</Button>
						)}
						{showEnable && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<EnableIcon />}
								onClick={() => {
									handleEnableAdmin(ctxAdmin);
									closeContextMenu();
								}}
								isLoading={
									actionState?.type === "enableAdmin" &&
									actionState?.username === ctxAdmin.username
								}
							>
								{t("admins.enableAdmin", "Enable admin")}
							</Button>
						)}
						{showDisable && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<DisableIcon />}
								onClick={() => {
									startDisableAdmin(ctxAdmin);
									closeContextMenu();
								}}
							>
								{t("admins.disableAdmin", "Disable admin")}
							</Button>
						)}
						{showAddTraffic && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<AddDataIcon />}
								onClick={() => handleAddDataLimit(ctxAdmin, 500)}
								isLoading={contextAction === "addData"}
							>
								{t("admins.add500Gb", "Add 500 GB")}
							</Button>
						)}
						{canManage && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								leftIcon={<QuickPassIcon />}
								onClick={() => handleQuickPassword(ctxAdmin)}
								isLoading={contextAction === "quickPassword"}
							>
								{t("admins.quickPassword", "Generate new password")}
							</Button>
						)}
						{showDelete && (
							<Button
								variant="ghost"
								justifyContent="flex-start"
								colorScheme="red"
								leftIcon={<DeleteIcon />}
								onClick={() => {
									startDeleteDialog(ctxAdmin);
									closeContextMenu();
								}}
							>
								{t("delete", "Delete")}
							</Button>
						)}
					</Stack>
				</Box>
				);
			})()}

			<Modal isOpen={isQuickPassOpen} onClose={handleCloseQuickPass} isCentered>
			<ModalOverlay />
			<ModalContent>
				<ModalHeader>
					{t("admins.quickPasswordModal.title", "New credentials")}
				</ModalHeader>
				<ModalCloseButton />
					<ModalBody>
						<Stack spacing={3}>
							<Box>
								<Text fontSize="sm" color="gray.500">
									{t("admins.quickPasswordModal.username", "Username")}
								</Text>
								<Input value={quickPassInfo?.username ?? ""} isReadOnly />
							</Box>
							<Box>
								<Text fontSize="sm" color="gray.500">
									{t("admins.quickPasswordModal.password", "Password")}
								</Text>
								<InputGroup>
									<Input value={quickPassInfo?.password ?? ""} isReadOnly />
									<InputRightElement>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => {
												if (quickPassInfo?.password) {
													setClipboard(quickPassInfo.password);
													onCopy();
													toast({
														title: t("copied", "Copied"),
														status: "success",
														duration: 1200,
													});
												}
											}}
										>
											{t("copy", "Copy")}
										</Button>
									</InputRightElement>
								</InputGroup>
							</Box>
							<Text fontSize="xs" color="orange.400">
								{t(
									"admins.quickPasswordModal.notice",
									"Store this password now. It won't be shown again.",
								)}
							</Text>
						</Stack>
					</ModalBody>
					<ModalFooter>
					<Button onClick={handleCloseQuickPass}>{t("close")}</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>

			<AlertDialog
				isOpen={isDeleteDialogOpen}
				leastDestructiveRef={deleteCancelRef}
				onClose={closeDeleteDialog}
			>
				<AlertDialogOverlay bg="blackAlpha.300" backdropFilter="blur(10px)">
					<AlertDialogContent
						bg={dialogBg}
						borderWidth="1px"
						borderColor={dialogBorderColor}
					>
						<AlertDialogHeader fontSize="lg" fontWeight="bold">
							{t("admins.confirmDeleteTitle", "Delete admin")}
						</AlertDialogHeader>
						<AlertDialogBody>
							{t(
								"admins.confirmDeleteMessage",
								"Are you sure you want to delete {{username}}?",
								{
									username: adminToDelete?.username ?? "",
								},
							)}
						</AlertDialogBody>
						<AlertDialogFooter>
							<Button
								ref={deleteCancelRef}
								onClick={closeDeleteDialog}
								variant="ghost"
								colorScheme="primary"
							>
								{t("cancel")}
							</Button>
							<Button colorScheme="red" onClick={handleDeleteAdmin} ml={3}>
								{t("delete")}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>
			<AlertDialog
				isOpen={isDisableDialogOpen}
				leastDestructiveRef={disableCancelRef}
				onClose={closeDisableDialogAndReset}
			>
				<AlertDialogOverlay bg="blackAlpha.300" backdropFilter="blur(10px)">
					<AlertDialogContent
						bg={dialogBg}
						borderWidth="1px"
						borderColor={dialogBorderColor}
					>
						<AlertDialogHeader fontSize="lg" fontWeight="bold">
							{t("admins.disableAdminTitle", "Disable admin")}
						</AlertDialogHeader>
						<AlertDialogBody>
							<Text mb={3}>
								{t(
									"admins.disableAdminMessage",
									"All users owned by {{username}} will be disabled. Provide a reason for this action.",
									{
										username: adminToDisable?.username ?? "",
									},
								)}
							</Text>
							<Textarea
								value={disableReason}
								onChange={(event) => setDisableReason(event.target.value)}
								placeholder={t(
									"admins.disableAdminReasonPlaceholder",
									"Reason for disabling",
								)}
							/>
						</AlertDialogBody>
						<AlertDialogFooter>
							<Button
								ref={disableCancelRef}
								onClick={closeDisableDialogAndReset}
								variant="ghost"
								colorScheme="primary"
							>
								{t("cancel")}
							</Button>
							<Button
								colorScheme="red"
								onClick={confirmDisableAdmin}
								ml={3}
								isDisabled={disableReason.trim().length < 3}
								isLoading={
									actionState?.type === "disableAdmin" &&
									actionState?.username === adminToDisable?.username
								}
							>
								{t("admins.disableAdminConfirm", "Disable admin")}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>
			<AdminPermissionsModal
				isOpen={isPermissionsModalOpen}
				onClose={handleClosePermissionsModal}
				admin={adminForPermissions}
			/>
		</>
	);
};
