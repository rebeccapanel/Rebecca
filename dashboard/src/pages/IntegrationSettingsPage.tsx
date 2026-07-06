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
	InputGroup,
	InputLeftElement,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalCloseButton,
	ModalOverlay,
	Progress,
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Text,
	Textarea,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	ArrowPathIcon,
	ArrowsRightLeftIcon,
	ArrowUpTrayIcon,
	ChevronDownIcon as HeroChevronDownIcon,
	MagnifyingGlassIcon,
	PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { NumericInput } from "components/common/NumericInput";
import { PanelInput as Input } from "components/common/PanelInput";
import useGetUser from "hooks/useGetUser";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router-dom";
import { fetch as apiFetch } from "service/http";
import {
	type AdminSubscriptionSettings,
	disablePHPMyAdmin,
	enablePHPMyAdmin,
	getPanelSettings,
	getPHPMyAdminStatus,
	getRuntimeSettings,
	getSubscriptionSettings,
	getSubscriptionTemplateContent,
	getTelegramSettings,
	issueSubscriptionCertificate,
	type PanelSettingsResponse,
	renewSubscriptionCertificate,
	type RuntimeSettingsResponse,
	sendTelegramBackup,
	testTelegramSettings,
	type SubscriptionSettingsBundle,
	type SubscriptionTemplateContentResponse,
	type SubscriptionTemplateSettings,
	type SubscriptionTemplateSettingsUpdatePayload,
	type TelegramSettingsResponse,
	type TelegramSettingsUpdatePayload,
	updateAdminSubscriptionSettings,
	updatePanelSettings,
	updateRuntimeSettings,
	updateSubscriptionSettings,
	updateSubscriptionTemplateContent,
	updateTelegramSettings,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { ConfirmActionDialog } from "../components/ConfirmActionDialog";
import { JsonEditor } from "../components/JsonEditor";
import { RebeccaBackupPanel } from "../components/RebeccaBackupPanel";
import { SubscriptionTemplateCreator } from "../components/SubscriptionTemplateCreator";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "../components/xray/XrayDialog";
import { PageHeader, ResourceListCard, TabSystem } from "../components/ui";

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

type TelegramSwitchRowProps = {
	title: ReactNode;
	description?: ReactNode;
	control: ReactNode;
};

const TelegramSwitchRow = ({
	title,
	description,
	control,
}: TelegramSwitchRowProps) => (
	<FormControl className="telegram-switch-row">
		<Flex
			align="center"
			justify="space-between"
			gap={{ base: 2, md: 3 }}
			className="telegram-switch-row__inner"
		>
			<Box minW={0} flex="1">
				<Text className="telegram-switch-row__title">{title}</Text>
				{description ? (
					<Text className="telegram-switch-row__description">
						{description}
					</Text>
				) : null}
			</Box>
			<Box flexShrink={0} className="telegram-switch-row__control">
				{control}
			</Box>
		</Flex>
	</FormControl>
);

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

type UpdateStatus = {
	current?: string | null;
	channel?: string;
	available?: boolean;
	target?: string | null;
	latest_release?: { tag?: string | null } | null;
	latest_dev?: { tag?: string | null } | null;
	error?: string | null;
};

type MaintenanceInfo = {
	panel?: {
		image?: string;
		tag?: string;
		mode?: string;
		install_mode?: string;
		channel?: string;
		update?: UpdateStatus;
	} | null;
	node?: { image?: string; tag?: string } | null;
	node_update?: UpdateStatus | null;
};

type MaintenanceAction = "update" | "restart" | "soft-reload";
type UpdateChannel = "current" | "latest" | "dev";

type MaintenanceOperation = {
	id?: string;
	action?: MaintenanceAction | string;
	phase?: string;
	message?: string;
	progress?: number | null;
	running?: boolean;
	restarting?: boolean;
	needs_reload?: boolean;
	error?: string;
	logs?: string[];
	started_at?: number;
	updated_at?: number;
	finished_at?: number | null;
};

type MaintenanceActionResponse = {
	status?: string;
	message?: string;
	operation?: MaintenanceOperation;
};

const defaultRuntimeSettings: RuntimeSettingsResponse = {
	dashboard_path: "/dashboard/",
	record_node_usage: true,
	record_node_user_usages: true,
	subscription_read_only: false,
	api_docs_enabled: false,
	phpmyadmin_enabled: false,
	phpmyadmin_port: 8080,
	phpmyadmin_path: "/phpmyadmin/",
	phpmyadmin_public_url: "",
};

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
	backup_chat_id: string;
	backup_chat_is_forum: boolean;
	default_vless_flow: string;
	forum_topics: Record<string, TopicFormValue>;
	event_toggles: Record<string, boolean>;
	backup_enabled: boolean;
	backup_scope: "database" | "full";
	backup_interval_value: number;
	backup_interval_unit: "minutes" | "hours" | "days";
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
		backup_chat_id:
			settings.backup_chat_id != null ? String(settings.backup_chat_id) : "",
		backup_chat_is_forum: settings.backup_chat_is_forum,
		default_vless_flow: settings.default_vless_flow ?? "",
		forum_topics: topics,
		event_toggles: toggles,
		backup_enabled: settings.backup_enabled ?? false,
		backup_scope: settings.backup_scope ?? "database",
		backup_interval_value: Math.max(
			Number(settings.backup_interval_value ?? 24),
			1,
		),
		backup_interval_unit: settings.backup_interval_unit ?? "hours",
	};
};

type SubscriptionFormValues = SubscriptionTemplateSettings & {
	subscription_aliases_text: string;
	subscription_ports_text: string;
};

const parseSubscriptionPortsInput = (raw: string): number[] => {
	const normalized = (raw || "").replace(/[،؛]/g, ",");
	const tokens = normalized
		.split(/[,\s]+/)
		.map((token) => token.trim())
		.filter(Boolean);
	const ports: number[] = [];
	tokens.forEach((token) => {
		const port = Number(token);
		if (
			Number.isFinite(port) &&
			port > 0 &&
			port <= 65535 &&
			!ports.includes(port)
		) {
			ports.push(port);
		}
	});
	return ports;
};

const formatSubscriptionPorts = (ports: number[]): string => ports.join(", ");

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
	subscription_ports: settings?.subscription_ports ?? [],
	subscription_aliases_text: (settings?.subscription_aliases ?? []).join("\n"),
	subscription_ports_text: formatSubscriptionPorts(
		settings?.subscription_ports ?? [],
	),
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

const ansiEscapePattern =
	/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const cleanTerminalOutput = (logs?: string[]) => {
	const output = (logs || []).join("\n");
	return output
		.replace(ansiEscapePattern, "")
		.replace(/\r(?!\n)/g, "\n")
		.replace(/\u0008/g, "")
		.trimEnd();
};

