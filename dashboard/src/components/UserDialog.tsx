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
	InputRightAddon,
	InputRightElement,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	SlideFade,
	Spinner,
	Stack,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	Textarea,
	Tooltip,
	useColorMode,
	useToast,
	VStack,
} from "@chakra-ui/react";

import {
	CheckIcon,
	ChevronDownIcon as HeroChevronDownIcon,
	ClipboardIcon,
	LockClosedIcon,
	LinkIcon,
	PencilIcon,
	QuestionMarkCircleIcon,
	QrCodeIcon,
	SparklesIcon,
	UserPlusIcon,
} from "@heroicons/react/24/outline";

import { zodResolver } from "@hookform/resolvers/zod";

import { resetStrategy } from "constants/UserSettings";

import { type FilterUsageType, useDashboard } from "contexts/DashboardContext";

import { useServicesStore } from "contexts/ServicesContext";
import { useSeasonal } from "contexts/SeasonalContext";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";

import {
	type ChangeEvent,
	type FC,
	type HTMLAttributes,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { keyframes } from "@emotion/react";
import ReactApexChart from "react-apexcharts";

import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import CopyToClipboard from "react-copy-to-clipboard";

import { getPanelSettings } from "service/settings";
import { AdminRole, UserPermissionToggle } from "types/Admin";
import type {
	User,
	UserCreate,
	UserCreateWithService,
	UserListItem,
} from "types/User";

import { relativeExpiryDate } from "utils/dateFormatter";
import { formatBytes } from "utils/formatByte";
import { getConfigLabelFromLink } from "utils/configLabel";
import { generateUserLinks } from "utils/userLinks";

import { z } from "zod";
import { DateTimePicker } from "./DateTimePicker";
import { DeleteIcon } from "./DeleteUserModal";
import { Icon } from "./Icon";
import { Input } from "./Input";

import { createUsageConfig, UsageFilter } from "./UsageFilter";

const AddUserIcon = chakra(UserPlusIcon, {
	baseStyle: {
		w: 4,

		h: 4,
	},
});

const EditUserIcon = chakra(PencilIcon, {
	baseStyle: {
		w: 4,

		h: 4,
	},
});

const actionIconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const CopyActionIcon = chakra(ClipboardIcon, actionIconProps);
const CopiedActionIcon = chakra(CheckIcon, actionIconProps);
const QRActionIcon = chakra(QrCodeIcon, actionIconProps);
const SubscriptionActionIcon = chakra(LinkIcon, actionIconProps);

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

const SectionChevronIcon = chakra(HeroChevronDownIcon, {
	baseStyle: {
		w: 4,

		h: 4,
	},
});

const _ConfirmIcon = chakra(CheckIcon, {
	baseStyle: {
		w: 4,

		h: 4,
	},
});

export type UserDialogProps = {};

const SERVICE_NOTICE_DURATION_MS = 10000;
const serviceNoticeProgress = keyframes`
	from {
		transform: scaleX(1);
	}
	to {
		transform: scaleX(0);
	}
`;

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
	| "telegram_id"
	| "contact_number"
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

		telegram_id: user.telegram_id ?? "",
		contact_number: user.contact_number ?? "",
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

		telegram_id: "",
		contact_number: "",
	};
};

const CREDENTIAL_KEY_REGEX = /^[0-9a-fA-F]{32}$/;

const allowedFlows = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"];

