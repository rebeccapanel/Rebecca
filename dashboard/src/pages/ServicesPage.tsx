import { Badge } from "components/ui/badge";
import { Checkbox } from "components/ui/checkbox";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "components/ui/radio-group";
import { Alert, AlertDescription } from "components/ui/alert";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { useDisclosure } from "hooks/useDisclosure";
import { DataSizeField } from "components/ui/data-size-field";
import { FieldHint } from "components/ui/field-hint";
import { FormField } from "components/ui/form-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { serviceEntityPage } from "components/entityPage/EntityOverviews";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { buttonVariants } from "components/ui/button";
import { Badge as UiBadge } from "components/ui/badge";
import { Input as UiInput } from "components/ui/input";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { NumberField } from "components/ui/number-field";
import { CheckRow } from "components/ui/check-row";
import { Layers, ArrowDown, RefreshCw, ArrowUp, ChevronsUp, Eye, SquarePen, Plus, Trash2 } from "lucide-react";

import { cn } from "lib/cn";
import { AppleEmojiText } from "components/common/AppleEmojiText";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { OverviewBand } from "components/ui/overview-band";
import { Input } from "components/Input";
import { AppDialog } from "components/dialogs/AppDialog";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import {
	DataTable,
	PageHeader,
	PageLoadingSkeleton,
	TabSystem,
	type DataTableColumn,
	type DataTableRowAction,
} from "components/ui";

import { ExpandedDetails, ExpandedHeading, ExpandedMeta } from "components/ui/ExpandedPanel";
import { useAdminsStore } from "contexts/AdminsContext";
import {
	fetchInbounds,
	type Inbounds,
	useDashboard,
} from "contexts/DashboardContext";
import { useHosts } from "contexts/HostsContext";
import {
	type ServiceListParams,
	useServicesStore,
} from "contexts/ServicesContext";
import { Pagination } from "components/Pagination";
import { motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type { Admin, AdminPermissions } from "types/Admin";
import { AdminTrafficLimitMode } from "types/Admin";
import type {
	ServiceCreatePayload,
	ServiceAdmin,
	ServiceDeletePayload,
	ServiceDetail,
	ServiceHost,
	ServiceHostAssignment,
	ServiceSummary,
} from "types/Service";
import { formatBytes } from "utils/formatByte";
import {
	DEFAULT_SEARCH_MATCH_OPTIONS,
	matchesAnySearch,
} from "utils/searchMatch";

type HostOption = {
	id: number;
	label: string;
	inboundTag: string;
	protocol: string;
	disabled: boolean;
};

type ServiceDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (
		payload: ServiceCreatePayload,
		serviceId?: number,
	) => Promise<void>;
	isSaving: boolean;
	allHosts: HostOption[];
	allAdmins: { id: number; username: string }[];
	initialService?: ServiceDetail | null;
	inbounds: Inbounds;
	refreshInbounds: () => Promise<void>;
	refreshHosts: () => void;
};

const GB_IN_BYTES = 1024 * 1024 * 1024;
const MB_IN_BYTES = 1024 * 1024;

const formatGigabytes = (
	bytes?: number | null,
	unlimitedLabel = "Unlimited",
) => {
	const value = Number(bytes ?? 0);
	if (!Number.isFinite(value) || value <= 0) {
		return unlimitedLabel;
	}
	const gb = value / GB_IN_BYTES;
	return `${Number.isInteger(gb) ? gb : Number(gb.toFixed(2))} GB`;
};

const sanitizeIntegerInput = (value: string) => value.replace(/\D/g, "");

const sanitizeDecimalInput = (value: string, maxDecimals = 2) => {
	const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
	const [integerPart = "", ...decimalParts] = normalized.split(".");
	const decimalPart = decimalParts.join("").slice(0, maxDecimals);
	if (normalized.includes(".")) {
		return `${integerPart || "0"}.${decimalPart}`;
	}
	return integerPart;
};

const formatUnitInputValue = (bytes?: number | null, unit = GB_IN_BYTES) => {
	const value = Number(bytes ?? 0);
	if (!Number.isFinite(value) || value <= 0) {
		return "";
	}
	const unitValue = value / unit;
	return String(Number(unitValue.toFixed(2)));
};

const parseDecimalInput = (value: string) => {
	const sanitized = sanitizeDecimalInput(value);
	return sanitized && sanitized !== "0." ? Number(sanitized) : null;
};

const parseCoefficientInput = (value: string) => {
	const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
	const parsed = Number(normalized);
	return normalized && normalized !== "." && Number.isFinite(parsed)
		? Math.round(parsed * 100) / 100
		: null;
};

const parseIntegerInput = (value: string) => {
	const sanitized = sanitizeIntegerInput(value);
	return sanitized ? Number.parseInt(sanitized, 10) : null;
};

const adminCanDeleteUsers = (admin?: Admin) =>
	Boolean(admin?.permissions?.users?.delete);

const withDeleteUserPermission = (permissions: AdminPermissions) => ({
	...permissions,
	users: {
		...permissions.users,
		delete: true,
	},
});

type ServiceDialogTab = "details" | "admins" | "hosts";

