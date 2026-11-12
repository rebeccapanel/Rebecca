import { toneClass } from "lib/tone";
import { Textarea } from "components/ui/textarea";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Alert } from "components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { toast } from "components/ui/sonner";
import { TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { cn } from "lib/cn";
import { Sparkles } from "lucide-react";

import { useDisclosure } from "hooks/useDisclosure";

import { PanelSelect as Select } from "components/common/PanelSelect";
import { AppDialog } from "components/dialogs/AppDialog";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import { DataSizeField } from "components/ui/data-size-field";
import { FormField } from "components/ui/form-field";
import { NumberField } from "components/ui/number-field";
import { SegmentedMultiControl } from "components/ui/segmented-multi";
import { SettingsCard } from "components/ui/settings-card";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import { GroupSelect } from "components/labels/GroupSelect";
import {
	EMPTY_LABEL_FILTER,
	LabelFilter,
	type LabelFilterValue,
} from "components/labels/LabelFilter";
import { TagsSelect } from "components/labels/TagsSelect";
import useGetUser from "hooks/useGetUser";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { NO_GROUP_FILTER, useGroups, useInvalidateLabels, useTags } from "service/labels";
import { AdminRole, AdminTrafficLimitMode } from "types/Admin";
import type { AdvancedUserActionPayload, AdvancedUserActionScopeStatus, AdvancedUserActionStatus } from "types/User";
import { isUserManagementLocked } from "utils/adminTraffic";

// `className="w-4 h-4"` (Tailwind) is a no-op in this project - there is no
// Tailwind build step - so the raw 24x24 heroicon rendered ~2.4x oversized
// next to the neighboring 16px icons. Size it the same way every other
// toolbar icon in this codebase is sized, via Chakra's style props.
const AdvancedActionsIcon = withClass(Sparkles, "w-4 h-4");

type FactorAction = "multiply_expire" | "divide_expire" | "multiply_traffic" | "divide_traffic";
const factorLabelKeys = {
	multiply_expire: "filters.advancedActions.expireSection.multiplyButton",
	divide_expire: "filters.advancedActions.expireSection.divideButton",
	multiply_traffic: "filters.advancedActions.trafficSection.multiplyButton",
	divide_traffic: "filters.advancedActions.trafficSection.divideButton",
} as const;
const cleanupOptions: AdvancedUserActionStatus[] = ["expired", "limited"];
const scopeStatusOptions: AdvancedUserActionScopeStatus[] = ["active", "on_hold", "limited", "expired", "disabled"];
const MAX_RECENT_RUNS = 8;

type OwnerSelection = "my_users" | "all_users" | `admin:${string}`;

type RecentRun = {
	id: number;
	label: string;
	ok: boolean;
	detail: string;
	time: Date;
};

type PendingRun = {
	title: string;
	description: string;
	danger: boolean;
	run: () => Promise<void>;
};

const parseTargetUsernames = (value: string) =>
	Array.from(
		new Set(
			value
				.split(/[\n,]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	).slice(0, 500);

type AdvancedUserActionsProps = {
	/** Render the trigger as a round icon button for tight toolbars. */
	compact?: boolean;
	/** Render the controls directly inside the Bulk Actions page. */
	embedded?: boolean;
};

const AdvancedUserActions = ({ compact = false, embedded = false }: AdvancedUserActionsProps) => {
	const { t } = useTranslation();
	
	const performBulkUserAction = useDashboard((state) => state.performBulkUserAction);
	const { userData } = useGetUser();
	const userManagementLocked = isUserManagementLocked(userData);
	const { isOpen, onOpen, onClose } = useDisclosure();
	const [expireDays, setExpireDays] = useState("");
	const [trafficGb, setTrafficGb] = useState("");
	const [expireFactor, setExpireFactor] = useState("");
	const [trafficFactor, setTrafficFactor] = useState("");
	const [cleanupDays, setCleanupDays] = useState("");
	const [selectedStatuses, setSelectedStatuses] = useState<AdvancedUserActionStatus[]>(["expired", "limited"]);
	const [selectedScopeStatuses, setSelectedScopeStatuses] = useState<AdvancedUserActionScopeStatus[]>(["active"]);
	const [busy, setBusy] = useState<string | null>(null);
	const [pending, setPending] = useState<PendingRun | null>(null);
	const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
	const [ownerSelection, setOwnerSelection] = useState<OwnerSelection>("my_users");
	const [selectedServiceValue, setSelectedServiceValue] = useState("");
	const [targetServiceValue, setTargetServiceValue] = useState("");
	const [targetUsernames, setTargetUsernames] = useState("");
	const [lastOnlineDays, setLastOnlineDays] = useState("");
	const [statusAgeDays, setStatusAgeDays] = useState("");
	const [createdBeforeDays, setCreatedBeforeDays] = useState("");
	const location = useLocation();
	const [labelTarget, setLabelTarget] = useState<LabelFilterValue>(() => {
		const group = new URLSearchParams(location.search).get("group");
		return group ? { ...EMPTY_LABEL_FILTER, groups: [group] } : EMPTY_LABEL_FILTER;
	});
	const [newGroupId, setNewGroupId] = useState<number | null>(null);
	const [labelTags, setLabelTags] = useState<string[]>([]);
	const { data: userGroups = [] } = useGroups("user");
	const { data: userTags = [] } = useTags("user");
	const invalidateLabels = useInvalidateLabels();
	const adminList = useAdminsStore((store) => store.adminOptions);
	const adminOptionsLoading = useAdminsStore((store) => store.adminOptionsLoading);
	const fetchAdminOptions = useAdminsStore((store) => store.fetchAdminOptions);
	const serviceOptions = useServicesStore((store) => store.serviceOptions);
	const serviceOptionsLoading = useServicesStore((store) => store.isOptionsLoading);
	const fetchServiceOptions = useServicesStore((store) => store.fetchServiceOptions);

	const hasScopeSelect = userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const canSeeServiceControls = hasScopeSelect;
	const canUseAdvanced = Boolean(userData.permissions?.users?.advanced_actions ?? true);
	const serviceTransferDisabled = Boolean(
		userData.use_service_traffic_limits || userData.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic,
	);

	useEffect(() => {
		if (!isOpen && !embedded) return;
		if (hasScopeSelect && !adminList.length && !adminOptionsLoading) {
			void fetchAdminOptions({ limit: 1000, offset: 0, sort: "username" });
		}
		if (!serviceOptions.length && !serviceOptionsLoading) {
			void fetchServiceOptions({ limit: 1000, offset: 0 });
		}
	}, [
		adminList.length,
		adminOptionsLoading,
		embedded,
		fetchAdminOptions,
		fetchServiceOptions,
		hasScopeSelect,
		isOpen,
		serviceOptions.length,
		serviceOptionsLoading,
	]);

	const resolveTargetAdminUsername = () => {
		if (!hasScopeSelect) return userData.username;
		if (ownerSelection === "all_users") return null;
		if (ownerSelection.startsWith("admin:")) return ownerSelection.replace(/^admin:/, "");
		return userData.username;
	};

	const showToast = (description: string, status: "success" | "error" | "warning") => {
		toast(t("filters.advancedActions.modalTitle"));
	};

	const resolveErrorMessage = (error?: unknown, fallback?: string) => {
		if (error && typeof error === "object") {
			const maybe = error as { data?: { detail?: string }; message?: string };
			return maybe.data?.detail || maybe.message || fallback;
		}
		return fallback;
	};

	const handleError = (message?: string) => {
		showToast(message ?? t("filters.advancedActions.error.general"), "error");
	};

	const buildServiceScopePayload = (): Partial<Pick<AdvancedUserActionPayload, "service_id">> => {
		if (!selectedServiceValue) return {};
		return { service_id: Number(selectedServiceValue) };
	};

	const buildTargetingPayload = (includeStatusAge = true): Partial<AdvancedUserActionPayload> | null => {
		const parseDays = (value: string) => Math.floor(Number(value));
		const payload: Partial<AdvancedUserActionPayload> = {};
		const usernames = parseTargetUsernames(targetUsernames);
		if (targetUsernames.trim() && !usernames.length) {
			handleError(t("filters.advancedActions.error.invalidUsernames"));
			return null;
		}
		if (usernames.length) payload.usernames = usernames;
		if (labelTarget.groups.length) {
			payload.group_ids = labelTarget.groups.map((group) =>
				group === NO_GROUP_FILTER ? -1 : Number(group),
			);
		}
		if (labelTarget.tags.length) {
			payload.tags = labelTarget.tags;
			if (labelTarget.tagMatchAll) payload.tag_match = "all";
		}
		for (const item of [
			{ value: lastOnlineDays, key: "last_online_days" as const },
			{ value: createdBeforeDays, key: "created_before_days" as const },
			...(includeStatusAge ? [{ value: statusAgeDays, key: "status_age_days" as const }] : []),
		]) {
			if (!item.value.trim()) continue;
			const days = parseDays(item.value);
			if (!Number.isFinite(days) || days <= 0) {
				handleError(t("filters.advancedActions.error.invalidDays"));
				return null;
			}
			payload[item.key] = days;
		}
		return payload;
	};

	const ownerLabel = !hasScopeSelect
		? userData.username
		: ownerSelection === "my_users"
			? t("filters.advancedActions.scope.myUsers")
			: ownerSelection === "all_users"
				? t("filters.advancedActions.scope.allUsers")
				: ownerSelection.replace(/^admin:/, "");
	const serviceLabel = selectedServiceValue
		? (serviceOptions.find((service) => String(service.id) === selectedServiceValue)?.name ?? selectedServiceValue)
		: t("filters.advancedActions.service.all");
	const statusLabel =
		selectedScopeStatuses.map((status) => t(`filters.advancedActions.scopeStatuses.${status}`, status)).join(", ") || "-";
	const usernameCount = parseTargetUsernames(targetUsernames).length;
	const conditionParts = [
		lastOnlineDays.trim() ? `${t("filters.advancedActions.conditions.lastOnline")}: ${lastOnlineDays}` : null,
		statusAgeDays.trim() ? `${t("filters.advancedActions.conditions.statusAge")}: ${statusAgeDays}` : null,
		createdBeforeDays.trim() ? `${t("filters.advancedActions.conditions.createdBefore")}: ${createdBeforeDays}` : null,
	].filter(Boolean) as string[];
	const groupLabel = labelTarget.groups
		.map((group) =>
			group === NO_GROUP_FILTER
				? t("groups.noGroup")
				: (userGroups.find((item) => String(item.id) === group)?.name ?? group),
		)
		.join(", ");
	const tagsLabel = labelTarget.tags.join(", ");
	const labelParts = [
		groupLabel ? `${t("groups.group")}: ${groupLabel}` : null,
		tagsLabel ? `${t("tags.title")}: ${tagsLabel}` : null,
	].filter(Boolean) as string[];
	const scopeText = [ownerLabel, serviceLabel, statusLabel, ...labelParts, ...conditionParts].join(" · ");

	const execute = async (
		key: string,
		label: string,
		payload: AdvancedUserActionPayload,
		success: (count: number) => string,
		onSuccess?: () => void,
	) => {
		setBusy(key);
		try {
			const result = await performBulkUserAction(payload);
			const message = success(result.count ?? 0);
			showToast(message, "success");
			setRecentRuns((prev) =>
				[{ id: Date.now(), label, ok: true, detail: message, time: new Date() }, ...prev].slice(0, MAX_RECENT_RUNS),
			);
			onSuccess?.();
		} catch (error) {
			const message = resolveErrorMessage(error) ?? t("filters.advancedActions.error.general");
			handleError(message);
			setRecentRuns((prev) =>
				[{ id: Date.now(), label, ok: false, detail: message, time: new Date() }, ...prev].slice(0, MAX_RECENT_RUNS),
			);
		} finally {
			setBusy(null);
		}
	};

	const askToRun = (request: {
		key: string;
		label: string;
		detail: string;
		danger?: boolean;
		payload: AdvancedUserActionPayload;
		success: (count: number) => string;
		onSuccess?: () => void;
	}) => {
		setPending({
			title: request.label,
			description: `${request.detail}\n${scopeText}`,
			danger: Boolean(request.danger),
			run: () => execute(request.key, request.label, request.payload, request.success, request.onSuccess),
		});
	};

	const confirmPending = async () => {
		const current = pending;
		setPending(null);
		if (current) await current.run();
	};

	const askExpire = (action: "extend_expire" | "reduce_expire") => {
		const days = Math.floor(Number(expireDays));
		if (!Number.isFinite(days) || days <= 0) {
			showToast(t("filters.advancedActions.error.invalidDays"), "warning");
			return;
		}
		if (!selectedScopeStatuses.length) {
			showToast(t("filters.advancedActions.error.noScope"), "warning");
			return;
		}
		const targeting = buildTargetingPayload();
		if (!targeting) return;
		const label = t(
			action === "extend_expire"
				? "filters.advancedActions.expireSection.addButton"
				: "filters.advancedActions.expireSection.removeButton",
		);
		askToRun({
			key: action,
			label,
			detail: `${label}: ${days}`,
			danger: action === "reduce_expire",
			payload: {
				action,
				days,
				scope: selectedScopeStatuses,
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				...targeting,
			},
			success: (count) => t("filters.advancedActions.success.expire", { count }),
			onSuccess: () => setExpireDays(""),
		});
	};

	const askTraffic = (action: "increase_traffic" | "decrease_traffic") => {
		const value = Number(trafficGb);
		if (!Number.isFinite(value) || value <= 0) {
			showToast(t("filters.advancedActions.error.invalidGigabytes"), "warning");
			return;
		}
		if (!selectedScopeStatuses.length) {
			showToast(t("filters.advancedActions.error.noScope"), "warning");
			return;
		}
		const targeting = buildTargetingPayload();
		if (!targeting) return;
		const label = t(
			action === "increase_traffic"
				? "filters.advancedActions.trafficSection.addButton"
				: "filters.advancedActions.trafficSection.removeButton",
		);
		askToRun({
			key: action,
			label,
			detail: `${label}: ${value} GB`,
			danger: action === "decrease_traffic",
			payload: {
				action,
				gigabytes: value,
				scope: selectedScopeStatuses,
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				...targeting,
			},
			success: (count) => t("filters.advancedActions.success.traffic", { count, value }),
			onSuccess: () => setTrafficGb(""),
		});
	};

	const askFactor = (action: FactorAction, factorText: string, clear: () => void) => {
		const factor = Number(factorText);
		if (!Number.isFinite(factor) || factor <= 0) {
			showToast(t("filters.advancedActions.error.invalidFactor"), "warning");
			return;
		}
		if (!selectedScopeStatuses.length) {
			showToast(t("filters.advancedActions.error.noScope"), "warning");
			return;
		}
		const targeting = buildTargetingPayload();
		if (!targeting) return;
		const label = t(factorLabelKeys[action]);
		askToRun({
			key: action,
			label,
			detail: `${label}: ${factor}`,
			danger: action.startsWith("divide"),
			payload: {
				action,
				factor,
				scope: selectedScopeStatuses,
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				...targeting,
			},
			success: (count) =>
				t(action.endsWith("expire") ? "filters.advancedActions.success.expire" : "filters.advancedActions.success.trafficFactor", { count }),
			onSuccess: clear,
		});
	};

	const askCleanup = () => {
		const days = Math.floor(Number(cleanupDays));
		if (!Number.isFinite(days) || days <= 0) {
			showToast(t("filters.advancedActions.error.invalidDays"), "warning");
			return;
		}
		if (!selectedStatuses.length) {
			showToast(t("filters.advancedActions.error.noStatuses"), "warning");
			return;
		}
		const targeting = buildTargetingPayload(false);
		if (!targeting) return;
		const label = t("filters.advancedActions.cleanupSection.button");
		askToRun({
			key: "cleanup_status",
			label,
			detail: `${label}: ${days}`,
			danger: true,
			payload: {
				action: "cleanup_status",
				days,
				statuses: selectedStatuses,
				scope: selectedStatuses,
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				...targeting,
			},
			success: (count) => t("filters.advancedActions.success.cleanup", { count }),
			onSuccess: () => setCleanupDays(""),
		});
	};

	const askStatus = (action: "disable_users" | "activate_users") => {
		const targeting = buildTargetingPayload(false);
		if (!targeting) return;
		const label = t(action === "disable_users" ? "bulkActions.status.disable" : "bulkActions.status.activate");
		askToRun({
			key: action,
			label,
			detail: label,
			danger: action === "disable_users",
			payload: {
				action,
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				...targeting,
			},
			success: (count) => t("bulkActions.status.success", { count }),
		});
	};

	const askLabels = (action: "set_group" | "clear_group" | "add_tags" | "remove_tags") => {
		const targeting = buildTargetingPayload(false);
		if (!targeting) return;
		const base: AdvancedUserActionPayload = {
			action,
			admin_username: resolveTargetAdminUsername(),
			...buildServiceScopePayload(),
			...targeting,
		};
		let detail = "";
		if (action === "set_group") {
			if (newGroupId === null) {
				showToast(t("bulkActions.labels.groupRequired"), "warning");
				return;
			}
			base.target_group_id = newGroupId;
			detail = userGroups.find((item) => item.id === newGroupId)?.name ?? String(newGroupId);
		}
		if (action === "add_tags" || action === "remove_tags") {
			if (!labelTags.length) {
				showToast(t("bulkActions.labels.tagsRequired"), "warning");
				return;
			}
			base.target_tags = labelTags;
			detail = labelTags.join(", ");
		}
		const label = t(`bulkActions.labels.${action}`);
		askToRun({
			key: action,
			label,
			detail: detail ? `${label}: ${detail}` : label,
			danger: false,
			payload: base,
			success: (count) => t("bulkActions.labels.success", { count }),
			onSuccess: () => {
				void invalidateLabels();
				if (action === "add_tags" || action === "remove_tags") setLabelTags([]);
			},
		});
	};

	const askChangeService = () => {
		const targetId = Number(targetServiceValue);
		if (!targetServiceValue || !Number.isFinite(targetId) || targetId <= 0) {
			showToast(t("filters.advancedActions.error.targetServiceRequired"), "warning");
			return;
		}
		const targeting = buildTargetingPayload();
		if (!targeting) return;
		const targetName = serviceOptions.find((service) => service.id === targetId)?.name ?? targetServiceValue;
		const label = t("filters.advancedActions.serviceChange.button");
		askToRun({
			key: "change_service",
			label,
			detail: `${label}: ${targetName}`,
			danger: true,
			payload: {
				action: "change_service",
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				target_service_id: targetId,
				...(targeting.status_age_days ? { scope: selectedScopeStatuses } : {}),
				...targeting,
			},
			success: (count) => t("filters.advancedActions.success.changeService", { count }),
		});
	};

	if (!canUseAdvanced || userManagementLocked) {
		return null;
	}

	const who = (
		<SettingsCard title={t("bulkActions.edit.who")} description={t("bulkActions.edit.whoHelp")}>
			{hasScopeSelect || canSeeServiceControls ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{hasScopeSelect ? (
						<FormField label={t("filters.advancedActions.scope.label")} description={t("filters.advancedActions.scope.helper")}>
							<Select
								value={ownerSelection}
								onChange={(event) => {
									const nextValue = event.target.value;
									if (nextValue === "my_users" || nextValue === "all_users" || nextValue.startsWith("admin:")) {
										setOwnerSelection(nextValue as OwnerSelection);
									}
								}}
								size="sm"
							>
								<option value="my_users">{t("filters.advancedActions.scope.myUsers")}</option>
								<option value="all_users">{t("filters.advancedActions.scope.allUsers")}</option>
								{adminList
									.filter((record) => record.username !== userData.username)
									.map((record) => (
										<option key={record.username} value={`admin:${record.username}`}>
											{record.username}
										</option>
									))}
							</Select>
						</FormField>
					) : null}
					{canSeeServiceControls ? (
						<FormField label={t("filters.advancedActions.service.label")} description={t("filters.advancedActions.service.helper")}>
							<Select value={selectedServiceValue} onChange={(event) => setSelectedServiceValue(event.target.value)} size="sm">
								<option value="">{t("filters.advancedActions.service.all")}</option>
								{serviceOptions.map((service) => (
									<option key={service.id} value={String(service.id)}>
										{service.name}
									</option>
								))}
							</Select>
						</FormField>
					) : null}
				</div>
			) : null}

			<LabelFilter type="user" value={labelTarget} onChange={setLabelTarget} />

			<FormField label={t("filters.advancedActions.conditions.usernames")} description={t("filters.advancedActions.conditions.usernamesHelp")}>
				<Textarea value={targetUsernames} onChange={(event) => setTargetUsernames(event.target.value)} rows={2} className="font-mono" />
			</FormField>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<FormField label={t("filters.advancedActions.conditions.lastOnline")}>
					<NumberField inputMode="numeric" min={1} value={lastOnlineDays} doneLabel={t("common.done")} onChange={setLastOnlineDays} />
				</FormField>
				<FormField label={t("filters.advancedActions.conditions.statusAge")}>
					<NumberField inputMode="numeric" min={1} value={statusAgeDays} doneLabel={t("common.done")} onChange={setStatusAgeDays} />
				</FormField>
				<FormField label={t("filters.advancedActions.conditions.createdBefore")}>
					<NumberField inputMode="numeric" min={1} value={createdBeforeDays} doneLabel={t("common.done")} onChange={setCreatedBeforeDays} />
				</FormField>
			</div>

			<FormField label={t("filters.advancedActions.scopeStatuses.title")} description={t("filters.advancedActions.scopeStatuses.helper")}>
				<SegmentedMultiControl
					label={t("filters.advancedActions.scopeStatuses.title")}
					value={selectedScopeStatuses}
					options={scopeStatusOptions.map((status) => ({
						value: status,
						label: t(`filters.advancedActions.scopeStatuses.${status}`, status),
					}))}
					onChange={(next) => setSelectedScopeStatuses(next as AdvancedUserActionScopeStatus[])}
				/>
			</FormField>
		</SettingsCard>
	);

	const actionCards = (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
			<SettingsCard title={t("filters.advancedActions.expireSection.title")} description={t("filters.advancedActions.expireSection.description")}>
				<FormField label={t("filters.advancedActions.expireSection.inputLabel")} description={t("filters.advancedActions.expireSection.helper")}>
					<NumberField inputMode="numeric" min={1} value={expireDays} doneLabel={t("common.done")} onChange={setExpireDays} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askExpire("extend_expire")} size="sm" loading={busy === "extend_expire"}>
						{t("filters.advancedActions.expireSection.addButton")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askExpire("reduce_expire")} variant="outline" size="sm" loading={busy === "reduce_expire"}>
						{t("filters.advancedActions.expireSection.removeButton")}
					</Button>
				</div>
				<FormField label={t("filters.advancedActions.expireSection.factorLabel")}>
					<NumberField min={0.01} step={0.1} value={expireFactor} doneLabel={t("common.done")} onChange={setExpireFactor} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askFactor("multiply_expire", expireFactor, () => setExpireFactor(""))} size="sm" loading={busy === "multiply_expire"}>
						{t("filters.advancedActions.expireSection.multiplyButton")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askFactor("divide_expire", expireFactor, () => setExpireFactor(""))} variant="outline" size="sm" loading={busy === "divide_expire"}>
						{t("filters.advancedActions.expireSection.divideButton")}
					</Button>
				</div>
			</SettingsCard>

			<SettingsCard title={t("filters.advancedActions.trafficSection.title")} description={t("filters.advancedActions.trafficSection.description")}>
				<FormField label={t("filters.advancedActions.trafficSection.inputLabel")}>
					<DataSizeField valueGb={trafficGb} onChangeGb={setTrafficGb} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askTraffic("increase_traffic")} size="sm" loading={busy === "increase_traffic"}>
						{t("filters.advancedActions.trafficSection.addButton")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askTraffic("decrease_traffic")} variant="outline" size="sm" loading={busy === "decrease_traffic"}>
						{t("filters.advancedActions.trafficSection.removeButton")}
					</Button>
				</div>
				<FormField label={t("filters.advancedActions.trafficSection.factorLabel")}>
					<NumberField min={0.01} step={0.1} value={trafficFactor} doneLabel={t("common.done")} onChange={setTrafficFactor} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askFactor("multiply_traffic", trafficFactor, () => setTrafficFactor(""))} size="sm" loading={busy === "multiply_traffic"}>
						{t("filters.advancedActions.trafficSection.multiplyButton")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askFactor("divide_traffic", trafficFactor, () => setTrafficFactor(""))} variant="outline" size="sm" loading={busy === "divide_traffic"}>
						{t("filters.advancedActions.trafficSection.divideButton")}
					</Button>
				</div>
			</SettingsCard>

			{canSeeServiceControls && !serviceTransferDisabled ? (
				<SettingsCard title={t("filters.advancedActions.serviceChange.title")} description={t("filters.advancedActions.serviceChange.helper")}>
					<FormField label={t("filters.advancedActions.service.label")}>
						<Select value={targetServiceValue} onChange={(event) => setTargetServiceValue(event.target.value)} size="sm">
							<option value="">{t("filters.advancedActions.serviceChange.placeholder")}</option>
							{serviceOptions.map((service) => (
								<option key={service.id} value={String(service.id)}>
									{service.name}
								</option>
							))}
						</Select>
					</FormField>
					<div className="flex flex-row flex-wrap gap-2">
						<Button disabled={busy !== null} onClick={askChangeService} size="sm" loading={busy === "change_service"}>
							{t("filters.advancedActions.serviceChange.button")}
						</Button>
					</div>
				</SettingsCard>
			) : null}

			<SettingsCard title={t("bulkActions.status.title")} description={t("bulkActions.status.description")}>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askStatus("activate_users")} size="sm" loading={busy === "activate_users"}>
						{t("bulkActions.status.activate")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askStatus("disable_users")} variant="outline" size="sm" loading={busy === "disable_users"}>
						{t("bulkActions.status.disable")}
					</Button>
				</div>
			</SettingsCard>

			<SettingsCard title={t("bulkActions.labels.title")} description={t("bulkActions.labels.description")}>
				<FormField label={t("bulkActions.labels.targetGroup")}>
					<GroupSelect type="user" value={newGroupId} onChange={setNewGroupId} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askLabels("set_group")} size="sm" loading={busy === "set_group"}>
						{t("bulkActions.labels.set_group")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askLabels("clear_group")} variant="outline" size="sm" loading={busy === "clear_group"}>
						{t("bulkActions.labels.clear_group")}
					</Button>
				</div>
				<FormField label={t("bulkActions.labels.targetTags")}>
					<TagsSelect value={labelTags} onChange={setLabelTags} options={userTags.map((item) => item.tag)} />
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={() => askLabels("add_tags")} size="sm" loading={busy === "add_tags"}>
						{t("bulkActions.labels.add_tags")}
					</Button>
					<Button disabled={busy !== null} onClick={() => askLabels("remove_tags")} variant="outline" size="sm" loading={busy === "remove_tags"}>
						{t("bulkActions.labels.remove_tags")}
					</Button>
				</div>
			</SettingsCard>

			<SettingsCard title={t("filters.advancedActions.cleanupSection.title")} description={t("filters.advancedActions.cleanupSection.description")}>
				<FormField label={t("filters.advancedActions.cleanupSection.daysLabel")}>
					<NumberField inputMode="numeric" min={1} value={cleanupDays} doneLabel={t("common.done")} onChange={setCleanupDays} />
				</FormField>
				<FormField>
					<SegmentedMultiControl
						label={t("filters.advancedActions.cleanupSection.title")}
						value={selectedStatuses}
						options={cleanupOptions.map((status) => ({
							value: status,
							label: t(`filters.advancedActions.cleanupSection.statuses.${status}`, status),
						}))}
						onChange={(next) => setSelectedStatuses(next as AdvancedUserActionStatus[])}
					/>
				</FormField>
				<div className="flex flex-row flex-wrap gap-2">
					<Button disabled={busy !== null} onClick={askCleanup} variant="destructive" size="sm" loading={busy === "cleanup_status"}>
						{t("filters.advancedActions.cleanupSection.button")}
					</Button>
				</div>
			</SettingsCard>
		</div>
	);

	const summaryRows: Array<[string, string]> = [
		[t("filters.advancedActions.scope.label"), ownerLabel],
		[t("filters.advancedActions.service.label"), serviceLabel],
		[t("filters.advancedActions.scopeStatuses.title"), statusLabel],
		[t("groups.group"), groupLabel || t("bulkActions.edit.noFilter")],
		[t("tags.title"), tagsLabel || t("bulkActions.edit.noFilter")],
		[
			t("filters.advancedActions.conditions.usernames"),
			usernameCount ? String(usernameCount) : t("bulkActions.edit.noFilter"),
		],
		[t("filters.advancedActions.conditions.title"), conditionParts.length ? conditionParts.join(" · ") : t("bulkActions.edit.noFilter")],
	];

	const summary = (
		<SettingsCard title={t("bulkActions.edit.summary")} description={t("bulkActions.edit.summaryHelp")}>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[0.8125rem]">
				{summaryRows
					.filter(([label]) => hasScopeSelect || label !== t("filters.advancedActions.scope.label"))
					.map(([label, value]) => (
						<div key={label} className="contents">
							<dt className="text-panel-text-muted">{label}</dt>
							<dd className="min-w-0 truncate text-panel-text" title={value}>
								{value}
							</dd>
						</div>
					))}
			</dl>
		</SettingsCard>
	);

	const recent = (
		<SettingsCard title={t("bulkActions.edit.recent")} description={t("bulkActions.edit.recentHelp")}>
			{recentRuns.length ? (
				<div className="flex flex-col gap-3">
					{recentRuns.map((run) => (
						<div key={run.id} className="flex flex-row items-start justify-between gap-3 border-b border-panel-border! pb-3 last:border-b-0 last:pb-0">
							<div className="min-w-0">
								<p className="truncate text-[0.8125rem] font-medium text-panel-text">{run.label}</p>
								<p className="text-[0.75rem] text-panel-text-muted">{run.detail}</p>
							</div>
							<div className="flex shrink-0 flex-col items-end gap-1">
								<Badge className={toneClass(run.ok ? "green" : "red")}>
									{run.ok ? t("bulkActions.edit.runOk") : t("bulkActions.edit.runFailed")}
								</Badge>
								<span className="text-[0.6875rem] tabular-nums text-panel-text-muted">{run.time.toLocaleTimeString()}</span>
							</div>
						</div>
					))}
				</div>
			) : (
				<p className="text-[0.8125rem] text-panel-text-muted">{t("bulkActions.edit.noRuns")}</p>
			)}
		</SettingsCard>
	);

	const content = (
		<div className="flex flex-col gap-4">
			<Alert className="rounded-md">
				<TriangleAlert className="size-4" aria-hidden="true" />
				<p>{t("filters.advancedActions.modalDescription")}</p>
			</Alert>
			<div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
				<div className="flex min-w-0 flex-col gap-4">
					{who}
					{actionCards}
				</div>
				<div className="flex flex-col gap-4 xl:sticky xl:top-4">
					{summary}
					{recent}
				</div>
			</div>
		</div>
	);

	const confirm = (
		<ConfirmDialog
			open={pending !== null}
			onClose={() => setPending(null)}
			onConfirm={confirmPending}
			loading={busy !== null}
			colorScheme={pending?.danger ? "red" : "primary"}
			title={pending?.title ?? ""}
			description={pending?.description ?? ""}
			confirmLabel={t("confirm")}
		/>
	);

	if (embedded) {
		return (
			<>
				{content}
				{confirm}
			</>
		);
	}

	return (
		<>
			{compact ? (
				<Tooltip>
<TooltipTrigger asChild>
					<Button aria-label={t("filters.advancedActions.button")} onClick={onOpen} variant="outline" size="sm" className={cn("size-8 p-0", "rounded-full w-[36px] h-[36px] shrink-0")}>
						<AdvancedActionsIcon />
					</Button>
				</TooltipTrigger>
<TooltipContent>{t("filters.advancedActions.button")}</TooltipContent>
</Tooltip>
			) : (
				<Button onClick={onOpen} variant="outline" size="sm" className="font-semibold whitespace-nowrap">
					<AdvancedActionsIcon />
					{t("filters.advancedActions.button")}
				</Button>
			)}
			<AppDialog
				open={isOpen}
				onClose={onClose}
				size="4xl"
				title={t("filters.advancedActions.modalTitle")}
				footer={
					<Button onClick={onClose} disabled={busy !== null} variant="ghost" size="sm">
						{t("close")}
					</Button>
				}
			>
				{content}
			</AppDialog>
			{confirm}
		</>
	);
};

export default AdvancedUserActions;
