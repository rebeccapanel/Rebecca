import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Alert } from "components/ui/alert";
import { Checkbox } from "components/ui/checkbox";
import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { NumberField } from "components/ui/number-field";
import { CheckRow } from "components/ui/check-row";
import { OverviewBand } from "components/ui/overview-band";
import { ToggleRow } from "components/ui/toggle-row";
import { FormSection } from "components/ui/form-section";
import { SearchInput } from "components/common/SearchInput";
import { DEFAULT_SEARCH_MATCH_OPTIONS } from "utils/searchMatch";
import { AppWindow, Settings2, Download, ExternalLink, RefreshCw, Upload, Database, Code, Settings, FolderOpen, Ban, Send, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "lib/cn";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import { DataTable, PageLoadingSkeleton, DataTableColumn, DataTableRowAction } from "components/ui";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
	deleteExternalApp,
	exportExternalAppDatabase,
	getExternalApps,
	getSubscriptionSettings,
	installFaoxima,
	installMirzaBot,
	installExternalArchive,
	setExternalAppEnabled,
	updateExternalAppSettings,
	updateExternalMirzaBot,
	type ExternalAppRecord,
} from "service/settings";

type TemplateID = "archive" | "mirzabot" | "faoxima";
type ArchiveRuntime = "php" | "static" | "node";

const ExternalAppFilesModal = lazy(async () => ({
	default: (await import("components/ExternalAppFilesModal"))
		.ExternalAppFilesModal,
}));

const externalShell =
	"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

const requiredLabel = (text: ReactNode) => (
	<span>
		{text} <span className="text-red-500">*</span>
	</span>
);

const errorDetail = (error: unknown) => {
	const candidate = error as {
		data?: { detail?: string };
		response?: { _data?: { detail?: string } };
		message?: string;
	};
	return (
		candidate?.data?.detail ||
		candidate?.response?._data?.detail ||
		candidate?.message ||
		String(error)
	);
};

