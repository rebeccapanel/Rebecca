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
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Text,
	Textarea,
	useColorMode,
	useColorModeValue,
	useToast,
	VStack,
	IconButton,
} from "@chakra-ui/react";
import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	ArrowPathIcon,
	ArrowUpTrayIcon,
	ChevronDownIcon as HeroChevronDownIcon,
	ChevronUpIcon,
	NoSymbolIcon,
	PaperAirplaneIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { NumericInput } from "components/common/NumericInput";
import { PanelInput as Input } from "components/common/PanelInput";
import { SearchInput } from "components/common/SearchInput";
import useGetUser from "hooks/useGetUser";
import {
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Controller, useForm, useFieldArray } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router-dom";
import { fetch as apiFetch } from "service/http";
import {
	type AdminSubscriptionUpdatePayload,
	type AdminSubscriptionSettings,
	deleteSubscriptionCertificate,
	disablePHPMyAdmin,
	enablePHPMyAdmin,
	getPanelSettings,
	getPHPMyAdminEmbedHTML,
	getPHPMyAdminStatus,
	getRuntimeSettings,
	getSubscriptionSettings,
	getTelegramSettings,
	importSubscriptionCertificate,
	issueSubscriptionCertificate,
	type PanelSettingsResponse,
	renewSubscriptionCertificate,
	type RuntimeSettingsResponse,
	sendTelegramBackup,
	testTelegramSettings,
	type SubscriptionCertificate,
	type SubscriptionSettingsBundle,
	type SubscriptionTemplateSettings,
	type SubscriptionTemplateSettingsUpdatePayload,
	type TelegramSettingsResponse,
	type TelegramSettingsUpdatePayload,
	type AllSettingsUpdatePayload,
	updateAllSettings,
	updateSubscriptionCertificateServing,
	revokeSubscriptionCertificate,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import {
	DEFAULT_SEARCH_MATCH_OPTIONS,
	matchesAnySearch,
} from "utils/searchMatch";
import {
	integrationTabKeys,
	parseSettingsHash,
} from "utils/settingsTabs";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import {
	DataTable,
	ResourceListCard,
	TabSystem,
	type DataTableColumn,
	type DataTableRowAction,
} from "../components/ui";

const CLIENT_OPTIONS = [
	"clash-meta",
	"clash-mi",
	"clash",
	"karing",
	"hiddify",
	"sing-box",
	"v2raytun",
	"shadowrocket",
	"nekobox",
	"passwall",
	"throne",
	"outline",
	"v2ray-json",
	"xray-json",
	"happ",
	"incy",
	"v2ray",
	"base64-links",
	"blocked"
];

const DEFAULT_CLIENT_ROUTING_RULES = [
	{ pattern: "^([Cc]lash-verge|[Cc]lash[-\\.]?[Mm]eta|[Ff][Ll][Cc]lash|[Mm]ihomo)", result: "clash-meta" },
	{ pattern: "(?i)^clash\\s*mi|(?i)^clashmi", result: "clash-mi" },
	{ pattern: "^([Cc]lash|[Ss]tash)", result: "clash" },
	{ pattern: "(?i)^karing", result: "karing" },
	{ pattern: "(?i)^hiddifynextx?", result: "hiddify" },
	{ pattern: "^(SFA|SFI|SFM|SFT)", result: "sing-box" },
	{ pattern: "(?i)^v2raytun", result: "v2raytun" },
	{ pattern: "(?i)^shadowrocket", result: "shadowrocket" },
	{ pattern: "(?i)^(nekobox|nekoboxforandroid)", result: "nekobox" },
	{ pattern: "(?i)^passwall", result: "passwall" },
	{ pattern: "(?i)^thron(e)?", result: "throne" },
	{ pattern: "^(SS|SSR|SSD|SSS|Outline|Shadowsocks|SSconf)", result: "outline" },
	{ pattern: "^v2rayN/(?:6\\.[4-9]\\d*|[7-9]\\.\\d+|[1-9]\\d{1,}\\.\\d+)", result: "v2ray-json" },
	{ pattern: "(?i)^v2rayng/\\d+\\.\\d+", result: "v2ray-json" },
	{ pattern: "^Happ/(?:1\\.63\\.[1-9]|1\\.6[4-9]\\d*|1\\.[7-9]\\d*|[2-9]\\.\\d+)", result: "happ" },
	{ pattern: "(?i)^incy", result: "incy" },
	{ pattern: "^Streisand", result: "v2ray-json" },
];

type EventToggleItem = {
	key: string;
	labelKey: string;
	defaultLabel: string;
	hintKey: string;
	defaultHint: string;
};

type RuntimeMaintenanceInfo = {
	panel?: { mode?: string; install_mode?: string } | null;
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
const encodeToggleKey = (key: string) =>
	key.replace(/\./g, TOGGLE_KEY_PLACEHOLDER);
const decodeToggleKey = (key: string) =>
	key.replace(new RegExp(TOGGLE_KEY_PLACEHOLDER, "g"), ".");

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
	phpmyadmin_login_mode: "rebecca",
	phpmyadmin_username: "",
	phpmyadmin_password: "",
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
	client_routing_rules: { pattern: string; result: string }[];
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
	happ_subscription_template: settings?.happ_subscription_template ?? "",
	incy_subscription_template: settings?.incy_subscription_template ?? "",
	singbox_subscription_template: settings?.singbox_subscription_template ?? "",
	singbox_settings_template: settings?.singbox_settings_template ?? "",
	mux_template: settings?.mux_template ?? "",
	subscription_path: settings?.subscription_path ?? "sub",
	subscription_aliases: settings?.subscription_aliases ?? [],
	subscription_ports: settings?.subscription_ports ?? [],
	subscription_placeholder_enabled:
		settings?.subscription_placeholder_enabled ?? false,
	subscription_placeholder_remark:
		settings?.subscription_placeholder_remark ?? "disabled",
	subscription_aliases_text: (settings?.subscription_aliases ?? []).join("\n"),
	subscription_ports_text: formatSubscriptionPorts(
		settings?.subscription_ports ?? [],
	),
	client_routing_rules: settings?.client_routing_rules ?? [],
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
			transition="filter 0.2s ease, opacity 0.2s ease"
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

const buildTelegramPayload = (
	values: FormValues,
): TelegramSettingsUpdatePayload => ({
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
	event_toggles: flattenEventToggleValues(values.event_toggles || {}),
	backup_enabled: values.backup_enabled,
	backup_scope: values.backup_scope,
	backup_interval_value: Math.max(Number(values.backup_interval_value || 1), 1),
	backup_interval_unit: values.backup_interval_unit,
});

const buildSubscriptionPayload = (
	values: SubscriptionFormValues,
): SubscriptionTemplateSettingsUpdatePayload => ({
	subscription_url_prefix: values.subscription_url_prefix ?? "",
	subscription_profile_title: values.subscription_profile_title.trim(),
	subscription_support_url: values.subscription_support_url.trim(),
	subscription_update_interval: values.subscription_update_interval.trim(),
	custom_templates_directory: values.custom_templates_directory?.trim() || null,
	clash_subscription_template: values.clash_subscription_template.trim(),
	clash_settings_template: values.clash_settings_template.trim(),
	subscription_page_template: values.subscription_page_template.trim(),
	home_page_template: values.home_page_template.trim(),
	v2ray_subscription_template: values.v2ray_subscription_template.trim(),
	v2ray_settings_template: values.v2ray_settings_template.trim(),
	happ_subscription_template: values.happ_subscription_template.trim(),
	incy_subscription_template: values.incy_subscription_template.trim(),
	singbox_subscription_template: values.singbox_subscription_template.trim(),
	singbox_settings_template: values.singbox_settings_template.trim(),
	mux_template: values.mux_template.trim(),
	subscription_path: values.subscription_path?.trim() || "sub",
	subscription_aliases: (values.subscription_aliases_text || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean),
	subscription_ports: parseSubscriptionPortsInput(
		values.subscription_ports_text || "",
	),
	client_routing_rules: (values.client_routing_rules || []).filter(
		(rule) => rule.pattern.trim() !== ""
	),
	subscription_placeholder_enabled: values.subscription_placeholder_enabled,
	subscription_placeholder_remark:
		values.subscription_placeholder_remark?.trim() || "disabled",
});

const buildAdminSubscriptionPayload = (
	admin: AdminSubscriptionSettings,
): AdminSubscriptionUpdatePayload => ({
	subscription_domain: admin.subscription_domain?.trim() || null,
	subscription_settings: cleanOverridePayload(
		admin.subscription_settings || {},
	),
});

const readSettingsHash = () => parseSettingsHash(window.location.hash);

export const IntegrationSettingsPage = () => {
	const { t } = useTranslation();
	const { colorMode } = useColorMode();
	const toast = useToast();
	const cardBg = useColorModeValue("white", "whiteAlpha.50");
	const subCardBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const fieldBg = useColorModeValue("white", "blackAlpha.200");
	const { userData, getUserIsSuccess } = useGetUser();
	const isSudoOrFull =
		userData?.role === "sudo" || userData?.role === "full_access";
	const canManageIntegrations =
		getUserIsSuccess &&
		(isSudoOrFull || Boolean(userData.permissions?.sections.integrations));
	const canReadMaintenance =
		getUserIsSuccess &&
		(userData.role === "full_access" ||
			(userData.role === "sudo" &&
				Boolean(userData.permissions?.sudo.maintenance)));
	const queryClient = useQueryClient();
	const [activeIntegrationTab, setActiveIntegrationTab] = useState(
		() => readSettingsHash().index,
	);

	const { data, isLoading, refetch } = useQuery(
		"telegram-settings",
		getTelegramSettings,
		{
			refetchOnWindowFocus: false,
			enabled: canManageIntegrations && activeIntegrationTab === 1,
		},
	);

	const {
		data: panelData,
		isLoading: isPanelLoading,
		refetch: refetchPanelSettings,
	} = useQuery<PanelSettingsResponse>("panel-settings", getPanelSettings, {
		refetchOnWindowFocus: false,
		enabled: canManageIntegrations && activeIntegrationTab === 0,
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
			enabled: canManageIntegrations && activeIntegrationTab === 0,
		},
	);

	const {
		data: phpMyAdminStatus,
		isLoading: isPHPMyAdminStatusLoading,
		refetch: refetchPHPMyAdminStatus,
	} = useQuery("phpmyadmin-status", getPHPMyAdminStatus, {
		refetchOnWindowFocus: false,
		enabled: canManageIntegrations && activeIntegrationTab === 0,
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
			enabled: canManageIntegrations && activeIntegrationTab >= 2,
		},
	);

	const maintenanceInfoQuery = useQuery<RuntimeMaintenanceInfo>(
		"maintenance-info",
		() => apiFetch<RuntimeMaintenanceInfo>("/maintenance/info"),
		{
			refetchOnWindowFocus: false,
			enabled: canReadMaintenance && activeIntegrationTab === 0,
		},
	);
	const hostActionsAvailable =
		(maintenanceInfoQuery.data?.panel?.mode ||
			maintenanceInfoQuery.data?.panel?.install_mode) === "binary";

	const [panelDefaultSubType, setPanelDefaultSubType] = useState<
		"username-key" | "key" | "token" | "key-username"
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
	const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
	const [adminSearchTerm, setAdminSearchTerm] = useState<string>("");
	const [adminSearchMatch, setAdminSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [isOpeningPHPMyAdminExternal, setOpeningPHPMyAdminExternal] =
		useState(false);
	const [certificateForm, setCertificateForm] = useState<{
		provider: "letsencrypt" | "zerossl" | "manual";
		email: string;
		domains: string;
		fullchain: string;
		privateKey: string;
	}>({
		provider: "letsencrypt",
		email: "",
		domains: "",
		fullchain: "",
		privateKey: "",
	});
	const [isCertificateDialogOpen, setCertificateDialogOpen] = useState(false);
	const [certificateSearch, setCertificateSearch] = useState("");
	const [certificateSearchMatch, setCertificateSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [certificateFilter, setCertificateFilter] = useState<
		"all" | "expiring_7d"
	>("all");
	const [renewingDomain, setRenewingDomain] = useState<string | null>(null);
	const [certificateAction, setCertificateAction] = useState<{
		type: "revoke" | "delete";
		domain: string;
	} | null>(null);
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

	const {
		register,
		control,
		getValues: getTelegramValues,
		reset,
		trigger: validateTelegram,
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
		getValues: getSubscriptionValues,
		reset: resetSubscription,
		setValue: setSubscriptionValue,
		trigger: validateSubscriptions,
		watch: watchSubscription,
		formState: { isDirty: isSubscriptionDirty },
	} = useForm<SubscriptionFormValues>({
		defaultValues: buildSubscriptionDefaults(subscriptionBundle?.settings),
	});

	const {
		fields: routingRules,
		append: appendRoutingRule,
		remove: removeRoutingRule,
		move: moveRoutingRule
	} = useFieldArray({
		control: subscriptionControl,
		name: "client_routing_rules",
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
	}, []);

	useEffect(() => {
		const { focus, tab } = readSettingsHash();
		if (
			activeIntegrationTab !== 1 ||
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
	}, [activeIntegrationTab, data, isLoading]);

	const saveAllMutation = useMutation(updateAllSettings, {
		onSuccess: (updated) => {
			if (updated.telegram) {
				reset(buildDefaultValues(updated.telegram));
				queryClient.setQueryData("telegram-settings", updated.telegram);
			}
			if (updated.panel) {
				setPanelDefaultSubType(
					updated.panel.default_subscription_type ?? "key",
				);
				queryClient.setQueryData("panel-settings", updated.panel);
			}
			if (updated.runtime) {
				setRuntimeSettingsForm(updated.runtime);
				queryClient.setQueryData("runtime-settings", updated.runtime);
			}
			if (updated.subscriptions) {
				resetSubscription(buildSubscriptionDefaults(updated.subscriptions));
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
					"subscription-settings",
					(prev) =>
						prev ? { ...prev, settings: updated.subscriptions! } : prev,
				);
			}
			if (updated.subscription_admins?.length) {
				setAdminOverrides((prev) => {
					const next = { ...prev };
					updated.subscription_admins?.forEach((admin) => {
						next[admin.id] = admin;
					});
					return next;
				});
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
					"subscription-settings",
					(prev) =>
						prev
							? {
									...prev,
									admins: prev.admins.map(
										(admin) =>
											updated.subscription_admins?.find(
												(saved) => saved.id === admin.id,
											) ?? admin,
									),
								}
							: prev,
				);
			}
			toast({
				title: t("settings.savedSuccess"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const telegramBackupMutation = useMutation(sendTelegramBackup, {
		onSuccess: (result) => {
			queryClient.invalidateQueries("telegram-settings");
			toast({
				title: t("settings.telegram.backupSendSuccess"),
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
				title: t("settings.telegram.testMessageSuccess"),
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
				generateSuccessMessage(t("phpmyadmin.enabled"), toast);
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
			generateSuccessMessage(t("phpmyadmin.disabled"), toast);
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const openPHPMyAdminExternal = async () => {
		try {
			setOpeningPHPMyAdminExternal(true);
			await getPHPMyAdminEmbedHTML(
				colorMode === "dark" ? "blueberry" : undefined,
			);
			window.open(
				"/api/settings/phpmyadmin/embed/index.php",
				"_blank",
				"noopener",
			);
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setOpeningPHPMyAdminExternal(false);
		}
	};

	const updateCertificateCache = (cert: SubscriptionCertificate) => {
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
					: prev,
		);
	};

	const issueCertificateMutation = useMutation(issueSubscriptionCertificate, {
		onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateDialogOpen(false);
			setCertificateForm((prev) => ({
				...prev,
				domains: "",
			}));
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
	const importCertificateMutation = useMutation(importSubscriptionCertificate, {
		onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateDialogOpen(false);
			setCertificateForm((prev) => ({
				...prev,
				domains: "",
				fullchain: "",
				privateKey: "",
			}));
			toast({
				title: t("settings.subscriptions.certificateImported"),
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
				updateCertificateCache(cert);
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
	const revokeCertificateMutation = useMutation(revokeSubscriptionCertificate, {
		onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateAction(null);
			toast({
				title: t("settings.subscriptions.certificateRevoked"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});
	const deleteCertificateMutation = useMutation(deleteSubscriptionCertificate, {
		onSuccess: (_, domain) => {
			queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(
				"subscription-settings",
				(prev) =>
					prev
						? {
								...prev,
								certificates: prev.certificates.filter(
									(cert) => cert.domain !== domain,
								),
							}
						: prev,
			);
			setCertificateAction(null);
			toast({
				title: t("settings.subscriptions.certificateDeleted"),
				status: "success",
				duration: 3000,
			});
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});
	const certificateServingMutation = useMutation(
		({ domain, enabled }: { domain: string; enabled: boolean }) =>
			updateSubscriptionCertificateServing(domain, enabled),
		{
			onSuccess: (cert) => {
				updateCertificateCache(cert);
				toast({
					title: t("settings.subscriptions.certificateServingUpdated"),
					status: "success",
					duration: 3000,
				});
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
		},
	);

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

	const handleIntegrationTabChange = (index: number) => {
		setActiveIntegrationTab(index);
		const key = integrationTabKeys[index] || "";
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}${key ? `#${key}` : ""}`,
		);
		window.dispatchEvent(new Event("hashchange"));
	};

	const adminOptions = Object.values(adminOverrides);
	const filteredAdmins =
		adminSearchTerm.trim().length === 0
			? adminOptions
			: adminOptions.filter((admin) =>
					matchesAnySearch(
						[admin.username, admin.subscription_domain],
						adminSearchTerm,
						adminSearchMatch,
					),
					);

	const runtimeDirty = Boolean(
		runtimeSettings &&
			JSON.stringify(runtimeSettingsForm) !== JSON.stringify(runtimeSettings),
	);
	const panelDirty = Boolean(
		panelData && panelDefaultSubType !== panelData.default_subscription_type,
	);
	const dirtyAdminUpdates = useMemo(
		() =>
			Object.values(adminOverrides).flatMap((admin) => {
				const original = subscriptionBundle?.admins.find(
					(item) => item.id === admin.id,
				);
				if (
					!original ||
					JSON.stringify(buildAdminSubscriptionPayload(admin)) ===
						JSON.stringify(buildAdminSubscriptionPayload(original))
				) {
					return [];
				}
				return [
					{
						id: admin.id,
						settings: buildAdminSubscriptionPayload(admin),
					},
				];
			}),
		[adminOverrides, subscriptionBundle?.admins],
	);
	const hasUnsavedChanges =
		runtimeDirty ||
		panelDirty ||
		isDirty ||
		isSubscriptionDirty ||
		dirtyAdminUpdates.length > 0;

	const handleSaveAll = async () => {
		const [telegramValid, subscriptionsValid] = await Promise.all([
			isDirty ? validateTelegram() : true,
			isSubscriptionDirty ? validateSubscriptions() : true,
		]);
		if (!telegramValid || !subscriptionsValid) return;

		const payload: AllSettingsUpdatePayload = {};
		if (panelDirty) {
			payload.panel = { default_subscription_type: panelDefaultSubType };
		}
		if (runtimeDirty) payload.runtime = runtimeSettingsForm;
		if (isDirty) payload.telegram = buildTelegramPayload(getTelegramValues());
		if (isSubscriptionDirty) {
			payload.subscriptions = buildSubscriptionPayload(getSubscriptionValues());
		}
		if (dirtyAdminUpdates.length) {
			payload.subscription_admins = dirtyAdminUpdates;
		}
		saveAllMutation.mutate(payload);
	};

	const handleIssueCertificate = () => {
		const domains = Array.from(
			new Set(
				certificateForm.domains
					.split(/[,\s]+/)
					.map((domain) => domain.trim())
					.filter(Boolean),
			),
		);
		if (certificateForm.provider === "manual") {
			if (
				domains.length !== 1 ||
				!certificateForm.fullchain.trim() ||
				!certificateForm.privateKey.trim()
			) {
				toast({
					title: t("settings.subscriptions.certificateMissingInput"),
					status: "warning",
					duration: 2500,
				});
				return;
			}
			importCertificateMutation.mutate({
				domain: domains[0],
				fullchain: certificateForm.fullchain,
				private_key: certificateForm.privateKey,
			});
			return;
		}
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
			provider: certificateForm.provider,
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
	const telegramBackupDisabledMessage = t("settings.telegram.backupBinaryOnly");
	const certificates = subscriptionBundle?.certificates ?? [];
	const filteredCertificates = useMemo(() => {
		const now = Date.now();
		const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;

		return certificates.filter((certificate) => {
			const matchesSearch = matchesAnySearch(
				[
					certificate.domain,
					...(certificate.alt_names || []),
					certificate.provider || "",
					certificate.status || "",
				],
				certificateSearch,
				certificateSearchMatch,
			);
			if (!matchesSearch || certificateFilter === "all") {
				return matchesSearch;
			}

			const expiresAt = certificate.not_after
				? new Date(certificate.not_after).getTime()
				: Number.NaN;
			return expiresAt >= now && expiresAt <= sevenDaysFromNow;
		});
	}, [
		certificateFilter,
		certificateSearch,
		certificateSearchMatch,
		certificates,
	]);
	const certificateColumns = useMemo<
		DataTableColumn<SubscriptionCertificate>[]
	>(
		() => [
			{
				id: "domain",
				header: t("settings.subscriptions.domain"),
				isPrimary: true,
				priority: "primary",
				mobilePriority: 0,
				cell: (certificate) => (
					<Stack spacing={0} minW={0} align="start">
						<Text fontWeight="semibold" dir="ltr" noOfLines={1}>
							{certificate.domain}
						</Text>
						{certificate.alt_names?.length ? (
							<Text
								fontSize="xs"
								color="panel.textMuted"
								dir="ltr"
								noOfLines={1}
							>
								SAN: {certificate.alt_names.join(", ")}
							</Text>
						) : null}
					</Stack>
				),
			},
			{
				id: "status",
				header: t("status"),
				priority: "high",
				mobilePriority: 1,
				mobileMetaLabel: t("status"),
				cell: (certificate) => (
					<HStack spacing={1.5} flexWrap="wrap">
						<Badge
							colorScheme={
								certificate.status === "active"
									? "green"
									: certificate.status === "expiring"
										? "orange"
										: "red"
							}
						>
							{certificate.status}
						</Badge>
						<Badge colorScheme="blue">
							{certificate.provider || "unknown"}
						</Badge>
					</HStack>
				),
			},
			{
				id: "expires",
				header: t("settings.subscriptions.expiresAt"),
				priority: "high",
				mobilePriority: 2,
				mobileMetaLabel: t("settings.subscriptions.expiresAt"),
				cell: (certificate) => (
					<Text fontSize="sm">
						{certificate.not_after
							? new Date(certificate.not_after).toLocaleString()
							: t("settings.subscriptions.never")}
					</Text>
				),
			},
			{
				id: "updated",
				header: t("settings.subscriptions.lastRenewed"),
				priority: "low",
				hideBelow: "xl",
				mobileMetaLabel: t("settings.subscriptions.lastRenewed"),
				cell: (certificate) => (
					<Stack spacing={0}>
						<Text fontSize="sm">
							{certificate.last_renewed_at
								? new Date(certificate.last_renewed_at).toLocaleString()
								: t("settings.subscriptions.never")}
						</Text>
						<Text fontSize="xs" color="panel.textMuted">
							{t("settings.subscriptions.lastIssued")}:{" "}
							{certificate.last_issued_at
								? new Date(certificate.last_issued_at).toLocaleString()
								: t("settings.subscriptions.never")}
						</Text>
					</Stack>
				),
			},
			{
				id: "serving",
				header: t("settings.subscriptions.serveTLS"),
				priority: "high",
				mobilePriority: 3,
				mobileMetaLabel: t("settings.subscriptions.serveTLS"),
				cell: (certificate) => (
					<HStack spacing={2}>
						<Switch
							aria-label={t("settings.subscriptions.serveTLS")}
							isChecked={certificate.serve_tls !== false}
							isDisabled={
								certificateServingMutation.isLoading ||
								(certificate.serve_tls === false &&
									certificate.status !== "active" &&
									certificate.status !== "expiring")
							}
							onChange={(event) =>
								certificateServingMutation.mutate({
									domain: certificate.domain,
									enabled: event.target.checked,
								})
							}
						/>
						{certificate.auto_renew ? (
							<Badge colorScheme="teal">
								{t("settings.subscriptions.autoRenew")}
							</Badge>
						) : null}
					</HStack>
				),
			},
		],
		[certificateServingMutation, t],
	);
	const certificateRowActions = (
		certificate: SubscriptionCertificate,
	): DataTableRowAction<SubscriptionCertificate>[] => {
		const actions: DataTableRowAction<SubscriptionCertificate>[] = [];
		if (certificate.auto_renew && certificate.status !== "revoked") {
			actions.push({
				id: "renew",
				label: t("settings.subscriptions.renewAction"),
				icon: <ArrowPathIcon width={16} height={16} />,
				onClick: () => handleRenewCertificate(certificate.domain),
				isDisabled:
					renewCertificateMutation.isLoading &&
					renewingDomain === certificate.domain,
			});
		}
		if (certificate.provider !== "manual" && certificate.status !== "revoked") {
			actions.push({
				id: "revoke",
				label: t("settings.subscriptions.revokeAction"),
				icon: <NoSymbolIcon width={16} height={16} />,
				onClick: () =>
					setCertificateAction({ type: "revoke", domain: certificate.domain }),
				isDanger: true,
			});
		}
		actions.push({
			id: "delete",
			label: t("delete"),
			icon: <TrashIcon width={16} height={16} />,
			onClick: () =>
				setCertificateAction({ type: "delete", domain: certificate.domain }),
			isDanger: true,
		});
		return actions;
	};
	const isCertificateMutationLoading =
		issueCertificateMutation.isLoading || importCertificateMutation.isLoading;
	const certificateManager = (
		<Stack spacing={3}>
			<ResourceListCard
				title={
					<Box>
						<Heading size="sm" mb={1}>
							{t("settings.subscriptions.certificateTitle")}
						</Heading>
						<Text fontSize="sm" color="panel.textMuted">
							{t("settings.subscriptions.certificateDescription")}
						</Text>
					</Box>
				}
				summaryItems={[
					{ label: t("total"), value: certificates.length },
					{
						label: t("active"),
						value: certificates.filter(
							(certificate) => certificate.status === "active",
						).length,
						colorScheme: "green",
					},
					{
						label: t("settings.subscriptions.serveTLS"),
						value: certificates.filter(
							(certificate) => certificate.serve_tls !== false,
						).length,
						colorScheme: "blue",
					},
				]}
				actions={
					<Button
						colorScheme="primary"
						leftIcon={<PlusIcon width={16} height={16} />}
						onClick={() => setCertificateDialogOpen(true)}
					>
						{t("settings.subscriptions.getNewSSL")}
					</Button>
				}
			>
				<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
					<SearchInput
							value={certificateSearch}
							onChange={(event) => setCertificateSearch(event.target.value)}
						placeholder={t("settings.subscriptions.searchCertificates")}
						matchOptions={certificateSearchMatch}
						onMatchOptionsChange={setCertificateSearchMatch}
						onClear={() => setCertificateSearch("")}
						/>
					<Select
						showSearch={false}
						value={certificateFilter}
						onChange={(event) =>
							setCertificateFilter(event.target.value as "all" | "expiring_7d")
						}
					>
						<option value="all">
							{t("settings.subscriptions.allCertificates")}
						</option>
						<option value="expiring_7d">
							{t("settings.subscriptions.expiringInSevenDays")}
						</option>
					</Select>
				</SimpleGrid>
			</ResourceListCard>
			<DataTable
					ariaLabel={t("settings.subscriptions.certificateList")}
					data={filteredCertificates}
					columns={certificateColumns}
					getRowId={(certificate) => certificate.domain}
					isLoading={isSubscriptionLoading}
					emptyState={
						<Text color="panel.textMuted">
							{certificateSearch || certificateFilter !== "all"
								? t("settings.subscriptions.noMatchingCertificates")
								: t("settings.subscriptions.noCertificates")}
						</Text>
					}
					rowActions={certificateRowActions}
					actionsDisplay="menu"
					actionsPlacement="end"
					actionsColumnWidth="60px"
					showActionsOnHover
					mobileBreakpoint="md"
			/>
		</Stack>
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
					borderRadius: "2xl",
					p: { base: 4, md: 5 },
					boxShadow: "sm",
					overflow: "hidden",
				},
				".master-settings-subcard": {
					bg: subCardBg,
					border: "1px solid",
					borderColor,
					borderRadius: "xl",
					p: { base: 3, md: 4 },
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
					borderRadius: "xl",
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
						borderRadius: "lg",
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
			<Flex
				align={{ base: "stretch", md: "center" }}
				justify="space-between"
				flexDirection={{ base: "column", md: "row" }}
				gap={3}
			>
				<TabSystem
					className="master-settings-tabs"
					overflowX="auto"
					overflowY="hidden"
					maxW="full"
					flex="1"
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
							value: "telegram",
							isActive: activeIntegrationTab === 1,
							onClick: () => handleIntegrationTabChange(1),
							label: t("settings.telegram"),
						},
						{
							value: "subscriptions",
							isActive: activeIntegrationTab === 2,
							onClick: () => handleIntegrationTabChange(2),
							label: t("settings.subscriptions.tabTitle"),
						},
						{
							value: "ssl",
							isActive: activeIntegrationTab === 3,
							onClick: () => handleIntegrationTabChange(3),
							label: t("settings.ssl.tabTitle"),
						},
					]}
				/>
				<Button
					flexShrink={0}
					alignSelf={{ base: "flex-end", md: "center" }}
					colorScheme="primary"
					leftIcon={<SaveIcon />}
					onClick={handleSaveAll}
					isLoading={saveAllMutation.isLoading}
					isDisabled={!hasUnsavedChanges || saveAllMutation.isLoading}
				>
					{t("settings.save")}
				</Button>
			</Flex>
			{activeIntegrationTab === 0 && (
				<Box px={{ base: 0, md: 2 }} mt={3}>
				{isPanelLoading && panelData === undefined ? (
					<Flex align="center" justify="center" py={12}>
						<Spinner size="lg" />
					</Flex>
				) : (
					<Stack spacing={6} align="stretch">
						<Box className="master-settings-card" borderRadius="2xl">
							<Flex
								justify="space-between"
								align={{ base: "flex-start", md: "center" }}
								gap={4}
								flexDirection={{ base: "column", md: "row" }}
								mb={4}
							>
								<Box>
									<Heading size="sm" mb={1}>
										{t("settings.runtime.title")}
									</Heading>
									<Text fontSize="sm" color="gray.500">
										{t("settings.runtime.description")}
									</Text>
								</Box>
								<Button
									variant="outline"
									size="sm"
									leftIcon={<ArrowPathIcon width={16} height={16} />}
									onClick={() => {
										void refetchRuntimeSettings();
										void refetchPanelSettings();
									}}
									isLoading={isRuntimeSettingsLoading || isPanelLoading}
								>
									{t("refresh")}
								</Button>
							</Flex>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.panel.defaultSubscriptionType")}
									</FormLabel>
									<Select
										size="sm"
										value={panelDefaultSubType}
										onChange={(event) =>
											setPanelDefaultSubType(
												event.target.value as
													| "username-key"
													| "key"
													| "token"
													| "key-username",
											)
										}
										isDisabled={saveAllMutation.isLoading || isPanelLoading}
									>
										<option value="username-key">
											{t("settings.panel.link.usernameKey")}
										</option>
										<option value="key">
											{t("settings.panel.link.keyOnly")}
										</option>
										<option value="key-username">
											{t("settings.panel.link.keyUsername")}
										</option>
										<option value="token">
											{t("settings.panel.link.token")}
										</option>
									</Select>
									<FormHelperText>
										{t("settings.panel.defaultSubscriptionTypeDescription")}
									</FormHelperText>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.runtime.dashboardPath")}
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
										isDisabled={saveAllMutation.isLoading}
									/>
									<FormHelperText>
										{t("settings.runtime.dashboardPathHint")}
									</FormHelperText>
								</FormControl>
								<TelegramSwitchRow
									title={t("settings.runtime.subscriptionReadOnlyTitle")}
									description={t("settings.runtime.subscriptionReadOnlyHint")}
									control={
										<Switch
											isChecked={runtimeSettingsForm.subscription_read_only}
											onChange={(event) =>
												setRuntimeSettingsForm((prev) => ({
													...prev,
													subscription_read_only: event.target.checked,
												}))
											}
											isDisabled={saveAllMutation.isLoading}
										/>
									}
								/>
								<TelegramSwitchRow
									title={t("settings.runtime.recordNodeUsage")}
									description={t("settings.runtime.recordNodeUsageHint")}
									control={
										<Switch
											isChecked={runtimeSettingsForm.record_node_usage}
											onChange={(event) =>
												setRuntimeSettingsForm((prev) => ({
													...prev,
													record_node_usage: event.target.checked,
												}))
											}
											isDisabled={saveAllMutation.isLoading}
										/>
									}
								/>
								<TelegramSwitchRow
									title={t("settings.runtime.recordNodeUserUsages")}
									description={t("settings.runtime.recordNodeUserUsagesHint")}
									control={
										<Switch
											isChecked={runtimeSettingsForm.record_node_user_usages}
											onChange={(event) =>
												setRuntimeSettingsForm((prev) => ({
													...prev,
													record_node_user_usages: event.target.checked,
												}))
											}
											isDisabled={saveAllMutation.isLoading}
										/>
									}
								/>
								<TelegramSwitchRow
									title={t("settings.runtime.apiDocs")}
									description={t("settings.runtime.apiDocsHint")}
									control={
										<Switch
											isChecked={runtimeSettingsForm.api_docs_enabled}
											onChange={(event) =>
												setRuntimeSettingsForm((prev) => ({
													...prev,
													api_docs_enabled: event.target.checked,
												}))
											}
											isDisabled={saveAllMutation.isLoading}
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
												{t("phpmyadmin.title")}
											</Heading>
											<Text fontSize="sm" color="gray.500">
												{t("phpmyadmin.settingsHint")}
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
												{t("phpmyadmin.openPanel")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={openPHPMyAdminExternal}
												isLoading={isOpeningPHPMyAdminExternal}
												isDisabled={
													!runtimeSettingsForm.phpmyadmin_enabled ||
													!phpMyAdminSupported
												}
											>
												{t("phpmyadmin.openExternal")}
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
													? t("phpmyadmin.disableAction")
													: t("phpmyadmin.enableAction")}
											</Button>
										</HStack>
									</Flex>
									{!phpMyAdminSupported ? (
										<Alert status="warning" borderRadius="md" mb={4}>
											<AlertIcon />
											{t("phpmyadmin.sqliteDisabled")}
										</Alert>
									) : null}
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<FormControl>
											<FormLabel fontSize="sm">{t("path")}</FormLabel>
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
												{t("phpmyadmin.panelOnlyHint")}
											</FormHelperText>
										</FormControl>
										<FormControl>
											<FormLabel fontSize="sm">
												{t("phpmyadmin.loginMode")}
											</FormLabel>
											<Select
												value={runtimeSettingsForm.phpmyadmin_login_mode}
												onChange={(event) =>
													setRuntimeSettingsForm((prev) => ({
														...prev,
														phpmyadmin_login_mode: event.target.value as
															| "rebecca"
															| "custom",
													}))
												}
												isDisabled={
													phpMyAdminEnableMutation.isLoading ||
													phpMyAdminDisableMutation.isLoading
												}
											>
												<option value="rebecca">
													{t("phpmyadmin.loginModeRebecca")}
												</option>
												<option value="custom">
													{t("phpmyadmin.loginModeCustom")}
												</option>
											</Select>
											<FormHelperText>
												{t("phpmyadmin.loginModeHint")}
											</FormHelperText>
										</FormControl>
										<FormControl
											isDisabled={
												runtimeSettingsForm.phpmyadmin_login_mode !==
													"custom" ||
												phpMyAdminEnableMutation.isLoading ||
												phpMyAdminDisableMutation.isLoading
											}
										>
											<FormLabel fontSize="sm">
												{t("phpmyadmin.username")}
											</FormLabel>
											<Input
												value={runtimeSettingsForm.phpmyadmin_username}
												placeholder="root"
												onChange={(event) =>
													setRuntimeSettingsForm((prev) => ({
														...prev,
														phpmyadmin_username: event.target.value,
													}))
												}
											/>
										</FormControl>
										<FormControl
											isDisabled={
												runtimeSettingsForm.phpmyadmin_login_mode !==
													"custom" ||
												phpMyAdminEnableMutation.isLoading ||
												phpMyAdminDisableMutation.isLoading
											}
										>
											<FormLabel fontSize="sm">
												{t("phpmyadmin.password")}
											</FormLabel>
											<Input
												type="password"
												value={runtimeSettingsForm.phpmyadmin_password}
												placeholder={t("phpmyadmin.passwordPlaceholder")}
												onChange={(event) =>
													setRuntimeSettingsForm((prev) => ({
														...prev,
														phpmyadmin_password: event.target.value,
													}))
												}
											/>
										</FormControl>
									</SimpleGrid>
								</Box>
							</SimpleGrid>
						</Box>
					</Stack>
				)}
				</Box>
			)}
			{activeIntegrationTab === 3 && (
				<Box px={{ base: 0, md: 2 }} mt={3}>
				{isSubscriptionLoading && !subscriptionBundle ? (
					<Flex align="center" justify="center" py={12}>
						<Spinner size="lg" />
					</Flex>
				) : (
					certificateManager
				)}
				</Box>
			)}
			{activeIntegrationTab === 1 && (
				<Box px={{ base: 0, md: 2 }} mt={3}>
				{isLoading && !data ? (
					<Flex align="center" justify="center" py={12}>
						<Spinner size="lg" />
					</Flex>
				) : (
					<form
						className="telegram-settings-form"
						onSubmit={(event) => event.preventDefault()}
					>
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
											<FormLabel>{t("settings.telegram.apiToken")}</FormLabel>
											<Input
												placeholder="123456:ABC"
												{...register("api_token")}
											/>
										</FormControl>
										<FormControl>
											<FormLabel>{t("settings.telegram.proxyUrl")}</FormLabel>
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
											<FormLabel>{t("settings.telegram.logsChatId")}</FormLabel>
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
											description={t("settings.telegram.logsChatIsForumHint")}
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
											{t("settings.telegram.testMessage")}
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
											title={t("settings.telegram.backupTitle")}
											description={t("settings.telegram.backupDescription")}
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
												{t("settings.telegram.backupChatId")}
											</FormLabel>
											<Input
												placeholder="-100123456789"
												{...register("backup_chat_id")}
											/>
											<FormHelperText>
												{t("settings.telegram.backupChatIdHint")}
											</FormHelperText>
										</FormControl>
										<TelegramSwitchRow
											title={t("settings.telegram.backupChatIsForum")}
											description={t("settings.telegram.backupChatIsForumHint")}
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
												{t("settings.telegram.backupScope")}
											</FormLabel>
											<Controller
												control={control}
												name="backup_scope"
												render={({ field }) => (
													<Select {...field}>
														<option value="database">
															{t("settings.telegram.backupScopeDatabase")}
														</option>
														<option value="full">
															{t("settings.telegram.backupScopeFull")}
														</option>
													</Select>
												)}
											/>
										</FormControl>
										<FormControl>
											<FormLabel>
												{t("settings.telegram.backupIntervalValue")}
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
												{t("settings.telegram.backupIntervalUnit")}
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
															{t("settings.telegram.backupIntervalMinutes")}
														</option>
														<option value="hours">
															{t("settings.telegram.backupIntervalHours")}
														</option>
														<option value="days">
															{t("settings.telegram.backupIntervalDays")}
														</option>
													</Select>
												)}
											/>
										</FormControl>
									</SimpleGrid>
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mt={3}>
										<Text fontSize="xs" color="gray.500">
											{t("settings.telegram.backupLastSent")}:{" "}
											{data?.backup_last_sent_at || "-"}
										</Text>
										{data?.backup_last_error && (
											<Text fontSize="xs" color="red.300">
												{t("settings.telegram.backupLastError")}:{" "}
												{data.backup_last_error}
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
											{t("settings.telegram.backupSendNow")}
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
												{t("settings.telegram.botCommandsTitle")}
											</Heading>
										</Box>
										<Badge colorScheme="yellow">
											{t("settings.tabs.comingSoon")}
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
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
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
											<Box className="master-settings-subcard" key={group.key}>
												<Text fontWeight="semibold" mb={3}>
													{t(group.titleKey, group.defaultTitle)}
												</Text>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
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
									isDisabled={saveAllMutation.isLoading}
								>
									{t("refresh")}
								</Button>
							</Flex>
						</VStack>
					</form>
				)}
				</Box>
			)}
			{activeIntegrationTab === 2 && (
				<Box px={{ base: 0, md: 2 }} mt={3}>
				{isSubscriptionLoading && !subscriptionBundle ? (
					<Flex align="center" justify="center" py={12}>
						<Spinner size="lg" />
					</Flex>
				) : (
					<form onSubmit={(event) => event.preventDefault()}>
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
											isDisabled={saveAllMutation.isLoading}
										>
											{t("refresh")}
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
											{...subscriptionRegister("custom_templates_directory")}
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
											{...subscriptionRegister("subscription_profile_title")}
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
											{...subscriptionRegister("subscription_update_interval")}
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
												{...subscriptionRegister("subscription_page_template")}
											/>
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
										</HStack>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.clashTemplate")}
										</FormLabel>
										<HStack spacing={2} align="stretch">
											<Input
												flex="1"
												{...subscriptionRegister("clash_subscription_template")}
											/>
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
										</HStack>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.v2rayTemplate")}
										</FormLabel>
										<HStack spacing={2} align="stretch">
											<Input
												flex="1"
												{...subscriptionRegister("v2ray_subscription_template")}
											/>
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
										</HStack>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.happTemplate")}
										</FormLabel>
										<HStack spacing={2} align="stretch">
											<Input
												flex="1"
												{...subscriptionRegister("happ_subscription_template")}
											/>
										</HStack>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.incyTemplate")}
										</FormLabel>
										<HStack spacing={2} align="stretch">
											<Input
												flex="1"
												{...subscriptionRegister("incy_subscription_template")}
											/>
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
										</HStack>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.singboxSettingsTemplate")}
										</FormLabel>
										<HStack spacing={2} align="stretch">
											<Input
												flex="1"
												{...subscriptionRegister("singbox_settings_template")}
											/>
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
										</HStack>
									</FormControl>
									<Box gridColumn={{ base: "1 / -1", md: "1 / -1" }}>
										<Divider mb={3} />
										<Text fontSize="sm" fontWeight="semibold">
											{t("settings.subscriptions.routingSection")}
										</Text>
									</Box>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.subscriptionAliases")}
										</FormLabel>
										<Textarea
											placeholder="/mypath/\n/test/\n/api/v1/client/subscribe?token=\n/api/v1/client/subscribe?key="
											rows={4}
											{...subscriptionRegister("subscription_aliases_text")}
										/>
										<FormHelperText>
											{t("settings.subscriptions.aliasesHint")}
										</FormHelperText>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("settings.subscriptions.subscriptionPorts")}
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
											{t("settings.subscriptions.subscriptionPortsHint")}
											{parsedSubscriptionPorts.length > 0
												? ` ${t("settings.subscriptions.activePorts")}: ${parsedSubscriptionPorts.join(", ")}`
												: ""}
										</FormHelperText>
									</FormControl>
								</SimpleGrid>

								<Box mt={6} gridColumn={{ base: "1 / -1", md: "1 / -1" }}>
									<Divider mb={4} />
									<Flex justify="space-between" align={{ base: "flex-start", md: "center" }} mb={4} flexDirection={{ base: "column", sm: "row" }} gap={2}>
										<Box>
											<Heading size="sm" mb={1}>{t("settings.subscriptions.routingRulesTitle")}</Heading>
											<Text fontSize="sm" color="gray.500">{t("settings.subscriptions.routingRulesDesc")}</Text>
										</Box>
										<Button
											size="xs"
											variant="outline"
											colorScheme="orange"
											leftIcon={<ArrowPathIcon width={14} height={14} />}
											onClick={() => {
												setSubscriptionValue("client_routing_rules", DEFAULT_CLIENT_ROUTING_RULES, {
													shouldDirty: true,
													shouldValidate: true,
												});
											}}
										>
											{t("settings.subscriptions.resetToDefault")}
										</Button>
									</Flex>

									<VStack spacing={3} align="stretch">
										<Flex fontWeight="semibold" fontSize="sm" px={2} display={{ base: "none", md: "flex" }}>
											<Box flex="1">{t("settings.subscriptions.rulePattern")}</Box>
											<Box w="220px" ml={4}>{t("settings.subscriptions.ruleResult")}</Box>
											<Box w="100px" ml={4}></Box>
										</Flex>
										
										{routingRules.map((field, index) => (
											<Flex key={field.id} gap={3} align={{ base: "stretch", md: "center" }} flexDirection={{ base: "column", md: "row" }} bg={fieldBg} p={2} borderRadius="md" borderWidth="1px">
												<Input 
													flex="1" 
													placeholder="^([Cc]lash|[Ss]tash)" 
													fontFamily="mono" 
													fontSize="sm"
													{...subscriptionRegister(`client_routing_rules.${index}.pattern` as const)} 
												/>
												
												<Controller
													control={subscriptionControl}
													name={`client_routing_rules.${index}.result` as const}
													render={({ field: controllerField }) => (
														<Select
															{...controllerField}
															w={{ base: "full", md: "220px" }}
															showSearch={false}
														>
															{CLIENT_OPTIONS.map((opt) => (
																<option key={opt} value={opt}>
																	{opt}
																</option>
															))}
														</Select>
													)}
												/>

												<HStack spacing={1} justify="flex-end">
													<IconButton
														aria-label="Move Up"
														icon={<ChevronUpIcon width={16} />}
														size="sm"
														variant="ghost"
														isDisabled={index === 0}
														onClick={() => moveRoutingRule(index, index - 1)}
													/>
													<IconButton
														aria-label="Move Down"
														icon={<HeroChevronDownIcon width={16} />}
														size="sm"
														variant="ghost"
														isDisabled={index === routingRules.length - 1}
														onClick={() => moveRoutingRule(index, index + 1)}
													/>
													<IconButton
														aria-label="Delete"
														icon={<TrashIcon width={16} />}
														size="sm"
														colorScheme="red"
														variant="ghost"
														onClick={() => removeRoutingRule(index)}
													/>
												</HStack>
											</Flex>
										))}
										
										<Button 
											alignSelf="flex-start" 
											leftIcon={<PlusIcon width={16} />} 
											size="sm" 
											variant="outline" 
											onClick={() => appendRoutingRule({ pattern: "", result: "v2ray" })}
										>
											{t("settings.subscriptions.addRule")}
										</Button>
									</VStack>
								</Box>
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
														{selectedAdminId && adminOverrides[selectedAdminId]
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
														<SearchInput
																textAlign="start"
																placeholder={t(
																	"settings.subscriptions.searchAdmin",
																)}
																value={adminSearchTerm}
																onChange={(event) =>
																	setAdminSearchTerm(event.target.value)
																}
															matchOptions={adminSearchMatch}
															onMatchOptionsChange={setAdminSearchMatch}
															onClear={() => setAdminSearchTerm("")}
															/>
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
													const settings = admin.subscription_settings || {};
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
																		onClick={() => handleAdminReset(admin.id)}
																		isDisabled={saveAllMutation.isLoading}
																	>
																		{t("reset")}
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
																		{t("settings.subscriptions.adminDomain")}
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
																			settings.custom_templates_directory ?? ""
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
																		{t("settings.subscriptions.inheritHint")}
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
																		{t("settings.subscriptions.profileTitle")}
																	</FormLabel>
																	<Input
																		placeholder={
																			subscriptionBundle?.settings
																				.subscription_profile_title || ""
																		}
																		value={
																			settings.subscription_profile_title ?? ""
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
																			settings.subscription_support_url ?? ""
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
																		{t("settings.subscriptions.updateInterval")}
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
																			value={settings.home_page_template ?? ""}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"home_page_template",
																					event.target.value,
																				)
																			}
																		/>
																	</HStack>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.subscriptions.clashTemplate")}
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
																				settings.clash_settings_template ?? ""
																			}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"clash_settings_template",
																					event.target.value,
																				)
																			}
																		/>
																	</HStack>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.subscriptions.v2rayTemplate")}
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
																				settings.v2ray_settings_template ?? ""
																			}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"v2ray_settings_template",
																					event.target.value,
																				)
																			}
																		/>
																	</HStack>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.subscriptions.happTemplate")}
																	</FormLabel>
																	<HStack spacing={2} align="stretch">
																		<Input
																			flex="1"
																			placeholder={
																				subscriptionBundle?.settings
																					.happ_subscription_template || ""
																			}
																			value={
																				settings.happ_subscription_template ??
																				""
																			}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"happ_subscription_template",
																					event.target.value,
																				)
																			}
																		/>
																	</HStack>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.subscriptions.incyTemplate")}
																	</FormLabel>
																	<HStack spacing={2} align="stretch">
																		<Input
																			flex="1"
																			placeholder={
																				subscriptionBundle?.settings
																					.incy_subscription_template || ""
																			}
																			value={
																				settings.incy_subscription_template ??
																				""
																			}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"incy_subscription_template",
																					event.target.value,
																				)
																			}
																		/>
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
																					.singbox_subscription_template || ""
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
																				settings.singbox_settings_template ?? ""
																			}
																			onChange={(event) =>
																				handleAdminTemplateChange(
																					admin.id,
																					"singbox_settings_template",
																					event.target.value,
																				)
																			}
																		/>
																	</HStack>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("settings.subscriptions.muxTemplate")}
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
																	</HStack>
																</FormControl>
															</SimpleGrid>

															<Divider my={4} />

															<Flex
																className="master-settings-action-row"
																mt={4}
															>
																<Button
																	variant="outline"
																	leftIcon={<RefreshIcon />}
																	onClick={() => handleAdminReset(admin.id)}
																	isDisabled={saveAllMutation.isLoading}
																>
																	{t("settings.subscriptions.resetOverrides")}
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
						</VStack>
					</form>
				)}
				</Box>
			)}
			<Modal
				isOpen={isCertificateDialogOpen}
				onClose={() => setCertificateDialogOpen(false)}
				size={certificateForm.provider === "manual" ? "3xl" : "xl"}
				isCentered
				scrollBehavior="inside"
				closeOnOverlayClick={!isCertificateMutationLoading}
			>
				<ModalOverlay bg="blackAlpha.500" />
				<ModalContent
					as="form"
					onSubmit={(event) => {
						event.preventDefault();
						handleIssueCertificate();
					}}
					bg={cardBg}
					borderWidth="1px"
					borderColor={borderColor}
					borderRadius="2xl"
					boxShadow="2xl"
					overflow="hidden"
					mx={{ base: 4, sm: 0 }}
				>
					<ModalHeader px={6} pt={6} pb={2}>
						{t("settings.subscriptions.getNewSSL")}
					</ModalHeader>
					<ModalCloseButton isDisabled={isCertificateMutationLoading} />
					<ModalBody px={6} pb={6}>
						<VStack align="stretch" spacing={4}>
							<Alert status="info" variant="left-accent" borderRadius="lg">
								<AlertIcon />
								<Text fontSize="sm">
									{t("settings.subscriptions.certificateSNIHint")}
								</Text>
							</Alert>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<FormControl>
									<FormLabel>
										{t("settings.subscriptions.certificateProvider")}
									</FormLabel>
									<Select
										value={certificateForm.provider}
										showSearch={false}
										onChange={(event) =>
											setCertificateForm((previous) => ({
												...previous,
												provider: event.target.value as
													| "letsencrypt"
													| "zerossl"
													| "manual",
											}))
										}
									>
										<option value="letsencrypt">Certbot / Let's Encrypt</option>
										<option value="zerossl">ZeroSSL</option>
										<option value="manual">
											{t("settings.subscriptions.manualCertificate")}
										</option>
									</Select>
									{certificateForm.provider === "zerossl" ? (
										<FormHelperText>
											{t("settings.subscriptions.zeroSSLNoKeyHint")}
										</FormHelperText>
									) : null}
								</FormControl>
								{certificateForm.provider !== "manual" ? (
									<FormControl isRequired>
										<FormLabel>{t("settings.subscriptions.email")}</FormLabel>
										<Input
											type="email"
											placeholder="admin@example.com"
											value={certificateForm.email}
											onChange={(event) =>
												setCertificateForm((previous) => ({
													...previous,
													email: event.target.value,
												}))
											}
										/>
									</FormControl>
								) : null}
								<FormControl isRequired>
									<FormLabel>
										{certificateForm.provider === "manual"
											? t("settings.subscriptions.domain")
											: t("settings.subscriptions.domains")}
									</FormLabel>
									<Input
										placeholder={
											certificateForm.provider === "manual"
												? "example.com"
												: "example.com,sub.example.com"
										}
										value={certificateForm.domains}
										onChange={(event) =>
											setCertificateForm((previous) => ({
												...previous,
												domains: event.target.value,
											}))
										}
									/>
									{certificateForm.provider !== "manual" ? (
										<FormHelperText>
											{t("settings.subscriptions.domainsHint")}
										</FormHelperText>
									) : null}
								</FormControl>
							</SimpleGrid>
							{certificateForm.provider === "manual" ? (
								<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
									<FormControl isRequired>
										<FormLabel>fullchain.pem</FormLabel>
										<Textarea
											dir="ltr"
											fontFamily="mono"
											minH="180px"
											value={certificateForm.fullchain}
											onChange={(event) =>
												setCertificateForm((previous) => ({
													...previous,
													fullchain: event.target.value,
												}))
											}
										/>
									</FormControl>
									<FormControl isRequired>
										<FormLabel>privkey.pem</FormLabel>
										<Textarea
											dir="ltr"
											fontFamily="mono"
											minH="180px"
											value={certificateForm.privateKey}
											onChange={(event) =>
												setCertificateForm((previous) => ({
													...previous,
													privateKey: event.target.value,
												}))
											}
										/>
									</FormControl>
								</SimpleGrid>
							) : null}
						</VStack>
					</ModalBody>
					<ModalFooter gap={2} borderTopWidth="1px" borderColor={borderColor}>
						<Button
							variant="ghost"
							onClick={() => setCertificateDialogOpen(false)}
							isDisabled={isCertificateMutationLoading}
						>
							{t("cancel")}
						</Button>
						<Button
							type="submit"
							colorScheme="primary"
							isLoading={isCertificateMutationLoading}
						>
							{certificateForm.provider === "manual"
								? t("settings.subscriptions.importAction")
								: t("settings.subscriptions.issueAction")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
			<ConfirmDialog
				isOpen={Boolean(certificateAction)}
				onClose={() => setCertificateAction(null)}
				onConfirm={() => {
					if (!certificateAction) return;
					if (certificateAction.type === "revoke") {
						revokeCertificateMutation.mutate(certificateAction.domain);
						return;
					}
					deleteCertificateMutation.mutate(certificateAction.domain);
				}}
				title={
					certificateAction?.type === "revoke"
						? t("settings.subscriptions.revokeTitle")
						: t("settings.subscriptions.deleteTitle")
				}
				description={t("settings.subscriptions.certificateActionWarning")}
				confirmLabel={
					certificateAction?.type === "revoke"
						? t("settings.subscriptions.revokeAction")
						: t("delete")
				}
				colorScheme={certificateAction?.type === "revoke" ? "orange" : "red"}
				isLoading={
					revokeCertificateMutation.isLoading ||
					deleteCertificateMutation.isLoading
				}
			/>
		</Box>
	);
};
