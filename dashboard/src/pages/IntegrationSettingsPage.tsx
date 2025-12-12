import {
	Alert,
	AlertIcon,
	Box,
	Button,
	chakra,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	Heading,
	HStack,
	Input,
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
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ArrowsRightLeftIcon,
	ArrowUpTrayIcon,
	PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import useGetUser from "hooks/useGetUser";
import { type ReactNode, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { fetch as apiFetch } from "service/http";
import {
	getPanelSettings,
	getTelegramSettings,
	type PanelSettingsResponse,
	type TelegramSettingsResponse,
	type TelegramSettingsUpdatePayload,
	updatePanelSettings,
	updateTelegramSettings,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";

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
		watch,
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

	const forumTopics = watch("forum_topics");
	const isTelegramEnabled = watch("use_telegram");
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
			<Tabs colorScheme="primary">
				<TabList>
					<Tab>{t("settings.panel.tabTitle")}</Tab>
					<Tab>{t("settings.telegram")}</Tab>
					<Tab isDisabled>{t("settings.tabs.comingSoon")}</Tab>
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
					<TabPanel>
						<Text color="gray.500">{t("settings.tabs.comingSoon")}</Text>
					</TabPanel>
				</TabPanels>
			</Tabs>
		</Box>
	);
};
