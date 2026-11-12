import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Spinner } from "components/ui/spinner";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Clipboard, Eye, EyeOff, Key, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import type { ApexOptions } from "apexcharts";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import ReactApexChart from "react-apexcharts";
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useColorMode } from "lib/color-mode";
import { cn } from "lib/cn";

import { AccountSecurity } from "components/AccountSecurity";
import { DateRangePicker, type DateRangeValue } from "components/common/DateRangePicker";
import { PageHeader, PageLoadingSkeleton, TabSystem } from "components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { SegmentedControl } from "components/ui/segmented-control";
import { SettingsCard } from "components/ui/settings-card";
import useGetUser from "hooks/useGetUser";
import { useClipboard } from "hooks/useClipboard";
import {
	changeMyAccountPassword,
	createApiKey,
	deleteApiKey,
	getAdminNodesUsage,
	getMyAccount,
	listApiKeys,
} from "service/myaccount";
import { AdminRole } from "types/Admin";
import type { AdminApiKey } from "types/ApiKey";
import type {
	MyAccountNodeUsage,
	MyAccountResponse,
	MyAccountServiceLimit,
	MyAccountTrafficBasis,
	MyAccountUsagePoint,
} from "types/MyAccount";
import { formatBytes } from "utils/formatByte";
import { clearClientSession } from "utils/session";

dayjs.extend(utc);

type AccountSection = "info" | "security" | "api_keys";

const ACCOUNT_SECTION_HASH: Record<AccountSection, string> = {
	info: "info",
	security: "security",
	api_keys: "api-keys",
};

const LIFETIME_OPTIONS = ["1m", "3m", "6m", "12m", "forever"] as const;
type ApiKeyLifetime = (typeof LIFETIME_OPTIONS)[number];

const DIALOG_SHELL =
	"flex max-h-[min(720px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

const accountSectionFromHash = (): AccountSection | null => {
	if (typeof window === "undefined") return null;
	const hash = (window.location.hash || "").replace(/^#/, "").toLowerCase();
	return (
		(Object.entries(ACCOUNT_SECTION_HASH).find(([, value]) => value === hash)?.[0] as
			| AccountSection
			| undefined) ?? null
	);
};

const formatTimeseriesLabel = (value: string) => {
	if (!value) return value;
	const hasTime = value.includes(" ");
	const normalized = hasTime ? value.replace(" ", "T") : value;
	const parsed = dayjs.utc(normalized);
	if (!parsed.isValid()) return value;
	return hasTime ? parsed.local().format("MM-DD HH:mm") : parsed.format("YYYY-MM-DD");
};

const normalizeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const normalizeApiKeys = (value: unknown): AdminApiKey[] => {
	if (Array.isArray(value)) return value;
	if (value && typeof value === "object") {
		const payload = value as { api_keys?: unknown; apiKeys?: unknown; keys?: unknown; obj?: unknown };
		if (Array.isArray(payload.api_keys)) return payload.api_keys as AdminApiKey[];
		if (Array.isArray(payload.apiKeys)) return payload.apiKeys as AdminApiKey[];
		if (Array.isArray(payload.keys)) return payload.keys as AdminApiKey[];
		if (Array.isArray(payload.obj)) return payload.obj as AdminApiKey[];
	}
	return [];
};

const buildUsageAreaOptions = (colorMode: string, categories: string[]): ApexOptions => {
	const isDark = colorMode === "dark";
	const axisColor = isDark ? "#d8dee9" : "#1a202c";
	return {
		chart: { type: "area", toolbar: { show: false }, zoom: { enabled: false }, fontFamily: "inherit" },
		dataLabels: { enabled: false },
		stroke: { curve: "smooth", width: 2 },
		fill: {
			type: "gradient",
			gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.04, stops: [0, 85, 100] },
		},
		grid: { borderColor: isDark ? "#2D3748" : "#E2E8F0", strokeDashArray: 3 },
		xaxis: {
			categories,
			labels: { style: { colors: categories.map(() => axisColor) } },
			axisBorder: { show: false },
			axisTicks: { show: false },
			tooltip: { enabled: false },
		},
		yaxis: {
			labels: {
				formatter: (value: number) => formatBytes(Number(value) || 0, 1),
				style: { colors: [axisColor] },
			},
		},
		tooltip: {
			theme: isDark ? "dark" : "light",
			shared: true,
			fillSeriesColor: false,
			y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) },
		},
		legend: { show: false },
		colors: [isDark ? "#63B3ED" : "#3182CE"],
	};
};

