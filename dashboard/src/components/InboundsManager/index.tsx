import {
	Alert,
	AlertIcon,
	Box,
	Button,
	HStack,
	Input,
	MenuItem,
	Stack,
	Tag,
	Text,
	Tooltip,
	useDisclosure,
	useToast,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import type { CoreConfigTarget } from "contexts/CoreSettingsContext";
import { fetchInbounds as refreshInboundsStore } from "contexts/DashboardContext";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import {
	buildInboundPayload,
	type InboundFormValues,
	protocolOptions,
	type RawInbound,
} from "utils/inbounds";
import { DeleteConfirmPopover } from "../DeleteConfirmPopover";
import { SearchableTagSelect } from "../common/SearchableTagSelect";
import {
	DataTable,
	ResourceListCard,
	ResourceRefreshButton,
	type DataTableColumn,
	type DataTableRowAction,
	type ResourceSummaryItem,
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

const getInboundTargetIds = (inbound: RawInbound) =>
	inbound.effective_targets?.length
		? inbound.effective_targets
		: inbound.targets?.length
			? inbound.targets
			: ["master"];

export const InboundsManager: FC = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const [inbounds, setInbounds] = useState<RawInbound[]>([]);
	const [configTargets, setConfigTargets] = useState<CoreConfigTarget[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isMutating, setIsMutating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<FilterState>({
		protocol: "all",
		search: "",
	});
	const [selectedInboundTags, setSelectedInboundTags] = useState<string[]>([]);
	const [selected, setSelected] = useState<RawInbound | null>(null);
	const [cloneTarget, setCloneTarget] = useState<RawInbound | null>(null);
	const { isOpen, onOpen, onClose } = useDisclosure();
	const cloneDrawer = useDisclosure();
	const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");

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
			.catch(() => {
				setError(t("inbounds.error.load", "Unable to load inbounds"));
			})
			.finally(() => setIsLoading(false));
	}, [t]);

	useEffect(() => {
		loadInbounds();
	}, [loadInbounds]);

	const filtered = useMemo(() => {
		const term = filter.search.trim().toLowerCase();
		return inbounds.filter((inbound) => {
			if (filter.protocol !== "all" && inbound.protocol !== filter.protocol) {
				return false;
			}
			if (!term) return true;
			return (
				inbound.tag.toLowerCase().includes(term) ||
				inbound.port?.toString().includes(term)
			);
		});
	}, [inbounds, filter]);
	const targetNameById = useMemo(
		() =>
			Object.fromEntries(
				configTargets.map((target) => [target.id, target.name || target.id]),
			),
		[configTargets],
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
				throw new Error(
					t("inbounds.error.tagExists", "Inbound tag already exists"),
				);
			}
			if (portExists) {
				throw new Error(
					t("inbounds.error.portExists", "Inbound port already exists"),
				);
			}

			const payload = {
				...buildInboundPayload(values, { initial: initial ?? null }),
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
			toast({
				status: "success",
				title:
					mode === "create"
						? t("inbounds.success.created", "Inbound created")
						: t("inbounds.success.updated", "Inbound updated"),
			});
			refreshInboundsStore();
			await loadInbounds();
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
			toast({
				status: "error",
				title: t("inbounds.error.submit", "Unable to save inbound"),
				description,
			});
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
			toast({
				status: "success",
				title: t("inbounds.success.deleted", "Inbound deleted"),
			});
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
			toast({
				status: "error",
				title: t("inbounds.error.submit", "Unable to save inbound"),
				description,
			});
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
			toast({
				status: "success",
				title: t("inbounds.success.bulkDeleted", "Inbounds deleted"),
				description: t(
					"inbounds.success.bulkDeletedDescription",
					"Deleted {{count}} inbound(s).",
					{ count: items.length },
				),
			});
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
			toast({
				status: "error",
				title: t("inbounds.error.bulkDelete", "Unable to delete inbounds"),
				description,
			});
		} finally {
			setIsMutating(false);
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
			const nextPort = Number.isFinite(portNumber)
				? portNumber + 1
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

	const inboundSummaryItems = useMemo<ResourceSummaryItem[]>(() => {
		const protocolCounts = inbounds.reduce<Record<string, number>>(
			(acc, inbound) => {
				const key = inbound.protocol || "unknown";
				acc[key] = (acc[key] || 0) + 1;
				return acc;
			},
			{},
		);
		const multiTargetCount = inbounds.filter(
			(inbound) => getInboundTargetIds(inbound).length > 1,
		).length;
		const sniffingCount = inbounds.filter(
			(inbound) => inbound.sniffing?.enabled,
		).length;
		const mostUsedProtocol = Object.entries(protocolCounts).sort(
			(a, b) => b[1] - a[1],
		)[0];

		return [
			{
				label: t("inbounds.summary.total", "Total"),
				value: inbounds.length,
				colorScheme: "gray",
			},
			{
				label: t("inbounds.summary.protocols", "Protocols"),
				value: Object.keys(protocolCounts).length,
				colorScheme: "purple",
				helper: mostUsedProtocol
					? `${mostUsedProtocol[0].toUpperCase()}: ${mostUsedProtocol[1]}`
					: undefined,
			},
			{
				label: t("inbounds.summary.multiTarget", "Multi-target"),
				value: multiTargetCount,
				colorScheme: "blue",
			},
			{
				label: t("inbounds.summary.sniffing", "Sniffing"),
				value: sniffingCount,
				colorScheme: "green",
			},
			{
				label: t("inbounds.summary.filtered", "Filtered"),
				value: filtered.length,
				colorScheme: "teal",
			},
		];
	}, [filtered.length, inbounds, t]);

	const inboundColumns = useMemo<DataTableColumn<RawInbound>[]>(
		() => [
			{
				id: "tag",
				header: t("inbounds.tag", "Tag"),
				accessor: "tag",
				isPrimary: true,
				priority: "primary",
				width: "220px",
				minWidth: "180px",
				maxWidth: "260px",
				truncate: true,
				tooltip: true,
				mobilePriority: 0,
				mobileMetaLabel: t("inbounds.tag", "Tag"),
				cell: (inbound) => (
					<Stack spacing={0.5} minW={0}>
						<Text fontWeight="semibold" noOfLines={1}>
							{inbound.tag}
						</Text>
						{inbound.listen && (
							<Text fontSize="xs" color="panel.textMuted" noOfLines={1}>
								{inbound.listen}
							</Text>
						)}
					</Stack>
				),
			},
			{
				id: "protocol",
				header: t("inbounds.protocol", "Protocol"),
				accessor: "protocol",
				priority: "high",
				width: "120px",
				maxWidth: "140px",
				mobilePriority: 1,
				mobileMetaLabel: t("inbounds.protocol", "Protocol"),
				cell: (inbound) => (
					<Tag size="sm" colorScheme="purple" textTransform="uppercase">
						{inbound.protocol}
					</Tag>
				),
			},
			{
				id: "port",
				header: t("inbounds.portLabel", "Port"),
				accessor: "port",
				priority: "high",
				width: "92px",
				maxWidth: "110px",
				mobilePriority: 2,
				mobileMetaLabel: t("inbounds.portLabel", "Port"),
				cell: (inbound) => (
					<Text fontWeight="semibold" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{inbound.port}
					</Text>
				),
			},
			{
				id: "network",
				header: t("inbounds.network", "Network"),
				priority: "medium",
				width: "110px",
				maxWidth: "130px",
				mobilePriority: 3,
				mobileMetaLabel: t("inbounds.network", "Network"),
				cell: (inbound) => inbound.streamSettings?.network || "-",
			},
			{
				id: "security",
				header: t("inbounds.security", "Security"),
				priority: "medium",
				width: "120px",
				maxWidth: "140px",
				mobilePriority: 4,
				mobileMetaLabel: t("inbounds.security", "Security"),
				cell: (inbound) => {
					const security = inbound.streamSettings?.security;
					return security && security !== "none" ? (
						<Tag size="sm" colorScheme="blue">
							{security}
						</Tag>
					) : (
						<Text color="panel.textMuted">-</Text>
					);
				},
			},
			{
				id: "sniffing",
				header: t("inbounds.sniffing", "Sniffing"),
				priority: "low",
				hideBelow: "xl",
				width: "150px",
				maxWidth: "170px",
				mobilePriority: 5,
				mobileMetaLabel: t("inbounds.sniffing", "Sniffing"),
				cell: (inbound) =>
					inbound.sniffing?.enabled ? (
						<Tag size="sm" colorScheme="green">
							{t("inbounds.sniffingEnabled", "Sniffing enabled")}
						</Tag>
					) : (
						<Tag size="sm" colorScheme="gray">
							{t("inbounds.sniffingDisabled", "Sniffing disabled")}
						</Tag>
					),
			},
			{
				id: "targets",
				header: t("inbounds.targets", "Targets"),
				priority: "low",
				hideBelow: "lg",
				width: "210px",
				maxWidth: "260px",
				mobilePriority: 6,
				mobileMetaLabel: t("inbounds.targets", "Targets"),
				cell: (inbound) => {
					const targetIds = getInboundTargetIds(inbound);
					const targetLabels = targetIds.map(
						(targetId) => targetNameById[targetId] || targetId,
					);
					const visibleTargets = targetIds.slice(0, 3);
					const hiddenCount = Math.max(0, targetIds.length - visibleTargets.length);

					return (
						<Tooltip
							label={targetLabels.join(", ")}
							isDisabled={targetLabels.length <= 3}
							hasArrow
							placement="top"
						>
							<HStack spacing={1} flexWrap="wrap" maxW="full">
								{visibleTargets.map((targetId) => (
									<Tag key={targetId} size="sm" maxW="80px">
										<Text as="span" noOfLines={1}>
											{targetNameById[targetId] || targetId}
										</Text>
									</Tag>
								))}
								{hiddenCount > 0 && (
									<Tag size="sm" colorScheme="blue">
										+{hiddenCount}
									</Tag>
								)}
							</HStack>
						</Tooltip>
					);
				},
			},
		],
		[t, targetNameById],
	);

	const inboundRowActions = (
		inbound: RawInbound,
	): DataTableRowAction<RawInbound>[] => [
		{
			id: "edit",
			label: t("common.edit", "Edit"),
			icon: <PencilIcon width={16} />,
			onClick: () => openEdit(inbound),
		},
		{
			id: "delete",
			label: t("common.delete", "Delete"),
			icon: <TrashIcon width={16} />,
			isDanger: true,
			render: (_row, onMenuClose) => (
				<DeleteConfirmPopover
					message={t("inbounds.confirmDelete", {
						tag: inbound.tag,
					})}
					isLoading={isMutating}
					onConfirm={async () => {
						await handleDelete(inbound);
						onMenuClose();
					}}
				>
					<MenuItem
						icon={<TrashIcon width={16} />}
						color="red.400"
						isDisabled={isMutating}
						onClick={(event) => event.stopPropagation()}
					>
						{t("common.delete", "Delete")}
					</MenuItem>
				</DeleteConfirmPopover>
			),
		},
	];

	return (
		<Stack spacing={4}>
			<ResourceListCard
				title={t("inbounds.listHeader", "Inbound list")}
				summaryItems={inboundSummaryItems}
				actions={
					<Button
						leftIcon={<PlusIcon width={18} height={18} />}
						onClick={openCreate}
						colorScheme="primary"
						size="sm"
						h="36px"
						px={3}
						borderRadius="4px"
					>
						{t("inbounds.add", "Add inbound")}
					</Button>
				}
				footerActions={
					<ResourceRefreshButton
						aria-label={t("inbounds.refresh", "Refresh inbounds")}
						label={t("inbounds.refresh", "Refresh inbounds")}
						icon={<ArrowPathIcon width={16} />}
						isLoading={isLoading}
						onClick={loadInbounds}
					/>
				}
			>
				<Stack
					direction={{ base: "column", md: "row" }}
					spacing={2}
					align={{ base: "stretch", md: "center" }}
					flexWrap="wrap"
				>
					<Input
						size="sm"
						w={{ base: "full", md: "280px" }}
						placeholder={t("inbounds.searchPlaceholder", "Search by tag or port")}
						value={filter.search}
						onChange={(event) =>
							setFilter((prev) => ({ ...prev, search: event.target.value }))
						}
					/>
					<SearchableTagSelect
						size="sm"
						width="190px"
						value={filter.protocol}
						options={[
							{
								value: "all",
								label: t("inbounds.filterProtocol", "All protocols"),
							},
							...protocolOptions.map((option) => ({
								value: option,
								label: option.toUpperCase(),
							})),
						]}
						placeholder={t("inbounds.filterProtocol", "All protocols")}
						onChange={(value) =>
							setFilter((prev) => ({ ...prev, protocol: String(value) }))
						}
					/>
				</Stack>
			</ResourceListCard>

			{error && (
				<Alert status="error">
					<AlertIcon />
					{error}
				</Alert>
			)}

			<DataTable
				ariaLabel={t("hostsPage.tabInbounds", "Inbounds")}
				data={filtered}
				columns={inboundColumns}
				getRowId={(inbound) => inbound.tag}
				isLoading={isLoading}
				loadingRows={5}
				emptyState={
					<Box textAlign="center" color="panel.textMuted">
						{t("inbounds.emptyState", "No inbounds configured yet.")}
					</Box>
				}
				rowActions={inboundRowActions}
				actionsDisplay="menu"
				actionsPlacement="end"
				actionsColumnWidth="60px"
				showActionsOnHover
				enableSelection
				selectedRowIds={selectedInboundTags}
				selectedCount={selectedInboundTags.length}
				onSelectionChange={(rowIds) => setSelectedInboundTags(rowIds)}
				selectedLabel={t("inbounds.selectedCount", {
					defaultValue: "{{count}} inbounds selected",
					count: selectedInboundTags.length,
				})}
				renderBulkActions={(selectedRows) => (
					<DeleteConfirmPopover
						message={t(
							"inbounds.confirmBulkDelete",
							"Delete {{count}} selected inbound(s)?",
							{ count: selectedRows.length },
						)}
						isLoading={isMutating}
						isDisabled={selectedRows.length === 0}
						onConfirm={() => handleBulkDelete(selectedRows)}
					>
						<Button
							size="sm"
							variant="outline"
							colorScheme="red"
							leftIcon={<TrashIcon width={16} />}
							isLoading={isMutating}
							isDisabled={selectedRows.length === 0}
						>
							{t("common.delete", "Delete")}
						</Button>
					</DeleteConfirmPopover>
				)}
				mobileBreakpoint="lg"
				tableProps={{
					w: "full",
					sx: {
						tableLayout: "fixed",
						"& th, & td": {
							px: { base: 2, xl: 2.5 },
							py: 2.5,
							verticalAlign: "middle",
						},
					},
				}}
			/>

			<InboundFormModal
				isOpen={isOpen}
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
			<InboundFormModal
				isOpen={cloneDrawer.isOpen}
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
		</Stack>
	);
};
