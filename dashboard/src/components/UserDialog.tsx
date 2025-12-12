import {
	Alert,
	AlertDescription,
	AlertIcon,
	Badge,
	Box,
	Button,
	Input as ChakraInput,
	Collapse,
	chakra,
	Flex,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Grid,
	GridItem,
	HStack,
	IconButton,
	InputGroup,
	InputRightElement,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Spinner,
	Stack,
	Switch,
	Text,
	Textarea,
	Tooltip,
	useColorMode,
	useToast,
	VStack,
} from "@chakra-ui/react";

import {
	ChartPieIcon,
	CheckIcon,
	LockClosedIcon,
	PencilIcon,
	QuestionMarkCircleIcon,
	SparklesIcon,
	UserPlusIcon,
} from "@heroicons/react/24/outline";

import { zodResolver } from "@hookform/resolvers/zod";

import { resetStrategy } from "constants/UserSettings";

import { type FilterUsageType, useDashboard } from "contexts/DashboardContext";

import { useServicesStore } from "contexts/ServicesContext";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";

import { type FC, useCallback, useEffect, useState } from "react";
import ReactApexChart from "react-apexcharts";

import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";

import { getPanelSettings } from "service/settings";
import { AdminRole, UserPermissionToggle } from "types/Admin";
import type {
	User,
	UserCreate,
	UserCreateWithService,
	UserListItem,
} from "types/User";

import { relativeExpiryDate } from "utils/dateFormatter";

import { z } from "zod";
import { DateTimePicker } from "./DateTimePicker";
import { DeleteIcon } from "./DeleteUserModal";
import { Icon } from "./Icon";
import { Input } from "./Input";

import { createUsageConfig, UsageFilter } from "./UsageFilter";

const AddUserIcon = chakra(UserPlusIcon, {
	baseStyle: {
		w: 5,

		h: 5,
	},
});

const EditUserIcon = chakra(PencilIcon, {
	baseStyle: {
		w: 5,

		h: 5,
	},
});

const UserUsageIcon = chakra(ChartPieIcon, {
	baseStyle: {
		w: 5,

		h: 5,
	},
});

const LimitLockIcon = chakra(LockClosedIcon, {
	baseStyle: {
		w: {
			base: 16,

			md: 20,
		},

		h: {
			base: 16,

			md: 20,
		},
	},
});

const _ConfirmIcon = chakra(CheckIcon, {
	baseStyle: {
		w: 4,

		h: 4,
	},
});

export type UserDialogProps = {};

type BaseFormFields = Pick<
	UserCreate,
	| "username"
	| "status"
	| "expire"
	| "data_limit"
	| "ip_limit"
	| "data_limit_reset_strategy"
	| "on_hold_expire_duration"
	| "note"
	| "flow"
	| "credential_key"
	| "proxies"
	| "inbounds"
>;

export type FormType = BaseFormFields & {
	credential_key: string | null;

	manual_key_entry: boolean;

	service_id: number | null;

	next_plan_enabled: boolean;

	next_plan_data_limit: number | null;

	next_plan_expire: number | null;

	next_plan_add_remaining_traffic: boolean;

	next_plan_fire_on_either: boolean;
};

const formatUser = (user: User): FormType => {
	const nextPlan = user.next_plan ?? null;

	return {
		...user,
		flow: user.flow ?? "",

		data_limit: user.data_limit
			? Number((user.data_limit / 1073741824).toFixed(5))
			: user.data_limit,

		ip_limit: user.ip_limit && user.ip_limit > 0 ? user.ip_limit : null,

		on_hold_expire_duration: user.on_hold_expire_duration
			? Number(user.on_hold_expire_duration / (24 * 60 * 60))
			: user.on_hold_expire_duration,

		service_id: user.service_id ?? null,

		credential_key: user.credential_key ?? null,

		manual_key_entry: false,

		next_plan_enabled: Boolean(nextPlan),

		next_plan_data_limit: nextPlan?.data_limit
			? Number((nextPlan.data_limit / 1073741824).toFixed(5))
			: null,

		next_plan_expire: nextPlan?.expire ?? null,

		next_plan_add_remaining_traffic: nextPlan?.add_remaining_traffic ?? false,

		next_plan_fire_on_either: nextPlan?.fire_on_either ?? true,
	};
};

const getDefaultValues = (): FormType => {
	// Get available protocols from inbounds
	const { inbounds } = useDashboard.getState();
	const availableProtocols: Record<string, any> = {};

	// Only include protocols that have inbounds available
	const protocolDefaults: Record<string, any> = {
		vless: { id: "" },
		vmess: { id: "" },
		trojan: { password: "" },
		shadowsocks: { password: "", method: "chacha20-ietf-poly1305" },
	};

	// Filter to only include protocols that have inbounds
	for (const [protocol, protocolInbounds] of inbounds.entries()) {
		if (protocolInbounds && protocolInbounds.length > 0) {
			availableProtocols[protocol] = protocolDefaults[protocol] || {};
		}
	}

	return {
		data_limit: null,

		ip_limit: null,

		expire: null,

		credential_key: null,

		manual_key_entry: false,

		flow: "",

		username: "",

		data_limit_reset_strategy: "no_reset",

		status: "active",

		on_hold_expire_duration: null,

		note: "",

		inbounds: {},

		proxies: availableProtocols,

		service_id: null,

		next_plan_enabled: false,

		next_plan_data_limit: null,

		next_plan_expire: null,

		next_plan_add_remaining_traffic: false,

		next_plan_fire_on_either: true,
	};
};

const CREDENTIAL_KEY_REGEX = /^[0-9a-fA-F]{32}$/;

const allowedFlows = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"];

const baseSchema = {
	username: z.string().min(1, { message: "Required" }),

	note: z.string().nullable(),

	flow: z
		.string()
		.optional()
		.transform((val) => (val === "" || typeof val === "undefined" ? null : val))
		.refine(
			(val) => val === null || allowedFlows.includes(val),
			"Unsupported flow",
		),

	service_id: z

		.union([z.string(), z.number()])

		.nullable()

		.transform((value) => {
			if (value === "" || value === null || typeof value === "undefined") {
				return null;
			}

			const parsed = Number(value);

			return Number.isNaN(parsed) ? null : parsed;
		}),

	proxies: z

		.record(z.string(), z.record(z.string(), z.any()))

		.transform((ins) => {
			const deleteIfEmpty = (obj: any, key: string) => {
				if (obj && obj[key] === "") {
					delete obj[key];
				}
			};

			deleteIfEmpty(ins.vmess, "id");

			deleteIfEmpty(ins.vless, "id");

			deleteIfEmpty(ins.trojan, "password");

			deleteIfEmpty(ins.shadowsocks, "password");

			deleteIfEmpty(ins.shadowsocks, "method");

			return ins;
		}),

	data_limit: z

		.string()

		.min(0)

		.or(z.number())

		.nullable()

		.transform((str) => {
			if (str) return Number((parseFloat(String(str)) * 1073741824).toFixed(5));

			return 0;
		}),

	expire: z.number().nullable(),

	data_limit_reset_strategy: z.string(),

	inbounds: z.record(z.string(), z.array(z.string())).transform((ins) => {
		Object.keys(ins).forEach((protocol) => {
			if (Array.isArray(ins[protocol]) && !ins[protocol]?.length)
				delete ins[protocol];
		});

		return ins;
	}),

	next_plan_enabled: z.boolean().default(false),

	next_plan_data_limit: z

		.union([z.string(), z.number(), z.null()])

		.transform((value) => {
			if (value === null || value === "" || typeof value === "undefined") {
				return null;
			}

			const parsed = Number(value);

			if (Number.isNaN(parsed)) {
				return null;
			}

			return Math.max(0, parsed);
		}),

	next_plan_expire: z

		.union([z.number(), z.string(), z.null()])

		.transform((value) => {
			if (value === "" || value === null || typeof value === "undefined") {
				return null;
			}

			const parsed = Number(value);

			return Number.isNaN(parsed) ? null : parsed;
		}),

	next_plan_add_remaining_traffic: z.boolean().default(false),

	next_plan_fire_on_either: z.boolean().default(true),

	ip_limit: z
		.union([z.number().min(0), z.null()])
		.optional()
		.transform((value) => {
			if (typeof value !== "number") {
				return null;
			}
			return Number.isFinite(value) ? value : null;
		}),

	manual_key_entry: z.boolean().default(false),

	credential_key: z
		.union([z.string(), z.null(), z.undefined()])
		.transform((value) => {
			if (!value || typeof value !== "string") {
				return null;
			}
			const trimmed = value.trim();
			return trimmed === "" ? null : trimmed;
		})
		.nullable(),
};

