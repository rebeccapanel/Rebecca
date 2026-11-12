import { toneClass } from "lib/tone";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Badge } from "components/ui/badge";
import { Textarea } from "components/ui/textarea";
import { Alert } from "components/ui/alert";
import { toast } from "components/ui/sonner";
import { Info, TriangleAlert } from "lucide-react";
import { CircleCheck, Clipboard, CircleAlert, Link, Plus, QrCode, Trash2 } from "lucide-react";

import { cn } from "lib/cn";
import AdvancedUserActions from "components/AdvancedUserActions";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import { PageHeader, PageLoadingSkeleton, TabSystem } from "components/ui";
import { DataSizeField } from "components/ui/data-size-field";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { NumberField } from "components/ui/number-field";
import { SegmentedControl } from "components/ui/segmented-control";
import { SegmentedMultiControl } from "components/ui/segmented-multi";
import { SettingsCard } from "components/ui/settings-card";
import { ToggleRow } from "components/ui/toggle-row";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { fetch } from "service/http";
import { AdminManagementPermission, AdminRole, UserPermissionToggle } from "types/Admin";
import type {
	AdvancedUserActionPayload,
	AdvancedUserActionScopeStatus,
	DataLimitResetStrategy,
	UserCreateWithService,
} from "types/User";
import { isUserManagementLocked } from "utils/adminTraffic";
import { copyTextToClipboard } from "utils/clipboard";

const QRCodeDialog = lazy(async () => ({
	default: (await import("components/QRCodeDialog")).QRCodeDialog,
}));

type BulkTab = "create" | "edit" | "delete" | "permissions";
type UsernameMode = "sequence" | "list";
type DeleteMode = "list" | "conditions";
type DeleteCondition = "last_online" | "status_age" | "created_before";
type BatchResult = {
	username: string;
	ok: boolean;
	detail: string;
	subscription?: string;
	links?: string[];
	// deleted again from the results card after the run
	deleted?: boolean;
};

const MAX_BATCH_SIZE = 500;
const USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,32}$/;
const DELETE_CONDITIONS: DeleteCondition[] = ["last_online", "status_age", "created_before"];
const DELETE_STATUSES: AdvancedUserActionScopeStatus[] = ["active", "on_hold", "limited", "expired", "disabled"];

const absoluteLink = (link?: string | null) => {
	if (!link) return "";
	return link.startsWith("/") ? window.location.origin + link : link;
};

