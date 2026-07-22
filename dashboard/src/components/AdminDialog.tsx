import {
	Badge,
	Box,
	Button,
	Checkbox,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputRightElement,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Radio,
	RadioGroup,
	SimpleGrid,
	Stack,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	EyeIcon,
	EyeSlashIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminsStore } from "contexts/AdminsContext";
import { getDefaultPermissionsForRole } from "constants/adminPermissions";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type {
	AdminCreatePayload,
	AdminPermissions,
	AdminUpdatePayload,
} from "types/Admin";
import { AdminRole, AdminStatus, AdminTrafficLimitMode } from "types/Admin";
import type { ServiceSummary } from "types/Service";
import { relativeExpiryDate } from "utils/dateFormatter";
import { formatBytes } from "utils/formatByte";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { z } from "zod";
import AdminPermissionsEditor from "./AdminPermissionsEditor";
import AdminPermissionsModal from "./AdminPermissionsModal";
import {
	AnimatedSubmitButton,
	type AnimatedSubmitStatus,
} from "./common/AnimatedSubmitButton";
import { NumericInput } from "./common/NumericInput";
import { DateTimePicker } from "./DateTimePicker";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

const GB_IN_BYTES = 1024 * 1024 * 1024;
const MB_IN_BYTES = 1024 * 1024;

const clonePermissions = (role: AdminRole): AdminPermissions =>
	getDefaultPermissionsForRole(role);

const formatBytesToGbString = (value?: number | null) =>
	value && value > 0 ? String(Math.floor(value / GB_IN_BYTES)) : "";

const adminPermissionsSchema: z.ZodType<AdminPermissions> = z.object({
	users: z.object({
		create: z.boolean(),
		delete: z.boolean(),
		reset_usage: z.boolean(),
		revoke: z.boolean(),
		create_on_hold: z.boolean(),
		allow_unlimited_data: z.boolean(),
		allow_unlimited_expire: z.boolean(),
		allow_next_plan: z.boolean(),
		advanced_actions: z.boolean(),
		set_flow: z.boolean(),
		allow_custom_key: z.boolean(),
		max_data_limit_per_user: z.number().nullable(),
	}),
	admin_management: z.object({
		can_view: z.boolean(),
		can_edit: z.boolean(),
		can_manage_sudo: z.boolean(),
		manage_sessions: z.boolean(),
		manage_2fa: z.boolean(),
	}),
	self_permissions: z.object({
		self_myaccount: z.boolean(),
		self_change_password: z.boolean(),
		self_api_keys: z.boolean(),
		self_sessions: z.boolean(),
		self_2fa: z.boolean(),
	}),
	sections: z.object({
		usage: z.boolean(),
		admins: z.boolean(),
		services: z.boolean(),
		hosts: z.boolean(),
		nodes: z.boolean(),
		integrations: z.boolean(),
		xray: z.boolean(),
	}),
	sudo: z.object({
		nodes: z.boolean(),
		xray: z.boolean(),
		settings: z.boolean(),
		subscriptions: z.boolean(),
		backups: z.boolean(),
		maintenance: z.boolean(),
		phpmyadmin: z.boolean(),
	}),
});

type AdminFormValues = {
	username: string;
	password?: string;
	telegram_id?: string;
	role: AdminRole;
	require_2fa: boolean;
	traffic_limit_mode: AdminTrafficLimitMode;
	use_service_traffic_limits: boolean;
	show_user_traffic: boolean;
	delete_user_usage_limit_enabled: boolean;
	delete_user_usage_limit?: string;
	permissions: AdminPermissions;
	maxDataLimitPerUserGb?: string;
	data_limit?: string;
	users_limit?: string;
	services?: number[];
	service_limits?: Record<
		number,
		{
			traffic_limit_mode: AdminTrafficLimitMode;
			data_limit?: string;
			show_user_traffic: boolean;
			users_limit?: string;
			created_traffic?: number;
			used_traffic?: number;
			lifetime_used_traffic?: number;
			deleted_users_usage?: number;
			delete_user_usage_limit_enabled: boolean;
			delete_user_usage_limit?: string;
		}
	>;
};

