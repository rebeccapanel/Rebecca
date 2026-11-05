import { toast } from "components/ui/sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitStatus, useSubmitTimers } from "hooks/useSubmitTimers";
import dayjs from "dayjs";
import { Eye, EyeOff, Search, ShieldPlus, Sparkles, UserPen } from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { EntityNotePanel } from "components/EntityNotePanel";
import { buttonVariants } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { DateTimeField } from "components/ui/date-time-field";
import { DataSizeField } from "components/ui/data-size-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { adminEntityPage } from "components/entityPage/EntityOverviews";
import { FormField } from "components/ui/form-field";
import { Input } from "components/ui/input";
import { CheckRow } from "components/ui/check-row";
import { NumberField } from "components/ui/number-field";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { AdminHistoryPanel } from "components/admins/AdminHistoryPanel";
import { getDefaultPermissionsForRole } from "constants/adminPermissions";
import type { AdminDialogTab } from "contexts/AdminsContext";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { cn } from "lib/cn";
import { fetch } from "service/http";
import type { AdminCreatePayload, AdminPermissions, AdminUpdatePayload } from "types/Admin";
import { AdminRole, AdminStatus, AdminTrafficLimitMode } from "types/Admin";
import type { ServiceSummary } from "types/Service";
import { copyTextToClipboard } from "utils/clipboard";
import { relativeExpiryDate } from "utils/dateFormatter";
import { addQuickExpiry } from "utils/expiry";
import { formatBytes } from "utils/formatByte";
import { matchesSearch } from "utils/searchMatch";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { GroupSelect } from "components/labels/GroupSelect";
import AdminPermissionsEditor from "./AdminPermissionsEditor";

const GB_IN_BYTES = 1024 * 1024 * 1024;
const MB_IN_BYTES = 1024 * 1024;
const SUCCESS_CLOSE_DELAY_MS = 1000;
const DEFAULT_MATCH = { matchCase: false, matchWholeWord: false } as const;

const clonePermissions = (role: AdminRole): AdminPermissions => getDefaultPermissionsForRole(role);

const formatBytesToGbString = (value?: number | null) =>
	value && value > 0 ? String(Math.floor(value / GB_IN_BYTES)) : "";

const adminPermissionsSchema: z.ZodType<AdminPermissions> = z.object({
	users: z.object({
		create: z.boolean(),
		delete: z.boolean(),
		reset_usage: z.boolean(),
		periodic_usage_reset: z.boolean(),
		revoke: z.boolean(),
		create_on_hold: z.boolean(),
		allow_unlimited_data: z.boolean(),
		allow_unlimited_expire: z.boolean(),
		allow_next_plan: z.boolean(),
		advanced_actions: z.boolean(),
		set_flow: z.boolean(),
		allow_custom_key: z.boolean(),
		max_data_limit_per_user: z.number().nullable(),
		min_data_limit_per_user: z.number().nullable(),
		manage_speed_limit: z.boolean(),
		manage_ip_limit: z.boolean(),
		max_speed_limit_per_user: z.number().nullable(),
		max_ip_limit_per_user: z.number().nullable(),
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
		self_placeholders: z.boolean(),
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
		notes: z.boolean(),
	}),
});

type ServiceLimit = {
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
};

type AdminFormValues = {
	username: string;
	password?: string;
	group_id?: number | null;
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
	minDataLimitPerUserGb?: string;
	maxSpeedLimitPerUserMbps?: string;
	maxIPLimitPerUser?: string;
	data_limit?: string;
	users_limit?: string;
	services?: number[];
	service_limits?: Record<number, ServiceLimit>;
};

