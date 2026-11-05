import { toast } from "components/ui/sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitStatus, useSubmitTimers } from "hooks/useSubmitTimers";
import dayjs from "dayjs";
import { Ban, Check, ChevronDown, Copy, Pencil, Plus, QrCode, RotateCcw, Sparkles, Trash2, UserPlus } from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form";
import ReactApexChart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { buttonVariants } from "components/ui/button";
import { Alert, AlertDescription } from "components/ui/alert";
import { Badge } from "components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "components/ui/collapsible";
import { DateTimeField } from "components/ui/date-time-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { userEntityPage } from "components/entityPage/EntityOverviews";
import { FormField } from "components/ui/form-field";
import { Input } from "components/ui/input";
import { DataSizeField } from "components/ui/data-size-field";
import { NumberField } from "components/ui/number-field";
import { Label } from "components/ui/label";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "components/ui/select";
import { Switch } from "components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { Textarea } from "components/ui/textarea";
import { resetStrategy } from "constants/UserSettings";
import { type FilterUsageType, useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { useColorMode } from "lib/color-mode";
import { cn } from "lib/cn";
import { fetch as apiFetch } from "service/http";
import { AdminRole, AdminTrafficLimitMode, UserPermissionToggle } from "types/Admin";
import type { User, UserCreate, UserCreateWithService, UserListItem } from "types/User";
import {
	canDeleteUserByTrafficCap,
	canViewUserTraffic,
	getAdminTrafficScope,
	isUserManagementLocked,
} from "utils/adminTraffic";
import { copyTextToClipboard } from "utils/clipboard";
import { getConfigLabelFromLink } from "utils/configLabel";
import { relativeExpiryDate } from "utils/dateFormatter";
import { addQuickExpiry } from "utils/expiry";
import { formatBytes } from "utils/formatByte";
import { generateUserLinks } from "utils/userLinks";
import { DeleteConfirmDialog } from "./dialogs/ConfirmDialog";
import { GroupSelect } from "components/labels/GroupSelect";
import { TagsSelect } from "components/labels/TagsSelect";
import { useInvalidateLabels, useTags } from "service/labels";
import { createUsageConfig, UsageFilter } from "./UsageFilter";

export type UserDialogProps = {};
export type FormType = Pick<
	UserCreate,
	| "username"
	| "status"
	| "expire"
	| "data_limit"
	| "ip_limit"
	| "data_limit_reset_strategy"
	| "on_hold_expire_duration"
	| "note"
	| "telegram_id"
	| "contact_number"
	| "flow"
	| "credential_key"
> & {
	credential_key: string | null;
	manual_key_entry: boolean;
	service_id: number | null;
	next_plan_enabled: boolean;
	next_plan_data_limit: number | null;
	next_plan_expire: number | null;
	next_plan_add_remaining_traffic: boolean;
	next_plan_fire_on_either: boolean;
	speed_limit: number | null;
	group_id: number | null;
	tags: string[];
};

type TabValue = "details" | "usage" | "links";
type AutoRenewRule = {
	id: string;
	dataLimit: number | null;
	expire: number | null;
	addRemaining: boolean;
	fireOnEither: boolean;
};
type RuleDraft = {
	/** Index of the rule being edited, or null when adding one. */
	index: number | null;
	data: string;
	days: string;
	addRemaining: boolean;
	fireOnEither: boolean;
};

const BYTES_PER_GB = 1073741824;
const SUCCESS_CLOSE_DELAY_MS = 1000;
const COPY_FEEDBACK_MS = 1200;
const CREDENTIAL_KEY_REGEX =
	/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const allowedFlows = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"];
const usernameRegex = /^[A-Za-z0-9._@-]{3,32}$/;
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ON_HOLD_QUICK_DAYS = [7, 30, 60, 90, 180, 365];

const createId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const formatUser = (user: User): FormType => {
	const nextPlan = user.next_plans?.[0] ?? null;
	return {
		...user,
		flow: user.flow ?? "",
		data_limit: user.data_limit ? Number((user.data_limit / BYTES_PER_GB).toFixed(5)) : user.data_limit,
		ip_limit: user.ip_limit && user.ip_limit > 0 ? user.ip_limit : null,
		speed_limit:
			user.speed_limit_kbps && user.speed_limit_kbps > 0 ? Number((user.speed_limit_kbps / 1000).toFixed(2)) : null,
		on_hold_expire_duration: user.on_hold_expire_duration
			? Number(user.on_hold_expire_duration / (24 * 60 * 60))
			: user.on_hold_expire_duration,
		service_id: user.service_id ?? null,
		credential_key: user.credential_key ?? null,
		manual_key_entry: false,
		next_plan_enabled: Boolean(nextPlan),
		next_plan_data_limit: nextPlan?.data_limit ? Number((nextPlan.data_limit / BYTES_PER_GB).toFixed(5)) : null,
		next_plan_expire: nextPlan?.expire ?? null,
		next_plan_add_remaining_traffic: nextPlan?.add_remaining_traffic ?? false,
		next_plan_fire_on_either: nextPlan?.fire_on_either ?? true,
		telegram_id: user.telegram_id ?? "",
		contact_number: user.contact_number ?? "",
		group_id: user.group?.id ?? null,
		tags: user.tags ?? [],
	};
};

const getDefaultValues = (): FormType => ({
	data_limit: null,
	ip_limit: null,
	speed_limit: null,
	expire: null,
	credential_key: null,
	manual_key_entry: false,
	flow: "",
	username: "",
	data_limit_reset_strategy: "no_reset",
	status: "active",
	on_hold_expire_duration: null,
	note: "",
	service_id: null,
	next_plan_enabled: false,
	next_plan_data_limit: null,
	next_plan_expire: null,
	next_plan_add_remaining_traffic: false,
	next_plan_fire_on_either: true,
	telegram_id: "",
	contact_number: "",
	group_id: null,
	tags: [],
});

const normalizeDecimalText = (value: string) =>
	value
		.replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
		.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
		.replace(/[٫٬,]/g, ".")
		.trim();

/** `null` for empty input, `NaN` for anything that is not a plain decimal. */
const parseDecimalInput = (value: unknown): number | null => {
	if (value === null || typeof value === "undefined") return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const normalized = normalizeDecimalText(raw);
	if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const gigabytesToBytes = (gigabytes: number) => Math.round(gigabytes * BYTES_PER_GB);

const buildSchema = (isEditing: boolean) => {
	const baseSchema = {
		username: isEditing
			? z.string().min(1)
			: z.string().regex(usernameRegex, {
					message:
						"Username only can be 3 to 32 characters and contain a-z, A-Z, 0-9, underscores, hyphens, dots, or @.",
				}),
		flow: z
			.string()
			.optional()
			.transform((val) => (val === "" || typeof val === "undefined" ? null : val))
			.refine((val) => val === null || allowedFlows.includes(val), "Unsupported flow"),
		service_id: z
			.union([z.string(), z.number()])
			.nullable()
			.transform((value) => {
				if (value === "" || value === null || typeof value === "undefined") return null;
				const parsed = Number(value);
				return Number.isNaN(parsed) ? null : parsed;
			}),
		data_limit: z
			.union([z.string(), z.number(), z.null()])
			.transform((value, ctx) => {
				const parsed = parseDecimalInput(value);
				if (parsed === null) return 0;
				if (!Number.isFinite(parsed) || parsed < 0) {
					ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid non-negative data limit." });
					return z.NEVER;
				}
				return gigabytesToBytes(parsed);
			}),
		expire: z.number().nullable(),
		data_limit_reset_strategy: z.string(),
		note: z.union([z.string(), z.null(), z.undefined()]).transform((value) => (typeof value === "string" ? value : "")),
		group_id: z.number().nullable().optional().transform((value) => value ?? null),
		tags: z.array(z.string()).optional().transform((value) => value ?? []),
		telegram_id: z.union([z.string(), z.null(), z.undefined()]).transform((value) => (typeof value === "string" ? value : "")),
		contact_number: z.union([z.string(), z.null(), z.undefined()]).transform((value) => (typeof value === "string" ? value : "")),
		next_plan_enabled: z.boolean().default(false),
		next_plan_data_limit: z
			.union([z.string(), z.number(), z.null()])
			.transform((value, ctx) => {
				const parsed = parseDecimalInput(value);
				if (parsed === null) return null;
				if (!Number.isFinite(parsed) || parsed < 0) {
					ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid non-negative data limit." });
					return z.NEVER;
				}
				return parsed;
			}),
		next_plan_expire: z.union([z.number(), z.string(), z.null()]).transform((value) => {
			if (value === "" || value === null || typeof value === "undefined") return null;
			const parsed = Number(value);
			return Number.isNaN(parsed) ? null : parsed;
		}),
		next_plan_add_remaining_traffic: z.boolean().default(false),
		next_plan_fire_on_either: z.boolean().default(true),
		speed_limit: z
			.union([z.number().min(0), z.null()])
			.optional()
			.transform((value) => {
				if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
				return Math.round(value * 100) / 100;
			}),
		ip_limit: z
			.union([z.number().min(0), z.null()])
			.optional()
			.transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : null)),
		manual_key_entry: z.boolean().default(false),
		credential_key: z
			.union([z.string(), z.null(), z.undefined()])
			.transform((value) => {
				if (!value || typeof value !== "string") return null;
				const trimmed = value.trim();
				return trimmed === "" ? null : trimmed;
			})
			.nullable(),
	};

	return z
		.discriminatedUnion("status", [
			z.object({ status: z.literal("active"), ...baseSchema }),
			z.object({ status: z.literal("disabled"), ...baseSchema }),
			z.object({ status: z.literal("limited"), ...baseSchema }),
			z.object({ status: z.literal("expired"), ...baseSchema }),
			z.object({
				status: z.literal("on_hold"),
				on_hold_expire_duration: z.coerce
					.number()
					.min(0.1, "Required")
					.transform((d) => d * (24 * 60 * 60)),
				...baseSchema,
			}),
		])
		.superRefine((values, ctx) => {
			if (!values.manual_key_entry) return;
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
					message: "Credential key must be a 32-character hexadecimal string or UUID.",
				});
			}
		});
};