const schema = z
	.discriminatedUnion("status", [
		z.object({
			status: z.literal("active"),

			...baseSchema,
		}),

		z.object({
			status: z.literal("disabled"),

			...baseSchema,
		}),

		z.object({
			status: z.literal("limited"),

			...baseSchema,
		}),

		z.object({
			status: z.literal("expired"),

			...baseSchema,
		}),

		z.object({
			status: z.literal("on_hold"),

			on_hold_expire_duration: z.coerce

				.number()

				.min(0.1, "Required")

				.transform((d) => {
					return d * (24 * 60 * 60);
				}),

			...baseSchema,
		}),
	])
	.superRefine((values, ctx) => {
		if (!values.manual_key_entry) {
			return;
		}
		const key = values.credential_key;
		if (!key) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["credential_key"],
				message: "Credential key is required when manual entry is enabled.",
			});
			return;
		}
		if (!CREDENTIAL_KEY_REGEX.test(key)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["credential_key"],
				message: "Credential key must be a 32-character hexadecimal string.",
			});
		}
	});

export const UserDialog: FC<UserDialogProps> = () => {
	const {
		editingUser,

		isCreatingNewUser,

		onCreateUser,

		editUser,

		fetchUserUsage,

		onEditingUser,

		createUserWithService,

		onDeletingUser,

		users: usersState,

		isUserLimitReached,
	} = useDashboard();

	const isEditing = !!editingUser;

	const isOpen = isCreatingNewUser || isEditing;

	const usersLimit = usersState.users_limit ?? null;

	const activeUsersCount = usersState.active_total ?? null;

	const limitReached = isUserLimitReached && !isEditing;

	const [loading, setLoading] = useState(false);

	const [error, setError] = useState<string | null>("");

	const toast = useToast();

	const { t } = useTranslation();

	const { colorMode } = useColorMode();

	const form = useForm<FormType>({
		defaultValues: getDefaultValues(),

		resolver: zodResolver(schema),
	});

	const manualKeyEntryEnabled = useWatch({
		control: form.control,
		name: "manual_key_entry",
	});
	const hasExistingKey = Boolean(editingUser?.credential_key);

	const expireInitialValue = form.getValues("expire");

	const nextPlanInitialValue = form.getValues("next_plan_expire");

	const deriveDaysFromSeconds = useCallback((value: unknown): number | null => {
		if (typeof value !== "number" || value <= 0) {
			return null;
		}
		const target = dayjs.unix(value).utc().local();
		const now = dayjs();
		const diff = target.diff(now, "day", true);
		if (!Number.isFinite(diff)) {
			return null;
		}
		return Math.max(0, Math.round(diff));
	}, []);

	function convertDaysToSecondsFromNow(days: number): number {
		return dayjs().add(days, "day").endOf("day").utc().unix();
	}

	const [_expireDays, setExpireDays] = useState<number | null>(() =>
		deriveDaysFromSeconds(expireInitialValue),
	);
	const [nextPlanDays, setNextPlanDays] = useState<number | null>(() =>
		deriveDaysFromSeconds(nextPlanInitialValue),
	);

	const quickExpiryOptions = [
		{
			label: t("userDialog.quickSelectOneMonth", "+1 month"),
			amount: 1,
			unit: "month",
		},
		{
			label: t("userDialog.quickSelectThreeMonths", "+3 months"),
			amount: 3,
			unit: "month",
		},
		{
			label: t("userDialog.quickSelectOneYear", "+1 year"),
			amount: 1,
			unit: "year",
		},
	] as const;

	const services = useServicesStore((state) => state.services);
	const servicesLoading = useServicesStore((state) => state.isLoading);
	const { userData, getUserIsSuccess } = useGetUser();
	const hasElevatedRole = Boolean(
		getUserIsSuccess &&
			(userData.role === AdminRole.Sudo ||
				userData.role === AdminRole.FullAccess),
	);
	const canSetFlow =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.SetFlow]);
	const canSetCustomKey =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.AllowCustomKey]);
	const _canCreateUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const canDeleteUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Delete]);
	const canResetUsage =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.ResetUsage]);
	const canRevokeSubscription =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Revoke]);
	const [selectedServiceId, setSelectedServiceId] = useState<number | null>(
		null,
	);

	const hasServices = services.length > 0;
	const selectedService = selectedServiceId
		? (services.find((service) => service.id === selectedServiceId) ?? null)
		: null;
	const isServiceManagedUser = Boolean(editingUser?.service_id);
	const nonSudoSingleService = !hasElevatedRole && services.length === 1;
	const showServiceSelector = hasElevatedRole || services.length !== 1;
	const useTwoColumns = showServiceSelector && services.length > 0;
	const shouldCenterForm = !useTwoColumns;
	const shouldCompactModal = !hasElevatedRole && services.length === 0;

	const { data: panelSettings } = useQuery("panel-settings", getPanelSettings, {
		enabled: isOpen,
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	});
	const allowIpLimit = Boolean(panelSettings?.use_nobetci);

	const [usageVisible, setUsageVisible] = useState(false);
	const handleUsageToggle = () => {
		setUsageVisible((current) => !current);
	};

	useEffect(() => {
		if (isOpen) {
			useServicesStore.getState().fetchServices();
		}
	}, [isOpen]);

	useEffect(() => {
		if (isEditing) {
			if (editingUser?.service_id) {
				setSelectedServiceId(editingUser.service_id);
			} else if (hasElevatedRole) {
				setSelectedServiceId(null);
			} else if (services.length) {
				setSelectedServiceId(services[0]?.id ?? null);
			} else {
				setSelectedServiceId(null);
			}
		} else if (!isOpen) {
			setSelectedServiceId(null);
		}
	}, [isEditing, editingUser, isOpen, hasElevatedRole, services]);

	useEffect(() => {
		if (!isEditing && isOpen && hasServices && !hasElevatedRole) {
			setSelectedServiceId((current) => current ?? services[0]?.id ?? null);
		}
	}, [services, isEditing, isOpen, hasServices, hasElevatedRole]);

	useEffect(() => {
		if (!isEditing && isOpen && !hasServices) {
			setSelectedServiceId(null);
		}
	}, [hasServices, isEditing, isOpen]);

	useEffect(() => {
		if (nonSudoSingleService && services[0]) {
			setSelectedServiceId((current) => current ?? services[0].id);
		}
	}, [nonSudoSingleService, services]);

	const [dataLimit, userStatus] = useWatch({
		control: form.control,

		name: ["data_limit", "status"],
	});

	const nextPlanEnabled = useWatch({
		control: form.control,

		name: "next_plan_enabled",
	});

	const expireValue = useWatch({
		control: form.control,

		name: "expire",
	});

	const nextPlanDataLimit = useWatch({
		control: form.control,

		name: "next_plan_data_limit",
	});

	const nextPlanExpire = useWatch({
		control: form.control,

		name: "next_plan_expire",
	});

	const nextPlanAddRemainingTraffic = useWatch({
		control: form.control,

		name: "next_plan_add_remaining_traffic",
	});

	const nextPlanFireOnEither = useWatch({
		control: form.control,

		name: "next_plan_fire_on_either",
	});

	useEffect(() => {
		const derivedDays = deriveDaysFromSeconds(expireValue);
		setExpireDays((prev) => (prev === derivedDays ? prev : derivedDays));
	}, [expireValue, deriveDaysFromSeconds]);

	useEffect(() => {
		const derivedDays = deriveDaysFromSeconds(nextPlanExpire);
		setNextPlanDays((prev) => (prev === derivedDays ? prev : derivedDays));
	}, [nextPlanExpire, deriveDaysFromSeconds]);

	const handleNextPlanToggle = (checked: boolean) => {
		form.setValue("next_plan_enabled", checked, { shouldDirty: true });

		if (checked) {
			if (form.getValues("next_plan_data_limit") === null) {
				form.setValue("next_plan_data_limit", 0, { shouldDirty: false });
			}

			if (form.getValues("next_plan_add_remaining_traffic") === undefined) {
				form.setValue("next_plan_add_remaining_traffic", false, {
					shouldDirty: false,
				});
			}

			if (form.getValues("next_plan_fire_on_either") === undefined) {
				form.setValue("next_plan_fire_on_either", true, { shouldDirty: false });
			}
		} else {
			form.setValue("next_plan_data_limit", null, { shouldDirty: true });
			form.setValue("next_plan_expire", null, { shouldDirty: true });
			setNextPlanDays(null);
		}
	};

	const usageTitle = t("userDialog.total");

	const [usage, setUsage] = useState(createUsageConfig(colorMode, usageTitle));

	const [usageFilter, setUsageFilter] = useState("1m");

	const fetchUsageWithFilter = useCallback(
		(query: FilterUsageType) => {
			if (!editingUser) return;
			fetchUserUsage(editingUser as unknown as UserListItem, query).then(
				(data: any) => {
					const labels = [];

					const series = [];

					for (const key in data.usages) {
						series.push(data.usages[key].used_traffic);

						labels.push(data.usages[key].node_name);
					}

					setUsage(createUsageConfig(colorMode, usageTitle, series, labels));
				},
			);
		},
		[editingUser, colorMode, usageTitle, fetchUserUsage],
	);

	useEffect(() => {
		if (editingUser) {
			const formatted = formatUser(editingUser);
			form.reset(formatted);
			setExpireDays(deriveDaysFromSeconds(formatted.expire));
			setNextPlanDays(deriveDaysFromSeconds(formatted.next_plan_expire));
			fetchUsageWithFilter({
				start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00"),
			});
		} else {
			const defaults = getDefaultValues();
			form.reset(defaults);
			setExpireDays(deriveDaysFromSeconds(defaults.expire));
			setNextPlanDays(deriveDaysFromSeconds(defaults.next_plan_expire));
		}
	}, [editingUser, deriveDaysFromSeconds, fetchUsageWithFilter, form.reset]);

	useEffect(() => {
		if (!canSetCustomKey) {
			form.setValue("manual_key_entry", false, { shouldDirty: true });
			form.setValue("credential_key", null, { shouldDirty: true });
		}
		if (!canSetFlow) {
			form.setValue("flow", "", { shouldDirty: false });
		}
	}, [canSetCustomKey, canSetFlow, form]);

	const submit = (values: FormType) => {
		// Check user limit before submitting (even if status is not active)
		// This prevents creating users that would exceed the limit
		if (usersLimit !== null && usersLimit !== undefined && usersLimit > 0 && activeUsersCount !== null) {
			if (activeUsersCount >= usersLimit) {
				const errorMessage = t("userDialog.usersLimitReached", "User limit reached. You have {{active}} active users out of {{limit}} allowed.", {
					active: activeUsersCount,
					limit: usersLimit
				});
				setError(errorMessage);
				setLoading(false);
				return;
			}
		}
		
		if (limitReached) {
			return;
		}

		setLoading(true);

		setError(null);

		const {
			service_id: _serviceId,

			next_plan_enabled,

			next_plan_data_limit,

			next_plan_expire,

			next_plan_add_remaining_traffic,

			next_plan_fire_on_either,

			flow,

			proxies,

			inbounds,

			status,

			data_limit,

			data_limit_reset_strategy,

			on_hold_expire_duration,

			ip_limit,

			credential_key,

			manual_key_entry,

			...rest
		} = values;

		// Validate data_limit based on admin permissions (don't auto-normalize, show error instead)
		const maxDataLimitPerUser = userData?.permissions?.users?.max_data_limit_per_user;
		const allowUnlimitedData = hasElevatedRole || Boolean(userData?.permissions?.users?.[UserPermissionToggle.AllowUnlimitedData]);
		
		// data_limit from schema is already in bytes
		const dataLimitBytes = data_limit || 0;
		
		if (maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined) {
			// If unlimited (0) is requested but not allowed, show error
			if (dataLimitBytes === 0 && !allowUnlimitedData) {
				const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
				const errorMessage = t("userDialog.unlimitedNotAllowed", { max: maxGb });
				setError(errorMessage);
				setLoading(false);
				form.setError("data_limit", {
					type: "manual",
					message: errorMessage,
				});
				return;
			}
			// If exceeds max limit, show error
			if (dataLimitBytes > 0 && dataLimitBytes > maxDataLimitPerUser) {
				const originalGb = (dataLimitBytes / 1073741824).toFixed(2);
				const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
				const errorMessage = t("userDialog.dataLimitExceedsMax", {
					original: originalGb,
					max: maxGb
				});
				setError(errorMessage);
				setLoading(false);
				form.setError("data_limit", {
					type: "manual",
					message: errorMessage,
				});
				return;
			}
		}

		// Validate next_plan data_limit (don't auto-normalize, show error instead)
		const normalizedNextPlanDataLimit =
			next_plan_enabled && next_plan_data_limit && next_plan_data_limit > 0
				? Number((Number(next_plan_data_limit) * 1073741824).toFixed(5))
				: 0;
		
		if (maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined && normalizedNextPlanDataLimit > 0) {
			if (normalizedNextPlanDataLimit > maxDataLimitPerUser) {
				const originalGb = (normalizedNextPlanDataLimit / 1073741824).toFixed(2);
				const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
				const errorMessage = t("userDialog.nextPlanDataLimitExceedsMax", {
					original: originalGb,
					max: maxGb
				});
				setError(errorMessage);
				setLoading(false);
				form.setError("next_plan_data_limit", {
					type: "manual",
					message: errorMessage,
				});
				return;
			}
		}
		// If unlimited (0) is requested but not allowed, show error
		if (normalizedNextPlanDataLimit === 0 && next_plan_enabled && !allowUnlimitedData && maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined) {
			const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
			const errorMessage = t("userDialog.nextPlanUnlimitedNotAllowed", {
				max: maxGb
			});
			setError(errorMessage);
			setLoading(false);
			form.setError("next_plan_data_limit", {
				type: "manual",
				message: errorMessage,
			});
			return;
		}

		const nextPlanPayload = next_plan_enabled
			? {
					data_limit: normalizedNextPlanDataLimit,

					expire: next_plan_expire ?? 0,

					add_remaining_traffic: next_plan_add_remaining_traffic,

					fire_on_either: next_plan_fire_on_either,
				}
			: null;

		const normalizedIpLimit =
			typeof ip_limit === "number" && Number.isFinite(ip_limit) && ip_limit > 0
				? Math.floor(ip_limit)
				: 0;

		if (!isEditing) {
			const effectiveServiceId = hasElevatedRole
				? selectedServiceId
				: (selectedServiceId ??
					(nonSudoSingleService ? (services[0]?.id ?? null) : null));

			if (!hasElevatedRole && !effectiveServiceId) {
				setError(t("userDialog.selectService", "Please choose a service"));
				setLoading(false);
				return;
			}

			const serviceBody: UserCreateWithService = {
				username: values.username,

				service_id: effectiveServiceId ?? 0,

				note: values.note,

				status:
					values.status === "active" ||
					values.status === "disabled" ||
					values.status === "on_hold"
						? values.status
						: "active",

				expire: values.expire,

				data_limit: values.data_limit,

				ip_limit: normalizedIpLimit,

				data_limit_reset_strategy:
					data_limit && data_limit > 0 ? data_limit_reset_strategy : "no_reset",

				on_hold_expire_duration:
					status === "on_hold" ? on_hold_expire_duration : null,

				flow: canSetFlow ? flow || null : null,
			};

			if (canSetCustomKey && manual_key_entry && credential_key) {
				serviceBody.credential_key = credential_key;
			}

			if (nextPlanPayload) {
				serviceBody.next_plan = nextPlanPayload;
			}

			// If service_id is 0 (no service), include proxies and inbounds
			// Filter out protocols that are disabled on the server
			if (effectiveServiceId === null || effectiveServiceId === 0) {
				const { inbounds: availableInbounds } = useDashboard.getState();
				const enabledProtocols = new Set(availableInbounds.keys());

				// Filter proxies to only include enabled protocols
				const filteredProxies: Record<string, any> = {};
				if (proxies) {
					for (const [protocol, settings] of Object.entries(proxies)) {
						if (enabledProtocols.has(protocol as any)) {
							filteredProxies[protocol] = settings;
						}
					}
				}

				// Filter inbounds to only include enabled protocols
				const filteredInbounds: Record<string, string[]> = {};
				if (inbounds) {
					for (const [protocol, tags] of Object.entries(inbounds)) {
						if (enabledProtocols.has(protocol as any)) {
							filteredInbounds[protocol] = tags;
						}
					}
				}

				if (Object.keys(filteredProxies).length > 0) {
					serviceBody.proxies = filteredProxies;
				}
				if (Object.keys(filteredInbounds).length > 0) {
					serviceBody.inbounds = filteredInbounds;
				}
			}

			createUserWithService(serviceBody)

				.then(() => {
					toast({
						title: t("userDialog.userCreated", { username: values.username }),

						status: "success",

						isClosable: true,

						position: "top",

						duration: 3000,
					});

					onClose();
				})

				.catch((err) => {
					if (err?.response?.status === 409 || err?.response?.status === 400) {
						setError(err?.response?._data?.detail);
					}

					if (err?.response?.status === 422) {
						Object.keys(err.response._data.detail).forEach((key) => {
							setError(err?.response._data.detail[key] as string);

							form.setError(
								key as "proxies" | "username" | "data_limit" | "expire",

								{
									type: "custom",

									message: err.response._data.detail[key],
								},
							);
						});
					}
				})

				.finally(() => {
					setLoading(false);
				});

			return;
		}

		const body: Record<string, unknown> = {
			...rest,

			data_limit: data_limit,

			ip_limit: normalizedIpLimit,

			data_limit_reset_strategy:
				data_limit && data_limit > 0 ? data_limit_reset_strategy : "no_reset",

			status:
				status === "active" || status === "disabled" || status === "on_hold"
					? status
					: "active",

			on_hold_expire_duration:
				status === "on_hold" ? on_hold_expire_duration : null,

			flow: canSetFlow ? flow || null : null,
		};

		if (canSetCustomKey && manual_key_entry && credential_key) {
			body.credential_key = credential_key;
		}

		if (nextPlanPayload) {
			body.next_plan = nextPlanPayload;
		} else if (!next_plan_enabled && editingUser?.next_plan) {
			body.next_plan = null;
		}

		if (!editingUser?.service_id) {
			// Filter out protocols that are disabled on the server
			const { inbounds: availableInbounds } = useDashboard.getState();
			const enabledProtocols = new Set(availableInbounds.keys());

			// Filter proxies to only include enabled protocols
			const filteredProxies: Record<string, any> = {};
			if (proxies) {
				for (const [protocol, settings] of Object.entries(proxies)) {
					if (enabledProtocols.has(protocol as any)) {
						filteredProxies[protocol] = settings;
					}
				}
			}

			// Filter inbounds to only include enabled protocols
			const filteredInbounds: Record<string, string[]> = {};
			if (inbounds) {
				for (const [protocol, tags] of Object.entries(inbounds)) {
					if (enabledProtocols.has(protocol as any)) {
						filteredInbounds[protocol] = tags;
					}
				}
			}

			if (Object.keys(filteredProxies).length > 0) {
				body.proxies = filteredProxies;
			}

			if (Object.keys(filteredInbounds).length > 0) {
				body.inbounds = filteredInbounds;
			}
		}

		if (typeof selectedServiceId !== "undefined") {
			if (selectedServiceId === null) {
				if (hasElevatedRole) {
					body.service_id = null;
				}
			} else if (selectedServiceId !== editingUser?.service_id) {
				body.service_id = selectedServiceId;
			}
		}

		editUser(editingUser?.username, body as UserCreate)

			.then(() => {
				toast({
					title: t("userDialog.userEdited", { username: values.username }),

					status: "success",

					isClosable: true,

					position: "top",

					duration: 3000,
				});

				onClose();
			})

			.catch((err) => {
				if (err?.response?.status === 409 || err?.response?.status === 400) {
					setError(err?.response?._data?.detail);
				}

				if (err?.response?.status === 422) {
					Object.keys(err.response._data.detail).forEach((key) => {
						setError(err?.response._data.detail[key] as string);

						form.setError(
							key as "proxies" | "username" | "data_limit" | "expire",

							{
								type: "custom",

								message: err.response._data.detail[key],
							},
						);
					});
				}
			})

			.finally(() => {
				setLoading(false);
			});
	};

	const onClose = () => {
		form.reset(getDefaultValues());
		setExpireDays(null);
		setNextPlanDays(null);

		onCreateUser(false);

		onEditingUser(null);

		setError(null);

		setUsageVisible(false);

		setUsageFilter("1m");

		setSelectedServiceId(null);
	};

	const handleResetUsage = () => {
		if (!canResetUsage) {
			return;
		}
		useDashboard.setState({
			resetUsageUser: (editingUser as unknown as UserListItem) ?? null,
		});
	};

	const handleRevokeSubscription = () => {
		if (!canRevokeSubscription) {
			return;
		}
		useDashboard.setState({
			revokeSubscriptionUser: (editingUser as unknown as UserListItem) ?? null,
		});
	};

	const disabled = loading || limitReached;

	const isOnHold = userStatus === "on_hold";

	const [randomUsernameLoading, setrandomUsernameLoading] = useState(false);

	const createRandomUsername = (): string => {
		setrandomUsernameLoading(true);

		let result = "";

		const characters =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

		const charactersLength = characters.length;

		let counter = 0;

		while (counter < 6) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));

			counter += 1;
		}

		return result;
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size={shouldCompactModal ? "lg" : "2xl"}
		>
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />

			<FormProvider {...form}>
				<ModalContent mx="3" position="relative" overflow="hidden">
					<ModalCloseButton mt={3} disabled={loading} />

					<Box
						pointerEvents={limitReached ? "none" : "auto"}
						filter={limitReached ? "blur(6px)" : "none"}
						transition="filter 0.2s ease"
					>
						<form onSubmit={form.handleSubmit(submit)}>
							<ModalHeader pt={6}>
								<HStack gap={2}>
									<Icon color="primary">
										{isEditing ? (
											<EditUserIcon color="white" />
										) : (
											<AddUserIcon color="white" />
										)}
									</Icon>

									<Text fontWeight="semibold" fontSize="lg">
										{isEditing
											? t("userDialog.editUserTitle")
											: t("createNewUser")}
									</Text>
								</HStack>
							</ModalHeader>

							<ModalBody>
								{isEditing && isServiceManagedUser && (
									<Alert status="info" mb={4} borderRadius="md">
										<AlertIcon />

										{t(
											"userDialog.serviceManagedNotice",

											"This user is tied to service {{service}}. Update the service to change shared settings.",

											{
												service: editingUser?.service_name ?? "",
											},
										)}
									</Alert>
								)}

								<Grid
									templateColumns={{
										base: "repeat(1, 1fr)",
										md: useTwoColumns ? "repeat(2, 1fr)" : "minmax(0, 1fr)",
									}}
									gap={3}
									{...(shouldCenterForm
										? { maxW: "720px", mx: "auto", w: "full" }
										: {})}
								>
									<GridItem>
										<VStack justifyContent="space-between">
											<Flex
												flexDirection="column"
												gridAutoRows="min-content"
												w="full"
											>
												<Flex flexDirection="row" w="full" gap={2}>
													<FormControl
														mb={"10px"}
														isInvalid={
															!!form.formState.errors.username?.message
														}
													>
														<FormLabel>{t("username")}</FormLabel>
														<HStack align="flex-end">
															<Box flex="1" minW="0">
																<InputGroup size="sm">
																	<ChakraInput
																		type="text"
																		borderRadius="6px"
																		placeholder={t("username")}
																		isDisabled={disabled || isEditing}
																		{...form.register("username")}
																	/>
																	{!isEditing && (
																		<InputRightElement width="auto" pr={1}>
																			<IconButton
																				aria-label={t(
																					"userDialog.generateUsername",
																					"Generate random username",
																				)}
																				size="sm"
																				variant="ghost"
																				icon={<SparklesIcon width={18} />}
																				onClick={() => {
																					const randomUsername =
																						createRandomUsername();
																					form.setValue(
																						"username",
																						randomUsername,
																						{
																							shouldDirty: true,
																						},
																					);
																					setTimeout(() => {
																						setrandomUsernameLoading(false);
																					}, 350);
																				}}
																				isLoading={randomUsernameLoading}
																				isDisabled={disabled}
																			/>
																		</InputRightElement>
																	)}
																</InputGroup>
															</Box>
															{isEditing && (
																<HStack px={1}>
																	<Controller
																		name="status"
																		control={form.control}
																		render={({ field }) => {
																			return (
																				<Tooltip
																					placement="top"
																					label={
																						"status: " +
																						t(`status.${field.value}`)
																					}
																					textTransform="capitalize"
																				>
																					<Box>
																						<Switch
																							colorScheme="primary"
																							isChecked={
																								field.value === "active"
																							}
																							onChange={(e) => {
																								if (e.target.checked) {
																									field.onChange("active");
																								} else {
																									field.onChange("disabled");
																								}
																							}}
																						/>
																					</Box>
																				</Tooltip>
																			);
																		}}
																	/>
																</HStack>
															)}
														</HStack>

														<FormErrorMessage>
															{form.formState.errors.username?.message}
														</FormErrorMessage>
													</FormControl>
												</Flex>

												<Stack
													direction={{ base: "column", md: "row" }}
													spacing={4}
													mb={"10px"}
												>
													<FormControl flex="1">
														<FormLabel>{t("userDialog.dataLimit")}</FormLabel>
														<Controller
															control={form.control}
															name="data_limit"
															render={({ field }) => {
																return (
																	<Input
																		endAdornment="GB"
																		type="text"
																		inputMode="decimal"
																		size="sm"
																		borderRadius="6px"
																		onChange={field.onChange}
																		disabled={disabled}
																		error={
																			form.formState.errors.data_limit?.message
																		}
																		value={
																			field.value ? String(field.value) : ""
																		}
																	/>
																);
															}}
														/>
													</FormControl>
													{allowIpLimit && (
														<FormControl flex="1">
															<FormLabel
																display="flex"
																alignItems="center"
																gap={2}
															>
																{t("userDialog.ipLimitLabel", "IP limit")}
																<Tooltip
																	hasArrow
																	placement="top"
																	label={t(
																		"userDialog.ipLimitHint",
																		"Maximum number of unique IPs allowed. Leave empty or '-' for unlimited.",
																	)}
																>
																	<chakra.span
																		display="inline-flex"
																		color="gray.400"
																		cursor="help"
																	>
																		<QuestionMarkCircleIcon
																			width={16}
																			height={16}
																		/>
																	</chakra.span>
																</Tooltip>
															</FormLabel>
															<Controller
																control={form.control}
																name="ip_limit"
																rules={{
																	validate: (value) => {
																		if (value === null || value === undefined) {
																			return true;
																		}
																		if (
																			typeof value !== "number" ||
																			Number.isNaN(value)
																		) {
																			return t(
																				"userDialog.ipLimitValidation",
																				"Enter a valid non-negative number",
																			);
																		}
																		return value >= 0
																			? true
																			: t(
																					"userDialog.ipLimitValidation",
																					"Enter a valid non-negative number",
																				);
																	},
																}}
																render={({ field }) => (
																	<Input
																		size="sm"
																		borderRadius="6px"
																		placeholder={t(
																			"userDialog.ipLimitPlaceholder",
																			"Leave empty or '-' for unlimited",
																		)}
																		value={
																			typeof field.value === "number" &&
																			field.value > 0
																				? String(field.value)
																				: ""
																		}
																		onChange={(event) => {
																			const raw = event.target.value;
																			if (!raw.trim() || raw.trim() === "-") {
																				field.onChange(null);
																				return;
																			}
																			const parsed = Number(raw);
																			if (Number.isNaN(parsed)) {
																				return;
																			}
																			field.onChange(
																				parsed < 0 ? 0 : Math.floor(parsed),
																			);
																		}}
																		disabled={disabled}
																		error={
																			form.formState.errors.ip_limit?.message
																		}
																	/>
																)}
															/>
														</FormControl>
													)}
												</Stack>

												<Collapse
													in={!!(dataLimit && dataLimit > 0)}
													animateOpacity
													style={{ width: "100%" }}
												>
													<FormControl height="66px">
														<FormLabel>
															{t("userDialog.periodicUsageReset")}
														</FormLabel>

														<Controller
															control={form.control}
															name="data_limit_reset_strategy"
															render={({ field }) => {
																return (
																	<Select
																		size="sm"
																		{...field}
																		disabled={disabled}
																		bg={disabled ? "gray.100" : "transparent"}
																		_dark={{
																			bg: disabled ? "gray.600" : "transparent",
																		}}
																		sx={{
																			option: {
																				backgroundColor:
																					colorMode === "dark"
																						? "#222C3B"
																						: "white",
																			},
																		}}
																	>
																		{resetStrategy.map((s) => {
																			return (
																				<option key={s.value} value={s.value}>
																					{t(
																						"userDialog.resetStrategy" +
																							s.title,
																					)}
																				</option>
																			);
																		})}
																	</Select>
																);
															}}
														/>
													</FormControl>
												</Collapse>

												<FormControl
													mb={"10px"}
													isInvalid={
														!isOnHold && Boolean(form.formState.errors.expire)
													}
												>
													<Flex
														justify="space-between"
														align={{ base: "flex-start", md: "center" }}
														gap={{ base: 2, md: 4 }}
														flexDirection={{ base: "column", md: "row" }}
													>
														<FormLabel mb={0}>
															{isOnHold
																? t("userDialog.onHoldExpireDuration")
																: t(
																		"userDialog.expiryDaysLabel",
																		"Expires in (days)",
																	)}
														</FormLabel>
														{!isEditing && (
															<Controller
																name="status"
																control={form.control}
																render={({ field }) => {
																	const checked = field.value === "on_hold";
																	return (
																		<HStack spacing={2} align="center">
																			<Text
																				fontSize="sm"
																				color="gray.600"
																				_dark={{ color: "gray.400" }}
																			>
																				{t("userDialog.onHold")}
																			</Text>
																			<Switch
																				colorScheme="primary"
																				isChecked={checked}
																				onChange={(event) => {
																					const nextChecked =
																						event.target.checked;
																					if (nextChecked) {
																						field.onChange("on_hold");
																					} else {
																						field.onChange("active");
																						form.setValue(
																							"on_hold_expire_duration",
																							null,
																							{
																								shouldDirty: true,
																							},
																						);
																					}
																				}}
																				isDisabled={disabled}
																			/>
																		</HStack>
																	);
																}}
															/>
														)}
													</Flex>

													{isOnHold ? (
														<Controller
															control={form.control}
															name="on_hold_expire_duration"
															render={({ field }) => {
																return (
																	<Input
																		endAdornment="Days"
																		type="number"
																		size="sm"
																		borderRadius="6px"
																		onChange={(event) => {
																			form.setValue("expire", null);
																			const raw = event.target.value;
																			if (!raw) {
																				field.onChange(null);
																				return;
																			}
																			const parsed = Number(raw);
																			if (Number.isNaN(parsed) || parsed < 0) {
																				return;
																			}
																			field.onChange(Math.round(parsed));
																		}}
																		disabled={disabled}
																		error={
																			form.formState.errors
																				.on_hold_expire_duration?.message
																		}
																		value={
																			field.value ? String(field.value) : ""
																		}
																	/>
																);
															}}
														/>
													) : (
														<>
															<Controller
																name="expire"
																control={form.control}
																render={({ field }) => {
																	const { status, time } = relativeExpiryDate(
																		field.value,
																	);
																	const selectedDate = field.value
																		? dayjs.unix(field.value).toDate()
																		: null;

																	const handleDateChange = (
																		value: Date | null,
																	) => {
																		if (!value) {
																			field.onChange(null);
																			form.setValue(
																				"on_hold_expire_duration",
																				null,
																				{
																					shouldDirty: false,
																				},
																			);
																			return;
																		}
																		const normalized = dayjs(value)
																			.utc()
																			.unix();
																		form.setValue(
																			"on_hold_expire_duration",
																			null,
																			{
																				shouldDirty: false,
																			},
																		);
																		field.onChange(normalized);
																	};

																	return (
																		<Box mt="3px">
																			<DateTimePicker
																				value={selectedDate}
																				onChange={handleDateChange}
																				placeholder={t(
																					"userDialog.selectExpiryDate",
																					"Select expiration date",
																				)}
																				disabled={disabled}
																				minDate={new Date()}
																				quickSelects={quickExpiryOptions.map(
																					(option) => ({
																						label: option.label,
																						onClick: () => {
																							const newDate = dayjs()
																								.add(option.amount, option.unit)
																								.endOf("day");
																							handleDateChange(
																								newDate.toDate(),
																							);
																						},
																					}),
																				)}
																			/>
																			{field.value ? (
																				<FormHelperText>
																					{t(status, { time })}
																				</FormHelperText>
																			) : null}
																		</Box>
																	);
																}}
															/>
															<FormErrorMessage>
																{form.formState.errors.expire?.message}
															</FormErrorMessage>
														</>
													)}
												</FormControl>

												<Box mb={"10px"}>
													<HStack justify="space-between" align="center">
														<FormLabel mb={0}>
															{t("userDialog.nextPlanTitle", "Next plan")}
														</FormLabel>
														<Switch
															colorScheme="primary"
															isChecked={nextPlanEnabled}
															onChange={(event) =>
																handleNextPlanToggle(event.target.checked)
															}
															isDisabled={disabled}
														/>
													</HStack>
													<Text
														fontSize="xs"
														color="gray.500"
														_dark={{ color: "gray.400" }}
														mt={1}
													>
														{t(
															"userDialog.nextPlanDescription",
															"Configure automatic renewal details for this user.",
														)}
													</Text>
													<Collapse
														in={nextPlanEnabled}
														animateOpacity
														style={{ width: "100%" }}
													>
														<VStack align="stretch" spacing={3} mt={3}>
															<FormControl>
																<FormLabel fontSize="sm">
																	{t(
																		"userDialog.nextPlanDataLimit",
																		"Next plan data limit",
																	)}
																</FormLabel>
																<Input
																	endAdornment="GB"
																	type="text"
																	inputMode="decimal"
																	size="sm"
																	borderRadius="6px"
																	disabled={disabled}
																	value={
																		nextPlanDataLimit !== null &&
																		typeof nextPlanDataLimit !== "undefined"
																			? String(nextPlanDataLimit)
																			: ""
																	}
																	onChange={(event) => {
																		const rawValue = event.target.value;
																		if (!rawValue) {
																			form.setValue(
																				"next_plan_data_limit",
																				null,
																				{ shouldDirty: true },
																			);
																			return;
																		}
																		// Allow partial decimals while typing (e.g., "0.", "1.5")
																		if (!/^[0-9]*\\.?[0-9]*$/.test(rawValue)) {
																			return;
																		}
																		form.setValue(
																			"next_plan_data_limit",
																			rawValue,
																			{ shouldDirty: true },
																		);
																	}}
																/>
															</FormControl>
															<FormControl>
																<FormLabel fontSize="sm">
																	{t(
																		"userDialog.nextPlanExpireDays",
																		"Next plan in (days)",
																	)}
																</FormLabel>
																<Controller
																	control={form.control}
																	name="next_plan_expire"
																	render={({ field }) => {
																		const handleDaysChange = (
																			valueAsString: string,
																		) => {
																			if (!valueAsString) {
																				setNextPlanDays(null);
																				field.onChange(null);
																				return;
																			}
																			const parsed = Number(valueAsString);
																			if (Number.isNaN(parsed) || parsed < 0) {
																				return;
																			}
																			const normalizedDays = Math.min(
																				Math.round(parsed),
																				3650,
																			);
																			setNextPlanDays(normalizedDays);
																			const normalized =
																				convertDaysToSecondsFromNow(
																					normalizedDays,
																				);
																			field.onChange(normalized);
																		};

																		return (
																			<Input
																				endAdornment={t(
																					"userDialog.days",
																					"Days",
																				)}
																				type="number"
																				size="sm"
																				borderRadius="6px"
																				value={
																					typeof nextPlanDays === "number"
																						? String(nextPlanDays)
																						: ""
																				}
																				onChange={(event) =>
																					handleDaysChange(event.target.value)
																				}
																				disabled={disabled}
																			/>
																		);
																	}}
																/>
															</FormControl>
															<HStack justify="space-between">
																<Text
																	fontSize="sm"
																	color="gray.600"
																	_dark={{ color: "gray.400" }}
																>
																	{t(
																		"userDialog.nextPlanAddRemainingTraffic",
																		"Carry over remaining traffic",
																	)}
																</Text>
																<Switch
																	size="sm"
																	colorScheme="primary"
																	isChecked={Boolean(
																		nextPlanAddRemainingTraffic,
																	)}
																	onChange={(event) =>
																		form.setValue(
																			"next_plan_add_remaining_traffic",
																			event.target.checked,
																			{ shouldDirty: true },
																		)
																	}
																	isDisabled={disabled}
																/>
															</HStack>
															<HStack justify="space-between">
																<Text
																	fontSize="sm"
																	color="gray.600"
																	_dark={{ color: "gray.400" }}
																>
																	{t(
																		"userDialog.nextPlanFireOnEither",
																		"Trigger on data or expiry",
																	)}
																</Text>
																<Switch
																	size="sm"
																	colorScheme="primary"
																	isChecked={Boolean(nextPlanFireOnEither)}
																	onChange={(event) =>
																		form.setValue(
																			"next_plan_fire_on_either",
																			event.target.checked,
																			{
																				shouldDirty: true,
																			},
																		)
																	}
																	isDisabled={disabled}
																/>
															</HStack>
														</VStack>
													</Collapse>
												</Box>

												<FormControl
													mb={"10px"}
													isInvalid={!!form.formState.errors.note}
												>
													<FormLabel>{t("userDialog.note")}</FormLabel>

													<Textarea {...form.register("note")} />

													<FormErrorMessage>
														{form.formState.errors?.note?.message}
													</FormErrorMessage>
												</FormControl>
											</Flex>

											{error && (
												<Alert
													status="error"
													display={{ base: "none", md: "flex" }}
												>
													<AlertIcon />

													{error}
												</Alert>
											)}
										</VStack>
									</GridItem>

									{showServiceSelector && (
										<GridItem mt={useTwoColumns ? 0 : 4}>
											<FormControl isRequired={!hasElevatedRole}>
												<FormLabel>
													{t("userDialog.selectServiceLabel", "Service")}
												</FormLabel>

												{!servicesLoading && !hasServices && (
													<Box w="full" display="block" mt={2} mb={4}>
														<Alert
															status="warning"
															variant="subtle"
															w="full"
															px={4}
															py={3}
															borderRadius="md"
															alignItems="flex-start"
														>
															<AlertIcon />
															<AlertDescription>
																{`${t(
																	"userDialog.noServicesAvailable",
																	"No services are available yet.",
																)} ${t(
																	"userDialog.createServiceToManage",
																	"Create a service to manage users.",
																)}`}
															</AlertDescription>
														</Alert>
													</Box>
												)}

												{servicesLoading ? (
													<HStack spacing={2} py={4}>
														<Spinner size="sm" />

														<Text
															fontSize="sm"
															color="gray.500"
															_dark={{ color: "gray.400" }}
														>
															{t("loading")}
														</Text>
													</HStack>
												) : hasServices ? (
													<VStack align="stretch" spacing={3}>
														{hasElevatedRole && (
															<Box
																role="button"
																tabIndex={disabled ? -1 : 0}
																aria-pressed={selectedServiceId === null}
																onKeyDown={(event) => {
																	if (disabled) return;

																	if (
																		event.key === "Enter" ||
																		event.key === " "
																	) {
																		event.preventDefault();

																		setSelectedServiceId(null);
																	}
																}}
																onClick={() => {
																	if (disabled) return;

																	setSelectedServiceId(null);
																}}
																borderWidth="1px"
																borderRadius="md"
																p={4}
																borderColor={
																	selectedServiceId === null
																		? "primary.500"
																		: "gray.200"
																}
																bg={
																	selectedServiceId === null
																		? "primary.50"
																		: "transparent"
																}
																cursor={disabled ? "not-allowed" : "pointer"}
																pointerEvents={disabled ? "none" : "auto"}
																transition="border-color 0.2s ease, background-color 0.2s ease"
																_hover={
																	disabled
																		? {}
																		: {
																				borderColor:
																					selectedServiceId === null
																						? "primary.500"
																						: "gray.300",
																			}
																}
																_dark={{
																	borderColor:
																		selectedServiceId === null
																			? "primary.400"
																			: "gray.700",

																	bg:
																		selectedServiceId === null
																			? "primary.900"
																			: "transparent",
																}}
															>
																<Text fontWeight="semibold">
																	{t(
																		"userDialog.noServiceOption",
																		"No service",
																	)}
																</Text>

																<Text
																	fontSize="sm"
																	color="gray.500"
																	_dark={{ color: "gray.400" }}
																	mt={1}
																>
																	{t(
																		"userDialog.noServiceHelper",

																		"Keep this user detached from shared service settings.",
																	)}
																</Text>
															</Box>
														)}

														{services.map((service) => {
															const isSelected =
																selectedServiceId === service.id;
															const isBroken =
																service.broken === true ||
																service.has_hosts === false;

															return (
																<Box
																	key={service.id}
																	role="button"
																	tabIndex={disabled || isBroken ? -1 : 0}
																	aria-pressed={isSelected}
																	onKeyDown={(event) => {
																		if (disabled || isBroken) return;

																		if (
																			event.key === "Enter" ||
																			event.key === " "
																		) {
																			event.preventDefault();

																			setSelectedServiceId(service.id);
																		}
																	}}
																	onClick={() => {
																		if (disabled || isBroken) return;

																		setSelectedServiceId(service.id);
																	}}
																	borderWidth="1px"
																	borderRadius="md"
																	p={4}
																	borderColor={
																		isSelected ? "primary.500" : "gray.200"
																	}
																	bg={isSelected ? "primary.50" : "transparent"}
																	cursor={
																		disabled || isBroken
																			? "not-allowed"
																			: "pointer"
																	}
																	pointerEvents={
																		disabled || isBroken ? "none" : "auto"
																	}
																	transition="border-color 0.2s ease, background-color 0.2s ease"
																	_hover={
																		disabled
																			? {}
																			: {
																					borderColor: isSelected
																						? "primary.500"
																						: "gray.300",
																				}
																	}
																	_dark={{
																		borderColor: isSelected
																			? "primary.400"
																			: "gray.700",

																		bg: isSelected
																			? "primary.900"
																			: "transparent",
																	}}
																>
																	<HStack
																		justify="space-between"
																		align="flex-start"
																	>
																		<VStack align="flex-start" spacing={0}>
																			<Text fontWeight="semibold">
																				{service.name}
																			</Text>

																			{service.description && (
																				<Text
																					fontSize="sm"
																					color="gray.500"
																					_dark={{ color: "gray.400" }}
																				>
																					{service.description}
																				</Text>
																			)}
																		</VStack>

																		<Text
																			fontSize="xs"
																			color="gray.500"
																			_dark={{ color: "gray.400" }}
																		>
																			{t(
																				"userDialog.serviceSummary",
																				"{{hosts}} hosts, {{users}} users",
																				{
																					hosts: service.host_count,

																					users: service.user_count,
																				},
																			)}
																		</Text>
																		{isBroken && (
																			<Badge colorScheme="red" mt={1}>
																				{t(
																					"userDialog.brokenService",
																					"No hosts",
																				)}
																			</Badge>
																		)}
																	</HStack>
																</Box>
															);
														})}
													</VStack>
												) : null}

												{selectedService && (
													<FormHelperText mt={2}>
														{t(
															"userDialog.serviceSummary",

															"{{hosts}} hosts, {{users}} users",

															{
																hosts: selectedService.host_count,

																users: selectedService.user_count,
															},
														)}

														{selectedService &&
															(selectedService.broken ||
																selectedService.has_hosts === false) && (
																<Text color="red.500" fontSize="sm" mt={1}>
																	{t(
																		"userDialog.brokenServiceWarning",
																		"Selected service has no hosts. Please pick another service.",
																	)}
																</Text>
															)}
													</FormHelperText>
												)}
											</FormControl>
										</GridItem>
									)}

									{canSetFlow && (
										<GridItem
											colSpan={{ base: 1, md: showServiceSelector ? 2 : 1 }}
										>
											<FormControl>
												<FormLabel>
													{t("userDialog.flow.label", "Flow")}
												</FormLabel>
												<Controller
													name="flow"
													control={form.control}
													render={({ field }) => (
														<Select
															size="sm"
															value={field.value ?? ""}
															onChange={(event) =>
																field.onChange(event.target.value)
															}
															isDisabled={disabled}
														>
															<option value="">
																{t("userDialog.flow.none", "None")}
															</option>
															<option value="xtls-rprx-vision">
																{t(
																	"userDialog.flow.xtls_rprx_vision",
																	"xtls-rprx-vision",
																)}
															</option>
															<option value="xtls-rprx-vision-udp443">
																{t(
																	"userDialog.flow.xtls_rprx_vision_udp443",
																	"xtls-rprx-vision-udp443",
																)}
															</option>
														</Select>
													)}
												/>
											</FormControl>
										</GridItem>
									)}

									<GridItem
										colSpan={{ base: 1, md: showServiceSelector ? 2 : 1 }}
									>
										{hasExistingKey && canSetCustomKey && (
											<>
												<FormControl
													display="flex"
													alignItems="center"
													justifyContent="space-between"
												>
													<FormLabel mb={0}>
														{t("userDialog.allowManualKeyEntry", "Custom key")}
													</FormLabel>
													<Controller
														name="manual_key_entry"
														control={form.control}
														render={({ field }) => (
															<Switch
																size="sm"
																colorScheme="primary"
																isChecked={field.value}
																onChange={(event) =>
																	field.onChange(event.target.checked)
																}
																isDisabled={disabled}
															/>
														)}
													/>
												</FormControl>
												{manualKeyEntryEnabled && (
													<FormControl
														mt={4}
														isInvalid={Boolean(
															form.formState.errors.credential_key,
														)}
													>
														<FormLabel>
															{t(
																"userDialog.credentialKeyLabel",
																"Credential key",
															)}
														</FormLabel>
														<Controller
															name="credential_key"
															control={form.control}
															render={({ field }) => (
																<ChakraInput
																	placeholder="35e4e39c7d5c4f4b8b71558e4f37ff53"
																	maxLength={32}
																	value={field.value ?? ""}
																	onChange={(event) =>
																		field.onChange(event.target.value)
																	}
																	isDisabled={disabled}
																/>
															)}
														/>
														<FormHelperText>
															{t(
																"userDialog.manualKeyHelper",
																"Enter a 32-character hexadecimal credential key.",
															)}
														</FormHelperText>
														<FormErrorMessage>
															{form.formState.errors.credential_key?.message}
														</FormErrorMessage>
													</FormControl>
												)}
											</>
										)}
									</GridItem>

									{isEditing && usageVisible && (
										<GridItem
											pt={6}
											colSpan={{ base: 1, md: showServiceSelector ? 2 : 1 }}
										>
											<VStack gap={4}>
												<UsageFilter
													defaultValue={usageFilter}
													onChange={(filter, query) => {
														setUsageFilter(filter);

														fetchUsageWithFilter(query);
													}}
												/>

												<Box
													width={{ base: "100%", md: "70%" }}
													justifySelf="center"
												>
													<ReactApexChart
														options={usage.options}
														series={usage.series}
														type="donut"
													/>
												</Box>
											</VStack>
										</GridItem>
									)}
								</Grid>

								{error && (
									<Alert
										mt="3"
										status="error"
										display={{ base: "flex", md: "none" }}
									>
										<AlertIcon />

										{error}
									</Alert>
								)}
							</ModalBody>

							<ModalFooter mt="3">
								<HStack
									justifyContent="space-between"
									w="full"
									gap={3}
									flexDirection={{
										base: "column",

										sm: "row",
									}}
								>
									<HStack
										justifyContent="flex-start"
										w={{
											base: "full",

											sm: "unset",
										}}
									>
										{isEditing && (
											<>
												{canDeleteUsers && (
													<Tooltip label={t("delete")} placement="top">
														<IconButton
															aria-label="Delete"
															size="sm"
															onClick={() => {
																onDeletingUser(
																	editingUser as unknown as UserListItem,
																);

																onClose();
															}}
														>
															<DeleteIcon />
														</IconButton>
													</Tooltip>
												)}

												<Tooltip label={t("userDialog.usage")} placement="top">
													<IconButton
														aria-label="usage"
														size="sm"
														onClick={handleUsageToggle}
													>
														<UserUsageIcon />
													</IconButton>
												</Tooltip>

												{canResetUsage && (
													<Button onClick={handleResetUsage} size="sm">
														{t("userDialog.resetUsage")}
													</Button>
												)}

												{canRevokeSubscription && (
													<Button onClick={handleRevokeSubscription} size="sm">
														{t("userDialog.revokeSubscription")}
													</Button>
												)}
											</>
										)}
									</HStack>

									<HStack
										w="full"
										maxW={{ md: "50%", base: "full" }}
										justify="end"
									>
										<Button
											type="submit"
											size="sm"
											px="8"
											colorScheme="primary"
											leftIcon={loading ? <Spinner size="xs" /> : undefined}
											disabled={disabled}
										>
											{isEditing ? t("userDialog.editUser") : t("createUser")}
										</Button>
									</HStack>
								</HStack>
							</ModalFooter>
						</form>
					</Box>

					{limitReached && (
						<Flex
							position="absolute"
							inset={0}
							align="center"
							justify="center"
							direction="column"
							gap={4}
							bg="blackAlpha.600"
							color="white"
							textAlign="center"
							p={6}
							pointerEvents="none"
						>
							<Icon color="primary">
								<LimitLockIcon />
							</Icon>

							<Text fontSize="xl" fontWeight="semibold">
								{t("userDialog.limitReachedTitle")}
							</Text>

							<Text fontSize="md" maxW="sm">
								{usersLimit && usersLimit > 0
									? t("userDialog.limitReachedBody", {
											limit: usersLimit,

											active: activeUsersCount ?? usersLimit,
										})
									: t("userDialog.limitReachedContent")}
							</Text>
						</Flex>
					)}
				</ModalContent>
			</FormProvider>
		</Modal>
	);
};