/** A checkbox with its text, the whole line is the click target. */
export const AdminDialog: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const { userData } = useGetUser();
	const canCreateFullAccess = userData.role === AdminRole.FullAccess;
	const canManage2FA = canCreateFullAccess || Boolean(userData.permissions.admin_management.manage_2fa);
	
	const admins = useAdminsStore((state) => state.admins);
	const adminFromStore = useAdminsStore((state) => state.adminInDialog);
	const isOpen = useAdminsStore((state) => state.isAdminDialogOpen);
	const initialTab = useAdminsStore((state) => state.adminDialogInitialTab);
	const closeAdminDialog = useAdminsStore((state) => state.closeAdminDialog);
	const createAdmin = useAdminsStore((state) => state.createAdmin);
	const fetchAdmins = useAdminsStore((state) => state.fetchAdmins);
	const updateAdmin = useAdminsStore((state) => state.updateAdmin);
	const admin = useMemo(() => {
		if (!adminFromStore) return null;
		return admins.find((item) => item.username === adminFromStore.username) ?? adminFromStore;
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
	const statusLabel = admin ? (statusLabels[admin.status] ?? admin.status) : t("admins.statusNew");

	const schema = useMemo(() => {
		const base = z
			.object({
				username:
					mode === "create"
						? z.string().trim().min(3, { message: t("admins.validation.usernameMin") })
						: z.string().optional(),
				password: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine((value) => !value || value.length >= 6, t("admins.validation.passwordMin")),
				group_id: z.number().nullable().optional(),
				telegram_id: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine((value) => value === undefined || /^\d+$/.test(value), t("admins.validation.telegramNumeric")),
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
					.refine((value) => value === undefined || /^\d+$/.test(value), t("admins.validation.deleteLimitNumeric")),
				data_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine((value) => value === undefined || /^\d+(\.\d+)?$/.test(value), t("admins.validation.dataLimitNumeric")),
				users_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine((value) => value === undefined || /^\d+$/.test(value), t("admins.validation.usersLimitNumeric")),
				maxSpeedLimitPerUserMbps: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				maxIPLimitPerUser: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				maxDataLimitPerUserGb: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				minDataLimitPerUserGb: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				permissions: adminPermissionsSchema,
				services: z.array(z.number()).optional(),
				service_limits: z.record(z.string(), z.any()).optional(),
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
		resolver: zodResolver(schema as unknown as Parameters<typeof zodResolver>[0]) as unknown as Resolver<AdminFormValues>,
		defaultValues: {
			username: "",
			password: "",
			group_id: null,
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
			minDataLimitPerUserGb: "",
			maxSpeedLimitPerUserMbps: "",
			maxIPLimitPerUser: "",
			data_limit: "",
			users_limit: "",
			services: [],
			service_limits: {},
		},
	});

	const { register, handleSubmit, reset, formState, setValue, getValues, watch, setError } = form;
	const [activeTab, setActiveTab] = useState<AdminDialogTab>("details");
	const [showPassword, setShowPassword] = useState(false);
	const [serviceOptions, setServiceOptions] = useState<ServiceSummary[]>([]);
	const [serviceSearch, setServiceSearch] = useState("");
	const [adminExpireDate, setAdminExpireDate] = useState<Date | null>(null);
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
	const { closeTimerRef: successCloseTimerRef, clearSubmitTimers, showSubmitError } = useSubmitTimers(setSubmitStatus);
	const adminExpireUnix = useMemo(() => (adminExpireDate ? dayjs(adminExpireDate).utc().unix() : null), [adminExpireDate]);
	const adminExpireInfo = useMemo(() => relativeExpiryDate(adminExpireUnix ?? null), [adminExpireUnix]);

	const filteredServices = useMemo(() => {
		if (!serviceSearch.trim()) return serviceOptions;
		return serviceOptions.filter((service) => matchesSearch(service.name, serviceSearch, DEFAULT_MATCH));
	}, [serviceOptions, serviceSearch]);

	const selectedServices = watch("services") || [];
	const selectedServicesSet = useMemo(() => new Set(selectedServices), [selectedServices]);
	const { errors, isSubmitting } = formState;
	const watchRole = watch("role");
	const watchTrafficLimitMode = watch("traffic_limit_mode");
	const watchUseServiceTrafficLimits = watch("use_service_traffic_limits");
	const permissionsValue = watch("permissions");
	const showUserTrafficValue = watch("show_user_traffic");
	const deleteUserUsageLimitEnabled = watch("delete_user_usage_limit_enabled");
	const serviceLimitsValue = watch("service_limits") ?? {};
	const telegramIdValue = watch("telegram_id") ?? "";
	const deleteUserUsageLimitValue = watch("delete_user_usage_limit") ?? "";
	const dataLimitValue = watch("data_limit") ?? "";
	const usersLimitValue = watch("users_limit") ?? "";
	const maxDataLimitValue = watch("maxDataLimitPerUserGb") ?? "";
	const minDataLimitValue = watch("minDataLimitPerUserGb") ?? "";
	const maxSpeedLimitValue = watch("maxSpeedLimitPerUserMbps") ?? "";
	const maxIPLimitValue = watch("maxIPLimitPerUser") ?? "";
	const parsedGlobalDataLimit = Number(dataLimitValue);
	const hasGlobalDataLimit =
		String(dataLimitValue).trim().length > 0 && Number.isFinite(parsedGlobalDataLimit) && parsedGlobalDataLimit > 0;
	const isFullAccessRole = watchRole === AdminRole.FullAccess;
	const isCreatedTrafficMode = watchTrafficLimitMode === AdminTrafficLimitMode.CreatedTraffic;
	const usePerServiceTrafficLimits = Boolean(watchUseServiceTrafficLimits);
	const roleDescriptionKeys: Record<string, string> = {
		[AdminRole.Standard]: "admins.roles.standardDescription",
		[AdminRole.Reseller]: "admins.roles.resellerDescription",
		[AdminRole.Sudo]: "admins.roles.sudoDescription",
		[AdminRole.FullAccess]: "admins.roles.fullAccessDescription",
	};

	const getServiceLimitValue = useCallback(
		(serviceId: number): ServiceLimit =>
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
		(serviceId: number, patch: Partial<ServiceLimit>) => {
			const current = getValues("service_limits") ?? {};
			setValue(
				"service_limits",
				{ ...current, [serviceId]: { ...getServiceLimitValue(serviceId), ...patch } },
				{ shouldDirty: true },
			);
		},
		[getServiceLimitValue, getValues, setValue],
	);

	const generateRandomString = useCallback((length: number) => {
		const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
			const randomValues = new Uint32Array(length);
			window.crypto.getRandomValues(randomValues);
			return Array.from(randomValues, (value) => characters[value % characters.length]).join("");
		}
		return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
	}, []);

	const handleGenerateUsername = useCallback(() => {
		if (mode === "edit") return;
		setValue("username", generateRandomString(8), { shouldDirty: true, shouldValidate: true });
	}, [generateRandomString, mode, setValue]);

	const handleGeneratePassword = useCallback(() => {
		const password = generateRandomString(12);
		setValue("password", password, { shouldDirty: true, shouldValidate: true });
		void copyTextToClipboard(password)
			.then(() => toast.success(t("copied")))
			.catch(() => undefined);
	}, [generateRandomString, setValue, t, toast]);

	const handleServiceToggle = (serviceId: number) => {
		const next = selectedServicesSet.has(serviceId)
			? selectedServices.filter((id) => id !== serviceId)
			: [...selectedServices, serviceId];
		setValue("services", next, { shouldDirty: true, shouldValidate: true });
	};

	const handleToggleAllServices = (checked: boolean) => {
		setValue("services", checked ? serviceOptions.map((service) => service.id) : [], {
			shouldDirty: true,
			shouldValidate: true,
		});
	};

	const handleCloseAdminDialog = useCallback(() => {
		clearSubmitTimers();
		setSubmitStatus("idle");
		closeAdminDialog();
	}, [clearSubmitTimers, closeAdminDialog]);

	const resetPermissionsToRole = useCallback(() => {
		setValue("permissions", clonePermissions(watchRole ?? AdminRole.Standard), { shouldDirty: true });
		setValue("maxDataLimitPerUserGb", "", { shouldDirty: true });
		setValue("minDataLimitPerUserGb", "", { shouldDirty: true });
		setValue("maxSpeedLimitPerUserMbps", "", { shouldDirty: true });
		setValue("maxIPLimitPerUser", "", { shouldDirty: true });
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
				{ ...permissionsValue, users: { ...permissionsValue.users, [key]: next } },
				{ shouldDirty: true },
			);
		},
		[permissionsValue, setValue],
	);

	const handleMaxSpeedLimitChange = useCallback(
		(value: string) => setValue("maxSpeedLimitPerUserMbps", value, { shouldDirty: true }),
		[setValue],
	);
	const handleMaxIPLimitChange = useCallback(
		(value: string) => setValue("maxIPLimitPerUser", value, { shouldDirty: true }),
		[setValue],
	);
	const handleMaxDataLimitChange = useCallback(
		(value: string) => setValue("maxDataLimitPerUserGb", value, { shouldDirty: true }),
		[setValue],
	);

	const handleMinDataLimitChange = useCallback(
		(value: string) => {
			setValue("minDataLimitPerUserGb", value, { shouldDirty: true });
		},
		[setValue],
	);

	useEffect(() => {
		register("maxDataLimitPerUserGb");
		register("minDataLimitPerUserGb");
		register("maxSpeedLimitPerUserMbps");
		register("maxIPLimitPerUser");
		register("permissions");
		register("services");
		register("service_limits");
	}, [register]);

	useEffect(() => {
		if (!isOpen) {
			setAdminExpireDate(null);
			return;
		}
		if (adminFromStore) {
			setAdminExpireDate(typeof adminFromStore.expire === "number" && adminFromStore.expire > 0 ? dayjs.unix(adminFromStore.expire).toDate() : null);
			return;
		}
		setAdminExpireDate(null);
	}, [adminFromStore, isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		setActiveTab(initialTab);
		fetch<{ services: ServiceSummary[]; total?: number }>("/v2/services", { query: { limit: 500 } })
			.then((resp) => {
				const list = Array.isArray((resp as any).services)
					? (resp as any).services
					: Array.isArray(resp)
						? (resp as any)
						: [];
				setServiceOptions(list);
			})
			.catch(() => setServiceOptions([]));
		setServiceSearch("");

		const nextRole: AdminRole = adminFromStore?.role ?? AdminRole.Standard;
		const storedPermissions: AdminPermissions | null = adminFromStore?.permissions
			? JSON.parse(JSON.stringify(adminFromStore.permissions))
			: null;
		const nextPermissions = storedPermissions?.users ? storedPermissions : clonePermissions(nextRole);
		reset({
			username: adminFromStore?.username ?? "",
			password: "",
			group_id: adminFromStore?.group?.id ?? null,
			telegram_id: adminFromStore?.telegram_id !== undefined && adminFromStore?.telegram_id !== null ? String(adminFromStore.telegram_id) : "",
			role: nextRole,
			require_2fa: adminFromStore?.require_2fa ?? false,
			traffic_limit_mode: adminFromStore?.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
			use_service_traffic_limits: adminFromStore?.use_service_traffic_limits ?? false,
			show_user_traffic: adminFromStore?.show_user_traffic ?? true,
			delete_user_usage_limit_enabled: adminFromStore?.delete_user_usage_limit_enabled ?? false,
			delete_user_usage_limit:
				adminFromStore?.delete_user_usage_limit !== undefined && adminFromStore?.delete_user_usage_limit !== null
					? String(Math.floor(adminFromStore.delete_user_usage_limit / MB_IN_BYTES))
					: "",
			permissions: nextPermissions,
			maxSpeedLimitPerUserMbps: nextPermissions.users.max_speed_limit_per_user
				? String(nextPermissions.users.max_speed_limit_per_user / 1000)
				: "",
			maxIPLimitPerUser: nextPermissions.users.max_ip_limit_per_user
				? String(nextPermissions.users.max_ip_limit_per_user)
				: "",
			maxDataLimitPerUserGb: formatBytesToGbString(nextPermissions.users.max_data_limit_per_user),
			minDataLimitPerUserGb: formatBytesToGbString(nextPermissions.users.min_data_limit_per_user),
			data_limit: adminFromStore?.data_limit !== undefined && adminFromStore?.data_limit !== null ? String(Math.round((adminFromStore.data_limit / GB_IN_BYTES) * 1e9) / 1e9) : "",
			users_limit: adminFromStore?.users_limit !== undefined && adminFromStore?.users_limit !== null ? String(adminFromStore.users_limit) : "",
			services: adminFromStore?.services ?? [],
			service_limits: Object.fromEntries(
				(adminFromStore?.service_limits ?? []).map((item) => [
					item.service_id,
					{
						traffic_limit_mode: item.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
						data_limit:
							item.data_limit !== undefined && item.data_limit !== null
								? String(Math.floor(item.data_limit / GB_IN_BYTES))
								: "",
						show_user_traffic: item.show_user_traffic ?? true,
						users_limit: item.users_limit !== undefined && item.users_limit !== null ? String(item.users_limit) : "",
						created_traffic: Number(item.created_traffic ?? 0),
						used_traffic: Number(item.used_traffic ?? 0),
						lifetime_used_traffic: Number(item.lifetime_used_traffic ?? 0),
						deleted_users_usage: Number(item.deleted_users_usage ?? 0),
						delete_user_usage_limit_enabled: item.delete_user_usage_limit_enabled ?? false,
						delete_user_usage_limit:
							item.delete_user_usage_limit !== undefined && item.delete_user_usage_limit !== null
								? String(Math.floor(item.delete_user_usage_limit / MB_IN_BYTES))
								: "",
					},
				]),
			),
		});
	}, [adminFromStore, initialTab, isOpen, reset]);

	useEffect(() => {
		if (watchRole === AdminRole.FullAccess) {
			setValue("traffic_limit_mode", AdminTrafficLimitMode.UsedTraffic, { shouldDirty: true });
			setValue("use_service_traffic_limits", false, { shouldDirty: true });
			setValue("show_user_traffic", true, { shouldDirty: true });
			setValue("delete_user_usage_limit_enabled", false, { shouldDirty: true });
		}
	}, [setValue, watchRole]);

	useEffect(() => {
		if (!permissionsValue.users.delete) {
			setValue("delete_user_usage_limit_enabled", false, { shouldDirty: true });
		}
	}, [permissionsValue.users.delete, setValue]);

	useEffect(() => {
		if (isOpen) {
			setSubmitStatus("idle");
			clearSubmitTimers();
		}
	}, [clearSubmitTimers, isOpen]);

	const handleFormSubmit = handleSubmit(
		async (values) => {
			if (submitStatus !== "idle") return;
			clearSubmitTimers();
			setSubmitStatus("loading");
			const selectedRole: AdminRole = values.role ?? AdminRole.Standard;
			let permissionPayload: AdminPermissions | undefined;
			if (selectedRole === AdminRole.Reseller) {
				toast.warning(t("common.comingSoon"), { description: t("admins.roles.resellerDescription") });
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
						setError("maxDataLimitPerUserGb", { type: "manual", message: t("admins.validation.invalidMaxDataLimit") });
						showSubmitError();
						throw new Error("invalid_max_data_limit");
					}
					computedPermissions.users.max_data_limit_per_user = parsed === 0 ? null : Math.round(parsed * GB_IN_BYTES);
				} else {
					computedPermissions.users.max_data_limit_per_user = null;
				}
				const minLimitInput = values.minDataLimitPerUserGb?.trim();
				if (minLimitInput) {
					const parsedMin = Number(minLimitInput);
					if (Number.isNaN(parsedMin) || parsedMin < 0) {
						setError("minDataLimitPerUserGb", {
							type: "manual",
							message: t("admins.validation.invalidMinDataLimit"),
						});
						showSubmitError();
						throw new Error("invalid_min_data_limit");
					}
					computedPermissions.users.min_data_limit_per_user =
						parsedMin === 0 ? null : Math.round(parsedMin * GB_IN_BYTES);
				} else {
					computedPermissions.users.min_data_limit_per_user = null;
				}
				const minDataLimitBytes = computedPermissions.users.min_data_limit_per_user;
				const maxDataLimitBytes = computedPermissions.users.max_data_limit_per_user;
				if (minDataLimitBytes && maxDataLimitBytes && minDataLimitBytes > maxDataLimitBytes) {
					setError("minDataLimitPerUserGb", {
						type: "manual",
						message: t("admins.validation.minAboveMax"),
					});
					showSubmitError();
					throw new Error("invalid_min_data_limit");
				}
				const speedInput = values.maxSpeedLimitPerUserMbps?.trim();
				if (speedInput) {
					const parsedSpeed = Number(speedInput);
					if (Number.isNaN(parsedSpeed) || parsedSpeed < 0) {
						setError("maxSpeedLimitPerUserMbps", { type: "manual", message: t("admins.validation.invalidMaxSpeedLimit") });
						showSubmitError();
						throw new Error("invalid_max_speed_limit");
					}
					computedPermissions.users.max_speed_limit_per_user = parsedSpeed === 0 ? null : Math.round(parsedSpeed * 1000);
				} else {
					computedPermissions.users.max_speed_limit_per_user = null;
				}
				const ipInput = values.maxIPLimitPerUser?.trim();
				if (ipInput) {
					const parsedIP = Number(ipInput);
					if (Number.isNaN(parsedIP) || parsedIP < 0) {
						setError("maxIPLimitPerUser", { type: "manual", message: t("admins.validation.invalidMaxIPLimit") });
						showSubmitError();
						throw new Error("invalid_max_ip_limit");
					}
					computedPermissions.users.max_ip_limit_per_user = parsedIP === 0 ? null : Math.floor(parsedIP);
				} else {
					computedPermissions.users.max_ip_limit_per_user = null;
				}
				return computedPermissions;
			};

			if (mode === "create" || selectedRole !== AdminRole.FullAccess) {
				try {
					permissionPayload = buildPermissionsPayload();
				} catch (error) {
					if (
						["invalid_max_data_limit", "invalid_min_data_limit", "invalid_max_speed_limit", "invalid_max_ip_limit"].includes(
							(error as Error).message,
						)
					) {
						return;
					}
					throw error;
				}
			}

			if (mode === "edit" && admin) {
				const currentActive = admin.active_users ?? 0;
				if (values.users_limit) {
					const requestedLimit = Number(values.users_limit);
					if (!Number.isNaN(requestedLimit) && requestedLimit > 0 && requestedLimit < currentActive) {
						setError("users_limit", {
							type: "manual",
							message: t("admins.validation.usersLimitTooLow", { active: currentActive }),
						});
						showSubmitError();
						return;
					}
				}
			}
			try {
				const expireValue = adminExpireDate ? dayjs(adminExpireDate).utc().unix() : null;
				const buildServiceLimitPayload = () =>
					(values.services ?? []).map((serviceId) => {
						const item = values.service_limits?.[serviceId];
						return {
							service_id: serviceId,
							traffic_limit_mode: item?.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
							data_limit: item?.data_limit ? Number(item.data_limit) * GB_IN_BYTES : null,
							show_user_traffic: item?.show_user_traffic ?? true,
							users_limit: item?.users_limit ? Number(item.users_limit) : null,
							delete_user_usage_limit_enabled: Boolean(
								permissionsValue.users.delete && item?.delete_user_usage_limit_enabled,
							),
							delete_user_usage_limit: item?.delete_user_usage_limit
								? Number(item.delete_user_usage_limit) * MB_IN_BYTES
								: null,
						};
					});
				const requestedServices = values.services ?? [];
				const serviceLimitPayload = values.use_service_traffic_limits ? buildServiceLimitPayload() : undefined;
				const globalDataLimit = values.data_limit ? Math.round(Number(values.data_limit) * GB_IN_BYTES) : null;
				const globalUsersLimit = values.users_limit ? Number(values.users_limit) : null;
				const globalDeleteUserUsageLimit = values.delete_user_usage_limit
					? Number(values.delete_user_usage_limit) * MB_IN_BYTES
					: null;
				const isFullAccess = selectedRole === AdminRole.FullAccess;

				const sharedPayload = {
					services: values.services || [],
					telegram_id: values.telegram_id ? Number(values.telegram_id) : undefined,
					data_limit: values.use_service_traffic_limits ? undefined : globalDataLimit,
					traffic_limit_mode:
						isFullAccess || values.use_service_traffic_limits ? undefined : values.traffic_limit_mode,
					use_service_traffic_limits: isFullAccess ? undefined : values.use_service_traffic_limits,
					show_user_traffic: isFullAccess ? undefined : values.show_user_traffic,
					delete_user_usage_limit_enabled: isFullAccess
						? undefined
						: Boolean(permissionsValue.users.delete && values.delete_user_usage_limit_enabled),
					delete_user_usage_limit: globalDeleteUserUsageLimit,
					expire: expireValue,
					users_limit: values.use_service_traffic_limits ? undefined : globalUsersLimit,
				};

				const initialGroupId = admin?.group?.id ?? null;
				const nextGroupId = values.group_id ?? null;
				const groupPayload =
					mode === "create"
						? nextGroupId !== null
							? { group_id: nextGroupId }
							: {}
						: nextGroupId !== initialGroupId
							? { group_id: nextGroupId }
							: {};

				if (mode === "create") {
					const payload: AdminCreatePayload = {
						...groupPayload,
						username: values.username.trim(),
						password: values.password ?? "",
						role: selectedRole,
						require_2fa: canManage2FA ? values.require_2fa : undefined,
						permissions: permissionPayload ?? clonePermissions(selectedRole),
						...sharedPayload,
					};
					const createdAdmin = await createAdmin(payload);
					let shouldFetch = true;
					let serviceSyncError: unknown = null;
					if (!isFullAccess && values.use_service_traffic_limits) {
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
						const missingServices = requestedServices.filter((serviceId) => !createdServices.has(serviceId));
						const needsSync = missingServices.length > 0 || createdServices.size !== requestedServices.length;
						if (needsSync) {
							try {
								await updateAdmin(createdAdmin.username, { services: requestedServices });
								shouldFetch = false;
							} catch (error) {
								serviceSyncError = error;
							}
						}
					}
					if (shouldFetch) {
						await fetchAdmins(undefined, { force: true });
					}
					generateSuccessMessage(t("admins.createSuccess"), toast);
					if (serviceSyncError) {
						generateErrorMessage(serviceSyncError, toast);
					}
				} else if (admin) {
					const payload: AdminUpdatePayload = {
						...groupPayload,
						role: selectedRole,
						require_2fa: canManage2FA ? values.require_2fa : undefined,
						permissions: isFullAccess ? undefined : permissionPayload,
						...sharedPayload,
						service_limits: serviceLimitPayload,
					};
					if (values.password) {
						payload.password = values.password;
					}
					await updateAdmin(admin.username, payload);
					generateSuccessMessage(t("admins.updateSuccess"), toast);
				}
				setSubmitStatus("success");
				successCloseTimerRef.current = window.setTimeout(() => {
					successCloseTimerRef.current = null;
					handleCloseAdminDialog();
				}, SUCCESS_CLOSE_DELAY_MS);
			} catch (error) {
				generateErrorMessage(error, toast, form);
				showSubmitError();
			}
		},
		() => {
			if (submitStatus !== "idle") return;
			showSubmitError();
		},
	);

	const serviceLimitCards = usePerServiceTrafficLimits
		? selectedServices.map((serviceId) => {
				const service = serviceOptions.find((item) => item.id === serviceId);
				const item = getServiceLimitValue(serviceId);
				const isCreated = item.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic;
				const limitBytes = item.data_limit && Number(item.data_limit) > 0 ? Number(item.data_limit) * GB_IN_BYTES : 0;
				const usageBytes = isCreated ? Number(item.created_traffic ?? 0) : Number(item.used_traffic ?? 0);
				const remainingBytes = limitBytes > 0 ? Math.max(limitBytes - usageBytes, 0) : null;
				return (
					<div key={`service-limit-${serviceId}`} className="flex flex-col gap-3 rounded-md border p-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{service?.name ?? `#${serviceId}`}</p>
								<p className="text-xs text-muted-foreground">
									{t("admins.deletedUserUsage")}: {formatBytes(Number(item.deleted_users_usage ?? 0), 2)}
								</p>
							</div>
							<div className="shrink-0 text-end text-xs">
								<p className="font-medium">
									{formatBytes(usageBytes, 2)} / {limitBytes > 0 ? formatBytes(limitBytes, 2) : t("nodes.unlimited")}
								</p>
								<p className="text-muted-foreground">
									{t("myaccount.remainingData")}:{" "}
									{remainingBytes === null ? t("nodes.unlimited") : formatBytes(remainingBytes, 2)}
								</p>
							</div>
						</div>
						<CheckRow
							checked={isCreated}
							onChange={(next) =>
								setServiceLimitValue(serviceId, {
									traffic_limit_mode: next
										? AdminTrafficLimitMode.CreatedTraffic
										: AdminTrafficLimitMode.UsedTraffic,
								})
							}
						>
							{t("admins.limitByCreatedTraffic")}
						</CheckRow>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<FormField label={t("admins.dataLimit")}>
								<NumberField
									inputMode="numeric"
									unit="GB"
									value={item.data_limit ?? ""}
									onChange={(raw) => setServiceLimitValue(serviceId, { data_limit: raw })}
								/>
							</FormField>
							<FormField label={t("admins.usersLimit")}>
								<NumberField
									inputMode="numeric"
									value={item.users_limit ?? ""}
									onChange={(raw) => setServiceLimitValue(serviceId, { users_limit: raw })}
								/>
							</FormField>
						</div>
						{isCreated ? (
							<div className="flex flex-col gap-2 ps-1">
								<CheckRow
									checked={item.show_user_traffic}
									onChange={(next) => setServiceLimitValue(serviceId, { show_user_traffic: next })}
								>
									{t("admins.showUserTraffic")}
								</CheckRow>
								<CheckRow
									checked={Boolean(permissionsValue.users.delete && item.delete_user_usage_limit_enabled)}
									disabled={!permissionsValue.users.delete}
									onChange={(next) => setServiceLimitValue(serviceId, { delete_user_usage_limit_enabled: next })}
								>
									{t("admins.deleteUserUsageCap")}
								</CheckRow>
								{item.delete_user_usage_limit_enabled ? (
									<FormField label={t("admins.deleteUserUsageLimit")}>
										<NumberField
											inputMode="numeric"
											value={item.delete_user_usage_limit ?? ""}
											onChange={(raw) => setServiceLimitValue(serviceId, { delete_user_usage_limit: raw })}
										/>
									</FormField>
								) : null}
							</div>
						) : null}
					</div>
				);
			})
		: null;

	const detailsTab = (
		<div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
			<FormField
				label={t("username")}
				htmlFor="admin-username"
				error={errors.username?.message as string | undefined}
				className={cn(mode === "create" && "sm:col-span-2")}
			>
				<div className="relative">
					<Input
						id="admin-username"
						dir={isRTL ? "rtl" : "ltr"}
						placeholder={t("admins.usernamePlaceholder")}
						disabled={mode === "edit"}
						className={cn(mode === "create" && "pe-10")}
						{...register("username")}
					/>
					{mode === "create" ? (
						<button
							type="button"
							aria-label={t("admins.generateUsername")}
							title={t("admins.generateUsername")}
							onClick={handleGenerateUsername}
							className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "absolute inset-y-0.5 end-0.5")}
						>
							<Sparkles />
						</button>
					) : null}
				</div>
			</FormField>

			{mode === "edit" ? (
				<FormField label={t("status")}>
					<div className="flex h-9 items-center rounded-md border px-3">
						<Badge variant="outline">{statusLabel}</Badge>
					</div>
				</FormField>
			) : null}

			<FormField
				label={t("password")}
				htmlFor="admin-password"
				error={errors.password?.message as string | undefined}
				className="sm:col-span-2"
			>
				<div className="flex items-start gap-2">
					<div className="relative min-w-0 flex-1">
						<Input
							id="admin-password"
							type={showPassword ? "text" : "password"}
							placeholder={mode === "edit" ? t("admins.passwordOptionalHint") : t("admins.passwordPlaceholder")}
							className="pe-10"
							{...register("password")}
						/>
						<button
							type="button"
							aria-label={showPassword ? t("admins.hidePassword") : t("admins.showPassword")}
							onClick={() => setShowPassword((current) => !current)}
							className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "absolute inset-y-0.5 end-0.5")}
						>
							{showPassword ? <EyeOff /> : <Eye />}
						</button>
					</div>
					<button
						type="button"
						aria-label={t("admins.generatePassword")}
						title={t("admins.generatePassword")}
						onClick={handleGeneratePassword}
						className={buttonVariants({ variant: "outline", size: "icon" })}
					>
						<Sparkles />
					</button>
				</div>
			</FormField>

			<FormField label={t("groups.group")}>
				<GroupSelect
					type="admin"
					value={watch("group_id") ?? null}
					onChange={(next) => setValue("group_id", next, { shouldDirty: true })}
				/>
			</FormField>

			<FormField label={t("admins.telegramId")} htmlFor="admin-telegram" error={errors.telegram_id?.message as string | undefined}>
				<Input
					id="admin-telegram"
					dir="ltr"
					inputMode="numeric"
					value={telegramIdValue}
					{...register("telegram_id")}
				/>
			</FormField>

			<FormField
				label={t("admins.roleLabel")}
				description={t(roleDescriptionKeys[watchRole ?? AdminRole.Standard] ?? "admins.roles.standardDescription")}
			>
				<Select
					value={watchRole ?? AdminRole.Standard}
					onValueChange={(value) => setValue("role", value as AdminRole, { shouldDirty: true })}
				>
					<SelectTrigger id="admin-role">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={AdminRole.Standard}>
							<SelectItemText>{t("admins.roles.standard")}</SelectItemText>
						</SelectItem>
						<SelectItem value={AdminRole.Reseller} disabled>
							<SelectItemText>
								{t("admins.roles.reseller")} · {t("common.comingSoon")}
							</SelectItemText>
						</SelectItem>
						<SelectItem value={AdminRole.Sudo}>
							<SelectItemText>{t("admins.roles.sudo")}</SelectItemText>
						</SelectItem>
						{canCreateFullAccess ? (
							<SelectItem value={AdminRole.FullAccess}>
								<SelectItemText>{t("admins.roles.fullAccess")}</SelectItemText>
							</SelectItem>
						) : null}
					</SelectContent>
				</Select>
			</FormField>

			<FormField
				label={t("admins.dataLimit")}
				error={errors.data_limit?.message as string | undefined}
				className={cn(usePerServiceTrafficLimits && "opacity-60")}
			>
				<DataSizeField
						valueGb={dataLimitValue}
						placeholder={t("admins.dataLimitHint")}
						disabled={usePerServiceTrafficLimits}
						invalid={!!errors.data_limit}
						onChangeGb={(raw) => setValue("data_limit", raw, { shouldDirty: true, shouldValidate: true })}
					/>
			</FormField>

			<FormField
				label={t("admins.usersLimit")}
				error={errors.users_limit?.message as string | undefined}
			>
				<NumberField
					inputMode="numeric"
					value={usersLimitValue}
					placeholder={t("admins.usersLimitHint")}
					disabled={usePerServiceTrafficLimits}
					invalid={!!errors.users_limit}
					onChange={(raw) => setValue("users_limit", raw, { shouldDirty: true, shouldValidate: true })}
				/>
			</FormField>

			<FormField
				label={t("admins.expireLabel")}
				className="sm:col-span-2"
				description={
					adminExpireUnix && adminExpireInfo.time
						? t(adminExpireInfo.status, { time: adminExpireInfo.time })
						: t("admins.expireHint")
				}
			>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<DateTimeField
							id="admin-expire"
							value={adminExpireDate}
							onChange={setAdminExpireDate}
							placeholder={t("dateTimePicker.selectDate")}
							minDate={new Date()}
							quickSelects={[
								{ label: t("userDialog.quickSelectOneMonth"), onClick: () => setAdminExpireDate(addQuickExpiry(adminExpireDate, 1, "month")) },
								{ label: t("userDialog.quickSelectThreeMonths"), onClick: () => setAdminExpireDate(addQuickExpiry(adminExpireDate, 3, "month")) },
								{ label: t("userDialog.quickSelectOneYear"), onClick: () => setAdminExpireDate(addQuickExpiry(adminExpireDate, 1, "year")) },
							]}
						/>
					</div>
					{adminExpireDate ? (
						<button
							type="button"
							onClick={() => setAdminExpireDate(null)}
							className={buttonVariants({ variant: "outline" })}
						>
							{t("clear")}
						</button>
					) : null}
				</div>
			</FormField>

			<div className="flex flex-col gap-3 rounded-md border p-3 sm:col-span-2">
				<span className="text-sm font-medium">{t("admins.limitsSection")}</span>
				{!isFullAccessRole ? (
					<CheckRow checked={usePerServiceTrafficLimits} onChange={(next) => setValue("use_service_traffic_limits", next, { shouldDirty: true })}>
						{t("admins.usePerServiceTrafficLimits")}
					</CheckRow>
				) : null}
				{!isFullAccessRole && !usePerServiceTrafficLimits && (hasGlobalDataLimit || isCreatedTrafficMode) ? (
					<div className="flex flex-col gap-2 ps-1">
						<CheckRow
							checked={isCreatedTrafficMode}
							onChange={(next) =>
								setValue(
									"traffic_limit_mode",
									next ? AdminTrafficLimitMode.CreatedTraffic : AdminTrafficLimitMode.UsedTraffic,
									{ shouldDirty: true },
								)
							}
						>
							{t("admins.limitByCreatedTraffic")}
						</CheckRow>
						{isCreatedTrafficMode ? (
							<div className="flex flex-col gap-2 ps-6">
								<CheckRow checked={Boolean(showUserTrafficValue)} onChange={(next) => setValue("show_user_traffic", next, { shouldDirty: true })}>
									{t("admins.showUserTraffic")}
								</CheckRow>
								<CheckRow
									checked={Boolean(permissionsValue.users.delete)}
									onChange={(next) => handleUserPermissionToggle("delete", next)}
								>
									{t("admins.permissions.deleteUser")}
								</CheckRow>
								<CheckRow
									checked={Boolean(deleteUserUsageLimitEnabled)}
									disabled={!permissionsValue.users.delete}
									onChange={(next) => setValue("delete_user_usage_limit_enabled", next, { shouldDirty: true })}
								>
									{t("admins.deleteUserUsageCap")}
								</CheckRow>
								{deleteUserUsageLimitEnabled ? (
									<FormField label={t("admins.deleteUserUsageLimit")} error={errors.delete_user_usage_limit?.message as string | undefined}>
										<NumberField
											inputMode="numeric"
											value={deleteUserUsageLimitValue}
											invalid={!!errors.delete_user_usage_limit}
											onChange={(raw) => setValue("delete_user_usage_limit", raw, { shouldDirty: true, shouldValidate: true })}
										/>
									</FormField>
								) : null}
								<CheckRow checked={Boolean(permissionsValue.users.reset_usage)} onChange={(next) => handleUserPermissionToggle("reset_usage", next)}>
									{t("admins.permissions.resetUsage")}
								</CheckRow>
								<p className="text-xs text-muted-foreground">{t("admins.createdTrafficModeHint")}</p>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-3 rounded-md border p-3 sm:col-span-2">
				<div className="flex items-center justify-between gap-3">
					<span className="text-sm font-medium">{t("services.title")}</span>
					<Badge variant="secondary">
						{selectedServices.length} / {serviceOptions.length}
					</Badge>
				</div>
				<CheckRow
					checked={selectedServices.length === serviceOptions.length && serviceOptions.length > 0}
					indeterminate={selectedServices.length > 0 && selectedServices.length < serviceOptions.length}
					disabled={serviceOptions.length === 0}
					onChange={handleToggleAllServices}
				>
					{t("admins.selectAllServices")}
				</CheckRow>
				<div className="relative">
					<Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={serviceSearch}
						placeholder={t("admins.searchServices")}
						onChange={(event) => setServiceSearch(event.target.value)}
						className="ps-9"
					/>
				</div>
				<div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
					{serviceOptions.length === 0 ? (
						<p className="text-sm text-muted-foreground sm:col-span-2">{t("services.noServicesAvailable")}</p>
					) : filteredServices.length === 0 ? (
						<p className="text-sm text-muted-foreground sm:col-span-2">{t("admins.noServicesMatching")}</p>
					) : (
						filteredServices.map((service) => {
							const isSelected = selectedServicesSet.has(service.id);
							return (
								<button
									key={service.id}
									type="button"
									aria-pressed={isSelected}
									onClick={() => handleServiceToggle(service.id)}
									className={cn(
										"flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-start transition-colors",
										isSelected ? "border-primary bg-accent" : "hover:bg-accent/50",
									)}
								>
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium">{service.name}</span>
										<span className="block text-xs text-muted-foreground">
											{t("admins.serviceStats", { users: service.user_count ?? 0, hosts: service.host_count ?? 0 })}
										</span>
									</span>
									{isSelected ? <Badge>{t("services.selected")}</Badge> : null}
								</button>
							);
						})
					)}
				</div>
				<p className="text-xs text-muted-foreground">{t("admins.servicesHelper")}</p>
				{usePerServiceTrafficLimits && selectedServices.length > 0 ? (
					<div className="flex flex-col gap-3 border-t pt-3">
						<span className="text-sm font-medium">{t("admins.perServiceLimitsTitle")}</span>
						{serviceLimitCards}
					</div>
				) : null}
			</div>

			{mode === "edit" && admin?.id !== undefined ? (
				<div className="sm:col-span-2">
					<EntityNotePanel entityType="admin" entityKey={admin.id} />
				</div>
			) : null}
		</div>
	);

	const permissionsTab = (
		<div className="flex flex-col gap-4">
			<AdminPermissionsEditor
				value={permissionsValue ?? clonePermissions(watchRole ?? AdminRole.Standard)}
				onChange={handlePermissionsChange}
				showReset
				onReset={resetPermissionsToRole}
				maxDataLimitValue={maxDataLimitValue}
				onMaxDataLimitChange={handleMaxDataLimitChange}
				maxDataLimitError={errors.maxDataLimitPerUserGb?.message as string | undefined}
				minDataLimitValue={minDataLimitValue}
				onMinDataLimitChange={handleMinDataLimitChange}
				minDataLimitError={errors.minDataLimitPerUserGb?.message as string | undefined}
				maxSpeedLimitValue={maxSpeedLimitValue}
				onMaxSpeedLimitChange={handleMaxSpeedLimitChange}
				maxSpeedLimitError={errors.maxSpeedLimitPerUserMbps?.message as string | undefined}
				maxIPLimitValue={maxIPLimitValue}
				onMaxIPLimitChange={handleMaxIPLimitChange}
				maxIPLimitError={errors.maxIPLimitPerUser?.message as string | undefined}
				hideExtendedSections={watchRole === AdminRole.Standard}
				readOnly={watchRole === AdminRole.FullAccess}
			/>
			{canManage2FA ? (
				<CheckRow checked={watch("require_2fa")} onChange={(next) => setValue("require_2fa", next, { shouldDirty: true })}>
					{t("admins.security.require2FA")}
				</CheckRow>
			) : null}
		</div>
	);

	const submitLabel =
		submitStatus === "success"
			? t("userDialog.submitSuccess")
			: submitStatus === "loading"
				? t("loading")
				: mode === "create"
					? t("admins.addAdmin")
					: t("save");

	return (
		<Dialog
			section="admins"
			page={admin ? adminEntityPage(admin) : undefined}
			open={isOpen}
			onOpenChange={(open) => {
				if (!open && !isSubmitting) handleCloseAdminDialog();
			}}
		>
			<DialogContent
				dir={isRTL ? "rtl" : "ltr"}
				className="flex max-h-[min(720px,calc(100dvh-10rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl max-md:inset-x-3 max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:w-auto max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0"
			>
				<form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							{mode === "create" ? <ShieldPlus className="size-4" /> : <UserPen className="size-4" />}
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{mode === "create" ? t("admins.addAdminTitle") : t("admins.editAdminTitle")}
							</DialogTitle>
							{mode === "edit" && admin ? (
								<DialogDescription className="truncate">{admin.username}</DialogDescription>
							) : null}
						</div>
					</DialogHeader>

					<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AdminDialogTab)} className="flex min-h-0 flex-1 flex-col">
						<div className="border-b px-5 pt-2.5 pb-2.5">
							<TabsList className="w-full">
								<TabsTrigger value="details">{t("details")}</TabsTrigger>
								<TabsTrigger value="permissions">{t("admins.permissionsTabLabel")}</TabsTrigger>
								{mode === "edit" && admin ? <TabsTrigger value="history">{t("adminHistory.tab")}</TabsTrigger> : null}
							</TabsList>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<TabsContent value="details" className="mt-0">
								{detailsTab}
							</TabsContent>
							<TabsContent value="permissions" className="mt-0">
								{permissionsTab}
							</TabsContent>
							{mode === "edit" && admin ? (
								<TabsContent value="history" className="mt-0">
									<AdminHistoryPanel username={admin.username} />
								</TabsContent>
							) : null}
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
						<button
							type="button"
							onClick={handleCloseAdminDialog}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							{t("cancel")}
						</button>
						<button
							type="submit"
							disabled={isSubmitting || submitStatus === "loading"}
							className={cn(buttonVariants({ size: "sm" }), "ms-auto")}
						>
							{submitLabel}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
