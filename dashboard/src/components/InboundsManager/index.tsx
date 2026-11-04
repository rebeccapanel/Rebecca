import { Badge } from "components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Button } from "components/ui/button";
import { Alert } from "components/ui/alert";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";
import { RefreshCw, Pencil, Plus, Trash2 } from "lucide-react";
import type { SortingState } from "@tanstack/react-table";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";

import { useDisclosure } from "hooks/useDisclosure";

import type { CoreConfigTarget } from "contexts/CoreSettingsContext";
import { fetchInbounds as refreshInboundsStore } from "contexts/DashboardContext";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch, getAPIErrorMessage } from "service/http";
import {
	buildInboundPayload,
	getInboundTraffic,
	inboundPortNumbers,
	type InboundFormValues,
	protocolLabel,
	protocolOptions,
	type RawInbound,
} from "utils/inbounds";
import { getInboundTargetIds } from "utils/inboundTargets";
import { SizeFormatter } from "utils/outbound";
import {
	DEFAULT_SEARCH_MATCH_OPTIONS,
	matchesAnySearch,
} from "utils/searchMatch";
import { type InboundSpeedMap, summarizeInbounds } from "utils/resourceSummary";
import { SearchableTagSelect } from "../common/SearchableTagSelect";
import { SearchInput } from "../common/SearchInput";
import { OverviewBand } from "components/ui/overview-band";
import { ConfirmDialog, DeleteConfirmDialog } from "../dialogs/ConfirmDialog";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
	ResourceRefreshButton,
} from "../ui";
import { InboundFormModal } from "./FormDrawer";

type FilterState = {
	protocol: string;
	search: string;
};

const normalizeTargetRefs = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => {
			if (typeof item === "string") return item;
			if (item && typeof item === "object" && "id" in item) {
				const id = (item as { id?: unknown }).id;
				return typeof id === "string" ? id : "";
			}
			return "";
		})
		.filter(Boolean);
};

const normalizeInboundTargets = (inbound: RawInbound): RawInbound => ({
	...inbound,
	targets: normalizeTargetRefs((inbound as { targets?: unknown }).targets),
	effective_targets: normalizeTargetRefs(
		(inbound as { effective_targets?: unknown }).effective_targets,
	),
});

