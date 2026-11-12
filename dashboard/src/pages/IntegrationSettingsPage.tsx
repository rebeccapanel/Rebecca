import { toneClass } from "lib/tone";
import { Field } from "components/ui/field";
import { Badge } from "components/ui/badge";
import { Switch } from "components/ui/switch";
import { Button } from "components/ui/button";
import { Spinner } from "components/ui/spinner";
import { Alert } from "components/ui/alert";
import { Textarea } from "components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import type { SortingState } from "@tanstack/react-table";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";

import { useColorMode } from "lib/color-mode";

import { cn } from "lib/cn";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { SettingsCard } from "components/ui/settings-card";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { SegmentedControl } from "components/ui/segmented-control";
import { ToggleRow } from "components/ui/toggle-row";
import { ListCard } from "components/ui/list-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { ShieldCheck, RefreshCw, Upload, ChevronDown as HeroChevronDownIcon, ChevronUp, Ban, Send, Plus, Trash2 } from "lucide-react";
import { NumberField } from "components/ui/number-field";
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
import { useNodesQuery } from "contexts/NodesContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useLocation } from "react-router-dom";
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
	issueNodeSubscriptionCertificate,
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
	PageLoadingSkeleton,
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
	<Field className="telegram-switch-row">
		<div className="flex items-center justify-between gap-2 md:gap-3 telegram-switch-row__inner">
			<div className="min-w-0! flex-1">
				<p className="telegram-switch-row__title">{title}</p>
				{description ? (
					<p className="telegram-switch-row__description">
						{description}
					</p>
				) : null}
			</div>
			<div className="shrink-0 telegram-switch-row__control">
				{control}
			</div>
		</div>
	</Field>
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
	user_speed_limit_enabled: true,
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

const RefreshIcon = withClass(RefreshCw, "w-4 h-4");
const SaveIcon = withClass(Send, "w-4 h-4");
const ChevronDownIcon = withClass(HeroChevronDownIcon, "w-4 h-4");

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
	<div className="relative">
		<div className={cn("[transition:filter_0.2s_ease,_opacity_0.2s_ease]", disabled ? "pointer-events-none" : "pointer-events-auto", disabled ? "[filter:blur(1.2px)]" : "[filter:none]", disabled ? "opacity-[0.55]" : "opacity-100")}>
			{children}
		</div>
		{disabled && (
			<div className="flex absolute inset-0 items-center justify-center text-center text-sm font-medium text-panel-text px-6 rounded-xl bg-panel-surface/70 [backdrop-filter:blur(2px)]">
				<p>{message}</p>
			</div>
		)}
	</div>
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

const readSettingsHash = (hash = window.location.hash) => parseSettingsHash(hash);