export const IntegrationSettingsPage = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const cardBg = useColorModeValue("white", "whiteAlpha.50");
	const subCardBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const fieldBg = useColorModeValue("white", "blackAlpha.200");
	const maintenanceOutputBg = useColorModeValue("gray.50", "blackAlpha.400");
	const maintenanceOutputBorder = useColorModeValue(
		"gray.200",
		"whiteAlpha.200",
	);
	const comingSoonOverlayBg = useColorModeValue(
		"rgba(255, 255, 255, 0.78)",
		"rgba(8, 11, 18, 0.76)",
	);
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
		data: runtimeSettings,
		isLoading: isRuntimeSettingsLoading,
		refetch: refetchRuntimeSettings,
	} = useQuery<RuntimeSettingsResponse>(
		"runtime-settings",
		getRuntimeSettings,
		{
			refetchOnWindowFocus: false,
			enabled: canManageIntegrations,
		},
	);

	const {
		data: phpMyAdminStatus,
		isLoading: isPHPMyAdminStatusLoading,
		refetch: refetchPHPMyAdminStatus,
	} = useQuery("phpmyadmin-status", getPHPMyAdminStatus, {
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
	const panelInstallMode =
		maintenanceInfoQuery.data?.panel?.mode ||
		maintenanceInfoQuery.data?.panel?.install_mode ||
		"docker";
	const hostActionsAvailable = panelInstallMode === "binary";
	const [selectedUpdateChannel, setSelectedUpdateChannel] =
		useState<UpdateChannel>("current");
	const panelUpdateInfo = maintenanceInfoQuery.data?.panel?.update;
	const selectedUpdateTarget =
		selectedUpdateChannel === "dev"
			? panelUpdateInfo?.latest_dev?.tag
			: selectedUpdateChannel === "latest"
				? panelUpdateInfo?.latest_release?.tag
				: panelUpdateInfo?.target;

	useEffect(() => {
		const channel = maintenanceInfoQuery.data?.panel?.channel;
		if (channel === "dev" || channel === "latest") {
			setSelectedUpdateChannel(channel);
		}
	}, [maintenanceInfoQuery.data?.panel?.channel]);

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

	const [panelDefaultSubType, setPanelDefaultSubType] = useState<
		"username-key" | "key" | "token"
	>(panelData?.default_subscription_type ?? "key");
	const [runtimeSettingsForm, setRuntimeSettingsForm] =
		useState<RuntimeSettingsResponse>(defaultRuntimeSettings);

	useEffect(() => {
		if (panelData) {
			setPanelDefaultSubType(panelData.default_subscription_type ?? "key");
		}
	}, [panelData]);

	useEffect(() => {
		if (runtimeSettings) {
			setRuntimeSettingsForm(runtimeSettings);
		}
	}, [runtimeSettings]);

	const phpMyAdminSupported = phpMyAdminStatus?.supported ?? false;

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
	const [isDevUpdateConfirmOpen, setDevUpdateConfirmOpen] = useState(false);
	const [certificateForm, setCertificateForm] = useState<{
		email: string;
		domains: string;
	}>({
		email: "",
		domains: "",
	});
	const [renewingDomain, setRenewingDomain] = useState<string | null>(null);
	const [maintenanceOperation, setMaintenanceOperation] =
		useState<MaintenanceOperation | null>(null);
	const [isMaintenanceProgressOpen, setMaintenanceProgressOpen] =
		useState(false);
	const [maintenanceIsWaitingForAPI, setMaintenanceIsWaitingForAPI] =
		useState(false);
	const panelReturnPollRef = useRef<number | null>(null);
	const panelReturnSawOfflineRef = useRef(false);

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

	const clearPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) {
			window.clearInterval(panelReturnPollRef.current);
			panelReturnPollRef.current = null;
		}
	}, []);

	const startPanelReturnPolling = useCallback(() => {
		if (panelReturnPollRef.current !== null) {
			return;
		}
		const startedAt = Date.now();
		panelReturnSawOfflineRef.current = false;
		setMaintenanceIsWaitingForAPI(true);
		panelReturnPollRef.current = window.setInterval(async () => {
			try {
				await apiFetch<MaintenanceInfo>("/maintenance/info", {
					timeout: 2500,
				});
				const waitedLongEnough = Date.now() - startedAt > 7000;
				if (panelReturnSawOfflineRef.current || waitedLongEnough) {
					clearPanelReturnPolling();
					window.location.reload();
				}
			} catch {
				panelReturnSawOfflineRef.current = true;
			}
		}, 2000);
	}, [clearPanelReturnPolling]);

	useEffect(() => {
		return () => clearPanelReturnPolling();
	}, [clearPanelReturnPolling]);

	const shouldWaitForPanelReturn = (operation?: MaintenanceOperation | null) =>
		Boolean(operation?.restarting || operation?.needs_reload || operation?.phase === "restarting");

	const triggerMaintenanceAction = async (
		path:
			| "/maintenance/update"
			| "/maintenance/restart"
			| "/maintenance/soft-reload",
		body?: Record<string, unknown>,
	): Promise<{ wentOffline: boolean; operation?: MaintenanceOperation }> => {
		try {
			const result = await apiFetch<MaintenanceActionResponse>(path, {
				method: "POST",
				body,
				timeout: 3000,
			});
			return { wentOffline: false, operation: result.operation };
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
		result: { wentOffline: boolean; operation?: MaintenanceOperation },
	) => {
		setActiveMaintenanceAction(action);
		const operation = result.operation || {
			action,
			phase: result.wentOffline ? "restarting" : "queued",
			message: result.wentOffline
				? t(
						"settings.panel.maintenanceWaitingForAPI",
						"Rebecca is restarting. Waiting for the API to come back.",
					)
				: t("settings.panel.maintenanceQueued", "Command accepted."),
			restarting: result.wentOffline,
			needs_reload: result.wentOffline,
		};
		setMaintenanceOperation(operation);
		setMaintenanceProgressOpen(true);
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
		if (result.wentOffline || shouldWaitForPanelReturn(operation)) {
			startPanelReturnPolling();
		}
		window.setTimeout(() => maintenanceInfoQuery.refetch(), 6000);
	};

	const maintenanceStatusQuery = useQuery<MaintenanceOperation>(
		["maintenance-status", maintenanceOperation?.id],
		() =>
			apiFetch<MaintenanceOperation>("/maintenance/status", {
				timeout: 2500,
			}),
		{
			enabled:
				isMaintenanceProgressOpen &&
				Boolean(maintenanceOperation?.id) &&
				!maintenanceIsWaitingForAPI,
			refetchInterval: (data) => {
				if (!data?.id || data.error || data.phase === "failed") {
					return false;
				}
				if (shouldWaitForPanelReturn(data)) {
					return false;
				}
				return 1000;
			},
			retry: false,
			onSuccess: (data) => {
				if (!data?.id) {
					return;
				}
				setMaintenanceOperation(data);
				if (shouldWaitForPanelReturn(data)) {
					startPanelReturnPolling();
				}
			},
			onError: () => {
				if (maintenanceOperation?.action) {
					setMaintenanceOperation((current) => ({
						...(current || {}),
						phase: "restarting",
						message: t(
							"settings.panel.maintenanceWaitingForAPI",
							"Rebecca is restarting. Waiting for the API to come back.",
						),
						restarting: true,
						needs_reload: true,
					}));
					startPanelReturnPolling();
				}
			},
		},
	);

	const updateMutation = useMutation(
		() =>
			triggerMaintenanceAction("/maintenance/update", {
				channel: selectedUpdateChannel,
			}),
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

	const handlePanelUpdateClick = () => {
		if (selectedUpdateChannel === "dev") {
			setDevUpdateConfirmOpen(true);
			return;
		}
		updateMutation.mutate();
	};

	const confirmDevPanelUpdate = () => {
		setDevUpdateConfirmOpen(false);
		updateMutation.mutate();
	};

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
				backup_chat_id: null,
				backup_chat_is_forum: false,
				default_vless_flow: null,
				forum_topics: {},
				event_toggles: {},
				backup_enabled: false,
				backup_scope: "database",
				backup_interval_value: 24,
				backup_interval_unit: "hours",
				backup_last_sent_at: null,
				backup_last_error: null,
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
		setValue: setSubscriptionValue,
		watch: watchSubscription,
		formState: { isDirty: isSubscriptionDirty },
	} = useForm<SubscriptionFormValues>({
		defaultValues: buildSubscriptionDefaults(subscriptionBundle?.settings),
	});

	useEffect(() => {
		if (subscriptionBundle?.settings) {
			resetSubscription(buildSubscriptionDefaults(subscriptionBundle.settings));
		}
	}, [subscriptionBundle, resetSubscription]);

	const subscriptionPortsText = watchSubscription("subscription_ports_text");
	const parsedSubscriptionPorts = useMemo(
		() => parseSubscriptionPortsInput(subscriptionPortsText || ""),
		[subscriptionPortsText],
	);

	const integrationTabKeys = useMemo(
		() => [
			"panel",
			"backup",
			"telegram",
			"subscriptions",
			"template-creator",
		],
		[],
	);
	const readSettingsHash = useCallback(() => {
		const hash = (window.location.hash || "").replace(/^#/, "");
		const [tabWithQuery = ""] = hash.split("#").filter(Boolean);
		const [tab = "", query = ""] = tabWithQuery.split("?");
		return {
			tab,
			focus: query ? new URLSearchParams(query).get("focus") || "" : "",
		};
	}, []);
	const getFocusFromHash = useCallback(() => {
		return readSettingsHash();
	}, [readSettingsHash]);
	useEffect(() => {
		const syncTabFromHash = () => {
			const { tab } = readSettingsHash();
			const idx = integrationTabKeys.findIndex(
				(key) => key.toLowerCase() === tab.toLowerCase(),
			);
			if (idx >= 0) {
				setActiveIntegrationTab(idx);
			} else {
				// default tab if none present in hash
				setActiveIntegrationTab(0);
				const defaultKey = integrationTabKeys[0];
				window.history.replaceState(
					null,
					"",
					`${window.location.pathname}${window.location.search}#${defaultKey}`,
				);
			}
		};
		syncTabFromHash();
		window.addEventListener("hashchange", syncTabFromHash);
		return () => window.removeEventListener("hashchange", syncTabFromHash);
	}, [integrationTabKeys, readSettingsHash]);

	useEffect(() => {
		const { focus, tab } = getFocusFromHash();
		if (
			activeIntegrationTab !== 2 ||
			tab.toLowerCase() !== "telegram" ||
			focus !== "periodic-backup" ||
			(isLoading && !data)
		) {
			return;
		}
		const timer = window.setTimeout(() => {
			document
				.getElementById("telegram-periodic-backup")
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, 250);
		return () => window.clearTimeout(timer);
	}, [activeIntegrationTab, data, getFocusFromHash, isLoading]);

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

	const telegramBackupMutation = useMutation(sendTelegramBackup, {
		onSuccess: (result) => {
			queryClient.invalidateQueries("telegram-settings");
			toast({
				title: t(
					"settings.telegram.backupSendSuccess",
					"Backup sent to Telegram.",
				),
				description: result.filename,
				status: "success",
				duration: 4000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const telegramTestMutation = useMutation(testTelegramSettings, {
		onSuccess: (result) => {
			queryClient.invalidateQueries("telegram-settings");
			toast({
				title: t(
					"settings.telegram.testMessageSuccess",
					"Telegram test message sent.",
				),
				description: result.detail,
				status: "success",
				duration: 4000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
			queryClient.invalidateQueries("telegram-settings");
		},
	});

	const panelMutation = useMutation(updatePanelSettings, {
		onSuccess: (updated) => {
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

	const runtimeSettingsMutation = useMutation(updateRuntimeSettings, {
		onSuccess: (updated) => {
			setRuntimeSettingsForm(updated);
			queryClient.setQueryData("runtime-settings", updated);
			toast({
				title: t("settings.runtime.saved", "Settings saved."),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const phpMyAdminEnableMutation = useMutation(
		() =>
			enablePHPMyAdmin({
				port: 8080,
				path: runtimeSettingsForm.phpmyadmin_path || "/phpmyadmin/",
			}),
		{
			onSuccess: (result) => {
				setRuntimeSettingsForm((prev) => ({
					...prev,
					phpmyadmin_enabled: result.status.enabled,
					phpmyadmin_port: result.status.port,
					phpmyadmin_path: result.status.path,
					phpmyadmin_public_url: result.status.public_url,
				}));
				void refetchRuntimeSettings();
				void refetchPHPMyAdminStatus();
				generateSuccessMessage(
					t("phpmyadmin.enabled", "phpMyAdmin enabled."),
					toast,
				);
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
		},
	);

	const phpMyAdminDisableMutation = useMutation(disablePHPMyAdmin, {
		onSuccess: (result) => {
			setRuntimeSettingsForm((prev) => ({
				...prev,
				phpmyadmin_enabled: result.status.enabled,
			}));
			void refetchRuntimeSettings();
			void refetchPHPMyAdminStatus();
			generateSuccessMessage(
				t("phpmyadmin.disabled", "phpMyAdmin disabled."),
				toast,
			);
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
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
					t("settings.subscriptions.templateSaved"),
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
			backup_chat_id: values.backup_chat_id.trim()
				? Number(values.backup_chat_id.trim())
				: null,
			backup_chat_is_forum: values.backup_chat_is_forum,
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
			backup_enabled: values.backup_enabled,
			backup_scope: values.backup_scope,
			backup_interval_value: Math.max(
				Number(values.backup_interval_value || 1),
				1,
			),
			backup_interval_unit: values.backup_interval_unit,
		};
		mutation.mutate(payload);
	};

	const onSubmitSubscriptionSettings = (values: SubscriptionFormValues) => {
		const aliases = (values.subscription_aliases_text || "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const ports = parseSubscriptionPortsInput(
			values.subscription_ports_text || "",
		);
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
			subscription_path: values.subscription_path?.trim() || "sub",
			subscription_aliases: aliases,
			subscription_ports: ports,
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
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}${key ? `#${key}` : ""}`,
		);
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
				title: t("settings.subscriptions.certificateMissingInput"),
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
	const isTelegramBackupEnabled = watchTelegram("backup_enabled");
	const telegramBackupScope = watchTelegram("backup_scope");
	const telegramDisabledMessage = t("settings.telegram.disabledOverlay");
	const telegramBackupDisabledMessage = t(
		"settings.telegram.backupBinaryOnly",
		"Periodic backup delivery is available only on binary installations.",
	);

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
		<Box
			px={{ base: 4, md: 8 }}
			py={{ base: 6, md: 8 }}
			sx={{
				".master-settings-card": {
					bg: cardBg,
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					p: { base: 3, md: 4 },
					boxShadow: "none",
					overflow: "hidden",
				},
				".master-settings-subcard": {
					bg: subCardBg,
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					p: { base: 3, md: 3 },
				},
				".master-settings-action-row": {
					display: "flex",
					justifyContent: "flex-end",
					gap: 3,
					flexWrap: "wrap",
				},
				".master-settings-action-row > .chakra-button": {
					minW: { base: "calc(50% - 6px)", sm: "auto" },
				},
				".telegram-settings-form": {
					"--telegram-row-bg": subCardBg,
				},
				".telegram-switch-row__inner": {
					bg: "var(--telegram-row-bg)",
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					px: { base: 2.5, md: 3 },
					py: { base: 2.5, md: 3 },
					minH: "56px",
				},
				".telegram-switch-row__title": {
					fontSize: "sm",
					fontWeight: "700",
					color: "panel.text",
					lineHeight: "1.2",
				},
				".telegram-switch-row__description": {
					fontSize: "xs",
					color: "panel.textMuted",
					mt: 1,
					lineHeight: "1.35",
				},
				".telegram-switch-row__control": {
					display: "flex",
					alignItems: "center",
					justifyContent: "flex-end",
					minW: "44px",
				},
				".master-settings-card input, .master-settings-card select, .master-settings-card textarea, .master-settings-subcard input, .master-settings-subcard select, .master-settings-subcard textarea":
					{
						bg: fieldBg,
						borderRadius: "4px",
						fontSize: "13px",
					},
				".master-settings-card .chakra-form__label, .master-settings-subcard .chakra-form__label":
					{
						fontSize: "xs",
						fontWeight: "semibold",
					},
				".master-settings-tabs": {
					maxW: "full",
					overflowX: "auto",
					overflowY: "hidden",
					flexWrap: "nowrap",
					WebkitOverflowScrolling: "touch",
					overscrollBehaviorInline: "contain",
					scrollbarWidth: "none",
					scrollPaddingInline: "8px",
					scrollSnapType: "x proximity",
				},
				".master-settings-tabs::-webkit-scrollbar": {
					display: "none",
				},
				".master-settings-tabs .chakra-tabs__tab": {
					flexShrink: 0,
					scrollSnapAlign: "start",
					whiteSpace: "nowrap",
					minH: { base: "40px", md: "36px" },
					px: { base: 3, md: 4 },
				},
			}}
		>
			<ResourceListCard
				title={
					<PageHeader
						title={t("settings.integrations", "Settings")}
						description={t(
							"settings.integrationsDescription",
							"Configure panel runtime, backups, Telegram, subscriptions, and templates.",
						)}
					/>
				}
				mb={4}
			/>
			<TabSystem
				className="master-settings-tabs"
				overflowX="auto"
				overflowY="hidden"
				maxW="full"
				sx={{
					WebkitOverflowScrolling: "touch",
					scrollbarWidth: "none",
					"&::-webkit-scrollbar": { display: "none" },
					button: { flexShrink: 0 },
				}}
				tabs={[
					{
						value: "panel",
						isActive: activeIntegrationTab === 0,
						onClick: () => handleIntegrationTabChange(0),
						label: t("settings.panel.tabTitle"),
					},
					{
						value: "backup",
						isActive: activeIntegrationTab === 1,
						onClick: () => handleIntegrationTabChange(1),
						label: t("settings.backup.tabTitle", "Backup"),
					},
					{
						value: "telegram",
						isActive: activeIntegrationTab === 2,
						onClick: () => handleIntegrationTabChange(2),
						label: t("settings.telegram"),
					},
					{
						value: "subscriptions",
						isActive: activeIntegrationTab === 3,
						onClick: () => handleIntegrationTabChange(3),
						label: t("settings.subscriptions.tabTitle"),
					},
					{
						value: "template-creator",
						isActive: activeIntegrationTab === 4,
						onClick: () => handleIntegrationTabChange(4),
						label: t("settings.templates.tabTitle"),
					},
				]}
			/>
			<Box
				px={{ base: 0, md: 2 }}
				mt={3}
				display={activeIntegrationTab === 0 ? "block" : "none"}
			>
						{isPanelLoading && panelData === undefined ? (
							<Flex align="center" justify="center" py={12}>
								<Spinner size="lg" />
							</Flex>
						) : (
							<Stack spacing={6} align="stretch">
								<Box className="master-settings-card">
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t("settings.panel.defaultSubscriptionType")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t("settings.panel.defaultSubscriptionTypeDescription")}
											</Text>
										</Box>
										<FormControl maxW={{ base: "full", md: "240px" }}>
											<FormLabel fontSize="sm" mb={1}>
												{t("settings.panel.defaultSubscriptionTypeLabel")}
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
													{t("settings.panel.link.usernameKey")}
												</option>
												<option value="key">
													{t("settings.panel.link.keyOnly")}
												</option>
												<option value="token">
													{t("settings.panel.link.token")}
												</option>
											</Select>
										</FormControl>
									</Flex>
								</Box>
								<Box className="master-settings-card">
									<Flex
										justify="space-between"
										align={{ base: "flex-start", md: "center" }}
										gap={4}
										flexDirection={{ base: "column", md: "row" }}
										mb={4}
									>
										<Box>
											<Heading size="sm" mb={1}>
												{t("settings.runtime.title", "Runtime settings")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t(
													"settings.runtime.description",
													"Control dashboard, API docs, subscription read mode, and usage recording from the database.",
												)}
											</Text>
										</Box>
										<Button
											variant="outline"
											size="sm"
											leftIcon={<ArrowPathIcon width={16} height={16} />}
											onClick={() => refetchRuntimeSettings()}
											isLoading={isRuntimeSettingsLoading}
										>
											{t("actions.refresh")}
										</Button>
									</Flex>
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<FormControl>
											<FormLabel fontSize="sm">
												{t("settings.runtime.dashboardPath", "Dashboard path")}
											</FormLabel>
											<Input
												value={runtimeSettingsForm.dashboard_path}
												placeholder="/dashboard/"
												onChange={(event) =>
													setRuntimeSettingsForm((prev) => ({
														...prev,
														dashboard_path: event.target.value,
													}))
												}
												isDisabled={runtimeSettingsMutation.isLoading}
											/>
											<FormHelperText>
												{t(
													"settings.runtime.dashboardPathHint",
													"Path served by the Rebecca binary, for example /dashboard/.",
												)}
											</FormHelperText>
										</FormControl>
										<FormControl>
											<FormLabel fontSize="sm">
												{t(
													"settings.runtime.subscriptionReadOnly",
													"Subscription read-only mode",
												)}
											</FormLabel>
											<TelegramSwitchRow
												title={t(
													"settings.runtime.subscriptionReadOnlyTitle",
													"Do not update subscription last-used metadata",
												)}
												description={t(
													"settings.runtime.subscriptionReadOnlyHint",
													"Useful when subscriptions are fetched by external caches or probes.",
												)}
												control={
													<Switch
														isChecked={runtimeSettingsForm.subscription_read_only}
														onChange={(event) =>
															setRuntimeSettingsForm((prev) => ({
																...prev,
																subscription_read_only: event.target.checked,
															}))
														}
														isDisabled={runtimeSettingsMutation.isLoading}
													/>
												}
											/>
										</FormControl>
										<TelegramSwitchRow
											title={t(
												"settings.runtime.recordNodeUsage",
												"Record node usage",
											)}
											description={t(
												"settings.runtime.recordNodeUsageHint",
												"Save node traffic history for the Usage page.",
											)}
											control={
												<Switch
													isChecked={runtimeSettingsForm.record_node_usage}
													onChange={(event) =>
														setRuntimeSettingsForm((prev) => ({
															...prev,
															record_node_usage: event.target.checked,
														}))
													}
													isDisabled={runtimeSettingsMutation.isLoading}
												/>
											}
										/>
										<TelegramSwitchRow
											title={t(
												"settings.runtime.recordNodeUserUsages",
												"Record user usage samples",
											)}
											description={t(
												"settings.runtime.recordNodeUserUsagesHint",
												"Save per-user, admin, and service usage samples.",
											)}
											control={
												<Switch
													isChecked={runtimeSettingsForm.record_node_user_usages}
													onChange={(event) =>
														setRuntimeSettingsForm((prev) => ({
															...prev,
															record_node_user_usages: event.target.checked,
														}))
													}
													isDisabled={runtimeSettingsMutation.isLoading}
												/>
											}
										/>
										<TelegramSwitchRow
											title={t("settings.runtime.apiDocs", "Enable API docs")}
											description={t(
												"settings.runtime.apiDocsHint",
												"Serve the embedded OpenAPI/Swagger UI from /docs.",
											)}
											control={
												<Switch
													isChecked={runtimeSettingsForm.api_docs_enabled}
													onChange={(event) =>
														setRuntimeSettingsForm((prev) => ({
															...prev,
															api_docs_enabled: event.target.checked,
														}))
													}
													isDisabled={runtimeSettingsMutation.isLoading}
												/>
											}
										/>
										<Box
											borderWidth="1px"
											borderColor="whiteAlpha.200"
											borderRadius="md"
											p={4}
											gridColumn={{ base: "auto", md: "1 / -1" }}
										>
											<Flex
												align={{ base: "flex-start", md: "center" }}
												justify="space-between"
												gap={4}
												flexDirection={{ base: "column", md: "row" }}
												mb={4}
											>
												<Box>
													<Heading size="xs" mb={1}>
														{t("phpmyadmin.title", "phpMyAdmin")}
													</Heading>
													<Text fontSize="sm" color="gray.500">
														{t(
															"phpmyadmin.settingsHint",
															"Install phpMyAdmin on the host and open it from the dedicated panel page.",
														)}
													</Text>
												</Box>
												<HStack spacing={2} flexWrap="wrap">
													<Button
														as={RouterLink}
														to="/phpmyadmin"
														size="sm"
														variant="outline"
														isDisabled={
															!runtimeSettingsForm.phpmyadmin_enabled ||
															!phpMyAdminSupported
														}
													>
														{t(
															"phpmyadmin.openPanel",
															"Open phpMyAdmin page",
														)}
													</Button>
													<Button
														size="sm"
														colorScheme={
															runtimeSettingsForm.phpmyadmin_enabled
																? "red"
																: "primary"
														}
														onClick={() =>
															runtimeSettingsForm.phpmyadmin_enabled
																? phpMyAdminDisableMutation.mutate()
																: phpMyAdminEnableMutation.mutate()
														}
														isLoading={
															phpMyAdminEnableMutation.isLoading ||
															phpMyAdminDisableMutation.isLoading
														}
														isDisabled={
															isPHPMyAdminStatusLoading ||
															(!runtimeSettingsForm.phpmyadmin_enabled &&
																!phpMyAdminSupported)
														}
													>
														{runtimeSettingsForm.phpmyadmin_enabled
															? t("phpmyadmin.disableAction", "Disable")
															: t(
																	"phpmyadmin.enableAction",
																	"Install and enable",
																)}
													</Button>
												</HStack>
											</Flex>
											{!phpMyAdminSupported ? (
												<Alert status="warning" borderRadius="md" mb={4}>
													<AlertIcon />
													{t(
														"phpmyadmin.sqliteDisabled",
														"phpMyAdmin is available only for MySQL or MariaDB installations.",
													)}
												</Alert>
											) : null}
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel fontSize="sm">
														{t("phpmyadmin.path", "Path")}
													</FormLabel>
													<Input
														value={runtimeSettingsForm.phpmyadmin_path}
														placeholder="/phpmyadmin/"
														onChange={(event) =>
															setRuntimeSettingsForm((prev) => ({
																...prev,
																phpmyadmin_path: event.target.value,
															}))
														}
														isDisabled={
															phpMyAdminEnableMutation.isLoading ||
															phpMyAdminDisableMutation.isLoading
														}
													/>
													<FormHelperText>
														{t(
															"phpmyadmin.panelOnlyHint",
															"phpMyAdmin opens inside its own panel page and uses the panel database credentials.",
														)}
													</FormHelperText>
												</FormControl>
											</SimpleGrid>
										</Box>
									</SimpleGrid>
									<Flex className="master-settings-action-row" mt={4}>
										<Button
											colorScheme="primary"
											leftIcon={<SaveIcon />}
											onClick={() =>
												runtimeSettingsMutation.mutate(runtimeSettingsForm)
											}
											isLoading={runtimeSettingsMutation.isLoading}
											isDisabled={
												runtimeSettingsMutation.isLoading ||
												isRuntimeSettingsLoading
											}
										>
											{t("settings.save")}
										</Button>
									</Flex>
								</Box>
								<Box className="master-settings-card">
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
											</>
										)}
									</Stack>
									<Stack spacing={2} mt={4}>
										<Text fontSize="sm" color="gray.500">
											{hostActionsAvailable
												? t("settings.panel.maintenanceActionsDescription")
												: t(
														"settings.panel.binaryMigrationRequiredDescription",
														"Host-level update, restart, core, and geo actions are available only after migrating this installation to binary mode.",
													)}
										</Text>
										{!hostActionsAvailable && (
											<Alert
												status="warning"
												variant="subtle"
												borderRadius="md"
											>
												<AlertIcon />
												<Text fontSize="sm">
													{t(
														"settings.panel.binaryMigrationRequired",
														"This panel is running in Docker mode. Migrate to the binary version before using these actions from the web UI.",
													)}
												</Text>
											</Alert>
										)}
										{hostActionsAvailable && panelUpdateInfo?.available && (
											<Alert
												status="success"
												variant="subtle"
												borderRadius="md"
											>
												<AlertIcon />
												<Text fontSize="sm">
													{t(
														"settings.panel.updateAvailableNotice",
														"Update available: {{current}} -> {{target}}",
														{
															current:
																panelUpdateInfo.current ||
																maintenanceInfoQuery.data?.panel?.tag ||
																t("settings.panel.versionUnknown"),
															target:
																selectedUpdateTarget ||
																panelUpdateInfo.target ||
																t("settings.panel.versionUnknown"),
														},
													)}
												</Text>
											</Alert>
										)}
										{hostActionsAvailable && panelUpdateInfo?.error && (
											<Alert
												status="warning"
												variant="subtle"
												borderRadius="md"
											>
												<AlertIcon />
												<Text fontSize="sm">
													{t(
														"settings.panel.updateCheckFailed",
														"Could not check for updates: {{error}}",
														{ error: panelUpdateInfo.error },
													)}
												</Text>
											</Alert>
										)}
										{hostActionsAvailable && (
											<FormControl maxW={{ base: "full", md: "360px" }}>
												<FormLabel fontSize="sm">
													{t("settings.panel.updateChannel", "Update channel")}
												</FormLabel>
												<Select
													size="sm"
													value={selectedUpdateChannel}
													onChange={(event) =>
														setSelectedUpdateChannel(
															event.target.value as UpdateChannel,
														)
													}
												>
													<option value="current">
														{t(
															"settings.panel.updateChannelCurrent",
															"Current installed channel",
														)}
													</option>
													<option value="latest">
														{t(
															"settings.panel.updateChannelLatest",
															"Latest release",
														)}
													</option>
													<option value="dev">
														{t("settings.panel.updateChannelDev", "Dev build")}
													</option>
												</Select>
												<FormHelperText>
													{selectedUpdateTarget
														? t(
																"settings.panel.updateTargetHint",
																"Target: {{version}}",
																{ version: selectedUpdateTarget },
															)
														: t(
																"settings.panel.updateTargetUnknown",
																"Target version is not available yet.",
															)}
												</FormHelperText>
											</FormControl>
										)}
										{hostActionsAvailable &&
											selectedUpdateChannel === "dev" && (
												<Alert
													status="warning"
													variant="subtle"
													borderRadius="md"
												>
													<AlertIcon />
													<Text fontSize="sm">
														{t(
															"settings.panel.devChannelWarning",
															"Dev builds are not stable. They can include unfinished changes, migrations in progress, and temporary bugs.",
														)}
													</Text>
												</Alert>
											)}
										{activeMaintenanceAction && (
											<Alert status="info" variant="subtle" borderRadius="md">
												<AlertIcon />
												<Text fontSize="sm">
													{activeMaintenanceAction === "update"
														? t("settings.panel.updateInProgressHint")
														: activeMaintenanceAction === "restart"
															? t("settings.panel.restartInProgressHint")
															: t("settings.panel.softReloadInProgressHint")}
												</Text>
											</Alert>
										)}
										<HStack spacing={3} flexWrap="wrap" className="master-settings-action-row">
											<Button
												size="sm"
												colorScheme="yellow"
												leftIcon={<ArrowUpTrayIcon width={16} height={16} />}
												onClick={handlePanelUpdateClick}
												isLoading={updateMutation.isLoading}
												isDisabled={!hostActionsAvailable}
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
												{t("settings.panel.softReloadAction")}
											</Button>
											<Button
												size="sm"
												colorScheme="red"
												leftIcon={
													<ArrowsRightLeftIcon width={16} height={16} />
												}
												onClick={() => restartMutation.mutate()}
												isLoading={restartMutation.isLoading}
												isDisabled={!hostActionsAvailable}
											>
												{t("settings.panel.restartAction")}
											</Button>
										</HStack>
									</Stack>
								</Box>
								<Flex className="master-settings-action-row">
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
												default_subscription_type: panelDefaultSubType,
											})
										}
										isLoading={panelMutation.isLoading}
										isDisabled={
											panelMutation.isLoading ||
											panelData === undefined ||
											panelDefaultSubType ===
												(panelData.default_subscription_type ?? "key")
										}
									>
										{t("settings.save")}
									</Button>
								</Flex>
							</Stack>
						)}
			</Box>
			<Box
				px={{ base: 0, md: 2 }}
				mt={3}
				display={activeIntegrationTab === 2 ? "block" : "none"}
			>
						{isLoading && !data ? (
							<Flex align="center" justify="center" py={12}>
								<Spinner size="lg" />
							</Flex>
						) : (
							<form className="telegram-settings-form" onSubmit={handleSubmit(onSubmit)}>
								<VStack align="stretch" spacing={4}>
									<TelegramSwitchRow
										title={t("settings.telegram.enableBot")}
										description={t("settings.telegram.enableBotDescription")}
										control={
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
										}
									/>
									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box className="master-settings-card">
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
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
												<TelegramSwitchRow
													title={t("settings.telegram.logsChatIsForum")}
													description={t(
														"settings.telegram.logsChatIsForumHint",
														"Send report messages into a Telegram forum topic.",
													)}
													control={
														<Controller
															control={control}
															name="logs_chat_is_forum"
															render={({ field }) => (
																<Switch
																	isChecked={field.value}
																	onChange={(event) =>
																		field.onChange(event.target.checked)
																	}
																/>
															)}
														/>
													}
												/>
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
											<Flex className="master-settings-action-row" mt={4}>
												<Button
													size="sm"
													variant="outline"
													leftIcon={<SaveIcon />}
													isLoading={telegramTestMutation.isLoading}
													onClick={() => telegramTestMutation.mutate()}
												>
													{t(
														"settings.telegram.testMessage",
														"Send test message",
													)}
												</Button>
											</Flex>
										</Box>
									</DisabledCard>

									<DisabledCard
										disabled={!isTelegramEnabled || !hostActionsAvailable}
										message={
											!hostActionsAvailable
												? telegramBackupDisabledMessage
												: telegramDisabledMessage
										}
									>
										<Box
											id="telegram-periodic-backup"
											className="master-settings-card"
											scrollMarginTop="120px"
										>
											<Box mb={3}>
												<TelegramSwitchRow
													title={t(
														"settings.telegram.backupTitle",
														"Periodic backup",
													)}
													description={t(
														"settings.telegram.backupDescription",
														"Send Rebecca backups to Telegram on a schedule.",
													)}
													control={
														<Controller
															control={control}
															name="backup_enabled"
															render={({ field }) => (
																<Switch
																	isChecked={field.value}
																	onChange={(event) =>
																		field.onChange(event.target.checked)
																	}
																/>
															)}
														/>
													}
												/>
											</Box>
											<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t(
															"settings.telegram.backupChatId",
															"Backup chat ID",
														)}
													</FormLabel>
													<Input
														placeholder="-100123456789"
														{...register("backup_chat_id")}
													/>
													<FormHelperText>
														{t(
															"settings.telegram.backupChatIdHint",
															"Leave empty to use the log chat or admin chats.",
														)}
													</FormHelperText>
												</FormControl>
												<TelegramSwitchRow
													title={t(
														"settings.telegram.backupChatIsForum",
														"Backup chat is a forum",
													)}
													description={t(
														"settings.telegram.backupChatIsForumHint",
														"Send backup files into the configured Telegram topic.",
													)}
													control={
														<Controller
															control={control}
															name="backup_chat_is_forum"
															render={({ field }) => (
																<Switch
																	isChecked={field.value}
																	onChange={(event) =>
																		field.onChange(event.target.checked)
																	}
																/>
															)}
														/>
													}
												/>
												<FormControl>
													<FormLabel>
														{t("settings.telegram.backupScope", "Backup scope")}
													</FormLabel>
													<Controller
														control={control}
														name="backup_scope"
														render={({ field }) => (
															<Select
																{...field}
															>
																<option value="database">
																	{t(
																		"settings.telegram.backupScopeDatabase",
																		"Database only",
																	)}
																</option>
																<option value="full">
																	{t(
																		"settings.telegram.backupScopeFull",
																		"Database + Rebecca files",
																	)}
																</option>
															</Select>
														)}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t(
															"settings.telegram.backupIntervalValue",
															"Every",
														)}
													</FormLabel>
													<Controller
														control={control}
														name="backup_interval_value"
														render={({ field }) => (
															<NumericInput
																min={1}
																value={field.value}
																onChange={(_value, valueAsNumber) =>
																	field.onChange(
																		Number.isFinite(valueAsNumber)
																			? valueAsNumber
																			: 1,
																	)
																}
																isDisabled={!isTelegramBackupEnabled}
															/>
														)}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t(
															"settings.telegram.backupIntervalUnit",
															"Interval unit",
														)}
													</FormLabel>
													<Controller
														control={control}
														name="backup_interval_unit"
														render={({ field }) => (
															<Select
																{...field}
																isDisabled={!isTelegramBackupEnabled}
															>
																<option value="minutes">
																	{t(
																		"settings.telegram.backupIntervalMinutes",
																		"Minutes",
																	)}
																</option>
																<option value="hours">
																	{t(
																		"settings.telegram.backupIntervalHours",
																		"Hours",
																	)}
																</option>
																<option value="days">
																	{t(
																		"settings.telegram.backupIntervalDays",
																		"Days",
																	)}
																</option>
															</Select>
														)}
													/>
												</FormControl>
											</SimpleGrid>
											<SimpleGrid
												columns={{ base: 1, md: 2 }}
												spacing={3}
												mt={3}
											>
												<Text fontSize="xs" color="gray.500">
													{t("settings.telegram.backupLastSent", "Last sent")}:{" "}
													{data?.backup_last_sent_at || "-"}
												</Text>
												{data?.backup_last_error && (
													<Text fontSize="xs" color="red.300">
														{t(
															"settings.telegram.backupLastError",
															"Last error",
														)}
														: {data.backup_last_error}
													</Text>
												)}
											</SimpleGrid>
											<Flex className="master-settings-action-row" mt={4}>
												<Button
													size="sm"
													variant="outline"
													leftIcon={<ArrowUpTrayIcon width={16} />}
													isLoading={telegramBackupMutation.isLoading}
													onClick={() =>
														telegramBackupMutation.mutate(telegramBackupScope)
													}
												>
													{t(
														"settings.telegram.backupSendNow",
														"Send backup now",
													)}
												</Button>
											</Flex>
										</Box>
									</DisabledCard>

									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box className="master-settings-card">
											<Flex
												justify="space-between"
												align={{ base: "flex-start", md: "center" }}
												gap={3}
												flexDirection={{ base: "column", md: "row" }}
											>
												<Box>
													<Heading size="sm">
														{t(
															"settings.telegram.botCommandsTitle",
															"Bot commands",
														)}
													</Heading>
												</Box>
												<Badge colorScheme="yellow">
													{t("settings.tabs.comingSoon", "Coming Soon")}
												</Badge>
											</Flex>
										</Box>
									</DisabledCard>

									<DisabledCard
										disabled={!isTelegramEnabled}
										message={telegramDisabledMessage}
									>
										<Box>
											<Heading size="sm" mb={3}>
												{t("settings.telegram.forumTopics")}
											</Heading>
											{forumTopics && Object.keys(forumTopics).length > 0 ? (
												<SimpleGrid columns={{ base: 1, xl: 2 }} spacing={3}>
													{Object.entries(forumTopics).map(([key]) => (
														<Box className="master-settings-subcard" key={key}>
															<Text fontSize="sm" fontWeight="medium" mb={2}>
																{t("settings.telegram.topicKey")}: {key}
															</Text>
															<SimpleGrid
																columns={{ base: 1, md: 2 }}
																spacing={3}
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
												</SimpleGrid>
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
														className="master-settings-subcard"
														key={group.key}
													>
														<Text fontWeight="semibold" mb={3}>
															{t(group.titleKey, group.defaultTitle)}
														</Text>
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={4}
														>
															{group.events.map((event) => (
																<TelegramSwitchRow
																	key={event.key}
																	title={t(event.labelKey, event.defaultLabel)}
																	description={t(event.hintKey, event.defaultHint)}
																	control={
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
																	}
																/>
															))}
														</SimpleGrid>
													</Box>
												))}
											</Stack>
										</Box>
									</DisabledCard>

									<Flex className="master-settings-action-row">
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
			</Box>
			<Box
				px={{ base: 0, md: 2 }}
				mt={3}
				display={activeIntegrationTab === 3 ? "block" : "none"}
			>
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
									<Box className="master-settings-card">
										<Flex
											justify="space-between"
											align={{ base: "flex-start", md: "center" }}
											flexDirection={{ base: "column", md: "row" }}
											gap={3}
											mb={4}
										>
											<Box>
												<Heading size="sm" mb={1}>
													{t("settings.subscriptions.globalTitle")}
												</Heading>
												<Text fontSize="sm" color="gray.500">
													{t("settings.subscriptions.globalDescription")}
												</Text>
											</Box>
											<HStack spacing={2}>
												<Button
													variant="outline"
													size="sm"
													leftIcon={<RefreshIcon />}
													type="button"
													onClick={() => refetchSubscriptionSettings()}
													isDisabled={subscriptionSettingsMutation.isLoading}
												>
													{t("actions.refresh")}
												</Button>
												<Button
													colorScheme="primary"
													size="sm"
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
											</HStack>
										</Flex>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.urlPrefix")}
												</FormLabel>
												<Input
													placeholder="https://sub.example.com"
													{...subscriptionRegister("subscription_url_prefix")}
												/>
												<FormHelperText>
													{t("settings.subscriptions.urlPrefixHint")}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.customTemplatesDir")}
												</FormLabel>
												<Input
													placeholder="/var/lib/rebecca/templates"
													{...subscriptionRegister(
														"custom_templates_directory",
													)}
												/>
												<FormHelperText>
													{t("settings.subscriptions.customTemplatesDirHint")}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.profileTitle")}
												</FormLabel>
												<Input
													placeholder="Subscription"
													{...subscriptionRegister(
														"subscription_profile_title",
													)}
												/>
												<FormHelperText>
													{t("settings.subscriptions.profileTitleHint")}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.supportUrl")}
												</FormLabel>
												<Input
													placeholder="https://t.me/support"
													{...subscriptionRegister("subscription_support_url")}
												/>
												<FormHelperText>
													{t("settings.subscriptions.supportUrlHint")}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.updateInterval")}
												</FormLabel>
												<Input
													type="number"
													{...subscriptionRegister(
														"subscription_update_interval",
													)}
												/>
												<FormHelperText>
													{t("settings.subscriptions.updateIntervalHint")}
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.subscriptionPageTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.homePageTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.clashTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.clashSettingsTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.v2rayTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.v2raySettingsTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.singboxTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.singboxSettingsTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("settings.subscriptions.muxTemplate")}
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
														{t("settings.subscriptions.editTemplate")}
													</Button>
												</HStack>
											</FormControl>
											<Box gridColumn={{ base: "1 / -1", md: "1 / -1" }}>
												<Divider mb={3} />
												<Text fontSize="sm" fontWeight="semibold">
													{t(
														"settings.subscriptions.routingSection",
														"Routing aliases and ports",
													)}
												</Text>
											</Box>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.subscriptionAliases",
														"Subscription alias URLs",
													)}
												</FormLabel>
												<Textarea
													placeholder="/mypath/\n/test/\n/api/v1/client/subscribe?token=\n/api/v1/client/subscribe?key="
													rows={4}
													{...subscriptionRegister("subscription_aliases_text")}
												/>
												<FormHelperText>
													One alias per line. Examples: /mypath/ , /test/ ,
													/api/v1/client/subscribe?token= ,
													/api/v1/client/subscribe?key=
												</FormHelperText>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"settings.subscriptions.subscriptionPorts",
														"Subscription ports",
													)}
												</FormLabel>
												<Input
													placeholder="443, 8443"
													{...subscriptionRegister("subscription_ports_text", {
														onBlur: (event) => {
															const normalized = formatSubscriptionPorts(
																parseSubscriptionPortsInput(
																	event.target.value || "",
																),
															);
															setSubscriptionValue(
																"subscription_ports_text",
																normalized,
																{
																	shouldDirty: true,
																},
															);
														},
													})}
												/>
												<FormHelperText>
													{t(
														"settings.subscriptions.subscriptionPortsHint",
														"Extra ports for generated subscription URLs. Separate with comma or space.",
													)}
													{parsedSubscriptionPorts.length > 0
														? ` ${t("settings.subscriptions.activePorts", "Active ports")}: ${parsedSubscriptionPorts.join(", ")}`
														: ""}
												</FormHelperText>
											</FormControl>
										</SimpleGrid>
										<Divider my={4} />
										<Text fontSize="sm" fontWeight="semibold" mb={3}>
											{t(
												"settings.subscriptions.clientJsonSection",
												"Client JSON behavior",
											)}
										</Text>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<Controller
												control={subscriptionControl}
												name="use_custom_json_default"
												render={({ field }) => (
													<FormControl display="flex" alignItems="center">
														<Box flex="1">
															<Text fontWeight="medium">
																{t("settings.subscriptions.customJsonDefault")}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonDefaultHint",
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
																{t("settings.subscriptions.customJsonV2rayn")}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonV2raynHint",
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
																{t("settings.subscriptions.customJsonV2rayng")}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonV2rayngHint",
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
																)}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t(
																	"settings.subscriptions.customJsonStreisandHint",
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
																{t("settings.subscriptions.customJsonHapp")}
															</Text>
															<Text fontSize="sm" color="gray.500">
																{t("settings.subscriptions.customJsonHappHint")}
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
									<Box className="master-settings-card">
										<Heading size="sm" mb={1}>
											{t("settings.subscriptions.adminsTitle")}
										</Heading>
										<Text fontSize="sm" color="gray.500" mb={4}>
											{t("settings.subscriptions.adminsDescription")}
										</Text>
										{Object.values(adminOverrides).length === 0 ? (
											<Text color="gray.500">
												{t("settings.subscriptions.noAdmins")}
											</Text>
										) : (
											<Stack spacing={4}>
												<FormControl maxW={{ base: "full", md: "280px" }}>
													<FormLabel>
														{t("settings.subscriptions.selectAdmin")}
													</FormLabel>
													<Menu>
														<MenuButton
															as={Button}
															variant="outline"
															size="sm"
															rightIcon={<ChevronDownIcon />}
															w="full"
															h="36px"
															px={3}
															fontSize="13px"
															fontWeight="semibold"
															justifyContent="space-between"
															textAlign="start"
															borderRadius="md"
														>
															<Text
																as="span"
																noOfLines={1}
																flex="1"
																minW={0}
																textAlign="start"
															>
																{selectedAdminId &&
																adminOverrides[selectedAdminId]
																	? adminOverrides[selectedAdminId].username
																	: t(
																			"settings.subscriptions.selectAdminPlaceholder",
																		)}
															</Text>
														</MenuButton>
														<MenuList
															minW={{ base: "calc(100vw - 48px)", md: "280px" }}
															maxW={{ base: "calc(100vw - 48px)", md: "280px" }}
															maxH="280px"
															overflowY="auto"
															borderColor={borderColor}
															boxShadow="xl"
															sx={{
																scrollbarWidth: "none",
																"&::-webkit-scrollbar": {
																	display: "none",
																},
															}}
														>
															<Box
																p={2}
																borderBottom="1px solid"
																borderColor="gray.200"
															>
																<InputGroup size="sm">
																	<InputLeftElement
																		pointerEvents="none"
																		w="2.4rem"
																		h="full"
																		display="flex"
																		alignItems="center"
																		justifyContent="center"
																	>
																		<SearchIcon color="gray.400" w={4} h={4} />
																	</InputLeftElement>
																	<Input
																		ps="2.4rem"
																		textAlign="start"
																		placeholder={t(
																			"settings.subscriptions.searchAdmin",
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
																		{t("settings.subscriptions.noResults")}
																	</Text>
																</Box>
															) : (
																filteredAdmins.map((admin) => (
																	<MenuItem
																		key={admin.id}
																		onClick={() => setSelectedAdminId(admin.id)}
																		minH="36px"
																		py={1.5}
																		px={3}
																		bg={
																			selectedAdminId === admin.id
																				? "primary.50"
																				: undefined
																		}
																		_dark={{
																			bg:
																				selectedAdminId === admin.id
																					? "whiteAlpha.100"
																					: undefined,
																		}}
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
														{t("settings.subscriptions.inheritHint")}
													</FormHelperText>
												</FormControl>
												{selectedAdminId == null ||
												!adminOverrides[selectedAdminId] ? (
													<Text color="gray.500">
														{t("settings.subscriptions.selectAdminPlaceholder")}
													</Text>
												) : (
													<Box
														className="master-settings-subcard"
														key={selectedAdminId}
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
																				{t("settings.subscriptions.adminHint")}
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
																				{t("actions.reset")}
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
																				{t("settings.subscriptions.supportUrl")}
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.homePageTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.clashTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.clashSettingsTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.v2rayTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.v2raySettingsTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.singboxTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.singboxSettingsTemplate",
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
																					)}
																				</Button>
																			</HStack>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"settings.subscriptions.muxTemplate",
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
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonDefaultHint",
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
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonV2raynHint",
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
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonV2rayngHint",
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
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonStreisandHint",
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
																					)}
																				</Text>
																				<Text fontSize="sm" color="gray.500">
																					{t(
																						"settings.subscriptions.customJsonHappHint",
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

																	<Flex className="master-settings-action-row" mt={4}>
																		<Button
																			variant="outline"
																			leftIcon={<RefreshIcon />}
																			onClick={() => handleAdminReset(admin.id)}
																			isDisabled={savingAdminId === admin.id}
																		>
																			{t(
																				"settings.subscriptions.resetOverrides",
																			)}
																		</Button>
																		<Button
																			colorScheme="primary"
																			leftIcon={<SaveIcon />}
																			onClick={() => handleAdminSave(admin.id)}
																			isLoading={savingAdminId === admin.id}
																		>
																			{t("settings.subscriptions.saveAdmin")}
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
									<Box
										className="master-settings-card"
										position="relative"
										overflow="hidden"
										borderStyle="dashed"
									>
										<Box
											opacity={0.42}
											filter="grayscale(0.55)"
											pointerEvents="none"
											userSelect="none"
											aria-hidden
										>
											<Heading size="sm" mb={1}>
												{t("settings.subscriptions.certificateTitle")}
											</Heading>
											<Text fontSize="sm" color="gray.500" mb={4}>
												{t("settings.subscriptions.certificateDescription")}
											</Text>
											<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t("settings.subscriptions.email")}
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
														{t("settings.subscriptions.domains")}
													</FormLabel>
													<Input
														placeholder="example.com,sub.example.com"
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
															"Comma-separated list of domains for certificate issuance.",
														)}
													</FormHelperText>
												</FormControl>
											</SimpleGrid>
											<Flex className="master-settings-action-row" mt={3}>
												<Button
													colorScheme="primary"
													leftIcon={<SaveIcon />}
													onClick={handleIssueCertificate}
													isLoading={issueCertificateMutation.isLoading}
												>
													{t("settings.subscriptions.issueAction")}
												</Button>
											</Flex>
											<Divider my={4} />
											<Heading size="sm" mb={2}>
												{t("settings.subscriptions.certificateList")}
											</Heading>
											{!subscriptionBundle?.certificates?.length ? (
												<Text color="gray.500">
													{t("settings.subscriptions.noCertificates")}
												</Text>
											) : (
												<Stack spacing={3}>
													{subscriptionBundle.certificates.map((cert) => (
														<Box
															className="master-settings-subcard"
															key={cert.domain}
														>
															<Flex
																justify="space-between"
																align={{ base: "flex-start", md: "center" }}
																gap={3}
																flexDirection={{ base: "column", md: "row" }}
															>
																<Box>
																	<Text fontWeight="semibold">
																		{cert.domain}
																	</Text>
																	<Text fontSize="sm" color="gray.500">
																		{t("settings.subscriptions.pathLabel")}:{" "}
																		{cert.path}
																	</Text>
																	<Text fontSize="sm" color="gray.500">
																		{t("settings.subscriptions.lastIssued")}:{" "}
																		{cert.last_issued_at
																			? new Date(
																					cert.last_issued_at,
																				).toLocaleString()
																			: t("settings.subscriptions.never")}
																	</Text>
																	<Text fontSize="sm" color="gray.500">
																		{t("settings.subscriptions.lastRenewed")}:{" "}
																		{cert.last_renewed_at
																			? new Date(
																					cert.last_renewed_at,
																				).toLocaleString()
																			: t("settings.subscriptions.never")}
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
																		{t("settings.subscriptions.renewAction")}
																	</Button>
																</HStack>
															</Flex>
														</Box>
													))}
												</Stack>
											)}
										</Box>
										<Flex
											position="absolute"
											inset={0}
											align="center"
											justify="center"
											bg={comingSoonOverlayBg}
											backdropFilter="blur(2px)"
											zIndex={1}
										>
											<Badge
												colorScheme="orange"
												borderRadius="full"
												px={4}
												py={2}
												fontSize="sm"
												textTransform="lowercase"
											>
												coming soon
											</Badge>
										</Flex>
									</Box>
								</VStack>
							</form>
						)}
			</Box>
			<Box
				px={{ base: 0, md: 2 }}
				mt={3}
				display={activeIntegrationTab === 1 ? "block" : "none"}
			>
						<VStack align="stretch" spacing={6}>
							<RebeccaBackupPanel
								isBinaryRuntime={hostActionsAvailable}
								runtimeLoading={maintenanceInfoQuery.isLoading}
							/>
						</VStack>
			</Box>
			<Box
				px={{ base: 0, md: 2 }}
				mt={3}
				display={activeIntegrationTab === 4 ? "block" : "none"}
			>
						<VStack align="stretch" spacing={6}>
							<Alert status="warning" variant="left-accent" borderRadius="md">
								<AlertIcon />
								<Box>
									<Text fontWeight="semibold">
										{t("settings.integrations.incompleteWarningTitle")}
									</Text>
									<Text fontSize="sm">
										{t("settings.integrations.incompleteWarningDescription")}
									</Text>
								</Box>
							</Alert>
							<SubscriptionTemplateCreator
								onSaved={() => {
									void refetchSubscriptionSettings();
								}}
							/>
						</VStack>
			</Box>
			<ConfirmActionDialog
				isOpen={isDevUpdateConfirmOpen}
				onClose={() => setDevUpdateConfirmOpen(false)}
				onConfirm={confirmDevPanelUpdate}
				title={t(
					"settings.panel.devChannelConfirmTitle",
					"Update to dev build?",
				)}
				message={t(
					"settings.panel.devChannelConfirm",
					"You are switching/updating this panel to the dev channel. Dev builds are not stable and can include unfinished changes, breaking migrations, or temporary bugs. Continue?",
				)}
				confirmLabel={t("settings.panel.updatePanel", "Update panel")}
				cancelLabel={t("cancel", "Cancel")}
				colorScheme="yellow"
				isLoading={updateMutation.isLoading}
			/>
			<Modal
				isOpen={isMaintenanceProgressOpen}
				onClose={() => setMaintenanceProgressOpen(false)}
				size="xl"
				closeOnOverlayClick={!maintenanceIsWaitingForAPI}
			>
				<ModalOverlay bg="blackAlpha.500" backdropFilter="blur(8px)" />
				<ModalContent mx={3}>
					<ModalHeader>
						{maintenanceOperation?.action === "update"
							? t("settings.panel.updateProgressTitle", "Updating Rebecca")
							: maintenanceOperation?.action === "restart"
								? t("settings.panel.restartProgressTitle", "Restarting Rebecca")
								: t("settings.panel.reloadProgressTitle", "Reloading Rebecca")}
					</ModalHeader>
					<ModalCloseButton isDisabled={maintenanceIsWaitingForAPI} />
					<ModalBody>
						<VStack align="stretch" spacing={4}>
							<Alert
								status={
									maintenanceOperation?.error
										? "error"
										: maintenanceIsWaitingForAPI ||
											  shouldWaitForPanelReturn(maintenanceOperation)
											? "info"
											: "success"
								}
								variant="subtle"
								borderRadius="md"
							>
								<AlertIcon />
								<Box>
									<Text fontWeight="semibold">
										{maintenanceOperation?.phase ||
											t("settings.panel.maintenanceQueued", "queued")}
									</Text>
									<Text fontSize="sm">
										{maintenanceOperation?.error ||
											maintenanceOperation?.message ||
											t(
												"settings.panel.maintenanceQueued",
												"Command accepted.",
											)}
									</Text>
								</Box>
							</Alert>
							<Box>
								<Flex justify="space-between" mb={2}>
									<Text fontSize="sm" fontWeight="medium">
										{t("settings.panel.downloadProgress", "Progress")}
									</Text>
									<Text fontSize="sm" color="gray.500">
										{typeof maintenanceOperation?.progress === "number"
											? `${maintenanceOperation.progress}%`
											: maintenanceStatusQuery.isFetching
												? t("settings.panel.checkingStatus", "checking...")
												: t("settings.panel.waitingForOutput", "waiting")}
									</Text>
								</Flex>
								<Progress
									value={
										typeof maintenanceOperation?.progress === "number"
											? maintenanceOperation.progress
											: undefined
									}
									isIndeterminate={
										typeof maintenanceOperation?.progress !== "number" &&
										!maintenanceOperation?.error
									}
									colorScheme={
										maintenanceOperation?.error
											? "red"
											: shouldWaitForPanelReturn(maintenanceOperation)
												? "blue"
												: "yellow"
									}
									borderRadius="full"
									size="sm"
								/>
							</Box>
							{maintenanceIsWaitingForAPI && (
								<Alert status="info" variant="left-accent" borderRadius="md">
									<AlertIcon />
									<Text fontSize="sm">
										{t(
											"settings.panel.autoRefreshAfterRestart",
											"Rebecca is restarting. This page will refresh automatically as soon as the API responds again.",
										)}
									</Text>
								</Alert>
							)}
							<Box>
								<Text fontSize="sm" fontWeight="medium" mb={2}>
									{t("settings.panel.maintenanceOutput", "Output")}
								</Text>
								<Box
									as="pre"
									maxH="260px"
									overflowY="auto"
									bg={maintenanceOutputBg}
									border="1px solid"
									borderColor={maintenanceOutputBorder}
									borderRadius="md"
									p={3}
									fontSize="xs"
									whiteSpace="pre-wrap"
								>
									{cleanTerminalOutput(maintenanceOperation?.logs) ||
										t(
											"settings.panel.waitingForOutput",
											"Waiting for command output...",
										)}
								</Box>
							</Box>
						</VStack>
					</ModalBody>
					<ModalFooter>
						<Button
							variant="outline"
							onClick={() => setMaintenanceProgressOpen(false)}
							isDisabled={maintenanceIsWaitingForAPI}
						>
							{t("close", "Close")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
			<Modal
				isOpen={Boolean(templateDialog)}
				onClose={closeTemplateEditor}
				size="6xl"
				scrollBehavior="inside"
			>
				<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
				<XrayModalContent mx="3">
					<XrayModalHeader>
						{templateDialog
							? t("settings.subscriptions.editTemplateTitle")
							: ""}
					</XrayModalHeader>
					<ModalCloseButton />
					<XrayModalBody>
						{templateLoading ? (
							<Flex align="center" justify="center" minH="200px">
								<Spinner />
							</Flex>
						) : (
							<VStack
								className="xray-dialog-section"
								align="stretch"
								spacing={3}
							>
								{templateDialog?.adminId ? (
									<Text fontWeight="medium">
										{t("settings.subscriptions.adminTemplateFor")}:{" "}
										{adminOverrides[templateDialog.adminId]?.username ||
											t("settings.subscriptions.admin")}
									</Text>
								) : (
									<Text fontWeight="medium">
										{t("settings.subscriptions.globalTemplate")}
									</Text>
								)}
								<Text fontSize="sm" color="gray.500">
									{t("settings.subscriptions.templatePath")}:{" "}
									{templateMeta?.template_name ||
										templateDialog?.templateKey ||
										""}
									{templateMeta?.custom_directory
										? ` (${templateMeta.custom_directory})`
										: ""}
								</Text>
								{templateMeta?.resolved_path ? (
									<Text fontSize="xs" color="gray.500">
										{t("settings.subscriptions.resolvedPath")}:{" "}
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
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button mr={3} onClick={closeTemplateEditor} variant="ghost">
							{t("actions.close")}
						</Button>
						<Button
							colorScheme="primary"
							onClick={handleTemplateSave}
							isLoading={
								templateContentMutation.isLoading || templateLoading || false
							}
							isDisabled={!templateDialog || templateLoading}
						>
							{t("settings.save")}
						</Button>
					</XrayModalFooter>
				</XrayModalContent>
			</Modal>
		</Box>
	);
};