const usernameRegex = /^[A-Za-z0-9_]{3,32}$/;
const buildSchema = (isEditing: boolean) => {
	const baseSchema = {
		username: isEditing
			? z.string().min(1)
			: z
					.string()
					.regex(usernameRegex, {
						message:
							"Username only can be 3 to 32 characters and contain a-z, A-Z, 0-9, and underscores in between.",
					}),

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

		note: z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
			if (typeof value !== "string") return "";
			return value;
		}),

		telegram_id: z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
			if (typeof value !== "string") return "";
			return value;
		}),

		contact_number: z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
			if (typeof value !== "string") return "";
			return value;
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

	return z
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
};

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
		linkTemplates,
		setQRCode,
		setSubLink,
	} = useDashboard();

	const isEditing = !!editingUser;

	const isOpen = isCreatingNewUser || isEditing;

	const usersLimit = usersState.users_limit ?? null;

	const activeUsersCount = usersState.active_total ?? null;

	const limitReached = isUserLimitReached && !isEditing;

	const [loading, setLoading] = useState(false);

	const [error, setError] = useState<string | null>("");

	const toast = useToast();

	const { t, i18n } = useTranslation();
	const { isChristmas } = useSeasonal();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const DATA_UNIT = "GB";
	const DAYS_UNIT = t("userDialog.days", "Days");
	const basePad = "0.75rem";
	const endPadding = isRTL
		? { paddingInlineStart: "2.75rem", paddingInlineEnd: basePad }
		: { paddingInlineEnd: "2.75rem", paddingInlineStart: basePad };
	const endAdornmentProps = isRTL
		? { insetInlineStart: "0.5rem", insetInlineEnd: "auto", right: "auto", left: "0.5rem" }
		: { insetInlineEnd: "0.5rem", insetInlineStart: "auto", right: "0.5rem", left: "auto" };

	const { colorMode } = useColorMode();

	const UNIT_RADIUS = "6px";

	const renderUnitInput = (args: {
		value: string;
		onChange: (e: ChangeEvent<HTMLInputElement>) => void;
		unit: string;
		disabled?: boolean;
		placeholder?: string;
		type?: string;
		inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
	}) => {
		const addonBg = colorMode === "dark" ? "whiteAlpha.100" : "blackAlpha.50";
		const addonBorder = colorMode === "dark" ? "gray.700" : "gray.200";
		const addonColor = colorMode === "dark" ? "gray.200" : "gray.600";

		return (
			<InputGroup size="sm" dir="ltr" w="full">
				<ChakraInput
					value={args.value}
					onChange={args.onChange}
					placeholder={args.placeholder}
					type={args.type ?? "text"}
					inputMode={args.inputMode ?? "decimal"}
					isDisabled={args.disabled}
					borderRadius={UNIT_RADIUS}
					borderEndRadius="0"
					dir="ltr"
					textAlign={isRTL ? "right" : "left"}
				/>

				<InputRightAddon
					bg={addonBg}
					borderColor={addonBorder}
					color={addonColor}
					borderStartRadius="0"
					borderEndRadius={UNIT_RADIUS}
					px={3}
					fontSize="sm"
					userSelect="none"
				>
					{args.unit}
				</InputRightAddon>
			</InputGroup>
		);
	};

	const formSchema = useMemo(() => buildSchema(isEditing), [isEditing]);

	const form = useForm<FormType>({
		defaultValues: getDefaultValues(),

		resolver: zodResolver(formSchema),
		mode: "onChange",
		reValidateMode: "onChange",
	});

	const manualKeyEntryEnabled = useWatch({
		control: form.control,
		name: "manual_key_entry",
	});
	const usernameValue = useWatch({
		control: form.control,
		name: "username",
	});
	const hasExistingKey = Boolean(editingUser?.credential_key);

	const expireInitialValue = form.getValues("expire");

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
	const [autoRenewOpen, setAutoRenewOpen] = useState(false);

	type AutoRenewRule = {
		dataLimit: number | null;
		expire: number | null;
		addRemaining: boolean;
		fireOnEither: boolean;
		localOnly?: boolean;
	};

	const initialRule: AutoRenewRule | null =
		form.getValues("next_plan_enabled")
			? {
					dataLimit: form.getValues("next_plan_data_limit"),
					expire: form.getValues("next_plan_expire"),
					addRemaining: form.getValues("next_plan_add_remaining_traffic"),
					fireOnEither: form.getValues("next_plan_fire_on_either"),
					localOnly: false,
				}
			: null;

	const [autoRenewRules, setAutoRenewRules] = useState<AutoRenewRule[]>(
		initialRule ? [initialRule] : [],
	);
	const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
	const [autoRenewFormMode, setAutoRenewFormMode] = useState<"add" | "edit" | null>(
		null,
	);
	const [autoRenewDataValue, setAutoRenewDataValue] = useState<string>("");
	const [autoRenewExpireDaysValue, setAutoRenewExpireDaysValue] = useState<string>("");
	const [autoRenewAddRemainingValue, setAutoRenewAddRemainingValue] = useState(false);
	const [autoRenewFireOnEitherValue, setAutoRenewFireOnEitherValue] = useState(true);

	const [noteValue, telegramValue, contactNumberValue] = useWatch({
		control: form.control,
		name: ["note", "telegram_id", "contact_number"],
	});

	const otherInfoCount =
		(noteValue ? 1 : 0) +
		(telegramValue ? 1 : 0) +
		(contactNumberValue ? 1 : 0);

	const resetAutoRenewFormValues = useCallback(
		(rule?: AutoRenewRule | null) => {
			if (rule) {
				setAutoRenewDataValue(
					typeof rule.dataLimit === "number" && Number.isFinite(rule.dataLimit)
						? String(rule.dataLimit)
						: "",
				);
				const derivedDays = deriveDaysFromSeconds(rule.expire);
				setAutoRenewExpireDaysValue(
					derivedDays !== null && typeof derivedDays !== "undefined"
						? String(derivedDays)
						: "",
				);
				setAutoRenewAddRemainingValue(Boolean(rule.addRemaining));
				setAutoRenewFireOnEitherValue(Boolean(rule.fireOnEither));
			} else {
				setAutoRenewDataValue("");
				setAutoRenewExpireDaysValue("");
				setAutoRenewAddRemainingValue(false);
				setAutoRenewFireOnEitherValue(true);
			}
		},
		[deriveDaysFromSeconds],
	);

	const startAddAutoRenew = () => {
		setAutoRenewOpen(true);
		setAutoRenewFormMode("add");
		setEditingRuleIndex(null);
		resetAutoRenewFormValues(null);
	};

	const startEditAutoRenew = (index: number) => {
		const rule = autoRenewRules[index];
		if (!rule) return;
		setAutoRenewOpen(true);
		setAutoRenewFormMode("edit");
		setEditingRuleIndex(index);
		resetAutoRenewFormValues(rule);
	};

	const handleCancelAutoRenewForm = () => {
		setAutoRenewFormMode(null);
		setEditingRuleIndex(null);
	};

	const handleSaveAutoRenewRule = () => {
		setError(null);
		const parsedLimit =
			autoRenewDataValue.trim() === ""
				? null
				: Number.parseFloat(autoRenewDataValue.trim());
		if (
			parsedLimit !== null &&
			(!Number.isFinite(parsedLimit) || Number.isNaN(parsedLimit) || parsedLimit < 0)
		) {
			setError(t("userDialog.autoRenewInvalidLimit", "Invalid renewal limit"));
			return;
		}

		const parsedDays =
			autoRenewExpireDaysValue.trim() === ""
				? null
				: Number.parseFloat(autoRenewExpireDaysValue.trim());
		if (
			parsedDays !== null &&
			(!Number.isFinite(parsedDays) || Number.isNaN(parsedDays) || parsedDays < 0)
		) {
			setError(t("userDialog.autoRenewInvalidDays", "Invalid renewal days"));
			return;
		}

		const expireSeconds =
			parsedDays !== null ? convertDaysToSecondsFromNow(Math.round(parsedDays)) : null;

		const newRule: AutoRenewRule = {
			dataLimit: parsedLimit === null ? null : parsedLimit,
			expire: expireSeconds,
			addRemaining: autoRenewAddRemainingValue,
			fireOnEither: autoRenewFireOnEitherValue,
		};

		setAutoRenewRules((prev) => {
			const next = [...prev];
			if (autoRenewFormMode === "edit" && editingRuleIndex !== null) {
				next[editingRuleIndex] = newRule;
			} else {
				next.push(newRule);
			}
			return next;
		});
		setAutoRenewFormMode(null);
		setEditingRuleIndex(null);
	};

	const handleDeleteAutoRenewRule = (index: number) => {
		setAutoRenewRules((prev) => prev.filter((_, i) => i !== index));
		if (editingRuleIndex === index) {
			setAutoRenewFormMode(null);
			setEditingRuleIndex(null);
		}
	};

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

	const [activeTab, setActiveTab] = useState(0);
	const [usageFetched, setUsageFetched] = useState(false);

	const [serviceNoticeVisible, setServiceNoticeVisible] = useState(false);
	const [serviceNoticeSeed, setServiceNoticeSeed] = useState(0);
	const [statusNoticeVisible, setStatusNoticeVisible] = useState(false);
	const [statusNoticeSeed, setStatusNoticeSeed] = useState(0);
	const [copiedSubscriptionKey, setCopiedSubscriptionKey] = useState<string | null>(
		null,
	);
	const [copiedAllConfigs, setCopiedAllConfigs] = useState(false);
	const [copiedConfigIndex, setCopiedConfigIndex] = useState<number | null>(null);

	const autoRenewTitle = t("autoRenew.title");

	useEffect(() => {
		if (!isOpen || !isEditing || !isServiceManagedUser) {
			setServiceNoticeVisible(false);
			return;
		}
		setServiceNoticeSeed((prev) => prev + 1);
		setServiceNoticeVisible(true);
		const timer = window.setTimeout(() => {
			setServiceNoticeVisible(false);
		}, SERVICE_NOTICE_DURATION_MS);
		return () => window.clearTimeout(timer);
	}, [isOpen, isEditing, isServiceManagedUser, editingUser?.username]);

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

	useEffect(() => {
		const firstRule = autoRenewRules[0];
		if (firstRule) {
			form.setValue("next_plan_enabled", true, { shouldDirty: false });
			form.setValue("next_plan_data_limit", firstRule.dataLimit, {
				shouldDirty: false,
			});
			form.setValue("next_plan_expire", firstRule.expire, {
				shouldDirty: false,
			});
			form.setValue("next_plan_add_remaining_traffic", firstRule.addRemaining, {
				shouldDirty: false,
			});
			form.setValue("next_plan_fire_on_either", firstRule.fireOnEither, {
				shouldDirty: false,
			});
		} else {
			form.setValue("next_plan_enabled", false, { shouldDirty: false });
			form.setValue("next_plan_data_limit", null, { shouldDirty: false });
			form.setValue("next_plan_expire", null, { shouldDirty: false });
			form.setValue("next_plan_add_remaining_traffic", false, {
				shouldDirty: false,
			});
			form.setValue("next_plan_fire_on_either", true, { shouldDirty: false });
		}
	}, [autoRenewRules, form]);

	const [dataLimit, userStatus] = useWatch({
		control: form.control,

		name: ["data_limit", "status"],
	});

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

	useEffect(() => {
		if (!isOpen || !isEditing || !statusNotice) {
			setStatusNoticeVisible(false);
			return;
		}
		setStatusNoticeSeed((prev) => prev + 1);
		setStatusNoticeVisible(true);
		const timer = window.setTimeout(() => {
			setStatusNoticeVisible(false);
		}, SERVICE_NOTICE_DURATION_MS);
		return () => window.clearTimeout(timer);
	}, [isOpen, isEditing, statusNotice, userStatus, editingUser?.username]);

	useEffect(() => {
		if (copiedSubscriptionKey) {
			const timer = window.setTimeout(
				() => setCopiedSubscriptionKey(null),
				1000,
			);
			return () => window.clearTimeout(timer);
		}
		return undefined;
	}, [copiedSubscriptionKey]);

	useEffect(() => {
		if (copiedAllConfigs) {
			const timer = window.setTimeout(() => setCopiedAllConfigs(false), 1000);
			return () => window.clearTimeout(timer);
		}
		return undefined;
	}, [copiedAllConfigs]);

	useEffect(() => {
		if (copiedConfigIndex !== null) {
			const timer = window.setTimeout(() => setCopiedConfigIndex(null), 1000);
			return () => window.clearTimeout(timer);
		}
		return undefined;
	}, [copiedConfigIndex]);

	const remainingDataInfo = useMemo(() => {
		if (!isEditing || !editingUser) return null;
		const rawLimit = dataLimit;
		const parsedLimit =
			rawLimit === null ||
			typeof rawLimit === "undefined" ||
			(Number.isNaN(Number(rawLimit)) &&
				String(rawLimit).trim() === "")
				? null
				: Number(rawLimit);
		if (!parsedLimit || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
			return {
				label: t("userDialog.remainingDataLabel"),
				value: t("userDialog.remainingDataUnlimited"),
			};
		}
		const limitBytes = parsedLimit * 1073741824;
		const usedBytes = editingUser.used_traffic ?? 0;
		const remainingBytes = Math.max(limitBytes - usedBytes, 0);
		return {
			label: t("userDialog.remainingDataLabel"),
			value:
				remainingBytes <= 0
					? t("userDialog.remainingDataLimited")
					: formatBytes(remainingBytes, 2),
		};
	}, [isEditing, editingUser, dataLimit, t]);

	const formatLink = useCallback((link?: string | null) => {
		if (!link) return "";
		return link.startsWith("/") ? window.location.origin + link : link;
	}, []);

	const subscriptionLinks = useMemo(() => {
		if (!editingUser) {
			return [];
		}
		const urls = editingUser.subscription_urls ?? {};
		const order = ["username-key", "key", "token"] as const;
		const labels: Record<(typeof order)[number], string> = {
			"username-key": t(
				"userDialog.links.subscriptionUsernameKey",
				"Username + Key",
			),
			key: t("userDialog.links.subscriptionKey", "Key"),
			token: t("userDialog.links.subscriptionToken", "Token"),
		};

		const results: Array<{ key: string; label: string; url: string }> = [];
		order.forEach((key) => {
			const value = urls[key];
			if (!value) {
				return;
			}
			const url = formatLink(value);
			if (url) {
				results.push({ key, label: labels[key], url });
			}
		});

		if (results.length === 0 && editingUser.subscription_url) {
			const fallback = formatLink(editingUser.subscription_url);
			if (fallback) {
				results.push({
					key: "primary",
					label: t(
						"userDialog.links.subscription",
						"Subscription link",
					),
					url: fallback,
				});
			}
		}

		return results;
	}, [editingUser, formatLink, t]);

	const userLinks = useMemo(
		() =>
			editingUser
				? generateUserLinks(editingUser, linkTemplates, {
						includeInactive: true,
					})
				: [],
		[editingUser, linkTemplates],
	);

	const configLinksText = useMemo(() => userLinks.join("\n"), [userLinks]);

	const configItems = useMemo(() => {
		return userLinks.map((link, index) => {
			const label =
				getConfigLabelFromLink(link) ||
				t("userDialog.links.configFallback", "Config {{index}}", {
					index: index + 1,
				});
			return { link, label };
		});
	}, [userLinks, t]);

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		if (index === 1 && !usageFetched && editingUser) {
			fetchUsageWithFilter({
				start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00"),
			});
			setUsageFetched(true);
		}
	};

	const expireValue = useWatch({
		control: form.control,

		name: "expire",
	});

	const nextPlanDataLimit = useWatch({
		control: form.control,

		name: "next_plan_data_limit",
	});

	useEffect(() => {
		const derivedDays = deriveDaysFromSeconds(expireValue);
		setExpireDays((prev) => (prev === derivedDays ? prev : derivedDays));
	}, [expireValue, deriveDaysFromSeconds]);

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
			setUsage(createUsageConfig(colorMode, usageTitle));
			setUsageFilter("1m");
			setUsageFetched(false);
			setActiveTab(0);
			setCopiedSubscriptionKey(null);
			setCopiedAllConfigs(false);
			setCopiedConfigIndex(null);
			if (formatted.next_plan_enabled) {
				const rule: AutoRenewRule = {
					dataLimit: formatted.next_plan_data_limit,
					expire: formatted.next_plan_expire,
					addRemaining: formatted.next_plan_add_remaining_traffic,
					fireOnEither: formatted.next_plan_fire_on_either,
				};
				setAutoRenewRules([rule]);
				resetAutoRenewFormValues(rule);
			} else {
				setAutoRenewRules([]);
				resetAutoRenewFormValues(null);
			}
		} else {
			const defaults = getDefaultValues();
			form.reset(defaults);
			setExpireDays(deriveDaysFromSeconds(defaults.expire));
			setUsage(createUsageConfig(colorMode, usageTitle));
			setUsageFilter("1m");
			setUsageFetched(false);
			setActiveTab(0);
			setCopiedSubscriptionKey(null);
			setCopiedAllConfigs(false);
			setCopiedConfigIndex(null);
			if (defaults.next_plan_enabled) {
				const rule: AutoRenewRule = {
					dataLimit: defaults.next_plan_data_limit,
					expire: defaults.next_plan_expire,
					addRemaining: defaults.next_plan_add_remaining_traffic,
					fireOnEither: defaults.next_plan_fire_on_either,
				};
				setAutoRenewRules([rule]);
				resetAutoRenewFormValues(rule);
			} else {
				setAutoRenewRules([]);
				resetAutoRenewFormValues(null);
			}
		}
	}, [
		editingUser,
		deriveDaysFromSeconds,
		form.reset,
		resetAutoRenewFormValues,
		colorMode,
		usageTitle,
	]);

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
		if (
			usersLimit !== null &&
			usersLimit !== undefined &&
			usersLimit > 0 &&
			activeUsersCount !== null
		) {
			if (activeUsersCount >= usersLimit) {
				const errorMessage = t(
					"userDialog.usersLimitReached",
					"User limit reached. You have {{active}} active users out of {{limit}} allowed.",
					{
						active: activeUsersCount,
						limit: usersLimit,
					},
				);
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
		const maxDataLimitPerUser =
			userData?.permissions?.users?.max_data_limit_per_user;
		const allowUnlimitedData =
			hasElevatedRole ||
			Boolean(
				userData?.permissions?.users?.[UserPermissionToggle.AllowUnlimitedData],
			);

		// data_limit from schema is already in bytes
		const dataLimitBytes = data_limit || 0;

		if (maxDataLimitPerUser !== null && maxDataLimitPerUser !== undefined) {
			// If unlimited (0) is requested but not allowed, show error
			if (dataLimitBytes === 0 && !allowUnlimitedData) {
				const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
				const errorMessage = t("userDialog.unlimitedNotAllowed", {
					max: maxGb,
				});
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
					max: maxGb,
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

		if (
			maxDataLimitPerUser !== null &&
			maxDataLimitPerUser !== undefined &&
			normalizedNextPlanDataLimit > 0
		) {
			if (normalizedNextPlanDataLimit > maxDataLimitPerUser) {
				const originalGb = (normalizedNextPlanDataLimit / 1073741824).toFixed(
					2,
				);
				const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
				const errorMessage = t("userDialog.nextPlanDataLimitExceedsMax", {
					original: originalGb,
					max: maxGb,
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
		if (
			normalizedNextPlanDataLimit === 0 &&
			next_plan_enabled &&
			!allowUnlimitedData &&
			maxDataLimitPerUser !== null &&
			maxDataLimitPerUser !== undefined
		) {
			const maxGb = (maxDataLimitPerUser / 1073741824).toFixed(2);
			const errorMessage = t("userDialog.nextPlanUnlimitedNotAllowed", {
				max: maxGb,
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

				telegram_id: values.telegram_id,

				contact_number: values.contact_number,

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

		onCreateUser(false);

		onEditingUser(null);

		setError(null);

		setUsageFilter("1m");
		setUsageFetched(false);
		setActiveTab(0);
		setCopiedSubscriptionKey(null);
		setCopiedAllConfigs(false);
		setCopiedConfigIndex(null);

		setSelectedServiceId(null);

		setAutoRenewRules([]);
		resetAutoRenewFormValues(null);
		setAutoRenewFormMode(null);
		setEditingRuleIndex(null);
		setAutoRenewOpen(false);
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
	const submitDisabled = disabled || !form.formState.isValid;

	const isOnHold = userStatus === "on_hold";

	const [randomUsernameLoading, setrandomUsernameLoading] = useState(false);

	const [otherInfoOpen, setOtherInfoOpen] = useState(false);

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
				<ModalContent mx="3" position="relative" overflow="hidden" dir={isRTL ? "rtl" : "ltr"}>
					<ModalCloseButton
						mt={3}
						disabled={loading}
						insetInlineEnd={4}
						insetInlineStart="auto"
						top={4}
						position="absolute"
						zIndex={2}
						_rtl={{
							insetInlineEnd: "auto",
							insetInlineStart: 4,
						}}
					/>

					<Box
						pointerEvents={limitReached ? "none" : "auto"}
						filter={limitReached ? "blur(6px)" : "none"}
						transition="filter 0.2s ease"
					>
						<form onSubmit={form.handleSubmit(submit)}>
							<ModalHeader
								pt={6}
								pe={12}
								position="relative"
								display="flex"
								alignItems="center"
								justifyContent="flex-start"
								gap={2}
							>
								<Box flexShrink={0}>
									<Icon color="primary" size={30}>
										{isEditing ? (
											<EditUserIcon color="white" />
										) : (
											<AddUserIcon color="white" />
										)}
									</Icon>
								</Box>

								<Text fontWeight="semibold" fontSize="lg">
									{isEditing
										? `${t("userDialog.editUserTitle")}${
												editingUser?.username ? ` ${editingUser.username}` : ""
											}`
										: t("createNewUser")}
								</Text>
							</ModalHeader>

							<ModalBody>
								{isEditing && isServiceManagedUser && (
									<SlideFade
										in={serviceNoticeVisible}
										offsetY="-8px"
										unmountOnExit
									>
										<Alert
											status="info"
											mb={statusNotice ? 3 : 4}
											borderRadius="md"
											alignItems="flex-start"
											overflow="hidden"
											position="relative"
										>
											<AlertIcon />
											<Box flex="1" minW={0}>
												<AlertDescription>
													{t(
														"userDialog.serviceManagedNotice",
														"This user is tied to service {{service}}. Update the service to change shared settings.",
														{
															service: editingUser?.service_name ?? "",
														},
													)}
												</AlertDescription>
											</Box>
											<Box
												position="absolute"
												insetInlineStart={0}
												insetInlineEnd={0}
												bottom={0}
												h="2px"
												bg="whiteAlpha.400"
												borderRadius="full"
												overflow="hidden"
												pointerEvents="none"
											>
												<Box
													key={serviceNoticeSeed}
													h="full"
													bg="whiteAlpha.800"
													transformOrigin={
														isRTL ? "right center" : "left center"
													}
													animation={`${serviceNoticeProgress} ${SERVICE_NOTICE_DURATION_MS}ms linear forwards`}
												/>
											</Box>
										</Alert>
									</SlideFade>
								)}

								{isEditing && statusNotice && (
									<SlideFade
										in={statusNoticeVisible}
										offsetY="-8px"
										unmountOnExit
									>
										<Alert
											status="info"
											mb={4}
											borderRadius="md"
											alignItems="flex-start"
											overflow="hidden"
											position="relative"
										>
											<AlertIcon />
											<Box flex="1" minW={0}>
												<AlertDescription>{statusNotice}</AlertDescription>
											</Box>
											<Box
												position="absolute"
												insetInlineStart={0}
												insetInlineEnd={0}
												bottom={0}
												h="2px"
												bg="whiteAlpha.400"
												borderRadius="full"
												overflow="hidden"
												pointerEvents="none"
											>
												<Box
													key={statusNoticeSeed}
													h="full"
													bg="whiteAlpha.800"
													transformOrigin={
														isRTL ? "right center" : "left center"
													}
													animation={`${serviceNoticeProgress} ${SERVICE_NOTICE_DURATION_MS}ms linear forwards`}
												/>
											</Box>
										</Alert>
									</SlideFade>
								)}

										{showServiceSelector && !servicesLoading && !hasServices && (
											<Alert
												status="warning"
												variant="subtle"
												mb={4}
												borderRadius="md"
												w="full"
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
										)}

										{showServiceSelector && !servicesLoading && !hasServices && (
											<Alert
												status="warning"
												variant="subtle"
												w="full"
												px={4}
												py={3}
												borderRadius="md"
												alignItems="flex-start"
												mb={4}
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
										)}

								<Tabs
									index={activeTab}
									onChange={handleTabChange}
									variant="enclosed"
									isLazy
									w="full"
								>
									<TabList>
										<Tab>{t("userDialog.tabs.edit", "Edit")}</Tab>
										{isEditing && (
											<Tab>{t("userDialog.tabs.usage", "Usage")}</Tab>
										)}
										{isEditing && (
											<Tab>{t("userDialog.tabs.links", "Links")}</Tab>
										)}
									</TabList>
									<TabPanels>
										<TabPanel px={0} pt={4}>
											<Grid
												templateColumns={{
													base: "repeat(1, 1fr)",
													md: useTwoColumns
														? "repeat(2, 1fr)"
														: "minmax(0, 1fr)",
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
													<FormLabel
														display="flex"
														alignItems="center"
														gap={2}
														justifyContent={isRTL ? "flex-end" : "flex-start"}
														flexDirection={isRTL ? "row-reverse" : "row"}
													>
														<Text>{t("username")}</Text>
														<Tooltip
															hasArrow
															placement="top"
																label={t(
																	"userDialog.usernameHint",
																	"Username only can be 3 to 32 characters and contain a-z, 0-9, and underscores in between.",
																)}
															>
																<chakra.span
																	display="inline-flex"
																	color="gray.400"
																	cursor="help"
																>
																	<QuestionMarkCircleIcon width={16} height={16} />
																</chakra.span>
															</Tooltip>
														</FormLabel>
														<HStack align="center">
															<Box flex="1" minW="0">
																<InputGroup size="sm" dir={isRTL ? "rtl" : "ltr"}>
																	<ChakraInput
																		type="text"
																		borderRadius="6px"
																		placeholder={t("username")}
																		isDisabled={disabled || isEditing}
																		{...(!isEditing ? endPadding : {})}
																		{...form.register("username")}
																	/>
																	{!isEditing && (
																		<InputRightElement
																			width="auto"
																			insetInlineEnd={endAdornmentProps.insetInlineEnd}
																			insetInlineStart={endAdornmentProps.insetInlineStart}
																			right={endAdornmentProps.right}
																			left={endAdornmentProps.left}
																		>
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
																							shouldValidate: true,
																						},
																					);
																					form.trigger("username");
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

														<FormHelperText
															fontSize="xs"
															color="gray.500"
															textAlign={isRTL ? "end" : "start"}
														>
															{`${usernameValue?.length ?? 0}/32`}
														</FormHelperText>
														{isEditing &&
															hasElevatedRole &&
															editingUser?.admin_username && (
																<FormHelperText
																	fontSize="xs"
																	color="gray.500"
																	mt={1}
																	textAlign={isRTL ? "end" : "start"}
																>
																	{t("userDialog.createdBy", "Created by")}:{" "}
																	{editingUser.admin_username}
																</FormHelperText>
															)}

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
													<FormControl
														flex="1"
														isInvalid={
															!!form.formState.errors.data_limit?.message
														}
													>
														<FormLabel textAlign={isRTL ? "right" : "left"}>
															{t("userDialog.dataLimit")}
														</FormLabel>
														<Controller
															control={form.control}
															name="data_limit"
															render={({ field }) => {
																return (
																	<>
																		{renderUnitInput({
																			unit: DATA_UNIT,
																			value: field.value ? String(field.value) : "",
																			onChange: field.onChange,
																			disabled,
																		})}
																		{isEditing && remainingDataInfo && (
																			<FormHelperText
																				fontSize="xs"
																				color="gray.500"
																				textAlign={isRTL ? "right" : "left"}
																			>
																				{`${remainingDataInfo.label}: ${remainingDataInfo.value}`}
																			</FormHelperText>
																		)}
																		<FormErrorMessage>
																			{form.formState.errors.data_limit?.message}
																		</FormErrorMessage>
																	</>
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
																justifyContent={
																	isRTL ? "flex-end" : "flex-start"
																}
																flexDirection={isRTL ? "row-reverse" : "row"}
																textAlign={isRTL ? "right" : "left"}
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
																		dir="ltr"
																		textAlign={isRTL ? "right" : "left"}
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
														<FormLabel textAlign={isRTL ? "right" : "left"}>
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
													mb="10px"
													isInvalid={
														isOnHold
															? Boolean(
																	form.formState.errors.on_hold_expire_duration,
																)
															: Boolean(form.formState.errors.expire)
													}
												>
													<Stack
														direction={{ base: "column", md: "row" }}
														align={{ base: "stretch", md: "flex-end" }}
														gap={{ base: 2, md: 4 }}
														w="full"
														flexWrap={{ base: "wrap", md: "nowrap" }}
													>
														<Box flex="1" minW={0}>
															<FormLabel
																mb={2}
																textAlign={isRTL ? "right" : "left"}
															>
																{isOnHold
																	? t("expires.days", "Expires in (days)")
																	: t(
																			"expires.selectDate",
																			"Select expiration date",
																		)}
															</FormLabel>
															{isOnHold ? (
																<Controller
																	control={form.control}
																	name="on_hold_expire_duration"
																	render={({ field }) => {
																		return renderUnitInput({
																			unit: DAYS_UNIT,
																			value: field.value ? String(field.value) : "",
																			disabled,
																			type: "text",
																			inputMode: "decimal",
																			onChange: (event) => {
																				form.setValue("expire", null);
																				const raw = event.target.value;
																				if (!raw) {
																					field.onChange(null);
																					return;
																				}
																				if (!/^[0-9]*\.?[0-9]*$/.test(raw)) {
																					return;
																				}
																				const parsed = Number(raw);
																				if (Number.isNaN(parsed) || parsed < 0) {
																					return;
																				}
																				field.onChange(Math.round(parsed));
																			},
																		});
																	}}
																/>
															) : (
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
																			<Box w="full" minW={0}>
																				<DateTimePicker
																					value={selectedDate}
																					onChange={handleDateChange}
																					placeholder={t(
																						"expires.selectDate",
																						"Select expiration date",
																					)}
																					disabled={disabled}
																					minDate={new Date()}
																					quickSelects={quickExpiryOptions.map(
																						(option) => ({
																							label: option.label,
																							onClick: () => {
																								const newDate = dayjs()
																									.add(
																										option.amount,
																										option.unit,
																									)
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
															)}
														</Box>
														<Button
															size="sm"
															variant={isOnHold ? "solid" : "outline"}
															colorScheme={isOnHold ? "primary" : "gray"}
															onClick={() => {
																if (isOnHold) {
																	form.setValue("status", "active", {
																		shouldDirty: true,
																	});
																	form.setValue("on_hold_expire_duration", null, {
																		shouldDirty: true,
																	});
																} else {
																	form.setValue("status", "on_hold", {
																		shouldDirty: true,
																	});
																	form.setValue("expire", null, {
																		shouldDirty: true,
																	});
																}
															}}
															isDisabled={disabled}
															minW={{ base: "100%", md: "auto" }}
															alignSelf={{ base: "stretch", md: "flex-end" }}
															flexShrink={0}
															h="32px"
														>
															{t("onHold.button")}
														</Button>
													</Stack>
													{isOnHold ? (
														<FormErrorMessage>
															{
																form.formState.errors.on_hold_expire_duration
																	?.message
															}
														</FormErrorMessage>
													) : (
														<FormErrorMessage>
															{form.formState.errors.expire?.message}
														</FormErrorMessage>
													)}
												</FormControl>

												{canSetFlow && (
													<FormControl mb="10px">
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
												)}

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
																	dir="ltr"
																	textAlign="left"
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

									<GridItem
										colSpan={{ base: 1, md: showServiceSelector ? 2 : 1 }}
										w="full"
										minW={0}
									>
										<Box
											w="full"
											minW={0}
											borderWidth="1px"
											borderRadius="md"
											bg="white"
											_dark={{ bg: "gray.900", borderColor: "gray.700" }}
											overflow="hidden"
											mb="10px"
										>
											<Flex
												align="center"
												justify="space-between"
												px={4}
												py={3}
												cursor="pointer"
												onClick={() => setAutoRenewOpen((prev) => !prev)}
												gap={3}
												dir={isRTL ? "rtl" : "ltr"}
											>
												<HStack
													spacing={2}
													align="center"
													flex="1"
													justify="flex-start"
												>
													<Text
														fontWeight="semibold"
														textAlign={isRTL ? "right" : "left"}
														w="full"
													>
														{autoRenewTitle}
													</Text>
													{autoRenewRules.length > 0 && (
														<Badge colorScheme="gray" borderRadius="full">
															{autoRenewRules.length}
														</Badge>
													)}
												</HStack>
												<SectionChevronIcon
													transform={
														autoRenewOpen ? "rotate(-180deg)" : "rotate(0deg)"
													}
													transition="transform 0.2s ease"
												/>
											</Flex>
											<Collapse in={autoRenewOpen} animateOpacity>
												<VStack
													align="stretch"
													spacing={4}
													px={4}
													pb={4}
													w="full"
													minW={0}
												>
													<Text
														fontSize="sm"
														color="gray.500"
														_dark={{ color: "gray.400" }}
														textAlign={isRTL ? "right" : "left"}
													>
														{t("userDialog.autoRenewDescription")}
													</Text>

													{autoRenewRules.length === 0 ? (
														<VStack spacing={3} align="stretch">
															<Text
																textAlign="center"
																color="gray.400"
																fontSize="sm"
															>
																{t("autoRenew.empty")}
															</Text>
															<Button
																variant="outline"
																onClick={startAddAutoRenew}
																isDisabled={disabled}
																w="full"
															>
																{t("autoRenew.add")}
															</Button>
														</VStack>
													) : (
														<>
															<VStack spacing={3} align="stretch" w="full">
																{autoRenewRules.map((rule, idx) => {
																	const dayText = deriveDaysFromSeconds(
																		rule.expire,
																	);
																			return (
																				<Box
																					key={`rule-${idx}`}
																					borderWidth="1px"
																					borderRadius="md"
																			p={3}
																			bg="blackAlpha.50"
																			_dark={{ bg: "whiteAlpha.50" }}
																			w="full"
																			minW={0}
																		>
																			<Flex
																				align={{ base: "flex-start", md: "center" }}
																				justify="space-between"
																				gap={3}
																				flexDirection={{
																					base: "column",
																					md: "row",
																				}}
																				>
																					<HStack
																						spacing={2}
																						dir={isRTL ? "rtl" : "ltr"}
																						align="center"
																					>
																						<Badge
																							colorScheme="primary"
																							borderRadius="full"
																					>
																						{idx + 1}
																					</Badge>
																					<Text fontWeight="semibold">
																						{rule.dataLimit !== null &&
																						typeof rule.dataLimit !== "undefined"
																							? `${rule.dataLimit} ${DATA_UNIT}`
																							: t("userDialog.autoRenewUnlimited")}
																					</Text>
																					<Text color="gray.500" fontSize="sm">
																						{dayText !== null
																							? `${dayText} ${DAYS_UNIT}`
																							: t("userDialog.autoRenewUnlimited")}
																					</Text>
																				</HStack>
																				<HStack spacing={2} justify="flex-end">
																					<IconButton
																						size="sm"
																						aria-label={t("edit")}
																						variant="ghost"
																						onClick={() => startEditAutoRenew(idx)}
																						isDisabled={disabled}
																					>
																						<PencilIcon width={16} />
																					</IconButton>
																					<IconButton
																						size="sm"
																						aria-label={t("delete")}
																						variant="ghost"
																						onClick={() =>
																							handleDeleteAutoRenewRule(idx)
																						}
																						isDisabled={disabled}
																					>
																						<DeleteIcon />
																					</IconButton>
																				</HStack>
																			</Flex>
																			{idx > 0 && (
																				<Text
																					fontSize="xs"
																					color="gray.500"
																					mt={2}
																				>
																					{t("autoRenew.queuedNote")}
																				</Text>
																			)}
																		</Box>
																	);
																})}
															</VStack>
															<Button
																variant="outline"
																onClick={startAddAutoRenew}
																isDisabled={disabled}
															>
																{t("autoRenew.add")}
															</Button>
														</>
													)}

													{autoRenewFormMode && (
														<VStack
															align="stretch"
															spacing={3}
															borderWidth="1px"
															borderRadius="md"
															p={3}
															bg="blackAlpha.50"
															_dark={{ bg: "whiteAlpha.50" }}
															minW={0}
														>
															<HStack
																justify="space-between"
																align="center"
																w="full"
																flexDirection="row"
															>
																<Text fontWeight="semibold">
																	{t("autoRenew.new")}
																</Text>
															</HStack>

															<Grid
																templateColumns={{
																	base: "1fr",
																	md: "minmax(0, 1fr) 220px",
																}}
																gap={3}
																w="full"
																minW={0}
																dir={isRTL ? "rtl" : "ltr"}
																alignItems="end"
															>
																<FormControl minW={0}>
																	<FormLabel
																		fontSize="sm"
																		textAlign={isRTL ? "right" : "left"}
																		w="full"
																	>
																		{t("userDialog.autoRenewDataLimit")}
																	</FormLabel>
																	{renderUnitInput({
																		unit: DATA_UNIT,
																		value: autoRenewDataValue,
																		disabled,
																		onChange: (event) => {
																			const rawValue = event.target.value;
																			if (!rawValue) {
																				setAutoRenewDataValue("");
																				return;
																			}
																			if (!/^[0-9]*\.?[0-9]*$/.test(rawValue)) {
																				return;
																			}
																			setAutoRenewDataValue(rawValue);
																		},
																	})}
																</FormControl>

																<Button
																	size="sm"
																	variant={autoRenewAddRemainingValue ? "solid" : "outline"}
																	colorScheme={autoRenewAddRemainingValue ? "primary" : "gray"}
																	onClick={() =>
																		setAutoRenewAddRemainingValue((prev) => !prev)
																	}
																	isDisabled={disabled}
																	w={{ base: "full", md: "auto" }}
																	maxW="220px"
																	whiteSpace="nowrap"
																	flexShrink={0}
																>
																	{autoRenewAddRemainingValue
																		? t("userDialog.nextPlanAddRemainingTraffic")
																		: t("userDialog.autoRenewResetUsage")}
																</Button>

																<FormControl minW={0}>
																	<FormLabel
																		fontSize="sm"
																		textAlign={isRTL ? "right" : "left"}
																		w="full"
																	>
																		{t("userDialog.autoRenewTimeLimit")}
																	</FormLabel>
																	{renderUnitInput({
																		unit: DAYS_UNIT,
																		value: autoRenewExpireDaysValue,
																		disabled,
																		onChange: (event) => {
																			const rawValue = event.target.value;
																			if (!rawValue) {
																				setAutoRenewExpireDaysValue("");
																				return;
																			}
																			if (!/^[0-9]*\.?[0-9]*$/.test(rawValue)) {
																				return;
																			}
																			setAutoRenewExpireDaysValue(rawValue);
																		},
																	})}
																</FormControl>

																<Button
																	size="sm"
																	variant={autoRenewFireOnEitherValue ? "solid" : "outline"}
																	colorScheme={autoRenewFireOnEitherValue ? "primary" : "gray"}
																	onClick={() =>
																		setAutoRenewFireOnEitherValue((prev) => !prev)
																	}
																	isDisabled={disabled}
																	w={{ base: "full", md: "auto" }}
																	maxW="220px"
																	whiteSpace="nowrap"
																	flexShrink={0}
																>
																	{t("userDialog.nextPlanFireOnEither")}
																</Button>
															</Grid>

															<HStack
																spacing={3}
																w="full"
																justify={isRTL ? "flex-start" : "flex-end"}
																flexDirection={isRTL ? "row-reverse" : "row"}
																flexWrap="wrap"
															>
																<Button
																	size="sm"
																	variant="outline"
																	onClick={handleCancelAutoRenewForm}
																	isDisabled={disabled}
																>
																	{t("autoRenew.cancel")}
																</Button>

																<Button
																	size="sm"
																	colorScheme="primary"
																	onClick={handleSaveAutoRenewRule}
																	isDisabled={disabled}
																>
																	{autoRenewFormMode === "edit"
																		? t("autoRenew.save")
																		: t("autoRenew.add")}
																</Button>
															</HStack>
														</VStack>
													)}
												</VStack>
											</Collapse>
										</Box>
									</GridItem>

									<GridItem colSpan={{ base: 1, md: 2 }} w="full" minW={0}>
										<Box
											w="full"
											minW={0}
											borderWidth="1px"
											borderRadius="md"
											bg="white"
											_dark={{ bg: "gray.900", borderColor: "gray.700" }}
											overflow="hidden"
											mb="10px"
										>
											<Flex
												align="center"
												justify="space-between"
												px={4}
												py={3}
												cursor="pointer"
												onClick={() => setOtherInfoOpen((prev) => !prev)}
												gap={3}
											>
												<Text
													fontWeight="semibold"
													textAlign="start"
													flex="1"
												>
													{t("otherInfo.title")}
												</Text>
												<SectionChevronIcon
													transform={
														otherInfoOpen ? "rotate(-180deg)" : "rotate(0deg)"
													}
													transition="transform 0.2s ease"
												/>
											</Flex>
											<Collapse in={otherInfoOpen} animateOpacity>
												<VStack
													align="stretch"
													spacing={3}
													px={4}
													pb={4}
													w="full"
													minW={0}
												>
													<FormControl
														isInvalid={!!form.formState.errors.note}
														w="full"
													>
														<FormLabel
															textAlign={isRTL ? "right" : "left"}
															w="full"
														>
															{t("fields.note")}
														</FormLabel>
														<Textarea
															{...form.register("note")}
															textAlign={isRTL ? "right" : "left"}
														/>
														<FormErrorMessage>
															{form.formState.errors?.note?.message}
														</FormErrorMessage>
													</FormControl>
													<FormControl
														isInvalid={!!form.formState.errors.telegram_id}
														w="full"
													>
														<FormLabel
															textAlign={isRTL ? "right" : "left"}
															w="full"
														>
															{t("fields.telegramId")}
														</FormLabel>
														<ChakraInput
															{...form.register("telegram_id")}
															textAlign={isRTL ? "right" : "left"}
															w="full"
															minW={0}
														/>
														<FormErrorMessage>
															{form.formState.errors?.telegram_id?.message}
														</FormErrorMessage>
													</FormControl>
													<FormControl
														isInvalid={!!form.formState.errors.contact_number}
														w="full"
													>
														<FormLabel
															textAlign={isRTL ? "right" : "left"}
															w="full"
														>
															{t("fields.contactNumber")}
														</FormLabel>
														<ChakraInput
															{...form.register("contact_number")}
															textAlign={isRTL ? "right" : "left"}
															w="full"
															minW={0}
														/>
														<FormErrorMessage>
															{form.formState.errors?.contact_number?.message}
														</FormErrorMessage>
													</FormControl>
												</VStack>
											</Collapse>
										</Box>
									</GridItem>
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
										</TabPanel>
										{isEditing && (
											<TabPanel px={0} pt={4}>
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
											</TabPanel>
										)}
										{isEditing && (
											<TabPanel px={0} pt={4}>
												<VStack align="stretch" spacing={4}>
													<Box
														borderWidth="1px"
														borderRadius="md"
														px={4}
														py={3}
														bg="white"
														_dark={{ bg: "gray.900", borderColor: "gray.700" }}
													>
														<HStack spacing={2} minW={0} mb={3}>
															<SubscriptionActionIcon />
															<Text fontWeight="semibold">
																{t(
																	"userDialog.links.subscription",
																	"Subscription link",
																)}
															</Text>
														</HStack>
														<VStack spacing={2} align="stretch">
															{subscriptionLinks.length === 0 ? (
																<Text fontSize="sm" color="gray.500">
																	{t(
																		"userDialog.links.noSubscription",
																		"No subscription links",
																	)}
																</Text>
															) : (
																subscriptionLinks.map((item) => (
																	<Box
																		key={item.key}
																		borderWidth="1px"
																		borderRadius="md"
																		px={3}
																		py={2}
																		bg="blackAlpha.50"
																		_dark={{ bg: "whiteAlpha.50" }}
																	>
																		<HStack
																			justify="space-between"
																			align="center"
																			w="full"
																		>
																			<HStack spacing={2} minW={0}>
																				<Text fontWeight="medium">
																					{item.label}
																				</Text>
																				{item.key === "key" && (
																					<Badge
																						colorScheme="primary"
																						borderRadius="full"
																						fontSize="xs"
																					>
																						{t(
																							"userDialog.links.recommended",
																							"Recommended",
																						)}
																					</Badge>
																				)}
																			</HStack>
																			<HStack spacing={1} flexShrink={0}>
																				<CopyToClipboard
																					text={item.url}
																					onCopy={() =>
																						setCopiedSubscriptionKey(item.key)
																					}
																				>
																					<div>
																						<Tooltip
																							label={
																								copiedSubscriptionKey ===
																								item.key
																									? t("usersTable.copied")
																									: t(
																											"userDialog.links.copy",
																											"Copy",
																										)
																							}
																							placement="top"
																						>
																							<IconButton
																								aria-label="copy subscription link"
																								variant="ghost"
																								size="sm"
																								type="button"
																							>
																								{copiedSubscriptionKey ===
																								item.key ? (
																									<CopiedActionIcon />
																								) : (
																									<CopyActionIcon />
																								)}
																							</IconButton>
																						</Tooltip>
																					</div>
																				</CopyToClipboard>
																				<Tooltip
																					label={t(
																						"userDialog.links.qr",
																						"QR",
																					)}
																					placement="top"
																				>
																					<IconButton
																						aria-label="subscription qr"
																						variant="ghost"
																						size="sm"
																						type="button"
																						onClick={() => {
																							setQRCode([]);
																							setSubLink(item.url);
																						}}
																					>
																						<QRActionIcon />
																					</IconButton>
																				</Tooltip>
																			</HStack>
																		</HStack>
																	</Box>
																))
															)}
														</VStack>
													</Box>

													<Box
														borderWidth="1px"
														borderRadius="md"
														px={4}
														py={3}
														bg="white"
														_dark={{ bg: "gray.900", borderColor: "gray.700" }}
													>
														<HStack
															justify="space-between"
															align="center"
															w="full"
															mb={3}
														>
															<Text fontWeight="semibold">
																{t("userDialog.links.configs", "Configs")}
															</Text>
															<CopyToClipboard
																text={configLinksText}
																onCopy={() => {
																	if (configItems.length > 0) {
																		setCopiedAllConfigs(true);
																	}
																}}
															>
																<div>
																	<Button
																		size="sm"
																		variant="outline"
																		type="button"
																		isDisabled={configItems.length === 0}
																		leftIcon={
																			copiedAllConfigs ? (
																				<CopiedActionIcon />
																			) : (
																				<CopyActionIcon />
																			)
																		}
																	>
																		{copiedAllConfigs
																			? t("usersTable.copied")
																			: t(
																					"userDialog.links.copyAllConfigs",
																					"Copy all configs",
																				)}
																	</Button>
																</div>
															</CopyToClipboard>
														</HStack>

														<VStack spacing={2} align="stretch">
															{configItems.length === 0 ? (
																<Text fontSize="sm" color="gray.500">
																	{t(
																		"userDialog.links.noConfigs",
																		"No configs available",
																	)}
																</Text>
															) : (
																configItems.map((item, index) => (
																	<Box
																		key={`${item.link}-${index}`}
																		borderWidth="1px"
																		borderRadius="md"
																		px={3}
																		py={2}
																		bg="blackAlpha.50"
																		_dark={{ bg: "whiteAlpha.50" }}
																	>
																		<HStack
																			justify="space-between"
																			align="center"
																			w="full"
																			dir="ltr"
																		>
																			<Text
																				fontWeight="medium"
																				noOfLines={1}
																				minW={0}
																				flex="1"
																				textAlign="left"
																				dir="ltr"
																				sx={{ unicodeBidi: "isolate" }}
																			>
																				{item.label}
																			</Text>
																			<HStack spacing={1} flexShrink={0}>
																				<CopyToClipboard
																					text={item.link}
																					onCopy={() =>
																						setCopiedConfigIndex(index)
																					}
																				>
																					<div>
																						<Tooltip
																							label={
																								copiedConfigIndex === index
																									? t("usersTable.copied")
																									: t(
																											"userDialog.links.copy",
																											"Copy",
																										)
																							}
																							placement="top"
																						>
																							<IconButton
																								aria-label="copy config"
																								variant="ghost"
																								size="sm"
																								type="button"
																							>
																								{copiedConfigIndex === index ? (
																									<CopiedActionIcon />
																								) : (
																									<CopyActionIcon />
																								)}
																							</IconButton>
																						</Tooltip>
																					</div>
																				</CopyToClipboard>
																				<Tooltip
																					label={t(
																						"userDialog.links.qr",
																						"QR",
																					)}
																					placement="top"
																				>
																					<IconButton
																						aria-label="config qr"
																						variant="ghost"
																						size="sm"
																						type="button"
																						onClick={() => {
																							setQRCode([item.link]);
																							setSubLink(null);
																						}}
																					>
																						<QRActionIcon />
																					</IconButton>
																				</Tooltip>
																			</HStack>
																		</HStack>
																	</Box>
																))
															)}
														</VStack>
													</Box>
												</VStack>
											</TabPanel>
										)}
									</TabPanels>
								</Tabs>
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
											disabled={submitDisabled}
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