export const IntegrationSettingsPage = () => {
	const location = useLocation();
	const { t } = useTranslation();
	const { colorMode } = useColorMode();
	
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

	const { data, isLoading, isFetching: isTelegramFetching, refetch } = useQuery({ queryKey: ["telegram-settings"], queryFn: getTelegramSettings, refetchOnWindowFocus: false,
			enabled: canManageIntegrations && activeIntegrationTab === 1, });

	const {
		data: panelData,
		isLoading: isPanelLoading,
		isFetching: isPanelFetching,
		refetch: refetchPanelSettings,
	} = useQuery<PanelSettingsResponse>({ queryKey: ["panel-settings"], queryFn: getPanelSettings, refetchOnWindowFocus: false,
		enabled: canManageIntegrations && activeIntegrationTab === 0, });

	const {
		data: runtimeSettings,
		isLoading: isRuntimeSettingsLoading,
		isFetching: isRuntimeSettingsFetching,
		refetch: refetchRuntimeSettings,
	} = useQuery<RuntimeSettingsResponse>({ queryKey: ["runtime-settings"], queryFn: getRuntimeSettings, refetchOnWindowFocus: false,
			enabled: canManageIntegrations && activeIntegrationTab === 0, });

	const {
		data: phpMyAdminStatus,
		isLoading: isPHPMyAdminStatusLoading,
		refetch: refetchPHPMyAdminStatus,
	} = useQuery({ queryKey: ["phpmyadmin-status"], queryFn: getPHPMyAdminStatus, refetchOnWindowFocus: false,
		enabled: canManageIntegrations && activeIntegrationTab === 0, });

	const {
		data: subscriptionBundle,
		isLoading: isSubscriptionLoading,
		isFetching: isSubscriptionFetching,
		refetch: refetchSubscriptionSettings,
	} = useQuery<SubscriptionSettingsBundle>({ queryKey: ["subscription-settings"], queryFn: getSubscriptionSettings, refetchOnWindowFocus: false,
			enabled: canManageIntegrations && activeIntegrationTab >= 2, });

	const maintenanceInfoQuery = useQuery<RuntimeMaintenanceInfo>({ queryKey: ["maintenance-info"], queryFn: () => apiFetch<RuntimeMaintenanceInfo>("/maintenance/info"), refetchOnWindowFocus: false,
			enabled: canReadMaintenance && activeIntegrationTab === 0, });
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
		provider: "letsencrypt" | "zerossl" | "manual" | "node";
		email: string;
		nodeId: string;
		nodeDomain: string;
		domains: string;
		fullchain: string;
		privateKey: string;
	}>({
		provider: "letsencrypt",
		email: "",
		nodeId: "",
		nodeDomain: "",
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
		const syncTabFromHash = (hash: string) => {
			const { tab } = readSettingsHash(hash);
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
		syncTabFromHash(location.hash);
		const onHashChange = () => syncTabFromHash(window.location.hash);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [location.hash]);

	useEffect(() => {
		const { focus, tab } = readSettingsHash(location.hash);
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
	}, [location.hash, activeIntegrationTab, data, isLoading]);

	const saveAllMutation = useMutation({ mutationFn: updateAllSettings, onSuccess: (updated) => {
			if (updated.telegram) {
				reset(buildDefaultValues(updated.telegram));
				queryClient.setQueryData(["telegram-settings"], updated.telegram);
			}
			if (updated.panel) {
				setPanelDefaultSubType(
					updated.panel.default_subscription_type ?? "key",
				);
				queryClient.setQueryData(["panel-settings"], updated.panel);
			}
			if (updated.runtime) {
				setRuntimeSettingsForm(updated.runtime);
				queryClient.setQueryData(["runtime-settings"], updated.runtime);
			}
			if (updated.subscriptions) {
				resetSubscription(buildSubscriptionDefaults(updated.subscriptions));
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(["subscription-settings"],
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
				queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(["subscription-settings"],
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
			toast.success(t("settings.savedSuccess"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });

	const telegramBackupMutation = useMutation({ mutationFn: sendTelegramBackup, onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
			toast.success(t("settings.telegram.backupSendSuccess"), { description: result.filename, duration: 4000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });

	const telegramTestMutation = useMutation({ mutationFn: testTelegramSettings, onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
			toast.success(t("settings.telegram.testMessageSuccess"), { description: result.detail, duration: 4000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
			queryClient.invalidateQueries({ queryKey: ["telegram-settings"] });
		}, });

	const phpMyAdminEnableMutation = useMutation({ mutationFn: () =>
			enablePHPMyAdmin({
				port: 8080,
				path: runtimeSettingsForm.phpmyadmin_path || "/phpmyadmin/",
			}), onSuccess: (result) => {
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
			}, });

	const phpMyAdminDisableMutation = useMutation({ mutationFn: disablePHPMyAdmin, onSuccess: (result) => {
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
		}, });

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
		queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(["subscription-settings"],
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

	const issueCertificateMutation = useMutation({ mutationFn: issueSubscriptionCertificate, onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateDialogOpen(false);
			setCertificateForm((prev) => ({
				...prev,
				domains: "",
			}));
			toast.success(t("settings.subscriptions.certificateIssued"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });
	const { data: nodeList = [] } = useNodesQuery({
		enabled: isCertificateDialogOpen,
	});
	const issueNodeCertificateMutation = useMutation({ mutationFn: issueNodeSubscriptionCertificate, onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateDialogOpen(false);
			setCertificateForm((prev) => ({
				...prev,
				nodeId: "",
				nodeDomain: "",
			}));
			toast.success(t("settings.subscriptions.nodeCertificateIssued"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });
	const importCertificateMutation = useMutation({ mutationFn: importSubscriptionCertificate, onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateDialogOpen(false);
			setCertificateForm((prev) => ({
				...prev,
				domains: "",
				fullchain: "",
				privateKey: "",
			}));
			toast.success(t("settings.subscriptions.certificateImported"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });

	const renewCertificateMutation = useMutation({ mutationFn: renewSubscriptionCertificate, onMutate: (payload) => setRenewingDomain(payload?.domain || null),
		onSuccess: (cert) => {
			if (cert) {
				updateCertificateCache(cert);
			}
			toast.success(t("settings.subscriptions.certificateRenewed"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
		onSettled: () => setRenewingDomain(null), });
	const revokeCertificateMutation = useMutation({ mutationFn: revokeSubscriptionCertificate, onSuccess: (cert) => {
			updateCertificateCache(cert);
			setCertificateAction(null);
			toast.success(t("settings.subscriptions.certificateRevoked"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });
	const deleteCertificateMutation = useMutation({ mutationFn: deleteSubscriptionCertificate, onSuccess: (_, domain) => {
			queryClient.setQueryData<SubscriptionSettingsBundle | undefined>(["subscription-settings"],
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
			toast.success(t("settings.subscriptions.certificateDeleted"), { duration: 3000 });
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		}, });
	const certificateServingMutation = useMutation({ mutationFn: ({ domain, enabled }: { domain: string; enabled: boolean }) =>
			updateSubscriptionCertificateServing(domain, enabled), onSuccess: (cert) => {
				updateCertificateCache(cert);
				toast.success(t("settings.subscriptions.certificateServingUpdated"), { duration: 3000 });
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			}, });

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
				toast.warning(t("settings.subscriptions.certificateMissingInput"), { duration: 2500 });
				return;
			}
			importCertificateMutation.mutate({
				domain: domains[0],
				fullchain: certificateForm.fullchain,
				private_key: certificateForm.privateKey,
			});
			return;
		}
		if (certificateForm.provider === "node") {
			if (!certificateForm.email.trim() || !certificateForm.nodeId) {
				toast.warning(t("settings.subscriptions.certificateMissingInput"), { duration: 2500 });
				return;
			}
			issueNodeCertificateMutation.mutate({
				node_id: Number(certificateForm.nodeId),
				domain: certificateForm.nodeDomain.trim(),
				email: certificateForm.email.trim(),
			});
			return;
		}
		if (!certificateForm.email.trim() || domains.length === 0) {
			toast.warning(t("settings.subscriptions.certificateMissingInput"), { duration: 2500 });
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
	const [certificateSorting, setCertificateSorting] = useState<SortingState>([]);
	const certificateColumns = useMemo<
		DataTableColumn<SubscriptionCertificate>[]
	>(
		() => [
			{
				id: "domain",
				sortValue: (certificate) => certificate.domain ?? "",
				header: t("settings.subscriptions.domain"),
				isPrimary: true,
				priority: "primary",
				mobilePriority: 0,
				cell: (certificate) => (
					<div className="flex flex-col gap-0 min-w-0! items-start">
						<p dir="ltr" className="font-semibold truncate">
							{certificate.domain}
						</p>
						{certificate.alt_names?.length ? (
							<p dir="ltr" className="text-[0.75rem] text-panel-text-muted truncate">
								SAN: {certificate.alt_names.join(", ")}
							</p>
						) : null}
					</div>
				),
			},
			{
				id: "status",
				sortValue: (certificate) => certificate.status ?? "",
				header: t("status"),
				priority: "high",
				mobilePriority: 1,
				mobileMetaLabel: t("status"),
				cell: (certificate) => (
					<div className="flex flex-row items-center gap-1.5 flex-wrap">
						<Badge className={toneClass(
								certificate.status === "active"
									? "green"
									: certificate.status === "expiring"
										? "orange"
										: "red"
							)}>
							{certificate.status}
						</Badge>
						<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
							{certificate.provider || "unknown"}
						</Badge>
						{certificate.node_id ? (
							<Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-200">
								{t("settings.subscriptions.viaNode")} #{certificate.node_id}
							</Badge>
						) : null}
					</div>
				),
			},
			{
				id: "expires",
				sortValue: (certificate) => Date.parse(certificate.not_after ?? "") || 0,
				header: t("settings.subscriptions.expiresAt"),
				priority: "high",
				mobilePriority: 2,
				mobileMetaLabel: t("settings.subscriptions.expiresAt"),
				cell: (certificate) => (
					<p className="text-[0.875rem]">
						{certificate.not_after
							? new Date(certificate.not_after).toLocaleString()
							: t("settings.subscriptions.never")}
					</p>
				),
			},
			{
				id: "updated",
				sortValue: (certificate) => Date.parse(certificate.last_renewed_at ?? "") || 0,
				header: t("settings.subscriptions.lastRenewed"),
				priority: "low",
				hideBelow: "xl",
				mobileMetaLabel: t("settings.subscriptions.lastRenewed"),
				cell: (certificate) => (
					<div className="flex flex-col gap-0">
						<p className="text-[0.875rem]">
							{certificate.last_renewed_at
								? new Date(certificate.last_renewed_at).toLocaleString()
								: t("settings.subscriptions.never")}
						</p>
						<p className="text-[0.75rem] text-panel-text-muted">
							{t("settings.subscriptions.lastIssued")}:{" "}
							{certificate.last_issued_at
								? new Date(certificate.last_issued_at).toLocaleString()
								: t("settings.subscriptions.never")}
						</p>
					</div>
				),
			},
			{
				id: "serving",
				sortValue: (certificate) => (certificate.serve_tls !== false ? 1 : 0),
				header: t("settings.subscriptions.serveTLS"),
				priority: "high",
				mobilePriority: 3,
				mobileMetaLabel: t("settings.subscriptions.serveTLS"),
				cell: (certificate) => (
					<div className="flex flex-row items-center gap-2">
						<Switch aria-label={t("settings.subscriptions.serveTLS")} checked={certificate.serve_tls !== false} disabled={
								certificateServingMutation.isPending ||
								(certificate.serve_tls === false &&
									certificate.status !== "active" &&
									certificate.status !== "expiring")
							} onCheckedChange={(checked: boolean) => certificateServingMutation.mutate({
									domain: certificate.domain,
									enabled: checked,
								})} />
						{certificate.auto_renew ? (
							<Badge className="bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-500/20 dark:text-teal-200">
								{t("settings.subscriptions.autoRenew")}
							</Badge>
						) : null}
					</div>
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
				icon: <RefreshCw className="w-[16px] h-[16px]" />,
				onClick: () => handleRenewCertificate(certificate.domain),
				disabled:
					renewCertificateMutation.isPending &&
					renewingDomain === certificate.domain,
			});
		}
		if (certificate.provider !== "manual" && certificate.status !== "revoked") {
			actions.push({
				id: "revoke",
				label: t("settings.subscriptions.revokeAction"),
				icon: <Ban className="w-[16px] h-[16px]" />,
				onClick: () =>
					setCertificateAction({ type: "revoke", domain: certificate.domain }),
				isDanger: true,
			});
		}
		actions.push({
			id: "delete",
			label: t("delete"),
			icon: <Trash2 className="w-[16px] h-[16px]" />,
			onClick: () =>
				setCertificateAction({ type: "delete", domain: certificate.domain }),
			isDanger: true,
		});
		return actions;
	};
	const isCertificateMutationLoading =
		issueCertificateMutation.isPending ||
		issueNodeCertificateMutation.isPending ||
		importCertificateMutation.isPending;
	const certificateManager = (
		<div className="flex flex-col gap-4 items-stretch">
			<ListCard
				overview={{
					total: { label: t("settings.subscriptions.certificateTitle"), value: certificates.length },
					rows: [
						{
							key: "active",
							label: t("active"),
							value: certificates.filter((certificate) => certificate.status === "active").length,
							tone: "bg-panel-success",
						},
						{
							key: "serve",
							label: t("settings.subscriptions.serveTLS"),
							value: certificates.filter((certificate) => certificate.serve_tls !== false).length,
							tone: "bg-panel-info",
						},
					],
				}}
				toolbar={
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						<div className="flex flex-row items-center gap-2">
							<SearchInput
							containerProps={{ className: "min-w-0 flex-1 md:w-[280px] md:flex-none" }}
							value={certificateSearch}
							onChange={(event) => setCertificateSearch(event.target.value)}
							placeholder={t("settings.subscriptions.searchCertificates")}
							matchOptions={certificateSearchMatch}
							onMatchOptionsChange={setCertificateSearchMatch}
							onClear={() => setCertificateSearch("")}
							/>
							<DataTableSortMenu
									options={buildSortOptions(certificateColumns, filteredCertificates)}
									sorting={certificateSorting}
									onSortingChange={setCertificateSorting}
							/>
						</div>
						<div className="flex flex-row flex-wrap items-center gap-2">
							<SegmentedControl<"all" | "expiring_7d">
								label={t("settings.subscriptions.certificateList")}
								value={certificateFilter}
								options={[
									{ value: "all", label: t("settings.subscriptions.allCertificates") },
									{ value: "expiring_7d", label: t("settings.subscriptions.expiringInSevenDays") },
								]}
								onChange={(next) => setCertificateFilter(next)}
							/>
						</div>
						<div className="flex flex-row flex-wrap items-center gap-2 md:ms-auto">
							<Button onClick={() => refetchSubscriptionSettings()} loading={isSubscriptionLoading || isSubscriptionFetching} variant="outline" size="sm">{<RefreshIcon />}
								{t("refresh")}
							</Button>
							<Button onClick={() => setCertificateDialogOpen(true)} size="sm">{<Plus className="w-[16px] h-[16px]" />}
								{t("settings.subscriptions.getNewSSL")}
							</Button>
						</div>
					</div>
				}
			/>
			<DataTable
				ariaLabel={t("settings.subscriptions.certificateList")}
				data={filteredCertificates}
				columns={certificateColumns}
				sorting={certificateSorting}
				onSortingChange={setCertificateSorting}
				showSortMenu={false}
				getRowId={(certificate) => certificate.domain}
				loading={isSubscriptionLoading}
				emptyState={
					<p className="text-panel-text-muted">
						{certificateSearch || certificateFilter !== "all"
							? t("settings.subscriptions.noMatchingCertificates")
							: t("settings.subscriptions.noCertificates")}
					</p>
				}
				rowActions={certificateRowActions}

				actionsPlacement="end"
				actionsColumnWidth="60px"

				mobileBreakpoint="md"
			/>
		</div>
	);

				if (!getUserIsSuccess) {
					return <PageLoadingSkeleton variant="settings" />;
				}

	if (!canManageIntegrations) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<h2 className="font-heading font-bold text-[1.5rem] leading-[1.33] md:text-[1.875rem] md:leading-[1.2]">{t("header.integrationSettings")}</h2>
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
					{t("integrations.noPermission")}
				</p>
			</div>
		);
	}

	return (
		<div className="px-4 md:px-8 py-6 md:py-8">
			<div className="flex items-stretch md:items-center justify-between flex-col md:flex-row gap-3">
				<TabSystem tabs={[
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
					]} className="overflow-x-auto overflow-y-hidden max-w-full flex-1 master-settings-tabs" />
				<Button onClick={handleSaveAll} disabled={!hasUnsavedChanges || saveAllMutation.isPending} loading={saveAllMutation.isPending} className="shrink-0 self-end md:self-center">{<SaveIcon />}
					{t("settings.save")}
				</Button>
			</div>
			{activeIntegrationTab === 0 && (
				isPanelLoading && panelData === undefined ? (
					<div className="flex items-center justify-center py-12">
						<Spinner />
					</div>
				) : (
					<div className="mt-5 flex flex-col gap-4 items-stretch">
						<SettingsCard
							title={t("settings.runtime.title")}
							description={t("settings.runtime.description")}
							actions={
								<Button onClick={() => {
										void refetchRuntimeSettings();
										void refetchPanelSettings();
									}} variant="outline" size="sm" loading={isRuntimeSettingsLoading || isRuntimeSettingsFetching || isPanelLoading || isPanelFetching}>{<RefreshCw className="w-[16px] h-[16px]" />}
									{t("refresh")}
								</Button>
							}
						>
							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<FormField label={t("settings.panel.defaultSubscriptionType")} description={t("settings.panel.defaultSubscriptionTypeDescription")}>
									<div className={cn((saveAllMutation.isPending || isPanelLoading) && "pointer-events-none opacity-60")}>
										<SegmentedControl<"username-key" | "key" | "key-username" | "token">
											label={t("settings.panel.defaultSubscriptionType")}
											value={panelDefaultSubType}
											options={[
												{ value: "username-key", label: t("settings.panel.link.usernameKey") },
												{ value: "key", label: t("settings.panel.link.keyOnly") },
												{ value: "key-username", label: t("settings.panel.link.keyUsername") },
												{ value: "token", label: t("settings.panel.link.token") },
											]}
											onChange={(next) => setPanelDefaultSubType(next)}
										/>
									</div>
								</FormField>
								<FormField label={t("settings.runtime.dashboardPath")} description={t("settings.runtime.dashboardPathHint")}>
									<UiInput
										value={runtimeSettingsForm.dashboard_path}
										placeholder="/dashboard/"
										onChange={(event) =>
											setRuntimeSettingsForm((prev) => ({
												...prev,
												dashboard_path: event.target.value,
											}))
										}
										disabled={saveAllMutation.isPending}
									/>
								</FormField>
							</div>
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								<ToggleRow
									title={t("settings.runtime.subscriptionReadOnlyTitle")}
									hint={t("settings.runtime.subscriptionReadOnlyHint")}
									checked={runtimeSettingsForm.subscription_read_only}
									disabled={saveAllMutation.isPending}
									onChange={(next) =>
										setRuntimeSettingsForm((prev) => ({
											...prev,
											subscription_read_only: next,
										}))
									}
								/>
								<ToggleRow
									title={t("settings.runtime.recordNodeUsage")}
									hint={t("settings.runtime.recordNodeUsageHint")}
									checked={runtimeSettingsForm.record_node_usage}
									disabled={saveAllMutation.isPending}
									onChange={(next) =>
										setRuntimeSettingsForm((prev) => ({
											...prev,
											record_node_usage: next,
										}))
									}
								/>
								<ToggleRow
									title={t("settings.runtime.recordNodeUserUsages")}
									hint={t("settings.runtime.recordNodeUserUsagesHint")}
									checked={runtimeSettingsForm.record_node_user_usages}
									disabled={saveAllMutation.isPending}
									onChange={(next) =>
										setRuntimeSettingsForm((prev) => ({
											...prev,
											record_node_user_usages: next,
										}))
									}
								/>
								<ToggleRow
									title={t("settings.runtime.userSpeedLimit")}
									hint={t("settings.runtime.userSpeedLimitHint")}
									checked={runtimeSettingsForm.user_speed_limit_enabled}
									disabled={saveAllMutation.isPending}
									onChange={(next) =>
										setRuntimeSettingsForm((prev) => ({
											...prev,
											user_speed_limit_enabled: next,
										}))
									}
								/>
								<ToggleRow
									title={t("settings.runtime.apiDocs")}
									hint={t("settings.runtime.apiDocsHint")}
									checked={runtimeSettingsForm.api_docs_enabled}
									disabled={saveAllMutation.isPending}
									onChange={(next) =>
										setRuntimeSettingsForm((prev) => ({
											...prev,
											api_docs_enabled: next,
										}))
									}
								/>
							</div>
						</SettingsCard>

						<SettingsCard
							title={t("phpmyadmin.title")}
							description={t("phpmyadmin.settingsHint")}
							actions={
								<div className="flex flex-row items-center gap-2 flex-wrap">
									<Button asChild disabled={
											!runtimeSettingsForm.phpmyadmin_enabled ||
											!phpMyAdminSupported
										} variant="outline" size="sm">
										<RouterLink to="/phpmyadmin">{t("phpmyadmin.openPanel")}</RouterLink>
									</Button>
									<Button onClick={openPHPMyAdminExternal} disabled={
											!runtimeSettingsForm.phpmyadmin_enabled ||
											!phpMyAdminSupported
										} variant="outline" size="sm" loading={isOpeningPHPMyAdminExternal}>
										{t("phpmyadmin.openExternal")}
									</Button>
									<Button onClick={() =>
											runtimeSettingsForm.phpmyadmin_enabled
												? phpMyAdminDisableMutation.mutate()
												: phpMyAdminEnableMutation.mutate()
										} disabled={
											isPHPMyAdminStatusLoading ||
											(!runtimeSettingsForm.phpmyadmin_enabled &&
												!phpMyAdminSupported)
										} size="sm" loading={
											phpMyAdminEnableMutation.isPending ||
											phpMyAdminDisableMutation.isPending
										}>
										{runtimeSettingsForm.phpmyadmin_enabled
											? t("phpmyadmin.disableAction")
											: t("phpmyadmin.enableAction")}
									</Button>
								</div>
							}
						>
							{!phpMyAdminSupported ? (
								<Alert className="rounded-md">
									<TriangleAlert className="size-4" aria-hidden="true" />
									{t("phpmyadmin.sqliteDisabled")}
								</Alert>
							) : null}
							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<FormField label={t("path")} description={t("phpmyadmin.panelOnlyHint")}>
									<UiInput
										value={runtimeSettingsForm.phpmyadmin_path}
										placeholder="/phpmyadmin/"
										onChange={(event) =>
											setRuntimeSettingsForm((prev) => ({
												...prev,
												phpmyadmin_path: event.target.value,
											}))
										}
										disabled={
											phpMyAdminEnableMutation.isPending ||
											phpMyAdminDisableMutation.isPending
										}
									/>
								</FormField>
								<FormField label={t("phpmyadmin.loginMode")} description={t("phpmyadmin.loginModeHint")}>
									<div className={cn(
											(phpMyAdminEnableMutation.isPending || phpMyAdminDisableMutation.isPending) &&
												"pointer-events-none opacity-60",
										)}>
										<SegmentedControl<"rebecca" | "custom">
											label={t("phpmyadmin.loginMode")}
											value={runtimeSettingsForm.phpmyadmin_login_mode}
											options={[
												{ value: "rebecca", label: t("phpmyadmin.loginModeRebecca") },
												{ value: "custom", label: t("phpmyadmin.loginModeCustom") },
											]}
											onChange={(next) =>
												setRuntimeSettingsForm((prev) => ({
													...prev,
													phpmyadmin_login_mode: next,
												}))
											}
										/>
									</div>
								</FormField>
								<FormField label={t("phpmyadmin.username")}>
									<UiInput
										value={runtimeSettingsForm.phpmyadmin_username}
										placeholder="root"
										disabled={
											runtimeSettingsForm.phpmyadmin_login_mode !== "custom" ||
											phpMyAdminEnableMutation.isPending ||
											phpMyAdminDisableMutation.isPending
										}
										onChange={(event) =>
											setRuntimeSettingsForm((prev) => ({
												...prev,
												phpmyadmin_username: event.target.value,
											}))
										}
									/>
								</FormField>
								<FormField label={t("phpmyadmin.password")}>
									<UiInput
										type="password"
										value={runtimeSettingsForm.phpmyadmin_password}
										placeholder={t("phpmyadmin.passwordPlaceholder")}
										disabled={
											runtimeSettingsForm.phpmyadmin_login_mode !== "custom" ||
											phpMyAdminEnableMutation.isPending ||
											phpMyAdminDisableMutation.isPending
										}
										onChange={(event) =>
											setRuntimeSettingsForm((prev) => ({
												...prev,
												phpmyadmin_password: event.target.value,
											}))
										}
									/>
								</FormField>
							</div>
						</SettingsCard>
					</div>
				)
			)}
				{activeIntegrationTab === 3 && (
				<div className="px-0 md:px-2 mt-5">
				{isSubscriptionLoading && !subscriptionBundle ? (
					<div className="flex items-center justify-center py-12">
						<Spinner />
					</div>
				) : (
					certificateManager
				)}
				</div>
			)}
			{activeIntegrationTab === 1 && (
				<div className="px-0 md:px-2 mt-5">
				{isLoading && !data ? (
					<div className="flex items-center justify-center py-12">
						<Spinner />
					</div>
				) : (
					<form
						className="telegram-settings-form"
						onSubmit={(event) => event.preventDefault()}
					>
						<div className="flex flex-col items-stretch gap-4">
							<Controller
								control={control}
								name="use_telegram"
								render={({ field }) => (
									<ToggleRow
										title={t("settings.telegram.enableBot")}
										hint={t("settings.telegram.enableBotDescription")}
										checked={Boolean(field.value)}
										onChange={(next) => field.onChange(next)}
									/>
								)}
							/>

							<DisabledCard
								disabled={!isTelegramEnabled}
								message={telegramDisabledMessage}
							>
								<SettingsCard
									title={t("settings.telegram")}
									description={t("settings.telegram.description")}
									actions={
										<Button onClick={() => telegramTestMutation.mutate()} variant="outline" size="sm" loading={telegramTestMutation.isPending}>{<SaveIcon />}
											{t("settings.telegram.testMessage")}
										</Button>
									}
								>
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={t("settings.telegram.apiToken")}>
											<UiInput placeholder="123456:ABC" {...register("api_token")} />
										</FormField>
										<FormField label={t("settings.telegram.proxyUrl")} description={t("settings.telegram.proxyUrlHelp")}>
											<UiInput placeholder="socks5://user:pass@host:port" {...register("proxy_url")} />
										</FormField>
										<FormField label={t("settings.telegram.adminChatIds")} description={t("settings.telegram.adminChatIdsHint")}>
											<UiInput placeholder="12345, 67890" {...register("admin_chat_ids")} />
										</FormField>
										<FormField label={t("settings.telegram.logsChatId")} description={t("settings.telegram.logsChatIdHint")}>
											<UiInput placeholder="-100123456789" {...register("logs_chat_id")} />
										</FormField>
										<Controller
											control={control}
											name="logs_chat_is_forum"
											render={({ field }) => (
												<ToggleRow
													title={t("settings.telegram.logsChatIsForum")}
													hint={t("settings.telegram.logsChatIsForumHint")}
													checked={Boolean(field.value)}
													onChange={(next) => field.onChange(next)}
												/>
											)}
										/>
										<FormField label={t("settings.telegram.defaultVlessFlow")}>
											<UiInput placeholder="xtls-rprx-vision" {...register("default_vless_flow")} />
										</FormField>
									</div>
								</SettingsCard>
							</DisabledCard>

							<DisabledCard
								disabled={!isTelegramEnabled || !hostActionsAvailable}
								message={
									!hostActionsAvailable
										? telegramBackupDisabledMessage
										: telegramDisabledMessage
								}
							>
								<div id="telegram-periodic-backup" className="[scroll-margin-top:120px]">
									<SettingsCard
										title={t("settings.telegram.backupTitle")}
										description={t("settings.telegram.backupDescription")}
										actions={
											<div className="flex flex-row flex-wrap items-center gap-3">
												<Controller
													control={control}
													name="backup_enabled"
													render={({ field }) => (
														<Switch checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
													)}
												/>
												<Button onClick={() =>
														telegramBackupMutation.mutate(telegramBackupScope)
													} variant="outline" size="sm" loading={telegramBackupMutation.isPending}>{<Upload className="w-[16px]" />}
													{t("settings.telegram.backupSendNow")}
												</Button>
											</div>
										}
									>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
											<FormField label={t("settings.telegram.backupChatId")} description={t("settings.telegram.backupChatIdHint")}>
												<UiInput placeholder="-100123456789" {...register("backup_chat_id")} />
											</FormField>
											<Controller
												control={control}
												name="backup_chat_is_forum"
												render={({ field }) => (
													<ToggleRow
														title={t("settings.telegram.backupChatIsForum")}
														hint={t("settings.telegram.backupChatIsForumHint")}
														checked={Boolean(field.value)}
														onChange={(next) => field.onChange(next)}
													/>
												)}
											/>
											<FormField label={t("settings.telegram.backupScope")}>
												<Controller
													control={control}
													name="backup_scope"
													render={({ field }) => (
														<SegmentedControl<string>
															label={t("settings.telegram.backupScope")}
															value={field.value}
															options={[
																{ value: "database", label: t("settings.telegram.backupScopeDatabase") },
																{ value: "full", label: t("settings.telegram.backupScopeFull") },
															]}
															onChange={(next) => field.onChange(next)}
														/>
													)}
												/>
											</FormField>
											<FormField label={t("settings.telegram.backupIntervalValue")}>
												<Controller
													control={control}
													name="backup_interval_value"
													render={({ field }) => (
														<NumberField
															inputMode="numeric"
															min={1}
															value={String(field.value ?? "")}
															doneLabel={t("common.done")}
															disabled={!isTelegramBackupEnabled}
															onChange={(raw) => {
																const next = Number(raw);
																field.onChange(raw !== "" && Number.isFinite(next) ? next : 1);
															}}
														/>
													)}
												/>
											</FormField>
											<FormField label={t("settings.telegram.backupIntervalUnit")}>
												<Controller
													control={control}
													name="backup_interval_unit"
													render={({ field }) => (
														<div className={cn(!isTelegramBackupEnabled && "pointer-events-none opacity-60")}>
															<SegmentedControl<string>
																label={t("settings.telegram.backupIntervalUnit")}
																value={field.value}
																options={[
																	{ value: "minutes", label: t("settings.telegram.backupIntervalMinutes") },
																	{ value: "hours", label: t("settings.telegram.backupIntervalHours") },
																	{ value: "days", label: t("settings.telegram.backupIntervalDays") },
																]}
																onChange={(next) => field.onChange(next)}
															/>
														</div>
													)}
												/>
											</FormField>
										</div>
										<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
											<p className="text-[0.8125rem] text-panel-text-muted">
												{t("settings.telegram.backupLastSent")}:{" "}
												{data?.backup_last_sent_at || "-"}
											</p>
											{data?.backup_last_error && (
												<p className="text-[0.8125rem] text-red-300">
													{t("settings.telegram.backupLastError")}:{" "}
													{data.backup_last_error}
												</p>
											)}
										</div>
									</SettingsCard>
								</div>
							</DisabledCard>

							<DisabledCard
								disabled={!isTelegramEnabled}
								message={telegramDisabledMessage}
							>
								<SettingsCard
									title={t("settings.telegram.botCommandsTitle")}
									actions={
										<Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-200">
											{t("settings.tabs.comingSoon")}
										</Badge>
									}
								/>
							</DisabledCard>

							<DisabledCard
								disabled={!isTelegramEnabled}
								message={telegramDisabledMessage}
							>
								<SettingsCard title={t("settings.telegram.forumTopics")}>
									{forumTopics && Object.keys(forumTopics).length > 0 ? (
										<div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
											{Object.entries(forumTopics).map(([key]) => (
												<div key={key} className="flex flex-col gap-4 rounded-lg border bg-card/40 p-4">
													<p className="text-sm font-semibold">
														{t("settings.telegram.topicKey")}: {key}
													</p>
													<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
														<FormField label={t("settings.telegram.topicTitle")}>
															<UiInput
																{...register(
																	`forum_topics.${key}.title` as const,
																)}
															/>
														</FormField>
														<FormField label={t("settings.telegram.topicId")} description={t("settings.telegram.topicIdHint")}>
															<UiInput
																type="number"
																{...register(
																	`forum_topics.${key}.topic_id` as const,
																)}
															/>
														</FormField>
													</div>
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-panel-text-muted">
											{t("settings.telegram.emptyTopics")}
										</p>
									)}
								</SettingsCard>
							</DisabledCard>

							<DisabledCard
								disabled={!isTelegramEnabled}
								message={telegramDisabledMessage}
							>
								<SettingsCard
									title={t("settings.telegram.notificationsTitle")}
									description={t("settings.telegram.notificationsDescription")}
								>
									{EVENT_TOGGLE_GROUPS.map((group) => (
										<div key={group.key} className="flex flex-col gap-3 rounded-lg border bg-card/40 p-4">
											<p className="text-sm font-semibold">
												{t(group.titleKey, group.defaultTitle)}
											</p>
											<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
												{group.events.map((event) => (
													<Controller
														key={event.key}
														control={control}
														name={
															`event_toggles.${encodeToggleKey(event.key)}` as const
														}
														render={({ field }) => (
															<ToggleRow
																title={t(event.labelKey, event.defaultLabel)}
																hint={t(event.hintKey, event.defaultHint)}
																checked={Boolean(field.value)}
																onChange={(next) => field.onChange(next)}
															/>
														)}
													/>
												))}
											</div>
										</div>
									))}
								</SettingsCard>
							</DisabledCard>

							<div className="flex justify-end">
								<Button onClick={() => refetch()} disabled={saveAllMutation.isPending} loading={isLoading || isTelegramFetching} variant="outline">{<RefreshIcon />}
									{t("refresh")}
								</Button>
							</div>
						</div>
					</form>
				)}
				</div>
			)}
				{activeIntegrationTab === 2 && (
				<div className="px-0 md:px-2 mt-5">
				{isSubscriptionLoading && !subscriptionBundle ? (
					<div className="flex items-center justify-center py-12">
						<Spinner />
					</div>
				) : (
					<form onSubmit={(event) => event.preventDefault()}>
						<div className="flex flex-col items-stretch gap-4">
							<SettingsCard
								title={t("settings.subscriptions.globalTitle")}
								description={t("settings.subscriptions.globalDescription")}
								actions={
									<Button type="button" onClick={() => refetchSubscriptionSettings()} disabled={saveAllMutation.isPending} loading={isSubscriptionLoading || isSubscriptionFetching} variant="outline" size="sm">{<RefreshIcon />}
										{t("refresh")}
									</Button>
								}
							>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("settings.subscriptions.urlPrefix")} description={t("settings.subscriptions.urlPrefixHint")}>
										<UiInput
											placeholder="https://sub.example.com"
											{...subscriptionRegister("subscription_url_prefix")}
										/>
									</FormField>
									<FormField label={t("settings.subscriptions.customTemplatesDir")} description={t("settings.subscriptions.customTemplatesDirHint")}>
										<UiInput
											placeholder="/var/lib/rebecca/templates"
											{...subscriptionRegister("custom_templates_directory")}
										/>
									</FormField>
									<FormField label={t("settings.subscriptions.profileTitle")} description={t("settings.subscriptions.profileTitleHint")}>
										<UiInput
											placeholder="Subscription"
											{...subscriptionRegister("subscription_profile_title")}
										/>
									</FormField>
									<FormField label={t("settings.subscriptions.supportUrl")} description={t("settings.subscriptions.supportUrlHint")}>
										<UiInput
											placeholder="https://t.me/support"
											{...subscriptionRegister("subscription_support_url")}
										/>
									</FormField>
									<FormField label={t("settings.subscriptions.updateInterval")} description={t("settings.subscriptions.updateIntervalHint")}>
										<UiInput
											type="number"
											{...subscriptionRegister("subscription_update_interval")}
										/>
									</FormField>
								</div>

								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("settings.subscriptions.subscriptionPageTemplate")}>
										<UiInput {...subscriptionRegister("subscription_page_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.homePageTemplate")}>
										<UiInput {...subscriptionRegister("home_page_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.clashTemplate")}>
										<UiInput {...subscriptionRegister("clash_subscription_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.clashSettingsTemplate")}>
										<UiInput {...subscriptionRegister("clash_settings_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.v2rayTemplate")}>
										<UiInput {...subscriptionRegister("v2ray_subscription_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.v2raySettingsTemplate")}>
										<UiInput {...subscriptionRegister("v2ray_settings_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.happTemplate")}>
										<UiInput {...subscriptionRegister("happ_subscription_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.incyTemplate")}>
										<UiInput {...subscriptionRegister("incy_subscription_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.singboxTemplate")}>
										<UiInput {...subscriptionRegister("singbox_subscription_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.singboxSettingsTemplate")}>
										<UiInput {...subscriptionRegister("singbox_settings_template")} />
									</FormField>
									<FormField label={t("settings.subscriptions.muxTemplate")}>
										<UiInput {...subscriptionRegister("mux_template")} />
									</FormField>
								</div>

								<div className="grid grid-cols-1 gap-4 md:grid-cols-2 border-t border-panel-border! pt-4">
									<FormField label={t("settings.subscriptions.subscriptionAliases")} description={t("settings.subscriptions.aliasesHint")}>
										<Textarea rows={4} {...subscriptionRegister("subscription_aliases_text")} />
									</FormField>
									<FormField label={t("settings.subscriptions.subscriptionPorts")} description={t("settings.subscriptions.subscriptionPortsHint")}>
										<UiInput
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
										{parsedSubscriptionPorts.length > 0 ? (
											<p className="text-[0.8125rem] text-panel-text-muted">
												{t("settings.subscriptions.activePorts")}: {parsedSubscriptionPorts.join(", ")}
											</p>
										) : null}
									</FormField>
								</div>

								<div className="flex flex-col gap-3 border-t border-panel-border! pt-4">
									<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
										<div>
											<h3 className="text-sm font-semibold">{t("settings.subscriptions.routingRulesTitle")}</h3>
											<p className="mt-1 text-[0.8125rem] text-panel-text-muted">{t("settings.subscriptions.routingRulesDesc")}</p>
										</div>
										<Button onClick={() => {
												setSubscriptionValue("client_routing_rules", DEFAULT_CLIENT_ROUTING_RULES, {
													shouldDirty: true,
													shouldValidate: true,
												});
											}} variant="outline" size="xs" className="border border-orange-500 bg-transparent text-orange-600 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10">{<RefreshCw className="w-[14px] h-[14px]" />}
											{t("settings.subscriptions.resetToDefault")}
										</Button>
									</div>

									<div className="flex flex-col gap-2">
										<div className="hidden px-3 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-panel-text-muted md:grid md:grid-cols-[minmax(0,1fr)_220px_auto] md:gap-2">
											<span>{t("settings.subscriptions.rulePattern")}</span>
											<span>{t("settings.subscriptions.ruleResult")}</span>
											<span />
										</div>
										{routingRules.map((field, index) => (
											<div key={field.id} className="grid grid-cols-1 gap-2 rounded-lg border bg-card/40 p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
												<UiInput placeholder="^([Cc]lash|[Ss]tash)" {...subscriptionRegister(`client_routing_rules.${index}.pattern` as const)} className="font-mono" />
												<Controller
													control={subscriptionControl}
													name={`client_routing_rules.${index}.result` as const}
													render={({ field: controllerField }) => (
														<Select {...controllerField} showSearch={false} className="w-full">
															{CLIENT_OPTIONS.map((opt) => (
																<option key={opt} value={opt}>
																	{opt}
																</option>
															))}
														</Select>
													)}
												/>
												<div className="flex flex-row items-center justify-end gap-1">
													<Button aria-label="Move Up" disabled={index === 0} onClick={() => moveRoutingRule(index, index - 1)} variant="ghost" size="sm" className="size-8 p-0">{<ChevronUp className="w-[16px]" />}</Button>
													<Button aria-label="Move Down" disabled={index === routingRules.length - 1} onClick={() => moveRoutingRule(index, index + 1)} variant="ghost" size="sm" className="size-8 p-0">{<HeroChevronDownIcon className="w-[16px]" />}</Button>
													<Button aria-label="Delete" onClick={() => removeRoutingRule(index)} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 size-8 p-0">{<Trash2 className="w-[16px]" />}</Button>
												</div>
											</div>
										))}
									</div>
									<Button onClick={() => appendRoutingRule({ pattern: "", result: "v2ray" })} variant="outline" size="sm" className="self-start">{<Plus className="w-[16px]" />}
										{t("settings.subscriptions.addRule")}
									</Button>
								</div>
							</SettingsCard>

							<SettingsCard
								title={t("settings.subscriptions.adminsTitle")}
								description={t("settings.subscriptions.adminsDescription")}
							>
								{Object.values(adminOverrides).length === 0 ? (
									<p className="text-sm text-panel-text-muted">
										{t("settings.subscriptions.noAdmins")}
									</p>
								) : (
									<div className="flex flex-col gap-4">
										<FormField className="max-w-full md:max-w-[320px]" label={t("settings.subscriptions.selectAdmin")} description={t("settings.subscriptions.inheritHint")}>
											<DropdownMenu>
												<DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="w-full h-[36px] px-3 text-[13px] font-semibold justify-between text-start rounded-md">
													<span className="truncate flex-1 min-w-0! text-start">
														{selectedAdminId && adminOverrides[selectedAdminId]
															? adminOverrides[selectedAdminId].username
															: t(
																	"settings.subscriptions.selectAdminPlaceholder",
																)}
													</span>
												{<ChevronDownIcon />}</Button></DropdownMenuTrigger>
												<DropdownMenuContent className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-[calc(100vw_-_48px)]! md:min-w-[280px]! max-w-[calc(100vw_-_48px)] md:max-w-[280px] max-h-[280px] overflow-y-auto">
													<div className="p-2 border-b border-panel-border!">
														<SearchInput placeholder={t(
																	"settings.subscriptions.searchAdmin",
																)} value={adminSearchTerm} onChange={(event) =>
																	setAdminSearchTerm(event.target.value)
																} matchOptions={adminSearchMatch} onMatchOptionsChange={setAdminSearchMatch} onClear={() => setAdminSearchTerm("")} className="text-start" />
													</div>
													{filteredAdmins.length === 0 ? (
														<div className="px-3 py-2">
															<p className="text-panel-text-muted">
																{t("settings.subscriptions.noResults")}
															</p>
														</div>
													) : (
														filteredAdmins.map((admin) => (
															<DropdownMenuItem key={admin.id} onSelect={() => setSelectedAdminId(admin.id)} className={cn("min-h-[36px] py-1.5 px-3", selectedAdminId === admin.id ? "bg-primary-50" : "", selectedAdminId === admin.id ? "dark:bg-whiteAlpha-100" : "")}>
																<div className="flex justify-between items-center w-full">
																	<p>{admin.username}</p>
																	{admin.subscription_domain ? (
																		<p className="text-[0.75rem] text-panel-text-muted max-w-[160px] truncate">
																			{admin.subscription_domain}
																		</p>
																	) : null}
																</div>
															</DropdownMenuItem>
														))
													)}
												</DropdownMenuContent>
											</DropdownMenu>
										</FormField>
										{selectedAdminId == null ||
										!adminOverrides[selectedAdminId] ? (
											<p className="text-sm text-panel-text-muted">
												{t("settings.subscriptions.selectAdminPlaceholder")}
											</p>
										) : (
											<div key={selectedAdminId} className="flex flex-col gap-4 rounded-lg border bg-card/40 p-4">
												{(() => {
													const admin = adminOverrides[selectedAdminId];
													if (!admin) return null;
													const settings = admin.subscription_settings || {};
													return (
														<>
															<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
																<div>
																	<p className="font-semibold">
																		{admin.username}
																	</p>
																	<p className="text-[0.8125rem] text-panel-text-muted">
																		{t("settings.subscriptions.adminHint")}
																	</p>
																</div>
																<div className="flex flex-row flex-wrap items-center gap-2">
																	{admin.subscription_domain ? (
																		<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
																			{admin.subscription_domain}
																		</Badge>
																	) : null}
																	<Button onClick={() => handleAdminReset(admin.id)} disabled={saveAllMutation.isPending} variant="ghost" size="sm">
																		{t("reset")}
																	</Button>
																</div>
															</div>
															<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
																<FormField label={t("settings.subscriptions.adminDomain")}>
																	<UiInput
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
																</FormField>
																<FormField label={t("settings.subscriptions.customTemplatesDir")} description={t("settings.subscriptions.inheritHint")}>
																	<UiInput
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
																</FormField>
																<FormField label={t("settings.subscriptions.updateInterval")}>
																	<UiInput
																		type="number"
																		placeholder={
																			subscriptionBundle?.settings
																				.subscription_update_interval || ""
																		}
																		value={
																			settings.subscription_update_interval ?? ""
																		}
																		onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"subscription_update_interval",
																				event.target.value,
																			)
																		}
																	/>
																</FormField>
																<FormField label={t("settings.subscriptions.profileTitle")}>
																	<UiInput
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
																</FormField>
																<FormField label={t("settings.subscriptions.supportUrl")}>
																	<UiInput
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
																</FormField>
															</div>

															<div className="grid grid-cols-1 gap-4 md:grid-cols-2 border-t border-panel-border! pt-4">
																<FormField label={t("settings.subscriptions.subscriptionPageTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.subscription_page_template || ""
																		} value={
																			settings.subscription_page_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"subscription_page_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.homePageTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.home_page_template || ""
																		} value={settings.home_page_template ?? ""} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"home_page_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.clashTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.clash_subscription_template || ""
																		} value={
																			settings.clash_subscription_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"clash_subscription_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.clashSettingsTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.clash_settings_template || ""
																		} value={
																			settings.clash_settings_template ?? ""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"clash_settings_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.v2rayTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.v2ray_subscription_template || ""
																		} value={
																			settings.v2ray_subscription_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"v2ray_subscription_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.v2raySettingsTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.v2ray_settings_template || ""
																		} value={
																			settings.v2ray_settings_template ?? ""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"v2ray_settings_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.happTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.happ_subscription_template || ""
																		} value={
																			settings.happ_subscription_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"happ_subscription_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.incyTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.incy_subscription_template || ""
																		} value={
																			settings.incy_subscription_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"incy_subscription_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.singboxTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.singbox_subscription_template || ""
																		} value={
																			settings.singbox_subscription_template ??
																			""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"singbox_subscription_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.singboxSettingsTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.singbox_settings_template || ""
																		} value={
																			settings.singbox_settings_template ?? ""
																		} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"singbox_settings_template",
																				event.target.value,
																			)
																		} />
																</FormField>
																<FormField label={t("settings.subscriptions.muxTemplate")}>
																	<UiInput placeholder={
																			subscriptionBundle?.settings
																				.mux_template || ""
																		} value={settings.mux_template ?? ""} onChange={(event) =>
																			handleAdminTemplateChange(
																				admin.id,
																				"mux_template",
																				event.target.value,
																			)
																		} />
																</FormField>
															</div>

															<div className="flex">
																<Button onClick={() => handleAdminReset(admin.id)} disabled={saveAllMutation.isPending} variant="outline">{<RefreshIcon />}
																	{t("settings.subscriptions.resetOverrides")}
																</Button>
															</div>
														</>
													);
												})()}
											</div>
										)}
									</div>
								)}
							</SettingsCard>
						</div>
					</form>
				)}
				</div>
			)}
				<Dialog
					open={isCertificateDialogOpen}
					onOpenChange={(next) => {
						if (!next && !isCertificateMutationLoading) setCertificateDialogOpen(false);
					}}
				>
					<DialogContent className={cn(
							"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0",
							certificateForm.provider === "manual" ? "sm:max-w-3xl" : "sm:max-w-xl",
						)}>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								handleIssueCertificate();
							}}
							className="flex min-h-0 flex-1 flex-col"
						>
							<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
									<ShieldCheck className="size-4" />
								</div>
								<div className="min-w-0">
									<DialogTitle className="truncate text-base">{t("settings.subscriptions.getNewSSL")}</DialogTitle>
									<DialogDescription className="truncate">{t("settings.subscriptions.certificateTitle")}</DialogDescription>
								</div>
							</DialogHeader>
							<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
								<div className="flex flex-col gap-5">
									<Alert className="rounded-lg">
										<Info className="size-4" aria-hidden="true" />
										<p className="text-[0.875rem]">
											{t("settings.subscriptions.certificateSNIHint")}
										</p>
									</Alert>

									<FormField
										label={t("settings.subscriptions.certificateProvider")}
										description={certificateForm.provider === "zerossl" ? t("settings.subscriptions.zeroSSLNoKeyHint") : undefined}
									>
										<SegmentedControl<"letsencrypt" | "zerossl" | "manual" | "node">
											label={t("settings.subscriptions.certificateProvider")}
											value={certificateForm.provider}
											options={[
												{ value: "letsencrypt", label: "Certbot / Let's Encrypt" },
												{ value: "zerossl", label: "ZeroSSL" },
												{ value: "node", label: t("settings.subscriptions.nodeCertificate") },
												{ value: "manual", label: t("settings.subscriptions.manualCertificate") },
											]}
											onChange={(next) =>
												setCertificateForm((previous) => ({
													...previous,
													provider: next,
												}))
											}
										/>
									</FormField>

									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										{certificateForm.provider !== "manual" ? (
											<FormField label={t("settings.subscriptions.email")}>
												<UiInput
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
											</FormField>
										) : null}
										{certificateForm.provider === "node" ? (
											<FormField label={t("settings.subscriptions.nodeCertificateNode")} description={t("settings.subscriptions.nodeCertificateHint")}>
												<Select
													value={certificateForm.nodeId}
													showSearch={false}
													onChange={(event) =>
														setCertificateForm((previous) => ({
															...previous,
															nodeId: event.target.value,
														}))
													}
												>
													<option value="">{t("settings.subscriptions.selectNode")}</option>
													{nodeList
														.filter((node) => node.id != null)
														.map((node) => (
															<option key={node.id} value={String(node.id)}>
																{node.name} ({node.address})
															</option>
														))}
												</Select>
											</FormField>
										) : null}
										{certificateForm.provider === "node" ? (
											<FormField label={t("settings.subscriptions.domain")} description={t("settings.subscriptions.nodeDomainHint")}>
												<UiInput
													placeholder="api.example.com"
													value={certificateForm.nodeDomain}
													onChange={(event) =>
														setCertificateForm((previous) => ({
															...previous,
															nodeDomain: event.target.value,
														}))
													}
												/>
											</FormField>
										) : null}
										{certificateForm.provider !== "node" ? (
											<FormField
												label={
													certificateForm.provider === "manual"
														? t("settings.subscriptions.domain")
														: t("settings.subscriptions.domains")
												}
												description={certificateForm.provider !== "manual" ? t("settings.subscriptions.domainsHint") : undefined}
											>
												<UiInput
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
											</FormField>
										) : null}
									</div>

									{certificateForm.provider === "manual" ? (
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label="fullchain.pem">
												<Textarea dir="ltr" value={certificateForm.fullchain} onChange={(event) =>
														setCertificateForm((previous) => ({
															...previous,
															fullchain: event.target.value,
														}))
													} className="font-mono min-h-[180px]" />
											</FormField>
											<FormField label="privkey.pem">
												<Textarea dir="ltr" value={certificateForm.privateKey} onChange={(event) =>
														setCertificateForm((previous) => ({
															...previous,
															privateKey: event.target.value,
														}))
													} className="font-mono min-h-[180px]" />
											</FormField>
										</div>
									) : null}
								</div>
							</div>
							<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
								<Button onClick={() => setCertificateDialogOpen(false)} disabled={isCertificateMutationLoading} variant="outline" size="sm">
									{t("cancel")}
								</Button>
								<Button type="submit" size="sm" loading={isCertificateMutationLoading}>
									{certificateForm.provider === "manual"
										? t("settings.subscriptions.importAction")
										: t("settings.subscriptions.issueAction")}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
				<ConfirmDialog
				open={Boolean(certificateAction)}
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
				loading={
					revokeCertificateMutation.isPending ||
					deleteCertificateMutation.isPending
				}
			/>
		</div>
	);
};