const ServiceDialog: FC<ServiceDialogProps> = ({
	open: isOpen,
	onClose,
	onSubmit,
	isSaving,
	allHosts,
	allAdmins,
	initialService,
	inbounds,
	refreshInbounds,
	refreshHosts,
}) => {
	const { t } = useTranslation();
	const [name, setName] = useState(initialService?.name ?? "");
	const [description, setDescription] = useState(
		initialService?.description ?? "",
	);
	const [usageCoefficient, setUsageCoefficient] = useState(
		String(initialService?.usage_coefficient ?? 1),
	);
	const [selectedAdmins, setSelectedAdmins] = useState<number[]>(
		initialService?.admin_ids ?? [],
	);
	const [selectedHosts, setSelectedHosts] = useState<number[]>(
		initialService?.hosts.map((host) => host.id) ?? [],
	);
	const [adminSearch, setAdminSearch] = useState("");
	const [hostSearch, setHostSearch] = useState("");
	const [adminSearchMatch, setAdminSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [hostSearchMatch, setHostSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [autoInboundBusy, setAutoInboundBusy] = useState(false);
	const [activeTab, setActiveTab] = useState<ServiceDialogTab>("details");
	

	const autoInboundTag = initialService?.id
		? `setservice-${initialService.id}`
		: null;

	const autoInboundExists = useMemo(() => {
		if (!autoInboundTag) {
			return false;
		}
		for (const inboundList of inbounds.values()) {
			if (inboundList.some((inbound) => inbound.tag === autoInboundTag)) {
				return true;
			}
		}
		return false;
	}, [autoInboundTag, inbounds]);

	useEffect(() => {
		if (isOpen) {
			setName(initialService?.name ?? "");
			setDescription(initialService?.description ?? "");
			setUsageCoefficient(String(initialService?.usage_coefficient ?? 1));
			setSelectedAdmins(initialService?.admin_ids ?? []);
			setSelectedHosts(initialService?.hosts.map((host) => host.id) ?? []);
			setAdminSearch("");
			setHostSearch("");
			setAutoInboundBusy(false);
			setActiveTab("details");
		}
	}, [isOpen, initialService]);

	const hostMap = useMemo(() => {
		return new Map(allHosts.map((host) => [host.id, host]));
	}, [allHosts]);

	const availableHosts = useMemo(() => {
		return allHosts.filter(
			(host) => !selectedHosts.includes(host.id) && !host.disabled,
		);
	}, [allHosts, selectedHosts]);

	const filteredAvailableHosts = useMemo(() => {
		if (!hostSearch.trim()) {
			return availableHosts;
		}
		return availableHosts.filter((host) =>
			matchesAnySearch(
				[host.label, host.inboundTag, host.protocol],
				hostSearch,
				hostSearchMatch,
			),
			);
	}, [availableHosts, hostSearch, hostSearchMatch]);

	const filteredAdmins = useMemo(() => {
		if (!adminSearch.trim()) {
			return allAdmins;
		}
		return allAdmins.filter((admin) =>
			matchesAnySearch([admin.username], adminSearch, adminSearchMatch),
		);
	}, [adminSearch, adminSearchMatch, allAdmins]);

	const selectedAdminsSet = useMemo(
		() => new Set(selectedAdmins),
		[selectedAdmins],
	);

	const allAdminsSelected = selectedAdmins.length === allAdmins.length && allAdmins.length > 0;
	const someAdminsSelected = selectedAdmins.length > 0 && !allAdminsSelected;

	const handleToggleAllAdmins = () => {
		const hasAllSelected =
			selectedAdmins.length === allAdmins.length && allAdmins.length > 0;
		setSelectedAdmins(hasAllSelected ? [] : allAdmins.map((admin) => admin.id));
	};

	const handleAdminToggle = (adminId: number) => {
		setSelectedAdmins((prev) =>
			prev.includes(adminId)
				? prev.filter((id) => id !== adminId)
				: [...prev, adminId],
		);
	};

	const handleHostToggle = (hostId: number) => {
		setSelectedHosts((prev) =>
			prev.includes(hostId)
				? prev.filter((id) => id !== hostId)
				: [...prev, hostId],
		);
	};

	const moveHost = (hostId: number, direction: "up" | "down" | "top") => {
		setSelectedHosts((prev) => {
			const index = prev.indexOf(hostId);
			if (index === -1) return prev;
			if (direction === "top") {
				return index === 0
					? prev
					: [hostId, ...prev.filter((id) => id !== hostId)];
			}
			const swapWith = direction === "up" ? index - 1 : index + 1;
			if (swapWith < 0 || swapWith >= prev.length) {
				return prev;
			}
			const updated = [...prev];
			[updated[index], updated[swapWith]] = [updated[swapWith], updated[index]];
			return updated;
		});
	};

	const submit = async () => {
		if (!name.trim()) {
			toast.warning(t("services.validation.nameRequired"));
			return;
		}
		if (!selectedHosts.length) {
			toast.warning(t("services.validation.hostRequired"));
			return;
		}

		const coefficient =
			usageCoefficient.trim() === ""
				? 1
				: parseCoefficientInput(usageCoefficient);
		if (coefficient === null || coefficient < 0.01 || coefficient > 100) {
			toast.warning(t("services.validation.usageCoefficientInvalid"));
			return;
		}
		const assignments: ServiceHostAssignment[] = selectedHosts.map(
			(hostId, index) => ({
				host_id: hostId,
				sort: index,
			}),
		);

		await onSubmit(
			{
				name: name.trim(),
				description: description?.trim() || null,
				admin_ids: selectedAdmins,
				usage_coefficient: coefficient,
				hosts: assignments,
			},
			initialService?.id,
		);
	};

	const handleCreateAutoInbound = async () => {
		if (!initialService?.id || autoInboundExists) {
			return;
		}
		setAutoInboundBusy(true);
		try {
			await fetch(`/v2/services/${initialService.id}/auto-inbound`, {
				method: "POST",
			});
			await refreshInbounds();
			refreshHosts();
			toast.success(t("services.autoInbound.created"));
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.autoInbound.createFailed"));
		} finally {
			setAutoInboundBusy(false);
		}
	};

	const handleDeleteAutoInbound = async () => {
		if (!initialService?.id || !autoInboundExists) {
			return;
		}
		setAutoInboundBusy(true);
		try {
			await fetch(`/v2/services/${initialService.id}/auto-inbound`, {
				method: "DELETE",
			});
			await refreshInbounds();
			refreshHosts();
			toast.success(t("services.autoInbound.deleted"));
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.autoInbound.deleteFailed"));
		} finally {
			setAutoInboundBusy(false);
		}
	};

	return (
		<Dialog
			section="services"
			page={initialService ? serviceEntityPage(initialService) : undefined}
			open={isOpen}
			onOpenChange={(open) => {
				if (!open && !isSaving) onClose();
			}}
		>
			<DialogContent className="flex max-h-[min(760px,calc(100dvh-10rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:w-auto max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Layers className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{initialService ? t("services.editTitle") : t("services.createTitle")}
							</DialogTitle>
							{initialService ? <DialogDescription className="truncate">{initialService.name}</DialogDescription> : null}
						</div>
					</DialogHeader>

					<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ServiceDialogTab)} className="flex min-h-0 flex-1 flex-col">
						<div className="border-b px-5 pt-2.5 pb-2.5">
							<TabsList className="w-full">
								<TabsTrigger value="details">{t("details")}</TabsTrigger>
								<TabsTrigger value="admins">{t("services.fields.admins")}</TabsTrigger>
								<TabsTrigger value="hosts">{t("services.hosts")}</TabsTrigger>
							</TabsList>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<TabsContent value="details" className="mt-0">
								<div className="flex flex-col gap-4">
									<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
										<FormField label={t("services.fields.name")} htmlFor="service-name">
											<EmojiShortcodeInput id="service-name" value={name} onChange={setName} maxLength={128} required />
										</FormField>
										<FormField label={t("services.fields.description")} htmlFor="service-description">
											<UiInput id="service-description" value={description ?? ""} onChange={(event) => setDescription(event.target.value)} maxLength={256} />
										</FormField>
										<FormField label={t("services.fields.usageCoefficient")} htmlFor="service-usage-coefficient">
											<NumberField
												id="service-usage-coefficient"
												value={usageCoefficient}
												onChange={setUsageCoefficient}
												inputMode="decimal"
												step={0.01}
												min={0.01}
												max={100}
												placeholder="1"
											/>
										</FormField>
									</div>

									<section className="flex flex-col gap-3 rounded-lg border p-3.5">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="flex items-center gap-1.5">
													<span className="text-sm font-medium">{t("services.autoInbound.title")}</span>
													<FieldHint>{t("services.autoInbound.helper")}</FieldHint>
												</div>
												<p dir="ltr" className="mt-1 truncate font-mono text-xs text-muted-foreground">
													{autoInboundTag ?? t("services.autoInbound.pendingTag")}
												</p>
											</div>
											<UiBadge variant={autoInboundExists ? "default" : "outline"}>
												{autoInboundExists ? t("services.autoInbound.statusCreated") : t("services.autoInbound.statusMissing")}
											</UiBadge>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<button
												type="button"
												onClick={handleCreateAutoInbound}
												disabled={!initialService?.id || autoInboundExists || autoInboundBusy}
												className={buttonVariants({ size: "sm" })}
											>
												{t("services.autoInbound.create")}
											</button>
											<button
												type="button"
												onClick={handleDeleteAutoInbound}
												disabled={!initialService?.id || !autoInboundExists || autoInboundBusy}
												className={buttonVariants({ variant: "outline", size: "sm" })}
											>
												{t("services.autoInbound.delete")}
											</button>
										</div>
									</section>
								</div>
							</TabsContent>

							<TabsContent value="admins" className="mt-0">
								<div className="flex flex-col gap-3">
									<div className="flex items-center gap-1.5">
										<span className="text-sm font-medium">{t("services.fields.admins")}</span>
										<FieldHint>{t("services.adminHint")}</FieldHint>
									</div>
									<div className="flex items-center justify-between gap-3">
										<CheckRow
											checked={allAdminsSelected}
											indeterminate={someAdminsSelected}
											disabled={allAdmins.length === 0}
											onChange={handleToggleAllAdmins}
										>
											{t("services.selectAllAdmins")}
										</CheckRow>
										<UiBadge variant="outline">
											{selectedAdmins.length} / {allAdmins.length}
										</UiBadge>
									</div>
									<SearchInput
										value={adminSearch}
										onChange={(event) => setAdminSearch(event.target.value)}
										placeholder={t("services.searchAdmins")}
										matchOptions={adminSearchMatch}
										onMatchOptionsChange={setAdminSearchMatch}
										onClear={() => setAdminSearch("")}
									/>
									<div className="flex max-h-[280px] flex-col gap-2.5 overflow-y-auto rounded-md border p-3">
										{allAdmins.length === 0 ? (
											<p className="text-sm text-muted-foreground">{t("services.noAdminsFound")}</p>
										) : filteredAdmins.length === 0 ? (
											<p className="text-sm text-muted-foreground">{t("services.noAdminsMatching")}</p>
										) : (
											filteredAdmins.map((admin) => (
												<CheckRow key={admin.id} checked={selectedAdminsSet.has(admin.id)} onChange={() => handleAdminToggle(admin.id)}>
													{admin.username}
												</CheckRow>
											))
										)}
									</div>
								</div>
							</TabsContent>

							<TabsContent value="hosts" className="mt-0">
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div className="flex min-w-0 flex-col gap-2">
										<span className="text-sm font-medium">{t("services.availableHosts")}</span>
										<SearchInput
											value={hostSearch}
											onChange={(event) => setHostSearch(event.target.value)}
											placeholder={t("services.searchHosts")}
											matchOptions={hostSearchMatch}
											onMatchOptionsChange={setHostSearchMatch}
											onClear={() => setHostSearch("")}
										/>
										<div className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
											{availableHosts.length === 0 ? (
												<p className="p-1 text-sm text-muted-foreground">{t("services.noHostsLeft")}</p>
											) : filteredAvailableHosts.length === 0 ? (
												<p className="p-1 text-sm text-muted-foreground">{t("services.noHostsMatching")}</p>
											) : (
												filteredAvailableHosts.map((host) => (
													<button
														key={host.id}
														type="button"
														onClick={() => handleHostToggle(host.id)}
														className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-start transition-colors hover:bg-accent"
													>
														<span className="w-full truncate text-sm font-medium">
															<AppleEmojiText>{host.label}</AppleEmojiText>
														</span>
														<span className="text-xs text-muted-foreground">
															{host.protocol.toUpperCase()} - {host.inboundTag}
														</span>
													</button>
												))
											)}
										</div>
									</div>

									<div className="flex min-w-0 flex-col gap-2">
										<div className="flex items-center justify-between gap-2">
											<span className="text-sm font-medium">{t("services.selectedHosts")}</span>
											<UiBadge variant="outline">{selectedHosts.length}</UiBadge>
										</div>
										<div className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
											{selectedHosts.length === 0 ? (
												<p className="p-1 text-sm text-muted-foreground">{t("services.noHostsSelected")}</p>
											) : null}
											{selectedHosts.map((hostId, index) => {
												const host = hostMap.get(hostId);
												if (!host) return null;
												return (
													<motion.div
														layout
														key={hostId}
														className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
													>
														<div className="min-w-0">
															<div className="flex items-center gap-2">
																<span className="truncate text-sm font-medium">
																	<AppleEmojiText>{host.label}</AppleEmojiText>
																</span>
																{host.disabled ? <UiBadge variant="destructive">{t("services.hostDisabled")}</UiBadge> : null}
															</div>
															<p className="text-xs text-muted-foreground">
																{host.protocol.toUpperCase()} - {host.inboundTag}
															</p>
														</div>
														<div className="flex shrink-0 items-center gap-0.5">
															<button
																type="button"
																title={t("services.moveToTop")}
																aria-label={t("services.moveToTop")}
																onClick={() => moveHost(hostId, "top")}
																disabled={index === 0}
																className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
															>
																<ChevronsUp className="size-4" />
															</button>
															<button
																type="button"
																title={t("services.moveUp")}
																aria-label={t("services.moveUp")}
																onClick={() => moveHost(hostId, "up")}
																disabled={index === 0}
																className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
															>
																<ArrowUp className="size-4" />
															</button>
															<button
																type="button"
																title={t("services.moveDown")}
																aria-label={t("services.moveDown")}
																onClick={() => moveHost(hostId, "down")}
																disabled={index === selectedHosts.length - 1}
																className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
															>
																<ArrowDown className="size-4" />
															</button>
															<button
																type="button"
																title={t("services.removeHost")}
																aria-label={t("services.removeHost")}
																onClick={() => handleHostToggle(hostId)}
																className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
															>
																<Trash2 className="size-4" />
															</button>
														</div>
													</motion.div>
												);
											})}
										</div>
									</div>
								</div>
							</TabsContent>
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
						<button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
							{t("cancel")}
						</button>
						<Button type="submit" size="sm" loading={isSaving} className="ms-auto">
							{initialService ? t("saveChanges") : t("create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
const ServicesPage: FC = () => {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const labelColor = "text-gray-500 dark:text-gray-400";
	
	const { userData, getUserIsSuccess } = useGetUser();
	const canManageServices =
		getUserIsSuccess && Boolean(userData.permissions?.sections.services);
	const services = useServicesStore((state) => state.services);
	const summaryServices = useServicesStore((state) => state.summaryServices);
	const servicesTotal = useServicesStore((state) => state.total);
	const fetchServiceSummary = useServicesStore(
		(state) => state.fetchServiceSummary,
	);
	const [listFilters, setListFilters] = useState<
		ServiceListParams & { limit: number; offset: number; name: string }
	>({ limit: 20, offset: 0, name: "" });
	const [serviceSearch, setServiceSearch] = useState("");
	// Matching is done server-side through the name filter, so the toggles only
	// affect the local highlight; kept for a consistent search field.
	const [serviceMatchOptions, setServiceMatchOptions] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const serviceDetail = useServicesStore((state) => state.serviceDetail);
	const isServicesLoading = useServicesStore((state) => state.loading);
	const isServiceSaving = useServicesStore((state) => state.isSaving);
	const fetchServices = useServicesStore((state) => state.fetchServices);
	const fetchServiceDetail = useServicesStore(
		(state) => state.fetchServiceDetail,
	);
	const updateService = useServicesStore((state) => state.updateService);
	const createService = useServicesStore((state) => state.createService);
	const resetServiceUsage = useServicesStore(
		(state) => state.resetServiceUsage,
	);
	const deleteService = useServicesStore((state) => state.deleteService);
	const updateServiceAdminLimits = useServicesStore(
		(state) => state.updateServiceAdminLimits,
	);
	const rawAdminOptions = useAdminsStore((state) => state.adminOptions);
	const fetchAdminOptions = useAdminsStore((state) => state.fetchAdminOptions);
	const updateAdmin = useAdminsStore((state) => state.updateAdmin);
	const resetDeletedUsersUsage = useAdminsStore(
		(state) => state.resetDeletedUsersUsage,
	);
	const hosts = useHosts((state) => state.hosts);
	const fetchHosts = useHosts((state) => state.fetchHosts);
	const inbounds = useDashboard((state) => state.inbounds);
	const refetchUsers = useDashboard((state) => state.refetchUsers);

	const dialogDisclosure = useDisclosure();
	const [editingService, setEditingService] = useState<ServiceDetail | null>(
		null,
	);
	const [activeServiceTab, setActiveServiceTab] = useState<"hosts" | "admins">(
		"admins",
	);
	const [savingAdminLimitId, setSavingAdminLimitId] = useState<number | null>(
		null,
	);
	const [editingServiceAdminLimit, setEditingServiceAdminLimit] =
		useState<ServiceAdmin | null>(null);
	const [serviceAdminLimitForm, setServiceAdminLimitForm] = useState({
		traffic_limit_mode: AdminTrafficLimitMode.UsedTraffic,
		data_limit_gb: "",
		users_limit: "",
		show_user_traffic: true,
		delete_user_usage_limit_enabled: false,
		delete_user_usage_limit_mb: "",
		usage_coefficient: "",
	});

	useEffect(() => {
		if (!getUserIsSuccess || !canManageServices) {
			return;
		}
		void fetchServices(listFilters);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		getUserIsSuccess,
		canManageServices,
		fetchServices,
		listFilters,
	]);

	useEffect(() => {
		if (!getUserIsSuccess || !canManageServices) {
			return;
		}
		void fetchServiceSummary();
	}, [getUserIsSuccess, canManageServices, fetchServiceSummary]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			const name = serviceSearch.trim();
			setListFilters((current) =>
				current.name === name ? current : { ...current, name, offset: 0 },
			);
		}, 300);
		return () => window.clearTimeout(timer);
	}, [serviceSearch]);

	const ensureServiceDialogResources = useCallback(() => {
		if (useAdminsStore.getState().adminOptions.length === 0) {
			void fetchAdminOptions({ limit: 1000, offset: 0, sort: "username" });
		}
		if (useDashboard.getState().inbounds.size === 0) {
			void fetchInbounds();
		}
		if (Object.keys(useHosts.getState().hosts).length === 0) {
			void fetchHosts();
		}
	}, [fetchAdminOptions, fetchHosts]);

	const adminOptions = useMemo(() => {
		return rawAdminOptions
			.slice()
			.sort((a, b) => a.username.localeCompare(b.username))
			.map((admin) => ({
				id: admin.id!,
				username: admin.username,
			}));
	}, [rawAdminOptions]);

	const inboundProtocols = useMemo(
		() =>
			new Map(
				Array.from(inbounds.values())
					.flat()
					.map((inbound) => [inbound.tag, inbound.protocol]),
			),
		[inbounds],
	);

	const hostOptions: HostOption[] = useMemo(() => {
		const options: HostOption[] = [];
		for (const [tag, hostItems] of Object.entries(hosts)) {
			const protocol = inboundProtocols.get(tag) ?? "unknown";
			hostItems.forEach((host) => {
				if (host.id == null) {
					return;
				}
				options.push({
					id: host.id,
					label: host.remark,
					inboundTag: tag,
					protocol,
					disabled: Boolean(host.is_disabled),
				});
			});
		}
		return options;
	}, [hosts, inboundProtocols]);

	const openCreateDialog = () => {
		ensureServiceDialogResources();
		setEditingService(null);
		dialogDisclosure.onOpen();
	};

	const openEditDialog = async (serviceId: number) => {
		ensureServiceDialogResources();
		try {
			const detail = await fetchServiceDetail(serviceId);
			if (!detail) return;
			setEditingService(detail);
			dialogDisclosure.onOpen();
		} catch (_error) {
			toast.error(t("services.fetchFailed"));
		}
	};

	const openServiceDetail = async (
		serviceId: number,
		tab: "hosts" | "admins" = "admins",
	) => {
		setActiveServiceTab(tab);
		await fetchServiceDetail(serviceId);
	};

	const handleSubmit = async (
		payload: ServiceCreatePayload,
		serviceId?: number,
	) => {
		try {
			if (serviceId) {
				await updateService(serviceId, payload);
				toast.success(t("services.updated"));
			} else {
				await createService(payload);
				toast.success(t("services.created"));
			}
			refetchUsers(true);
			dialogDisclosure.onClose();
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.saveFailed"));
		}
	};

	const beginDeleteService = async (serviceId: number) => {
		try {
			const detail = await fetchServiceDetail(serviceId);
			if (!detail) return;
			setServicePendingDelete(detail);
			openDeleteDialog();
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.deleteFailed"));
		}
	};

	const handleResetUsage = async (serviceId: number) => {
		try {
			await resetServiceUsage(serviceId);
			toast.success(t("services.resetSuccess"));
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.resetFailed"));
		}
	};

	const [resetServiceId, setResetServiceId] = useState<number | null>(null);
	const [isResetting, setIsResetting] = useState(false);
	const {
		isOpen: isResetDialogOpen,
		onOpen: openResetDialog,
		onClose: closeResetDialog,
	} = useDisclosure();

	const openResetConfirmation = (serviceId: number) => {
		setResetServiceId(serviceId);
		openResetDialog();
	};

	const confirmResetUsage = async () => {
		if (resetServiceId == null) {
			return;
		}
		setIsResetting(true);
		try {
			await handleResetUsage(resetServiceId);
		} finally {
			setIsResetting(false);
			closeResetDialog();
		}
	};

	const resetTargetName =
		resetServiceId != null
			? summaryServices.find((service) => service.id === resetServiceId)
					?.name
			: undefined;

	const handleCloseDeleteDialog = () => {
		setServicePendingDelete(null);
		closeDeleteDialog();
	};

	const confirmDeleteService = async () => {
		if (!servicePendingDelete) {
			return;
		}
		const payload: ServiceDeletePayload = {
			mode: servicePendingDelete.user_count ? deleteMode : "delete_users",
			unlink_admins: unlinkAdmins,
		};
		if (payload.mode === "transfer_users") {
			if (!targetServiceId) {
				toast.warning(t("services.selectTargetService"), { description: t("services.targetServiceRequired") });
				return;
			}
			payload.target_service_id = targetServiceId;
		}
		setIsDeleting(true);
		try {
			await deleteService(servicePendingDelete.id, payload);
			toast.success(t("services.deleted"));
			refetchUsers(true);
			handleCloseDeleteDialog();
		} catch (error: any) {
			toast.error(error?.data?.detail ?? t("services.deleteFailed"));
		} finally {
			setIsDeleting(false);
		}
	};

	const [servicePendingDelete, setServicePendingDelete] =
		useState<ServiceDetail | null>(null);
	const [deleteMode, setDeleteMode] = useState<
		"delete_users" | "transfer_users"
	>("transfer_users");
	const [unlinkAdmins, setUnlinkAdmins] = useState(false);
	const [targetServiceId, setTargetServiceId] = useState<number | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const {
		isOpen: isDeleteDialogOpen,
		onOpen: openDeleteDialog,
		onClose: closeDeleteDialog,
	} = useDisclosure();

	const otherServices = useMemo(() => {
		if (!servicePendingDelete) {
				return summaryServices;
		}
		return summaryServices.filter(
			(service) => service.id !== servicePendingDelete.id,
		);
	}, [servicePendingDelete, summaryServices]);
	const servicesSummary = useMemo(
		() =>
			summaryServices.reduce(
				(summary, service) => ({
					totalHosts: summary.totalHosts + Number(service.host_count || 0),
					totalUsers: summary.totalUsers + Number(service.user_count || 0),
					totalUsage: summary.totalUsage + Number(service.used_traffic || 0),
					lifetimeUsage:
						summary.lifetimeUsage + Number(service.lifetime_used_traffic || 0),
					brokenServices: summary.brokenServices + (service.has_hosts ? 0 : 1),
				}),
				{
					totalHosts: 0,
					totalUsers: 0,
					totalUsage: 0,
					lifetimeUsage: 0,
					brokenServices: 0,
				},
			),
			[summaryServices],
	);

	const serviceOverview = useMemo(() => {
		const withHosts = summaryServices.filter((service) => service.has_hosts).length;
		const tones = ["bg-panel-accent", "bg-panel-success", "bg-panel-info", "bg-panel-warning", "bg-panel-text-muted/60"];
		const ranked = [...summaryServices].sort((a, b) => b.user_count - a.user_count);
		const segments = ranked.slice(0, 4).map((service, index) => ({
			key: String(service.id),
			label: service.name,
			value: service.user_count,
			tone: tones[index],
		}));
		const otherUsers = ranked.slice(4).reduce((sum, service) => sum + service.user_count, 0);
		if (otherUsers) {
			segments.push({ key: "other", label: t("overview.other"), value: otherUsers, tone: tones[4] });
		}
		return {
			total: {
				label: t("services.title"),
				value: summaryServices.length,
				caption: `${t("services.columns.hosts")}: ${servicesSummary.totalHosts}`,
			},
			rows: [
				{ key: "withHosts", label: t("services.columns.hosts"), value: withHosts, tone: "bg-panel-success" },
				{ key: "broken", label: t("services.broken"), value: servicesSummary.brokenServices, tone: "bg-panel-danger" },
			],
			distribution: { label: t("users"), segments },
			extra: {
				label: t("services.columns.usage"),
				value: formatBytes(servicesSummary.totalUsage),
				caption: `${t("services.columns.lifetime")}: ${formatBytes(servicesSummary.lifetimeUsage)}`,
			},
		};
	}, [summaryServices, servicesSummary, t]);

	useEffect(() => {
		if (servicePendingDelete) {
			const hasUsers = servicePendingDelete.user_count > 0;
			setDeleteMode(hasUsers ? "transfer_users" : "delete_users");
			setUnlinkAdmins(servicePendingDelete.admin_ids.length > 0);
			setTargetServiceId(null);
		}
	}, [servicePendingDelete]);

	useEffect(() => {
		if (deleteMode === "delete_users") {
			setTargetServiceId(null);
		} else if (targetServiceId === null && otherServices.length > 0) {
			setTargetServiceId(otherServices[0].id);
		}
	}, [deleteMode, otherServices, targetServiceId]);

	const [expandedServiceId, setExpandedServiceId] = useState<number | null>(null);

	const serviceColumns = useMemo<DataTableColumn<ServiceSummary>[]>(
		() => [
			{
				id: "id",
				header: t("services.columns.id"),
				accessor: (service) => service.id,
				priority: "medium",
				width: "78px",
				maxWidth: "90px",
				mobilePriority: 1,
				mobileMetaLabel: t("services.columns.id"),
				cell: (service) => (
					<span className="tabular-nums text-panel-text-secondary">
						#{service.id}
					</span>
				),
			},
			{
				id: "name",
				header: t("services.columns.name"),
				accessor: "name",
				isPrimary: true,
				priority: "primary",
				width: "240px",
				minWidth: "200px",
				maxWidth: "300px",
				truncate: true,
				tooltip: true,
				cellAlign: "start",
				mobilePriority: 0,
				mobileMetaLabel: t("services.columns.name"),
				cell: (service) => (
					<div className="flex flex-col gap-0.5 items-start text-start min-w-0!">
						<div className="flex flex-row items-center gap-2 justify-start min-w-0! max-w-full">
							<p className="font-semibold truncate">
								{service.name}
							</p>
							{!service.has_hosts && (
								<Badge className={cn("bg-destructive/10 text-destructive", "rounded-md shrink-0")}>
									{t("services.broken")}
								</Badge>
							)}
						</div>
						{service.description && (
							<p className={cn(labelColor, "text-[0.75rem] truncate")}>
								{service.description}
							</p>
						)}
					</div>
				),
			},
			{
				id: "hosts",
				header: t("services.columns.hosts"),
				accessor: (service) => service.host_count,
				priority: "high",
				width: "96px",
				maxWidth: "110px",
				mobilePriority: 2,
				mobileMetaLabel: t("services.columns.hosts"),
				cell: (service) => (
					<p className="font-semibold">{service.host_count}</p>
				),
			},
			{
				id: "users",
				header: t("users"),
				accessor: (service) => service.user_count,
				priority: "high",
				width: "96px",
				maxWidth: "110px",
				mobilePriority: 3,
				mobileMetaLabel: t("users"),
				cell: (service) => (
					<p className="font-semibold">{service.user_count}</p>
				),
			},
			{
				id: "usage",
				header: t("services.columns.usage"),
				accessor: (service) => service.used_traffic,
				priority: "medium",
				width: "132px",
				maxWidth: "150px",
				mobilePriority: 4,
				mobileSummary: true,
				mobileMetaLabel: t("services.columns.usage"),
				cell: (service) => (
					<p dir="ltr" className="[unicode-bidi:isolate] whitespace-nowrap">
						{formatBytes(service.used_traffic)}
					</p>
				),
			},
			{
				id: "lifetime",
				header: t("services.columns.lifetime"),
				accessor: (service) => service.lifetime_used_traffic,
				priority: "low",
				hideBelow: "xl",
				width: "132px",
				maxWidth: "150px",
				mobilePriority: 5,
				mobileMetaLabel: t("services.columns.lifetime"),
				cell: (service) => (
					<p dir="ltr" className="[unicode-bidi:isolate] whitespace-nowrap">
						{formatBytes(service.lifetime_used_traffic)}
					</p>
				),
			},
		],
		[t],
	);

	const serviceRowActions = (
		service: ServiceSummary,
	): DataTableRowAction<ServiceSummary>[] => {
		const actions: DataTableRowAction<ServiceSummary>[] = [
			{
				id: "view",
				label: t("services.view"),
				icon: <Eye className="w-[16px]" />,
				onClick: () => {
					void openServiceDetail(service.id, "admins");
				},
			},
		];

		if (canManageServices) {
			actions.push(
				{
					id: "edit",
					label: t("edit"),
					icon: <SquarePen className="w-[16px]" />,
					onClick: () => openEditDialog(service.id),
				},
				{
					id: "reset",
					label: t("services.resetUsage"),
					icon: <RefreshCw className="w-[16px]" />,
					onClick: () => openResetConfirmation(service.id),
				},
				{
					id: "delete",
					label: t("delete"),
					icon: <Trash2 className="w-[16px]" />,
					onClick: () => beginDeleteService(service.id),
					isDanger: true,
				},
			);
		}

		return actions;
	};

	const selectedService = serviceDetail;
	const serviceDefaultCoefficient = selectedService?.usage_coefficient ?? 1;

	const saveServiceAdminLimit = useCallback(
		async (
			adminId: number,
			payload: {
				traffic_limit_mode?: AdminTrafficLimitMode;
				data_limit?: number | null;
				show_user_traffic?: boolean;
				users_limit?: number | null;
				delete_user_usage_limit_enabled?: boolean;
				delete_user_usage_limit?: number | null;
				usage_coefficient?: number | null;
			},
		) => {
			if (!selectedService) return false;
			setSavingAdminLimitId(adminId);
			try {
				if (payload.delete_user_usage_limit_enabled === true) {
					const targetAdmin = rawAdminOptions.find(
						(item) => item.id === adminId,
					);
					if (targetAdmin && !adminCanDeleteUsers(targetAdmin)) {
						await updateAdmin(targetAdmin.username, {
							permissions: withDeleteUserPermission(targetAdmin.permissions),
						});
					}
				}
				await updateServiceAdminLimits(
					selectedService.id,
					adminId,
					payload,
				);
				if (payload.delete_user_usage_limit_enabled === true) {
					await fetchServiceDetail(selectedService.id);
				}
				return true;
			} catch (error) {
				toast.error(t("services.adminLimitSaveFailed"), { description: error instanceof Error ? error.message : undefined });
				return false;
			} finally {
				setSavingAdminLimitId(null);
			}
		},
			[
				fetchServiceDetail,
				rawAdminOptions,
				selectedService,
				t,
				toast,
				updateAdmin,
				updateServiceAdminLimits,
			],
	);

	const openServiceAdminLimitEditor = (link: ServiceAdmin) => {
		setEditingServiceAdminLimit(link);
		setServiceAdminLimitForm({
			traffic_limit_mode:
				link.traffic_limit_mode ?? AdminTrafficLimitMode.UsedTraffic,
			data_limit_gb: formatUnitInputValue(link.data_limit),
			users_limit:
				link.users_limit !== undefined && link.users_limit !== null
					? String(link.users_limit)
					: "",
			show_user_traffic: link.show_user_traffic,
			delete_user_usage_limit_enabled: link.delete_user_usage_limit_enabled,
			delete_user_usage_limit_mb: formatUnitInputValue(
				link.delete_user_usage_limit,
				MB_IN_BYTES,
			),
			usage_coefficient: link.usage_coefficient != null ? String(link.usage_coefficient) : "",
		});
	};

	const closeServiceAdminLimitEditor = () => {
		setEditingServiceAdminLimit(null);
	};

	const submitServiceAdminLimitEditor = async () => {
		if (!editingServiceAdminLimit) return;
		const dataLimitGb = parseDecimalInput(serviceAdminLimitForm.data_limit_gb);
		const usersLimit = parseIntegerInput(serviceAdminLimitForm.users_limit);
		const deleteUserUsageLimitMb = parseDecimalInput(
			serviceAdminLimitForm.delete_user_usage_limit_mb,
		);
		const usageCoefficient = parseCoefficientInput(
			serviceAdminLimitForm.usage_coefficient,
		);
		if (usageCoefficient !== null && (usageCoefficient < 0.01 || usageCoefficient > 100)) {
			toast.warning(t("services.validation.usageCoefficientInvalid"));
			return;
		}
		const saved = await saveServiceAdminLimit(editingServiceAdminLimit.id, {
			usage_coefficient: usageCoefficient,
			traffic_limit_mode: serviceAdminLimitForm.traffic_limit_mode,
			data_limit: dataLimitGb !== null ? dataLimitGb * GB_IN_BYTES : null,
			users_limit: usersLimit,
			show_user_traffic: serviceAdminLimitForm.show_user_traffic,
			delete_user_usage_limit_enabled:
				serviceAdminLimitForm.delete_user_usage_limit_enabled,
			delete_user_usage_limit:
				deleteUserUsageLimitMb !== null
					? deleteUserUsageLimitMb * MB_IN_BYTES
					: null,
		});
		if (saved) {
			closeServiceAdminLimitEditor();
		}
	};

	const resetServiceDeletedUsersUsage = async (link: {
		id: number;
		username: string;
	}) => {
		if (!selectedService) return;
		setSavingAdminLimitId(link.id);
		try {
			await resetDeletedUsersUsage(
				link.username,
				selectedService.id,
			);
			await fetchServiceDetail(selectedService.id);
			toast.success(t("admins.resetDeletedUsageSuccess"));
		} catch (error) {
			toast.error(t("admins.resetDeletedUsageFailed"), { description: error instanceof Error ? error.message : undefined });
		} finally {
			setSavingAdminLimitId(null);
		}
	};

	const serviceAdminColumns = useMemo<DataTableColumn<ServiceAdmin>[]>(
		() => [
			{
				id: "username",
				header: t("username"),
				accessor: "username",
				isPrimary: true,
				priority: "primary",
				width: "180px",
				minWidth: "160px",
				maxWidth: "220px",
				truncate: true,
				tooltip: true,
				mobilePriority: 0,
				mobileMetaLabel: t("username"),
				cell: (link) => (
					<p dir="ltr" className="font-semibold [unicode-bidi:isolate]">
						{link.username}
					</p>
				),
			},
			{
				id: "usage",
				sortValue: (link) => (link.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic ? link.created_traffic : link.used_traffic) ?? 0,
				header: t("services.columns.usage"),
				priority: "high",
				width: "170px",
				maxWidth: "190px",
				mobilePriority: 1,
				mobileSummary: true,
				mobileMetaLabel: t("services.columns.usage"),
				cell: (link) => (
					<p dir="ltr" className="text-[0.875rem] [unicode-bidi:isolate] whitespace-nowrap">
						{link.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
							? formatBytes(link.created_traffic)
							: formatBytes(link.used_traffic)}{" "}
						/ {formatGigabytes(link.data_limit, t("nodes.unlimited"))}
					</p>
				),
			},
			{
				id: "mode",
				sortValue: (link) => link.traffic_limit_mode ?? "",
				header: t("admins.trafficMode"),
				priority: "medium",
				hideBelow: "xl",
				width: "150px",
				maxWidth: "170px",
				mobilePriority: 2,
				mobileMetaLabel: t("admins.trafficMode"),
				cell: (link) => (
					<Select
						size="sm"
						value={link.traffic_limit_mode}
						disabled={savingAdminLimitId === link.id}
						onClick={(event) => event.stopPropagation()}
						onChange={(event) =>
							saveServiceAdminLimit(link.id, {
								traffic_limit_mode: event.target.value as AdminTrafficLimitMode,
							})
						}
					>
						<option value={AdminTrafficLimitMode.UsedTraffic}>
							{t("nodes.usedTrafficSeries")}
						</option>
						<option value={AdminTrafficLimitMode.CreatedTraffic}>
							{t("myaccount.createdTraffic")}
						</option>
					</Select>
				),
			},
			{
				id: "data_limit",
				sortValue: (link) => link.data_limit ?? 0,
				header: t("admins.dataLimit"),
				priority: "medium",
				hideBelow: "xl",
				width: "120px",
				maxWidth: "140px",
				mobilePriority: 3,
				mobileMetaLabel: t("admins.dataLimit"),
				cell: (link) => (
					<Input
						size="sm"
						type="number"
						inputMode="decimal"
						min={0}
						step={0.01}
						defaultValue={formatUnitInputValue(link.data_limit)}
						disabled={savingAdminLimitId === link.id}
						onClick={(event) => event.stopPropagation()}
						onInput={(event) => {
							event.currentTarget.value = sanitizeDecimalInput(
								event.currentTarget.value,
							);
						}}
						onBlur={(event) => {
							const dataLimitGb = parseDecimalInput(event.target.value);
							saveServiceAdminLimit(link.id, {
								data_limit:
									dataLimitGb !== null ? dataLimitGb * GB_IN_BYTES : null,
							});
						}}
					/>
				),
			},
			{
				id: "users_limit",
				sortValue: (link) => link.users_limit ?? 0,
				header: t("admins.usersLimit"),
				priority: "low",
				hideBelow: "xl",
				width: "110px",
				maxWidth: "130px",
				mobilePriority: 4,
				mobileMetaLabel: t("admins.usersLimit"),
				cell: (link) => (
					<Input
						size="sm"
						type="number"
						inputMode="numeric"
						min={0}
						step={1}
						defaultValue={link.users_limit ?? ""}
						disabled={savingAdminLimitId === link.id}
						onClick={(event) => event.stopPropagation()}
						onInput={(event) => {
							event.currentTarget.value = sanitizeIntegerInput(
								event.currentTarget.value,
							);
						}}
						onBlur={(event) =>
							saveServiceAdminLimit(link.id, {
								users_limit: parseIntegerInput(event.target.value),
							})
						}
					/>
				),
			},
			{
				id: "delete_cap",
				sortValue: (link) => link.delete_user_usage_limit ?? 0,
				header: t("admins.deleteUserUsageLimit"),
				priority: "low",
				hideBelow: "xl",
				width: "128px",
				maxWidth: "150px",
				mobilePriority: 5,
				mobileMetaLabel: t("admins.deleteUserUsageLimit"),
				cell: (link) => (
					<Input
						size="sm"
						type="number"
						inputMode="decimal"
						min={0}
						step={0.01}
						defaultValue={formatUnitInputValue(
							link.delete_user_usage_limit,
							MB_IN_BYTES,
						)}
						disabled={savingAdminLimitId === link.id}
						onClick={(event) => event.stopPropagation()}
						onInput={(event) => {
							event.currentTarget.value = sanitizeDecimalInput(
								event.currentTarget.value,
							);
						}}
						onBlur={(event) => {
							const deleteUserUsageLimitMb = parseDecimalInput(
								event.target.value,
							);
							saveServiceAdminLimit(link.id, {
								delete_user_usage_limit:
									deleteUserUsageLimitMb !== null
										? deleteUserUsageLimitMb * MB_IN_BYTES
										: null,
							});
						}}
					/>
				),
			},
			{
				id: "usage_coefficient",
				sortValue: (link) => link.usage_coefficient ?? 0,
				header: t("services.usageCoefficientColumn"),
				priority: "low",
				hideBelow: "xl",
				width: "230px",
				maxWidth: "260px",
				mobilePriority: 7,
				mobileMetaLabel: t("services.usageCoefficientColumn"),
				cell: (link) => {
					const coefficient = link.usage_coefficient ?? null;
					return (
						<div className="flex flex-row items-center gap-2">
							<Select
								size="sm"
								value={coefficient === null ? "default" : "custom"}
								disabled={savingAdminLimitId === link.id}
								onClick={(event) => event.stopPropagation()}
								onChange={(event) =>
									saveServiceAdminLimit(link.id, {
										usage_coefficient:
											event.target.value === "custom" ? serviceDefaultCoefficient : null,
									})
								}
							>
								<option value="default">
									{t("services.usageCoefficientDefault", { value: serviceDefaultCoefficient })}
								</option>
								<option value="custom">{t("services.usageCoefficientCustom")}</option>
							</Select>
							{coefficient !== null ? (
								<Input key={`${link.id}-${coefficient}`} size="sm" type="number" inputMode="decimal" min={0.01} max={100} step={0.01} precision={2} defaultValue={coefficient} disabled={savingAdminLimitId === link.id} onClick={(event) => event.stopPropagation()} onInput={(event) => {
										event.currentTarget.value = sanitizeDecimalInput(event.currentTarget.value);
									}} onBlur={(event) => {
										const value = parseCoefficientInput(event.target.value);
										if (value === null || value < 0.01 || value > 100) {
											toast.warning(t("services.validation.usageCoefficientInvalid"));
											event.target.value = String(coefficient);
											return;
										}
										if (value !== coefficient) {
											saveServiceAdminLimit(link.id, { usage_coefficient: value });
										}
									}} className="w-[90px]" />
							) : null}
						</div>
					);
				},
			},
			{
				id: "flags",
				sortValue: (link) => (link.show_user_traffic ? 1 : 0) + (link.delete_user_usage_limit_enabled ? 2 : 0),
				header: t("admins.permissionsTabLabel"),
				priority: "low",
				hideBelow: "xl",
				width: "230px",
				maxWidth: "260px",
				mobilePriority: 6,
				mobileMetaLabel: t("admins.permissionsTabLabel"),
				cell: (link) => (
					<div className="flex flex-row items-center gap-3 justify-center flex-wrap">
						<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={link.show_user_traffic} disabled={savingAdminLimitId === link.id} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked: boolean) => saveServiceAdminLimit(link.id, {
									show_user_traffic: checked,
								})} /><span>{t("admins.showUserTraffic")}</span></label>
						<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={link.delete_user_usage_limit_enabled} disabled={savingAdminLimitId === link.id} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked: boolean) => saveServiceAdminLimit(link.id, {
									delete_user_usage_limit_enabled: checked,
								})} /><span>{t("admins.deleteUserUsageCap")}</span></label>
					</div>
				),
			},
		],
		[saveServiceAdminLimit, savingAdminLimitId, serviceDefaultCoefficient, t, toast],
	);

	const serviceAdminRowActions = (
		link: ServiceAdmin,
	): DataTableRowAction<ServiceAdmin>[] => [
		{
			id: "editLimits",
			label: t("services.editAdminLimits"),
			icon: <SquarePen className="w-[16px]" />,
			onClick: () => openServiceAdminLimitEditor(link),
			disabled: savingAdminLimitId === link.id,
		},
		{
			id: "resetDeleted",
			label: t("admins.resetDeletedUsage"),
			icon: <RefreshCw className="w-[16px]" />,
			onClick: () => resetServiceDeletedUsersUsage(link),
			disabled:
				link.deleted_users_usage <= 0 || savingAdminLimitId === link.id,
		},
	];

	const serviceHostColumns = useMemo<DataTableColumn<ServiceHost>[]>(
		() => [
			{
				id: "remark",
				header: t("nodes.nodeName"),
				accessor: "remark",
				isPrimary: true,
				priority: "primary",
				width: "220px",
				maxWidth: "260px",
				truncate: true,
				tooltip: true,
				mobilePriority: 0,
				mobileMetaLabel: t("nodes.nodeName"),
				cell: (host) => (
					<p className="font-semibold truncate">
						<AppleEmojiText>{host.remark}</AppleEmojiText>
					</p>
				),
			},
			{
				id: "inbound",
				sortValue: (host) => host.inbound_tag ?? "",
				header: t("inbound"),
				priority: "high",
				width: "180px",
				maxWidth: "220px",
				truncate: true,
				tooltip: true,
				mobilePriority: 1,
				mobileMetaLabel: t("inbound"),
				cell: (host) => (
					<p className="text-[0.875rem] truncate">
						{host.inbound_protocol.toUpperCase()} - {host.inbound_tag}
					</p>
				),
			},
			{
				id: "address",
				header: t("nodes.nodeAddress"),
				accessor: "address",
				priority: "medium",
				hideBelow: "xl",
				width: "170px",
				maxWidth: "210px",
				truncate: true,
				tooltip: true,
				mobilePriority: 2,
				mobileMetaLabel: t("nodes.nodeAddress"),
				cell: (host) => (
					<p dir="ltr" className="[unicode-bidi:isolate] truncate">
						{host.address || "-"}
					</p>
				),
			},
			{
				id: "port",
				header: t("port"),
				accessor: "port",
				priority: "medium",
				width: "90px",
				maxWidth: "110px",
				mobilePriority: 3,
				mobileMetaLabel: t("port"),
				cell: (host) => <p>{host.port ?? "-"}</p>,
			},
			{
				id: "sort",
				header: t("services.sort"),
				accessor: "sort",
				priority: "low",
				hideBelow: "xl",
				width: "90px",
				maxWidth: "110px",
				mobilePriority: 4,
				mobileMetaLabel: t("services.sort"),
				cell: (host) => <Badge className="rounded-md">#{host.sort + 1}</Badge>,
			},
		],
		[t],
	);

	if (!getUserIsSuccess) {
		return <PageLoadingSkeleton />;
	}

	if (!canManageServices) {
		return (
			<div className="flex flex-col gap-3 items-stretch">
				<PageHeader title={t("services.title")} />
				<p className="text-[0.875rem] text-panel-text-muted">
					{t("services.noPermission")}
				</p>
			</div>
		);
	}

	const renderExpandedService = (service: ServiceSummary) => {
		const actions = serviceRowActions(service).filter(Boolean);
		return (
			<div className="rb-resource-expanded">
				<ExpandedDetails>
					<ExpandedHeading title={t("services.basicInfo")} first />
					<ExpandedMeta label={t("services.fields.description")} value={service.description || "-"} />
					<ExpandedMeta label={t("services.fields.usageCoefficient")} value={String(service.usage_coefficient)} />
					<ExpandedMeta label={t("users")} value={String(service.user_count)} />
					<ExpandedMeta label={t("services.columns.hosts")} value={String(service.host_count)} />
					<ExpandedHeading title={t("services.totalUsage")} />
					<ExpandedMeta label={t("services.columns.usage")} value={formatBytes(service.used_traffic)} />
					<ExpandedMeta label={t("services.columns.lifetime")} value={formatBytes(service.lifetime_used_traffic)} />
				</ExpandedDetails>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control */}
				<div onClick={(event) => event.stopPropagation()} className="flex items-center justify-end gap-1 flex-wrap rb-resource-expanded-actions">
					<div className="flex flex-row items-center gap-1 flex-wrap rb-inline-actions">
						{actions.map((action) => (
							<Tooltip key={action.id}>
<TooltipTrigger asChild>
								<span>
									<Button aria-label={String(action.label)} disabled={typeof action.disabled === "function" ? action.disabled(service) : action.disabled} onClick={() => action.onClick?.(service)} variant="ghost" size="sm" className={cn("size-8 p-0", "min-w-[30px]! h-[30px]")}>{action.icon}</Button>
								</span>
							</TooltipTrigger>
<TooltipContent>{action.label}</TooltipContent>
</Tooltip>
						))}
					</div>
				</div>
			</div>
		);
	};

	return (
		<div className="flex flex-col gap-4 items-stretch rb-services-section">
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand total={serviceOverview.total} rows={serviceOverview.rows} distribution={serviceOverview.distribution} extra={serviceOverview.extra} locale={locale} />
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						<div className="min-w-0 flex-1">
							<SearchInput
								containerProps={{ className: "w-full md:w-[360px]" }}
								placeholder={t("services.searchServices")}
								value={serviceSearch}
								onChange={(event) => setServiceSearch(event.target.value)}
								matchOptions={serviceMatchOptions}
								onMatchOptionsChange={setServiceMatchOptions}
								loading={isServicesLoading}
								onClear={() => setServiceSearch("")}
							/>
						</div>
						<div className="flex shrink-0 items-center justify-end gap-1.5">
							<Button aria-label={t("refresh")} onClick={() => void fetchServices(listFilters)} variant="ghost" size="sm" loading={isServicesLoading} className="size-8 p-0">{<RefreshCw className="w-[16px]" />}</Button>
							<Button onClick={openCreateDialog} size="sm" className="h-[36px] px-3 rounded-[4px]">
								<Plus className="w-[18px]" />
								{t("services.addService")}
							</Button>
						</div>
					</div>
				</div>
			</div>

			<DataTable
				ariaLabel={t("services.title")}
					data={services}
				columns={serviceColumns}
				getRowId={(service) => String(service.id)}
					loading={isServicesLoading}
				loadingRows={5}
				emptyState={
					<div className="text-center">
						<p className="font-semibold">
							{t("services.noServicesAvailable")}
						</p>
						<p className={cn(labelColor, "text-[0.875rem] mt-1")}>
							{t("services.emptyHint")}
						</p>
					</div>
				}
				rowActions={serviceRowActions}

				actionsPlacement="end"
				actionsColumnWidth="60px"
				// Two services, sorted client-side: the floating sort control above the
				// table added noise without a toolbar to sit in.
				showSortMenu={false}

				onRowClick={(service) => setExpandedServiceId((current) => (current === service.id ? null : service.id))}
				isRowExpanded={(service) => expandedServiceId === service.id}
				renderExpandedRow={renderExpandedService}
				mobileBreakpoint="md"
				tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }}
			/>
			<Pagination
				for="services"
				total={servicesTotal}
				limit={listFilters.limit}
				offset={listFilters.offset}
				onPageChange={(page) =>
					setListFilters((current) => ({
						...current,
						offset: page * current.limit,
					}))
				}
				onPageSizeChange={(size) =>
					setListFilters((current) => ({
						...current,
						limit: size,
						offset: 0,
					}))
				}
			/>

			{selectedService && (
				<div className="flex flex-col gap-3">
					<PageHeader
						title={
							<span className="text-[1rem] font-semibold truncate">
								{selectedService.name}
							</span>
						}
						description={
							selectedService.description ? (
								<span className="line-clamp-2">
									{selectedService.description}
								</span>
							) : undefined
						}
						actions={
							<Badge className="rounded-md">
								{t("services.usersCount", {
									count: selectedService.user_count,
								})}
							</Badge>
						}
					/>
					<TabSystem
						tabs={[
							{
								label: t("services.admins"),
								value: "admins",
								isActive: activeServiceTab === "admins",
								onClick: () => setActiveServiceTab("admins"),
							},
							{
								label: t("services.hosts"),
								value: "hosts",
								isActive: activeServiceTab === "hosts",
								onClick: () => setActiveServiceTab("hosts"),
							},
						]}
					/>
					{activeServiceTab === "admins" ? (
						<DataTable containerProps={{ className: "mt-3" }} ariaLabel={t("services.admins")} data={selectedService.admins} columns={serviceAdminColumns} getRowId={(link) => String(link.id)} emptyState={
								<p className="text-[0.875rem] text-panel-text-muted text-center">
									{t("services.noAdmins")}
								</p>
							} rowActions={serviceAdminRowActions} actionsPlacement="end" actionsColumnWidth="60px" mobileBreakpoint="md" tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }} />
					) : (
						<DataTable containerProps={{ className: "mt-3" }} ariaLabel={t("services.hosts")} data={selectedService.hosts} columns={serviceHostColumns} getRowId={(host) => String(host.id)} emptyState={
								<p className="text-[0.875rem] text-panel-text-muted text-center">
									{t("services.noHosts")}
								</p>
							} mobileBreakpoint="md" tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }} />
					)}
				</div>
			)}

			<AppDialog open={Boolean(editingServiceAdminLimit)} onClose={closeServiceAdminLimitEditor} size="lg" title={`${t("services.editAdminLimits")}${
					editingServiceAdminLimit
						? ` - ${editingServiceAdminLimit.username}`
						: ""
				}`} footerProps={{ className: "gap-3" }} footer={
					<>
						<Button onClick={closeServiceAdminLimitEditor} variant="ghost">
							{t("cancel")}
						</Button>
						<Button onClick={submitServiceAdminLimitEditor} loading={
								editingServiceAdminLimit
									? savingAdminLimitId === editingServiceAdminLimit.id
									: false
							}>
							{t("save")}
						</Button>
					</>
				}>
				<div className="flex flex-col gap-4">
					<FormField label={t("admins.trafficMode")} htmlFor="service-admin-traffic-mode">
						<Select
							id="service-admin-traffic-mode"
							value={serviceAdminLimitForm.traffic_limit_mode}
							onChange={(event) =>
								setServiceAdminLimitForm((current) => ({
									...current,
									traffic_limit_mode: event.target.value as AdminTrafficLimitMode,
								}))
							}
						>
							<option value={AdminTrafficLimitMode.UsedTraffic}>{t("nodes.usedTrafficSeries")}</option>
							<option value={AdminTrafficLimitMode.CreatedTraffic}>{t("myaccount.createdTraffic")}</option>
						</Select>
					</FormField>
					<FormField
						label={t("services.usageCoefficientColumn")}
						htmlFor="service-admin-usage-coefficient"
						description={t("services.adminUsageCoefficientHint", { value: selectedService?.usage_coefficient ?? 1 })}
					>
						<Input
							id="service-admin-usage-coefficient"
							type="number"
							inputMode="decimal"
							min={0.01}
							max={100}
							step={0.01}
							precision={2}
							placeholder={String(selectedService?.usage_coefficient ?? 1)}
							value={serviceAdminLimitForm.usage_coefficient}
							onChange={(event) =>
								setServiceAdminLimitForm((current) => ({
									...current,
									usage_coefficient: event.target.value,
								}))
							}
						/>
					</FormField>
					<div className="grid grid-cols-1 gap-3">
						<FormField label={t("admins.dataLimit")} htmlFor="service-admin-data-limit">
							<DataSizeField
								id="service-admin-data-limit"
								valueGb={serviceAdminLimitForm.data_limit_gb}
								placeholder={t("admins.dataLimitHint")}
								onChangeGb={(raw) =>
									setServiceAdminLimitForm((current) => ({
										...current,
										data_limit_gb: raw,
									}))
								}
							/>
						</FormField>
						<FormField label={t("admins.usersLimit")} htmlFor="service-admin-users-limit">
							<Input
								id="service-admin-users-limit"
								type="number"
								inputMode="numeric"
								min={0}
								step={1}
								value={serviceAdminLimitForm.users_limit}
								placeholder={t("admins.usersLimitHint")}
								onChange={(event) =>
									setServiceAdminLimitForm((current) => ({
										...current,
										users_limit: sanitizeIntegerInput(event.target.value),
									}))
								}
							/>
						</FormField>
					</div>
					<div className="flex flex-col gap-3">
						<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={serviceAdminLimitForm.show_user_traffic} onCheckedChange={(checked: boolean) => setServiceAdminLimitForm((current) => ({
									...current,
									show_user_traffic: checked,
								}))} /><span>{t("admins.showUserTraffic")}</span></label>
						<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={serviceAdminLimitForm.delete_user_usage_limit_enabled} onCheckedChange={(checked: boolean) => setServiceAdminLimitForm((current) => ({
									...current,
									delete_user_usage_limit_enabled: checked,
								}))} /><span>{t("admins.deleteUserUsageCap")}</span></label>
						<FormField label={t("admins.deleteUserUsageLimit")} htmlFor="service-admin-delete-usage-limit" className={!serviceAdminLimitForm.delete_user_usage_limit_enabled ? "opacity-60" : undefined}><Input id="service-admin-delete-usage-limit" disabled={!serviceAdminLimitForm.delete_user_usage_limit_enabled}
								type="number"
								inputMode="decimal"
								min={0}
								step={0.01}
								value={serviceAdminLimitForm.delete_user_usage_limit_mb}
								onChange={(event) =>
									setServiceAdminLimitForm((current) => ({
										...current,
										delete_user_usage_limit_mb: sanitizeDecimalInput(
											event.target.value,
										),
									}))
								}
							/></FormField>
					</div>
				</div>
			</AppDialog>

			<ConfirmDialog
				open={isResetDialogOpen}
				onClose={closeResetDialog}
				onConfirm={confirmResetUsage}
				title={t("services.resetUsage")}
				description={t("services.resetUsageConfirm", {
					name: resetTargetName ?? t("services.thisService"),
				})}
				confirmLabel={t("services.resetUsage")}
				colorScheme="primary"
				loading={isResetting}
				isConfirmDisabled={resetServiceId == null}
			/>

			<AppDialog open={isDeleteDialogOpen} onClose={handleCloseDeleteDialog} size="lg" title={`${t("services.deleteDialogTitle")}${
					servicePendingDelete ? ` – ${servicePendingDelete.name}` : ""
				}`} footerProps={{ className: "gap-3" }} footer={
					<>
						<Button onClick={handleCloseDeleteDialog} variant="ghost">
							{t("cancel")}
						</Button>
						<Button onClick={confirmDeleteService} disabled={
								!servicePendingDelete ||
								(deleteMode === "transfer_users" &&
									servicePendingDelete.user_count > 0 &&
									!targetServiceId)
							} variant="destructive" loading={isDeleting}>
							{t("delete")}
						</Button>
					</>
				}>
				{servicePendingDelete ? (
					<div className="flex flex-col items-stretch gap-4">
						<p>
							{t("services.deleteDialogDescription", {
								name: servicePendingDelete.name,
							})}
						</p>
						{servicePendingDelete.admin_ids.length > 0 ? (
							<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={unlinkAdmins} onCheckedChange={(checked: boolean) => setUnlinkAdmins(checked)} /><span>{t("services.unlinkAdminsOption")}</span></label>
						) : (
							<p className="text-[0.875rem] text-gray-500">
								{t("services.noAdminsLinked")}
							</p>
						)}
						{servicePendingDelete.user_count > 0 ? (
							<div className="flex flex-col items-stretch gap-3">
								<p className="font-semibold">
									{t("services.userDeletePrompt", {
										count: servicePendingDelete.user_count,
									})}
								</p>
								<RadioGroup value={deleteMode} onValueChange={(value) =>
										setDeleteMode(value as "delete_users" | "transfer_users")
									}>
									<div className="flex flex-col items-start gap-2">
										<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="delete_users" /><span>{t("services.deleteUsersOption")}</span></label>
										<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="transfer_users" /><span>{t("services.transferUsersOption")}</span></label>
									</div>
								</RadioGroup>
								{deleteMode === "transfer_users" && (
									<FormField label={t("services.selectTargetService")} htmlFor="service-transfer-target" description={t("services.transferUsersHint")}><Select id="service-transfer-target"
											placeholder={t("services.selectServicePlaceholder")}
											value={targetServiceId?.toString() ?? ""}
											onChange={(
												event: React.ChangeEvent<HTMLSelectElement>,
											) => {
												const value = event.target.value;
												if (!value) {
													setTargetServiceId(null);
													return;
												}
												setTargetServiceId(Number(value));
											}}
										>
											{otherServices.map((service) => (
												<option key={service.id} value={service.id}>
													{service.name}
												</option>
											))}
										</Select></FormField>
								)}
							</div>
						) : (
							<Alert className="rounded-md">
								<Info className="size-4" aria-hidden="true" />
								<AlertDescription>
									{t("services.noUsersLinked")}
								</AlertDescription>
							</Alert>
						)}
					</div>
				) : (
					<p>{t("services.loading")}</p>
				)}
			</AppDialog>

			{dialogDisclosure.isOpen && (
				<ServiceDialog
					open={dialogDisclosure.isOpen}
					onClose={dialogDisclosure.onClose}
					onSubmit={handleSubmit}
						isSaving={isServiceSaving}
					allHosts={hostOptions}
					allAdmins={adminOptions}
					initialService={editingService ?? undefined}
					inbounds={inbounds}
					refreshInbounds={fetchInbounds}
						refreshHosts={fetchHosts}
				/>
			)}
		</div>
	);
};

export default ServicesPage;