const buildDonutOptions = (colorMode: string, labels: string[]): ApexOptions => ({
	labels,
	chart: { fontFamily: "inherit" },
	legend: { position: "bottom", labels: { colors: colorMode === "dark" ? "#d8dee9" : "#1a202c" } },
	dataLabels: { enabled: false },
	stroke: { width: 0 },
	plotOptions: { pie: { donut: { size: "68%" } } },
	tooltip: { y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) } },
	colors: ["#3182CE", "#63B3ED", "#ED8936", "#38A169", "#9F7AEA", "#F6AD55", "#4299E1", "#E53E3E"],
});

const getTrafficLabels = (t: TFunction, basis: MyAccountTrafficBasis) => {
	const isCreated = basis === "created_traffic";
	return {
		sectionTitle: isCreated ? t("myaccount.createdTrafficSection") : t("myaccount.dataUsage"),
		usedLabel: isCreated ? t("myaccount.createdTraffic") : t("myaccount.usedData"),
		remainingLabel: isCreated ? t("myaccount.remainingTraffic") : t("myaccount.remainingData"),
		totalLabel: isCreated ? t("myaccount.trafficLimit") : t("total"),
		dailyChartTitle: isCreated ? t("myaccount.dailyCreatedTraffic") : t("myaccount.dailyUsage"),
		dailyTotalLabel: isCreated ? t("myaccount.selectedPeriodCreatedTraffic") : t("myaccount.selectedPeriodUsage"),
		modeLabel: isCreated ? t("myaccount.serviceModeCreated") : t("myaccount.serviceModeUsed"),
	};
};