const parseUsernameList = (value: string) =>
	Array.from(
		new Set(
			value
				.split(/[\n,]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	).slice(0, MAX_BATCH_SIZE);

const errorDetail = (error: unknown) => {
	if (!error || typeof error !== "object") return String(error || "Unknown error");
	const record = error as {
		data?: { detail?: string };
		response?: { _data?: { detail?: string } };
		message?: string;
	};
	return record.data?.detail || record.response?._data?.detail || record.message || "Unknown error";
};

const runLimited = async (
	usernames: string[],
	worker: (username: string) => Promise<Partial<BatchResult> | undefined>,
	concurrency = 4,
) => {
	const results = new Array<BatchResult>(usernames.length);
	let cursor = 0;
	const runner = async () => {
		while (cursor < usernames.length) {
			const index = cursor++;
			const username = usernames[index];
			try {
				const extra = await worker(username);
				results[index] = { username, ok: true, detail: "Completed", ...extra };
			} catch (error) {
				results[index] = { username, ok: false, detail: errorDetail(error) };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, usernames.length) }, () => runner()));
	return results;
};

const deleteConditionLabel = (t: (key: string) => string, condition: DeleteCondition) =>
	condition === "last_online"
		? t("bulkActions.delete.lastOnline")
		: condition === "status_age"
			? t("bulkActions.delete.statusAge")
			: t("bulkActions.delete.createdBefore");

const ResultAction = ({
	label,
	icon,
	disabled: isDisabled,
	onClick,
}: {
	label: string;
	icon: React.ReactElement;
	disabled?: boolean;
	onClick: () => void;
}) => (
	<Tooltip>
<TooltipTrigger asChild>
		<span>
			<Button aria-label={label} disabled={isDisabled} onClick={onClick} variant="ghost" size="sm" className="size-8 p-0">
				{icon}
			</Button>
		</span>
	</TooltipTrigger>
<TooltipContent>{label}</TooltipContent>
</Tooltip>
);

const NameChips = ({ names, marked }: { names: string[]; marked: (name: string) => "invalid" | "taken" | null }) => (
	<div className="flex flex-row flex-wrap items-center gap-1.5">
		{names.map((name) => {
			const state = marked(name);
			return (
				<code
					key={name}
					className={cn(
						"rounded-md px-2 py-0.5 font-mono text-[0.8125rem]",
						state === null && "bg-panel-elevated text-panel-text",
						state === "taken" && "bg-panel-warning/15 text-panel-warning",
						state === "invalid" && "bg-panel-danger/15 text-panel-danger",
					)}
				>
					{name}
				</code>
			);
		})}
	</div>
);

const Results = ({
	results,
	canDelete = false,
	onDeleted,
}: {
	results: BatchResult[];
	canDelete?: boolean;
	onDeleted?: (usernames: string[]) => void;
}) => {
	const { t } = useTranslation();
	
	const setQRCode = useDashboard((state) => state.setQRCode);
	const setSubLink = useDashboard((state) => state.setSubLink);
	const performBulkUserAction = useDashboard((state) => state.performBulkUserAction);
	const refetchUsers = useDashboard((state) => state.refetchUsers);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	if (!results.length) return null;

	// users this run created that are still there
	const createdNames = results.filter((result) => result.ok && !result.deleted).map((result) => result.username);
	const succeeded = results.filter((result) => result.ok).length;
	const live = results.filter((result) => !result.deleted);
	const allLinks = live.map((result) => result.subscription).filter(Boolean).join("\n");
	const allConfigs = live.flatMap((result) => result.links ?? []).join("\n");

	const copy = async (text: string) => {
		if (!text) return;
		try {
			await copyTextToClipboard(text);
			toast.success(t("copied"), { duration: 1200 });
		} catch {
			toast.error(t("usersTable.copyFailed"));
		}
	};

	const deleteCreated = async () => {
		setDeleting(true);
		try {
			const result = await performBulkUserAction({ action: "delete_users", usernames: createdNames });
			toast.success(t("bulkActions.delete.completed"), { description: t("bulkActions.delete.completedDescription", { count: result.count }) });
			onDeleted?.(createdNames);
			void refetchUsers(true);
		} catch (error) {
			toast.error(t("bulkActions.delete.failed"), { description: errorDetail(error) });
		} finally {
			setDeleting(false);
			setConfirmDelete(false);
		}
	};

	return (
		<SettingsCard
			title={t("bulkActions.results.title")}
			description={t("bulkActions.results.summary", { success: succeeded, failed: results.length - succeeded })}
			actions={
				<>
					{allLinks ? (
						<Button onClick={() => void copy(allLinks)} variant="outline" size="xs">
							<Link className="w-[14px]" />
							{t("bulkActions.results.copyAllLinks")}
						</Button>
					) : null}
					{allConfigs ? (
						<Button onClick={() => void copy(allConfigs)} variant="outline" size="xs">
							<Clipboard className="w-[14px]" />
							{t("bulkActions.results.copyAllConfigs")}
						</Button>
					) : null}
					{canDelete && createdNames.length > 0 ? (
						<Button onClick={() => setConfirmDelete(true)} variant="outline" size="xs" loading={deleting} className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">
							<Trash2 className="w-[14px]" />
							{t("bulkActions.results.deleteCreated")}
						</Button>
					) : null}
					<Badge className={toneClass(succeeded === results.length ? "green" : "orange")}>
						{succeeded}/{results.length}
					</Badge>
				</>
			}
		>
			<div className="-mx-4 -mb-4 divide-y divide-panel-border border-t border-panel-border! md:-mx-5 md:-mb-5">
				{results.map((result) => {
					const hasLinks = !result.deleted && Boolean(result.subscription || result.links?.length);
					return (
						<div key={result.username} className="flex flex-row items-center justify-between gap-4 px-4 py-2 md:px-5">
							<div className="flex min-w-0 flex-row items-center gap-2.5">
								<span
									className={cn(
										"shrink-0",
										result.deleted ? "text-panel-text-muted" : result.ok ? "text-panel-success" : "text-panel-danger",
									)}
								>
									{result.deleted ? (
										<Trash2 className="size-4" />
									) : result.ok ? (
										<CircleCheck className="size-4" />
									) : (
										<CircleAlert className="size-4" />
									)}
								</span>
								<span className="truncate font-mono text-[0.875rem] text-panel-text">{result.username}</span>
							</div>
							{result.ok && hasLinks ? (
								<div className="flex shrink-0 flex-row items-center gap-0.5">
									<ResultAction
										label={t("usersTable.copyLink")}
										icon={<Link className="w-[16px]" />}
										disabled={!result.subscription}
										onClick={() => void copy(result.subscription ?? "")}
									/>
									<ResultAction
										label={t("usersTable.copyConfigs")}
										icon={<Clipboard className="w-[16px]" />}
										disabled={!result.links?.length}
										onClick={() => void copy((result.links ?? []).join("\n"))}
									/>
									<ResultAction
										label={t("usersTable.qrCode")}
										icon={<QrCode className="w-[16px]" />}
										onClick={() => {
											setQRCode(result.links ?? [], result.username);
											setSubLink(result.subscription || null);
										}}
									/>
								</div>
							) : (
								<p className={cn("shrink-0 text-[0.8125rem]", result.ok ? "text-panel-text-muted" : "text-panel-danger")}>
									{result.deleted ? t("bulkActions.results.deleted") : result.detail}
								</p>
							)}
						</div>
					);
				})}
			</div>
			<ConfirmDialog
				open={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				onConfirm={deleteCreated}
				loading={deleting}
				colorScheme="red"
				confirmLabel={t("bulkActions.results.deleteCreated")}
				title={t("bulkActions.results.deleteCreatedTitle", { count: createdNames.length })}
				description={t("bulkActions.results.deleteCreatedDescription", {
					names:
						createdNames.slice(0, 10).join(", ") + (createdNames.length > 10 ? `, +${createdNames.length - 10}` : ""),
				})}
			/>
		</SettingsCard>
	);
};

const BulkCreatePanel = ({
	canConfigurePeriodicUsageReset,
	canDelete,
}: {
	canConfigurePeriodicUsageReset: boolean;
	canDelete: boolean;
}) => {
	const { t } = useTranslation();
	
	const refetchUsers = useDashboard((state) => state.refetchUsers);
	const serviceOptions = useServicesStore((state) => state.serviceOptions);
	const fetchServiceOptions = useServicesStore((state) => state.fetchServiceOptions);
	const isOptionsLoading = useServicesStore((state) => state.isOptionsLoading);
	const [mode, setMode] = useState<UsernameMode>("sequence");
	const [prefix, setPrefix] = useState("user");
	const [suffix, setSuffix] = useState("");
	const [start, setStart] = useState("1");
	const [count, setCount] = useState("10");
	const [padding, setPadding] = useState("3");
	const [list, setList] = useState("");
	const [serviceID, setServiceID] = useState("");
	const [status, setStatus] = useState<"active" | "on_hold">("active");
	const [dataLimitGb, setDataLimitGb] = useState("");
	const [validityDays, setValidityDays] = useState("30");
	const [ipLimit, setIPLimit] = useState("0");
	const [autoDeleteDays, setAutoDeleteDays] = useState("0");
	const [resetStrategy, setResetStrategy] = useState<DataLimitResetStrategy>("no_reset");
	const [note, setNote] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [results, setResults] = useState<BatchResult[]>([]);
	const [existingNames, setExistingNames] = useState<Set<string>>(new Set());

	useEffect(() => {
		if (!serviceOptions.length) void fetchServiceOptions({ limit: 1000 });
	}, [fetchServiceOptions, serviceOptions.length]);

	const usernames = useMemo(() => {
		if (mode === "list") return parseUsernameList(list);
		const parsedStart = Math.max(0, Math.floor(Number(start) || 0));
		const parsedCount = Math.min(MAX_BATCH_SIZE, Math.max(0, Math.floor(Number(count) || 0)));
		const parsedPadding = Math.min(8, Math.max(0, Math.floor(Number(padding) || 0)));
		return Array.from({ length: parsedCount }, (_, index) => {
			const serial = String(parsedStart + index).padStart(parsedPadding, "0");
			return `${prefix}${serial}${suffix}`;
		});
	}, [count, list, mode, padding, prefix, start, suffix]);

	const invalidNames = usernames.filter((username) => !USERNAME_PATTERN.test(username));

	useEffect(() => {
		const names = usernames.filter((username) => USERNAME_PATTERN.test(username));
		if (!names.length) {
			setExistingNames(new Set());
			return;
		}
		let cancelled = false;
		const timer = setTimeout(async () => {
			const found = new Set<string>();
			for (let index = 0; index < names.length; index += 100) {
				const batch = names.slice(index, index + 100);
				try {
					const response = await fetch<{ users?: Array<{ username: string }> }>("/users", {
						query: { username: batch, limit: batch.length },
					});
					for (const user of response?.users ?? []) {
						found.add(user.username.toLowerCase());
					}
				} catch {
					// the preview just stays unmarked
				}
			}
			if (!cancelled) setExistingNames(found);
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [usernames]);

	const existingCount = usernames.filter((username) => existingNames.has(username.toLowerCase())).length;
	const dataLimitValue = Number(dataLimitGb) || 0;
	const canSubmit =
		usernames.length > 0 &&
		invalidNames.length === 0 &&
		Number(serviceID) > 0 &&
		(status !== "on_hold" || Number(validityDays) > 0);

	const handleCreate = async () => {
		if (!canSubmit) return;
		setIsRunning(true);
		setResults([]);
		const now = Math.floor(Date.now() / 1000);
		const days = Math.max(0, Number(validityDays) || 0);
		const limitBytes = Math.max(0, dataLimitValue) * 1024 ** 3;
		const normalizedIPLimit = Math.max(0, Math.floor(Number(ipLimit) || 0));
		const normalizedAutoDelete = Math.max(0, Math.floor(Number(autoDeleteDays) || 0));
		// one at a time, so the users are created (and listed) in the order of their names
		const batchResults = await runLimited(
			usernames,
			async (username) => {
				const body: UserCreateWithService = {
					username,
					service_id: Number(serviceID),
					status,
					expire: status === "active" && days > 0 ? now + days * 86400 : 0,
					data_limit: Math.round(limitBytes),
					ip_limit: normalizedIPLimit,
					data_limit_reset_strategy:
						limitBytes > 0 && canConfigurePeriodicUsageReset ? resetStrategy : "no_reset",
					on_hold_expire_duration: status === "on_hold" ? Math.round(days * 86400) : null,
					note: note.replaceAll("{username}", username),
					telegram_id: null,
					contact_number: null,
					flow: null,
					auto_delete_in_days: normalizedAutoDelete > 0 ? normalizedAutoDelete : null,
				};
				const created = await fetch<{ subscription_url?: string | null; links?: string[] | null }>("/v2/users", {
					method: "POST",
					body,
				});
				return {
					subscription: absoluteLink(created?.subscription_url),
					links: created?.links ?? [],
				};
			},
			1,
		);
		setResults(batchResults);
		setIsRunning(false);
		void refetchUsers(true);
		const succeeded = batchResults.filter((result) => result.ok).length;
		toast(t("bulkActions.create.completed"), { description: t("bulkActions.results.summary", { success: succeeded, failed: batchResults.length - succeeded }) });
	};

	const serviceName = serviceOptions.find((service) => String(service.id) === serviceID)?.name ?? "-";
	const resetLabel =
		resetStrategy === "day"
			? t("userDialog.resetStrategyDaily")
			: resetStrategy === "week"
				? t("userDialog.resetStrategyWeekly")
				: resetStrategy === "month"
					? t("userDialog.resetStrategyMonthly")
					: resetStrategy === "year"
						? t("yearly")
						: t("noReset");
	const createSummary: Array<[string, string]> = [
		[t("bulkActions.create.service"), serviceName],
		[t("bulkActions.create.status"), status === "on_hold" ? t("userDialog.onHoldActive") : t("active")],
		[t("bulkActions.create.dataLimit"), dataLimitValue > 0 ? `${dataLimitValue} GB` : t("myaccount.unlimited")],
		[t("bulkActions.create.validity"), Number(validityDays) > 0 ? `${Number(validityDays)} ${t("days", "days")}` : t("myaccount.unlimited")],
		[t("bulkActions.create.ipLimit"), Number(ipLimit) > 0 ? ipLimit : t("myaccount.unlimited")],
		[t("bulkActions.create.reset"), resetLabel],
		[t("bulkActions.create.autoDelete"), Number(autoDeleteDays) > 0 ? `${Number(autoDeleteDays)} ${t("days", "days")}` : t("myaccount.unlimited")],
		[t("bulkActions.create.note"), note.trim() || "-"],
	];

	const markName = (name: string) => {
		if (!USERNAME_PATTERN.test(name)) return "invalid" as const;
		if (existingNames.has(name.toLowerCase())) return "taken" as const;
		return null;
	};

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
				<div className="flex min-w-0 flex-col gap-4">
					<SettingsCard
						title={t("bulkActions.create.usernames")}
						description={t("bulkActions.create.usernamesHelp")}
						actions={
							<SegmentedControl<UsernameMode>
								label={t("bulkActions.create.usernames")}
								value={mode}
								options={[
									{ value: "sequence", label: t("bulkActions.create.sequence") },
									{ value: "list", label: t("bulkActions.create.list") },
								]}
								onChange={(next) => setMode(next)}
							/>
						}
					>
						{mode === "sequence" ? (
							<div className="grid grid-cols-2 gap-4 md:grid-cols-5">
								<FormField label={t("bulkActions.create.prefix")}>
									<UiInput value={prefix} onChange={(event) => setPrefix(event.target.value)} />
								</FormField>
								<FormField label={t("bulkActions.create.suffix")}>
									<UiInput value={suffix} onChange={(event) => setSuffix(event.target.value)} />
								</FormField>
								<FormField label={t("bulkActions.create.start")}>
									<NumberField inputMode="numeric" min={0} value={start} doneLabel={t("common.done")} onChange={setStart} />
								</FormField>
								<FormField label={t("bulkActions.create.count")}>
									<NumberField inputMode="numeric" min={1} max={MAX_BATCH_SIZE} value={count} doneLabel={t("common.done")} onChange={setCount} />
								</FormField>
								<FormField label={t("bulkActions.create.padding")}>
									<NumberField inputMode="numeric" min={0} max={8} value={padding} doneLabel={t("common.done")} onChange={setPadding} />
								</FormField>
							</div>
						) : (
							<FormField label={t("bulkActions.create.listLabel")} description={t("bulkActions.create.listHelp")}>
								<Textarea value={list} onChange={(event) => setList(event.target.value)} rows={6} className="font-mono" />
							</FormField>
						)}
					</SettingsCard>

					<SettingsCard title={t("bulkActions.create.defaults")} description={t("bulkActions.create.defaultsHelp")}>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormField label={t("bulkActions.create.service")}>
								<Select value={serviceID} onChange={(event) => setServiceID(event.target.value)} disabled={isOptionsLoading}>
									<option value="">{t("bulkActions.create.selectService")}</option>
									{serviceOptions
										.filter((service) => service.has_hosts && !service.broken)
										.map((service) => (
											<option key={service.id} value={service.id}>
												{service.name}
											</option>
										))}
								</Select>
							</FormField>
							<FormField label={t("bulkActions.create.status")}>
								<SegmentedControl<"active" | "on_hold">
									label={t("bulkActions.create.status")}
									value={status}
									options={[
										{ value: "active", label: t("active") },
										{ value: "on_hold", label: t("userDialog.onHoldActive") },
									]}
									onChange={(next) => setStatus(next)}
								/>
							</FormField>
							<FormField label={t("bulkActions.create.dataLimit")} description={t("bulkActions.create.gbZero")}>
								<DataSizeField valueGb={dataLimitGb} onChangeGb={setDataLimitGb} />
							</FormField>
							<FormField
								label={t("bulkActions.create.validity")}
								description={status === "on_hold" ? t("bulkActions.create.onHoldDays") : t("bulkActions.create.daysZero")}
							>
								<NumberField inputMode="numeric" min={0} value={validityDays} doneLabel={t("common.done")} onChange={setValidityDays} />
							</FormField>
							<FormField label={t("bulkActions.create.ipLimit")} description={t("bulkActions.create.zeroUnlimited")}>
								<NumberField inputMode="numeric" min={0} value={ipLimit} doneLabel={t("common.done")} onChange={setIPLimit} />
							</FormField>
							<FormField label={t("bulkActions.create.reset")}>
								<Select
									value={resetStrategy}
									onChange={(event) => setResetStrategy(event.target.value as DataLimitResetStrategy)}
									disabled={dataLimitValue <= 0 || !canConfigurePeriodicUsageReset}
								>
									<option value="no_reset">{t("noReset")}</option>
									<option value="day">{t("userDialog.resetStrategyDaily")}</option>
									<option value="week">{t("userDialog.resetStrategyWeekly")}</option>
									<option value="month">{t("userDialog.resetStrategyMonthly")}</option>
									<option value="year">{t("yearly")}</option>
								</Select>
							</FormField>
							<FormField label={t("bulkActions.create.autoDelete")} description={t("bulkActions.create.autoDeleteHelp")}>
								<NumberField inputMode="numeric" min={0} value={autoDeleteDays} doneLabel={t("common.done")} onChange={setAutoDeleteDays} />
							</FormField>
							<div className="md:col-span-2">
								<FormField label={t("bulkActions.create.note")} description={t("bulkActions.create.noteHelp")}>
									<UiInput value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("bulkActions.create.notePlaceholder")} />
								</FormField>
							</div>
						</div>
					</SettingsCard>
				</div>

				<div className="flex flex-col gap-4 xl:sticky xl:top-4">
					<SettingsCard
						title={`${t("bulkActions.preview")} (${usernames.length})`}
						actions={
							<Button onClick={handleCreate} disabled={!canSubmit} size="sm" loading={isRunning} className="w-full">
								<Plus className="w-[18px]" />
								{t("bulkActions.create.submit", { count: usernames.length })}
							</Button>
						}
					>
						{usernames.length ? (
							<NameChips names={usernames.slice(0, 40)} marked={markName} />
						) : (
							<p className="text-panel-text-muted">{t("noData")}</p>
						)}
						{usernames.length > 40 ? (
							<p className="text-[0.8125rem] text-panel-text-muted">+{usernames.length - 40}</p>
						) : null}
						{invalidNames.length > 0 ? (
							<Alert variant="destructive" className="rounded-md">
								<CircleAlert className="size-4" aria-hidden="true" />
								{t("bulkActions.invalidUsernames", { count: invalidNames.length })}
							</Alert>
						) : null}
						{existingCount > 0 ? (
							<Alert className="rounded-md">
								<TriangleAlert className="size-4" aria-hidden="true" />
								{t("bulkActions.create.existing", { count: existingCount })}
							</Alert>
						) : null}
					</SettingsCard>
					<SettingsCard title={t("bulkActions.create.summary")} description={t("bulkActions.create.summaryHelp")}>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[0.8125rem]">
							{createSummary.map(([label, value]) => (
								<div key={label} className="contents">
									<dt className="text-panel-text-muted">{label}</dt>
									<dd className="min-w-0 truncate text-panel-text" title={value}>{value}</dd>
								</div>
							))}
						</dl>
					</SettingsCard>
				</div>
			</div>

			<Results
				results={results}
				canDelete={canDelete}
				onDeleted={(names) =>
					setResults((prev) =>
						prev.map((result) => (names.includes(result.username) ? { ...result, deleted: true } : result)),
					)
				}
			/>
		</div>
	);
};

const BulkDeletePanel = () => {
	const { t } = useTranslation();
	
	const performBulkUserAction = useDashboard((state) => state.performBulkUserAction);
	const refetchUsers = useDashboard((state) => state.refetchUsers);
	const [list, setList] = useState("");
	const [mode, setMode] = useState<DeleteMode>("list");
	const [conditions, setConditions] = useState<DeleteCondition[]>(["status_age"]);
	const [lastOnlineDays, setLastOnlineDays] = useState("");
	const [statusAgeDays, setStatusAgeDays] = useState("");
	const [createdBeforeDays, setCreatedBeforeDays] = useState("");
	const [statuses, setStatuses] = useState<AdvancedUserActionScopeStatus[]>(["expired"]);
	const [previewCount, setPreviewCount] = useState<number | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const usernames = useMemo(() => parseUsernameList(list), [list]);
	const invalidNames = usernames.filter((username) => !USERNAME_PATTERN.test(username));

	const resetPreview = () => {
		setPreviewCount(null);
		setConfirmed(false);
	};

	const toggleCondition = (condition: DeleteCondition) => {
		setConditions((current) =>
			current.includes(condition) ? current.filter((item) => item !== condition) : [...current, condition],
		);
		resetPreview();
	};

	const buildPayload = (): AdvancedUserActionPayload | null => {
		if (mode === "list") {
			if (!usernames.length || invalidNames.length) return null;
			return { action: "delete_users", usernames };
		}
		if (!conditions.length) return null;
		const parseDays = (value: string) => Math.floor(Number(value));
		const payload: AdvancedUserActionPayload = { action: "delete_users" };
		if (conditions.includes("last_online")) {
			const value = parseDays(lastOnlineDays);
			if (!Number.isFinite(value) || value <= 0) return null;
			payload.last_online_days = value;
		}
		if (conditions.includes("status_age")) {
			const value = parseDays(statusAgeDays);
			if (!Number.isFinite(value) || value <= 0 || !statuses.length) return null;
			payload.status_age_days = value;
			payload.scope = statuses;
		}
		if (conditions.includes("created_before")) {
			const value = parseDays(createdBeforeDays);
			if (!Number.isFinite(value) || value <= 0) return null;
			payload.created_before_days = value;
		}
		return payload;
	};

	const payload = buildPayload();

	const handlePreview = async () => {
		if (!payload) return;
		setIsRunning(true);
		try {
			const result = await performBulkUserAction({ ...payload, dry_run: true });
			setPreviewCount(result.count);
			setConfirmed(false);
		} catch (error) {
			toast.error(t("bulkActions.delete.previewFailed"), { description: errorDetail(error) });
		} finally {
			setIsRunning(false);
		}
	};

	const handleDelete = async () => {
		if (!confirmed || previewCount === null || !payload) return;
		setIsRunning(true);
		try {
			const result = await performBulkUserAction(payload);
			toast.success(t("bulkActions.delete.completed"), { description: t("bulkActions.delete.completedDescription", { count: result.count }) });
			setPreviewCount(null);
			setConfirmed(false);
			void refetchUsers(true);
		} catch (error) {
			toast.error(t("bulkActions.delete.failed"), { description: errorDetail(error) });
		} finally {
			setIsRunning(false);
		}
	};

	const remainingConditions = DELETE_CONDITIONS.filter((condition) => !conditions.includes(condition));

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<Alert variant="destructive" className="rounded-md">
				<CircleAlert className="size-4" aria-hidden="true" />
				{t("bulkActions.delete.warning")}
			</Alert>

			<SettingsCard
				title={t("bulkActions.tabs.delete")}
				description={mode === "list" ? t("bulkActions.create.listHelp") : t("bulkActions.delete.conditionsHelp")}
				actions={
					<SegmentedControl<DeleteMode>
						label={t("bulkActions.tabs.delete")}
						value={mode}
						options={[
							{ value: "list", label: t("bulkActions.delete.byUsernames") },
							{ value: "conditions", label: t("bulkActions.delete.byConditions") },
						]}
						onChange={(next) => {
							setMode(next);
							resetPreview();
						}}
					/>
				}
			>
				{mode === "list" ? (
					<>
						<FormField label={t("bulkActions.delete.usernames")}>
							<Textarea value={list} onChange={(event) => {
									setList(event.target.value);
									resetPreview();
								}} rows={6} className="font-mono" />
						</FormField>
						{invalidNames.length > 0 ? (
							<Alert variant="destructive" className="rounded-md">
								<CircleAlert className="size-4" aria-hidden="true" />
								{t("bulkActions.invalidUsernames", { count: invalidNames.length })}
							</Alert>
						) : null}
					</>
				) : (
					<div className="flex flex-col gap-3">
						{conditions.map((condition) => {
							const value =
								condition === "last_online" ? lastOnlineDays : condition === "status_age" ? statusAgeDays : createdBeforeDays;
							const setValue = (next: string) => {
								if (condition === "last_online") setLastOnlineDays(next);
								else if (condition === "status_age") setStatusAgeDays(next);
								else setCreatedBeforeDays(next);
								resetPreview();
							};
							return (
								<div key={condition} className="flex flex-col gap-3 rounded-lg border border-panel-border! bg-panel-elevated/40 p-4">
									<div className="flex flex-row items-center justify-between gap-3">
										<p className="font-semibold text-panel-text">{deleteConditionLabel(t, condition)}</p>
										<Button onClick={() => toggleCondition(condition)} variant="ghost" size="xs">
											<Trash2 className="w-[14px]" />
											{t("remove")}
										</Button>
									</div>
									<div className={cn("grid grid-cols-1 gap-4", condition === "status_age" && "md:grid-cols-2")}>
										<FormField
											label={
												condition === "last_online"
													? t("bulkActions.delete.lastOnlineLabel")
													: condition === "status_age"
														? t("bulkActions.delete.statusAgeLabel")
														: t("bulkActions.delete.createdBeforeLabel")
											}
										>
											<NumberField inputMode="numeric" min={1} value={value} doneLabel={t("common.done")} onChange={setValue} />
										</FormField>
										{condition === "status_age" ? (
											<FormField label={t("bulkActions.delete.statuses")}>
												<SegmentedMultiControl
													label={t("bulkActions.delete.statuses")}
													value={statuses}
													options={DELETE_STATUSES.map((status) => ({
														value: status,
														label: t(`filters.advancedActions.scopeStatuses.${status}`, status),
													}))}
													onChange={(next) => {
														setStatuses(next as AdvancedUserActionScopeStatus[]);
														resetPreview();
													}}
												/>
											</FormField>
										) : null}
									</div>
								</div>
							);
						})}
						{remainingConditions.length > 0 ? (
							<div className="flex flex-row flex-wrap gap-2">
								{remainingConditions.map((condition) => (
									<Button key={condition} onClick={() => toggleCondition(condition)} variant="outline" size="sm">
										<Plus className="w-[14px]" />
										{deleteConditionLabel(t, condition)}
									</Button>
								))}
							</div>
						) : null}
					</div>
				)}

				{previewCount !== null ? (
					<Alert className="rounded-md">
						<Info className="size-4" aria-hidden="true" />
						{previewCount > MAX_BATCH_SIZE
							? t("bulkActions.delete.tooMany", { count: previewCount, max: MAX_BATCH_SIZE })
							: t("bulkActions.delete.preview", { count: previewCount })}
					</Alert>
				) : null}

				<div className="flex flex-col gap-3 border-t border-panel-border! pt-4 md:flex-row md:items-center md:justify-between">
					<div className="flex flex-row flex-wrap items-center gap-3">
						<Button onClick={handlePreview} disabled={!payload} variant="outline" size="sm" loading={isRunning}>
							{t("bulkActions.delete.previewAction")}
						</Button>
						{previewCount !== null && previewCount > 0 && previewCount <= MAX_BATCH_SIZE ? (
							<ToggleRow
								title={t("bulkActions.delete.confirm", { count: previewCount })}
								checked={confirmed}
								onChange={setConfirmed}
							/>
						) : null}
					</div>
					<Button disabled={!confirmed || previewCount === null || previewCount === 0 || previewCount > MAX_BATCH_SIZE || !payload} onClick={handleDelete} variant="destructive" size="sm" loading={isRunning}>
						<Trash2 className="w-[18px]" />
						{t("bulkActions.delete.submit", { count: previewCount ?? 0 })}
					</Button>
				</div>
			</SettingsCard>
		</div>
	);
};

const BulkPermissionsPanel = () => {
	const { t } = useTranslation();
	
	const bulkUpdateStandardPermissions = useAdminsStore((store) => store.bulkUpdateStandardPermissions);
	const [permissions, setPermissions] = useState<UserPermissionToggle[]>([
		UserPermissionToggle.Create,
		UserPermissionToggle.Delete,
		UserPermissionToggle.ResetUsage,
		UserPermissionToggle.PeriodicUsageReset,
		UserPermissionToggle.Revoke,
	]);
	const [isRunning, setIsRunning] = useState(false);
	const options = useMemo(
		() => [
			{ key: UserPermissionToggle.Create, label: t("admins.bulkPermissions.create") },
			{ key: UserPermissionToggle.Delete, label: t("admins.bulkPermissions.delete") },
			{ key: UserPermissionToggle.ResetUsage, label: t("admins.bulkPermissions.resetUsage") },
			{ key: UserPermissionToggle.PeriodicUsageReset, label: t("admins.bulkPermissions.periodicUsageReset") },
			{ key: UserPermissionToggle.Revoke, label: t("admins.bulkPermissions.revoke") },
			{ key: UserPermissionToggle.CreateOnHold, label: t("admins.bulkPermissions.createOnHold") },
			{ key: UserPermissionToggle.AllowUnlimitedData, label: t("admins.bulkPermissions.allowUnlimitedData") },
			{ key: UserPermissionToggle.AllowUnlimitedExpire, label: t("admins.bulkPermissions.allowUnlimitedExpire") },
			{ key: UserPermissionToggle.AllowNextPlan, label: t("admins.bulkPermissions.allowNextPlan") },
			{ key: UserPermissionToggle.AdvancedActions, label: t("admins.bulkPermissions.advancedActions") },
			{ key: UserPermissionToggle.SetFlow, label: t("admins.bulkPermissions.setFlow") },
			{ key: UserPermissionToggle.AllowCustomKey, label: t("admins.bulkPermissions.allowCustomKey") },
		],
		[t],
	);

	const toggle = (key: UserPermissionToggle) =>
		setPermissions((current) =>
			current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
		);

	const apply = async (mode: "disable" | "restore") => {
		if (!permissions.length) return;
		setIsRunning(true);
		try {
			const result = await bulkUpdateStandardPermissions({ mode, permissions });
			toast.success(t("admins.bulkPermissions.success"), { description: t("admins.bulkPermissions.successDescription", { count: result.updated ?? 0 }) });
		} catch (error) {
			toast.error(t("admins.bulkPermissions.error"), { description: errorDetail(error) });
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<Alert className="rounded-md">
				<TriangleAlert className="size-4" aria-hidden="true" />
				{t("admins.bulkPermissions.subtitle")}
			</Alert>
			<SettingsCard
				title={t("admins.bulkPermissions.title")}
				description={t("admins.bulkPermissions.help")}
				actions={
					<>
						<Button onClick={() => apply("disable")} disabled={!permissions.length} variant="destructive" size="sm" loading={isRunning}>
							{t("admins.bulkPermissions.disable")}
						</Button>
						<Button onClick={() => apply("restore")} disabled={!permissions.length} variant="outline" size="sm" loading={isRunning}>
							{t("admins.bulkPermissions.restore")}
						</Button>
					</>
				}
			>
				<div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
					{options.map((option) => (
						<ToggleRow
							key={option.key}
							title={option.label}
							checked={permissions.includes(option.key)}
							onChange={() => toggle(option.key)}
						/>
					))}
				</div>
			</SettingsCard>
		</div>
	);
};

export const BulkActionsPage = () => {
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const { userData, getUserIsPending } = useGetUser();
	const permissions = userData.permissions?.users;
	const privileged = userData.role === AdminRole.FullAccess;
	const canEditAdmins = Boolean(userData.permissions?.admin_management?.[AdminManagementPermission.Edit] || privileged);
	const locked = isUserManagementLocked(userData);
	const isQRCodeDialogOpen = useDashboard((state) => state.QRcodeLinks !== null);

	const allowedTabs = useMemo(
		() =>
			[
				(privileged || permissions?.[UserPermissionToggle.Create]) && "create",
				(privileged || permissions?.[UserPermissionToggle.AdvancedActions]) && "edit",
				(privileged || permissions?.[UserPermissionToggle.Delete]) && "delete",
				canEditAdmins && "permissions",
			].filter(Boolean) as BulkTab[],
		[canEditAdmins, permissions, privileged],
	);
	const hashTab = location.hash.replace(/^#/, "") as BulkTab;
	const activeTab = allowedTabs.includes(hashTab) ? hashTab : allowedTabs[0];

	useEffect(() => {
		if (activeTab && location.hash !== `#${activeTab}`) {
			navigate({ hash: activeTab }, { replace: true });
		}
	}, [activeTab, location.hash, navigate]);

	if (getUserIsPending) {
		return <PageLoadingSkeleton variant="settings" />;
	}

	const tabs = allowedTabs.map((tab) => ({
		value: tab,
		label: t(`bulkActions.tabs.${tab}`, tab === "permissions" ? "Admin permissions" : tab),
		isActive: activeTab === tab,
		onClick: () => navigate({ hash: tab }),
	}));

	return (
		<div dir={i18n.dir(i18n.language)} className="flex flex-col gap-5 items-stretch w-full">
			<PageHeader title={t("bulkActions.title")} description={t("bulkActions.subtitle")} />
			{tabs.length > 0 ? <TabSystem tabs={tabs} className="overflow-x-auto overflow-y-hidden max-w-full master-settings-tabs" /> : null}

			{locked && activeTab !== "permissions" ? (
				<Alert className="rounded-md">
					<TriangleAlert className="size-4" aria-hidden="true" />
					{t("bulkActions.locked")}
				</Alert>
			) : activeTab === "create" ? (
				<BulkCreatePanel
					canDelete={privileged || Boolean(permissions?.[UserPermissionToggle.Delete])}
					canConfigurePeriodicUsageReset={privileged || Boolean(permissions?.[UserPermissionToggle.PeriodicUsageReset])}
				/>
			) : activeTab === "edit" ? (
				<div className="w-full">
					<AdvancedUserActions embedded />
				</div>
			) : activeTab === "delete" ? (
				<BulkDeletePanel />
			) : activeTab === "permissions" ? (
				<BulkPermissionsPanel />
			) : (
				<Alert className="rounded-md">
					<Info className="size-4" aria-hidden="true" />
					{t("bulkActions.noPermission")}
				</Alert>
			)}
			{isQRCodeDialogOpen ? (
				<Suspense fallback={null}>
					<QRCodeDialog />
				</Suspense>
			) : null}
		</div>
	);
};

export default BulkActionsPage;
