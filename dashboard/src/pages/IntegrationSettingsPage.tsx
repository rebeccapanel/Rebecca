import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	chakra,
	Divider,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	Heading,
	HStack,
	Input,
	InputGroup,
	InputLeftElement,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	SimpleGrid,
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
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ArrowsRightLeftIcon,
	ArrowUpTrayIcon,
	ChevronDownIcon as HeroChevronDownIcon,
	MagnifyingGlassIcon,
	PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import useGetUser from "hooks/useGetUser";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { fetch as apiFetch } from "service/http";
import {
	type AdminSubscriptionSettings,
	getPanelSettings,
	getSubscriptionSettings,
	getSubscriptionTemplateContent,
	getTelegramSettings,
	issueSubscriptionCertificate,
	type PanelSettingsResponse,
	renewSubscriptionCertificate,
	type SubscriptionSettingsBundle,
	type SubscriptionTemplateContentResponse,
	type SubscriptionTemplateSettings,
	type SubscriptionTemplateSettingsUpdatePayload,
	type TelegramSettingsResponse,
	type TelegramSettingsUpdatePayload,
	updateAdminSubscriptionSettings,
	updatePanelSettings,
	updateSubscriptionSettings,
	updateSubscriptionTemplateContent,
	updateTelegramSettings,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { JsonEditor } from "../components/JsonEditor";

type EventToggleItem = {
	key: string;
	labelKey: string;
	defaultLabel: string;
	hintKey: string;
	defaultHint: string;
};

type EventToggleGroup = {
	key: string;
	titleKey: string;
	defaultTitle: string;
	events: EventToggleItem[];
};

const TOGGLE_KEY_PLACEHOLDER = "__dot__";
type TemplateKey =
	| "clash_subscription_template"
	| "clash_settings_template"
	| "subscription_page_template"
	| "home_page_template"
	| "v2ray_subscription_template"
	| "v2ray_settings_template"
	| "singbox_subscription_template"
	| "singbox_settings_template"
	| "mux_template";

const isLikelyJsonTemplate = (templateName: string, content: string) => {
	const lower = templateName.toLowerCase();
	if (lower.endsWith(".json") || lower.includes("json")) {
		return true;
	}
	try {
		JSON.parse(content);
		return true;
	} catch {
		return false;
	}
};

const encodeToggleKey = (key: string) =>
	key.replace(/\./g, TOGGLE_KEY_PLACEHOLDER);
const decodeToggleKey = (key: string) =>
	key.replace(new RegExp(TOGGLE_KEY_PLACEHOLDER, "g"), ".");

type MaintenanceInfo = {
	panel?: { image?: string; tag?: string } | null;
	node?: { image?: string; tag?: string } | null;
};

type MaintenanceAction = "update" | "restart" | "soft-reload";

const flattenEventToggleValues = (
	source: Record<string, unknown>,
): Record<string, boolean> => {
	const result: Record<string, boolean> = {};

	const assignValue = (rawKey: string, rawValue: unknown) => {
		if (rawValue === undefined) {
			return;
		}
		if (typeof rawValue === "boolean") {
			result[decodeToggleKey(rawKey)] = rawValue;
			return;
		}
		if (typeof rawValue === "string") {
			if (rawValue === "") {
				return;
			}
			if (rawValue === "true" || rawValue === "false") {
				result[decodeToggleKey(rawKey)] = rawValue === "true";
			} else {
				result[decodeToggleKey(rawKey)] = Boolean(rawValue);
			}
			return;
		}
		if (typeof rawValue === "number") {
			result[decodeToggleKey(rawKey)] = rawValue !== 0;
			return;
		}
		if (Array.isArray(rawValue)) {
			result[decodeToggleKey(rawKey)] = rawValue.length > 0;
			return;
		}
		if (rawValue && typeof rawValue === "object") {
			Object.entries(rawValue as Record<string, unknown>).forEach(
				([childKey, childValue]) => {
					const nextKey = rawKey ? `${rawKey}.${childKey}` : childKey;
					assignValue(nextKey, childValue);
				},
			);
			return;
		}
		result[decodeToggleKey(rawKey)] = Boolean(rawValue);
	};

	Object.entries(source).forEach(([rawKey, rawValue]) => {
		assignValue(rawKey, rawValue);
	});

	return result;
};

const EVENT_TOGGLE_GROUPS: EventToggleGroup[] = [
	{
		key: "users",
		titleKey: "settings.telegram.groups.users",
		defaultTitle: "User events",
		events: [
			{
				key: "user.created",
				labelKey: "settings.telegram.events.userCreated",
				defaultLabel: "User created",
				hintKey: "settings.telegram.events.userCreatedHint",
				defaultHint: "Notify when a user is created.",
			},
			{
				key: "user.updated",
				labelKey: "settings.telegram.events.userUpdated",
				defaultLabel: "User updated",
				hintKey: "settings.telegram.events.userUpdatedHint",
				defaultHint: "Notify when a user is updated.",
			},
			{
				key: "user.deleted",
				labelKey: "settings.telegram.events.userDeleted",
				defaultLabel: "User deleted",
				hintKey: "settings.telegram.events.userDeletedHint",
				defaultHint: "Notify when a user is deleted.",
			},
			{
				key: "user.status_change",
				labelKey: "settings.telegram.events.userStatusChange",
				defaultLabel: "User status change",
				hintKey: "settings.telegram.events.userStatusChangeHint",
				defaultHint: "Notify when a user's status changes.",
			},
			{
				key: "user.usage_reset",
				labelKey: "settings.telegram.events.userUsageReset",
				defaultLabel: "User usage reset",
				hintKey: "settings.telegram.events.userUsageResetHint",
				defaultHint: "Notify when a user's usage is reset manually.",
			},
			{
				key: "user.auto_reset",
				labelKey: "settings.telegram.events.userAutoReset",
				defaultLabel: "User auto reset",
				hintKey: "settings.telegram.events.userAutoResetHint",
				defaultHint:
					"Notify when a user's usage is reset automatically by the next plan.",
			},
			{
				key: "user.auto_renew_set",
				labelKey: "settings.telegram.events.userAutoRenewSet",
				defaultLabel: "Auto renew set",
				hintKey: "settings.telegram.events.userAutoRenewSetHint",
				defaultHint: "Notify when auto renew is configured for a user.",
			},
			{
				key: "user.auto_renew_applied",
				labelKey: "settings.telegram.events.userAutoRenewApplied",
				defaultLabel: "Auto renew applied",
				hintKey: "settings.telegram.events.userAutoRenewAppliedHint",
				defaultHint: "Notify when an auto renew rule triggers for a user.",
			},
			{
				key: "user.subscription_revoked",
				labelKey: "settings.telegram.events.userSubscriptionRevoked",
				defaultLabel: "Subscription revoked",
				hintKey: "settings.telegram.events.userSubscriptionRevokedHint",
				defaultHint: "Notify when a user's subscription is revoked.",
			},
		],
	},
	{
		key: "admins",
		titleKey: "settings.telegram.groups.admins",
		defaultTitle: "Admin events",
		events: [
			{
				key: "admin.created",
				labelKey: "settings.telegram.events.adminCreated",
				defaultLabel: "Admin created",
				hintKey: "settings.telegram.events.adminCreatedHint",
				defaultHint: "Notify when an admin is created.",
			},
			{
				key: "admin.updated",
				labelKey: "settings.telegram.events.adminUpdated",
				defaultLabel: "Admin updated",
				hintKey: "settings.telegram.events.adminUpdatedHint",
				defaultHint: "Notify when an admin's settings change.",
			},
			{
				key: "admin.deleted",
				labelKey: "settings.telegram.events.adminDeleted",
				defaultLabel: "Admin deleted",
				hintKey: "settings.telegram.events.adminDeletedHint",
				defaultHint: "Notify when an admin is deleted.",
			},
			{
				key: "admin.usage_reset",
				labelKey: "settings.telegram.events.adminUsageReset",
				defaultLabel: "Admin usage reset",
				hintKey: "settings.telegram.events.adminUsageResetHint",
				defaultHint: "Notify when an admin's usage is reset.",
			},
			{
				key: "admin.limit.data",
				labelKey: "settings.telegram.events.adminDataLimit",
				defaultLabel: "Admin data limit reached",
				hintKey: "settings.telegram.events.adminDataLimitHint",
				defaultHint: "Notify when an admin reaches their data limit.",
			},
			{
				key: "admin.limit.users",
				labelKey: "settings.telegram.events.adminUsersLimit",
				defaultLabel: "Admin users limit reached",
				hintKey: "settings.telegram.events.adminUsersLimitHint",
				defaultHint: "Notify when an admin reaches their users limit.",
			},
		],
	},
	{
		key: "nodes",
		titleKey: "settings.telegram.groups.nodes",
		defaultTitle: "Node events",
		events: [
			{
				key: "node.created",
				labelKey: "settings.telegram.events.nodeCreated",
				defaultLabel: "Node created",
				hintKey: "settings.telegram.events.nodeCreatedHint",
				defaultHint: "Notify when a node is created.",
			},
			{
				key: "node.deleted",
				labelKey: "settings.telegram.events.nodeDeleted",
				defaultLabel: "Node deleted",
				hintKey: "settings.telegram.events.nodeDeletedHint",
				defaultHint: "Notify when a node is deleted.",
			},
			{
				key: "node.usage_reset",
				labelKey: "settings.telegram.events.nodeUsageReset",
				defaultLabel: "Node usage reset",
				hintKey: "settings.telegram.events.nodeUsageResetHint",
				defaultHint: "Notify when a node's usage is reset.",
			},
			{
				key: "node.status.connected",
				labelKey: "settings.telegram.events.nodeStatusConnected",
				defaultLabel: "Node connected",
				hintKey: "settings.telegram.events.nodeStatusConnectedHint",
				defaultHint: "Notify when a node connects.",
			},
			{
				key: "node.status.connecting",
				labelKey: "settings.telegram.events.nodeStatusConnecting",
				defaultLabel: "Node connecting",
				hintKey: "settings.telegram.events.nodeStatusConnectingHint",
				defaultHint: "Notify when a node is connecting.",
			},
			{
				key: "node.status.error",
				labelKey: "settings.telegram.events.nodeStatusError",
				defaultLabel: "Node error",
				hintKey: "settings.telegram.events.nodeStatusErrorHint",
				defaultHint: "Notify when a node reports an error.",
			},
			{
				key: "node.status.disabled",
				labelKey: "settings.telegram.events.nodeStatusDisabled",
				defaultLabel: "Node disabled",
				hintKey: "settings.telegram.events.nodeStatusDisabledHint",
				defaultHint: "Notify when a node is disabled.",
			},
			{
				key: "node.status.limited",
				labelKey: "settings.telegram.events.nodeStatusLimited",
				defaultLabel: "Node limited",
				hintKey: "settings.telegram.events.nodeStatusLimitedHint",
				defaultHint: "Notify when a node is limited.",
			},
		],
	},
	{
		key: "login",
		titleKey: "settings.telegram.groups.login",
		defaultTitle: "Login events",
		events: [
			{
				key: "login",
				labelKey: "settings.telegram.events.login",
				defaultLabel: "Login notifications",
				hintKey: "settings.telegram.events.loginHint",
				defaultHint: "Notify about administrator login attempts.",
			},
		],
	},
	{
		key: "errors",
		titleKey: "settings.telegram.groups.errors",
		defaultTitle: "Error events",
		events: [
			{
				key: "errors.node",
				labelKey: "settings.telegram.events.nodeErrors",
				defaultLabel: "Node error logs",
				hintKey: "settings.telegram.events.nodeErrorsHint",
				defaultHint: "Notify about node errors reported by the system.",
			},
		],
	},
];

const EVENT_TOGGLE_KEYS = EVENT_TOGGLE_GROUPS.flatMap((group) =>
	group.events.map((event) => event.key),
);

type TopicFormValue = {
	title: string;
	topic_id: string;
};

type FormValues = {
	api_token: string;
	use_telegram: boolean;
	proxy_url: string;
	admin_chat_ids: string;
	logs_chat_id: string;
	logs_chat_is_forum: boolean;
	default_vless_flow: string;
	forum_topics: Record<string, TopicFormValue>;
	event_toggles: Record<string, boolean>;
};

const RefreshIcon = chakra(ArrowPathIcon, { baseStyle: { w: 4, h: 4 } });
const SaveIcon = chakra(PaperAirplaneIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronDownIcon = chakra(HeroChevronDownIcon, {
	baseStyle: { w: 4, h: 4 },
});
const SearchIcon = chakra(MagnifyingGlassIcon, { baseStyle: { w: 4, h: 4 } });

const buildDefaultValues = (settings: TelegramSettingsResponse): FormValues => {
	const topics: Record<string, TopicFormValue> = {};
	Object.entries(settings.forum_topics || {}).forEach(([key, value]) => {
		topics[key] = {
			title: value.title ?? "",
			topic_id: value.topic_id != null ? String(value.topic_id) : "",
		};
	});

	const toggles: Record<string, boolean> = {};
	EVENT_TOGGLE_KEYS.forEach((key) => {
		const formKey = encodeToggleKey(key);
		const current = settings.event_toggles?.[key];
		toggles[formKey] = current === undefined ? true : Boolean(current);
	});
	Object.entries(settings.event_toggles || {}).forEach(([key, value]) => {
		const formKey = encodeToggleKey(key);
		if (!(formKey in toggles)) {
			toggles[formKey] = Boolean(value);
		}
	});

	return {
		api_token: settings.api_token ?? "",
		use_telegram: settings.use_telegram ?? true,
		proxy_url: settings.proxy_url ?? "",
		admin_chat_ids: (settings.admin_chat_ids || []).join(", "),
		logs_chat_id:
			settings.logs_chat_id != null ? String(settings.logs_chat_id) : "",
		logs_chat_is_forum: settings.logs_chat_is_forum,
		default_vless_flow: settings.default_vless_flow ?? "",
		forum_topics: topics,
		event_toggles: toggles,
	};
};

type SubscriptionFormValues = SubscriptionTemplateSettings & {
	subscription_aliases_text: string;
};

const buildSubscriptionDefaults = (
	settings?: SubscriptionTemplateSettings,
): SubscriptionFormValues => ({
	subscription_url_prefix: settings?.subscription_url_prefix ?? "",
	subscription_profile_title: settings?.subscription_profile_title ?? "",
	subscription_support_url: settings?.subscription_support_url ?? "",
	subscription_update_interval: settings?.subscription_update_interval ?? "",
	custom_templates_directory: settings?.custom_templates_directory ?? "",
	clash_subscription_template: settings?.clash_subscription_template ?? "",
	clash_settings_template: settings?.clash_settings_template ?? "",
	subscription_page_template: settings?.subscription_page_template ?? "",
	home_page_template: settings?.home_page_template ?? "",
	v2ray_subscription_template: settings?.v2ray_subscription_template ?? "",
	v2ray_settings_template: settings?.v2ray_settings_template ?? "",
	singbox_subscription_template: settings?.singbox_subscription_template ?? "",
	singbox_settings_template: settings?.singbox_settings_template ?? "",
	mux_template: settings?.mux_template ?? "",
	use_custom_json_default: settings?.use_custom_json_default ?? false,
	use_custom_json_for_v2rayn: settings?.use_custom_json_for_v2rayn ?? false,
	use_custom_json_for_v2rayng: settings?.use_custom_json_for_v2rayng ?? false,
	use_custom_json_for_streisand:
		settings?.use_custom_json_for_streisand ?? false,
	use_custom_json_for_happ: settings?.use_custom_json_for_happ ?? false,
	subscription_path: settings?.subscription_path ?? "sub",
	subscription_aliases: settings?.subscription_aliases ?? [],
	subscription_aliases_text: (settings?.subscription_aliases ?? []).join("\n"),
});

const cleanOverridePayload = (
	settings?: Partial<SubscriptionTemplateSettings>,
): Partial<SubscriptionTemplateSettings> => {
	const cleaned: Partial<SubscriptionTemplateSettings> = {};
	const target = cleaned as Record<
		keyof SubscriptionTemplateSettings,
		SubscriptionTemplateSettings[keyof SubscriptionTemplateSettings]
	>;
	(
		Object.keys(settings || {}) as (keyof SubscriptionTemplateSettings)[]
	).forEach((key) => {
		const value = settings?.[key];
		if (value === undefined || value === null) {
			return;
		}
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}
			target[key] =
				trimmed as SubscriptionTemplateSettings[keyof SubscriptionTemplateSettings];
			return;
		}
		target[key] =
			value as SubscriptionTemplateSettings[keyof SubscriptionTemplateSettings];
	});
	return cleaned;
};