const deriveDaysFromSeconds = (value: unknown): number | null => {
	if (typeof value !== "number" || value <= 0) return null;
	const diff = dayjs.unix(value).utc().local().diff(dayjs(), "day", true);
	return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
};

const convertDaysToSecondsFromNow = (days: number) => dayjs().add(days, "day").endOf("day").utc().unix();

/** Digits with an optional decimal point, the only shape a numeric input may hold while typing. */
const isDecimalDraft = (raw: string) => /^[0-9]*\.?[0-9]*$/.test(raw);

/** A numeric input with a unit suffix, for GB, Mbps and days. */
const UnitInput = ({
	id,
	value,
	onChange,
	unit,
	disabled,
	invalid,
	integer,
}: {
	id?: string;
	value: string;
	onChange: (raw: string) => void;
	unit: string;
	disabled?: boolean;
	invalid?: boolean;
	integer?: boolean;
}) => (
	<NumberField
		id={id}
		value={value}
		onChange={onChange}
		unit={unit}
		disabled={disabled}
		invalid={invalid}
		inputMode={integer ? "numeric" : "decimal"}
	/>
);

export const UserDialog: FC<UserDialogProps> = () => {
	const editingUser = useDashboard((state) => state.editingUser);
	const isCreatingNewUser = useDashboard((state) => state.isCreatingNewUser);
	const onCreateUser = useDashboard((state) => state.onCreateUser);
	const editUser = useDashboard((state) => state.editUser);
	const fetchUserUsage = useDashboard((state) => state.fetchUserUsage);
	const deleteUser = useDashboard((state) => state.deleteUser);
	const onEditingUser = useDashboard((state) => state.onEditingUser);
	const createUserWithService = useDashboard((state) => state.createUserWithService);
	const usersLimit = useDashboard((state) => state.users.users_limit ?? null);
	const activeUsersCount = useDashboard((state) => state.users.active_total ?? null);
	const isUserLimitReached = useDashboard((state) => state.isUserLimitReached);
	const linkTemplates = useDashboard((state) => state.linkTemplates);
	const setQRCode = useDashboard((state) => state.setQRCode);
	const setSubLink = useDashboard((state) => state.setSubLink);
	const editingUserInitialTab = useDashboard((state) => state.editingUserInitialTab);

	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	
	const { colorMode } = useColorMode();
	const { userData, getUserIsSuccess } = useGetUser();

	const isEditing = !!editingUser;
	const isOpen = isCreatingNewUser || isEditing;
	const limitReached = isUserLimitReached && !isEditing;
	const DATA_UNIT = "GB";
	const SPEED_UNIT = "Mbps";
	const DAYS_UNIT = t("userDialog.days");

	const [initialValues] = useState<FormType>(() => (editingUser ? formatUser(editingUser) : getDefaultValues()));
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
	const [loading, setLoading] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<TabValue>("details");
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [usageFilter, setUsageFilter] = useState("1m");
	const [usageFetched, setUsageFetched] = useState(false);
	const [usage, setUsage] = useState(() => createUsageConfig(colorMode, t("userDialog.total")));
	const [randomUsernameLoading, setRandomUsernameLoading] = useState(false);
	const [otherInfoOpen, setOtherInfoOpen] = useState(false);
	const [autoRenewOpen, setAutoRenewOpen] = useState(false);
	const usageFetchSequence = useRef(0);
	const { closeTimerRef: successCloseTimerRef, clearSubmitTimers, showSubmitError } = useSubmitTimers(setSubmitStatus);
	const syncedUserRef = useRef(editingUser);
	const bodyRef = useRef<HTMLDivElement>(null);
	const scrollBodyToEnd = () =>
		window.requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" }));

	const formSchema = useMemo(() => buildSchema(isEditing), [isEditing]);
	const { data: knownUserTags = [] } = useTags("user");
	const invalidateLabels = useInvalidateLabels();
	const form = useForm<FormType>({
		defaultValues: initialValues,
		resolver: zodResolver(formSchema as unknown as Parameters<typeof zodResolver>[0]) as unknown as Resolver<FormType>,
		mode: "onChange",
		reValidateMode: "onChange",
	});
	const { errors } = form.formState;

	const manualKeyEntryEnabled = useWatch({ control: form.control, name: "manual_key_entry" });
	const usernameValue = useWatch({ control: form.control, name: "username" });
	const [dataLimit, userStatus, expireValue] = useWatch({
		control: form.control,
		name: ["data_limit", "status", "expire"],
	});
	const isOnHold = userStatus === "on_hold";
	const hasExistingKey = Boolean(editingUser?.credential_key);

	// Permissions, mirrored from the admin's role and grants.
	const hasPrivilegedRole = Boolean(
		getUserIsSuccess && (userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess),
	);
	const hasFullAccess = Boolean(getUserIsSuccess && userData.role === AdminRole.FullAccess);
	const canSetCustomKey =
		hasPrivilegedRole || Boolean(userData.permissions?.users?.[UserPermissionToggle.AllowCustomKey]);
	const canDeleteUsers = hasFullAccess || Boolean(userData.permissions?.users?.[UserPermissionToggle.Delete]);
	const canResetUsage = hasFullAccess || Boolean(userData.permissions?.users?.[UserPermissionToggle.ResetUsage]);
	const canConfigurePeriodicUsageReset =
		hasFullAccess || Boolean(userData.permissions?.users?.[UserPermissionToggle.PeriodicUsageReset]);
	const canRevokeSubscription = hasFullAccess || Boolean(userData.permissions?.users?.[UserPermissionToggle.Revoke]);
	const speedLimitEditable =
		userData.user_speed_limit_enabled !== false &&
		(userData.role === AdminRole.FullAccess ||
			Boolean(userData.permissions?.users?.[UserPermissionToggle.ManageSpeedLimit]));
	const ipLimitEditable =
		userData.role === AdminRole.FullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.ManageIPLimit]);
	const canViewTraffic = canViewUserTraffic(userData, editingUser?.service_id ?? null);

	// Services: a non-privileged admin with one service is always scoped to it.
	const rawServices = useServicesStore((state) => state.serviceOptions);
	const services = Array.isArray(rawServices) ? rawServices : [];
	const servicesLoading = useServicesStore((state) => state.isOptionsLoading);
	const hasServices = services.length > 0;
	const [selectedServiceId, setSelectedServiceId] = useState<number | null>(editingUser?.service_id ?? null);
	const selectedService = services.find((service) => service.id === selectedServiceId) ?? null;
	const nonSudoSingleService = !hasPrivilegedRole && services.length === 1;
	const effectiveServiceId = isEditing
		? (editingUser?.service_id ?? null)
		: (selectedServiceId ?? (nonSudoSingleService ? (services[0]?.id ?? null) : null));
	const userManagementLocked = isUserManagementLocked(userData, effectiveServiceId);
	const requiresServiceScope = Boolean(userData.use_service_traffic_limits && !hasPrivilegedRole);
	const canDeleteUsersVisible = canDeleteUsers && canDeleteUserByTrafficCap(userData, editingUser);
	const canResetUsageVisible = canResetUsage && canViewTraffic && !userManagementLocked;
	const canRevokeSubscriptionVisible = canRevokeSubscription && !userManagementLocked;
	const currentTrafficScope = getAdminTrafficScope(userData, effectiveServiceId);
	const isCreatedTrafficScope = Boolean(
		currentTrafficScope?.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic && !hasPrivilegedRole,
	);
	const isServiceManagedUser = Boolean(editingUser?.service_id);
	const showServiceSelector = hasPrivilegedRole || services.length !== 1;

	// Auto-renew rules. Only the first rule is sent with the user; the rest are queued locally.
	const [autoRenewRules, setAutoRenewRules] = useState<AutoRenewRule[]>(() =>
		initialValues.next_plan_enabled
			? [
					{
						id: createId(),
						dataLimit: initialValues.next_plan_data_limit,
						expire: initialValues.next_plan_expire,
						addRemaining: initialValues.next_plan_add_remaining_traffic,
						fireOnEither: initialValues.next_plan_fire_on_either,
					},
				]
			: [],
	);
	const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);

	const expireHelperText = useMemo(() => {
		if (!expireValue) return null;
		const { status, time } = relativeExpiryDate(expireValue);
		return t(status, { time });
	}, [expireValue, t]);

	const remainingDataInfo = useMemo(() => {
		if (!isEditing || !editingUser || !canViewTraffic) return null;
		const parsedLimit = parseDecimalInput(dataLimit);
		if (!parsedLimit || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
			return t("userDialog.remainingDataUnlimited");
		}
		const remainingBytes = Math.max(parsedLimit * BYTES_PER_GB - (editingUser.used_traffic ?? 0), 0);
		return remainingBytes <= 0 ? t("userDialog.remainingDataLimited") : formatBytes(remainingBytes, 2);
	}, [canViewTraffic, isEditing, editingUser, dataLimit, t]);

	const statusNotice = useMemo(() => {
		if (!isEditing) return null;
		switch (userStatus) {
			case "limited":
				return t("userDialog.statusNoticeLimited");
			case "expired":
				return t("userDialog.statusNoticeExpired");
			case "on_hold":
				return t("userDialog.statusNoticeOnHold");
			case "disabled":
				return t("userDialog.statusNoticeDisabled");
			default:
				return null;
		}
	}, [isEditing, userStatus, t]);

	const quickExpiryOptions = [
		{ label: t("userDialog.quickSelectOneMonth"), amount: 1, unit: "month" },
		{ label: t("userDialog.quickSelectThreeMonths"), amount: 3, unit: "month" },
		{ label: t("userDialog.quickSelectOneYear"), amount: 1, unit: "year" },
	] as const;

	const formatLink = useCallback((link?: string | null) => {
		if (!link) return "";
		return link.startsWith("/") ? window.location.origin + link : link;
	}, []);

	const subscriptionLinks = useMemo(() => {
		if (!editingUser) return [];
		const urls = editingUser.subscription_urls ?? {};
		const order = ["username-key", "key", "key-username", "token"] as const;
		const labels: Record<(typeof order)[number], string> = {
			"username-key": t("userDialog.links.subscriptionUsernameKey"),
			key: t("userDialog.links.subscriptionKey"),
			"key-username": t("userDialog.links.subscriptionKeyUsername"),
			token: t("userDialog.links.subscriptionToken"),
		};
		const orderIndex = new Map(order.map((key, index) => [key, index]));
		const results = Object.entries(urls)
			.map(([key, value]) => {
				const url = formatLink(value);
				if (!url) return null;
				const [baseKeyRaw, variant] = key.split("@", 2);
				const baseKey = baseKeyRaw as (typeof order)[number];
				const baseLabel = labels[baseKey] ?? baseKeyRaw;
				return {
					key,
					label: variant ? `${baseLabel} (${variant})` : baseLabel,
					url,
					order: orderIndex.get(baseKey) ?? order.length,
					variant: variant ?? "",
				};
			})
			.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
			.sort((a, b) => {
				if (a.order !== b.order) return a.order - b.order;
				const aHasVariant = a.variant !== "";
				const bHasVariant = b.variant !== "";
				if (aHasVariant !== bHasVariant) return aHasVariant ? 1 : -1;
				return a.variant.localeCompare(b.variant, undefined, { numeric: true });
			})
			.map(({ key, label, url }) => ({ key, label, url }));

		if (results.length === 0 && editingUser.subscription_url) {
			const fallback = formatLink(editingUser.subscription_url);
			if (fallback) results.push({ key: "primary", label: t("userDialog.links.subscription"), url: fallback });
		}
		return results;
	}, [editingUser, formatLink, t]);

	const userLinks = useMemo(
		() => (editingUser ? generateUserLinks(editingUser, linkTemplates, { includeInactive: true }) : []),
		[editingUser, linkTemplates],
	);
	const configLinksText = useMemo(() => userLinks.join("\n"), [userLinks]);
	const configItems = useMemo(
		() =>
			userLinks.map((link, index) => ({
				link,
				label: getConfigLabelFromLink(link) || t("userDialog.links.configFallback", { index: index + 1 }),
			})),
		[userLinks, t],
	);

	const usageTitle = t("userDialog.total");
	const fetchUsageWithFilter = useCallback(
		(query: FilterUsageType) => {
			if (!editingUser) return;
			const requestId = ++usageFetchSequence.current;
			fetchUserUsage(editingUser as unknown as UserListItem, query)
				.then((data) => {
					if (requestId !== usageFetchSequence.current) return;
					const usages = (data as unknown as { usages: Record<string, { used_traffic: number; node_name: string }> })
						.usages;
					const series: number[] = [];
					const labels: string[] = [];
					for (const key in usages) {
						const usedTraffic = Number(usages[key]?.used_traffic ?? 0);
						if (!usedTraffic || usedTraffic <= 0) {
							continue;
						}
						series.push(usedTraffic);
						labels.push(usages[key].node_name);
					}
					setUsage(createUsageConfig(colorMode, usageTitle, series, labels));
				})
				.catch((fetchError) => {
					if (requestId === usageFetchSequence.current) console.error("Failed to fetch user usage:", fetchError);
				});
		},
		[editingUser, colorMode, usageTitle, fetchUserUsage],
	);

	// Deep links open the usage tab directly.
	useEffect(() => {
		if (!isEditing || !canViewTraffic || editingUserInitialTab !== 1 || usageFetched) return;
		setUsageFetched(true);
		setTab("usage");
		fetchUsageWithFilter({ start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00") });
	}, [isEditing, canViewTraffic, editingUserInitialTab, usageFetched, fetchUsageWithFilter]);

	const handleTabChange = (value: string) => {
		const next = value as TabValue;
		setTab(next);
		if (next === "usage" && isEditing && !usageFetched) {
			setUsageFetched(true);
			fetchUsageWithFilter({ start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00") });
		}
	};

	useEffect(() => {
		if (isOpen) useServicesStore.getState().fetchServiceOptions({ limit: 1000 });
	}, [isOpen]);

	useEffect(() => {
		if (isEditing) {
			setSelectedServiceId(editingUser?.service_id ?? services[0]?.id ?? null);
			return;
		}
		if (!hasPrivilegedRole && services[0]) {
			setSelectedServiceId((current) => current ?? services[0].id);
		}
	}, [isEditing, editingUser, services, hasPrivilegedRole]);

	// The first auto-renew rule is the one the form sends.
	useEffect(() => {
		const firstRule = autoRenewRules[0];
		form.setValue("next_plan_enabled", Boolean(firstRule), { shouldDirty: false });
		form.setValue("next_plan_data_limit", firstRule?.dataLimit ?? null, { shouldDirty: false });
		form.setValue("next_plan_expire", firstRule?.expire ?? null, { shouldDirty: false });
		form.setValue("next_plan_add_remaining_traffic", firstRule?.addRemaining ?? false, { shouldDirty: false });
		form.setValue("next_plan_fire_on_either", firstRule?.fireOnEither ?? true, { shouldDirty: false });
	}, [autoRenewRules, form]);

	// The list row opens the dialog first and the full user record arrives after it. Re-sync the form when it does.
	useEffect(() => {
		if (!editingUser || editingUser === syncedUserRef.current || typeof editingUser.username !== "string") return;
		syncedUserRef.current = editingUser;
		const next = formatUser(editingUser);
		form.reset(next);
		setAutoRenewRules(
			next.next_plan_enabled
				? [
						{
							id: createId(),
							dataLimit: next.next_plan_data_limit,
							expire: next.next_plan_expire,
							addRemaining: next.next_plan_add_remaining_traffic,
							fireOnEither: next.next_plan_fire_on_either,
						},
					]
				: [],
		);
		setRuleDraft(null);
		setSelectedServiceId(editingUser.service_id ?? null);
	}, [editingUser, form]);

	useEffect(() => {
		if (!canSetCustomKey) {
			form.setValue("manual_key_entry", false, { shouldDirty: true });
			form.setValue("credential_key", null, { shouldDirty: true });
		}
	}, [canSetCustomKey, form]);

	useEffect(() => {
		if (!copiedKey) return undefined;
		const timer = window.setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS);
		return () => window.clearTimeout(timer);
	}, [copiedKey]);

	const copyValue = (key: string, value: string) => {
		void copyTextToClipboard(value)
			.then(() => setCopiedKey(key))
			.catch(() => undefined);
	};

	const fetchUserForQr = useCallback(async (username: string) => {
		try {
			return await apiFetch<User>(`/user/${encodeURIComponent(username)}`);
		} catch (_error) {
			return null;
		}
	}, []);

	const openUserQrDialog = useCallback(
		(user: User | UserListItem | null | undefined) => {
			if (!user) return;
			const currentLinkTemplates = useDashboard.getState().linkTemplates ?? linkTemplates;
			const configLinks = generateUserLinks(user, currentLinkTemplates, { includeInactive: true });
			const subscriptionLink =
				formatLink((user as User).subscription_url) ||
				formatLink((user as User).key_subscription_url) ||
				formatLink(Object.values((user as User).subscription_urls ?? {})[0]);
			if (!configLinks.length && !subscriptionLink) return;
			setQRCode(configLinks, user.username);
			setSubLink(subscriptionLink || null);
		},
		[formatLink, linkTemplates, setQRCode, setSubLink],
	);

	const onClose = () => {
		clearSubmitTimers();
		onCreateUser(false);
		onEditingUser(null);
	};

	// Auto-renew rule editor.
	const startRuleDraft = (index: number | null) => {
		const rule = index === null ? null : (autoRenewRules[index] ?? null);
		setAutoRenewOpen(true);
		scrollBodyToEnd();
		setRuleDraft({
			index,
			data: rule?.dataLimit != null ? String(rule.dataLimit) : "",
			days: rule ? String(deriveDaysFromSeconds(rule.expire) ?? "") : "",
			addRemaining: rule?.addRemaining ?? false,
			fireOnEither: rule?.fireOnEither ?? true,
		});
	};

	const saveRuleDraft = () => {
		if (!ruleDraft) return;
		setError(null);
		const parsedLimit = ruleDraft.data.trim() === "" ? null : parseDecimalInput(ruleDraft.data.trim());
		if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || Number.isNaN(parsedLimit) || parsedLimit < 0)) {
			setError(t("userDialog.autoRenewInvalidLimit"));
			return;
		}
		const parsedDays = ruleDraft.days.trim() === "" ? null : Number.parseFloat(ruleDraft.days.trim());
		if (parsedDays !== null && (!Number.isFinite(parsedDays) || Number.isNaN(parsedDays) || parsedDays < 0)) {
			setError(t("userDialog.autoRenewInvalidDays"));
			return;
		}
		const rule: AutoRenewRule = {
			id: (ruleDraft.index !== null ? autoRenewRules[ruleDraft.index]?.id : null) ?? createId(),
			dataLimit: parsedLimit,
			expire: parsedDays !== null ? convertDaysToSecondsFromNow(Math.round(parsedDays)) : null,
			addRemaining: ruleDraft.addRemaining,
			fireOnEither: ruleDraft.fireOnEither,
		};
		setAutoRenewRules((previous) => {
			const next = [...previous];
			if (ruleDraft.index !== null) next[ruleDraft.index] = rule;
			else next.push(rule);
			return next;
		});
		setRuleDraft(null);
	};

	const deleteRule = (index: number) => {
		setAutoRenewRules((previous) => previous.filter((_, i) => i !== index));
		if (ruleDraft?.index === index) setRuleDraft(null);
	};

	const applyApiError = (err: unknown) => {
		const response = (err as { response?: { status?: number; _data?: { detail?: unknown } } })?.response;
		if (response?.status === 409 || response?.status === 400) {
			setError(response._data?.detail as string);
		}
		if (response?.status === 422 && response._data?.detail && typeof response._data.detail === "object") {
			Object.entries(response._data.detail as Record<string, string>).forEach(([key, message]) => {
				setError(message);
				form.setError(key as "username" | "data_limit" | "expire" | "service_id", { type: "custom", message });
			});
		}
		setLoading(false);
		showSubmitError();
	};

	const submit = (values: FormType) => {
		if (submitStatus !== "idle") return;
		setLoading(true);
		setSubmitStatus("loading");
		setError(null);

		const failSubmit = (message?: string) => {
			if (message) setError(message);
			setLoading(false);
			showSubmitError();
		};

		if (usersLimit && usersLimit > 0 && activeUsersCount !== null && activeUsersCount >= usersLimit) {
			failSubmit(t("userDialog.usersLimitReached", { active: activeUsersCount, limit: usersLimit }));
			return;
		}
		if (limitReached || userManagementLocked) {
			failSubmit();
			return;
		}

		// Flow is not sent: the backend reads it from the inbound, and an absent field leaves the stored value alone.
		const {
			service_id: _serviceId,
			next_plan_enabled,
			next_plan_data_limit,
			next_plan_expire,
			next_plan_add_remaining_traffic,
			next_plan_fire_on_either,
			flow,
			status,
			data_limit,
			data_limit_reset_strategy,
			on_hold_expire_duration,
			ip_limit,
			speed_limit,
			credential_key,
			manual_key_entry,
			...rest
		} = values;

		const maxDataLimitPerUser = userData?.permissions?.users?.max_data_limit_per_user;
		const allowUnlimitedData =
			hasFullAccess || Boolean(userData?.permissions?.users?.[UserPermissionToggle.AllowUnlimitedData]);
		const dataLimitBytes = data_limit || 0;
		const setDataLimitError = (message: string) => {
			form.setError("data_limit", { type: "manual", message });
			failSubmit(message);
		};

		if (isCreatedTrafficScope && dataLimitBytes <= 0) {
			setDataLimitError(t("userDialog.createdTrafficUnlimitedNotAllowed"));
			return;
		}
		if (isCreatedTrafficScope && isEditing && editingUser) {
			const usedTraffic = Math.max(0, editingUser.used_traffic ?? 0);
			if (dataLimitBytes > 0 && dataLimitBytes < usedTraffic) {
				setDataLimitError(t("userDialog.dataLimitBelowUsedTraffic", { used: formatBytes(usedTraffic, 2) }));
				return;
			}
		}
		if (maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined) {
			if (dataLimitBytes === 0 && !allowUnlimitedData) {
				setDataLimitError(t("userDialog.unlimitedNotAllowed", { max: (maxDataLimitPerUser / BYTES_PER_GB).toFixed(2) }));
				return;
			}
			if (dataLimitBytes > 0 && dataLimitBytes > maxDataLimitPerUser) {
				setDataLimitError(
					t("userDialog.dataLimitExceedsMax", {
						original: (dataLimitBytes / BYTES_PER_GB).toFixed(2),
						max: (maxDataLimitPerUser / BYTES_PER_GB).toFixed(2),
					}),
				);
				return;
			}
		}

		const minDataLimitPerUser =
			userData?.permissions?.users?.min_data_limit_per_user;
		const dataLimitUnchanged =
			isEditing && (editingUser?.data_limit ?? 0) === dataLimitBytes;
		if (
			minDataLimitPerUser &&
			dataLimitBytes > 0 &&
			dataLimitBytes < minDataLimitPerUser &&
			!dataLimitUnchanged
		) {
			setDataLimitError(
				t("userDialog.dataLimitBelowMin", {
					min: (minDataLimitPerUser / BYTES_PER_GB).toFixed(2),
				}),
			);
			return;
		}

		const normalizedNextPlanDataLimit =
			next_plan_enabled && next_plan_data_limit && next_plan_data_limit > 0
				? gigabytesToBytes(Number(next_plan_data_limit))
				: 0;
		const setNextPlanError = (message: string) => {
			form.setError("next_plan_data_limit", { type: "manual", message });
			failSubmit(message);
		};
		if (maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined) {
			if (normalizedNextPlanDataLimit > 0 && normalizedNextPlanDataLimit > maxDataLimitPerUser) {
				setNextPlanError(
					t("userDialog.nextPlanDataLimitExceedsMax", {
						original: (normalizedNextPlanDataLimit / BYTES_PER_GB).toFixed(2),
						max: (maxDataLimitPerUser / BYTES_PER_GB).toFixed(2),
					}),
				);
				return;
			}
			if (normalizedNextPlanDataLimit === 0 && next_plan_enabled && !allowUnlimitedData) {
				setNextPlanError(
					t("userDialog.nextPlanUnlimitedNotAllowed", { max: (maxDataLimitPerUser / BYTES_PER_GB).toFixed(2) }),
				);
				return;
			}
		}

		if (
			minDataLimitPerUser &&
			normalizedNextPlanDataLimit > 0 &&
			normalizedNextPlanDataLimit < minDataLimitPerUser
		) {
			setNextPlanError(
				t("userDialog.nextPlanDataLimitBelowMin", {
					min: (minDataLimitPerUser / BYTES_PER_GB).toFixed(2),
				}),
			);
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
		const normalizedSpeedLimitKbps =
			typeof speed_limit === "number" && Number.isFinite(speed_limit) && speed_limit > 0 ? Math.round(speed_limit * 1000) : 0;
		const normalizedIpLimit =
			typeof ip_limit === "number" && Number.isFinite(ip_limit) && ip_limit > 0 ? Math.floor(ip_limit) : 0;
		const normalizedStatus = status === "active" || status === "disabled" || status === "on_hold" ? status : "active";

		if (!isEditing) {
			const createServiceId = hasPrivilegedRole
				? selectedServiceId
				: (selectedServiceId ?? (nonSudoSingleService ? (services[0]?.id ?? null) : null));
			if (!createServiceId) {
				failSubmit(t("userDialog.selectService"));
				return;
			}

			const serviceBody: UserCreateWithService = {
				username: values.username,
				service_id: createServiceId,
				note: values.note,
				telegram_id: values.telegram_id,
				contact_number: values.contact_number,
				group_id: values.group_id,
				tags: values.tags,
				status: normalizedStatus,
				expire: values.expire,
				data_limit: values.data_limit,
				ip_limit: normalizedIpLimit,
				speed_limit_kbps: normalizedSpeedLimitKbps,
				data_limit_reset_strategy: data_limit && data_limit > 0 ? data_limit_reset_strategy : "no_reset",
				on_hold_expire_duration: status === "on_hold" ? on_hold_expire_duration : null,
			};
			if (canSetCustomKey && manual_key_entry && credential_key) serviceBody.credential_key = credential_key;
			if (nextPlanPayload) serviceBody.next_plans = [nextPlanPayload];

			createUserWithService(serviceBody)
				.then(() => {
					void invalidateLabels();
					setSubmitStatus("success");
					const qrUserPromise = fetchUserForQr(values.username);
					toast.success(t("userDialog.userCreated", { username: values.username }), { duration: 3000 });
					successCloseTimerRef.current = window.setTimeout(() => {
						onClose();
						successCloseTimerRef.current = null;
						qrUserPromise.then((qrUser) => {
							window.setTimeout(() => openUserQrDialog(qrUser), 0);
						});
					}, SUCCESS_CLOSE_DELAY_MS);
				})
				.catch(applyApiError);
			return;
		}

		if (!selectedServiceId) {
			failSubmit(t("userDialog.selectService"));
			return;
		}

		const body: Record<string, unknown> = {
			...rest,
			data_limit,
			ip_limit: normalizedIpLimit,
			speed_limit_kbps: normalizedSpeedLimitKbps,
			status: normalizedStatus,
			on_hold_expire_duration: status === "on_hold" ? on_hold_expire_duration : null,
		};
		if (canConfigurePeriodicUsageReset) {
			body.data_limit_reset_strategy = data_limit && data_limit > 0 ? data_limit_reset_strategy : "no_reset";
		}
		if (canSetCustomKey && manual_key_entry && credential_key) body.credential_key = credential_key;
		if (nextPlanPayload) {
			body.next_plans = [nextPlanPayload];
		} else if (!next_plan_enabled && (editingUser?.next_plans?.length ?? 0) > 0) {
			body.next_plans = [];
		}
		if (selectedServiceId !== editingUser?.service_id && (!requiresServiceScope || !editingUser?.service_id)) {
			body.service_id = selectedServiceId;
		}

		editUser(editingUser?.username, body as UserCreate)
			.then(() => {
				void invalidateLabels();
				setSubmitStatus("success");
				toast.success(t("userDialog.userEdited", { username: values.username }), { duration: 3000 });
				successCloseTimerRef.current = window.setTimeout(() => {
					onClose();
					successCloseTimerRef.current = null;
				}, SUCCESS_CLOSE_DELAY_MS);
			})
			.catch(applyApiError);
	};

	const handleResetUsage = () => {
		if (!canResetUsageVisible) return;
		useDashboard.setState({ resetUsageUser: (editingUser as unknown as UserListItem) ?? null });
	};

	const handleRevokeSubscription = () => {
		if (!canRevokeSubscriptionVisible) return;
		useDashboard.setState({ revokeSubscriptionUser: (editingUser as unknown as UserListItem) ?? null });
	};

	const handleDeleteUser = async () => {
		if (!canDeleteUsersVisible || !editingUser) return;
		setDeleteLoading(true);
		try {
			await deleteUser(editingUser as unknown as UserListItem);
			toast.success(t("deleteUser.deleteSuccess", { username: editingUser.username }), { duration: 3000 });
			onClose();
		} finally {
			setDeleteLoading(false);
		}
	};

	const createRandomUsername = () => {
		setRandomUsernameLoading(true);
		const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		let result = "";
		for (let counter = 0; counter < 6; counter += 1) {
			result += characters.charAt(Math.floor(Math.random() * characters.length));
		}
		form.setValue("username", result, { shouldDirty: true, shouldValidate: true });
		form.trigger("username");
		window.setTimeout(() => setRandomUsernameLoading(false), 350);
	};

	const disabled = loading || limitReached || userManagementLocked;
	const serviceSelectionDisabled = disabled || (isEditing && requiresServiceScope);
	const submitDisabled = disabled || !form.formState.isValid;
	const title = isEditing
		? `${t("userDialog.editUserTitle")}${editingUser?.username ? ` ${editingUser.username}` : ""}`
		: t("createNewUser");

	const dataLimitSet = Boolean(dataLimit && Number(dataLimit) > 0);
	const toggleOnHold = () => {
		if (isOnHold) {
			form.setValue("status", "active", { shouldDirty: true });
			form.setValue("on_hold_expire_duration", null, { shouldDirty: true });
		} else {
			form.setValue("status", "on_hold", { shouldDirty: true });
			form.setValue("expire", null, { shouldDirty: true });
		}
	};

	const detailsTab = (
		<div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
			{statusNotice ? (
				<Alert className="sm:col-span-2">
					<AlertDescription>{statusNotice}</AlertDescription>
				</Alert>
			) : null}
			{isEditing && isServiceManagedUser ? (
				<Alert className="sm:col-span-2">
					<AlertDescription>
						{t("userDialog.serviceManagedNotice", { service: editingUser?.service_name ?? "" })}
					</AlertDescription>
				</Alert>
			) : null}
			{userManagementLocked ? (
				<Alert variant="destructive" className="sm:col-span-2">
					<AlertDescription>{t("userDialog.managementLocked")}</AlertDescription>
				</Alert>
			) : null}
			{showServiceSelector && !servicesLoading && !hasServices ? (
				<Alert variant="destructive" className="sm:col-span-2">
					<AlertDescription>
						{`${t("userDialog.noServicesAvailable")} ${t("userDialog.createServiceToManage")}`}
					</AlertDescription>
				</Alert>
			) : null}

			<FormField
				label={t("username")}
				htmlFor="user-username"
				error={errors.username?.message}
				description={`${usernameValue?.length ?? 0}/32`}
				className={cn(!isEditing && "sm:col-span-2")}
			>
				<div className="relative">
					<Input
						id="user-username"
						dir={isRTL ? "rtl" : "ltr"}
						disabled={disabled || isEditing}
						aria-invalid={!!errors.username || undefined}
						className={cn(!isEditing && "pe-10")}
						{...form.register("username")}
					/>
					{!isEditing ? (
						<button
							type="button"
							aria-label={t("userDialog.generateUsername")}
							title={t("userDialog.generateUsername")}
							disabled={disabled || randomUsernameLoading}
							onClick={createRandomUsername}
							className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "absolute inset-y-0.5 end-0.5")}
						>
							<Sparkles className={cn(randomUsernameLoading && "animate-pulse")} />
						</button>
					) : null}
				</div>
			</FormField>

			{isEditing ? (
				<FormField label={t("status")}>
					<div className="flex h-9 items-center justify-between rounded-md border px-3">
						<Badge variant="outline">{t(`status.${userStatus}`)}</Badge>
						<Controller
							name="status"
							control={form.control}
							render={({ field }) => (
								<Switch
									aria-label={t("status")}
									checked={field.value === "active"}
									disabled={disabled}
									onCheckedChange={(checked) => field.onChange(checked ? "active" : "disabled")}
								/>
							)}
						/>
					</div>
				</FormField>
			) : null}

			<Controller
				control={form.control}
				name="data_limit"
				render={({ field }) => (
					<FormField
						label={t("userDialog.dataLimit")}
						className={cn(!ipLimitEditable && "sm:col-span-2")}
						description={remainingDataInfo ? `${t("userDialog.remainingDataLabel")}: ${remainingDataInfo}` : undefined}
						error={errors.data_limit?.message}
					>
						<DataSizeField
							id="user-data-limit"
							valueGb={field.value ? String(field.value) : ""}
							onChangeGb={(raw) => field.onChange(raw)}
							disabled={disabled}
							invalid={!!errors.data_limit}
						/>
					</FormField>
				)}
			/>

			{ipLimitEditable ? (
				<Controller
					control={form.control}
					name="ip_limit"
					rules={{
						validate: (value) => {
							if (value === null || value === undefined) return true;
							if (typeof value !== "number" || Number.isNaN(value)) return t("userDialog.ipLimitValidation");
							return value >= 0 ? true : t("userDialog.ipLimitValidation");
						},
					}}
					render={({ field }) => (
						<FormField label={t("userDialog.ipLimitLabel")} error={errors.ip_limit?.message}>
							<NumberField
								id="user-ip-limit" inputMode="numeric"
								placeholder={t("userDialog.remainingDataUnlimited")}
								value={typeof field.value === "number" && field.value > 0 ? String(field.value) : ""}
								disabled={disabled}
								invalid={!!errors.ip_limit}
								onChange={(raw) => {
									const trimmed = raw.trim();
									if (!trimmed || trimmed === "-") {
										field.onChange(null);
										return;
									}
									const parsed = Number(trimmed);
									if (Number.isNaN(parsed)) return;
									field.onChange(parsed < 0 ? 0 : Math.floor(parsed));
								}}
							/>
						</FormField>
					)}
				/>
			) : null}

			{speedLimitEditable ? (
				<Controller
					control={form.control}
					name="speed_limit"
					render={({ field }) => (
						<FormField label={t("userDialog.speedLimitLabel")} error={errors.speed_limit?.message}>
							<UnitInput
								value={typeof field.value === "number" && field.value > 0 ? String(field.value) : ""}
								onChange={(raw) => {
									const parsed = Number(raw.trim());
									field.onChange(Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null);
								}}
								unit={SPEED_UNIT}
								disabled={disabled}
								invalid={!!errors.speed_limit}
							/>
						</FormField>
					)}
				/>
			) : null}

			<div className={cn("flex min-w-0 flex-col gap-2", !speedLimitEditable && "sm:col-span-2")}>
				<Label>{isOnHold ? t("expires.days") : t("userDialog.expiryDate")}</Label>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						{isOnHold ? (
							<Controller
								control={form.control}
								name="on_hold_expire_duration"
								render={({ field }) => (
									<UnitInput
										value={field.value ? String(field.value) : ""}
										unit={DAYS_UNIT} integer
										disabled={disabled}
										invalid={!!errors.on_hold_expire_duration}
										onChange={(raw) => {
											form.setValue("expire", null);
											if (!raw) {
												field.onChange(null);
												return;
											}
											if (!isDecimalDraft(raw)) return;
											const parsed = Number(raw);
											if (Number.isNaN(parsed) || parsed < 0) return;
											field.onChange(Math.round(parsed));
										}}
									/>
								)}
							/>
						) : (
							<Controller
								name="expire"
								control={form.control}
								render={({ field }) => {
									const selectedDate = field.value ? dayjs.unix(field.value).toDate() : null;
									const handleDateChange = (next: Date | null) => {
										form.setValue("on_hold_expire_duration", null, { shouldDirty: false });
										field.onChange(next ? dayjs(next).utc().unix() : null);
									};
									return (
										<>
											<DateTimeField
												id="user-expire"
												value={selectedDate}
												onChange={handleDateChange}
												placeholder={t("dateTimePicker.selectDate")}
												disabled={disabled}
												minDate={new Date()}
												quickSelects={quickExpiryOptions.map((option) => ({
													label: option.label,
													onClick: () => handleDateChange(addQuickExpiry(selectedDate, option.amount, option.unit)),
												}))}
											/>
											{expireHelperText ? <p className="mt-1 text-xs text-muted-foreground">{expireHelperText}</p> : null}
											{errors.expire?.message ? (
												<p role="alert" className="mt-1 text-xs text-destructive">
													{errors.expire.message}
												</p>
											) : null}
										</>
									);
								}}
							/>
						)}
					</div>
					<button
						type="button"
						disabled={disabled}
						onClick={toggleOnHold}
						className={buttonVariants({ variant: isOnHold ? "default" : "outline" })}
					>
						{t("onHold.button")}
					</button>
				</div>
				{isOnHold ? (
					<div className="grid grid-cols-6 gap-1 [&>button]:w-full [&>button]:px-0">
						{ON_HOLD_QUICK_DAYS.map((days) => (
							<button
								key={days}
								type="button"
								disabled={disabled}
								onClick={() => {
									form.setValue("expire", null);
									form.setValue("on_hold_expire_duration", days, { shouldDirty: true, shouldValidate: true });
								}}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{days}D
							</button>
						))}
					</div>
				) : null}
				{isOnHold && errors.on_hold_expire_duration?.message ? (
					<p role="alert" className="text-xs text-destructive">
						{errors.on_hold_expire_duration.message}
					</p>
				) : null}
			</div>

			{showServiceSelector ? (
				<FormField
					label={t("userDialog.selectServiceLabel")}
					className={cn(!dataLimitSet && "sm:col-span-2")}
					description={
						selectedService ? (
							<span className="flex flex-col gap-0.5">
								{selectedService.description ? <span>{selectedService.description}</span> : null}
								<span>
									{t("userDialog.serviceSummary", {
										hosts: selectedService.host_count,
										users: selectedService.user_count,
									})}
								</span>
							</span>
						) : undefined
					}
				>
					<Select
						value={selectedServiceId ? String(selectedServiceId) : ""}
						onValueChange={(value) => setSelectedServiceId(Number(value))}
						disabled={serviceSelectionDisabled || servicesLoading}
					>
						<SelectTrigger id="user-service" aria-label={t("userDialog.selectServiceLabel")}>
							<SelectValue placeholder={t("userDialog.selectService")} />
						</SelectTrigger>
						<SelectContent>
							{services.map((service) => {
								const isBroken = service.broken === true || service.has_hosts === false;
								return (
									<SelectItem key={service.id} value={String(service.id)} disabled={isBroken}>
										<SelectItemText>{service.name}</SelectItemText>
										{service.description ? (
											<span className="line-clamp-2 text-xs text-muted-foreground">{service.description}</span>
										) : null}
										<span className="text-xs text-muted-foreground">
											{t("userDialog.serviceSummary", { hosts: service.host_count, users: service.user_count })}
											{isBroken ? ` · ${t("userDialog.brokenService")}` : ""}
										</span>
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</FormField>
			) : null}

			{dataLimitSet ? (
				<Controller
					control={form.control}
					name="data_limit_reset_strategy"
					render={({ field }) => (
						<FormField label={t("userDialog.periodicUsageReset")} className={cn(!showServiceSelector && "sm:col-span-2")}>
							<Select
								value={field.value}
								onValueChange={field.onChange}
								disabled={disabled || !canConfigurePeriodicUsageReset}
							>
								<SelectTrigger id="user-reset">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{resetStrategy.map((strategy) => (
										<SelectItem key={strategy.value} value={strategy.value}>
											<SelectItemText>{t(`userDialog.resetStrategy${strategy.title}`)}</SelectItemText>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FormField>
					)}
				/>
			) : null}

			{hasExistingKey && canSetCustomKey ? (
				<div className="flex flex-col gap-2 sm:col-span-2">
					<Controller
						name="manual_key_entry"
						control={form.control}
						render={({ field }) => (
							<label className="flex items-center justify-between gap-3 text-sm">
								<span>{t("userDialog.allowManualKeyEntry")}</span>
								<Switch checked={field.value} disabled={disabled} onCheckedChange={(checked) => field.onChange(checked)} />
							</label>
						)}
					/>
					{manualKeyEntryEnabled ? (
						<Controller
							name="credential_key"
							control={form.control}
							render={({ field }) => (
								<FormField
									label={t("userDialog.credentialKeyLabel")}
									description={t("userDialog.manualKeyHelper")}
									error={errors.credential_key?.message}
								>
									<Input
										placeholder="35e4e39c7d5c4f4b8b71558e4f37ff53"
										maxLength={32}
										dir="ltr"
										value={field.value ?? ""}
										disabled={disabled}
										onChange={(event) => field.onChange(event.target.value)}
									/>
								</FormField>
							)}
						/>
					) : null}
				</div>
			) : null}

			<Collapsible
				open={autoRenewOpen}
				onOpenChange={(open) => {
					setAutoRenewOpen(open);
					if (open) scrollBodyToEnd();
				}}
				className="flex flex-col gap-3 sm:col-span-2"
			>
				<CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
					{t("autoRenew.title")}
					{autoRenewRules.length > 0 ? <Badge variant="secondary">{autoRenewRules.length}</Badge> : null}
					<ChevronDown className={cn("size-4 transition-transform", autoRenewOpen && "rotate-180")} />
				</CollapsibleTrigger>
				<CollapsibleContent className="flex flex-col gap-3">
					{autoRenewRules.length === 0 && !ruleDraft ? (
						<p className="text-sm text-muted-foreground">{t("autoRenew.empty")}</p>
					) : null}
					{autoRenewRules.map((rule, idx) => {
						const dayText = deriveDaysFromSeconds(rule.expire);
						return (
							<div key={rule.id} className="flex flex-col gap-1">
								<div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
									<span>
										{rule.dataLimit !== null && rule.dataLimit !== undefined
											? `${rule.dataLimit} ${DATA_UNIT}`
											: t("userDialog.autoRenewUnlimited")}{" "}
										· {dayText !== null ? `${dayText} ${DAYS_UNIT}` : t("userDialog.autoRenewUnlimited")}
									</span>
									<div className="flex items-center">
										<button
											type="button"
											aria-label={t("edit")}
											disabled={disabled}
											onClick={() => startRuleDraft(idx)}
											className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
										>
											<Pencil />
										</button>
										<button
											type="button"
											aria-label={t("delete")}
											disabled={disabled}
											onClick={() => deleteRule(idx)}
											className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-destructive")}
										>
											<Trash2 />
										</button>
									</div>
								</div>
								{idx > 0 ? <p className="text-xs text-muted-foreground">{t("autoRenew.queuedNote")}</p> : null}
							</div>
						);
					})}

					{ruleDraft ? (
						<div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
							<FormField label={t("userDialog.autoRenewDataLimit")}>
								<UnitInput
									value={ruleDraft.data}
									unit={DATA_UNIT}
									disabled={disabled}
									onChange={(raw) => {
										if (raw === "" || isDecimalDraft(raw)) setRuleDraft((draft) => draft && { ...draft, data: raw });
									}}
								/>
							</FormField>
							<FormField label={t("userDialog.autoRenewTimeLimit")}>
								<UnitInput
									value={ruleDraft.days}
									unit={DAYS_UNIT} integer
									disabled={disabled}
									onChange={(raw) => {
										if (raw === "" || isDecimalDraft(raw)) setRuleDraft((draft) => draft && { ...draft, days: raw });
									}}
								/>
							</FormField>
							<div className="flex flex-wrap gap-2 sm:col-span-2">
								<button
									type="button"
									disabled={disabled}
									onClick={() => setRuleDraft((draft) => draft && { ...draft, addRemaining: !draft.addRemaining })}
									className={buttonVariants({ variant: ruleDraft.addRemaining ? "default" : "outline", size: "sm" })}
								>
									{ruleDraft.addRemaining
										? t("userDialog.nextPlanAddRemainingTraffic")
										: t("userDialog.autoRenewResetUsage")}
								</button>
								<button
									type="button"
									disabled={disabled}
									onClick={() => setRuleDraft((draft) => draft && { ...draft, fireOnEither: !draft.fireOnEither })}
									className={buttonVariants({ variant: ruleDraft.fireOnEither ? "default" : "outline", size: "sm" })}
								>
									{t("userDialog.nextPlanFireOnEither")}
								</button>
							</div>
							<div className="flex justify-end gap-2 sm:col-span-2">
								<button
									type="button"
									onClick={() => setRuleDraft(null)}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									{t("cancel")}
								</button>
								<button type="button" disabled={disabled} onClick={saveRuleDraft} className={buttonVariants({ size: "sm" })}>
									{ruleDraft.index !== null ? t("save") : t("add")}
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							disabled={disabled}
							onClick={() => startRuleDraft(null)}
							className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
						>
							<Plus />
							{t("add")}
						</button>
					)}
				</CollapsibleContent>
			</Collapsible>

			<Collapsible
				open={otherInfoOpen}
				onOpenChange={(open) => {
					setOtherInfoOpen(open);
					if (open) scrollBodyToEnd();
				}}
				className="flex flex-col gap-3 sm:col-span-2"
			>
				<CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
					{t("otherInfo.title")}
					<ChevronDown className={cn("size-4 transition-transform", otherInfoOpen && "rotate-180")} />
				</CollapsibleTrigger>
				<CollapsibleContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<FormField label={t("groups.group")}>
						<Controller
							control={form.control}
							name="group_id"
							render={({ field }) => (
								<GroupSelect type="user" value={field.value ?? null} onChange={field.onChange} />
							)}
						/>
					</FormField>
					<FormField label={t("tags.title")}>
						<Controller
							control={form.control}
							name="tags"
							render={({ field }) => (
								<TagsSelect
									value={field.value ?? []}
									onChange={field.onChange}
									options={knownUserTags.map((item) => item.tag)}
								/>
							)}
						/>
					</FormField>
					<FormField label={t("fields.note")} className="sm:col-span-2" error={errors.note?.message}>
						<Textarea {...form.register("note")} />
					</FormField>
					<FormField label={t("fields.telegramId")} error={errors.telegram_id?.message}>
						<Input dir="ltr" {...form.register("telegram_id")} />
					</FormField>
					<FormField label={t("fields.contactNumber")} error={errors.contact_number?.message}>
						<Input dir="ltr" {...form.register("contact_number")} />
					</FormField>
				</CollapsibleContent>
			</Collapsible>

			{error ? (
				<Alert variant="destructive" className="sm:col-span-2">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
		</div>
	);

	const linksTab = (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium">{t("userDialog.links.subscription")}</span>
				{subscriptionLinks.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("userDialog.links.noSubscription")}</p>
				) : (
					subscriptionLinks.map((item) => (
						<div key={item.key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
							<div className="flex min-w-0 items-center gap-2">
								<span className="truncate text-sm">{item.label}</span>
								{item.key === "key" ? <Badge variant="secondary">{t("userDialog.links.recommended")}</Badge> : null}
							</div>
							<div className="flex shrink-0 items-center">
								<button
									type="button"
									aria-label={t("a11y.copySubscriptionLink")}
									title={copiedKey === item.key ? t("copied") : t("copy")}
									onClick={() => copyValue(item.key, item.url)}
									className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
								>
									{copiedKey === item.key ? <Check /> : <Copy />}
								</button>
								<button
									type="button"
									aria-label={t("a11y.subscriptionQr")}
									title={t("userDialog.links.qr")}
									onClick={() => {
										setQRCode([], editingUser?.username ?? null);
										setSubLink(item.url);
									}}
									className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
								>
									<QrCode />
								</button>
							</div>
						</div>
					))
				)}
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-medium">{t("userDialog.links.configs")}</span>
					{configItems.length > 0 ? (
						<button
							type="button"
							onClick={() => copyValue("all", configLinksText)}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{copiedKey === "all" ? <Check /> : <Copy />}
							{copiedKey === "all" ? t("copied") : t("userDialog.links.copyAllConfigs")}
						</button>
					) : null}
				</div>
				{configItems.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("userDialog.links.noConfigs")}</p>
				) : (
					configItems.map((item, index) => (
						<div key={`${item.link}-${index}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
							<span dir="ltr" className="min-w-0 flex-1 truncate text-start text-sm">
								{item.label}
							</span>
							<div className="flex shrink-0 items-center">
								<button
									type="button"
									aria-label={t("a11y.copyConfig")}
									title={copiedKey === `config-${index}` ? t("copied") : t("copy")}
									onClick={() => copyValue(`config-${index}`, item.link)}
									className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
								>
									{copiedKey === `config-${index}` ? <Check /> : <Copy />}
								</button>
								<button
									type="button"
									aria-label={t("a11y.configQr")}
									title={t("userDialog.links.qr")}
									onClick={() => {
										setQRCode([item.link], editingUser?.username ?? null);
										setSubLink(null);
									}}
									className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
								>
									<QrCode />
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);

	const usageTab = (
		<div className="flex flex-col items-center gap-4">
			<UsageFilter
				defaultValue={usageFilter}
				onChange={(filter, query) => {
					setUsageFilter(filter);
					fetchUsageWithFilter(query);
				}}
			/>
			<div className="w-full md:w-[70%]">
				<ReactApexChart options={usage.options} series={usage.series} type="donut" />
			</div>
		</div>
	);

	return (
		<Dialog
			section="users"
			page={editingUser && !isCreatingNewUser ? userEntityPage(editingUser) : undefined}
			open={isOpen}
			onOpenChange={(open) => {
				if (!open && !loading) onClose();
			}}
		>
			<DialogContent
				dir={isRTL ? "rtl" : "ltr"}
				className="flex max-h-[min(640px,calc(100dvh-10rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0"
			>
				<form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							{isEditing ? <Pencil className="size-4" /> : <UserPlus className="size-4" />}
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{title}</DialogTitle>
							{isEditing && hasPrivilegedRole && editingUser?.admin_username ? (
								<DialogDescription className="truncate">
									{t("userDialog.createdBy")}: {editingUser.admin_username}
								</DialogDescription>
							) : null}
						</div>
					</DialogHeader>

					<Tabs value={tab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
						{isEditing ? (
							<div className="border-b px-5 pt-2.5 pb-2.5">
								<TabsList className="w-full">
									<TabsTrigger value="details">{t("details")}</TabsTrigger>
									{canViewTraffic ? <TabsTrigger value="usage">{t("userDialog.tabs.usage")}</TabsTrigger> : null}
									<TabsTrigger value="links">{t("userDialog.tabs.links")}</TabsTrigger>
								</TabsList>
							</div>
						) : null}

						<div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							{limitReached ? (
								<Alert variant="destructive" className="mb-4">
									<AlertDescription>
										{usersLimit && usersLimit > 0
											? t("userDialog.limitReachedBody", { limit: usersLimit, active: activeUsersCount ?? usersLimit })
											: t("userDialog.limitReachedContent")}
									</AlertDescription>
								</Alert>
							) : null}

							<TabsContent value="details" className="mt-0">
								{detailsTab}
							</TabsContent>
							{isEditing && canViewTraffic ? (
								<TabsContent value="usage" className="mt-0">
									{usageTab}
								</TabsContent>
							) : null}
							{isEditing ? <TabsContent value="links" className="mt-0">{linksTab}</TabsContent> : null}
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
						<div className="flex flex-wrap items-center gap-1.5">
							{isEditing && canDeleteUsersVisible ? (
								<DeleteConfirmDialog
									description={t("deleteUser.prompt", { username: editingUser?.username ?? "" })}
									loading={deleteLoading}
									onConfirm={handleDeleteUser}
								>
									<button
										type="button"
										aria-label={t("delete")}
										disabled={disabled}
										className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
									>
										<Trash2 className="text-destructive" />
									</button>
								</DeleteConfirmDialog>
							) : null}
							{isEditing && canResetUsageVisible ? (
								<button type="button" onClick={handleResetUsage} className={buttonVariants({ variant: "ghost", size: "sm" })}>
									<RotateCcw />
									{t("userDialog.resetUsage")}
								</button>
							) : null}
							{isEditing && canRevokeSubscriptionVisible ? (
								<button
									type="button"
									onClick={handleRevokeSubscription}
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									<Ban />
									{t("userDialog.revokeSubscription")}
								</button>
							) : null}
						</div>

						<button type="submit" disabled={submitDisabled} className={cn(buttonVariants({ size: "sm" }), "ms-auto")}>
							{submitStatus === "success" ? (
								<>
									<Check />
									{t("userDialog.submitSuccess")}
								</>
							) : loading ? (
								t("loading")
							) : isEditing ? (
								t("userDialog.editUser")
							) : (
								t("createUser")
							)}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