export const AdminDialog: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";

	const basePad = "0.75rem";
	const endPadding = isRTL
		? { paddingInlineStart: "2.75rem", paddingInlineEnd: basePad }
		: { paddingInlineEnd: "2.75rem", paddingInlineStart: basePad };
	const endAdornmentProps = isRTL
		? {
				insetInlineStart: "0.5rem",
				insetInlineEnd: "auto",
				right: "auto",
				left: "0.5rem",
			}
		: {
				insetInlineEnd: "0.5rem",
				insetInlineStart: "auto",
				right: "0.5rem",
				left: "auto",
			};
	const { userData } = useGetUser();
	const canCreateFullAccess = userData.role === AdminRole.FullAccess;
	const canManage2FA =
		canCreateFullAccess || Boolean(userData.permissions.admin_management.manage_2fa);
	const toast = useToast();
	const {
		admins,
		adminInDialog: adminFromStore,
		isAdminDialogOpen: isOpen,
		closeAdminDialog,
		createAdmin,
		fetchAdmins,
		updateAdmin,
	} = useAdminsStore();
	const admin = useMemo(() => {
		if (!adminFromStore) {
			return null;
		}
		return (
			admins.find((item) => item.username === adminFromStore.username) ??
			adminFromStore
		);
	}, [adminFromStore, admins]);

	const mode = useMemo(() => (admin ? "edit" : "create"), [admin]);
	const statusLabels = useMemo(
		() => ({
			[AdminStatus.Active]: t("status.active"),
			[AdminStatus.Disabled]: t("nodes.disabled"),
			[AdminStatus.Deleted]: t("admins.statusDeleted"),
		}),
		[t],
	);
	const statusLabel = admin
		? (statusLabels[admin.status] ?? admin.status)
		: t("admins.statusNew");

	const schema = useMemo(() => {
		const base = z
			.object({
				username:
					mode === "create"
						? z
								.string()
								.trim()
								.min(3, { message: t("admins.validation.usernameMin") })
						: z.string().optional(),
				password: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => !value || value.length >= 6,
						t("admins.validation.passwordMin"),
					),
				telegram_id: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t("admins.validation.telegramNumeric"),
					),
				role: z.nativeEnum(AdminRole).optional(),
				require_2fa: z.boolean().default(false),
				traffic_limit_mode: z
					.nativeEnum(AdminTrafficLimitMode)
					.default(AdminTrafficLimitMode.UsedTraffic),
				use_service_traffic_limits: z.boolean().default(false),
				show_user_traffic: z.boolean().default(true),
				delete_user_usage_limit_enabled: z.boolean().default(false),
				delete_user_usage_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t("admins.validation.deleteLimitNumeric"),
					),
				data_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t("admins.validation.dataLimitNumeric"),
					),
				users_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t("admins.validation.usersLimitNumeric"),
					),
				maxDataLimitPerUserGb: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				permissions: adminPermissionsSchema,
				services: z.array(z.number()).optional(),
				service_limits: z.record(z.any()).optional(),
			})
			.superRefine((values, ctx) => {
				if (mode === "create" && !values.password) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["password"],
						message: t("admins.validation.passwordRequired"),
					});
				}
			});
		return base as z.ZodType<AdminFormValues>;
	}, [mode, t]);

	const form = useForm<AdminFormValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			username: "",
			password: "",
			telegram_id: "",
			role: AdminRole.Standard,
			require_2fa: false,
			traffic_limit_mode: AdminTrafficLimitMode.UsedTraffic,
			use_service_traffic_limits: false,
			show_user_traffic: true,
			delete_user_usage_limit_enabled: false,
			delete_user_usage_limit: "",
			permissions: clonePermissions(AdminRole.Standard),
			maxDataLimitPerUserGb: "",
			data_limit: "",
			users_limit: "",
			services: [],
			service_limits: {},
		},
	});

	const {
		register,
		handleSubmit,
		reset,
		formState,
		setValue,
		getValues,
		watch,
		setError,
	} = form;
	const [showPassword, setShowPassword] = useState(false);
	const [permissionsModalOpen, setPermissionsModalOpen] = useState(false);
	const [serviceOptions, setServiceOptions] = useState<ServiceSummary[]>([]);
	const [adminExpireDate, setAdminExpireDate] = useState<Date | null>(null);
	const [submitStatus, setSubmitStatus] =
		useState<AnimatedSubmitStatus>("idle");
	const submitResetTimerRef = useRef<number | null>(null);
	const successCloseTimerRef = useRef<number | null>(null);
	const adminExpireUnix = useMemo(
		() => (adminExpireDate ? dayjs(adminExpireDate).utc().unix() : null),
		[adminExpireDate],
	);
	const adminExpireInfo = useMemo(
		() => relativeExpiryDate(adminExpireUnix ?? null),
		[adminExpireUnix],
	);
	const [serviceSearch, setServiceSearch] = useState("");
	const filteredServices = useMemo(() => {
		const query = serviceSearch.trim().toLowerCase();
		if (!query) {
			return serviceOptions;
		}
		return serviceOptions.filter((service) =>
			service.name.toLowerCase().includes(query),
		);
	}, [serviceOptions, serviceSearch]);
	const selectedServices = watch("services") || [];
	const selectedServicesSet = useMemo(
		() => new Set(selectedServices),
		[selectedServices],
	);

	const generateRandomString = useCallback((length: number) => {
		const characters =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const charactersLength = characters.length;

		if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
			const randomValues = new Uint32Array(length);
			window.crypto.getRandomValues(randomValues);
			return Array.from(
				randomValues,
				(value) => characters[value % charactersLength],
			).join("");
		}

		return Array.from({ length }, () => {
			const index = Math.floor(Math.random() * charactersLength);
			return characters[index];
		}).join("");
	}, []);

	const handleGenerateUsername = useCallback(() => {
		if (mode === "edit") return;
		const randomUsername = generateRandomString(8);
		setValue("username", randomUsername, {
			shouldDirty: true,
			shouldValidate: true,
		});
	}, [generateRandomString, mode, setValue]);

	const handleServiceToggle = (serviceId: number) => {
		const next = selectedServicesSet.has(serviceId)
			? selectedServices.filter((id) => id !== serviceId)
			: [...selectedServices, serviceId];
		setValue("services", next, { shouldDirty: true, shouldValidate: true });
	};

	const handleToggleAllServices = () => {
		const hasAllSelected =
			selectedServices.length === serviceOptions.length &&
			serviceOptions.length > 0;
		const next = hasAllSelected
			? []
			: serviceOptions.map((service) => service.id);
		setValue("services", next, { shouldDirty: true, shouldValidate: true });
	};

	const handleGeneratePassword = useCallback(() => {
		const randomPassword = generateRandomString(12);
		setValue("password", randomPassword, {
			shouldDirty: true,
			shouldValidate: true,
		});
	}, [generateRandomString, setValue]);

	const clearSubmitTimers = useCallback(() => {
		if (submitResetTimerRef.current !== null) {
			window.clearTimeout(submitResetTimerRef.current);
			submitResetTimerRef.current = null;
		}
		if (successCloseTimerRef.current !== null) {
			window.clearTimeout(successCloseTimerRef.current);
			successCloseTimerRef.current = null;
		}
	}, []);

	useEffect(() => clearSubmitTimers, [clearSubmitTimers]);

	const showSubmitError = useCallback(() => {
		if (successCloseTimerRef.current !== null) {
			window.clearTimeout(successCloseTimerRef.current);
			successCloseTimerRef.current = null;
		}
		if (submitResetTimerRef.current !== null) {
			window.clearTimeout(submitResetTimerRef.current);
		}
		setSubmitStatus("error");
		submitResetTimerRef.current = window.setTimeout(() => {
			setSubmitStatus("idle");
			submitResetTimerRef.current = null;
		}, 900);
	}, []);

	const handleCloseAdminDialog = useCallback(() => {
		clearSubmitTimers();
		setSubmitStatus("idle");
		closeAdminDialog();
	}, [clearSubmitTimers, closeAdminDialog]);

	const { errors, isSubmitting } = formState;
	const watchRole = watch("role");
	const watchTrafficLimitMode = watch("traffic_limit_mode");
	const watchUseServiceTrafficLimits = watch("use_service_traffic_limits");
	const _hideExtendedPermissions = watchRole === AdminRole.Standard;
	const permissionsValue = watch("permissions");
	const showUserTrafficValue = watch("show_user_traffic");
	const deleteUserUsageLimitEnabled = watch("delete_user_usage_limit_enabled");
	const serviceLimitsValue = watch("service_limits") ?? {};
	const telegramIdValue = watch("telegram_id") ?? "";
	const deleteUserUsageLimitValue = watch("delete_user_usage_limit") ?? "";
	const dataLimitValue = watch("data_limit") ?? "";
	const parsedGlobalDataLimit = Number(dataLimitValue);
	const hasGlobalDataLimit =
		String(dataLimitValue).trim().length > 0 &&
		Number.isFinite(parsedGlobalDataLimit) &&
		parsedGlobalDataLimit > 0;
	const usersLimitValue = watch("users_limit") ?? "";
	const maxDataLimitValue = watch("maxDataLimitPerUserGb") ?? "";
	const isFullAccessRole = watchRole === AdminRole.FullAccess;
	const isCreatedTrafficMode =
		watchTrafficLimitMode === AdminTrafficLimitMode.CreatedTraffic;
	const usePerServiceTrafficLimits = Boolean(watchUseServiceTrafficLimits);

	const getServiceLimitValue = useCallback(
		(serviceId: number) =>
			serviceLimitsValue[serviceId] ?? {
				traffic_limit_mode: AdminTrafficLimitMode.UsedTraffic,
				data_limit: "",
				show_user_traffic: true,
				users_limit: "",
				created_traffic: 0,
				used_traffic: 0,
				lifetime_used_traffic: 0,
				deleted_users_usage: 0,
				delete_user_usage_limit_enabled: false,
				delete_user_usage_limit: "",
			},
		[serviceLimitsValue],
	);

	const setServiceLimitValue = useCallback(
		(
			serviceId: number,
			patch: Partial<ReturnType<typeof getServiceLimitValue>>,
		) => {
			const current = getValues("service_limits") ?? {};
			setValue(
				"service_limits",
				{
					...current,
					[serviceId]: {
						...getServiceLimitValue(serviceId),
						...patch,
					},
				},
				{ shouldDirty: true },
			);
		},
		[getServiceLimitValue, getValues, setValue],
	);

	const resetPermissionsToRole = useCallback(() => {
		const role = watchRole ?? AdminRole.Standard;
		setValue("permissions", clonePermissions(role), { shouldDirty: true });
		setValue("maxDataLimitPerUserGb", "", { shouldDirty: true });
	}, [setValue, watchRole]);

	const handlePermissionsChange = useCallback(
		(next: AdminPermissions) => {
			setValue("permissions", next, { shouldDirty: true });
		},
		[setValue],
	);

	const handleUserPermissionToggle = useCallback(
		(key: "delete" | "reset_usage", next: boolean) => {
			setValue(
				"permissions",
				{
					...permissionsValue,
					users: {
						...permissionsValue.users,
						[key]: next,
					},
				},
				{ shouldDirty: true },
			);
		},
		[permissionsValue, setValue],
	);

	const handleMaxDataLimitChange = useCallback(
		(value: string) => {
			setValue("maxDataLimitPerUserGb", value, { shouldDirty: true });
		},
		[setValue],
	);

	useEffect(() => {
		register("maxDataLimitPerUserGb");
		register("permissions");
		register("services");
		register("service_limits");
	}, [register]);

	useEffect(() => {
		if (!isOpen) {
			setAdminExpireDate(null);
			return;
		}
		if (admin) {
			setAdminExpireDate(
				typeof admin.expire === "number" && admin.expire > 0
					? dayjs.unix(admin.expire).toDate()
					: null,
			);
			return;
		}
		setAdminExpireDate(null);
	}, [admin, isOpen]);

	useEffect(() => {
		if (isOpen) {
			setServiceSearch("");
			// Fetch services for selection
			fetch<{ services: ServiceSummary[]; total?: number }>("/v2/services", {
				query: { limit: 500 },
			})
				.then((resp) => {
					const services = Array.isArray((resp as any).services)
						? (resp as any).services
						: Array.isArray(resp)
							? (resp as any)
							: [];
					setServiceOptions(services);
				})
				.catch(() => setServiceOptions([]));

			const nextRole: AdminRole = admin?.role ?? AdminRole.Standard;
			const nextPermissions = admin
				? (JSON.parse(JSON.stringify(admin.permissions)) ??
					clonePermissions(nextRole))
				: clonePermissions(nextRole);
			reset({
				username: admin?.username ?? "",
				password: "",
				telegram_id:
					admin?.telegram_id !== undefined && admin?.telegram_id !== null
						? String(admin.telegram_id)
						: "",
				role: nextRole,
				require_2fa: admin?.require_2fa ?? false,
				traffic_limit_mode:
					admin?.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
				use_service_traffic_limits: admin?.use_service_traffic_limits ?? false,
				show_user_traffic: admin?.show_user_traffic ?? true,
				delete_user_usage_limit_enabled:
					admin?.delete_user_usage_limit_enabled ?? false,
				delete_user_usage_limit:
					admin?.delete_user_usage_limit !== undefined &&
					admin?.delete_user_usage_limit !== null
						? String(Math.floor(admin.delete_user_usage_limit / MB_IN_BYTES))
						: "",
				permissions: nextPermissions,
				maxDataLimitPerUserGb: formatBytesToGbString(
					nextPermissions.users.max_data_limit_per_user,
				),
				data_limit:
					admin?.data_limit !== undefined && admin?.data_limit !== null
						? String(Math.floor(admin.data_limit / GB_IN_BYTES))
						: "",
				users_limit:
					admin?.users_limit !== undefined && admin?.users_limit !== null
						? String(admin.users_limit)
						: "",
				services: admin?.services ?? [],
				service_limits: Object.fromEntries(
					(admin?.service_limits ?? []).map((item) => [
						item.service_id,
						{
							traffic_limit_mode:
								item.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
							data_limit:
								item.data_limit !== undefined && item.data_limit !== null
									? String(Math.floor(item.data_limit / GB_IN_BYTES))
									: "",
							show_user_traffic: item.show_user_traffic ?? true,
							users_limit:
								item.users_limit !== undefined && item.users_limit !== null
									? String(item.users_limit)
									: "",
							created_traffic: Number(item.created_traffic ?? 0),
							used_traffic: Number(item.used_traffic ?? 0),
							lifetime_used_traffic: Number(item.lifetime_used_traffic ?? 0),
							deleted_users_usage: Number(item.deleted_users_usage ?? 0),
							delete_user_usage_limit_enabled:
								item.delete_user_usage_limit_enabled ?? false,
							delete_user_usage_limit:
								item.delete_user_usage_limit !== undefined &&
								item.delete_user_usage_limit !== null
									? String(
											Math.floor(item.delete_user_usage_limit / MB_IN_BYTES),
										)
									: "",
						},
					]),
				),
			});
		}
	}, [admin, isOpen, reset]);

	useEffect(() => {
		if (!isOpen) {
			setPermissionsModalOpen(false);
		}
	}, [isOpen]);

	useEffect(() => {
		if (watchRole === AdminRole.FullAccess) {
			setValue("traffic_limit_mode", AdminTrafficLimitMode.UsedTraffic, {
				shouldDirty: true,
			});
			setValue("use_service_traffic_limits", false, { shouldDirty: true });
			setValue("show_user_traffic", true, { shouldDirty: true });
			setValue("delete_user_usage_limit_enabled", false, {
				shouldDirty: true,
			});
		}
	}, [setValue, watchRole]);

	useEffect(() => {
		if (!permissionsValue.users.delete) {
			setValue("delete_user_usage_limit_enabled", false, {
				shouldDirty: true,
			});
		}
	}, [permissionsValue.users.delete, setValue]);

	useEffect(() => {
		if (isOpen) {
			setSubmitStatus("idle");
			clearSubmitTimers();
		}
	}, [clearSubmitTimers, isOpen]);

	const handleFormSubmit = handleSubmit(async (values) => {
		if (submitStatus !== "idle") return;
		clearSubmitTimers();
		setSubmitStatus("loading");
		const selectedRole: AdminRole = values.role ?? AdminRole.Standard;
		let permissionPayload: AdminPermissions | undefined;
		if (selectedRole === AdminRole.Reseller) {
			toast({
				status: "warning",
				title: t("common.comingSoon"),
				description: t("admins.roles.resellerDescription"),
				isClosable: true,
			});
			showSubmitError();
			return;
		}

		const buildPermissionsPayload = (): AdminPermissions => {
			const computedPermissions: AdminPermissions = JSON.parse(
				JSON.stringify(values.permissions ?? clonePermissions(selectedRole)),
			);
			const maxLimitInput = values.maxDataLimitPerUserGb?.trim();
			if (computedPermissions.users.allow_unlimited_data) {
				computedPermissions.users.max_data_limit_per_user = null;
			} else if (maxLimitInput) {
				const parsed = Number(maxLimitInput);
				if (Number.isNaN(parsed) || parsed < 0) {
					setError("maxDataLimitPerUserGb", {
						type: "manual",
						message: t("admins.validation.invalidMaxDataLimit"),
					});
					showSubmitError();
					throw new Error("invalid_max_data_limit");
				}
				computedPermissions.users.max_data_limit_per_user =
					parsed === 0 ? null : Math.round(parsed * GB_IN_BYTES);
			} else {
				computedPermissions.users.max_data_limit_per_user = null;
			}
			return computedPermissions;
		};

		if (mode === "create" || selectedRole !== AdminRole.FullAccess) {
			try {
				permissionPayload = buildPermissionsPayload();
			} catch (error) {
				if ((error as Error).message === "invalid_max_data_limit") {
					return;
				}
				throw error;
			}
		}

		if (mode === "edit" && admin) {
			const currentActive = admin.active_users ?? 0;
			if (values.users_limit) {
				const requestedLimit = Number(values.users_limit);
				if (
					!Number.isNaN(requestedLimit) &&
					requestedLimit > 0 &&
					requestedLimit < currentActive
				) {
					setError("users_limit", {
						type: "manual",
						message: t("admins.validation.usersLimitTooLow", {
							active: currentActive,
						}),
					});
					showSubmitError();
					return;
				}
			}
		}
		try {
			const expireValue = adminExpireDate
				? dayjs(adminExpireDate).utc().unix()
				: null;
			const buildServiceLimitPayload = () =>
				(values.services ?? []).map((serviceId) => {
					const item = values.service_limits?.[serviceId];
					return {
						service_id: serviceId,
						traffic_limit_mode:
							item?.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
						data_limit: item?.data_limit
							? Number(item.data_limit) * GB_IN_BYTES
							: null,
						show_user_traffic: item?.show_user_traffic ?? true,
						users_limit: item?.users_limit ? Number(item.users_limit) : null,
						delete_user_usage_limit_enabled: Boolean(
							permissionsValue.users.delete &&
								item?.delete_user_usage_limit_enabled,
						),
						delete_user_usage_limit: item?.delete_user_usage_limit
							? Number(item.delete_user_usage_limit) * MB_IN_BYTES
							: null,
					};
				});
			const requestedServices = values.services ?? [];
			const serviceLimitPayload = values.use_service_traffic_limits
				? buildServiceLimitPayload()
				: undefined;
			const globalDataLimit = values.data_limit
				? Number(values.data_limit) * GB_IN_BYTES
				: null;
			const globalUsersLimit = values.users_limit
				? Number(values.users_limit)
				: null;
			const globalDeleteUserUsageLimit = values.delete_user_usage_limit
				? Number(values.delete_user_usage_limit) * MB_IN_BYTES
				: null;
			if (mode === "create") {
				const payload: AdminCreatePayload = {
					username: values.username.trim(),
					password: values.password ?? "",
					role: selectedRole,
					require_2fa: canManage2FA ? values.require_2fa : undefined,
					permissions: permissionPayload ?? clonePermissions(selectedRole),
					services: values.services || [],
					telegram_id: values.telegram_id
						? Number(values.telegram_id)
						: undefined,
					data_limit: values.use_service_traffic_limits
						? undefined
						: globalDataLimit,
					traffic_limit_mode:
						selectedRole === AdminRole.FullAccess ||
						values.use_service_traffic_limits
							? undefined
							: values.traffic_limit_mode,
					use_service_traffic_limits:
						selectedRole === AdminRole.FullAccess
							? undefined
							: values.use_service_traffic_limits,
					show_user_traffic:
						selectedRole === AdminRole.FullAccess
							? undefined
							: values.show_user_traffic,
					delete_user_usage_limit_enabled:
						selectedRole === AdminRole.FullAccess
							? undefined
							: Boolean(
									permissionsValue.users.delete &&
										values.delete_user_usage_limit_enabled,
								),
					delete_user_usage_limit: globalDeleteUserUsageLimit,
					expire: expireValue,
					users_limit: values.use_service_traffic_limits
						? undefined
						: globalUsersLimit,
				};
				const createdAdmin = await createAdmin(payload);
				let shouldFetch = true;
				let serviceSyncError: unknown = null;
				if (
					selectedRole !== AdminRole.FullAccess &&
					values.use_service_traffic_limits
				) {
					try {
						await updateAdmin(createdAdmin.username, {
							services: requestedServices,
							use_service_traffic_limits: true,
							service_limits: serviceLimitPayload,
						});
						shouldFetch = false;
					} catch (error) {
						serviceSyncError = error;
					}
				} else if (requestedServices.length > 0) {
					const createdServices = new Set(createdAdmin?.services ?? []);
					const missingServices = requestedServices.filter(
						(serviceId) => !createdServices.has(serviceId),
					);
					const needsSync =
						missingServices.length > 0 ||
						createdServices.size !== requestedServices.length;
					if (needsSync) {
						try {
							await updateAdmin(createdAdmin.username, {
								services: requestedServices,
							});
							shouldFetch = false;
						} catch (error) {
							serviceSyncError = error;
						}
					}
				}
				if (shouldFetch) {
					await fetchAdmins(undefined, { force: true });
				}
				generateSuccessMessage(
					t("admins.createSuccess"),
					toast,
				);
				if (serviceSyncError) {
					generateErrorMessage(serviceSyncError, toast);
				}
			} else if (admin) {
				const payload: AdminUpdatePayload = {
					role: selectedRole,
					require_2fa: canManage2FA ? values.require_2fa : undefined,
					permissions:
						selectedRole === AdminRole.FullAccess
							? undefined
							: permissionPayload,
					services: values.services || [],
					telegram_id: values.telegram_id
						? Number(values.telegram_id)
						: undefined,
					data_limit: values.use_service_traffic_limits
						? undefined
						: globalDataLimit,
					traffic_limit_mode:
						selectedRole === AdminRole.FullAccess ||
						values.use_service_traffic_limits
							? undefined
							: values.traffic_limit_mode,
					use_service_traffic_limits:
						selectedRole === AdminRole.FullAccess
							? undefined
							: values.use_service_traffic_limits,
					show_user_traffic:
						selectedRole === AdminRole.FullAccess
							? undefined
							: values.show_user_traffic,
					delete_user_usage_limit_enabled:
						selectedRole === AdminRole.FullAccess
							? undefined
							: Boolean(
									permissionsValue.users.delete &&
										values.delete_user_usage_limit_enabled,
								),
					delete_user_usage_limit: globalDeleteUserUsageLimit,
					expire: expireValue,
					users_limit: values.use_service_traffic_limits
						? undefined
						: globalUsersLimit,
					service_limits: serviceLimitPayload,
				};
				if (values.password) {
					payload.password = values.password;
				}
				await updateAdmin(admin.username, payload);
				generateSuccessMessage(
					t("admins.updateSuccess"),
					toast,
				);
			}
			setSubmitStatus("success");
			successCloseTimerRef.current = window.setTimeout(() => {
				successCloseTimerRef.current = null;
				handleCloseAdminDialog();
			}, 1000);
		} catch (error) {
			generateErrorMessage(error, toast, form);
			showSubmitError();
		}
	}, () => {
		if (submitStatus !== "idle") return;
		showSubmitError();
	});

	const detailsForm = (
		<VStack spacing={4} align="stretch">
			<Box className="xray-dialog-section">
				<Text fontSize="sm" fontWeight="semibold" mb={3}>
					{t("inbounds.accounts.label")}
				</Text>
				<VStack spacing={4} align="stretch">
					{mode === "edit" && admin?.id !== undefined && (
						<FormControl>
							<FormLabel>{t("admins.idLabel")}</FormLabel>
							<Input value={String(admin.id)} isReadOnly />
						</FormControl>
					)}
					{mode === "edit" && (
						<FormControl>
							<FormLabel>{t("status")}</FormLabel>
							<Input value={statusLabel} isReadOnly />
						</FormControl>
					)}
					<FormControl isInvalid={!!errors.username}>
						<FormLabel>{t("username")}</FormLabel>
						<InputGroup dir={isRTL ? "rtl" : "ltr"}>
							<Input
								placeholder={t("admins.usernamePlaceholder")}
								{...register("username")}
								isDisabled={mode === "edit"}
								{...(mode === "create" ? endPadding : {})}
							/>
							{mode === "create" && (
								<InputRightElement
									insetInlineEnd={endAdornmentProps.insetInlineEnd}
									insetInlineStart={endAdornmentProps.insetInlineStart}
									right={endAdornmentProps.right}
									left={endAdornmentProps.left}
								>
									<IconButton
										aria-label={t("admins.generateUsername")}
										size="sm"
										variant="ghost"
										icon={<SparklesIcon width={20} />}
										onClick={handleGenerateUsername}
									/>
								</InputRightElement>
							)}
						</InputGroup>
						<FormErrorMessage>
							{errors.username?.message as string}
						</FormErrorMessage>
					</FormControl>
					<FormControl isInvalid={!!errors.password}>
						<FormLabel>{t("password")}</FormLabel>
						<HStack spacing={2}>
							<InputGroup dir={isRTL ? "rtl" : "ltr"}>
								<Input
									placeholder={t("admins.passwordPlaceholder")}
									type={showPassword ? "text" : "password"}
									{...register("password")}
									{...endPadding}
								/>
								<InputRightElement
									insetInlineEnd={endAdornmentProps.insetInlineEnd}
									insetInlineStart={endAdornmentProps.insetInlineStart}
									right={endAdornmentProps.right}
									left={endAdornmentProps.left}
								>
									<IconButton
										aria-label={
											showPassword
												? t("admins.hidePassword")
												: t("admins.showPassword")
										}
										size="sm"
										variant="ghost"
										icon={
											showPassword ? (
												<EyeSlashIcon width={16} />
											) : (
												<EyeIcon width={16} />
											)
										}
										onClick={() => setShowPassword(!showPassword)}
									/>
								</InputRightElement>
							</InputGroup>
							<IconButton
								aria-label={t("admins.generatePassword")}
								size="md"
								variant="outline"
								icon={<SparklesIcon width={20} />}
								onClick={handleGeneratePassword}
							/>
						</HStack>
						<FormErrorMessage>
							{errors.password?.message as string}
						</FormErrorMessage>
						{mode === "edit" && (
							<Text fontSize="xs" color="gray.500" mt={1}>
								{t("admins.passwordOptionalHint")}
							</Text>
						)}
					</FormControl>
					<FormControl isInvalid={!!errors.telegram_id}>
						<FormLabel>{t("admins.telegramId")}</FormLabel>
						<NumericInput
							placeholder={t("admins.telegramPlaceholder")}
							value={telegramIdValue}
							precision={0}
							onChange={(value) =>
								setValue("telegram_id", value, {
									shouldDirty: true,
									shouldValidate: true,
								})
							}
						/>
						<FormErrorMessage>
							{errors.telegram_id?.message as string}
						</FormErrorMessage>
					</FormControl>
				</VStack>
			</Box>
			<Box className="xray-dialog-section">
				<Text fontSize="sm" fontWeight="semibold" mb={3}>
					{t("core.role")}
				</Text>
				<VStack spacing={4} align="stretch">
					<FormControl>
						<FormLabel>{t("admins.roleLabel")}</FormLabel>
						<RadioGroup
							value={watchRole ?? AdminRole.Standard}
							onChange={(value) =>
								setValue("role", value as AdminRole, { shouldDirty: true })
							}
						>
							<VStack align="flex-start" spacing={2}>
								<Radio value={AdminRole.Standard}>
									<Text fontWeight="medium">
										{t("admins.roles.standard")}
									</Text>
									<FormHelperText m={0}>
										{t("admins.roles.standardDescription")}
									</FormHelperText>
								</Radio>
								<Radio value={AdminRole.Reseller} isDisabled>
									<Text fontWeight="medium">
										{t("admins.roles.reseller")}
										<Box as="span" ml={2} fontSize="xs" color="orange.500">
											{t("common.comingSoon")}
										</Box>
									</Text>
									<FormHelperText m={0}>
										{t("admins.roles.resellerDescription")}
									</FormHelperText>
								</Radio>
								<Radio value={AdminRole.Sudo}>
									<Text fontWeight="medium">
										{t("admins.roles.sudo")}
									</Text>
									<FormHelperText m={0}>
										{t("admins.roles.sudoDescription")}
									</FormHelperText>
								</Radio>
								{canCreateFullAccess && (
									<Radio value={AdminRole.FullAccess}>
										<Text fontWeight="medium">
											{t("admins.roles.fullAccess")}
										</Text>
										<FormHelperText m={0}>
											{t("admins.roles.fullAccessDescription")}
										</FormHelperText>
									</Radio>
								)}
							</VStack>
						</RadioGroup>
					</FormControl>
				</VStack>
			</Box>
			<Box className="xray-dialog-section">
				<Text fontSize="sm" fontWeight="semibold" mb={3}>
					{t("admins.limitsSection")}
				</Text>
				<VStack spacing={4} align="stretch">
					{!isFullAccessRole && (
						<VStack align="stretch" spacing={3}>
							<Checkbox
								isChecked={usePerServiceTrafficLimits}
								onChange={(event) =>
									setValue("use_service_traffic_limits", event.target.checked, {
										shouldDirty: true,
									})
								}
							>
								{t("admins.usePerServiceTrafficLimits")}
							</Checkbox>
						</VStack>
					)}
					<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
						<FormControl isInvalid={!!errors.data_limit}>
							<FormLabel>{t("admins.dataLimit")}</FormLabel>
							<NumericInput
								placeholder={t("admins.dataLimitPlaceholder")}
								value={dataLimitValue}
								precision={0}
								isDisabled={usePerServiceTrafficLimits}
								onChange={(value) =>
									setValue("data_limit", value, {
										shouldDirty: true,
										shouldValidate: true,
									})
								}
							/>
							<FormErrorMessage>
								{errors.data_limit?.message as string}
							</FormErrorMessage>
							<Text fontSize="xs" color="gray.500" mt={1}>
								{t("admins.dataLimitHint")}
							</Text>
						</FormControl>
						<FormControl isInvalid={!!errors.users_limit}>
							<FormLabel>{t("admins.usersLimit")}</FormLabel>
							<NumericInput
								placeholder={t("admins.usersLimitPlaceholder")}
								value={usersLimitValue}
								precision={0}
								isDisabled={usePerServiceTrafficLimits}
								onChange={(value) =>
									setValue("users_limit", value, {
										shouldDirty: true,
										shouldValidate: true,
									})
								}
							/>
							<FormErrorMessage>
								{errors.users_limit?.message as string}
							</FormErrorMessage>
							<Text fontSize="xs" color="gray.500" mt={1}>
								{t("admins.usersLimitHint")}
							</Text>
						</FormControl>
					</SimpleGrid>
					{!isFullAccessRole &&
						!usePerServiceTrafficLimits &&
						(hasGlobalDataLimit || isCreatedTrafficMode) && (
							<VStack align="stretch" spacing={3}>
								<Checkbox
									isChecked={isCreatedTrafficMode}
									onChange={(event) =>
										setValue(
											"traffic_limit_mode",
											event.target.checked
												? AdminTrafficLimitMode.CreatedTraffic
												: AdminTrafficLimitMode.UsedTraffic,
											{ shouldDirty: true },
										)
									}
								>
									{t("admins.limitByCreatedTraffic")}
								</Checkbox>
								{isCreatedTrafficMode && (
									<Stack spacing={2} pl={1}>
										<Checkbox
											isChecked={Boolean(showUserTrafficValue)}
											onChange={(event) =>
												setValue("show_user_traffic", event.target.checked, {
													shouldDirty: true,
												})
											}
										>
											{t("admins.showUserTraffic")}
										</Checkbox>
										<Checkbox
											isChecked={Boolean(permissionsValue.users.delete)}
											onChange={(event) =>
												handleUserPermissionToggle(
													"delete",
													event.target.checked,
												)
											}
										>
											{t("admins.permissions.deleteUser")}
										</Checkbox>
										<Checkbox
											isChecked={Boolean(deleteUserUsageLimitEnabled)}
											isDisabled={!permissionsValue.users.delete}
											onChange={(event) =>
												setValue(
													"delete_user_usage_limit_enabled",
													event.target.checked,
													{ shouldDirty: true },
												)
											}
										>
											{t("admins.deleteUserUsageCap")}
										</Checkbox>
										{deleteUserUsageLimitEnabled && (
											<FormControl isInvalid={!!errors.delete_user_usage_limit}>
												<FormLabel>
													{t("admins.deleteUserUsageLimit")}
												</FormLabel>
												<NumericInput
													value={deleteUserUsageLimitValue}
													precision={0}
													onChange={(value) =>
														setValue("delete_user_usage_limit", value, {
															shouldDirty: true,
															shouldValidate: true,
														})
													}
												/>
												<FormErrorMessage>
													{errors.delete_user_usage_limit?.message as string}
												</FormErrorMessage>
											</FormControl>
										)}
										<Checkbox
											isChecked={Boolean(permissionsValue.users.reset_usage)}
											onChange={(event) =>
												handleUserPermissionToggle(
													"reset_usage",
													event.target.checked,
												)
											}
										>
											{t("admins.permissions.resetUsage")}
										</Checkbox>
										<Text fontSize="xs" color="gray.500">
											{t("admins.createdTrafficModeHint")}
										</Text>
									</Stack>
								)}
							</VStack>
						)}
					<FormControl>
						<FormLabel>{t("admins.expireLabel")}</FormLabel>
						<DateTimePicker
							value={adminExpireDate}
							onChange={setAdminExpireDate}
							placeholder={t("expires.selectDate")}
							minDate={new Date()}
						/>
						{adminExpireUnix && adminExpireInfo.time ? (
							<FormHelperText>
								{t(adminExpireInfo.status, { time: adminExpireInfo.time })}
							</FormHelperText>
						) : (
							<FormHelperText>
								{t("admins.expireHint")}
							</FormHelperText>
						)}
					</FormControl>
				</VStack>
			</Box>
			<Box className="xray-dialog-section admin-services-section">
				<Text fontSize="sm" fontWeight="semibold" mb={3}>
					{t("services.title")}
				</Text>
				<VStack spacing={3} align="stretch">
					<FormControl>
						<VStack align="stretch" spacing={2}>
							<HStack
								justify="space-between"
								align={{ base: "flex-start", sm: "center" }}
								spacing={3}
								flexWrap="wrap"
							>
								<Checkbox
									isChecked={
										selectedServices.length === serviceOptions.length &&
										serviceOptions.length > 0
									}
									isIndeterminate={
										selectedServices.length > 0 &&
										selectedServices.length < serviceOptions.length
									}
									onChange={handleToggleAllServices}
									isDisabled={serviceOptions.length === 0}
								>
									{t("admins.selectAllServices")}
								</Checkbox>
								<Badge borderRadius="md" variant="subtle" colorScheme="primary">
									{selectedServices.length} / {serviceOptions.length}
								</Badge>
							</HStack>
							<Input
								value={serviceSearch}
								onChange={(event) => setServiceSearch(event.target.value)}
								placeholder={t("admins.searchServices")}
								size="sm"
							/>
							<VStack
								className="admin-services-list"
								align="stretch"
								spacing={1.5}
								maxH="150px"
								overflowY="auto"
								borderWidth="1px"
								borderRadius="md"
								p={2}
							>
								{serviceOptions.length === 0 ? (
									<Text fontSize="sm" color="gray.500">
										{t("services.noServicesAvailable")}
									</Text>
								) : filteredServices.length === 0 ? (
									<Text fontSize="sm" color="gray.500">
										{t("admins.noServicesMatching")}
									</Text>
								) : (
									filteredServices.map((service) => {
										const isSelected = selectedServicesSet.has(service.id);
										return (
											<Box
												key={service.id}
												borderWidth="1px"
												borderRadius="md"
												px={2.5}
												py={2}
												borderColor={isSelected ? "primary.400" : "gray.200"}
												bg={isSelected ? "primary.50" : "transparent"}
												_hover={{
													borderColor: "primary.300",
													cursor: "pointer",
												}}
												_dark={{
													borderColor: isSelected ? "primary.300" : "gray.600",
													bg: isSelected ? "gray.700" : "transparent",
												}}
												transition="background-color 140ms var(--rb-ease-out), border-color 140ms var(--rb-ease-out), box-shadow 140ms var(--rb-ease-out), transform 120ms var(--rb-ease-out)"
												_active={{ transform: "scale(0.99)" }}
												onClick={() => handleServiceToggle(service.id)}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault();
														handleServiceToggle(service.id);
													}
												}}
												role="button"
												tabIndex={0}
											>
												<HStack
													justify="space-between"
													align="center"
													spacing={3}
												>
													<Box minW={0}>
														<Text fontWeight="medium" noOfLines={1}>
															{service.name}
														</Text>
														<Text fontSize="xs" color="gray.500">
															{t("admins.serviceStats", {
																	users: service.user_count ?? 0,
																	hosts: service.host_count ?? 0,
																})}
														</Text>
													</Box>
													{isSelected && (
														<Badge
															colorScheme="primary"
															variant="subtle"
															borderRadius="md"
															flexShrink={0}
														>
															{t("services.selected")}
														</Badge>
													)}
												</HStack>
											</Box>
										);
									})
								)}
							</VStack>
							{usePerServiceTrafficLimits && selectedServices.length > 0 && (
								<VStack align="stretch" spacing={2.5} pt={1}>
									<HStack justify="space-between" align="center">
										<Text fontWeight="semibold" fontSize="sm">
											{t("admins.perServiceLimitsTitle")}
										</Text>
										<Badge borderRadius="md" variant="subtle">
											{selectedServices.length}
										</Badge>
									</HStack>
									<VStack
										align="stretch"
										spacing={2}
										maxH="320px"
										overflowY="auto"
										pr={1}
									>
										{selectedServices.map((serviceId) => {
											const service = serviceOptions.find(
												(item) => item.id === serviceId,
											);
											const item = getServiceLimitValue(serviceId);
											const isServiceCreatedMode =
												item.traffic_limit_mode ===
												AdminTrafficLimitMode.CreatedTraffic;
											const configuredLimitBytes =
												item.data_limit && Number(item.data_limit) > 0
													? Number(item.data_limit) * GB_IN_BYTES
													: 0;
											const usageBytes = isServiceCreatedMode
												? Number(item.created_traffic ?? 0)
												: Number(item.used_traffic ?? 0);
											const remainingBytes =
												configuredLimitBytes > 0
													? Math.max(configuredLimitBytes - usageBytes, 0)
													: null;
											return (
												<Box
													key={`service-limit-${serviceId}`}
													className="admin-service-limit-card"
													borderWidth="1px"
													borderRadius="md"
													p={2.5}
												>
													<VStack align="stretch" spacing={2.5}>
														<HStack
															justify="space-between"
															align="flex-start"
															spacing={3}
														>
															<Box minW={0}>
																<Text fontWeight="medium" noOfLines={1}>
																	{service?.name ?? `#${serviceId}`}
																</Text>
																<Text color="gray.400" fontSize="xs">
																	{t("admins.deletedUserUsage")}
																	:{" "}
																	{formatBytes(
																		Number(item.deleted_users_usage ?? 0),
																		2,
																	)}
																</Text>
															</Box>
															<Text
																color="primary.200"
																fontSize="xs"
																fontWeight="medium"
																whiteSpace="nowrap"
																textAlign="end"
															>
																<Box as="span" display="block">
																	{formatBytes(usageBytes, 2)} /{" "}
																	{configuredLimitBytes > 0
																		? formatBytes(configuredLimitBytes, 2)
																		: t("nodes.unlimited")}
																</Box>
																<Box
																	as="span"
																	display="block"
																	mt={0.5}
																	color="gray.400"
																>
																	{t("myaccount.remainingData")}:{" "}
																	{remainingBytes === null
																		? t("nodes.unlimited")
																		: formatBytes(remainingBytes, 2)}
																</Box>
															</Text>
														</HStack>
														<Checkbox
															isChecked={isServiceCreatedMode}
															onChange={(event) =>
																setServiceLimitValue(serviceId, {
																	traffic_limit_mode: event.target.checked
																		? AdminTrafficLimitMode.CreatedTraffic
																		: AdminTrafficLimitMode.UsedTraffic,
																})
															}
														>
															{t("admins.limitByCreatedTraffic")}
														</Checkbox>
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={2}
														>
															<FormControl>
																<FormLabel>
																	{t("admins.dataLimit")}
																</FormLabel>
																<NumericInput
																	value={item.data_limit ?? ""}
																	precision={0}
																	size="sm"
																	onChange={(value) =>
																		setServiceLimitValue(serviceId, {
																			data_limit: value,
																		})
																	}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t("admins.usersLimit")}
																</FormLabel>
																<NumericInput
																	value={item.users_limit ?? ""}
																	precision={0}
																	size="sm"
																	onChange={(value) =>
																		setServiceLimitValue(serviceId, {
																			users_limit: value,
																		})
																	}
																/>
															</FormControl>
														</SimpleGrid>
														{isServiceCreatedMode && (
															<Stack spacing={1.5}>
																<Checkbox
																	isChecked={item.show_user_traffic}
																	onChange={(event) =>
																		setServiceLimitValue(serviceId, {
																			show_user_traffic: event.target.checked,
																		})
																	}
																>
																	{t("admins.showUserTraffic")}
																</Checkbox>
																<Checkbox
																	isChecked={
																		permissionsValue.users.delete &&
																		item.delete_user_usage_limit_enabled
																	}
																	isDisabled={!permissionsValue.users.delete}
																	onChange={(event) =>
																		setServiceLimitValue(serviceId, {
																			delete_user_usage_limit_enabled:
																				event.target.checked,
																		})
																	}
																>
																	{t("admins.deleteUserUsageCap")}
																</Checkbox>
																{item.delete_user_usage_limit_enabled && (
																	<FormControl>
																		<FormLabel>
																			{t("admins.deleteUserUsageLimit")}
																		</FormLabel>
																		<NumericInput
																			value={item.delete_user_usage_limit ?? ""}
																			precision={0}
																			size="sm"
																			onChange={(value) =>
																				setServiceLimitValue(serviceId, {
																					delete_user_usage_limit: value,
																				})
																			}
																		/>
																	</FormControl>
																)}
															</Stack>
														)}
													</VStack>
												</Box>
											);
										})}
									</VStack>
								</VStack>
							)}
						</VStack>
						<FormHelperText>
							{t("admins.servicesHelper")}
						</FormHelperText>
					</FormControl>
				</VStack>
			</Box>
		</VStack>
	);

	const permissionsPanel = (
		<VStack align="stretch" spacing={4}>
			<AdminPermissionsEditor
				value={permissionsValue ?? clonePermissions(watchRole ?? AdminRole.Standard)}
				onChange={handlePermissionsChange}
				showReset
				onReset={resetPermissionsToRole}
				maxDataLimitValue={maxDataLimitValue}
				onMaxDataLimitChange={handleMaxDataLimitChange}
				maxDataLimitError={
					errors.maxDataLimitPerUserGb?.message as string | undefined
				}
				hideExtendedSections={watchRole === AdminRole.Standard}
				isReadOnly={watchRole === AdminRole.FullAccess}
			/>
			{canManage2FA && (
				<Box className="xray-dialog-section">
					<Checkbox
						isChecked={watch("require_2fa")}
						onChange={(event) =>
							setValue("require_2fa", event.target.checked, {
								shouldDirty: true,
							})
						}
					>
						{t("admins.security.require2FA")}
					</Checkbox>
				</Box>
			)}
		</VStack>
	);

	return (
		<>
			<Modal
				isOpen={isOpen}
				onClose={handleCloseAdminDialog}
				size="3xl"
				scrollBehavior="inside"
			>
				<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
				<XrayModalContent
					mx="3"
					sx={{
						".admin-services-section .chakra-form-control": {
							display: "block",
							gridTemplateColumns: "none",
						},
						".admin-services-section .chakra-form__label": {
							mb: 1,
						},
						".admin-services-section .chakra-form__helper-text, .admin-services-section .chakra-form__error-message":
							{
								gridColumn: "auto",
							},
						".admin-services-section .chakra-simple-grid": {
							gridTemplateColumns: {
								base: "1fr",
								md: "repeat(2, minmax(0, 1fr))",
							},
						},
						".admin-services-section .chakra-checkbox__label": {
							fontSize: "13px",
						},
						".admin-service-limit-card .chakra-form-control": {
							display: "block",
							gridTemplateColumns: "none",
						},
					}}
				>
					<XrayModalHeader dir={isRTL ? "rtl" : "ltr"}>
						{mode === "create"
							? t("admins.addAdminTitle")
							: t("admins.editAdminTitle")}
					</XrayModalHeader>
					<ModalCloseButton />
					<XrayModalBody>
						<Tabs
							className="xray-dialog-auto-sections"
							variant="unstyled"
							isLazy
							w="full"
						>
							<TabList>
								<Tab>{t("details")}</Tab>
								<Tab>{t("admins.permissionsTabLabel")}</Tab>
							</TabList>
							<TabPanels>
								<TabPanel px={0}>{detailsForm}</TabPanel>
								<TabPanel px={0}>{permissionsPanel}</TabPanel>
							</TabPanels>
						</Tabs>
					</XrayModalBody>
					<XrayModalFooter>
						<HStack
							spacing={3}
							w="full"
							justify="flex-end"
							flexWrap="wrap"
						>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleCloseAdminDialog}
							>
								{t("cancel")}
							</Button>
							<AnimatedSubmitButton
								onClick={handleFormSubmit}
								status={submitStatus}
								idleContent={
									mode === "create"
										? t("admins.addAdmin")
										: t("save")
								}
								successLabel={t("userDialog.submitSuccess")}
								isDisabled={isSubmitting}
								containerProps={{
									w: { base: "full", sm: "180px" },
								}}
							/>
						</HStack>
					</XrayModalFooter>
				</XrayModalContent>
			</Modal>
			<AdminPermissionsModal
				isOpen={permissionsModalOpen}
				onClose={() => setPermissionsModalOpen(false)}
				admin={admin}
			/>
		</>
	);
};