const DisabledCard = ({
	disabled,
	message,
	children,
}: {
	disabled: boolean;
	message: string;
	children: ReactNode;
}) => (
	<Box position="relative">
		<Box
			pointerEvents={disabled ? "none" : "auto"}
			filter={disabled ? "blur(1.2px)" : "none"}
			opacity={disabled ? 0.55 : 1}
			transition="all 0.2s ease"
		>
			{children}
		</Box>
		{disabled && (
			<Flex
				position="absolute"
				inset={0}
				align="center"
				justify="center"
				textAlign="center"
				fontWeight="semibold"
				color="white"
				px={6}
				borderRadius="inherit"
				bg="blackAlpha.400"
				backdropFilter="blur(2px)"
			>
				<Text>{message}</Text>
			</Flex>
		)}
	</Box>
);

const parseAdminChatIds = (value: string): number[] =>
	value
		.split(/[\s,]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
		.map((token) => Number(token))
		.filter((token) => Number.isFinite(token));

export const IntegrationSettingsPage = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { userData, getUserIsSuccess } = useGetUser();
	const isSudoOrFull =
		userData?.role === "sudo" || userData?.role === "full_access";
	const canManageIntegrations =
		getUserIsSuccess &&
		(isSudoOrFull || Boolean(userData.permissions?.sections.integrations));
	const queryClient = useQueryClient();

	const { data, isLoading, refetch } = useQuery(
		"telegram-settings",
		getTelegramSettings,
		{
			refetchOnWindowFocus: false,
			enabled: canManageIntegrations,
		},
	);

	const {
		data: panelData,
		isLoading: isPanelLoading,
		refetch: refetchPanelSettings,
	} = useQuery<PanelSettingsResponse>("panel-settings", getPanelSettings, {
		refetchOnWindowFocus: false,
		enabled: canManageIntegrations,
	});

	const {
		data: subscriptionBundle,
		isLoading: isSubscriptionLoading,
		refetch: refetchSubscriptionSettings,
	} = useQuery<SubscriptionSettingsBundle>(
		"subscription-settings",
		getSubscriptionSettings,
		{
			refetchOnWindowFocus: false,
			enabled: canManageIntegrations,
		},
	);

	const maintenanceInfoQuery = useQuery<MaintenanceInfo>(
		"maintenance-info",
		() => apiFetch<MaintenanceInfo>("/maintenance/info"),
		{ refetchOnWindowFocus: false, enabled: canManageIntegrations },
	);

	const [activeMaintenanceAction, setActiveMaintenanceAction] =
		useState<MaintenanceAction | null>(null);

	useEffect(() => {
		if (!activeMaintenanceAction) {
			return;
		}
		const timer = window.setTimeout(
			() => setActiveMaintenanceAction(null),
			15000,
		);
		return () => window.clearTimeout(timer);
	}, [activeMaintenanceAction]);

	const [panelUseNobetci, setPanelUseNobetci] = useState<boolean>(
		panelData?.use_nobetci ?? false,
	);
	const [panelAccessInsightsEnabled, setPanelAccessInsightsEnabled] =
		useState<boolean>(panelData?.access_insights_enabled ?? false);
	const [panelDefaultSubType, setPanelDefaultSubType] = useState<
		"username-key" | "key" | "token"
	>(panelData?.default_subscription_type ?? "key");

	useEffect(() => {
		if (panelData) {
			setPanelUseNobetci(panelData.use_nobetci);
			setPanelAccessInsightsEnabled(panelData.access_insights_enabled ?? false);
			setPanelDefaultSubType(panelData.default_subscription_type ?? "key");
		}
	}, [panelData]);

	const [adminOverrides, setAdminOverrides] = useState<
		Record<number, AdminSubscriptionSettings>
	>({});
	const [savingAdminId, setSavingAdminId] = useState<number | null>(null);
	const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
	const [activeIntegrationTab, setActiveIntegrationTab] = useState<number>(0);
	const [adminSearchTerm, setAdminSearchTerm] = useState<string>("");
	const [templateDialog, setTemplateDialog] = useState<{
		templateKey: TemplateKey;
		adminId: number | null;
	} | null>(null);
	const [templateContent, setTemplateContent] = useState<string>("");
	const [templateMeta, setTemplateMeta] =
		useState<SubscriptionTemplateContentResponse | null>(null);
	const [templateIsJson, setTemplateIsJson] = useState<boolean>(true);
	const [templateLoading, setTemplateLoading] = useState<boolean>(false);
	const [certificateForm, setCertificateForm] = useState<{
		email: string;
		domains: string;
	}>({
		email: "",
		domains: "",
	});
	const [renewingDomain, setRenewingDomain] = useState<string | null>(null);

	useEffect(() => {
		if (subscriptionBundle?.admins) {
			const next: Record<number, AdminSubscriptionSettings> = {};
			subscriptionBundle.admins.forEach((admin) => {
				next[admin.id] = {
					...admin,
					subscription_settings: admin.subscription_settings || {},
				};
			});
			setAdminOverrides(next);
		}
	}, [subscriptionBundle]);

	useEffect(() => {
		const ids = Object.values(adminOverrides).map((adm) => adm.id);
		if (ids.length === 0) {
			setSelectedAdminId(null);
			return;
		}
		if (!selectedAdminId || !ids.includes(selectedAdminId)) {
			setSelectedAdminId(ids[0]);
		}
	}, [adminOverrides, selectedAdminId]);

	const triggerMaintenanceAction = async (
		path:
			| "/maintenance/update"
			| "/maintenance/restart"
			| "/maintenance/soft-reload",
	): Promise<{ wentOffline: boolean }> => {
		try {
			await apiFetch(path, { method: "POST", timeout: 3000 });
			return { wentOffline: false };
		} catch (error: any) {
			const isLikelyPanelOffline = !error?.response;
			if (isLikelyPanelOffline) {
				return { wentOffline: true };
			}
			throw error;
		}
	};

	const handleMaintenanceSuccess = (
		action: MaintenanceAction,
		result: { wentOffline: boolean },
	) => {
		setActiveMaintenanceAction(action);
		let messageKey = "settings.panel.restartTriggered";
		if (action === "update") {
			messageKey = "settings.panel.updateTriggered";
		} else if (action === "soft-reload") {
			messageKey = "settings.panel.softReloadTriggered";
		}
		generateSuccessMessage(t(messageKey), toast);
		if (result.wentOffline) {
			toast({
				title: t("settings.panel.maintenanceOfflineNotice"),
				status: "info",
				duration: 4000,
				isClosable: true,
				position: "top",
			});
		}
		window.setTimeout(() => maintenanceInfoQuery.refetch(), 6000);
	};

	const updateMutation = useMutation(
		() => triggerMaintenanceAction("/maintenance/update"),
		{
			retry: false,
			onMutate: () => setActiveMaintenanceAction("update"),
			onSuccess: (result) => handleMaintenanceSuccess("update", result),
			onError: (error) => {
				setActiveMaintenanceAction(null);
				generateErrorMessage(error, toast);
			},
		},
	);

	const restartMutation = useMutation(
		() => triggerMaintenanceAction("/maintenance/restart"),
		{
			retry: false,
			onMutate: () => setActiveMaintenanceAction("restart"),
			onSuccess: (result) => handleMaintenanceSuccess("restart", result),
			onError: (error) => {
				setActiveMaintenanceAction(null);
				generateErrorMessage(error, toast);
			},
		},
	);

	const softReloadMutation = useMutation(
		() => triggerMaintenanceAction("/maintenance/soft-reload"),
		{
			retry: false,
			onMutate: () => setActiveMaintenanceAction("soft-reload"),
			onSuccess: (result) => handleMaintenanceSuccess("soft-reload", result),
			onError: (error) => {
				setActiveMaintenanceAction(null);
				generateErrorMessage(error, toast);
			},
		},
	);

	const {
		register,
		control,
		handleSubmit,
		reset,
		watch: watchTelegram,
		formState: { isDirty },
	} = useForm<FormValues>({
		defaultValues: buildDefaultValues(
			data ?? {
				api_token: null,
				use_telegram: true,
				proxy_url: null,
				admin_chat_ids: [],
				logs_chat_id: null,
				logs_chat_is_forum: false,
				default_vless_flow: null,
				forum_topics: {},
				event_toggles: {},
			},
		),
	});

	useEffect(() => {
		if (data) {
			reset(buildDefaultValues(data));
		}
	}, [data, reset]);

	const {
		register: subscriptionRegister,
		control: subscriptionControl,
		handleSubmit: handleSubscriptionSubmit,
		reset: resetSubscription,
		formState: { isDirty: isSubscriptionDirty },
	} = useForm<SubscriptionFormValues>({
		defaultValues: buildSubscriptionDefaults(subscriptionBundle?.settings),
	});

	useEffect(() => {
		if (subscriptionBundle?.settings) {
			resetSubscription(buildSubscriptionDefaults(subscriptionBundle.settings));
		}
	}, [subscriptionBundle, resetSubscription]);

	const integrationTabKeys = useMemo(
		() => ["panel", "telegram", "subscriptions"],
		[],
	);
	const splitHash = useCallback(() => {
		const hash = window.location.hash || "";
		const idx = hash.indexOf("#", 1);
		return {
			base: idx >= 0 ? hash.slice(0, idx) : hash,
			tab: idx >= 0 ? hash.slice(idx + 1) : "",
		};
	}, []);
	useEffect(() => {
		const syncTabFromHash = () => {
			const { tab } = splitHash();
			const idx = integrationTabKeys.findIndex(
				(key) => key.toLowerCase() === tab.toLowerCase(),
			);
			if (idx >= 0) {
				setActiveIntegrationTab(idx);
			} else {
				// default tab if none present in hash
				setActiveIntegrationTab(0);
				const { base } = splitHash();
				const defaultKey = integrationTabKeys[0];
				window.location.hash = `${base || "#"}#${defaultKey}`;
			}
		};
		syncTabFromHash();
		window.addEventListener("hashchange", syncTabFromHash);
		return () => window.removeEventListener("hashchange", syncTabFromHash);
	}, [integrationTabKeys, splitHash]);

	const mutation = useMutation(updateTelegramSettings, {
		onSuccess: (updated) => {
			reset(buildDefaultValues(updated));
			queryClient.setQueryData("telegram-settings", updated);
			toast({
				title: t("settings.savedSuccess"),
				status: "success",
				duration: 3000,
			});
		},
		onError: () => {
			toast({
				title: t("errors.generic"),
				status: "error",
			});
		},
	});

	const panelMutation = useMutation(updatePanelSettings, {
		onSuccess: (updated) => {
			setPanelUseNobetci(updated.use_nobetci);
			setPanelAccessInsightsEnabled(updated.access_insights_enabled ?? false);
			setPanelDefaultSubType(updated.default_subscription_type ?? "key");
			queryClient.setQueryData("panel-settings", updated);
			toast({
				title: t("settings.panel.saved"),
				status: "success",
				duration: 3000,
			});
		},
		onError: () => {
			toast({
				title: t("errors.generic"),
				status: "error",
			});
		},
	});

	const subscriptionSettingsMutation = useMutation(updateSubscriptionSettings, {
		onSuccess: (updated) => {
			resetSubscription(buildSubscriptionDefaults(updated));
			queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
				"subscription-settings",
				(prev) =>
					prev
						? { ...prev, settings: updated }
						: {
								settings: updated,
								admins: [],
								certificates: [],
							},
			);
			toast({
				title: t("settings.subscriptions.saved"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const adminSubscriptionMutation = useMutation(
		(payload: { id: number; data: any }) =>
			updateAdminSubscriptionSettings(payload.id, payload.data),
		{
			onMutate: ({ id }) => setSavingAdminId(id),
			onSuccess: (updated) => {
				setAdminOverrides((prev) => ({
					...prev,
					[updated.id]: {
						...updated,
						subscription_settings: updated.subscription_settings || {},
					},
				}));
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
					"subscription-settings",
					(prev) =>
						prev
							? {
									...prev,
									admins: prev.admins.map((admin) =>
										admin.id === updated.id ? updated : admin,
									),
								}
							: prev,
				);
				toast({
					title: t("settings.subscriptions.adminSaved"),
					status: "success",
					duration: 2500,
				});
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
			onSettled: () => setSavingAdminId(null),
		},
	);

	const templateContentMutation = useMutation(
		(payload: {
			templateKey: TemplateKey;
			content: string;
			adminId: number | null;
		}) =>
			updateSubscriptionTemplateContent(payload.templateKey, {
				content: payload.content,
				admin_id: payload.adminId ?? undefined,
			}),
		{
			onSuccess: (updated) => {
				setTemplateMeta(updated);
				setTemplateContent(updated.content || "");
				generateSuccessMessage(
					t(
						"settings.subscriptions.templateSaved",
						"Template saved successfully",
					),
					toast,
				);
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
		},
	);

	const issueCertificateMutation = useMutation(issueSubscriptionCertificate, {
		onSuccess: (cert) => {
			queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
				"subscription-settings",
				(prev) =>
					prev
						? {
								...prev,
								certificates: [
									cert,
									...(prev.certificates || []).filter(
										(existing) => existing.domain !== cert.domain,
									),
								],
							}
						: {
								settings: buildSubscriptionDefaults(),
								admins: [],
								certificates: [cert],
							},
			);
			setCertificateForm((prev) => ({ ...prev, domains: "" }));
			toast({
				title: t("settings.subscriptions.certificateIssued"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const renewCertificateMutation = useMutation(renewSubscriptionCertificate, {
		onMutate: (payload) => setRenewingDomain(payload?.domain || null),
		onSuccess: (cert) => {
			if (cert) {
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
					"subscription-settings",
					(prev) =>
						prev
							? {
									...prev,
									certificates: prev.certificates.map((existing) =>
										existing.domain === cert.domain ? cert : existing,
									),
								}
							: prev,
				);
			}
			toast({
				title: t("settings.subscriptions.certificateRenewed"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
		onSettled: () => setRenewingDomain(null),
	});

	const onSubmit = (values: FormValues) => {
		const flattenedEventToggles = flattenEventToggleValues(
			values.event_toggles || {},
		);

		const payload: TelegramSettingsUpdatePayload = {
			api_token: values.api_token.trim() || null,
			use_telegram: values.use_telegram,
			proxy_url: values.proxy_url.trim() || null,
			admin_chat_ids: parseAdminChatIds(values.admin_chat_ids),
			logs_chat_id: values.logs_chat_id.trim()
				? Number(values.logs_chat_id.trim())
				: null,
			logs_chat_is_forum: values.logs_chat_is_forum,
			default_vless_flow: values.default_vless_flow.trim() || null,
			forum_topics: Object.fromEntries(
				Object.entries(values.forum_topics || {}).map(([key, topic]) => [
					key,
					{
						title: topic.title,
						topic_id: topic.topic_id.trim()
							? Number(topic.topic_id.trim())
							: undefined,
					},
				]),
			),
			event_toggles: flattenedEventToggles,
		};
		mutation.mutate(payload);
	};

	const onSubmitSubscriptionSettings = (values: SubscriptionFormValues) => {
		const aliases = (values.subscription_aliases_text || "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const payload: SubscriptionTemplateSettingsUpdatePayload = {
			subscription_url_prefix: values.subscription_url_prefix ?? "",
			subscription_profile_title: values.subscription_profile_title.trim(),
			subscription_support_url: values.subscription_support_url.trim(),
			subscription_update_interval: values.subscription_update_interval.trim(),
			custom_templates_directory:
				values.custom_templates_directory?.trim() || null,
			clash_subscription_template: values.clash_subscription_template.trim(),
			clash_settings_template: values.clash_settings_template.trim(),
			subscription_page_template: values.subscription_page_template.trim(),
			home_page_template: values.home_page_template.trim(),
			v2ray_subscription_template: values.v2ray_subscription_template.trim(),
			v2ray_settings_template: values.v2ray_settings_template.trim(),
			singbox_subscription_template:
				values.singbox_subscription_template.trim(),
			singbox_settings_template: values.singbox_settings_template.trim(),
			mux_template: values.mux_template.trim(),
			use_custom_json_default: values.use_custom_json_default,
			use_custom_json_for_v2rayn: values.use_custom_json_for_v2rayn,
			use_custom_json_for_v2rayng: values.use_custom_json_for_v2rayng,
			use_custom_json_for_streisand: values.use_custom_json_for_streisand,
			use_custom_json_for_happ: values.use_custom_json_for_happ,
			subscription_aliases: aliases,
		};
		subscriptionSettingsMutation.mutate(payload);
	};

	const handleAdminFieldChange = (
		adminId: number,
		field: keyof AdminSubscriptionSettings,
		value: string | null,
	) => {
		setAdminOverrides((prev) => ({
			...prev,
			[adminId]: {
				...(prev[adminId] || {}),
				[field]:
					value as AdminSubscriptionSettings[keyof AdminSubscriptionSettings],
			},
		}));
	};

	const handleAdminTemplateChange = (
		adminId: number,
		key: keyof SubscriptionTemplateSettings,
		value: string | boolean,
	) => {
		setAdminOverrides((prev) => {
			const current = prev[adminId] || {
				id: adminId,
				username: "",
				subscription_settings: {},
				subscription_domain: null,
			};
			return {
				...prev,
				[adminId]: {
					...current,
					subscription_settings: {
						...(current.subscription_settings || {}),
						[key]: value,
					},
				},
			};
		});
	};

	const handleAdminReset = (adminId: number) => {
		const admin = adminOverrides[adminId];
		if (!admin) return;
		setAdminOverrides((prev) => ({
			...prev,
			[adminId]: {
				...admin,
				subscription_domain: null,
				subscription_settings: {},
			},
		}));
	};

	const handleAdminSave = (adminId: number) => {
		const admin = adminOverrides[adminId];
		if (!admin) {
			return;
		}
		const payload = {
			subscription_domain: admin.subscription_domain?.trim() || null,
			subscription_settings: cleanOverridePayload(
				admin.subscription_settings || {},
			),
		};
		adminSubscriptionMutation.mutate({ id: adminId, data: payload });
	};

	const openTemplateEditor = async (
		templateKey: TemplateKey,
		adminId: number | null,
	) => {
		setTemplateDialog({ templateKey, adminId });
		setTemplateLoading(true);
		try {
			const data = await getSubscriptionTemplateContent(
				templateKey,
				adminId ?? undefined,
			);
			setTemplateMeta(data);
			setTemplateContent(data.content || "");
			setTemplateIsJson(
				isLikelyJsonTemplate(data.template_name || "", data.content || ""),
			);
		} catch (error) {
			setTemplateDialog(null);
			generateErrorMessage(error, toast);
		} finally {
			setTemplateLoading(false);
		}
	};

	const closeTemplateEditor = () => {
		setTemplateDialog(null);
		setTemplateMeta(null);
		setTemplateContent("");
		setTemplateIsJson(true);
	};

	const handleIntegrationTabChange = (index: number) => {
		setActiveIntegrationTab(index);
		const key = integrationTabKeys[index] || "";
		const { base } = splitHash();
		window.location.hash = `${base || "#"}${key ? `#${key}` : ""}`;
	};

	const adminOptions = Object.values(adminOverrides);
	const filteredAdmins =
		adminSearchTerm.trim().length === 0
			? adminOptions
			: adminOptions.filter((admin) => {
					const q = adminSearchTerm.toLowerCase();
					return (
						admin.username.toLowerCase().includes(q) ||
						(admin.subscription_domain || "").toLowerCase().includes(q)
					);
				});

	const handleTemplateSave = () => {
		if (!templateDialog) return;
		templateContentMutation.mutate({
			templateKey: templateDialog.templateKey,
			content: templateContent,
			adminId: templateDialog.adminId,
		});
	};

	const handleIssueCertificate = () => {
		const domains = Array.from(
			new Set(
				certificateForm.domains
					.split(/[,\\s]+/)
					.map((domain) => domain.trim())
					.filter(Boolean),
			),
		);
		if (!certificateForm.email.trim() || domains.length === 0) {
			toast({
				title: t(
					"settings.subscriptions.certificateMissingInput",
					"Add email and at least one domain.",
				),
				status: "warning",
				duration: 2500,
			});
			return;
		}
		issueCertificateMutation.mutate({
			email: certificateForm.email.trim(),
			domains,
		});
	};

	const handleRenewCertificate = (domain: string) => {
		if (!domain) {
			return;
		}
		renewCertificateMutation.mutate({ domain });
	};

	const forumTopics = watchTelegram("forum_topics");
	const isTelegramEnabled = watchTelegram("use_telegram");
	const telegramDisabledMessage = t("settings.telegram.disabledOverlay");

	if (!getUserIsSuccess) {
		return (
			<Flex align="center" justify="center" py={12}>
				<Spinner size="lg" />
			</Flex>
		);
	}

	if (!canManageIntegrations) {
		return (
			<VStack spacing={4} align="stretch">
				<Heading size="lg">{t("header.integrationSettings")}</Heading>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t("integrations.noPermission")}
				</Text>
			</VStack>
		);
	}

	return (
		<Box px={{ base: 4, md: 8 }} py={{ base: 6, md: 8 }}>
			<Heading size="lg" mb={4}>
				{t("settings.integrations")}
			</Heading>
			<Tabs
				colorScheme="primary"
				index={activeIntegrationTab}
				onChange={handleIntegrationTabChange}
			>
				<TabList>
					<Tab>{t("settings.panel.tabTitle")}</Tab>
					<Tab>{t("settings.telegram")}</Tab>
					<Tab>{t("settings.subscriptions.tabTitle", "Subscriptions")}</Tab>
				</TabList>
				<TabPanels>
					<TabPanel px={{ base: 0, md: 2 }}>
						{isPanelLoading && panelData === undefined ? (
							<Flex align="center" justify="center" py={12}>
								<Spinner size="lg" />
							</Flex>
						) : (
							<Stack spacing={6} align="stretch">
								<Text fontSize="sm" color="gray.500">
									{t("settings.panel.description")}
								</Text>
								<Box borderWidth="1px" borderRadius="lg" p={4}>
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t("settings.panel.useNobetciTitle")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t("settings.panel.useNobetciDescription")}
											</Text>
										</Box>
										<Switch
											isChecked={panelUseNobetci}
											onChange={(event) =>
												setPanelUseNobetci(event.target.checked)
											}
											isDisabled={panelMutation.isLoading || isPanelLoading}
										/>
									</Flex>
								</Box>
								<Box borderWidth="1px" borderRadius="lg" p={4}>
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t(
													"settings.panel.accessInsightsTitle",
													"Enable Access Insights",
												)}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t(
													"settings.panel.accessInsightsDescription",
													"When enabled, Access Insights will load extra geo/ISP data and may consume more memory.",
												)}
											</Text>
										</Box>
										<Switch
											isChecked={panelAccessInsightsEnabled}
											onChange={(event) =>
												setPanelAccessInsightsEnabled(event.target.checked)
											}
											isDisabled={panelMutation.isLoading || isPanelLoading}
										/>
									</Flex>
								</Box>
								<Box borderWidth="1px" borderRadius="lg" p={4}>
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t(
													"settings.panel.defaultSubscriptionType",
													"Default subscription link format",
												)}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t(
													"settings.panel.defaultSubscriptionTypeDescription",
													"Choose which subscription link format is shown by default. All formats remain valid.",
												)}
											</Text>
										</Box>
										<FormControl maxW={{ base: "full", md: "240px" }}>
											<FormLabel fontSize="sm" mb={1}>
												{t(
													"settings.panel.defaultSubscriptionTypeLabel",
													"Default link format",
												)}
											</FormLabel>
											<Select
												size="sm"
												value={panelDefaultSubType}
												onChange={(event) =>
													setPanelDefaultSubType(
														event.target.value as
															| "username-key"
															| "key"
															| "token",
													)
												}
												isDisabled={panelMutation.isLoading || isPanelLoading}
											>
												<option value="username-key">
													{t("settings.panel.link.usernameKey", "username/key")}
												</option>
												<option value="key">
													{t("settings.panel.link.keyOnly", "key only")}
												</option>
												<option value="token">
													{t("settings.panel.link.token", "token")}
												</option>
											</Select>
										</FormControl>
									</Flex>
								</Box>
								<Box borderWidth="1px" borderRadius="lg" p={4}>
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t("settings.panel.maintenanceTitle")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t("settings.panel.maintenanceDescription")}
											</Text>
										</Box>
										<Button
											variant="outline"
											size="sm"
											leftIcon={<ArrowPathIcon width={16} height={16} />}
											onClick={() => maintenanceInfoQuery.refetch()}
											isLoading={maintenanceInfoQuery.isFetching}
										>
											{t("actions.refresh")}
										</Button>
									</Flex>
									<Stack spacing={2} mt={4}>
										{maintenanceInfoQuery.isLoading &&
										!maintenanceInfoQuery.data ? (
											<Flex align="center" justify="center" py={4}>
												<Spinner size="sm" />
											</Flex>
										) : (
											<>
												<Box>
													<Text fontWeight="semibold">
														{t("settings.panel.panelVersion")}
													</Text>
													<Text fontSize="sm" color="gray.500">
														{maintenanceInfoQuery.data?.panel?.image
															? `${maintenanceInfoQuery.data.panel.image}${
																	maintenanceInfoQuery.data.panel.tag
																		? ` (${maintenanceInfoQuery.data.panel.tag})`
																		: ""
																}`
															: t("settings.panel.versionUnknown")}
													</Text>
												</Box>
												<Box>
													<Text fontWeight="semibold">
														{t("settings.panel.nodeVersion")}
													</Text>
													<Text fontSize="sm" color="gray.500">
														{maintenanceInfoQuery.data?.node
															? maintenanceInfoQuery.data.node.image
																? `${maintenanceInfoQuery.data.node.image}${
																		maintenanceInfoQuery.data.node.tag
																			? ` (${maintenanceInfoQuery.data.node.tag})`
																			: ""
																	}`
																: t("settings.panel.versionUnknown")
															: t("settings.panel.nodeVersionUnavailable")}
													</Text>
												</Box>
											</>
										)}
									</Stack>
									<Stack spacing={2} mt={4}>
										<Text fontSize="sm" color="gray.500">
											{t("settings.panel.maintenanceActionsDescription")}
										</Text>
										{activeMaintenanceAction && (
											<Alert status="info" variant="subtle" borderRadius="md">
												<AlertIcon />
												<Text fontSize="sm">
													{activeMaintenanceAction === "update"
														? t("settings.panel.updateInProgressHint")
														: activeMaintenanceAction === "restart"
															? t("settings.panel.restartInProgressHint")
															: t(
																	"settings.panel.softReloadInProgressHint",
																	"Soft reloading panel...",
																)}
												</Text>
											</Alert>
										)}
										<HStack spacing={3} flexWrap="wrap">
											<Button
												size="sm"
												colorScheme="yellow"
												leftIcon={<ArrowUpTrayIcon width={16} height={16} />}
												onClick={() => updateMutation.mutate()}
												isLoading={updateMutation.isLoading}
											>
												{t("settings.panel.updateAction")}
											</Button>
											<Button
												size="sm"
												colorScheme="blue"
												leftIcon={<ArrowPathIcon width={16} height={16} />}
												onClick={() => softReloadMutation.mutate()}
												isLoading={softReloadMutation.isLoading}
											>
												{t("settings.panel.softReloadAction", "Soft Reload")}
											</Button>
											<Button
												size="sm"
												colorScheme="red"
												leftIcon={
													<ArrowsRightLeftIcon width={16} height={16} />
												}
												onClick={() => restartMutation.mutate()}
												isLoading={restartMutation.isLoading}
											>
												{t("settings.panel.restartAction")}
											</Button>
										</HStack>
									</Stack>
								</Box>
								<Flex gap={3} justify="flex-end">
									<Button
										variant="outline"
										leftIcon={<RefreshIcon />}
										onClick={() => refetchPanelSettings()}
										isDisabled={panelMutation.isLoading}
									>
										{t("actions.refresh")}
									</Button>
									<Button
										colorScheme="primary"
										leftIcon={<SaveIcon />}
										onClick={() =>
											panelMutation.mutate({
												use_nobetci: panelUseNobetci,
												access_insights_enabled: panelAccessInsightsEnabled,
												default_subscription_type: panelDefaultSubType,
											})
										}
										isLoading={panelMutation.isLoading}
										isDisabled={
											panelMutation.isLoading ||
											panelData === undefined ||
											(panelUseNobetci === panelData.use_nobetci &&
												panelAccessInsightsEnabled ===
													(panelData.access_insights_enabled ?? false) &&
												panelDefaultSubType ===
													(panelData.default_subscription_type ?? "key"))
										}
									>
										{t("settings.save")}
									</Button>
								</Flex>
							</Stack>
						)}
					</TabPanel>
					<TabPanel px={{ base: 0, md: 2 }}>
						{isLoading && !data ? (
							<Flex align="center" justify="center" py={12}>
								<Spinner size="lg" />
							</Flex>
						) : (
							<form onSubmit={handleSubmit(onSubmit)}>
								<VStack align="stretch" spacing={6}>
									<Text fontSize="sm" color="gray.500">
										{t("settings.telegram.description")}
									</Text>
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t("settings.telegram.enableBot")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t("settings.telegram.enableBotDescription")}
											</Text>
										</Box>
										<Controller
											control={control}
											name="use_telegram"
											render={({ field }) => (
												<Switch
													isChecked={field.value}
													onChange={(event) =>
														field.onChange(event.target.checked)
													}
												/>
											)}
										/>
									</Flex>
									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box borderWidth="1px" borderRadius="lg" p={4}>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.apiToken")}
													</FormLabel>
													<Input
														placeholder="123456:ABC"
														{...register("api_token")}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.proxyUrl")}
													</FormLabel>
													<Input
														placeholder="socks5://user:pass@host:port"
														{...register("proxy_url")}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.adminChatIds")}
													</FormLabel>
													<Input
														placeholder="12345, 67890"
														{...register("admin_chat_ids")}
													/>
													<FormHelperText>
														{t("settings.telegram.adminChatIdsHint")}
													</FormHelperText>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.logsChatId")}
													</FormLabel>
													<Input
														placeholder="-100123456789"
														{...register("logs_chat_id")}
													/>
													<FormHelperText>
														{t("settings.telegram.logsChatIdHint")}
													</FormHelperText>
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel htmlFor="logs_chat_is_forum" mb="0">
														{t("settings.telegram.logsChatIsForum")}
													</FormLabel>
													<Controller
														control={control}
														name="logs_chat_is_forum"
														render={({ field }) => (
															<Switch
																id="logs_chat_is_forum"
																isChecked={field.value}
																onChange={field.onChange}
															/>
														)}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.defaultVlessFlow")}
													</FormLabel>
													<Input
														placeholder="xtls-rprx-vision"
														{...register("default_vless_flow")}
													/>
												</FormControl>
											</SimpleGrid>
										</Box>
									</DisabledCard>

									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box>
											<Heading size="sm" mb={4}>
												{t("settings.telegram.forumTopics")}
											</Heading>
											{forumTopics && Object.keys(forumTopics).length > 0 ? (
												<Stack spacing={4}>
													{Object.entries(forumTopics).map(([key]) => (
														<Box
															key={key}
															borderWidth="1px"
															borderRadius="lg"
															p={4}
														>
															<Text fontWeight="medium" mb={3}>
																{t("settings.telegram.topicKey")}: {key}
															</Text>
															<SimpleGrid
																columns={{ base: 1, md: 2 }}
																spacing={4}
															>
																<FormControl>
																	<FormLabel>
																		{t("settings.telegram.topicTitle")}
																	</FormLabel>
																	<Input
																		{...register(
																			`forum_topics.${key}.title` as const,
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.telegram.topicId")}
																	</FormLabel>
																	<Input
																		type="number"
																		{...register(
																			`forum_topics.${key}.topic_id` as const,
																		)}
																	/>
																	<FormHelperText>
																		{t("settings.telegram.topicIdHint")}
																	</FormHelperText>
																</FormControl>
															</SimpleGrid>
														</Box>
													))}
												</Stack>
											) : (
												<Text color="gray.500">
													{t("settings.telegram.emptyTopics")}
												</Text>
											)}
										</Box>
									</DisabledCard>

									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box>
											<Heading size="sm" mb={2}>
												{t("settings.telegram.notificationsTitle")}
											</Heading>
											<Text fontSize="sm" color="gray.500" mb={4}>
												{t("settings.telegram.notificationsDescription")}
											</Text>
											<Stack spacing={4}>
												{EVENT_TOGGLE_GROUPS.map((group) => (
													<Box
														key={group.key}
														borderWidth="1px"
														borderRadius="lg"
														p={4}
													>
														<Text fontWeight="semibold" mb={3}>
															{t(group.titleKey)}
														</Text>
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={4}
														>
															{group.events.map((event) => (
																<FormControl
																	key={event.key}
																	display="flex"
																	alignItems="center"
																	justifyContent="space-between"
																	gap={4}
																>
																	<Box flex="1">
																		<Text fontWeight="medium">
																			{t(event.labelKey)}
																		</Text>
																		<Text fontSize="sm" color="gray.500">
																			{t(event.hintKey)}
																		</Text>
																	</Box>
																	<Controller
																		control={control}
																		name={
																			`event_toggles.${encodeToggleKey(event.key)}` as const
																		}
																		render={({ field }) => (
																			<Switch
																				isChecked={Boolean(field.value)}
																				onChange={(e) =>
																					field.onChange(e.target.checked)
																				}
																			/>
																		)}
																	/>
																</FormControl>
															))}
														</SimpleGrid>
													</Box>
												))}
											</Stack>
										</Box>
									</DisabledCard>

									<Flex gap={3} justify="flex-end">
										<Button
											variant="outline"
											leftIcon={<RefreshIcon />}
											onClick={() => refetch()}
											isDisabled={mutation.isLoading}
										>
											{t("actions.refresh")}
										</Button>
										<Button
											colorScheme="primary"
											leftIcon={<SaveIcon />}
											type="submit"
											isLoading={mutation.isLoading}
											isDisabled={!isDirty && !mutation.isLoading}
										>
											{t("settings.save")}
										</Button>
									</Flex>
								</VStack>
							</form>
						)}
					</TabPanel>
					<TabPanel px={{ base: 0, md: 2 }}>
						{isSubscriptionLoading && !subscriptionBundle ? (
							<Flex align="center" justify="center" py={12}>
								<Spinner size="lg" />
							</Flex>
						) : (
							<form
								onSubmit={handleSubscriptionSubmit(
									onSubmitSubscriptionSettings,
								)}
							>
								<VStack align="stretch" spacing={6}>
									<Text fontSize="sm" color="gray.500">
										{t(
											"settings.subscriptions.description",
											"Control subscription links, templates, and certificates.",
										)}
									</Text>
									<Box borderWidth="1px" borderRadius="lg" p={4}>
										<Heading size="sm" mb={1}>
											{t(
												"settings.subscriptions.globalTitle",
												"Global subscription settings",
											)}
										</Heading>
										<Text fontSize="sm" color="gray.500" mb={4}>
											{t(
												"settings.subscriptions.globalDescription",
												"Defaults applied to every admin unless overridden.",
											)}
										</Text>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.urlPrefix",
														"Subscription URL prefix",
													)}
												</FormLabel>
												<Input
													placeholder="https://sub.example.com"
													{...subscriptionRegister("subscription_url_prefix")}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.urlPrefixHint",
														"Base domain for generated links. Keep empty for relative URLs.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.customTemplatesDir",
														"Custom templates directory",
													)}
												</FormLabel>
												<Input
													placeholder="/var/lib/rebecca/templates"
													{...subscriptionRegister(
														"custom_templates_directory",
													)}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.customTemplatesDirHint",
														"Optional override for Jinja template lookup.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.profileTitle",
														"Subscription profile title",
													)}
												</FormLabel>
												<Input
													placeholder="Subscription"
													{...subscriptionRegister(
														"subscription_profile_title",
													)}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.profileTitleHint",
														"Shown in profile-title headers and subscription pages.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.supportUrl",
														"Support URL",
													)}
												</FormLabel>
												<Input
													placeholder="https://t.me/support"
													{...subscriptionRegister("subscription_support_url")}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.supportUrlHint",
														"Link used in support-url header. Leave empty to rely on admin Telegram.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.updateInterval",
														"Profile update interval (hours)",
													)}
												</FormLabel>
												<Input
													type="number"
													{...subscriptionRegister(
														"subscription_update_interval",
													)}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.updateIntervalHint",
														"Sent in profile-update-interval header.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.subscriptionPageTemplate",
														"Subscription page template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister(
															"subscription_page_template",
														)}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"subscription_page_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.homePageTemplate",
														"Home page template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister("home_page_template")}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor("home_page_template", null)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.clashTemplate",
														"Clash subscription template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister(
															"clash_subscription_template",
														)}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"clash_subscription_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.clashSettingsTemplate",
														"Clash settings template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister("clash_settings_template")}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"clash_settings_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.v2rayTemplate",
														"V2Ray subscription template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister(
															"v2ray_subscription_template",
														)}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"v2ray_subscription_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.v2raySettingsTemplate",
														"V2Ray settings template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister("v2ray_settings_template")}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"v2ray_settings_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.singboxTemplate",
														"Sing-box subscription template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister(
															"singbox_subscription_template",
														)}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"singbox_subscription_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.singboxSettingsTemplate",
														"Sing-box settings template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister(
															"singbox_settings_template",
														)}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor(
																"singbox_settings_template",
																null,
															)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.muxTemplate",
														"Mux template",
													)}
												</FormLabel>
												<HStack spacing={2} align="stretch">
													<Input
														flex="1"
														{...subscriptionRegister("mux_template")}
													/>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															openTemplateEditor("mux_template", null)
														}
													>
														{t("settings.subscriptions.editTemplate", "Edit")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl isReadOnly>
												<FormLabel>
													{t(
														"settings.subscriptions.subscriptionPath",
														"Subscription path",
													)}
												</FormLabel>
												<Input
													value={
														subscriptionBundle?.settings.subscription_path ||
														"sub"
													}
													readOnly
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.subscriptionPathHint",
														"Path follows the backend route and is shown for reference.",
													)}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.subscriptionAliases",
														"Subscription alias URLs",
													)}
												</FormLabel>
												<Textarea
													placeholder="/mypath/{identifier}\n/test/{token}\n/api/v1/client/subscribe?token={identifier}"
													rows={4}
													{...subscriptionRegister("subscription_aliases_text")}
												/>
												<FormHelperText>
													One alias per line. Supports path or query templates with {"{identifier}"}, {"{token}"}, {"{key}"}.
												</FormHelperText>
											</FormControl>
										</SimpleGrid>
										<Divider my={4} />
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_default"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t(
																	"settings.subscriptions.customJsonDefault",
																	"Use JSON by default",
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonDefaultHint",
																	"Serve JSON config when clients support it.",
																)}
															</Text>
														</Box>
														<Switch
															isChecked={field.value}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													</FormControl>
												)}
											/>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_for_v2rayn"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t(
																	"settings.subscriptions.customJsonV2rayn",
																	"Custom JSON for v2rayN",
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonV2raynHint",
																	"Force JSON for v2rayN clients.",
																)}
															</Text>
														</Box>
														<Switch
															isChecked={field.value}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													</FormControl>
												)}
											/>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_for_v2rayng"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t(
																	"settings.subscriptions.customJsonV2rayng",
																	"Custom JSON for v2rayNG",
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonV2rayngHint",
																	"Return JSON configs to v2rayNG.",
																)}
															</Text>
														</Box>
														<Switch
															isChecked={field.value}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													</FormControl>
												)}
											/>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_for_streisand"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t(
																	"settings.subscriptions.customJsonStreisand",
																	"Custom JSON for Streisand",
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonStreisandHint",
																	"Prefer JSON when Streisand is detected.",
																)}
															</Text>
														</Box>
														<Switch
															isChecked={field.value}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													</FormControl>
												)}
											/>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_for_happ"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t(
																	"settings.subscriptions.customJsonHapp",
																	"Custom JSON for Happ",
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonHappHint",
																	"Send JSON configs to Happ clients.",
																)}
															</Text>
														</Box>
														<Switch
															isChecked={field.value}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													</FormControl>
												)}
											/>
										</SimpleGrid>
									</Box>
									<Box borderWidth="1px" borderRadius="lg" p={4}>
										<Heading size="sm" mb={1}>
											{t(
												"settings.subscriptions.adminsTitle",
												"Admin-specific overrides",
											)}
										</Heading>
										<Text fontSize="sm" color="gray.500" mb={4}>
											{t(
												"settings.subscriptions.adminsDescription",
												"Assign dedicated domains, Telegram IDs, and templates to each admin.",
											)}
										</Text>
										{Object.values(adminOverrides).length === 0 ? (
											<Text color="gray.500">
												{t(
													"settings.subscriptions.noAdmins",
													"No admins available.",
												)}
											</Text>
										) : (
											<Stack spacing={4}>
												<FormControl maxW={{ base: "full", md: "320px" }}>
													<FormLabel>
														{t(
															"settings.subscriptions.selectAdmin",
															"Choose admin",
														)}
													</FormLabel>
													<Menu>
														<MenuButton
															as={Button}
															variant="outline"
															rightIcon={<ChevronDownIcon />}
															w="full"
															justifyContent="space-between"
														>
															{selectedAdminId &&
															adminOverrides[selectedAdminId]
																? adminOverrides[selectedAdminId].username
																: t(
																		"settings.subscriptions.selectAdminPlaceholder",
																		"Select an admin to edit overrides",
																	)}
														</MenuButton>
														<MenuList
															minW="320px"
															maxH="320px"
															overflowY="auto"
														>
															<Box
																p={3}
																borderBottom="1px solid"
																borderColor="gray.200"
															>
																<InputGroup size="sm">
																	<InputLeftElement pointerEvents="none">
																		<SearchIcon color="gray.400" />
																	</InputLeftElement>
																	<Input
																		placeholder={t(
																			"settings.subscriptions.searchAdmin",
																			"Search admin by name or domain",
																		)}
																		value={adminSearchTerm}
																		onChange={(event) =>
																			setAdminSearchTerm(event.target.value)
																		}
																	/>
																</InputGroup>
															</Box>
															{filteredAdmins.length === 0 ? (
																<Box px={3} py={2}>
																	<Text color="gray.500">
																		{t(
																			"settings.subscriptions.noResults",
																			"No matches",
																		)}
																	</Text>
																</Box>
															) : (
																filteredAdmins.map((admin) => (
																	<MenuItem
																		key={admin.id}
																		onClick={() => setSelectedAdminId(admin.id)}
																	>
																		<Flex
																			justify="space-between"
																			align="center"
																			w="full"
																		>
																			<Text>{admin.username}</Text>
																			{admin.subscription_domain ? (
																				<Text
																					fontSize="xs"
																					color="gray.500"
																					maxW="160px"
																					isTruncated
																				>
																					{admin.subscription_domain}
																				</Text>
																			) : null}
																		</Flex>
																	</MenuItem>
																))
															)}
														</MenuList>
													</Menu>
													<FormHelperText>
														{t(
															"settings.subscriptions.inheritHint",
															"Leave fields empty to inherit panel defaults.",
														)}
													</FormHelperText>
												</FormControl>
												{selectedAdminId == null ||
												!adminOverrides[selectedAdminId] ? (
													<Text color="gray.500">
														{t(
															"settings.subscriptions.selectAdminPlaceholder",
															"Select an admin to edit overrides",
														)}
													</Text>
												) : (
													<Box
														key={selectedAdminId}
														borderWidth="1px"
														borderRadius="md"
														p={4}
														bg="gray.50"
														_dark={{ bg: "gray.800" }}
													>
														{(() => {
															const admin = adminOverrides[selectedAdminId];
															if (!admin) return null;
															const settings =
																admin.subscription_settings || {};
															return (
																<>
																	<Flex
																		justify="space-between"
																		align={{ base: "flex-start", md: "center" }}
																		gap={3}
																		flexDirection={{
																			base: "column",
																			md: "row",
																		}}
																	>
																		<Box>
																			<Text fontWeight="semibold">
																				{admin.username}
																			</Text>
																			<Text fontSize="sm" color="gray.500">
																				{t(
																					"settings.subscriptions.adminHint",
																					"Overrides only apply to this admin's links.",
																				)}
																			</Text>
																		</Box>
																		<HStack spacing={2}>
																			{admin.subscription_domain ? (
																				<Badge colorScheme="blue">
																					{admin.subscription_domain}
																				</Badge>
																			) : null}
																			<Button
																				size="sm"
																				variant="ghost"
																				onClick={() =>
																					handleAdminReset(admin.id)
																				}
																				isDisabled={savingAdminId === admin.id}
																			>
																				{t("actions.reset", "Reset")}
																			</Button>
																		</HStack>
																	</Flex>
																	<SimpleGrid
																		columns={{ base: 1, md: 3 }}
																		spacing={4}
																		mt={3}
																	>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.adminDomain",
																					"Custom domain",
																				)}
																			</FormLabel>
																			<Input
																				placeholder="sub.admin.example.com"
																				value={admin.subscription_domain ?? ""}
																				onChange={(event) =>
																					handleAdminFieldChange(
																						admin.id,
																						"subscription_domain",
																						event.target.value,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.customTemplatesDir",
																					"Custom templates directory",
																				)}
																			</FormLabel>
																			<Input
																				placeholder={
																					subscriptionBundle?.settings
																						.custom_templates_directory || ""
																				}
																				value={
																					settings.custom_templates_directory ??
																					""
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"custom_templates_directory",
																						event.target.value,
																					)
																				}
																			/>
																			<FormHelperText>
																				{t(
																					"settings.subscriptions.inheritHint",
																					"Leave empty to inherit panel default.",
																				)}
																			</FormHelperText>
																		</FormControl>
																	</SimpleGrid>

																	<SimpleGrid
																		columns={{ base: 1, md: 3 }}
																		spacing={4}
																		mt={4}
																	>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.profileTitle",
																					"Subscription profile title",
																				)}
																			</FormLabel>
																			<Input
																				placeholder={
																					subscriptionBundle?.settings
																						.subscription_profile_title || ""
																				}
																				value={
																					settings.subscription_profile_title ??
																					""
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"subscription_profile_title",
																						event.target.value,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.supportUrl",
																					"Support URL",
																				)}
																			</FormLabel>
																			<Input
																				placeholder={
																					subscriptionBundle?.settings
																						.subscription_support_url || ""
																				}
																				value={
																					settings.subscription_support_url ??
																					""
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"subscription_support_url",
																						event.target.value,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.updateInterval",
																					"Profile update interval (hours)",
																				)}
																			</FormLabel>
																			<Input
																				type="number"
																				placeholder={
																					subscriptionBundle?.settings
																						.subscription_update_interval || ""
																				}
																				value={
																					settings.subscription_update_interval ??
																					""
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"subscription_update_interval",
																						event.target.value,
																					)
																				}
																			/>
																		</FormControl>
																	</SimpleGrid>

																	<SimpleGrid
																		columns={{ base: 1, md: 2 }}
																		spacing={4}
																		mt={4}
																	>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.subscriptionPageTemplate",
																					"Subscription page template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.subscription_page_template || ""
																					}
																					value={
																						settings.subscription_page_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"subscription_page_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"subscription_page_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.homePageTemplate",
																					"Home page template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.home_page_template || ""
																					}
																					value={
																						settings.home_page_template ?? ""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"home_page_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"home_page_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.clashTemplate",
																					"Clash subscription template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.clash_subscription_template || ""
																					}
																					value={
																						settings.clash_subscription_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"clash_subscription_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"clash_subscription_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.clashSettingsTemplate",
																					"Clash settings template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.clash_settings_template || ""
																					}
																					value={
																						settings.clash_settings_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"clash_settings_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"clash_settings_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.v2rayTemplate",
																					"V2Ray subscription template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.v2ray_subscription_template || ""
																					}
																					value={
																						settings.v2ray_subscription_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"v2ray_subscription_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"v2ray_subscription_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.v2raySettingsTemplate",
																					"V2Ray settings template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.v2ray_settings_template || ""
																					}
																					value={
																						settings.v2ray_settings_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"v2ray_settings_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"v2ray_settings_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.singboxTemplate",
																					"Sing-box subscription template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.singbox_subscription_template ||
																						""
																					}
																					value={
																						settings.singbox_subscription_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"singbox_subscription_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"singbox_subscription_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.singboxSettingsTemplate",
																					"Sing-box settings template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.singbox_settings_template || ""
																					}
																					value={
																						settings.singbox_settings_template ??
																						""
																					}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"singbox_settings_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"singbox_settings_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.muxTemplate",
																					"Mux template",
																				)}
																			</FormLabel>
																			<HStack spacing={2} align="stretch">
																				<Input
																					flex="1"
																					placeholder={
																						subscriptionBundle?.settings
																							.mux_template || ""
																					}
																					value={settings.mux_template ?? ""}
																					onChange={(event) =>
																						handleAdminTemplateChange(
																							admin.id,
																							"mux_template",
																							event.target.value,
																						)
																					}
																				/>
																				<Button
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						openTemplateEditor(
																							"mux_template",
																							admin.id,
																						)
																					}
																				>
																					{t(
																						"settings.subscriptions.editTemplate",
																						"Edit",
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																	</SimpleGrid>

																	<Divider my={4} />

																	<SimpleGrid
																		columns={{ base: 1, md: 2 }}
																		spacing={4}
																	>
																		<FormControl
																			display="flex"
																			alignItems="center"
																		>
																			<Box flex="1">
																				<Text fontWeight="medium">
																					{t(
																						"settings.subscriptions.customJsonDefault",
																						"Use JSON by default",
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonDefaultHint",
																						"Serve JSON config when clients support it.",
																					)}
																				</Text>
																			</Box>
																			<Switch
																				isChecked={
																					settings.use_custom_json_default ??
																					subscriptionBundle?.settings
																						.use_custom_json_default ??
																					false
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"use_custom_json_default",
																						event.target.checked,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl
																			display="flex"
																			alignItems="center"
																		>
																			<Box flex="1">
																				<Text fontWeight="medium">
																					{t(
																						"settings.subscriptions.customJsonV2rayn",
																						"Custom JSON for v2rayN",
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonV2raynHint",
																						"Force JSON for v2rayN clients.",
																					)}
																				</Text>
																			</Box>
																			<Switch
																				isChecked={
																					settings.use_custom_json_for_v2rayn ??
																					subscriptionBundle?.settings
																						.use_custom_json_for_v2rayn ??
																					false
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"use_custom_json_for_v2rayn",
																						event.target.checked,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl
																			display="flex"
																			alignItems="center"
																		>
																			<Box flex="1">
																				<Text fontWeight="medium">
																					{t(
																						"settings.subscriptions.customJsonV2rayng",
																						"Custom JSON for v2rayNG",
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonV2rayngHint",
																						"Return JSON configs to v2rayNG.",
																					)}
																				</Text>
																			</Box>
																			<Switch
																				isChecked={
																					settings.use_custom_json_for_v2rayng ??
																					subscriptionBundle?.settings
																						.use_custom_json_for_v2rayng ??
																					false
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"use_custom_json_for_v2rayng",
																						event.target.checked,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl
																			display="flex"
																			alignItems="center"
																		>
																			<Box flex="1">
																				<Text fontWeight="medium">
																					{t(
																						"settings.subscriptions.customJsonStreisand",
																						"Custom JSON for Streisand",
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonStreisandHint",
																						"Prefer JSON when Streisand is detected.",
																					)}
																				</Text>
																			</Box>
																			<Switch
																				isChecked={
																					settings.use_custom_json_for_streisand ??
																					subscriptionBundle?.settings
																						.use_custom_json_for_streisand ??
																					false
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"use_custom_json_for_streisand",
																						event.target.checked,
																					)
																				}
																			/>
																		</FormControl>
																		<FormControl
																			display="flex"
																			alignItems="center"
																		>
																			<Box flex="1">
																				<Text fontWeight="medium">
																					{t(
																						"settings.subscriptions.customJsonHapp",
																						"Custom JSON for Happ",
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonHappHint",
																						"Send JSON configs to Happ clients.",
																					)}
																				</Text>
																			</Box>
																			<Switch
																				isChecked={
																					settings.use_custom_json_for_happ ??
																					subscriptionBundle?.settings
																						.use_custom_json_for_happ ??
																					false
																				}
																				onChange={(event) =>
																					handleAdminTemplateChange(
																						admin.id,
																						"use_custom_json_for_happ",
																						event.target.checked,
																					)
																				}
																			/>
																		</FormControl>
																	</SimpleGrid>

																	<Flex gap={3} justify="flex-end" mt={4}>
																		<Button
																			variant="outline"
																			leftIcon={<RefreshIcon />}
																			onClick={() => handleAdminReset(admin.id)}
																			isDisabled={savingAdminId === admin.id}
																		>
																			{t(
																				"settings.subscriptions.resetOverrides",
																				"Use panel defaults",
																			)}
																		</Button>
																		<Button
																			colorScheme="primary"
																			leftIcon={<SaveIcon />}
																			onClick={() => handleAdminSave(admin.id)}
																			isLoading={savingAdminId === admin.id}
																		>
																			{t(
																				"settings.subscriptions.saveAdmin",
																				"Save overrides",
																			)}
																		</Button>
																	</Flex>
																</>
															);
														})()}
													</Box>
												)}
											</Stack>
										)}
									</Box>
									\t\t\t\t\t\t\t\t
									<Box borderWidth="1px" borderRadius="lg" p={4}>
										<Heading size="sm" mb={1}>
											{t(
												"settings.subscriptions.certificateTitle",
												"Certificates",
											)}
										</Heading>
										<Text fontSize="sm" color="gray.500" mb={4}>
											{t(
												"settings.subscriptions.certificateDescription",
												"Issue or renew SSL certificates and keep domains in sync with the panel.",
											)}
										</Text>
										<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.email", "Email")}
												</FormLabel>
												<Input
													type="email"
													placeholder="admin@example.com"
													value={certificateForm.email}
													onChange={(event) =>
														setCertificateForm((prev) => ({
															...prev,
															email: event.target.value,
														}))
													}
												/>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.domains", "Domains")}
												</FormLabel>
												<Textarea
													placeholder={t(
														"settings.subscriptions.domainsPlaceholder",
														"example.com, www.example.com",
													)}
													value={certificateForm.domains}
													onChange={(event) =>
														setCertificateForm((prev) => ({
															...prev,
															domains: event.target.value,
														}))
													}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.domainsHint",
														"Separate multiple domains with comma or space.",
													)}
												</FormHelperText>
											</FormControl>
										</SimpleGrid>
										<Flex justify="flex-end" mt={3}>
											<Button
												colorScheme="primary"
												leftIcon={<SaveIcon />}
												onClick={handleIssueCertificate}
												isLoading={issueCertificateMutation.isLoading}
											>
												{t(
													"settings.subscriptions.issueAction",
													"Issue certificate",
												)}
											</Button>
										</Flex>
										<Divider my={4} />
										<Heading size="sm" mb={2}>
											{t(
												"settings.subscriptions.certificateList",
												"Saved domains",
											)}
										</Heading>
										{!subscriptionBundle?.certificates?.length ? (
											<Text color="gray.500">
												{t(
													"settings.subscriptions.noCertificates",
													"No certificates recorded yet.",
												)}
											</Text>
										) : (
											<Stack spacing={3}>
												{subscriptionBundle.certificates.map((cert) => (
													<Box
														key={cert.domain}
														borderWidth="1px"
														borderRadius="md"
														p={3}
													>
														<Flex
															justify="space-between"
															align={{ base: "flex-start", md: "center" }}
															gap={3}
															flexDirection={{ base: "column", md: "row" }}
														>
															<Box>
																<Text fontWeight="semibold">{cert.domain}</Text>
																<Text fontSize="sm" color="gray.500">
																	{t(
																		"settings.subscriptions.pathLabel",
																		"Path",
																	)}
																	: {cert.path}
																</Text>
																<Text fontSize="sm" color="gray.500">
																	{t(
																		"settings.subscriptions.lastIssued",
																		"Issued",
																	)}
																	:{" "}
																	{cert.last_issued_at
																		? new Date(
																				cert.last_issued_at,
																			).toLocaleString()
																		: t(
																				"settings.subscriptions.never",
																				"Never",
																			)}
																</Text>
																<Text fontSize="sm" color="gray.500">
																	{t(
																		"settings.subscriptions.lastRenewed",
																		"Renewed",
																	)}
																	:{" "}
																	{cert.last_renewed_at
																		? new Date(
																				cert.last_renewed_at,
																			).toLocaleString()
																		: t(
																				"settings.subscriptions.never",
																				"Never",
																			)}
																</Text>
															</Box>
															<HStack>
																{cert.email ? (
																	<Badge colorScheme="purple">
																		{cert.email}
																	</Badge>
																) : null}
																<Button
																	size="sm"
																	variant="outline"
																	leftIcon={
																		<ArrowPathIcon width={16} height={16} />
																	}
																	onClick={() =>
																		handleRenewCertificate(cert.domain)
																	}
																	isLoading={
																		renewCertificateMutation.isLoading &&
																		renewingDomain === cert.domain
																	}
																>
																	{t(
																		"settings.subscriptions.renewAction",
																		"Renew",
																	)}
																</Button>
															</HStack>
														</Flex>
													</Box>
												))}
											</Stack>
										)}
									</Box>
									<Flex gap={3} justify="flex-end">
										<Button
											variant="outline"
											leftIcon={<RefreshIcon />}
											onClick={() => refetchSubscriptionSettings()}
											isDisabled={subscriptionSettingsMutation.isLoading}
										>
											{t("actions.refresh")}
										</Button>
										<Button
											colorScheme="primary"
											leftIcon={<SaveIcon />}
											type="submit"
											isLoading={subscriptionSettingsMutation.isLoading}
											isDisabled={
												!isSubscriptionDirty &&
												!subscriptionSettingsMutation.isLoading
											}
										>
											{t("settings.save")}
										</Button>
									</Flex>
								</VStack>
							</form>
						)}
					</TabPanel>
				</TabPanels>
			</Tabs>
			<Modal
				isOpen={Boolean(templateDialog)}
				onClose={closeTemplateEditor}
				size="6xl"
				scrollBehavior="inside"
			>
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>
						{templateDialog
							? t("settings.subscriptions.editTemplate", "Edit template")
							: ""}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						{templateLoading ? (
							<Flex align="center" justify="center" minH="200px">
								<Spinner />
							</Flex>
						) : (
							<VStack align="stretch" spacing={3}>
								{templateDialog?.adminId ? (
									<Text fontWeight="medium">
										{t(
											"settings.subscriptions.adminTemplateFor",
											"Admin-specific template",
										)}
										:{" "}
										{adminOverrides[templateDialog.adminId]?.username ||
											t("settings.subscriptions.admin", "Admin")}
									</Text>
								) : (
									<Text fontWeight="medium">
										{t(
											"settings.subscriptions.globalTemplate",
											"Panel default template",
										)}
									</Text>
								)}
								<Text fontSize="sm" color="gray.500">
									{t("settings.subscriptions.templatePath", "Using template")}:{" "}
									{templateMeta?.template_name ||
										templateDialog?.templateKey ||
										""}
									{templateMeta?.custom_directory
										? ` (${templateMeta.custom_directory})`
										: ""}
								</Text>
								{templateMeta?.resolved_path ? (
									<Text fontSize="xs" color="gray.500">
										{t("settings.subscriptions.resolvedPath", "Resolved path")}:{" "}
										{templateMeta.resolved_path}
									</Text>
								) : null}
								<Box h="420px">
									{templateIsJson ? (
										<JsonEditor
											json={templateContent}
											onChange={(value) => setTemplateContent(value || "")}
										/>
									) : (
										<Textarea
											value={templateContent}
											onChange={(event) =>
												setTemplateContent(event.target.value)
											}
											h="400px"
											fontFamily="mono"
										/>
									)}
								</Box>
							</VStack>
						)}
					</ModalBody>
					<ModalFooter>
						<Button mr={3} onClick={closeTemplateEditor} variant="ghost">
							{t("actions.close", "Close")}
						</Button>
						<Button
							colorScheme="primary"
							onClick={handleTemplateSave}
							isLoading={
								templateContentMutation.isLoading || templateLoading || false
							}
							isDisabled={!templateDialog || templateLoading}
						>
							{t("settings.save", "Save")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</Box>
	);
};
