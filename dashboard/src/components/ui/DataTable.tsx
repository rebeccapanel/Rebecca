import { AppleEmojiText } from "components/common/AppleEmojiText";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { Checkbox } from "components/ui/checkbox";
import { Skeleton } from "components/ui/skeleton";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { SlidersHorizontal, Copy } from "lucide-react";

import { useBreakpointValue } from "hooks/useBreakpointValue";

import { RowActionButton } from "./row-actions";

import { cn } from "lib/cn";
import {
	type CellContext,
	type ColumnDef,
	flexRender,
	functionalUpdate,
	getCoreRowModel,
	getSortedRowModel,
	type Row,
	type RowSelectionState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { Children, Fragment, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "utils/clipboard";
import { createStableCellRegistry } from "utils/stableCell";
import { BulkActionBar } from "./BulkActionBar";
import { buildSortOptions, DataTableSortMenu } from "./DataTableSortMenu";
import {
	orderRowActions,
	RowActionsMenu,
	type RowActionItem,
} from "./DataTableRowActions";
import type {
	DataTableColumn,
	DataTableColumnAlign,
	DataTableColumnSize,
	DataTableProps,
} from "./DataTable.types";

type DataTableBreakpoint = "base" | "sm" | "md" | "lg" | "xl";

const breakpointOrder: Record<DataTableBreakpoint, number> = {
	base: 0,
	sm: 1,
	md: 2,
	lg: 3,
	xl: 4,
};

const selectionColumnWidth = "32px";

type SelectableTableHandle = {
	isVisible: () => boolean;
	selectAll: () => void;
	updatedAt: number;
};

const selectableTables = new Map<symbol, SelectableTableHandle>();
let activeSelectableTableId: symbol | null = null;
let selectAllShortcutInstalled = false;

const isEditableDomTarget = (target: EventTarget | null) => {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
};

const installSelectAllShortcut = () => {
	if (
		selectAllShortcutInstalled ||
		typeof window === "undefined" ||
		typeof document === "undefined"
	) return;
	selectAllShortcutInstalled = true;
	document.addEventListener("keydown", (event) => {
		if (!(event.ctrlKey || event.metaKey)) return;
		if (event.key.toLowerCase() !== "a") return;
		if (isEditableDomTarget(event.target)) return;

		const activeHandle =
			activeSelectableTableId !== null
				? selectableTables.get(activeSelectableTableId)
				: undefined;
		const fallbackHandle = Array.from(selectableTables.values())
			.filter((handle) => handle.isVisible())
			.sort((a, b) => b.updatedAt - a.updatedAt)[0];
		const handle = activeHandle?.isVisible() ? activeHandle : fallbackHandle;

		if (!handle) return;
		event.preventDefault();
		event.stopPropagation();
		handle.selectAll();
	}, true);
};

const ActionsHeaderIcon = () => (
	<div aria-hidden="true" className="inline-flex items-center justify-end w-full text-panel-text-muted rb-actions-header-icon">
		<SlidersHorizontal className="w-3.5 h-3.5" />
	</div>
);

const isBelowBreakpoint = (
	current: DataTableBreakpoint,
	target: DataTableBreakpoint,
) => breakpointOrder[current] < breakpointOrder[target];

const getPriorityHideBelow = <TData,>(
	column: DataTableColumn<TData>,
): DataTableBreakpoint | undefined => {
	if (column.hideBelow) return column.hideBelow;
	switch (column.priority) {
		case "low":
			return "xl";
		case "medium":
			return "lg";
		default:
			return undefined;
	}
};

const shouldShowDesktopColumn = <TData,>(
	column: DataTableColumn<TData>,
	breakpoint: DataTableBreakpoint,
) => {
	if (column.desktopVisible === false) return false;
	if (column.showBelow && !isBelowBreakpoint(breakpoint, column.showBelow)) {
		return false;
	}
	const hideBelow = getPriorityHideBelow(column);
	if (hideBelow && isBelowBreakpoint(breakpoint, hideBelow)) {
		return false;
	}
	return true;
};

const getResponsiveSize = (
	value: DataTableColumnSize | undefined,
	breakpoint: DataTableBreakpoint,
) => {
	if (value === undefined) return undefined;
	if (typeof value !== "object") return value;
	return value[breakpoint] ?? value.xl ?? value.lg ?? value.md ?? value.sm ?? value.base;
};

const shouldShowMobileColumn = <TData,>(column: DataTableColumn<TData>) => {
	if (column.mobileVisible === false) return false;
	if (column.mobileVisible === true) return true;
	if (column.hideOnMobile) return false;
	return column.collapseIntoMeta !== false;
};

const alignToTextAlign = (align?: DataTableColumnAlign) => {
	if (align === "center") return "center";
	if (align === "end") return "end";
	return "start";
};

// Chakra colour token ("red.400") to a text class. The palette is safelisted in tailwind.css.
const toneClass = (color?: string) => (color ? `text-${color.replace(".", "-")}` : undefined);

const justifyClass = (align?: DataTableColumnAlign) =>
	alignToFlexJustify(align) === "center" ? "justify-center" : alignToFlexJustify(align) === "flex-end" ? "justify-end" : "justify-start";

const alignToFlexJustify = (align?: DataTableColumnAlign) => {
	if (align === "center") return "center";
	if (align === "end") return "flex-end";
	return "flex-start";
};

const getResolvedColumnAlign = <TData,>(
	column?: DataTableColumn<TData>,
): DataTableColumnAlign =>
	column?.cellAlign ?? column?.align ?? column?.headerAlign ?? "start";

const getHeaderAlign = <TData,>(column?: DataTableColumn<TData>) =>
	getResolvedColumnAlign(column);

const getCellAlign = <TData,>(column?: DataTableColumn<TData>): DataTableColumnAlign =>
	getResolvedColumnAlign(column);

const renderFallbackValue = (value: unknown) => {
	if (value === null || value === undefined || value === "") return "-";
	return String(value);
};

const renderHeaderLabel = <TData,>(
	column?: DataTableColumn<TData>,
	fallback?: ReactNode,
) => column?.mobileLabel ?? column?.mobileMetaLabel ?? column?.header ?? fallback;

const getColumnValue = <TData,>(row: TData, column: DataTableColumn<TData>) => {
	if (column.sortValue) return column.sortValue(row);
	if (typeof column.accessor === "function") return column.accessor(row);
	if (column.accessor) return row[column.accessor];
	return undefined;
};

const resolveSelectedLabel = (label: DataTableProps<unknown>["selectedLabel"], count: number) =>
	typeof label === "function" ? label(count) : label;

const makeSelectionState = (ids?: string[]) =>
	(ids ?? []).reduce<RowSelectionState>((acc, id) => {
		acc[id] = true;
		return acc;
	}, {});

const getColumnWidth = <TData,>(column?: DataTableColumn<TData>) =>
	column?.width ?? column?.size;

const getColumnMinWidth = <TData,>(column?: DataTableColumn<TData>) =>
	column?.minWidth ?? column?.minSize ?? getColumnWidth(column);

const getColumnMaxWidth = <TData,>(column?: DataTableColumn<TData>) =>
	column?.maxWidth ?? column?.maxSize ?? getColumnWidth(column);

const formatCssSize = (value?: string | number) => {
	if (value === undefined) return undefined;
	return typeof value === "number" ? `${value}px` : value;
};

const getHeaderInset = <TData,>(column?: DataTableColumn<TData>) =>
	formatCssSize(column?.headerInset);

const getPrimitiveText = (value: unknown) => {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	return null;
};

type DataTableCellContentProps<TData> = {
	column?: DataTableColumn<TData>;
	value: unknown;
	children: ReactNode;
};

const DataTableCellContent = <TData,>({
	column,
	value,
	children,
}: DataTableCellContentProps<TData>) => {
	const { t } = useTranslation();
	const valueText = getPrimitiveText(value);
	const childText = getPrimitiveText(children);
	const fullText = valueText ?? childText ?? "";
	const hasText = fullText.trim().length > 0;
	const multiline = column?.multiline === true;
	const primitiveContent = Boolean(valueText ?? childText);
	const shouldTruncate = column?.truncate ?? (!multiline && primitiveContent);
	const shouldCopy = Boolean(column?.copyable && hasText);
	const shouldTooltip = Boolean(column?.tooltip && hasText);
	const cellAlign = getCellAlign(column);

	const content = (
		<div data-truncate={shouldTruncate ? "true" : undefined} data-multiline={multiline ? "true" : undefined} data-copyable={shouldCopy ? "true" : undefined} data-align={cellAlign}  className={cn(justifyClass(cellAlign), "flex items-center gap-1.5 min-w-0! max-w-full", multiline ? "overflow-visible" : "overflow-hidden", "rb-cell-content")}>
			<div className="min-w-0! flex-[1_1_auto] max-w-full rb-cell-value">
				{children}
			</div>
			{shouldCopy && (
				<Button aria-label={t("a11y.copyValue")} onClick={(event) => {
						event.stopPropagation();
						void copyTextToClipboard(fullText);
					}} variant="ghost" size="xs" className={cn("size-7 p-0", "shrink-0 rb-cell-copy")}>{<Copy className="w-3.5 h-3.5" />}</Button>
			)}
		</div>
	);

	if (!shouldTooltip) return content;

	return (
		<Tooltip>
<TooltipTrigger asChild><span className="inline-flex max-w-full">{content}</span></TooltipTrigger>
<TooltipContent>{
				<div dir="auto" className="max-w-[360px] max-h-[180px] overflow-y-auto whitespace-pre-wrap [word-break:break-word]">
					<AppleEmojiText>{fullText}</AppleEmojiText>
				</div>
			}</TooltipContent>
</Tooltip>
	);
};

const getActionLabelText = (label: RowActionItem["label"]) =>
	typeof label === "string" || typeof label === "number"
		? String(label)
		: "Row action";

/** Inline actions show as icons up to this count; the rest move into the overflow menu. */
const INLINE_ROW_ACTIONS = 4;

const InlineRowAction = ({ action }: { action: RowActionItem }) => {
	const label = getActionLabelText(action.label) || "Action";
	const icon = action.icon ?? <Copy />;
	return (
		<RowActionButton
			label={label}
			icon={icon}
			danger={action.isDanger}
			disabled={action.disabled}
			tooltip={action.disabled ? action.disabledReason : undefined}
			className={toneClass(action.color)}
			onClick={(event) => {
				event.stopPropagation();
				action.onClick?.();
			}}
		/>
	);
};

const InlineRowActions = ({ actions }: { actions: RowActionItem[] }) => {
	if (actions.length === 0) return null;
	const orderedActions = orderRowActions(actions);
	const pinnedActions = orderedActions.filter((action) => action.pinned);
	const hasPinned = pinnedActions.length > 0;
	const hasOverflow = hasPinned ? orderedActions.length > pinnedActions.length : orderedActions.length > INLINE_ROW_ACTIONS;
	const inlineActions = hasPinned ? pinnedActions : hasOverflow ? orderedActions.slice(0, INLINE_ROW_ACTIONS - 1) : orderedActions;
	const menuActions = inlineActions.length === orderedActions.length ? orderedActions : orderedActions.filter((action) => !inlineActions.includes(action));

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control
		// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control
		<div onClick={(event) => event.stopPropagation()} className="flex flex-row items-center gap-1 rb-inline-actions">
			{inlineActions.map((action) => (
				<InlineRowAction key={action.id} action={action} />
			))}
			{menuActions.length > 0 && <RowActionsMenu actions={menuActions} label="More actions" />}
		</div>
	);
};

type DataTableCellProps<TData> = {
	row: Row<TData>;
	column: DataTableColumn<TData>;
	variant?: "cell" | "mobile-detail";
};

const DataTableCell = <TData,>({
	row,
	column,
	variant = "cell",
}: DataTableCellProps<TData>) => {
	const value = getColumnValue(row.original, column);
	const customCell =
		variant === "mobile-detail" && column.mobileDetailCell
			? column.mobileDetailCell
			: column.cell;
	return (
		<DataTableCellContent column={column} value={value}>
			{customCell
				? customCell(row.original)
				: renderFallbackValue(value)}
		</DataTableCellContent>
	);
};

export function DataTable<TData>({
	data,
	columns,
	getRowId,
	loading: isLoading,
	loadingRows = 5,
	error,
	emptyState,
	enableSelection = false,
	selectedRowIds,
	selectedRows: selectedRowsOverride,
	selectedCount: selectedCountOverride,
	defaultSelectedRowIds,
	onSelectionChange,
	getRowCanSelect,
	rowActions,
	renderRowActions,
	actionsDisplay,
	actionsPlacement = "end",
	actionsColumnWidth = "64px",
	showActionsOnHover = true,
	actionsAlwaysVisible = false,
	bulkActions,
	renderBulkActions,
	selectedLabel,
	onRowClick,
	isRowExpanded,
	renderExpandedRow,
	sorting,
	onSortingChange,
	manualSorting = false,
	showSortMenu = true,
	pagination,
	dir,
	tableProps,
	containerProps,
	mobileBreakpoint = "md",
	ariaLabel,
	columnVisibility,
}: DataTableProps<TData>) {
	const { t } = useTranslation();
	const actionsLabel = t("actions");
	const selectAllLabel = t("selectAll");
	const selectRowLabel = t("selectRow");
	const rootRef = useRef<HTMLDivElement | null>(null);
	const rowActionsRef = useRef(rowActions);
	rowActionsRef.current = rowActions;
	const renderRowActionsRef = useRef(renderRowActions);
	renderRowActionsRef.current = renderRowActions;
	const [stableCell] = useState(() =>
		createStableCellRegistry<CellContext<TData, unknown>>(),
	);
	const [contextMenu, setContextMenu] = useState<{
		row: TData | null;
		x: number;
		y: number;
		open: boolean;
	}>({ row: null, x: 0, y: 0, open: false });
	const resolvedActionsDisplay =
		actionsDisplay ??
		(rowActions || renderRowActions ? "inline" : "none");
	const hasActions = resolvedActionsDisplay !== "none" && Boolean(rowActions || renderRowActions);
	// Inline icons need the column to fit them, so the column sizes to its content.
	const resolvedActionsColumnWidth = resolvedActionsDisplay === "inline" ? "max-content" : actionsColumnWidth;
	const resolveColumnWidth = (isSelectColumn: boolean, isActionsColumn: boolean, columnWidth: string | number | undefined) =>
		isSelectColumn ? selectionColumnWidth : isActionsColumn ? resolvedActionsColumnWidth : columnWidth;
	const alwaysShowActions = actionsAlwaysVisible || resolvedActionsDisplay === "inline";
	const activeBreakpoint =
		useBreakpointValue<DataTableBreakpoint>({
			base: "base",
			sm: "sm",
			md: "md",
			lg: "lg",
			xl: "lg",
			"2xl": "xl",
		}) ?? "base";
	const isMobile = isBelowBreakpoint(activeBreakpoint, mobileBreakpoint);
	// Visibility first, then the responsive rules: a hidden column must not come
	// back at a wider breakpoint.
	const activeColumns = useMemo(
		() =>
			columnVisibility
				? columns.filter((column) => columnVisibility[column.id] !== false)
				: columns,
		[columns, columnVisibility],
	);
	const visibleDesktopColumns = useMemo(
		() =>
			activeColumns.filter((column) =>
				shouldShowDesktopColumn(column, activeBreakpoint),
			),
		[activeBreakpoint, activeColumns],
	);
	const getResolvedRowActions = useCallback(
		(row: TData): RowActionItem[] =>
			rowActionsRef.current?.(row).map((action) => ({
				...action,
				onClick: () => action.onClick?.(row),
				disabled:
					typeof action.disabled === "function"
						? action.disabled(row)
						: action.disabled,
				disabledReason:
					typeof action.disabledReason === "function"
						? action.disabledReason(row)
						: action.disabledReason,
			})) ?? [],
		[],
	);
	const contextMenuActions = contextMenu.row
		? getResolvedRowActions(contextMenu.row)
		: [];
	const closeContextMenu = useCallback(() => {
		setContextMenu((current) => ({ ...current, open: false }));
	}, []);
	const handleTableContextMenu = (
		event: ReactMouseEvent,
		row: TData,
	) => {
		const actions = getResolvedRowActions(row);
		if (!isMobile && actions.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			setContextMenu({ row, x: event.clientX, y: event.clientY, open: true });
		}
	};
	const isEditableTarget = (target: EventTarget | null) => {
		return isEditableDomTarget(target);
	};
	useEffect(() => {
		if (!contextMenu.open) return;
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeContextMenu();
		};
		const handleScroll = (event: Event) => {
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest("[data-rb-context-menu]")
			) {
				return;
			}
			closeContextMenu();
		};
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("scroll", handleScroll, true);
		return () => {
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("scroll", handleScroll, true);
		};
	}, [closeContextMenu, contextMenu.open]);
	const renderConfiguredActions = useCallback(
		(row: TData) => {
			if (resolvedActionsDisplay === "none") return null;

			if (resolvedActionsDisplay === "inline") {
				if (renderRowActionsRef.current) {
					return (
						// biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control
						// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control
						<div onClick={(event) => event.stopPropagation()} className="rb-inline-actions">
							{renderRowActionsRef.current(row)}
						</div>
					);
				}

				return <InlineRowActions actions={getResolvedRowActions(row)} />;
			}

			return (
				<RowActionsMenu
					actions={getResolvedRowActions(row)}
					label={actionsLabel}
				/>
			);
		},
		[
			actionsLabel,
			getResolvedRowActions,
			resolvedActionsDisplay,
		],
	);
	const [internalSelection, setInternalSelection] = useState<RowSelectionState>(() =>
		makeSelectionState(defaultSelectedRowIds),
	);
	const [internalSorting, setInternalSorting] = useState<SortingState>([]);
	const [expandedMobileRows, setExpandedMobileRows] = useState<Record<string, boolean>>({});
	const rowDataById = useMemo(() => {
		const map = new Map<string, TData>();
		data.forEach((row, index) => {
			map.set(getRowId(row, index), row);
		});
		return map;
	}, [data, getRowId]);
	const controlledSelection = useMemo(
		() => (selectedRowIds ? makeSelectionState(selectedRowIds) : undefined),
		[selectedRowIds],
	);
	const rowSelection = controlledSelection ?? internalSelection;
	const sortingState = sorting ?? internalSorting;
	const sortOptions = useMemo(() => buildSortOptions(activeColumns, data), [activeColumns, data]);

	const tableColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
		const dataColumns = visibleDesktopColumns.map<ColumnDef<TData, unknown>>((column) => ({
			id: column.id,
			header: () => column.header,
			accessorFn: (row) => getColumnValue(row, column),
			cell: stableCell(`column:${column.id}`, ({ row, getValue }) =>
				column.cell
					? column.cell(row.original)
					: renderFallbackValue(getValue()),
			),
			enableSorting: column.sortable ?? Boolean(column.accessor || column.sortValue),
			meta: column,
		}));

		if (hasActions) {
			dataColumns.push({
				id: "__actions",
				header: () => <ActionsHeaderIcon />,
				cell: stableCell("__actions", ({ row }) => renderConfiguredActions(row.original)),
				enableSorting: false,
			});
		}

		if (enableSelection) {
			dataColumns.unshift({
				id: "__select",
				header: ({ table }) => (
					<Checkbox checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() ? "indeterminate" : false)} onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)} aria-label={selectAllLabel} />
				),
				cell: ({ row }) => (
					<Checkbox checked={row.getIsSelected()} disabled={!row.getCanSelect()} onCheckedChange={(checked) => row.toggleSelected(checked === true)} onClick={(event) => event.stopPropagation()} aria-label={selectRowLabel} />
				),
				enableSorting: false,
			});
		}

		return dataColumns;
	}, [
		enableSelection,
		hasActions,
		renderConfiguredActions,
		selectAllLabel,
		selectRowLabel,
		visibleDesktopColumns,
		stableCell,
	]);

	const table = useReactTable({
		data,
		columns: tableColumns,
		getRowId: (row, index) => getRowId(row, index),
		state: {
			rowSelection,
			sorting: sortingState,
		},
		enableRowSelection: getRowCanSelect
			? (row) => getRowCanSelect(row.original)
			: enableSelection,
		manualSorting,
		enableSortingRemoval: false,
		onRowSelectionChange: (updater) => {
			const next = functionalUpdate(updater, rowSelection);
			const nextIds = Object.keys(next).filter((id) => next[id]);
			const nextRows = nextIds
				.map((id) => rowDataById.get(id))
				.filter(Boolean) as TData[];
			if (!selectedRowIds) {
				setInternalSelection(next);
			}
			onSelectionChange?.(nextIds, nextRows);
		},
		onSortingChange: (updater) => {
			const next = functionalUpdate(updater, sortingState);
			if (!sorting) {
				setInternalSorting(next);
			}
			onSortingChange?.(next);
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
	});

	const rows = table.getRowModel().rows;
	const selectableTableIdRef = useRef<symbol>(Symbol("selectable-data-table"));
	const markSelectableTableActive = useCallback(() => {
		if (!enableSelection) return;
		activeSelectableTableId = selectableTableIdRef.current;
	}, [enableSelection]);
	const selectAllRows = useCallback(() => {
		if (!enableSelection) return;
		const nextIds = data
			.map((row, index) => ({ row, id: getRowId(row, index) }))
			.filter(({ row }) => (getRowCanSelect ? getRowCanSelect(row) : true));
		const nextSelection = nextIds.reduce<RowSelectionState>((acc, item) => {
			acc[item.id] = true;
			return acc;
		}, {});
		const nextRowIds = nextIds.map((item) => item.id);
		const nextRows = nextIds.map((item) => item.row);
		if (!selectedRowIds) {
			setInternalSelection(nextSelection);
		}
		onSelectionChange?.(nextRowIds, nextRows);
	}, [
		data,
		enableSelection,
		getRowCanSelect,
		getRowId,
		onSelectionChange,
		selectedRowIds,
	]);
	useEffect(() => {
		if (!enableSelection) return;
		installSelectAllShortcut();
		const tableId = selectableTableIdRef.current;
		selectableTables.set(tableId, {
			isVisible: () => {
				const root = rootRef.current;
				if (!root) return false;
				const rect = root.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			},
			selectAll: selectAllRows,
			updatedAt: Date.now(),
		});
		return () => {
			selectableTables.delete(tableId);
			if (activeSelectableTableId === tableId) {
				activeSelectableTableId = null;
			}
		};
	}, [enableSelection, selectAllRows]);
	const handleSelectAllShortcut = (
		event: ReactKeyboardEvent<HTMLDivElement>,
	) => {
		if (!enableSelection) return;
		if (!(event.ctrlKey || event.metaKey)) return;
		if (event.key.toLowerCase() !== "a") return;
		if (isEditableTarget(event.target)) return;
		event.preventDefault();
		selectAllRows();
	};
	const showLoadingState = isLoading && rows.length === 0;
	const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
	const selectedRows =
		selectedRowsOverride ??
		(selectedIds
			.map((id) => rowDataById.get(id))
			.filter(Boolean) as TData[]);
	const selectedCount = selectedCountOverride ?? selectedRows.length;
	const mobileVisibleColumns = useMemo(() => {
		const mobileColumns = activeColumns.filter(shouldShowMobileColumn);
		const primary =
			mobileColumns.find((column) => column.isPrimary) ??
			mobileColumns.find((column) => column.priority === "primary") ??
			mobileColumns[0] ??
			activeColumns[0];
		const rest = mobileColumns
			.filter((column) => column.id !== primary?.id)
			.sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99));
		const summary =
			rest.find((column) => column.mobileSummary) ??
			rest.find((column) => column.priority === "high") ??
			rest[0];
		return { primary, rest, summary };
	}, [activeColumns]);
	const visibleColumnCount = table.getVisibleFlatColumns().length || 1;
	const loadingRowKeys = useMemo(
		() =>
			Array.from({ length: loadingRows }, (_, rowNumber) => ({
				id: `resource-skeleton-row-${rowNumber + 1}`,
			})),
		[loadingRows],
	);
	const loadingCellKeys = useMemo(
		() =>
			Array.from({ length: visibleColumnCount }, (_, columnNumber) => ({
				id: `resource-skeleton-cell-${columnNumber + 1}`,
			})),
		[visibleColumnCount],
	);
	const bulkChildren =
		renderBulkActions?.(selectedRows, selectedIds) ??
		bulkActions?.map((action) => {
			const isDisabled =
				typeof action.disabled === "function"
					? action.disabled(selectedRows, selectedIds)
					: action.disabled;
			return (
				<Button key={action.id} disabled={isDisabled} onClick={() => action.onClick?.(selectedRows, selectedIds)} size="sm" loading={action.loading} variant={action.isDanger ? "destructive" : "outline"}>{action.icon}
					{action.label}
				</Button>
			);
		});

	const clearSelection = () => {
		if (!selectedRowIds) {
			setInternalSelection({});
		}
		onSelectionChange?.([], []);
	};
	const {
		className: containerClassName,
		onKeyDown: containerOnKeyDown,
		onMouseDown: containerOnMouseDown,
		...rootContainerProps
	} = containerProps ?? {};
	const { className: tableClassName, ...resolvedTableProps } = tableProps ?? {};
	const rootClassName = ["rb-data-table-root", containerClassName]
		.filter(Boolean)
		.join(" ");
	const tableClassNameValue = ["rb-data-table", tableClassName]
		.filter(Boolean)
		.join(" ");

	const renderState = () => {
		if (error) {
			return (
				<div className="text-red-300 rb-resource-state">
					{error}
				</div>
			);
		}
		if (!showLoadingState && rows.length === 0) {
			return (
				<div className="rb-resource-state">
					{emptyState ?? t("noData")}
				</div>
			);
		}
		return null;
	};

	const state = renderState();

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: table root: keyboard shortcuts and focus are handled here
		<div ref={rootRef} dir={dir} tabIndex={enableSelection ? 0 : undefined} onKeyDown={(event) => {
				handleSelectAllShortcut(event);
				containerOnKeyDown?.(event);
			}} onFocus={markSelectableTableActive} onMouseDown={(event) => {
				markSelectableTableActive();
				if (!isEditableTarget(event.target)) {
					rootRef.current?.focus({ preventScroll: true });
				}
				containerOnMouseDown?.(event);
			}} data-actions-display={resolvedActionsDisplay} data-actions-placement={actionsPlacement} data-actions-hover={showActionsOnHover && !alwaysShowActions ? "true" : undefined} data-actions-always={alwaysShowActions ? "true" : undefined} style={
				{
					"--rb-actions-column-width":
						typeof resolvedActionsColumnWidth === "number"
							? `${resolvedActionsColumnWidth}px`
							: resolvedActionsColumnWidth,
				} as CSSProperties
			} {...rootContainerProps} className={cn("w-full focus-visible:outline-none", bulkChildren && selectedCount > 0 ? "pb-32" + " " + "md:pb-24" : "", rootClassName)}>
			{showSortMenu && sortOptions.length > 0 && (
				<div className="flex flex-row items-center gap-2 justify-end mb-2 rb-data-table-sort">
					<DataTableSortMenu
						options={sortOptions}
						sorting={sortingState}
						onSortingChange={(next) => table.setSorting(next)}
					/>
				</div>
			)}
			{isMobile ? (
				<div className="flex flex-col gap-2.5 items-stretch rb-resource-list">
					{!showLoadingState && (rows.length > 0 || state) && (
						<div className="flex flex-row items-center gap-2.5 min-w-0! rb-resource-mobile-head">
							{enableSelection && (
								<div className="flex items-center shrink-0 rb-resource-mobile-head-select">
									<Checkbox checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() ? "indeterminate" : false)} onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)} aria-label={selectAllLabel} />
								</div>
							)}
							<div className="min-w-0! flex-1">
								<div className="flex items-center justify-between gap-2.5 min-w-0!">
									<div className="min-w-0! flex-1 rb-resource-mobile-head-primary">
										{renderHeaderLabel(mobileVisibleColumns.primary)}
									</div>
									{mobileVisibleColumns.summary && (
										<div className="rb-resource-mobile-head-summary">
											{renderHeaderLabel(mobileVisibleColumns.summary)}
										</div>
									)}
									{hasActions && (
										<div className="rb-resource-mobile-head-actions">
											<ActionsHeaderIcon />
										</div>
									)}
								</div>
							</div>
						</div>
					)}
					{showLoadingState
						? loadingRowKeys.map((rowKey) => (
								<div key={rowKey.id} className="rb-resource-card">
									
									<Skeleton className="h-3 w-[80%] mt-3" />
									<Skeleton className="h-3 w-[62%] mt-2" />
								</div>
							))
						: rows.map((row) => {
								const original = row.original;
								const primary = mobileVisibleColumns.primary;
								const summary = mobileVisibleColumns.summary;
								const detailColumns = mobileVisibleColumns.rest;
								const resolvedRowActions = getResolvedRowActions(original);
								const isExpanded = Boolean(expandedMobileRows[row.id]);
								const hasExpandedRow = Boolean(
									renderExpandedRow && isRowExpanded?.(original),
								);
								const compactDetails = detailColumns.length > 4;
								const canExpand = detailColumns.length > 0 || hasActions;
								const toggleExpanded = () => {
									if (!canExpand) return;
									setExpandedMobileRows((current) => ({
										...current,
										[row.id]: !current[row.id],
									}));
								};
								return (
									// biome-ignore lint/a11y/useAriaPropsSupportedByRole: a row is a button only while it can expand, so its role is conditional
									// biome-ignore lint/a11y/noStaticElementInteractions: a row is a button only while it can expand, so its role is conditional
									<div key={row.id} data-expanded={isExpanded ? "true" : undefined} data-selected={row.getIsSelected() ? "true" : undefined} role={canExpand ? "button" : undefined} tabIndex={canExpand ? 0 : undefined} aria-expanded={canExpand ? isExpanded : undefined} onClick={toggleExpanded} onContextMenu={(event) => handleTableContextMenu(event, original)} onKeyDown={(event) => {
											if (!canExpand) return;
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											toggleExpanded();
										}} className={cn(canExpand ? "cursor-pointer" : "cursor-default", "rb-resource-card")}>
										<div className="flex flex-row items-center gap-2.5 min-w-0! rb-resource-card-main">
											{enableSelection && (
												<div className="flex items-center shrink-0">
													<Checkbox checked={row.getIsSelected()} disabled={!row.getCanSelect()} onCheckedChange={(checked) => row.toggleSelected(checked === true)} onClick={(event) => event.stopPropagation()} aria-label={selectRowLabel} />
												</div>
											)}
											<div className="min-w-0! flex-1">
												<div className="flex items-center justify-between gap-2.5 min-w-0!">
													<div className="min-w-0! flex-1 rb-resource-primary">
														{primary ? (
															<DataTableCell row={row} column={primary} />
														) : null}
													</div>
													{summary && (
														<div className="rb-resource-summary">
															<DataTableCell row={row} column={summary} />
														</div>
													)}
													{hasActions && (
														<div className="shrink-0 rb-mobile-actions">
															{resolvedRowActions.length > 0 ? (
																<RowActionsMenu
																	actions={resolvedRowActions}
																	label={actionsLabel}
																/>
															) : null}
														</div>
													)}
												</div>
											</div>
										</div>
										{(isExpanded || hasExpandedRow) && (
											<div className="rb-resource-expanded">
												<div data-density={compactDetails ? "compact" : undefined} className="rb-resource-details">
													{detailColumns.map((column) => (
														<div key={`${row.id}-${column.id}`} className="rb-resource-meta">
															<span className="text-panel-text-muted shrink-0">
																{column.mobileMetaLabel ?? column.mobileLabel ?? column.header}
															</span>
															<div className="text-panel-text min-w-0! rb-resource-meta-value">
																<DataTableCell
																	row={row}
																	column={column}
																	variant="mobile-detail"
																/>
															</div>
														</div>
													))}
												</div>
												{(resolvedRowActions.length > 0 || renderRowActions) && (
													<div className="flex items-center justify-end gap-2 rb-resource-expanded-actions">
														<div className="min-w-0!">
															{resolvedRowActions.length > 0 ? (
																<InlineRowActions actions={resolvedRowActions} />
															) : renderRowActions ? (
																// biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control
																// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control
																<div onClick={(event) => event.stopPropagation()} className="rb-inline-actions">
																	{renderRowActions(original)}
																</div>
															) : null}
														</div>
													</div>
												)}
											</div>
										)}
										{hasExpandedRow && (
											// biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops row clicks, it is not a control
											// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops row clicks, it is not a control
											<div onClick={(event) => event.stopPropagation()} className="rb-resource-expanded">
												{renderExpandedRow?.(original)}
											</div>
										)}
									</div>
								);
							})}
					{state}
				</div>
			) : (
				<div className="rb-data-table-wrap">
					<table aria-label={ariaLabel} {...resolvedTableProps} className={cn("w-full border-separate border-spacing-0", tableClassNameValue)}>
						<thead className="rb-data-table-head">
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => {
										const config = header.column.columnDef.meta as
											| DataTableColumn<TData>
											| undefined;
										const isSelectColumn = header.column.id === "__select";
										const isActionsColumn = header.column.id === "__actions";
										const sorted = header.column.getIsSorted();
										const headerAlign = getHeaderAlign(config);
										const headerInset = getHeaderInset(config);
										const columnWidth = getResponsiveSize(
											getColumnWidth(config),
											activeBreakpoint,
										);
										const columnMinWidth = getResponsiveSize(
											getColumnMinWidth(config),
											activeBreakpoint,
										);
										const columnMaxWidth = getResponsiveSize(
											getColumnMaxWidth(config),
											activeBreakpoint,
										);
										return (
											<th key={header.id} style={{ width: resolveColumnWidth(isSelectColumn, isActionsColumn, columnWidth), minWidth: isSelectColumn
														? selectionColumnWidth
														: isActionsColumn
															? resolvedActionsColumnWidth
															: columnMinWidth, maxWidth: isSelectColumn
														? selectionColumnWidth
														: isActionsColumn
															? resolvedActionsColumnWidth
															: columnMaxWidth, textAlign: isActionsColumn
														? "end"
														: isSelectColumn
															? "center"
															: alignToTextAlign(headerAlign) }}     data-actions={isActionsColumn ? "true" : undefined} data-col={config?.id} data-center={
													isSelectColumn || headerAlign === "center"
														? "true"
														: undefined
												} {...config?.headerProps} className={cn("bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text", [
													isSelectColumn ? "rb-select-cell" : "",
													isActionsColumn ? "rb-actions-cell" : "",
													config?.isPrimary ? "rb-primary-cell" : "",
												].filter(Boolean).join(" "))}>
												<div style={{ paddingInlineStart: !isSelectColumn &&
														!isActionsColumn &&
														headerAlign === "start"
															? headerInset
															: undefined, paddingInlineEnd: !isSelectColumn &&
														!isActionsColumn &&
														headerAlign === "end"
															? headerInset
															: undefined, justifyContent: isActionsColumn
															? "flex-end"
															: isSelectColumn
																? "center"
																: alignToFlexJustify(headerAlign) }}    className="flex flex-row items-center gap-1 w-full">
													<span className="min-w-0! max-w-full overflow-hidden text-ellipsis">
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
													</span>
													{sorted && (
														<span className="text-[10px] text-panel-text-muted">
															{sorted === "desc" ? "↓" : "↑"}
														</span>
													)}
												</div>
											</th>
										);
									})}
								</tr>
							))}
						</thead>
						<tbody>
							{showLoadingState
								? loadingRowKeys.map((rowKey) => (
										<tr key={rowKey.id}>
											{loadingCellKeys.map((cellKey) => (
												<td key={`${rowKey.id}-${cellKey.id}`} className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<Skeleton className="h-4" />
												</td>
											))}
										</tr>
									))
								: rows.map((row) => (
										<Fragment key={row.id}>
											<tr data-selected={row.getIsSelected() ? "true" : undefined} data-expanded={
												renderExpandedRow && isRowExpanded?.(row.original)
													? "true"
													: undefined
											} onClick={() => onRowClick?.(row.original)} onContextMenu={(event) =>
												handleTableContextMenu(event, row.original)
											} className={cn(onRowClick ? "cursor-pointer" : "cursor-default", "rb-data-table-row")}>
											{row.getVisibleCells().map((cell) => {
												const config = cell.column.columnDef.meta as
													| DataTableColumn<TData>
													| undefined;
												const isSelectColumn = cell.column.id === "__select";
												const isActionsColumn = cell.column.id === "__actions";
												const cellAlign = getCellAlign(config);
												const columnWidth = getResponsiveSize(
													getColumnWidth(config),
													activeBreakpoint,
												);
												const columnMinWidth = getResponsiveSize(
													getColumnMinWidth(config),
													activeBreakpoint,
												);
												const columnMaxWidth = getResponsiveSize(
													getColumnMaxWidth(config),
													activeBreakpoint,
												);
												return (
													<td key={cell.id} style={{ textAlign: isActionsColumn
																? "end"
																: isSelectColumn
																	? "center"
																	: alignToTextAlign(cellAlign), width: resolveColumnWidth(isSelectColumn, isActionsColumn, columnWidth), minWidth: isSelectColumn
																? selectionColumnWidth
																: isActionsColumn
																	? resolvedActionsColumnWidth
																	: columnMinWidth, maxWidth: isSelectColumn
																? selectionColumnWidth
																: isActionsColumn
																	? resolvedActionsColumnWidth
																	: columnMaxWidth }}  data-actions={isActionsColumn ? "true" : undefined} data-col={config?.id} data-center={
															isSelectColumn || cellAlign === "center"
																? "true"
																: undefined
														}    {...config?.cellProps} className={cn("px-6 py-4 text-[0.875rem] leading-5 text-panel-text", [
															isSelectColumn ? "rb-select-cell" : "",
															isActionsColumn ? "rb-actions-cell" : "",
															config?.isPrimary ? "rb-primary-cell" : "",
															config?.isMeta ? "rb-meta-cell" : "",
														].filter(Boolean).join(" "))}>
														{isSelectColumn || isActionsColumn ? (
															flexRender(
																cell.column.columnDef.cell,
																cell.getContext(),
															)
														) : (
															<DataTableCellContent
																column={config}
																value={cell.getValue()}
															>
																{flexRender(
																	cell.column.columnDef.cell,
																	cell.getContext(),
																)}
															</DataTableCellContent>
														)}
													</td>
												);
											})}
											</tr>
											{renderExpandedRow && isRowExpanded?.(row.original) && (
												<tr className="rb-data-table-row-detail">
													<td colSpan={visibleColumnCount} className="text-[0.875rem] leading-5 text-panel-text p-0">
														<div className="p-4 rb-data-table-expanded-content">
															{renderExpandedRow(row.original)}
														</div>
													</td>
												</tr>
											)}
										</Fragment>
									))}
							{state && !showLoadingState && (
								<tr>
									<td colSpan={visibleColumnCount} className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">{state}</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
			{pagination ? <div className="mt-3 rb-data-table-pagination">{pagination}</div> : null}
			{bulkChildren && (
				<BulkActionBar
					selectedCount={selectedCount}
					onClear={clearSelection}
					selectedLabel={resolveSelectedLabel(selectedLabel, selectedCount)}
				>
					{Array.isArray(bulkChildren)
						? Children.toArray(bulkChildren)
						: bulkChildren}
				</BulkActionBar>
			)}
			{contextMenu.row && contextMenuActions.length > 0 && (
				<DropdownMenu open={contextMenu.open} onOpenChange={(open) => { if (!open) closeContextMenu(); }}>
					<DropdownMenuTrigger asChild>
						<div style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }} className="fixed w-[1px] h-[1px] opacity-0 pointer-events-none" />
					</DropdownMenuTrigger>
					
						<DropdownMenuContent data-rb-context-menu="" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}} className="min-w-[220px]! max-w-[calc(100vw_-_24px)] max-h-[min(50vh,_360px)] overflow-y-auto overflow-x-hidden overscroll-contain z-[2500]">
							{orderRowActions(contextMenuActions).map((action) => (
								<DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={(event) => {
											event.stopPropagation();
											closeContextMenu();
											action.onClick?.();
										}} className={toneClass(action.color ?? (action.isDanger ? "red.400" : undefined))}>
										{action.icon}{action.label}
									</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					
				</DropdownMenu>
			)}
		</div>
	);
}