const UsageMeter: FC<{ used: number; limit: number }> = ({ used, limit }) => {
	const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
	const tone = percent >= 90 ? "bg-panel-danger" : percent >= 70 ? "bg-panel-warning" : "bg-panel-accent";
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-border">
			<div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${percent}%` }} />
		</div>
	);
};

const Metric: FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="min-w-0">
		<p className="truncate text-[0.75rem] text-panel-text-muted">{label}</p>
		<p className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular-nums text-panel-text">{value}</p>
	</div>
);

const ServiceCard: FC<{
	service: MyAccountServiceLimit;
	colorMode: string;
	t: TFunction;
	expiryText: string | null;
}> = ({ service, colorMode, t, expiryText }) => {
	const labels = getTrafficLabels(t, service.traffic_basis);
	const unlimited = t("myaccount.unlimited");
	const limit = service.data_limit ?? 0;
	const remaining = service.remaining_data ?? Math.max(limit - service.used_traffic, 0);
	const usersLimit = service.users_limit ?? 0;
	const remainingUsers = service.remaining_users ?? Math.max(usersLimit - service.current_users_count, 0);
	const points = service.daily_usage ?? [];
	const categories = points.map((point) => formatTimeseriesLabel(point.date));
	const isCreated = service.traffic_basis === "created_traffic";

	return (
		<article className="flex min-w-0 flex-col gap-3 rounded-xl border border-panel-border! bg-panel-surface p-4">
			<header className="flex flex-row items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-semibold text-panel-text">{service.service_name}</p>
					<p className="text-[0.75rem] text-panel-text-muted">{t("myaccount.serviceLimit")}</p>
				</div>
				<div className="flex shrink-0 flex-row flex-wrap justify-end gap-1.5">
					{expiryText ? <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-500/20 dark:text-orange-200">{t("myaccount.remainingDays")}: {expiryText}</Badge> : null}
					<Badge className={toneClass(isCreated ? "purple" : "blue")}>{labels.modeLabel}</Badge>
				</div>
			</header>

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-[1.25rem] font-semibold tabular-nums text-panel-text">{formatBytes(service.used_traffic, 2)}</span>
					<span className="text-[0.8125rem] text-panel-text-muted">
						/ {service.data_limit === null ? unlimited : formatBytes(limit, 2)}
					</span>
				</div>
				{service.data_limit !== null ? <UsageMeter used={service.used_traffic} limit={limit} /> : null}
			</div>

			<div className="grid grid-cols-3 gap-3">
				<Metric label={labels.remainingLabel} value={service.data_limit === null ? unlimited : formatBytes(remaining, 2)} />
				<Metric label={t("myaccount.createdUsers")} value={`${service.current_users_count}`} />
				<Metric label={t("myaccount.remainingUsers")} value={service.users_limit === null ? unlimited : `${Math.max(remainingUsers, 0)}`} />
			</div>

			{points.length > 0 ? (
				<div className="border-t border-panel-border! pt-3">
					<ReactApexChart
						type="area"
						height={130}
						options={buildUsageAreaOptions(colorMode, categories)}
						series={[{ name: labels.dailyChartTitle, data: points.map((point) => point.used_traffic) }]}
					/>
				</div>
			) : null}
		</article>
	);
};

const PasswordInput: FC<{
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	autoComplete?: string;
}> = ({ value, onChange, placeholder, autoComplete = "off" }) => {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<UiInput
				type={visible ? "text" : "password"}
				value={value}
				placeholder={placeholder}
				autoComplete={autoComplete}
				onChange={(event) => onChange(event.target.value)}
				className="pe-10"
			/>
			<button
				type="button"
				aria-label={visible ? t("admins.hidePassword") : t("admins.showPassword")}
				onClick={() => setVisible((current) => !current)}
				className="absolute inset-y-0 end-1 flex items-center px-2 text-panel-text-muted hover:text-panel-text"
			>
				{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
			</button>
		</div>
	);
};

const AccountDialog: FC<{
	open: boolean;
	onClose: () => void;
	icon: ReactNode;
	title: string;
	description?: string;
	footer: ReactNode;
	children: ReactNode;
}> = ({ open, onClose, icon, title, description, footer, children }) => (
	<Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
		<DialogContent className={DIALOG_SHELL}>
			<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">{icon}</div>
				<div className="min-w-0">
					<DialogTitle className="truncate text-base">{title}</DialogTitle>
					{description ? <DialogDescription className="truncate">{description}</DialogDescription> : null}
				</div>
			</DialogHeader>
			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				<div className="flex flex-col gap-4">{children}</div>
			</div>
			<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">{footer}</DialogFooter>
		</DialogContent>
	</Dialog>
);

const ChangePasswordDialog: FC<{
	open: boolean;
	onClose: () => void;
	onSubmit: (current: string, next: string) => Promise<void>;
}> = ({ open, onClose, onSubmit }) => {
	const { t } = useTranslation();
	
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [isSubmitting, setSubmitting] = useState(false);

	const generatePassword = useCallback(() => {
		const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const values = new Uint32Array(12);
		window.crypto.getRandomValues(values);
		setNewPassword(Array.from(values, (value) => characters[value % characters.length]).join(""));
	}, []);

	const submit = async () => {
		setSubmitting(true);
		try {
			await onSubmit(currentPassword, newPassword);
			toast.success(t("myaccount.passwordUpdated"));
			setCurrentPassword("");
			setNewPassword("");
			onClose();
		} catch (error: any) {
			toast.error(error?.detail || t("error"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<AccountDialog
			open={open}
			onClose={onClose}
			icon={<ShieldCheck className="size-4" />}
			title={t("myaccount.changePassword")}
			footer={
				<>
					<Button onClick={onClose} variant="outline" size="sm">{t("cancel")}</Button>
					<Button onClick={submit} disabled={!newPassword || !currentPassword} size="sm" loading={isSubmitting}>
						{t("save")}
					</Button>
				</>
			}
		>
			<FormField label={t("myaccount.currentPassword")}>
				<PasswordInput value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
			</FormField>
			<FormField label={t("myaccount.newPassword")}>
				<div className="flex flex-row items-stretch gap-2">
					<div className="min-w-0 flex-1">
						<PasswordInput value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
					</div>
					<Button aria-label={t("admins.generatePassword")} onClick={generatePassword} variant="outline" className="size-9 p-0">
						<Sparkles className="size-4" />
					</Button>
				</div>
			</FormField>
		</AccountDialog>
	);
};

export const MyAccountPage: FC = () => {
	const { t } = useTranslation();
	
	const queryClient = useQueryClient();
	const { colorMode } = useColorMode();
	const { onCopy, setValue: setClipboardValue } = useClipboard("");
	const { userData, getUserIsSuccess } = useGetUser();

	const [range, setRange] = useState<DateRangeValue>(() => {
		const end = dayjs().utc().endOf("day");
		const start = end.subtract(30, "day").startOf("day");
		return { start: start.toDate(), end: end.toDate(), presetKey: "1m", key: "1m" };
	});
	const [activeSection, setActiveSection] = useState<AccountSection>(() => accountSectionFromHash() ?? "info");
	const [passwordOpen, setPasswordOpen] = useState(false);
	const [createKeyOpen, setCreateKeyOpen] = useState(false);
	const [lifetime, setLifetime] = useState<ApiKeyLifetime>("1m");
	const [generatedKey, setGeneratedKey] = useState("");
	const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);
	const [deletePassword, setDeletePassword] = useState("");

	const username = userData?.username;
	const isFullAccess = userData?.role === AdminRole.FullAccess;
	const basePermissions = userData?.permissions?.self_permissions;
	const selfPermissions = isFullAccess
		? { self_myaccount: true, self_change_password: true, self_api_keys: true, self_sessions: true, self_2fa: true }
		: {
				self_myaccount: Boolean(basePermissions?.self_myaccount),
				self_change_password: Boolean(basePermissions?.self_change_password),
				self_api_keys: Boolean(basePermissions?.self_api_keys),
				self_sessions: Boolean(basePermissions?.self_sessions),
				self_2fa: Boolean(basePermissions?.self_2fa),
			};
	const canViewSecurity = selfPermissions.self_change_password || selfPermissions.self_sessions || selfPermissions.self_2fa;

	const sections = useMemo<Array<{ id: AccountSection; label: string }>>(
		() => [
			{ id: "info", label: t("myaccount.info") },
			...(canViewSecurity ? [{ id: "security" as const, label: t("myaccount.security") }] : []),
			...(selfPermissions.self_api_keys ? [{ id: "api_keys" as const, label: t("myaccount.apiKeys") }] : []),
		],
		[canViewSecurity, selfPermissions.self_api_keys, t],
	);
	const currentSection: AccountSection = sections.some((section) => section.id === activeSection) ? activeSection : "info";

	useEffect(() => {
		const syncFromHash = () => {
			const requested = accountSectionFromHash();
			setActiveSection(requested && sections.some((section) => section.id === requested) ? requested : "info");
		};
		syncFromHash();
		window.addEventListener("hashchange", syncFromHash);
		return () => window.removeEventListener("hashchange", syncFromHash);
	}, [sections]);

	const selectSection = (id: AccountSection) => {
		setActiveSection(id);
		const expectedHash = `#${ACCOUNT_SECTION_HASH[id]}`;
		if (window.location.hash !== expectedHash) {
			window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${expectedHash}`);
		}
	};

	const rangeParams = {
		start: `${dayjs(range.start).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
		end: `${dayjs(range.end).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`,
	};

	const { data, isLoading, isFetching } = useQuery<MyAccountResponse>({
		queryKey: ["myaccount", range.start, range.end],
		queryFn: () => getMyAccount(rangeParams),
		placeholderData: keepPreviousData,
		enabled: selfPermissions.self_myaccount && getUserIsSuccess,
	});
	const trafficBasis = data?.traffic_basis ?? "used_traffic";
	const isCreatedBasis = trafficBasis === "created_traffic";
	const isPerService = Boolean(data?.use_service_traffic_limits);
	const showNodeUsage = !isCreatedBasis && !isPerService;

	const { data: nodesData } = useQuery({
		queryKey: ["myaccount-nodes", username, range.start, range.end],
		queryFn: () => (username ? getAdminNodesUsage(username, rangeParams) : Promise.resolve({ usages: [] })),
		placeholderData: keepPreviousData,
		enabled: selfPermissions.self_myaccount && Boolean(username) && getUserIsSuccess && showNodeUsage && data !== undefined,
	});

	const apiKeysQuery = useQuery<AdminApiKey[]>({
		queryKey: ["myaccount-api-keys"],
		queryFn: listApiKeys,
		enabled: selfPermissions.self_api_keys && getUserIsSuccess && currentSection === "api_keys",
	});
	const apiKeys = useMemo(() => normalizeApiKeys(apiKeysQuery.data), [apiKeysQuery.data]);

	const passwordMutation = useMutation({
		mutationFn: changeMyAccountPassword,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["myaccount"] });
		},
	});

	const createKeyMutation = useMutation({
		mutationFn: createApiKey,
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ["myaccount-api-keys"] });
			if (result?.api_key) setClipboardValue(result.api_key);
			toast.success(t("myaccount.apiKeyCreated"));
			setGeneratedKey(result?.api_key ?? "");
		},
	});

	const deleteKeyMutation = useMutation({
		mutationFn: ({ id, current_password }: { id: number; current_password: string }) => deleteApiKey(id, current_password),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["myaccount-api-keys"] });
			toast.success(t("myaccount.apiKeyDeleted"));
			closeDeleteDialog();
		},
	});

	const closeCreateDialog = () => {
		setCreateKeyOpen(false);
		setGeneratedKey("");
	};

	const closeDeleteDialog = () => {
		setDeleteKeyId(null);
		setDeletePassword("");
	};

	const handlePasswordChange = async (current: string, next: string) => {
		await passwordMutation.mutateAsync({ current_password: current, new_password: next });
		clearClientSession();
		window.location.reload();
	};

	const dailyPoints = useMemo<MyAccountUsagePoint[]>(() => normalizeArray<MyAccountUsagePoint>(data?.daily_usage), [data?.daily_usage]);
	const dailyTotal = useMemo(() => dailyPoints.reduce((sum, point) => sum + Number(point.used_traffic || 0), 0), [dailyPoints]);
	const dailyCategories = useMemo(() => dailyPoints.map((point) => formatTimeseriesLabel(point.date)), [dailyPoints]);

	const nodeUsage = useMemo<MyAccountNodeUsage[]>(() => {
		const usages = normalizeArray<any>(nodesData?.usages ?? data?.node_usages);
		return usages.map((item: any) => ({
			node_id: item.node_id ?? null,
			node_name: item.node_name || "Unknown",
			used_traffic: Number(item.used_traffic ?? (item.uplink ?? 0) + (item.downlink ?? 0)),
		}));
	}, [nodesData?.usages, data?.node_usages]);
	const nodeTotal = useMemo(() => nodeUsage.reduce((sum, item) => sum + Number(item.used_traffic || 0), 0), [nodeUsage]);

	if (!selfPermissions.self_myaccount) {
		return (
			<div className="flex flex-col gap-2 rounded-xl border border-panel-border! bg-panel-surface p-5">
				<p className="text-[1.125rem] font-semibold">{t("myaccount.forbiddenTitle")}</p>
				<p className="text-panel-text-muted">{t("myaccount.forbiddenDescription")}</p>
			</div>
		);
	}

	if (isLoading || !data) {
		return <PageLoadingSkeleton variant="settings" />;
	}

	const used = data.used_traffic || 0;
	const totalData = data.data_limit ?? 0;
	const remainingData = data.remaining_data ?? Math.max(totalData - used, 0);
	const usersLimit = data.users_limit ?? 0;
	const remainingUsers = data.remaining_users ?? Math.max(usersLimit - data.current_users_count, 0);
	const serviceLimits = normalizeArray<MyAccountServiceLimit>(data.service_limits);
	const expiryLeftMs = data.expire ? data.expire * 1000 - Date.now() : null;
	const expiryText =
		expiryLeftMs === null ? null : expiryLeftMs <= 0 ? t("status.expired") : `${Math.ceil(expiryLeftMs / 86400000)}`;
	const labels = getTrafficLabels(t, trafficBasis);
	const unlimited = t("myaccount.unlimited");
	const trafficTitle = isPerService ? t("myaccount.serviceTrafficOverview") : labels.sectionTitle;
	const totalLabel = isPerService ? t("myaccount.serviceTrafficLimit") : labels.totalLabel;
	const dailyTitle = isPerService ? t("myaccount.dailyServiceTraffic") : labels.dailyChartTitle;
	const dailyTotalLabel = isPerService ? t("myaccount.selectedPeriodServiceTraffic") : labels.dailyTotalLabel;
	const showServices = isPerService || serviceLimits.length > 0;

	const sectionTabs = sections.map((section) => ({
		value: section.id,
		label: section.label,
		isActive: currentSection === section.id,
		onClick: () => selectSection(section.id),
	}));

	return (
		<div className="flex flex-col gap-5 items-stretch">
			<PageHeader
				title={t("myaccount.title")}
				description={t("myaccount.subtitle")}
				actions={
					isFetching ? (
						<div className="flex flex-row items-center gap-2 text-panel-text-muted">
							<Spinner />
							<p className="text-[0.875rem]">{t("loading")}</p>
						</div>
					) : undefined
				}
			/>

			<TabSystem tabs={sectionTabs} className="overflow-x-auto overflow-y-hidden max-w-full master-settings-tabs" />

			{currentSection === "info" && (
				<div className="flex flex-col gap-4">
					<section className="grid grid-cols-1 overflow-hidden rounded-xl border border-panel-border! bg-panel-surface md:grid-cols-3 md:divide-x md:divide-panel-border">
						<div className="flex flex-col gap-3 p-4">
							<p className="text-[0.8125rem] font-medium text-panel-text-muted">{trafficTitle}</p>
							<p className="text-[1.5rem] font-semibold tabular-nums leading-none text-panel-text">{formatBytes(used, 2)}</p>
							{data.data_limit !== null ? <UsageMeter used={used} limit={totalData} /> : null}
							<div className="grid grid-cols-2 gap-3">
								<Metric label={labels.remainingLabel} value={data.data_limit === null ? unlimited : formatBytes(remainingData, 2)} />
								<Metric label={totalLabel} value={data.data_limit === null ? unlimited : formatBytes(totalData, 2)} />
							</div>
						</div>
						<div className="flex flex-col gap-3 p-4">
							<p className="text-[0.8125rem] font-medium text-panel-text-muted">{t("myaccount.userLimits")}</p>
							<p className="text-[1.5rem] font-semibold tabular-nums leading-none text-panel-text">{data.current_users_count}</p>
							{data.users_limit !== null ? <UsageMeter used={data.current_users_count} limit={usersLimit} /> : null}
							<div className="grid grid-cols-2 gap-3">
								<Metric label={t("myaccount.remainingUsers")} value={data.users_limit === null ? unlimited : `${Math.max(remainingUsers, 0)}`} />
								<Metric label={t("myaccount.totalUsers")} value={data.users_limit === null ? unlimited : `${usersLimit}`} />
							</div>
						</div>
						<div className="flex flex-col gap-3 p-4">
							<p className="text-[0.8125rem] font-medium text-panel-text-muted">{t("myaccount.remainingDays")}</p>
							<p className="text-[1.5rem] font-semibold tabular-nums leading-none text-panel-text">{expiryText ?? unlimited}</p>
							<div className="flex flex-row flex-wrap gap-1.5">
								<Badge className={toneClass(isCreatedBasis ? "purple" : "blue")}>{labels.modeLabel}</Badge>
								{isPerService ? <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-500/20 dark:text-gray-200">{t("myaccount.serviceTrafficLimits")}</Badge> : null}
							</div>
						</div>
					</section>

					{showServices ? (
						<SettingsCard title={t("myaccount.serviceBalances")} description={t("myaccount.serviceBalancesHint")}>
							{serviceLimits.length ? (
								<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
									{serviceLimits.map((service) => (
										<ServiceCard key={service.service_id} service={service} colorMode={colorMode} t={t} expiryText={expiryText} />
									))}
								</div>
							) : (
								<p className="text-panel-text-muted">{t("noData")}</p>
							)}
						</SettingsCard>
					) : null}

					<div className={cn("grid grid-cols-1 gap-4", showNodeUsage && "xl:grid-cols-3")}>
						<div className={cn("min-w-0", showNodeUsage && "xl:col-span-2")}>
							<SettingsCard
								title={dailyTitle}
								description={`${dailyTotalLabel}: ${formatBytes(dailyTotal, 2)}`}
								actions={<DateRangePicker value={range} onChange={(next) => setRange(next)} />}
							>
								{dailyPoints.length ? (
									<ReactApexChart
										type="area"
										height={300}
										options={buildUsageAreaOptions(colorMode, dailyCategories)}
										series={[{ name: dailyTitle, data: dailyPoints.map((point) => point.used_traffic) }]}
									/>
								) : (
									<p className="text-panel-text-muted">{t("noData")}</p>
								)}
							</SettingsCard>
						</div>
						{showNodeUsage ? (
							<div className="min-w-0">
								<SettingsCard title={t("myaccount.perNodeUsage")} description={`${t("myaccount.selectedPeriodNodeUsage")}: ${formatBytes(nodeTotal, 2)}`}>
									{nodeUsage.length > 0 && nodeUsage.some((item) => item.used_traffic > 0) ? (
										<ReactApexChart
											type="donut"
											height={300}
											options={buildDonutOptions(colorMode, nodeUsage.map((item) => item.node_name))}
											series={nodeUsage.map((item) => item.used_traffic)}
										/>
									) : (
										<p className="text-panel-text-muted">{t("noData")}</p>
									)}
								</SettingsCard>
							</div>
						) : null}
					</div>
				</div>
			)}

			{currentSection === "security" && (
				<AccountSecurity
					totpEnabled={Boolean(userData.totp_enabled)}
					canChangePassword={Boolean(selfPermissions.self_change_password)}
					canManageSessions={Boolean(selfPermissions.self_sessions)}
					canManage2FA={Boolean(selfPermissions.self_2fa)}
					onChangePassword={() => setPasswordOpen(true)}
				/>
			)}

			{currentSection === "api_keys" && (
				<SettingsCard
					title={t("myaccount.apiKeys")}
					description={t("myaccount.apiKeysHint")}
					actions={
						<Button onClick={() => setCreateKeyOpen(true)} size="sm">
							<Plus className="size-4" />
							{t("myaccount.createApiKey")}
						</Button>
					}
				>
					{apiKeysQuery.isLoading ? (
						<div className="flex justify-center py-6">
							<Spinner />
						</div>
					) : apiKeys.length === 0 ? (
						<p className="text-panel-text-muted">{t("myaccount.noApiKeys")}</p>
					) : (
						<div className="flex flex-col gap-2">
							{apiKeys.map((key) => (
								<div key={key.id} className="flex flex-row items-center justify-between gap-3 rounded-lg border border-panel-border! bg-panel-elevated/40 px-3 py-2.5">
									<div className="flex min-w-0 flex-row items-center gap-3">
										<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-panel-elevated text-panel-accent">
											<Key className="size-4" />
										</div>
										<div className="min-w-0">
											<p className="truncate font-mono text-[0.875rem] font-semibold text-panel-text">{key.masked_key ?? "****"}</p>
											<div className="mt-1 flex flex-row flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-panel-text-muted">
												<span>{t("myaccount.apiKeyCreatedAt")}: {dayjs(key.created_at).format("YYYY-MM-DD")}</span>
												<span>
													{t("myaccount.apiKeyExpiresAt")}:{" "}
													{key.expires_at ? dayjs(key.expires_at).format("YYYY-MM-DD") : t("myaccount.never")}
												</span>
												<span>
													{t("myaccount.lastUsed")}:{" "}
													{key.last_used_at ? dayjs(key.last_used_at).format("YYYY-MM-DD HH:mm") : t("myaccount.neverUsed")}
												</span>
											</div>
										</div>
									</div>
									<Button aria-label={`${t("delete")} ${key.masked_key ?? "API key"}`} onClick={() => {
											setDeleteKeyId(key.id);
											setDeletePassword("");
										}} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 size-8 p-0">
										<Trash2 className="size-4" />
									</Button>
								</div>
							))}
						</div>
					)}
				</SettingsCard>
			)}

			<ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} onSubmit={handlePasswordChange} />

			{selfPermissions.self_api_keys && (
				<AccountDialog
					open={createKeyOpen}
					onClose={closeCreateDialog}
					icon={<Key className="size-4" />}
					title={t("myaccount.createApiKey")}
					footer={
						generatedKey ? (
							<Button onClick={closeCreateDialog} size="sm">{t("close")}</Button>
						) : (
							<>
								<Button onClick={closeCreateDialog} variant="outline" size="sm">{t("cancel")}</Button>
								<Button onClick={() => createKeyMutation.mutate(lifetime)} size="sm" loading={createKeyMutation.isPending}>
									{t("create")}
								</Button>
							</>
						)
					}
				>
					{generatedKey ? (
						<>
							<FormField label={t("myaccount.yourApiKey")}>
								<div className="flex flex-row items-stretch gap-2">
									<UiInput value={generatedKey} readOnly className="font-mono" />
									<Button aria-label={t("copy")} onClick={() => {
											setClipboardValue(generatedKey);
											onCopy();
											toast.success(t("copied"), { duration: 1200 });
										}} variant="outline" className="size-9 p-0">
										<Clipboard className="size-4" />
									</Button>
								</div>
							</FormField>
							<p className="text-[0.8125rem] text-orange-500">{t("myaccount.apiKeyWarning")}</p>
						</>
					) : (
						<FormField label={t("myaccount.apiKeyLifetime")}>
							<SegmentedControl<ApiKeyLifetime>
								label={t("myaccount.apiKeyLifetime")}
								value={lifetime}
								options={[
									{ value: "1m", label: t("myaccount.lifetime1m") },
									{ value: "3m", label: t("myaccount.lifetime3m") },
									{ value: "6m", label: t("myaccount.lifetime6m") },
									{ value: "12m", label: t("myaccount.lifetime12m") },
									{ value: "forever", label: t("myaccount.lifetimeForever") },
								]}
								onChange={(next) => setLifetime(next)}
							/>
						</FormField>
					)}
				</AccountDialog>
			)}

			{selfPermissions.self_api_keys && (
				<AccountDialog
					open={deleteKeyId !== null}
					onClose={closeDeleteDialog}
					icon={<Trash2 className="size-4" />}
					title={t("myaccount.deleteApiKey")}
					footer={
						<>
							<Button onClick={closeDeleteDialog} variant="outline" size="sm">{t("cancel")}</Button>
							<Button disabled={!deletePassword || deleteKeyId === null} onClick={() => {
									if (deleteKeyId !== null) {
										deleteKeyMutation.mutate({ id: deleteKeyId, current_password: deletePassword });
									}
								}} variant="destructive" size="sm" loading={deleteKeyMutation.isPending}>
								{t("delete")}
							</Button>
						</>
					}
				>
					<p className="text-panel-text-muted">{t("myaccount.deleteApiKeyPrompt")}</p>
					<FormField label={t("myaccount.currentPassword")}>
						<PasswordInput value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" />
					</FormField>
					{deleteKeyMutation.isError ? (
						<p className="text-[0.875rem] text-red-500">{t("myaccount.incorrectPassword")}</p>
					) : null}
				</AccountDialog>
			)}
		</div>
	);
};

export default MyAccountPage;