export const ExternalAppsPage = () => {
	const { t, i18n } = useTranslation();
	
	const queryClient = useQueryClient();
	const panelBg = "bg-panel-elevated";
	const borderColor = "border-panel-border!";
	const mutedColor = "panel.textSecondary";
	const [template, setTemplate] = useState<TemplateID>("mirzabot");
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [appSearch, setAppSearch] = useState("");
	const [appSearchMatch, setAppSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [domain, setDomain] = useState("");
	const [name, setName] = useState("");
	const [archiveRuntime, setArchiveRuntime] = useState<ArchiveRuntime>("php");
	const [archive, setArchive] = useState<File | null>(null);
	const [createDatabase, setCreateDatabase] = useState(false);
	const [database, setDatabase] = useState("");
	const [databaseUser, setDatabaseUser] = useState("");
	const [databasePassword, setDatabasePassword] = useState("");
	const [botToken, setBotToken] = useState("");
	const [adminID, setAdminID] = useState("");
	const [hasDatabaseBackup, setHasDatabaseBackup] = useState(false);
	const [databaseBackup, setDatabaseBackup] = useState<File | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ExternalAppRecord | null>(
		null,
	);
	const [updateTarget, setUpdateTarget] = useState<ExternalAppRecord | null>(
		null,
	);
	const [settingsTarget, setSettingsTarget] =
		useState<ExternalAppRecord | null>(null);
	const [indexFile, setIndexFile] = useState("");
	const [fallbackToIndex, setFallbackToIndex] = useState(false);
	const [maxRequestBodyMB, setMaxRequestBodyMB] = useState(32);
	const [staticCacheSeconds, setStaticCacheSeconds] = useState(3600);
	const [notFoundFile, setNotFoundFile] = useState("");
	const [keepDatabase, setKeepDatabase] = useState(true);
	const [managedApp, setManagedApp] = useState<ExternalAppRecord | null>(null);
	const [managerView, setManagerView] = useState<"file" | "php-config">("file");

	const appsQuery = useQuery({ queryKey: ["external-apps"], queryFn: getExternalApps, refetchOnWindowFocus: false, });
	const certificatesQuery = useQuery({ queryKey: ["subscription-settings"], queryFn: getSubscriptionSettings, refetchOnWindowFocus: false,
			enabled: appsQuery.data?.supported === true, });
	const apps = appsQuery.data?.apps ?? [];
	const usedRootDomains = useMemo(
		() => new Set(apps.filter((app) => !app.path).map((app) => app.domain)),
		[apps],
	);
	const certificateOptions = useMemo(() => {
		const seen = new Set<string>();
		return (certificatesQuery.data?.certificates ?? [])
			.filter(
				(certificate) =>
					certificate.serve_tls &&
					(certificate.status === "active" ||
						certificate.status === "expiring"),
			)
			.flatMap((certificate) => [
				certificate.domain,
				...(certificate.alt_names ?? []),
			])
			.filter((name) => {
				const key = name.toLowerCase();
				if (
					key === window.location.hostname.toLowerCase() ||
					seen.has(key) ||
					(template === "archive" && usedRootDomains.has(key))
				)
					return false;
				seen.add(key);
				return true;
			})
			.map((name) => ({ value: name, label: name, searchLabel: name }));
	}, [certificatesQuery.data?.certificates, template, usedRootDomains]);
	const selectedTemplate = appsQuery.data?.templates?.find(
		(item) => item.id === template,
	);
	const generateDatabaseCredentials = () => {
		const values = new Uint8Array(20);
		globalThis.crypto.getRandomValues(values);
		const password = Array.from(values, (value) =>
			value.toString(16).padStart(2, "0"),
		).join("");
		const suffix = password.slice(0, 10);
		setDatabase(`app_${suffix}`);
		setDatabaseUser(`app_${suffix}`);
		setDatabasePassword(password);
	};

	const installMutation = useMutation({ mutationFn: async () => {
			if (!domain) throw new Error(t("externalApps.errors.domainRequired"));
			if (template === "archive") {
				if (!name.trim())
					throw new Error(t("externalApps.errors.nameRequired"));
				if (
					createDatabase &&
					(!database.trim() || !databaseUser.trim() || !databasePassword)
				) {
					throw new Error(t("externalApps.errors.databaseFieldsRequired"));
				}
				return installExternalArchive({
					domain,
					name: name.trim(),
					runtime: archiveRuntime,
					archive: archive ?? undefined,
					create_database: createDatabase,
					database: database.trim(),
					database_user: databaseUser.trim(),
					database_password: databasePassword,
				});
			}
			if (!botToken.trim() || !adminID.trim()) {
				throw new Error(t("externalApps.errors.botFieldsRequired"));
			}
			if (hasDatabaseBackup && !databaseBackup) {
				throw new Error(t("externalApps.errors.databaseBackupRequired"));
			}
			const install = template === "mirzabot" ? installMirzaBot : installFaoxima;
			return install({
				domain,
				bot_token: botToken.trim(),
				admin_id: adminID.trim(),
				database_backup: hasDatabaseBackup
					? (databaseBackup ?? undefined)
					: undefined,
			});
		}, onSuccess: async () => {
				toast.success(t("externalApps.installSuccess"));
				setDomain("");
				setName("");
				setArchiveRuntime("php");
				setArchive(null);
				if (template !== "archive" || !createDatabase) {
					setCreateDatabase(false);
					setDatabase("");
					setDatabaseUser("");
					setDatabasePassword("");
				}
				setBotToken("");
				setAdminID("");
				setHasDatabaseBackup(false);
				setDatabaseBackup(null);
				setCreateDialogOpen(false);
				await queryClient.invalidateQueries({ queryKey: ["external-apps"] });
			},
			onError: (error) => {
				toast.error(t("externalApps.installFailed"), { description: errorDetail(error) });
			}, });

	const toggleMutation = useMutation({ mutationFn: setExternalAppEnabled, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["external-apps"] }),
		onError: (error) => {
			toast.error(t("externalApps.actionFailed"), { description: errorDetail(error) });
		}, });

	const deleteMutation = useMutation({ mutationFn: deleteExternalApp, onSuccess: () => {
			toast.success(t("externalApps.deleteSuccess"));
			setDeleteTarget(null);
			queryClient.invalidateQueries({ queryKey: ["external-apps"] });
		},
		onError: (error) => {
			toast.error(t("externalApps.actionFailed"), { description: errorDetail(error) });
		}, });

	const updateMutation = useMutation({ mutationFn: updateExternalMirzaBot, onSuccess: (app) => {
			toast.success(t("externalApps.updateSuccess", { version: app.version }));
			setUpdateTarget(null);
			queryClient.invalidateQueries({ queryKey: ["external-apps"] });
		},
		onError: (error) => {
			toast.error(t("externalApps.updateFailed"), { description: errorDetail(error) });
		}, });

	const databaseBackupMutation = useMutation({ mutationFn: (app: ExternalAppRecord) => exportExternalAppDatabase(app.id), onSuccess: (blob, app) => {
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement("a");
				const label = (app.bot_username || app.id).replace(
					/[^A-Za-z0-9_-]/g,
					"_",
				);
				anchor.href = url;
				anchor.download = `${app.template}-${label}.sql`;
				document.body.appendChild(anchor);
				anchor.click();
				anchor.remove();
				URL.revokeObjectURL(url);
				toast.success(t("externalApps.databaseBackupReady"));
			},
			onError: (error) => {
				toast.error(t("externalApps.databaseBackupFailed"), { description: errorDetail(error) });
			}, });

	const settingsMutation = useMutation({ mutationFn: updateExternalAppSettings, onSuccess: () => {
			toast.success(t("externalApps.settingsSaved"));
			setSettingsTarget(null);
			queryClient.invalidateQueries({ queryKey: ["external-apps"] });
		},
		onError: (error) => {
			toast.error(t("externalApps.actionFailed"), { description: errorDetail(error) });
		}, });

	const confirmDelete = (app: ExternalAppRecord) => {
		setKeepDatabase(app.has_database);
		setDeleteTarget(app);
	};
	const openManager = (app: ExternalAppRecord, view: "file" | "php-config") => {
		setManagerView(view);
		setManagedApp(app);
	};
	const openSettings = (app: ExternalAppRecord) => {
		setIndexFile(app.index_file);
		setFallbackToIndex(app.fallback_to_index);
		setMaxRequestBodyMB(app.max_request_body_mb || 32);
		setStaticCacheSeconds(app.static_cache_seconds ?? 3600);
		setNotFoundFile(app.not_found_file || "");
		setSettingsTarget(app);
	};

	const appColumns = useMemo<DataTableColumn<ExternalAppRecord>[]>(
		() => [
			{
				id: "name",
				sortValue: (app) => app.name ?? "",
				header: t("externalApps.name"),
				isPrimary: true,
				priority: "primary",
				mobilePriority: 0,
				cell: (app) => (
					<div className="flex flex-col gap-0 min-w-0! items-start">
						<p className="font-semibold truncate">
							{app.template === "mirzabot"
								? "MirzaBot"
								: app.template === "faoxima"
									? "Faoxima"
									: app.name}
						</p>
						<p className={cn(mutedColor, "text-[0.75rem] truncate")}>
							{app.bot_username
								? `@${app.bot_username.replace(/^@/, "")}`
								: app.id}
						</p>
					</div>
				),
			},
			{
				id: "url",
				sortValue: (app) => app.domain ?? "",
				header: t("externalApps.domainCertificate"),
				priority: "high",
				mobilePriority: 1,
				mobileMetaLabel: t("externalApps.domainCertificate"),
				cell: (app) => (
					<p dir="ltr" title={app.public_url} className="truncate">
						{app.domain}
						{app.path ? `/${app.path}` : ""}
					</p>
				),
			},
			{
				id: "runtime",
				sortValue: (app) => app.runtime ?? "",
				header: t("externalApps.runtime"),
				priority: "medium",
				mobilePriority: 2,
				mobileMetaLabel: t("externalApps.runtime"),
				cell: (app) => (
					<div className="flex flex-row items-center gap-1.5 flex-wrap">
						<Badge>
							{app.template === "mirzabot"
								? "MirzaBot"
								: app.template === "faoxima"
									? "Faoxima"
								: app.runtime.toUpperCase()}
						</Badge>
						{app.php_version ? (
							<Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-200">PHP {app.php_version}</Badge>
						) : null}
						{app.version ? (
							<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">{app.version}</Badge>
						) : null}
					</div>
				),
			},
			{
				id: "status",
				sortValue: (app) => (app.enabled ? 1 : 0),
				header: t("status"),
				priority: "high",
				mobilePriority: 3,
				mobileMetaLabel: t("status"),
				cell: (app) => (
					<Badge className={toneClass(app.enabled ? "green" : "gray")}>
						{app.enabled
							? t("externalApps.enabled")
							: t("externalApps.disabled")}
					</Badge>
				),
			},
			{
				id: "installed_at",
				sortValue: (app) => Date.parse(app.installed_at ?? "") || 0,
				header: t("externalApps.installedAt"),
				priority: "low",
				hideBelow: "xl",
				mobileMetaLabel: t("externalApps.installedAt"),
				cell: (app) => (
					<p className="text-[0.875rem]">
						{app.installed_at
							? new Date(app.installed_at).toLocaleString()
							: "—"}
					</p>
				),
			},
		],
		[t],
	);

	const appRowActions = (
		app: ExternalAppRecord,
	): DataTableRowAction<ExternalAppRecord>[] => {
		const actions: DataTableRowAction<ExternalAppRecord>[] = [];
		const botUsername = app.bot_username?.replace(/^@/, "");
		if (app.update_available) {
			actions.push({
				id: "update",
				label: t("externalApps.update"),
				icon: <RefreshCw className="w-[16px]" />,
				onClick: () => setUpdateTarget(app),
			});
		}
		if ((app.template === "mirzabot" || app.template === "faoxima") && app.has_database) {
			actions.push({
				id: "database-backup",
				label: t("externalApps.downloadDatabaseBackup"),
				icon: <Download className="w-[16px]" />,
				onClick: () => databaseBackupMutation.mutate(app),
				disabled: databaseBackupMutation.isPending,
			});
		}
		actions.push(
			{
				id: "files",
				label: t("externalApps.files.button"),
				icon: <FolderOpen className="w-[16px]" />,
				onClick: () => openManager(app, "file"),
			},
			...(app.runtime === "php"
				? [
						{
							id: "php-settings",
							label: t("externalApps.files.phpConfig"),
							icon: <Code className="w-[16px]" />,
							onClick: () => openManager(app, "php-config"),
						},
					]
				: []),
			...(app.runtime !== "node"
				? [
						{
							id: "settings",
							label: t("externalApps.settings"),
							icon: <Settings className="w-[16px]" />,
							onClick: () => openSettings(app),
						},
					]
				: []),
			{
				id: "open",
				label: t("externalApps.open"),
				icon: <ExternalLink className="w-[16px]" />,
				onClick: () =>
					window.open(app.public_url, "_blank", "noopener,noreferrer"),
			},
			...(botUsername
				? [
						{
							id: "open-bot",
							label: t("externalApps.openBot"),
							icon: <Send className="w-[16px]" />,
							onClick: () =>
								window.open(
									`https://t.me/${encodeURIComponent(botUsername)}`,
									"_blank",
									"noopener,noreferrer",
								),
						},
					]
				: []),
			{
				id: "toggle",
				label: app.enabled
					? t("externalApps.disable")
					: t("externalApps.enable"),
				icon: app.enabled ? (
					<Ban className="w-[16px]" />
				) : (
					<Play className="w-[16px]" />
				),
				onClick: () =>
					toggleMutation.mutate({ id: app.id, enabled: !app.enabled }),
				disabled: toggleMutation.isPending,
			},
			{
				id: "delete",
				label: t("externalApps.delete"),
				icon: <Trash2 className="w-[16px]" />,
				onClick: () => confirmDelete(app),
				disabled: deleteMutation.isPending,
				isDanger: true,
			},
		);
		return actions;
	};

	const locale = i18n.language || "en";
	const visibleApps = apps.filter((app) => !appSearch.trim() || `${app.name} ${app.domain}`.toLowerCase().includes(appSearch.trim().toLowerCase()));
	const appOverview = {
		total: { label: t("externalApps.installedApps"), value: apps.length, caption: `${t("externalApps.enabled")}: ${apps.filter((app) => app.enabled).length}` },
		rows: [
			{ key: "enabled", label: t("externalApps.enabled"), value: apps.filter((app) => app.enabled).length, tone: "bg-panel-success" },
			{ key: "database", label: t("externalApps.databaseSettings"), value: apps.filter((app) => app.has_database).length, tone: "bg-panel-accent" },
		],
		distribution: {
			label: t("externalApps.runtime"),
			segments: [
				{ key: "php", label: "PHP", value: apps.filter((app) => app.runtime === "php").length, tone: "bg-panel-accent" },
				{ key: "node", label: "Node.js", value: apps.filter((app) => app.runtime === "node").length, tone: "bg-panel-success" },
				{ key: "static", label: t("externalApps.staticRuntime"), value: apps.filter((app) => app.runtime === "static").length, tone: "bg-panel-info" },
			],
		},
		extra: { label: t("externalApps.disabled"), value: apps.filter((app) => !app.enabled).length },
	};
	if (appsQuery.isLoading) {
		return <PageLoadingSkeleton />;
	}
	if (appsQuery.data?.supported === false) {
		return (
			<div className="flex flex-col gap-5">
				<div>
					<h2 className="font-heading font-bold text-[1.5rem] leading-[1.33] md:text-[1.875rem] md:leading-[1.2]">{t("externalApps.title")}</h2>
					<p className={cn(mutedColor, "mt-2")}>
						{t("externalApps.description")}
					</p>
				</div>
				<Alert className="rounded-md">
					<TriangleAlert className="size-4" aria-hidden="true" />
					<p>{t("externalApps.unsupported")}</p>
				</Alert>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<ConfirmDialog
				open={Boolean(updateTarget)}
				title={t("externalApps.update")}
				description={t("externalApps.updateConfirm", {
					version: updateTarget?.latest_version,
				})}
				confirmLabel={t("externalApps.update")}
				loading={updateMutation.isPending}
				onClose={() => setUpdateTarget(null)}
				onConfirm={async () => {
					if (updateTarget) await updateMutation.mutateAsync(updateTarget.id);
				}}
			/>
			<ConfirmDialog
				open={Boolean(deleteTarget)}
				title={t("externalApps.delete")}
				description={
					<div className="flex flex-col gap-3">
						<p>
							{t("externalApps.deleteConfirm", {
								name: deleteTarget?.name,
							})}
						</p>
						{deleteTarget?.has_database ? (
							<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={keepDatabase} onCheckedChange={(checked: boolean) => setKeepDatabase(checked)} /><span>{t("externalApps.keepDatabase")}</span></label>
						) : null}
					</div>
				}
				confirmLabel={t("externalApps.delete")}
				colorScheme="red"
				loading={deleteMutation.isPending}
				onClose={() => setDeleteTarget(null)}
				onConfirm={async () => {
					if (!deleteTarget) return;
					await deleteMutation.mutateAsync({
						id: deleteTarget.id,
						keep_database: deleteTarget.has_database && keepDatabase,
					});
				}}
			/>
			{managedApp && (
				<Suspense fallback={null}>
					<ExternalAppFilesModal
						app={managedApp}
						initialView={managerView}
						onClose={() => setManagedApp(null)}
					/>
				</Suspense>
			)}
			<Dialog open={Boolean(settingsTarget)} onOpenChange={(next) => { if (!next) setSettingsTarget(null); }}>
				<DialogContent className={externalShell}>
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Settings2 className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{t("externalApps.settingsTitle")}</DialogTitle>
							<DialogDescription className="truncate">{settingsTarget?.name || ""}</DialogDescription>
						</div>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<div className="flex flex-col gap-5">
							<FormSection title={t("externalApps.routingSettings")}>
								<FormField label={requiredLabel(t("externalApps.indexFile"))} description={t("externalApps.indexFileHint")}>
									<UiInput value={indexFile} onChange={(event) => setIndexFile(event.target.value)} placeholder="index.php" autoComplete="off" />
								</FormField>
								<ToggleRow title={t("externalApps.fallbackToIndex")} hint={t("externalApps.fallbackToIndexHint")} checked={fallbackToIndex} onChange={(next) => setFallbackToIndex(next)} />
								<FormField label={t("externalApps.notFoundFile")} description={t("externalApps.notFoundFileHint")}>
									<UiInput value={notFoundFile} onChange={(event) => setNotFoundFile(event.target.value)} placeholder="404.html" autoComplete="off" />
								</FormField>
							</FormSection>
							<FormSection title={t("externalApps.performanceSettings")}>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={requiredLabel(t("externalApps.maxRequestBody"))} description={t("externalApps.maxRequestBodyHint")}>
										<NumberField inputMode="numeric" min={1} max={32} value={String(maxRequestBodyMB ?? "")} doneLabel={t("common.done")} onChange={(raw) => setMaxRequestBodyMB(Number(raw))} />
									</FormField>
									<FormField label={requiredLabel(t("externalApps.staticCache"))} description={t("externalApps.staticCacheHint")}>
										<NumberField inputMode="numeric" min={0} max={31536000} value={String(staticCacheSeconds ?? "")} doneLabel={t("common.done")} onChange={(raw) => setStaticCacheSeconds(Number(raw))} />
									</FormField>
								</div>
							</FormSection>
						</div>
					</div>
					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={() => setSettingsTarget(null)} variant="outline" size="sm">
							{t("close")}
						</Button>
						<Button disabled={
								!indexFile.trim() ||
								maxRequestBodyMB < 1 ||
								maxRequestBodyMB > 32 ||
								staticCacheSeconds < 0 ||
								staticCacheSeconds > 31536000
							} onClick={() => {
								if (!settingsTarget) return;
								settingsMutation.mutate({
									id: settingsTarget.id,
									index_file: indexFile.trim(),
									fallback_to_index: fallbackToIndex,
									max_request_body_mb: maxRequestBodyMB,
									static_cache_seconds: staticCacheSeconds,
									not_found_file: notFoundFile.trim(),
								});
							}} size="sm" loading={settingsMutation.isPending}>
							{t("save")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<div>
				<h2 className="font-heading font-bold text-[1.5rem] leading-[1.33] md:text-[1.875rem] md:leading-[1.2]">{t("externalApps.title")}</h2>
				<p className={cn(mutedColor, "mt-2")}>
					{t("externalApps.description")}
				</p>
			</div>

			<Alert className="rounded-md">
				<Info className="size-4" aria-hidden="true" />
				<p className="text-[0.875rem]">{t("externalApps.resourceHint")}</p>
			</Alert>

			<Dialog open={createDialogOpen} onOpenChange={(next) => { if (!next && !installMutation.isPending) setCreateDialogOpen(false); }}>
				<DialogContent className={externalShell}>
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<AppWindow className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{t("externalApps.newApp")}</DialogTitle>
							<DialogDescription className="truncate">{t("externalApps.description")}</DialogDescription>
						</div>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<div className="flex flex-col gap-5">
							{!appsQuery.data?.supported ? (
								<Alert className="rounded-md">
									<TriangleAlert className="size-4" aria-hidden="true" />
									{appsQuery.data?.detail || t("externalApps.unsupported")}
								</Alert>
							) : null}
							<FormSection>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("externalApps.template")} description={selectedTemplate?.source_url ? undefined : undefined}>
										<Select
											value={template}
											onValueChange={(value) => setTemplate(value as TemplateID)}
											options={[
												{ value: "mirzabot", label: t("externalApps.mirzaTemplate") },
												{ value: "faoxima", label: t("externalApps.faoximaTemplate") },
												{ value: "archive", label: t("externalApps.archiveTemplate") },
											]}
										/>
										{(template === "mirzabot" || template === "faoxima") && selectedTemplate?.source_url ? (
											<a href={selectedTemplate.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-primary">
												{t(template === "faoxima" ? "externalApps.latestFaoximaRelease" : "externalApps.latestRelease")}
												<ExternalLink className="w-[14px]" />
											</a>
										) : null}
									</FormField>
									<FormField label={requiredLabel(t("externalApps.domainCertificate"))} description={t("externalApps.certificateHint")}>
										<Select
											value={domain}
											onValueChange={(value) => setDomain(String(value))}
											options={certificateOptions}
											placeholder={t("externalApps.selectDomain")}
											showSearch
											emptyText={t("externalApps.noCertificates")}
										/>
										<RouterLink to="/settings#ssl" className="mt-1 inline-flex text-sm text-primary">
											{t("externalApps.openSSLManager")}
										</RouterLink>
									</FormField>
								</div>
							</FormSection>

							{template !== "archive" ? (
								<FormSection>
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={requiredLabel(t("externalApps.botToken"))}>
											<UiInput type="password" value={botToken} onChange={(event) => setBotToken(event.target.value)} autoComplete="off" />
										</FormField>
										<FormField label={requiredLabel(t("externalApps.telegramAdminID"))}>
											<UiInput value={adminID} onChange={(event) => setAdminID(event.target.value)} inputMode="numeric" />
										</FormField>
									</div>
									<CheckRow checked={hasDatabaseBackup} onChange={(next) => {
											setHasDatabaseBackup(next);
											if (!next) setDatabaseBackup(null);
										}}>
										{t(template === "faoxima" ? "externalApps.faoximaDatabaseBackupToggle" : "externalApps.databaseBackupToggle")}
									</CheckRow>
									{hasDatabaseBackup ? (
										<FormField label={requiredLabel(t("externalApps.databaseBackup"))} description={t("externalApps.databaseBackupHint")}>
											<UiInput type="file" accept=".sql,application/sql,text/sql,text/plain" onChange={(event) => setDatabaseBackup(event.target.files?.[0] ?? null)} className="pt-1.5" />
										</FormField>
									) : null}
								</FormSection>
							) : (
								<FormSection>
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={requiredLabel(t("externalApps.name"))}>
											<UiInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
										</FormField>
										<FormField label={t("externalApps.runtime")} description={archive ? t("externalApps.runtimeDetectedHint") : t("externalApps.emptyRuntimeHint")}>
											<Select
												value={archiveRuntime}
												disabled={Boolean(archive)}
												onValueChange={(value) => setArchiveRuntime(value as ArchiveRuntime)}
												options={[
													{ value: "php", label: "PHP" },
													{ value: "node", label: "Node.js" },
													{ value: "static", label: t("externalApps.staticRuntime") },
												]}
											/>
										</FormField>
									</div>
									<FormField label={t("externalApps.zipArchive")} description={t("externalApps.archiveHint")}>
										<UiInput type="file" accept=".zip,application/zip" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} className="pt-1.5" />
									</FormField>
									<CheckRow checked={createDatabase} onChange={(next) => setCreateDatabase(next)}>
										{t("externalApps.createDatabase")}
									</CheckRow>
									{createDatabase ? (
										<div className="flex flex-col gap-4 rounded-lg border bg-card/40 p-4">
											<div className="flex flex-row flex-wrap items-center justify-between gap-2">
												<div className="flex flex-row items-center gap-2">
													<Database className="w-[18px]" />
													<p className="text-sm font-semibold">{t("externalApps.databaseSettings")}</p>
												</div>
												<Button onClick={generateDatabaseCredentials} variant="outline" size="sm">
													<Sparkles className="w-[16px]" />
													{t("externalApps.generateDatabaseCredentials")}
												</Button>
											</div>
											<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
												<FormField label={requiredLabel(t("externalApps.databaseName"))}>
													<UiInput value={database} maxLength={64} autoComplete="off" onChange={(event) => setDatabase(event.target.value)} />
												</FormField>
												<FormField label={requiredLabel(t("externalApps.databaseUser"))}>
													<UiInput value={databaseUser} maxLength={32} autoComplete="off" onChange={(event) => setDatabaseUser(event.target.value)} />
												</FormField>
												<FormField label={requiredLabel(t("externalApps.databasePassword"))}>
													<UiInput type="text" value={databasePassword} maxLength={128} autoComplete="new-password" onChange={(event) => setDatabasePassword(event.target.value)} />
												</FormField>
											</div>
											<p className="text-xs text-muted-foreground">{t("externalApps.databaseCredentialsHint")}</p>
										</div>
									) : null}
								</FormSection>
							)}

							{selectedTemplate?.detail ? (
								<p className="text-sm text-orange-300">{selectedTemplate.detail}</p>
							) : null}
						</div>
					</div>
					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={() => setCreateDialogOpen(false)} disabled={installMutation.isPending} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button disabled={
								!appsQuery.data?.supported ||
								selectedTemplate?.supported === false ||
								!domain ||
								(template === "archive" && !name.trim())
							} onClick={() => installMutation.mutate()} size="sm" loading={installMutation.isPending}>
							<Upload className="w-[18px]" />
							{t("externalApps.install")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div className="flex flex-col gap-3">
				<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
					<OverviewBand total={appOverview.total} rows={appOverview.rows} distribution={appOverview.distribution} extra={appOverview.extra} locale={locale} />
					<div className="border-t border-panel-border! p-3">
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="min-w-0 flex-1">
								<SearchInput containerProps={{ className: "w-full md:w-[360px]" }} placeholder={t("search")} value={appSearch} onChange={(event) => setAppSearch(event.target.value)} matchOptions={appSearchMatch} onMatchOptionsChange={setAppSearchMatch} />
							</div>
							<div className="flex shrink-0 justify-end gap-1.5">
								<Button onClick={() => setCreateDialogOpen(true)}>
									<Plus className="w-[16px] h-[16px]" />
									{t("externalApps.create")}
								</Button>
							</div>
						</div>
					</div>
				</div>
				<DataTable
					ariaLabel={t("externalApps.installedApps")}
					data={visibleApps}
					columns={appColumns}
					getRowId={(app) => app.id}
					loading={appsQuery.isLoading}
					emptyState={<p className={mutedColor}>{t("externalApps.empty")}</p>}
					rowActions={appRowActions}

					actionsPlacement="end"
					actionsColumnWidth="60px"

					mobileBreakpoint="md"
				/>
			</div>
		</div>
	);
};

export default ExternalAppsPage;
