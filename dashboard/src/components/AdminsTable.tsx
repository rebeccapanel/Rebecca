import {
	Box,
	Button,
	Collapse,
	chakra,
	HStack,
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
	SimpleGrid,
	Stack,
	type TableProps,
	Text,
	Textarea,
	useColorModeValue,
	useDisclosure,
	useToast,
} from "@chakra-ui/react";
import {
	AdjustmentsHorizontalIcon,
	ArrowPathIcon,
	CheckCircleIcon,
	ChevronRightIcon,
	KeyIcon,
	PencilIcon,
	PlayIcon,
	PlusCircleIcon,
	ShieldCheckIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/outline";
import { NoSymbolIcon } from "@heroicons/react/24/solid";
import type { SortingState } from "@tanstack/react-table";
import classNames from "classnames";
import { useAdminsStore } from "contexts/AdminsContext";
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
import type { Admin } from "types/Admin";
import {
	AdminManagementPermission,
	AdminRole,
	AdminStatus,
	AdminTrafficLimitMode,
	UserPermissionToggle,
} from "types/Admin";
import { relativeExpiryDate } from "utils/dateFormatter";
import { formatBytes } from "utils/formatByte";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { copyTextToClipboard } from "utils/clipboard";
import AdminPermissionsModal from "./AdminPermissionsModal";
import { AdminSecurityDialog } from "./AdminSecurityDialog";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import {
	DataTable,
	ResourceListCard,
	type DataTableColumn,
	type DataTableRowAction,
} from "./ui";

const ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted";
const ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY = "admin_time_limit_exhausted";
const ADMIN_TRAFFIC_OPTIONS = [
	{ label: "100GB", gigabytes: 100 },
	{ label: "500GB", gigabytes: 500 },
	{ label: "1TB", gigabytes: 1024 },
	{ label: "2TB", gigabytes: 2048 },
	{ label: "5TB", gigabytes: 5120 },
];

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

const AdminRoleBadge: FC<{ role: AdminRole }> = ({ role }) => {
	const { t } = useTranslation();
	const roleStyles = {
		[AdminRole.FullAccess]: {
			bg: "yellow.100",
			color: "yellow.800",
			darkBg: "yellow.900",
			darkColor: "yellow.200",
			label: t("admins.roles.fullAccess", "Full access"),
		},
		[AdminRole.Sudo]: {
			bg: "purple.100",
			color: "purple.800",
			darkBg: "purple.900",
			darkColor: "purple.200",
			label: t("admins.roles.sudo", "Sudo"),
		},
		[AdminRole.Reseller]: {
			bg: "blue.100",
			color: "blue.800",
			darkBg: "blue.900",
			darkColor: "blue.200",
			label: t("admins.roles.reseller", "Reseller"),
		},
		[AdminRole.Standard]: {
			bg: "gray.100",
			color: "gray.800",
			darkBg: "gray.700",
			darkColor: "gray.200",
			label: t("admins.roles.standard", "Standard"),
		},
	}[role];

	return (
		<Text
			as="span"
			display="inline-flex"
			fontSize="xs"
			px={2}
			py={0.5}
			borderRadius="full"
			bg={roleStyles.bg}
			color={roleStyles.color}
			fontWeight="medium"
			w="fit-content"
			_dark={{ bg: roleStyles.darkBg, color: roleStyles.darkColor }}
		>
			{roleStyles.label}
		</Text>
	);
};




const formatCount = (value: number | null | undefined, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value ?? 0);

const formatByteLimit = (value?: number | null) =>
	value && value > 0 ? formatBytes(value, 2) : "∞";

const getEnabledUserPermissionsCount = (admin: Admin) =>
	Object.values(UserPermissionToggle).filter(
		(permission) => admin.permissions?.users?.[permission],
	).length;

const getAdminEffectiveUsage = (admin: Admin) =>
	admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
		? (admin.created_traffic ?? 0)
		: (admin.users_usage ?? 0);

const getAdminIsExpired = (admin: Admin, nowUnix: number) =>
	admin.disabled_reason === ADMIN_TIME_LIMIT_EXHAUSTED_REASON_KEY ||
	(typeof admin.expire === "number" && admin.expire > 0 && admin.expire <= nowUnix);

const getAdminIsLimited = (admin: Admin) =>
	admin.disabled_reason === ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY ||
	(admin.data_limit !== null &&
		admin.data_limit !== undefined &&
		admin.data_limit > 0 &&
		getAdminEffectiveUsage(admin) >= admin.data_limit);

type AdminsTableProps = TableProps & {
	toolbar?: ReactNode;
	footerActions?: ReactNode;
};

export const AdminsTable: FC<AdminsTableProps> = ({
	toolbar,
	footerActions,
	...props
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const locale = i18n.language || "en";
	const toast = useToast();
	const { userData } = useGetUser();
	const dialogBg = useColorModeValue("surface.light", "surface.dark");
	const dialogBorderColor = useColorModeValue("light-border", "gray.700");
	const inlineMenuBg = useColorModeValue("blackAlpha.50", "whiteAlpha.50");
	const {
		adminOptions,
		admins,
		loading,
		total,
		filters,
		onFilterChange,
		fetchAdmins,
		deleteAdmin,
		resetUsage,
		resetDeletedUsersUsage,
		disableAdmin,
		enableAdmin,
		fetchAdminOptions,
		updateAdmin,
		openAdminDialog,
		openAdminDetails,
	} = useAdminsStore();
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
	const [openTrafficMenuFor, setOpenTrafficMenuFor] = useState<string | null>(
		null,
	);
	const [quickPassInfo, setQuickPassInfo] = useState<{
		username: string;
		password: string;
	} | null>(null);
	const [selectedAdminUsernames, setSelectedAdminUsernames] = useState<string[]>(
		[],
	);
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
	const securityDialog = useDisclosure();

	const currentAdminUsername = userData.username;
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const adminManagement = userData.permissions?.admin_management;
	const canEditAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.Edit] || hasFullAccess,
	);
	const canManageSudoAdmins = Boolean(
		adminManagement?.[AdminManagementPermission.ManageSudo] || hasFullAccess,
	);
	const canManageSessions = Boolean(
		adminManagement?.[AdminManagementPermission.ManageSessions] || hasFullAccess,
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
			admins.filter((admin) =>
				selectedAdminUsernames.includes(admin.username),
			),
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
			generateSuccessMessage(t("admins.deleteSuccess", "Admin removed"), toast);
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

	const runResetDeletedUsersUsage = async (admin: Admin) => {
		setActionState({ type: "resetDeleted", username: admin.username });
		try {
			await resetDeletedUsersUsage(admin.username);
			generateSuccessMessage(
				t("admins.resetDeletedUsageSuccess", "Deleted-user usage reset"),
				toast,
			);
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

	const closeContextMenu = useCallback(() => {
		setOpenTrafficMenuFor(null);
	}, []);
	const closeDeleteDialogAndReset = () => {
		closeDeleteDialog();
		setAdminToDelete(null);
	};
	const startDeleteAdmin = (admin: Admin) => {
		setAdminToDelete(admin);
		openDeleteDialog();
		closeContextMenu();
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

	const handleAddDataLimit = async (
		admin: Admin,
		gigabytes: number,
		onDone?: () => void,
	) => {
		if (
			admin.data_limit === null ||
			admin.data_limit === 0 ||
			admin.data_limit === undefined
		) {
			return;
		}
		setContextAction(`addData-${gigabytes}`);
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
			onDone?.();
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
		setQuickPassAdmin(admin);
		closeContextMenu();
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
			generateSuccessMessage(
				t("admins.quickPasswordSuccess", "Password updated"),
				toast,
			);
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
				? t(
						"admins.disabledReason.dataLimitExceeded",
						"Your data limit has been reached",
					)
				: hasTimeLimitDisabledReason
					? t(
							"admins.disabledReason.timeLimitExceeded",
							"Your account time limit has expired",
						)
					: admin.disabled_reason
			: null;
		return {
			canManage,
			showDisable: canChangeStatus && admin.status !== AdminStatus.Disabled,
			showEnable:
				canChangeStatus &&
				admin.status === AdminStatus.Disabled &&
				!hasDataLimitDisabledReason &&
				!hasTimeLimitDisabledReason,
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
	const renderAddTrafficSubmenu = (admin: Admin, onDone?: () => void) => {
		const isOpen = openTrafficMenuFor === admin.username;
		const closeAfterSelection = () => {
			setOpenTrafficMenuFor(null);
			onDone?.();
		};
		return (
			<Box>
				<Button
					variant="ghost"
					justifyContent="flex-start"
					w="full"
					isLoading={contextAction?.startsWith("addData-")}
					isDisabled={contextAction?.startsWith("addData-")}
					aria-expanded={isOpen}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setOpenTrafficMenuFor((current) =>
							current === admin.username ? null : admin.username,
						);
					}}
				>
					<HStack w="full" justify="space-between" spacing={3}>
						<HStack spacing={2} minW={0}>
							<AddDataIcon />
							<Text as="span" noOfLines={1}>
								{t("admins.addTraffic", "Add traffic")}
							</Text>
						</HStack>
						<ChevronRightIcon
							width={14}
							style={{
								flexShrink: 0,
								transform: isOpen
									? "rotate(90deg)"
									: isRTL
										? "rotate(180deg)"
										: undefined,
								transition: "transform 0.15s ease",
							}}
						/>
					</HStack>
				</Button>
				<Collapse in={isOpen} unmountOnExit>
					<SimpleGrid
						columns={{ base: 2, sm: 3 }}
						spacing={1}
						mt={1}
						p={2}
						bg={inlineMenuBg}
						borderWidth="1px"
						borderColor={dialogBorderColor}
						borderRadius="md"
					>
						{ADMIN_TRAFFIC_OPTIONS.map((option) => (
							<Button
								key={option.label}
								size="sm"
								variant="ghost"
								justifyContent="center"
								onClick={(event) => {
									event.stopPropagation();
									handleAddDataLimit(
										admin,
										option.gigabytes,
										closeAfterSelection,
									);
								}}
								isLoading={contextAction === `addData-${option.gigabytes}`}
								isDisabled={contextAction?.startsWith("addData-")}
							>
								{option.label}
							</Button>
						))}
					</SimpleGrid>
				</Collapse>
			</Box>
		);
	};
	const renderRelativeText = useCallback(
		(key: "expires" | "expired", time: string) => {
			const raw = t(key);
			const [before = "", after = ""] = raw.split("{{time}}");
			const timeNode = time ? (
				<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }} key="time">
					{time}
				</Box>
			) : null;

			const nodes: JSX.Element[] = [];
			if (!isRTL) {
				if (before) {
					nodes.push(
						<Text as="span" key="before">
							{before}
						</Text>,
					);
				}
				if (timeNode) {
					nodes.push(timeNode);
				}
				if (after) {
					nodes.push(
						<Text as="span" key="after">
							{after}
						</Text>,
					);
				}
			} else {
				if (timeNode) {
					nodes.push(timeNode);
				}
				if (after) {
					nodes.push(
						<Text as="span" key="after">
							{after}
						</Text>,
					);
				}
				if (before) {
					nodes.push(
						<Text as="span" key="before">
							{before}
						</Text>,
					);
				}
			}
			return nodes;
		},
		[isRTL, t],
	);
	const renderAdminExpire = useCallback(
		(expireAt?: number | null) => {
			if (expireAt === null || expireAt === undefined) {
				return (
					<Text fontSize="xs" color="gray.400" _dark={{ color: "gray.500" }}>
						{t("admins.expireNotSet", "No expiry set")}
					</Text>
				);
			}
			const info = relativeExpiryDate(expireAt);
			if (!info.time) {
				return null;
			}
			return (
				<Text fontSize="xs" color="gray.600" _dark={{ color: "gray.400" }}>
					{info.status === "expires"
						? renderRelativeText("expires", info.time)
						: renderRelativeText("expired", info.time)}
				</Text>
			);
		},
		[renderRelativeText, t],
	);

	const { className, sx, ...restProps } = props;
	const normalizedSx = Array.isArray(sx)
		? Object.assign({}, ...sx)
		: (sx as Record<string, unknown> | undefined);
	const baseTableSx: Record<string, unknown> = {
		width: "100%",
		tableLayout: "fixed",
		"& th, & td": {
			px: { base: 2, xl: 2.5 },
			py: 2.5,
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

	const summaryData = useMemo(() => {
		const hasCompleteSummary = adminOptions.length > 0 || total <= admins.length;
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
		return {
			totalCount: adminOptions.length || total,
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
	const formatSummaryCount = (value: number | null) =>
		value === null ? "-" : formatCount(value, locale);
	const adminSummaryItems = [
		{
			label: t("admins.totalLabel", "Total"),
			value: formatCount(summaryData.totalCount, locale),
			colorScheme: "gray",
		},
		{
			label: t("admins.roles.fullAccess", "Full access"),
			value: formatSummaryCount(summaryData.fullAccessCount),
			colorScheme: "yellow",
		},
		{
			label: t("admins.roles.sudo", "Sudo"),
			value: formatSummaryCount(summaryData.sudoCount),
			colorScheme: "purple",
		},
		{
			label: t("admins.roles.reseller", "Reseller"),
			value: formatSummaryCount(summaryData.resellerCount),
			colorScheme: "blue",
		},
		{
			label: t("admins.roles.standard", "Standard"),
			value: formatSummaryCount(summaryData.standardCount),
			colorScheme: "gray",
		},
		{
			label: t("status.active"),
			value: formatSummaryCount(summaryData.activeCount),
			colorScheme: "green",
		},
		{
			label: t("status.expired", "Expired"),
			value: formatSummaryCount(summaryData.expiredCount),
			colorScheme: "orange",
		},
		{
			label: t("status.limited", "Limited"),
			value: formatSummaryCount(summaryData.limitedCount),
			colorScheme: "red",
		},
		{
			label: t("status.disabled"),
			value: formatSummaryCount(summaryData.disabledCount),
			colorScheme: "gray",
		},
	];

	const skeletonCount = filters.limit || 5;
	const adminSorting = useMemo<SortingState>(() => {
		const currentSort = filters.sort || "";
		const desc = currentSort.startsWith("-");
		const id = desc ? currentSort.slice(1) : currentSort;
		return id ? [{ id, desc }] : [];
	}, [filters.sort]);

	const handleAdminTableSorting = (nextSorting: SortingState) => {
		const next = nextSorting[0];
		if (!next) return;
		const allowedSorts = new Set([
			"username",
			"users_count",
			"data_usage",
			"data_limit",
		]);
		if (!allowedSorts.has(next.id)) return;
		onFilterChange({
			sort: next.desc ? `-${next.id}` : next.id,
			offset: 0,
		});
	};

	const adminColumns = useMemo<DataTableColumn<Admin>[]>(
		() => [
			{
				id: "username",
				header: t("username"),
				accessor: "username",
				sortable: true,
				isPrimary: true,
				priority: "primary",
				width: "210px",
				minWidth: "190px",
				maxWidth: "260px",
				truncate: true,
				tooltip: true,
				cellAlign: "start",
				mobilePriority: 0,
				mobileMetaLabel: t("username"),
				cell: (admin) => (
					<Stack spacing={0} minW={0} align="start" textAlign="start">
						<Text
							fontWeight="semibold"
							noOfLines={1}
							dir="ltr"
							sx={{ unicodeBidi: "isolate" }}
							color="panel.text"
						>
							{admin.username}
						</Text>
						<Text fontSize="xs" color="panel.textMuted">
							{t("admins.idLabel", "ایدی")}: {admin.id}
						</Text>
					</Stack>
				),
			},
			{
				id: "role",
				header: t("admins.roleHeader", "Role"),
				priority: "high",
				width: "118px",
				maxWidth: "130px",
				mobilePriority: 1,
				mobileMetaLabel: t("admins.roleHeader", "Role"),
				cell: (admin) => <AdminRoleBadge role={admin.role} />,
			},
			{
				id: "status",
				header: t("status"),
				priority: "high",
				width: "116px",
				maxWidth: "130px",
				headerAlign: "center",
				mobilePriority: 2,
				mobileMetaLabel: t("status"),
				cell: (admin) => <AdminStatusBadge status={admin.status} />,
			},
			{
				id: "expire",
				header: t("expire", "Expire"),
				priority: "medium",
				hideBelow: "xl",
				width: "126px",
				maxWidth: "146px",
				mobilePriority: 3,
				mobileMetaLabel: t("expire", "Expire"),
				cell: (admin) =>
					renderAdminExpire(
						typeof admin.expire === "number" && admin.expire > 0
							? admin.expire
							: null,
					),
			},
			{
				id: "users_count",
				header: t("admins.details.activeLabel", "Active"),
				sortable: true,
				priority: "high",
				width: "92px",
				maxWidth: "104px",
				headerAlign: "center",
				mobilePriority: 4,
				mobileMetaLabel: t("admins.details.activeLabel", "Active"),
				cell: (admin) => {
					const usersLimitLabel =
						admin.users_limit && admin.users_limit > 0
							? String(admin.users_limit)
							: "∞";
					return (
						<Text
							fontSize="sm"
							fontWeight="semibold"
							dir="ltr"
							sx={{ unicodeBidi: "isolate" }}
						>
							{admin.active_users ?? 0}/{usersLimitLabel}
						</Text>
					);
				},
			},
			{
				id: "online",
				header: t("admins.details.onlineLabel", "Online"),
				priority: "medium",
				hideBelow: "xl",
				width: "86px",
				maxWidth: "96px",
				headerAlign: "center",
				mobilePriority: 5,
				mobileMetaLabel: t("admins.details.onlineLabel", "Online"),
				cell: (admin) => (
					<Text
						fontSize="sm"
						color="green.600"
						_dark={{ color: "green.400" }}
						fontWeight="semibold"
					>
						{formatCount(admin.online_users ?? 0, locale)}
					</Text>
				),
			},
			{
				id: "services",
				header: t("admins.servicesHeader", "Services"),
				priority: "medium",
				hideBelow: "xl",
				width: "112px",
				maxWidth: "130px",
				mobilePriority: 6,
				mobileMetaLabel: t("admins.servicesHeader", "Services"),
				cell: (admin) => (
					<Text fontSize="sm" noOfLines={1}>
						{admin.services?.length
							? formatCount(admin.services.length, locale)
							: t("admins.allServices", "All services")}
					</Text>
				),
			},
			{
				id: "permissions",
				header: t("admins.permissionsHeader", "Permissions"),
				priority: "low",
				hideBelow: "xl",
				width: "116px",
				maxWidth: "130px",
				headerAlign: "center",
				mobilePriority: 7,
				mobileMetaLabel: t("admins.permissionsHeader", "Permissions"),
				cell: (admin) => (
					<Text
						fontSize="sm"
						fontWeight="semibold"
						dir="ltr"
						sx={{ unicodeBidi: "isolate" }}
					>
						{getEnabledUserPermissionsCount(admin)}/
						{Object.values(UserPermissionToggle).length}
					</Text>
				),
			},
			{
				id: "data_usage",
				header: t("admins.trafficUsedLimit", "Used / Limit"),
				sortable: true,
				priority: "medium",
				width: "152px",
				maxWidth: "174px",
				headerAlign: "center",
				mobilePriority: 8,
				mobileSummary: true,
				mobileMetaLabel: t("admins.trafficUsedLimit", "Used / Limit"),
				cell: (admin) => (
					<Text
						fontSize="sm"
						dir="ltr"
						sx={{ unicodeBidi: "isolate" }}
						whiteSpace="nowrap"
					>
						{formatBytes(getAdminEffectiveUsage(admin), 2)} /{" "}
						{formatByteLimit(admin.data_limit)}
					</Text>
				),
			},
			{
				id: "traffic_mode",
				header: t("admins.details.trafficMode", "Traffic mode"),
				priority: "low",
				hideBelow: "xl",
				width: "132px",
				maxWidth: "150px",
				mobilePriority: 10,
				mobileMetaLabel: t("admins.details.trafficMode", "Traffic mode"),
				cell: (admin) => (
					<Text fontSize="sm" noOfLines={1}>
						{admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
							? t("admins.createdTrafficMode", "Created traffic")
							: t("admins.usedTrafficMode", "Used traffic")}
					</Text>
				),
			},
		],
		[locale, renderAdminExpire, t],
	);

	const adminRowActions = (admin: Admin): DataTableRowAction<Admin>[] => {
		const meta = getAdminRowMeta(admin);
		const actions: DataTableRowAction<Admin>[] = [];

		if (meta.canManage) {
			actions.push(
				{
					id: "edit",
					label: t("admins.editAction", "Edit"),
					icon: <PencilIcon width={16} />,
					onClick: () => openAdminDialog(admin),
				},
				{
					id: "permissions",
					label: t("admins.editPermissionsButton", "Edit permissions"),
					icon: <AdjustmentsHorizontalIcon width={16} />,
					onClick: () => handleOpenPermissionsModal(admin),
				},
				{
					id: "reset",
					label: t("admins.resetUsage", "Reset usage"),
					icon: <ResetIcon />,
					onClick: () => setResetConfirmation({ admin, type: "usage" }),
					isDisabled:
						actionState?.username === admin.username &&
						actionState?.type === "reset",
				},
			);
		}

		if (canManageSecurityFor(admin)) {
			actions.push({
				id: "security",
				label: t("admins.security.action", "Sessions and 2FA"),
				icon: <ShieldCheckIcon width={16} />,
				onClick: () => {
					setSecurityAdmin(admin);
					securityDialog.onOpen();
				},
			});
		}

		if (meta.canManage && (admin.deleted_users_usage ?? 0) > 0) {
			actions.push({
				id: "resetDeleted",
				label: t("admins.resetDeletedUsage", "Reset deleted-user usage"),
				icon: <QuickPassIcon />,
				onClick: () => setResetConfirmation({ admin, type: "deleted" }),
				isDisabled:
					actionState?.username === admin.username &&
					actionState?.type === "resetDeleted",
			});
		}

		if (meta.showEnable) {
			actions.push({
				id: "enable",
				label: t("admins.enableAdmin", "Enable admin"),
				icon: <EnableIcon />,
				onClick: () => handleEnableAdmin(admin),
				isDisabled:
					actionState?.username === admin.username &&
					actionState?.type === "enableAdmin",
			});
		}

		if (meta.showDisable) {
			actions.push({
				id: "disable",
				label: t("admins.disableAdmin", "Disable admin"),
				icon: <DisableIcon />,
				onClick: () => startDisableAdmin(admin),
				isDisabled:
					actionState?.username === admin.username &&
					actionState?.type === "disableAdmin",
			});
		}

		if (meta.showAddTraffic) {
			actions.push({
				id: "addTraffic",
				label: t("admins.addTraffic", "Add traffic"),
				render: (_row, onClose) => renderAddTrafficSubmenu(admin, onClose),
			});
		}

		if (meta.canManage) {
			actions.push({
				id: "quickPassword",
				label: t("admins.quickPassword", "Generate new password"),
				icon: <QuickPassIcon />,
				onClick: () => handleQuickPassword(admin),
				isDisabled: contextAction === "quickPassword",
			});
		}

		if (meta.showDelete) {
			actions.push({
				id: "delete",
				label: t("delete", "Delete"),
				icon: <DeleteIcon />,
				onClick: () => startDeleteAdmin(admin),
				isDisabled:
					actionState?.username === admin.username &&
					actionState?.type === "deleteAdmin",
				isDanger: true,
			});
		}

		return actions;
	};

	return (
		<>
			<Stack spacing={3}>
				<ResourceListCard
					title={t("admins.listHeader", "Admin list")}
					summaryItems={adminSummaryItems}
					footerActions={footerActions}
				>
					{toolbar}
				</ResourceListCard>

				<DataTable
					ariaLabel={t("admins.manageTab", "Admins")}
					data={admins}
					columns={adminColumns}
					getRowId={(admin) => admin.username}
					isLoading={loading}
					loadingRows={skeletonCount}
					emptyState={
						<Text fontSize="sm" color="panel.textMuted" textAlign="center">
							{t("admins.noAdmins")}
						</Text>
					}
					enableSelection
					selectedRowIds={selectedAdminUsernames}
					selectedRows={selectedAdmins}
					selectedCount={selectedAdminUsernames.length}
					onSelectionChange={(rowIds) => setSelectedAdminUsernames(rowIds)}
					selectedLabel={t("admins.selectedCount", {
						defaultValue: "{{count}} admins selected",
						count: selectedAdminUsernames.length,
					})}
					rowActions={adminRowActions}
					actionsDisplay="menu"
					actionsPlacement="end"
					actionsColumnWidth="60px"
					showActionsOnHover
					onRowClick={(admin) => openAdminDetails(admin)}
					sorting={adminSorting}
					onSortingChange={handleAdminTableSorting}
					manualSorting
					dir={isRTL ? "rtl" : "ltr"}
					mobileBreakpoint="lg"
					tableProps={tableProps}
				/>
			</Stack>

			<ConfirmDialog
				isOpen={Boolean(resetConfirmation)}
				onClose={() => setResetConfirmation(null)}
				onConfirm={confirmUsageReset}
				title={t(
					resetConfirmation?.type === "deleted"
						? "admins.resetDeletedUsage"
						: "admins.resetUsage",
					"Reset usage",
				)}
				description={t(
					"admins.resetUsageConfirm",
					"Reset usage for {{username}}?",
					{ username: resetConfirmation?.admin.username ?? "" },
				)}
				confirmLabel={t("reset", "Reset")}
				isLoading={
					actionState?.type === "reset" || actionState?.type === "resetDeleted"
				}
			/>

			<ConfirmDialog
				isOpen={isDeleteDialogOpen}
				onClose={closeDeleteDialogAndReset}
				onConfirm={confirmDeleteAdmin}
				title={t("delete", "Delete")}
				description={t(
					"admins.confirmDeleteMessage",
					"Are you sure you want to delete {{username}}?",
					{ username: adminToDelete?.username ?? "" },
				)}
				confirmLabel={t("delete", "Delete")}
				colorScheme="red"
				isLoading={actionState?.type === "deleteAdmin"}
				isConfirmDisabled={!adminToDelete}
			/>

			<ConfirmDialog
				isOpen={isQuickPassConfirmOpen}
				onClose={() => {
					if (contextAction === "quickPassword") return;
					closeQuickPassConfirm();
					setQuickPassAdmin(null);
				}}
				onConfirm={confirmQuickPassword}
				title={t(
					"admins.quickPasswordConfirmTitle",
					"Generate new credentials",
				)}
				description={t(
					"admins.quickPasswordConfirm",
					"Generate a new password for {{username}}? The old password will stop working immediately.",
					{ username: quickPassAdmin?.username ?? "" },
				)}
				confirmLabel={t("admins.quickPasswordAction", "Generate")}
				colorScheme="primary"
				isLoading={contextAction === "quickPassword"}
			/>

			<Modal isOpen={isQuickPassOpen} onClose={handleCloseQuickPass} isCentered>
				<ModalOverlay bg="blackAlpha.500" backdropFilter="blur(12px)" />
				<ModalContent
					bg={dialogBg}
					borderWidth="1px"
					borderColor={dialogBorderColor}
					borderRadius="2xl"
					boxShadow="2xl"
					overflow="hidden"
					mx={{ base: 4, sm: 0 }}
					maxW={{ base: "calc(100vw - 32px)", sm: "440px" }}
				>
					<ModalHeader px={6} pt={6} pb={2}>
						<HStack spacing={3}>
							<Box
								display="inline-flex"
								alignItems="center"
								justifyContent="center"
								w={10}
								h={10}
								borderRadius="full"
								bg="primary.50"
								color="primary.600"
								_dark={{ bg: "primary.900", color: "primary.200" }}
							>
								<QuickPassIcon />
							</Box>
							<Text>{t("admins.quickPasswordModal.title", "New credentials")}</Text>
						</HStack>
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody px={6} pb={2}>
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
											onClick={async () => {
												if (quickPassInfo?.password) {
													try {
														await copyTextToClipboard(quickPassInfo.password);
														toast({
															title: t("copied", "Copied"),
															status: "success",
															duration: 1200,
														});
													} catch (error) {
														generateErrorMessage(error, toast);
													}
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
					<ModalFooter
						bg="blackAlpha.50"
						_dark={{ bg: "whiteAlpha.50" }}
						borderTopWidth="1px"
						borderColor={dialogBorderColor}
						px={6}
						py={4}
					>
						<Button colorScheme="primary" onClick={handleCloseQuickPass}>
							{t("close")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
			<ConfirmDialog
				isOpen={isDisableDialogOpen}
				onClose={closeDisableDialogAndReset}
				onConfirm={confirmDisableAdmin}
				title={t("admins.disableAdminTitle", "Disable admin")}
				description={
					<Stack spacing={3}>
						<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.300" }}>
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
					</Stack>
				}
				confirmLabel={t("admins.disableAdminConfirm", "Disable admin")}
				colorScheme="red"
				isConfirmDisabled={disableReason.trim().length < 3}
				isLoading={
					actionState?.type === "disableAdmin" &&
					actionState?.username === adminToDisable?.username
				}
			/>
			<AdminPermissionsModal
				isOpen={isPermissionsModalOpen}
				onClose={handleClosePermissionsModal}
				admin={adminForPermissions}
			/>
			<AdminSecurityDialog
				admin={securityAdmin}
				isOpen={securityDialog.isOpen}
				onClose={() => {
					securityDialog.onClose();
					setSecurityAdmin(null);
				}}
				canManageSessions={canManageSessions}
				canManage2FA={canManage2FA}
				onChanged={() => fetchAdmins(undefined, { force: true })}
			/>
		</>
	);
};