export const InboundsManager: FC = () => {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	
	const [inbounds, setInbounds] = useState<RawInbound[]>([]);
	const [speeds, setSpeeds] = useState<InboundSpeedMap>({});
	const [configTargets, setConfigTargets] = useState<CoreConfigTarget[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isMutating, setIsMutating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<FilterState>({
		protocol: "all",
		search: "",
	});
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [selectedInboundTags, setSelectedInboundTags] = useState<string[]>([]);
	const [selected, setSelected] = useState<RawInbound | null>(null);
	const [cloneTarget, setCloneTarget] = useState<RawInbound | null>(null);
	const { isOpen, onOpen, onClose } = useDisclosure();
	const cloneDrawer = useDisclosure();
	const resetDialog = useDisclosure();
	const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
	const [resetTarget, setResetTarget] = useState<RawInbound | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<RawInbound | null>(null);

	const loadInbounds = useCallback(() => {
		setIsLoading(true);
		setError(null);
		Promise.all([
			fetch<RawInbound[]>("/inbounds/full"),
			fetch<{ targets: CoreConfigTarget[] }>("/core/config/targets"),
		])
			.then(([data, targetsResponse]) => {
				setInbounds((data || []).map(normalizeInboundTargets));
				setConfigTargets(targetsResponse?.targets || []);
			})
			.catch((error) => {
				setError(getAPIErrorMessage(error) || t("inbounds.error.load"));
			})
			.finally(() => setIsLoading(false));
	}, [t]);

	useEffect(() => {
		loadInbounds();
	}, [loadInbounds]);

	useEffect(() => {
		let active = true;
		const loadSpeeds = () => {
			fetch<InboundSpeedMap>("/inbounds/speeds")
				.then((data) => {
					if (active) setSpeeds(data || {});
				})
				.catch(() => undefined);
		};
		loadSpeeds();
		const timer = window.setInterval(loadSpeeds, 5000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, []);

	const filtered = useMemo(() => {
		const matches = inbounds.filter((inbound) => {
			if (filter.protocol !== "all" && inbound.protocol !== filter.protocol) {
				return false;
			}
			return matchesAnySearch(
				[inbound.tag, inbound.port],
				filter.search,
				searchMatch,
			);
		});
		return matches;
	}, [inbounds, filter, searchMatch]);
	const targetNameById = useMemo(
		() =>
			Object.fromEntries(
				configTargets.map((target) => [
					target.id,
					target.type === "master" ? t("default") : target.name || target.id,
				]),
			),
		[configTargets, t],
	);

	const openCreate = () => {
		setDrawerMode("create");
		setSelected(null);
		onOpen();
	};

	const openEdit = (inbound: RawInbound) => {
		setDrawerMode("edit");
		setSelected(inbound);
		onOpen();
	};

	const submitInbound = async (
		values: InboundFormValues,
		options: {
			mode: "create" | "edit";
			initial?: RawInbound | null;
			onSuccess: () => void;
		},
	) => {
		const { mode, initial, onSuccess } = options;
		const { note: nextNote, ...inboundValues } = values;
		setIsMutating(true);
		try {
			const normalizedTag = (values.tag || "").trim().toLowerCase();
			const isEditMode = mode === "edit";
			const selectedTargets = new Set(
				values.targetIds?.length ? values.targetIds : ["master"],
			);
			const tagExists = inbounds.some(
				(inb) =>
					(inb.tag || "").trim().toLowerCase() === normalizedTag &&
					(!isEditMode || inb.tag !== initial?.tag),
			);
			const portExists = inbounds.some((inb) => {
				if (isEditMode && inb.tag === initial?.tag) {
					return false;
				}
				const inboundTargets = inb.effective_targets?.length
					? inb.effective_targets
					: inb.targets?.length
						? inb.targets
						: ["master"];
				return (
					inb.port?.toString() === values.port &&
					inboundTargets.some((targetId) => selectedTargets.has(targetId))
				);
			});
			if (tagExists) {
				throw new Error(t("inbounds.error.tagExists"));
			}
			if (portExists) {
				throw new Error(t("inbounds.error.portExists"));
			}

			const payload = {
				...buildInboundPayload(inboundValues, { initial: initial ?? null }),
				targets: values.targetIds?.length ? values.targetIds : ["master"],
			};
			const url =
				mode === "create"
					? "/inbounds"
					: `/inbounds/${encodeURIComponent(payload.tag)}`;
			await fetch(url, {
				method: mode === "create" ? "POST" : "PUT",
				body: payload,
			});
			toast.success(mode === "create"
						? t("inbounds.success.created")
						: t("inbounds.success.updated"));
			refreshInboundsStore();
			await loadInbounds();
			if (nextNote !== undefined) {
				try {
					await fetch(`/notes/inbound/${encodeURIComponent(payload.tag)}`, {
						method: "PUT",
						body: { note: nextNote },
					});
				} catch {
					toast.error(t("entityNote.saveFailed"));
				}
			}
			onSuccess();
		} catch (err: unknown) {
			let description: string | undefined;
			if (
				err &&
				typeof err === "object" &&
				"data" in err &&
				typeof (err as { data?: { detail?: unknown } }).data?.detail ===
					"string"
			) {
				description = (err as { data?: { detail?: string } }).data?.detail;
			} else if (
				err &&
				typeof err === "object" &&
				"message" in err &&
				typeof (err as { message?: unknown }).message === "string"
			) {
				description = (err as { message?: string }).message;
			}
			toast.error(t("inbounds.error.submit"));
		} finally {
			setIsMutating(false);
		}
	};

	const handleSubmit = (values: InboundFormValues) =>
		submitInbound(values, {
			mode: drawerMode,
			initial: selected,
			onSuccess: () => {
				onClose();
			},
		});

	const handleCloneSubmit = (values: InboundFormValues) =>
		submitInbound(values, {
			mode: "create",
			initial: cloneTarget,
			onSuccess: () => {
				cloneDrawer.onClose();
				setCloneTarget(null);
			},
		});

	const handleDelete = async (inbound: RawInbound) => {
		if (!inbound) {
			return;
		}
		setIsMutating(true);
		try {
			await fetch(`/inbounds/${encodeURIComponent(inbound.tag)}`, {
				method: "DELETE",
			});
			toast.success(t("inbounds.success.deleted"));
			refreshInboundsStore();
			await loadInbounds();
			setSelectedInboundTags((current) =>
				current.filter((tag) => tag !== inbound.tag),
			);
			if (selected?.tag === inbound.tag) {
				setSelected(null);
				onClose();
			}
			if (cloneTarget?.tag === inbound.tag) {
				setCloneTarget(null);
				cloneDrawer.onClose();
			}
		} catch (err: unknown) {
			let description: string | undefined;
			if (
				err &&
				typeof err === "object" &&
				"data" in err &&
				typeof (err as { data?: { detail?: unknown } }).data?.detail ===
					"string"
			) {
				description = (err as { data?: { detail?: string } }).data?.detail;
			} else if (
				err &&
				typeof err === "object" &&
				"message" in err &&
				typeof (err as { message?: unknown }).message === "string"
			) {
				description = (err as { message?: string }).message;
			}
			toast.error(t("inbounds.error.submit"));
		} finally {
			setIsMutating(false);
		}
	};

	const handleBulkDelete = async (items: RawInbound[]) => {
		if (items.length === 0) {
			return;
		}
		const tags = new Set(items.map((item) => item.tag));
		setIsMutating(true);
		try {
			for (const inbound of items) {
				await fetch(`/inbounds/${encodeURIComponent(inbound.tag)}`, {
					method: "DELETE",
				});
			}
			toast.success(t("inbounds.success.bulkDeleted"), { description: t("inbounds.success.bulkDeletedDescription", {
					count: items.length,
				}) });
			refreshInboundsStore();
			await loadInbounds();
			setSelectedInboundTags([]);
			if (selected && tags.has(selected.tag)) {
				setSelected(null);
				onClose();
			}
			if (cloneTarget && tags.has(cloneTarget.tag)) {
				setCloneTarget(null);
				cloneDrawer.onClose();
			}
		} catch (err: unknown) {
			let description: string | undefined;
			if (
				err &&
				typeof err === "object" &&
				"data" in err &&
				typeof (err as { data?: { detail?: unknown } }).data?.detail ===
					"string"
			) {
				description = (err as { data?: { detail?: string } }).data?.detail;
			} else if (
				err &&
				typeof err === "object" &&
				"message" in err &&
				typeof (err as { message?: unknown }).message === "string"
			) {
				description = (err as { message?: string }).message;
			}
			toast.error(t("inbounds.error.bulkDelete"));
		} finally {
			setIsMutating(false);
		}
	};

	const handleResetUsage = async () => {
		if (!resetTarget) return;
		setIsMutating(true);
		try {
			await fetch(
				`/inbounds/${encodeURIComponent(resetTarget.tag)}/usage/reset`,
				{ method: "POST" },
			);
			toast.success(t("inbounds.resetUsageSuccess"));
			await loadInbounds();
		} catch (error: unknown) {
			const detail = error as {
				data?: { detail?: string };
				message?: string;
			};
			toast.error(t("inbounds.resetUsageError"), { description: detail.data?.detail || detail.message });
		} finally {
			setIsMutating(false);
			setResetTarget(null);
			resetDialog.onClose();
		}
	};

	const openClone = useCallback(
		(inbound: RawInbound) => {
			const trimmedTag = (inbound.tag || "").trim();
			const tagMatch = trimmedTag.match(/^(.*?)(?:-(\d+))$/);
			let nextTag = trimmedTag;
			if (tagMatch?.[1]) {
				const base = tagMatch[1];
				const num = Number(tagMatch[2]);
				nextTag = Number.isFinite(num) ? `${base}-${num + 1}` : `${base}-1`;
			} else if (trimmedTag) {
				nextTag = `${trimmedTag}-1`;
			}

			const portNumber =
				typeof inbound.port === "string" ? Number(inbound.port) : inbound.port;
			const listedPorts = inboundPortNumbers(String(inbound.port ?? ""));
			const nextPort = Number.isFinite(portNumber)
				? portNumber + 1
				: listedPorts.length > 1
					? listedPorts.map((port) => port + 1).join(",")
					: inbound.port;

			setCloneTarget({
				...inbound,
				tag: nextTag,
				port: nextPort,
			});
			cloneDrawer.onOpen();
			onClose();
		},
		[cloneDrawer, onClose],
	);

		const inboundOverview = useMemo(() => {
		const protocolCounts = inbounds.reduce<Record<string, number>>(
			(acc, inbound) => {
				const key = inbound.protocol || "unknown";
				acc[key] = (acc[key] || 0) + 1;
				return acc;
			},
			{},
		);
		const ranked = Object.entries(protocolCounts).sort((a, b) => b[1] - a[1]);
		const tones = [
			"bg-panel-accent",
			"bg-panel-success",
			"bg-panel-info",
			"bg-panel-warning",
			"bg-panel-text-muted/60",
		];
		const segments = ranked.slice(0, 4).map(([protocol, value], index) => ({
			key: protocol,
			label: protocolLabel(protocol),
			value,
			tone: tones[index],
		}));
		const otherCount = ranked
			.slice(4)
			.reduce((sum, [, value]) => sum + value, 0);
		if (otherCount) {
			segments.push({
				key: "other",
				label: t("overview.other"),
				value: otherCount,
				tone: tones[4],
			});
		}
		const multiTargetCount = inbounds.filter(
			(inbound) => getInboundTargetIds(inbound).length > 1,
		).length;
		const sniffingCount = inbounds.filter(
			(inbound) => inbound.sniffing?.enabled,
		).length;
		const totals = summarizeInbounds(filtered, speeds);
		const isFiltered = filtered.length !== inbounds.length;

		return {
			total: {
				label: t("total"),
				value: inbounds.length,
				caption: isFiltered
					? `${t("usersPage.filtered")}: ${filtered.length}`
					: `${t("userDialog.protocols")}: ${ranked.length}`,
			},
			rows: [
				{
					key: "sniffing",
					label: t("inbounds.sniffing"),
					value: sniffingCount,
					tone: "bg-panel-accent",
				},
				{
					key: "multiTarget",
					label: t("inbounds.summary.multiTarget"),
					value: multiTargetCount,
					tone: "bg-panel-success",
				},
			],
			distribution: { label: t("userDialog.protocols"), segments },
			extra: {
				label: isFiltered ? t("summary.filteredUsage") : t("summary.usage"),
				value: SizeFormatter.sizeFormat(totals.total),
				caption: `↑ ${SizeFormatter.sizeFormat(totals.uploadSpeed)}/s · ↓ ${SizeFormatter.sizeFormat(totals.downloadSpeed)}/s`,
			},
		};
	}, [filtered, inbounds, speeds, t]);

	const [inboundSorting, setInboundSorting] = useState<SortingState>([]);
	const inboundColumns = useMemo<DataTableColumn<RawInbound>[]>(
		() => [
			{
				id: "tag",
				header: t("inbounds.tag"),
				accessor: "tag",
				isPrimary: true,
				priority: "primary",
				width: "168px",
				minWidth: "130px",
				maxWidth: "260px",
				truncate: true,
				tooltip: true,
				mobilePriority: 0,
				mobileMetaLabel: t("inbounds.tag"),
				cell: (inbound) => (
					<div className="flex flex-col gap-0.5 min-w-0!">
						<p className="font-semibold truncate">
							{inbound.tag}
						</p>
						{inbound.validation_error && (
							<Tooltip>
<TooltipTrigger asChild>
								<div className="flex flex-col gap-1 items-start">
									<Badge className="bg-destructive/10 text-destructive">{t("diagnostics.broken")}</Badge>
									<p className="text-[0.75rem] text-red-400 line-clamp-2">{inbound.validation_error}</p>
								</div>
							</TooltipTrigger>
<TooltipContent>{inbound.validation_error}</TooltipContent>
</Tooltip>
						)}
						{inbound.listen && (
							<p className="text-[0.75rem] text-panel-text-muted truncate">
								{inbound.listen}
							</p>
						)}
					</div>
				),
			},
			{
				id: "protocol",
				header: t("protocol"),
				accessor: "protocol",
				priority: "high",
				width: "108px",
				maxWidth: "140px",
				mobilePriority: 1,
				mobileMetaLabel: t("protocol"),
				cell: (inbound) => (
					<Badge className={cn("bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-200", "uppercase")}>
						{inbound.protocol}
					</Badge>
				),
			},
			{
				id: "port",
				header: t("port"),
				accessor: "port",
				priority: "high",
				width: "84px",
				maxWidth: "110px",
				mobilePriority: 2,
				mobileMetaLabel: t("port"),
				cell: (inbound) => (
					<p dir="ltr" className="font-semibold [unicode-bidi:isolate]">
						{inbound.port}
					</p>
				),
			},
			{
				id: "network",
				sortValue: (inbound) => String(inbound.streamSettings?.network ?? ""),
				header: t("inbounds.network"),
				priority: "medium",
				width: "98px",
				maxWidth: "130px",
				mobilePriority: 3,
				mobileMetaLabel: t("inbounds.network"),
				cell: (inbound) => inbound.streamSettings?.network || "-",
			},
			{
				id: "security",
				sortValue: (inbound) => String(inbound.streamSettings?.security ?? ""),
				header: t("inbounds.security"),
				priority: "medium",
				width: "108px",
				maxWidth: "140px",
				mobilePriority: 4,
				mobileMetaLabel: t("inbounds.security"),
				cell: (inbound) => {
					const security = inbound.streamSettings?.security;
					return security && security !== "none" ? (
						<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
							{security}
						</Badge>
					) : (
						<p className="text-panel-text-muted">-</p>
					);
				},
			},
			{
				id: "traffic",
				sortValue: (inbound) => getInboundTraffic(inbound).total,
				header: t("inbounds.traffic"),
				priority: "medium",
				width: "175px",
				maxWidth: "195px",
				mobilePriority: 5,
				mobileMetaLabel: t("inbounds.traffic"),
				cell: (inbound) => {
					const traffic = getInboundTraffic(inbound);
					return (
						<div dir="ltr" className="rb-stat-pair flex flex-row items-center gap-3 whitespace-nowrap text-[0.75rem] [font-variant-numeric:tabular-nums] [unicode-bidi:isolate]">
							<p className="text-teal-400">
								↑ {SizeFormatter.sizeFormat(traffic.upload)}
							</p>
							<p className="text-blue-400">
								↓ {SizeFormatter.sizeFormat(traffic.download)}
							</p>
						</div>
					);
				},
			},
			{
				id: "speed",
				sortValue: (inbound) => {
					const speed = speeds[inbound.tag];
					return (speed?.upload_speed ?? 0) + (speed?.download_speed ?? 0);
				},
				header: t("inbounds.speed"),
				priority: "medium",
				width: "175px",
				maxWidth: "195px",
				mobilePriority: 6,
				mobileMetaLabel: t("inbounds.speed"),
				cell: (inbound) => {
					const speed = speeds[inbound.tag];
					return (
						<div dir="ltr" className="rb-stat-pair flex flex-row items-center gap-3 whitespace-nowrap text-[0.75rem] [font-variant-numeric:tabular-nums] [unicode-bidi:isolate]">
							<p className="text-teal-400">
								↑ {SizeFormatter.sizeFormat(speed?.upload_speed ?? 0)}/s
							</p>
							<p className="text-blue-400">
								↓ {SizeFormatter.sizeFormat(speed?.download_speed ?? 0)}/s
							</p>
						</div>
					);
				},
			},
			{
				id: "sniffing",
				sortValue: (inbound) => (inbound.sniffing?.enabled ? 1 : 0),
				header: t("inbounds.sniffing"),
				priority: "low",
				hideBelow: "xl",
				width: "150px",
				maxWidth: "170px",
				mobilePriority: 6,
				mobileMetaLabel: t("inbounds.sniffing"),
				cell: (inbound) =>
					inbound.sniffing?.enabled ? (
						<Badge className="bg-green-600 text-white">
							{t("inbounds.sniffingEnabled")}
						</Badge>
					) : (
						<Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-500/20 dark:text-gray-200">
							{t("inbounds.sniffingDisabled")}
						</Badge>
					),
			},
			{
				id: "targets",
				sortValue: (inbound) => getInboundTargetIds(inbound).length,
				header: t("inbounds.targets"),
				priority: "low",
				hideBelow: "lg",
				width: "140px",
				maxWidth: "176px",
				mobilePriority: 7,
				mobileMetaLabel: t("inbounds.targets"),
				cell: (inbound) => {
					const targetIds = getInboundTargetIds(inbound);
					const targetLabels = targetIds.map(
						(targetId) => targetNameById[targetId] || targetId,
					);
					const visibleTargets = targetIds.slice(0, 3);
					const hiddenCount = Math.max(
						0,
						targetIds.length - visibleTargets.length,
					);

					return (
						<Tooltip>
<TooltipTrigger asChild>
							<div className="rb-chip-list flex flex-row items-center gap-1 flex-wrap max-w-full">
								{visibleTargets.map((targetId) => (
									<Badge key={targetId} className="max-w-[80px]">
										<span className="truncate">
											{targetNameById[targetId] || targetId}
										</span>
									</Badge>
								))}
								{hiddenCount > 0 && (
									<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
										+{hiddenCount}
									</Badge>
								)}
							</div>
						</TooltipTrigger>
<TooltipContent>{targetLabels.join(", ")}</TooltipContent>
</Tooltip>
					);
				},
			},
		],
		[t, targetNameById, speeds],
	);

	const inboundRowActions = (
		inbound: RawInbound,
	): DataTableRowAction<RawInbound>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <Pencil className="w-[16px]" />,
			onClick: () => openEdit(inbound),
		},
		{
			id: "reset-usage",
			label: t("inbounds.resetUsage"),
			icon: <RefreshCw className="w-[16px]" />,
			onClick: () => {
				setResetTarget(inbound);
				resetDialog.onOpen();
			},
			disabled: isMutating,
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <Trash2 className="w-[16px]" />,
			isDanger: true,
			onClick: () => setDeleteTarget(inbound),
		},
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand
					total={inboundOverview.total}
					rows={inboundOverview.rows}
					distribution={inboundOverview.distribution}
					extra={inboundOverview.extra}
					locale={locale}
				/>
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						<div className="min-w-0 flex-1"><div className="flex flex-col gap-2 md:flex-row md:items-center">
					<div className="flex min-w-0 flex-1 flex-row items-center gap-2">
					<SearchInput containerProps={{ className: "min-w-0 flex-1 md:w-[320px] md:flex-none" }} placeholder={t("inbounds.searchPlaceholder")} value={filter.search} onChange={(event) =>
							setFilter((prev) => ({ ...prev, search: event.target.value }))
						} matchOptions={searchMatch} onMatchOptionsChange={setSearchMatch} />
					<DataTableSortMenu
						options={buildSortOptions(inboundColumns, filtered)}
						sorting={inboundSorting}
						onSortingChange={setInboundSorting}
					/>
					</div>
					<div className="md:flex md:flex-row">
					<SearchableTagSelect size="sm" value={filter.protocol} options={[
							{
								value: "all",
								label: t("inbounds.filterProtocol"),
							},
							...protocolOptions.map((option) => ({
								value: option,
								label: protocolLabel(option),
							})),
						]} placeholder={t("inbounds.filterProtocol")} onChange={(value) =>
							setFilter((prev) => ({ ...prev, protocol: String(value) }))
						} className="w-full md:w-[190px]" />
					</div>
				</div></div>
						<div className="flex shrink-0 items-center justify-end gap-1">
							<ResourceRefreshButton
								aria-label={t("inbounds.refresh")}
								label={t("inbounds.refresh")}
								icon={<RefreshCw className="w-[16px]" />}
								loading={isLoading}
								onClick={loadInbounds}
							/>
							<Button onClick={openCreate} size="sm" className="h-[36px] px-3 rounded-[4px]">{<Plus className="w-[18px] h-[18px]" />}
								{t("inbounds.add")}
							</Button>
						</div>
					</div>
				</div>
			</div>

			{error && (
				<Alert variant="destructive">
					<CircleAlert className="size-4" aria-hidden="true" />
					{error}
				</Alert>
			)}

			<DataTable
				ariaLabel={t("hostsPage.tabInbounds")}
				data={filtered}
				columns={inboundColumns}
				sorting={inboundSorting}
				onSortingChange={setInboundSorting}
				showSortMenu={false}
				getRowId={(inbound) => inbound.tag}
				loading={isLoading}
				loadingRows={5}
				emptyState={
					<div className="text-center text-panel-text-muted">
						{t("inbounds.emptyState")}
					</div>
				}
				rowActions={inboundRowActions}

				actionsPlacement="end"
				actionsColumnWidth="60px"

				enableSelection
				selectedRowIds={selectedInboundTags}
				selectedCount={selectedInboundTags.length}
				onSelectionChange={(rowIds) => setSelectedInboundTags(rowIds)}
				selectedLabel={t("inbounds.selectedCount", {
					count: selectedInboundTags.length,
				})}
				renderBulkActions={(selectedRows) => (
					<DeleteConfirmDialog
						description={t("inbounds.confirmBulkDelete", {
							count: selectedRows.length,
						})}
						loading={isMutating}
						disabled={selectedRows.length === 0}
						onConfirm={() => handleBulkDelete(selectedRows)}
					>
						<Button disabled={selectedRows.length === 0} variant="outline" size="sm" loading={isMutating} className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">{<Trash2 className="w-[16px]" />}
							{t("delete")}
						</Button>
					</DeleteConfirmDialog>
				)}
				mobileBreakpoint="md"
				tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }}
			/>

			{isOpen && (
				<InboundFormModal
					open={isOpen}
					mode={drawerMode}
					initialValue={selected}
					isSubmitting={isMutating}
					existingInbounds={inbounds}
					configTargets={configTargets}
					onClose={onClose}
					onSubmit={handleSubmit}
					onDelete={selected ? () => handleDelete(selected) : undefined}
					onClone={selected ? () => openClone(selected) : undefined}
					isDeleting={isMutating}
				/>
			)}
			{cloneDrawer.isOpen && (
				<InboundFormModal
					open={cloneDrawer.isOpen}
					mode="clone"
					initialValue={cloneTarget}
					isSubmitting={isMutating}
					existingInbounds={inbounds}
					configTargets={configTargets}
					onClose={() => {
						cloneDrawer.onClose();
						setCloneTarget(null);
					}}
					onSubmit={handleCloneSubmit}
				/>
			)}
			<ConfirmDialog
				open={resetDialog.isOpen}
				onClose={() => {
					if (isMutating) return;
					setResetTarget(null);
					resetDialog.onClose();
				}}
				onConfirm={handleResetUsage}
				title={t("inbounds.resetUsage")}
				description={t("inbounds.resetUsageConfirm", {
					tag: resetTarget?.tag ?? "",
				})}
				confirmLabel={t("inbounds.resetUsage")}
				colorScheme="red"
				loading={isMutating}
				isConfirmDisabled={!resetTarget}
			/>
			<ConfirmDialog
				open={Boolean(deleteTarget)}
				onClose={() => {
					if (isMutating) return;
					setDeleteTarget(null);
				}}
				onConfirm={async () => {
					if (!deleteTarget) return;
					await handleDelete(deleteTarget);
					setDeleteTarget(null);
				}}
				title={t("common.confirmAction")}
				description={t("inbounds.confirmDelete", { tag: deleteTarget?.tag ?? "" })}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={isMutating}
			/>
		</div>
	);
};
