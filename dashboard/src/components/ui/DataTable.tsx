import {
	Box,
	Button,
	Checkbox,
	Flex,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
	Skeleton,
	SkeletonText,
	Table,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	useBreakpointValue,
	VStack,
} from "@chakra-ui/react";
import {
	AdjustmentsHorizontalIcon,
	DocumentDuplicateIcon,
} from "@heroicons/react/24/outline";
import {
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
import {
	Fragment,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { copyTextToClipboard } from "utils/clipboard";
import { BulkActionBar } from "./BulkActionBar";
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
		const handle =
			activeHandle && activeHandle.isVisible() ? activeHandle : fallbackHandle;

		if (!handle) return;
		event.preventDefault();
		event.stopPropagation();
		handle.selectAll();
	}, true);
};

const ActionsHeaderIcon = () => (
	<Box
		className="rb-actions-header-icon"
		display="inline-flex"
		alignItems="center"
		justifyContent="flex-end"
		w="full"
		color="panel.textMuted"
		aria-hidden="true"
	>
		<Box as={AdjustmentsHorizontalIcon} w={3.5} h={3.5} />
	</Box>
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
		<Flex
			className="rb-cell-content"
			data-truncate={shouldTruncate ? "true" : undefined}
			data-multiline={multiline ? "true" : undefined}
			data-copyable={shouldCopy ? "true" : undefined}
			data-align={cellAlign}
			align="center"
			justify={alignToFlexJustify(cellAlign)}
			gap={1.5}
			minW={0}
			maxW="full"
			overflow={multiline ? "visible" : "hidden"}
		>
			<Box className="rb-cell-value" minW={0} flex="1 1 auto" maxW="full">
				{children}
			</Box>
			{shouldCopy && (
				<IconButton
					aria-label="Copy value"
					icon={<Box as={DocumentDuplicateIcon} w={3.5} h={3.5} />}
					size="xs"
					variant="ghost"
					className="rb-cell-copy"
					flexShrink={0}
					onClick={(event) => {
						event.stopPropagation();
						void copyTextToClipboard(fullText);
					}}
				/>
			)}
		</Flex>
	);

	if (!shouldTooltip) return content;

	return (
		<Tooltip
			hasArrow
			openDelay={350}
			label={
				<Box
					maxW="360px"
					maxH="180px"
					overflowY="auto"
					whiteSpace="pre-wrap"
					wordBreak="break-word"
					dir="auto"
				>
					{fullText}
				</Box>
			}
		>
			{content}
		</Tooltip>
	);
};

const getActionLabelText = (label: RowActionItem["label"]) =>
	typeof label === "string" || typeof label === "number"
		? String(label)
		: "Row action";

const InlineRowActions = ({ actions }: { actions: RowActionItem[] }) => {
	if (actions.length === 0) return null;
	const orderedActions = orderRowActions(actions);

	return (
		<HStack
			className="rb-inline-actions"
			spacing={1}
			justify="flex-start"
			onClick={(event) => event.stopPropagation()}
		>
			{orderedActions.map((action) => {
				const label = getActionLabelText(action.label);
				if (action.render) {
					const renderAction = action.render;
					return (
						<Menu key={action.id} placement="auto-end" strategy="fixed" autoSelect={false}>
							{({ onClose }) => (
								<>
									<Tooltip label={action.label}>
										<MenuButton
											as={IconButton}
											aria-label={label}
											icon={action.icon ?? <DocumentDuplicateIcon />}
											size="sm"
											variant="ghost"
											className="rb-inline-action"
											color={action.color}
											colorScheme={action.isDanger ? "red" : undefined}
											isDisabled={action.isDisabled}
											onClick={(event) => event.stopPropagation()}
										/>
									</Tooltip>
									<Portal>
										<MenuList
											minW="220px"
											maxW="calc(100vw - 24px)"
											maxH="min(70vh, 420px)"
											overflowY="auto"
											zIndex={2500}
											borderRadius="lg"
											boxShadow="2xl"
										>
											{renderAction(onClose)}
										</MenuList>
									</Portal>
								</>
							)}
						</Menu>
					);
				}
				return action.icon ? (
					<Tooltip key={action.id} label={action.label}>
						<IconButton
							aria-label={label}
							icon={action.icon}
							size="sm"
							variant="ghost"
							className="rb-inline-action"
							color={action.color}
							colorScheme={action.isDanger ? "red" : undefined}
							isDisabled={action.isDisabled}
							onClick={(event) => {
								event.stopPropagation();
								action.onClick?.();
							}}
						/>
					</Tooltip>
				) : (
					<Button
						key={action.id}
						size="sm"
						variant="ghost"
						className="rb-inline-action"
						color={action.color}
						colorScheme={action.isDanger ? "red" : undefined}
						isDisabled={action.isDisabled}
						onClick={(event) => {
							event.stopPropagation();
							action.onClick?.();
						}}
					>
						{action.label}
					</Button>
				);
			})}
		</HStack>
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
	isLoading = false,
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
	sorting,
	onSortingChange,
	manualSorting = false,
	pagination,
	dir = "ltr",
	tableProps,
	containerProps,
	mobileBreakpoint = "lg",
	ariaLabel,
}: DataTableProps<TData>) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		row: TData | null;
		x: number;
		y: number;
	}>({ row: null, x: 0, y: 0 });
	const resolvedActionsDisplay =
		actionsDisplay ??
		(rowActions ? "menu" : renderRowActions ? "inline" : "none");
	const hasActions = resolvedActionsDisplay !== "none" && Boolean(rowActions || renderRowActions);
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
	const visibleDesktopColumns = useMemo(
		() =>
			columns.filter((column) =>
				shouldShowDesktopColumn(column, activeBreakpoint),
			),
		[activeBreakpoint, columns],
	);
	const getResolvedRowActions = useMemo(
		() => (row: TData): RowActionItem[] =>
			rowActions?.(row).map((action) => ({
				...action,
				onClick: () => action.onClick?.(row),
				render: action.render
					? (onClose: () => void) => action.render?.(row, onClose)
					: undefined,
				isDisabled:
					typeof action.isDisabled === "function"
						? action.isDisabled(row)
						: action.isDisabled,
			})) ?? [],
		[rowActions],
	);
	const contextMenuActions = contextMenu.row
		? getResolvedRowActions(contextMenu.row)
		: [];
	const closeContextMenu = () => {
		setContextMenu({ row: null, x: 0, y: 0 });
	};
	const handleTableContextMenu = (
		event: ReactMouseEvent,
		row: TData,
	) => {
		const actions = getResolvedRowActions(row);
		if (!isMobile && actions.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			setContextMenu({ row, x: event.clientX, y: event.clientY });
		}
	};
	const isEditableTarget = (target: EventTarget | null) => {
		return isEditableDomTarget(target);
	};
	useEffect(() => {
		if (!contextMenu.row) return;
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeContextMenu();
		};
		const handleScroll = () => closeContextMenu();
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("scroll", handleScroll, true);
		return () => {
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("scroll", handleScroll, true);
		};
	}, [contextMenu.row]);
	const renderConfiguredActions = useMemo(
		() => (row: TData) => {
			if (resolvedActionsDisplay === "none") return null;

			if (resolvedActionsDisplay === "inline") {
				if (renderRowActions) {
					return (
						<Box
							className="rb-inline-actions"
							onClick={(event) => event.stopPropagation()}
						>
							{renderRowActions(row)}
						</Box>
					);
				}

				return <InlineRowActions actions={getResolvedRowActions(row)} />;
			}

			return <RowActionsMenu actions={getResolvedRowActions(row)} />;
		},
		[getResolvedRowActions, renderRowActions, resolvedActionsDisplay],
	);
	const [internalSelection, setInternalSelection] = useState<RowSelectionState>(() =>
		makeSelectionState(defaultSelectedRowIds),
	);
	const [internalSorting, setInternalSorting] = useState<SortingState>([]);
	const [expandedMobileRows, setExpandedMobileRows] = useState<Record<string, boolean>>({});
	const rowDataById = useMemo(() => {
		const map = new Map<string, TData>();
		data.forEach((row, index) => map.set(getRowId(row, index), row));
		return map;
	}, [data, getRowId]);
	const controlledSelection = useMemo(
		() => (selectedRowIds ? makeSelectionState(selectedRowIds) : undefined),
		[selectedRowIds],
	);
	const rowSelection = controlledSelection ?? internalSelection;
	const sortingState = sorting ?? internalSorting;

	const tableColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
		const dataColumns = visibleDesktopColumns.map<ColumnDef<TData, unknown>>((column) => ({
			id: column.id,
			header: () => column.header,
			accessorFn: (row) => getColumnValue(row, column),
			cell: ({ row, getValue }) =>
				column.cell
					? column.cell(row.original)
					: renderFallbackValue(getValue()),
			enableSorting: Boolean(column.sortable),
			meta: column,
		}));

		if (hasActions) {
			dataColumns.push({
				id: "__actions",
				header: () => <ActionsHeaderIcon />,
				cell: ({ row }) => renderConfiguredActions(row.original),
				enableSorting: false,
			});
		}

		if (enableSelection) {
			dataColumns.unshift({
				id: "__select",
				header: ({ table }) => (
					<Checkbox
						size="sm"
						isChecked={table.getIsAllRowsSelected()}
						isIndeterminate={table.getIsSomeRowsSelected()}
						onChange={table.getToggleAllRowsSelectedHandler()}
						aria-label="Select all rows"
					/>
				),
				cell: ({ row }) => (
					<Checkbox
						size="sm"
						isChecked={row.getIsSelected()}
						isDisabled={!row.getCanSelect()}
						onChange={row.getToggleSelectedHandler()}
						onClick={(event) => event.stopPropagation()}
						aria-label="Select row"
					/>
				),
				enableSorting: false,
			});
		}

		return dataColumns;
	}, [enableSelection, hasActions, renderConfiguredActions, visibleDesktopColumns]);

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
		const mobileColumns = columns.filter(shouldShowMobileColumn);
		const primary =
			mobileColumns.find((column) => column.isPrimary) ??
			mobileColumns.find((column) => column.priority === "primary") ??
			mobileColumns[0] ??
			columns[0];
		const rest = mobileColumns
			.filter((column) => column.id !== primary?.id)
			.sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99));
		const summary =
			rest.find((column) => column.mobileSummary) ??
			rest.find((column) => column.priority === "high") ??
			rest[0];
		return { primary, rest, summary };
	}, [columns]);
	const visibleColumnCount = table.getVisibleFlatColumns().length || 1;
	const bulkChildren =
		renderBulkActions?.(selectedRows, selectedIds) ??
		bulkActions?.map((action) => {
			const isDisabled =
				typeof action.isDisabled === "function"
					? action.isDisabled(selectedRows, selectedIds)
					: action.isDisabled;
			return (
				<Button
					key={action.id}
					size="sm"
					variant={action.variant ?? "outline"}
					leftIcon={action.icon}
					colorScheme={action.isDanger ? "red" : undefined}
					isLoading={action.isLoading}
					isDisabled={isDisabled}
					onClick={() => action.onClick?.(selectedRows, selectedIds)}
				>
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
				<Box className="rb-resource-state" color="red.300">
					{error}
				</Box>
			);
		}
		if (!showLoadingState && rows.length === 0) {
			return <Box className="rb-resource-state">{emptyState ?? "No data found."}</Box>;
		}
		return null;
	};

	const state = renderState();

	return (
		<Box
			ref={rootRef}
			w="full"
			dir={dir}
			tabIndex={enableSelection ? 0 : undefined}
			_focusVisible={{ outline: "none" }}
			onKeyDown={(event) => {
				handleSelectAllShortcut(event);
				containerOnKeyDown?.(event);
			}}
			onFocus={markSelectableTableActive}
			onMouseDown={(event) => {
				markSelectableTableActive();
				if (!isEditableTarget(event.target)) {
					rootRef.current?.focus({ preventScroll: true });
				}
				containerOnMouseDown?.(event);
			}}
			className={rootClassName}
			data-actions-display={resolvedActionsDisplay}
			data-actions-placement={actionsPlacement}
			data-actions-hover={showActionsOnHover && !actionsAlwaysVisible ? "true" : undefined}
			data-actions-always={actionsAlwaysVisible ? "true" : undefined}
			sx={
				{
					"--rb-actions-column-width":
						typeof actionsColumnWidth === "number"
							? `${actionsColumnWidth}px`
							: actionsColumnWidth,
				} as Record<string, string>
			}
			pb={bulkChildren ? { base: 32, md: 24 } : undefined}
			{...rootContainerProps}
		>
			{isMobile ? (
				<VStack className="rb-resource-list" spacing={2.5} align="stretch">
					{!showLoadingState && (rows.length > 0 || state) && (
						<HStack
							className="rb-resource-mobile-head"
							align="center"
							spacing={2.5}
							minW={0}
						>
							{enableSelection && (
								<Box
									className="rb-resource-mobile-head-select"
									display="flex"
									alignItems="center"
									flexShrink={0}
								>
									<Checkbox
										isChecked={table.getIsAllRowsSelected()}
										isIndeterminate={table.getIsSomeRowsSelected()}
										onChange={table.getToggleAllRowsSelectedHandler()}
										aria-label="Select all rows"
									/>
								</Box>
							)}
							<Box minW={0} flex="1">
								<Flex
									align="center"
									justify="space-between"
									gap={2.5}
									minW={0}
								>
									<Box minW={0} flex="1" className="rb-resource-mobile-head-primary">
										{renderHeaderLabel(mobileVisibleColumns.primary)}
									</Box>
									{mobileVisibleColumns.summary && (
										<Box className="rb-resource-mobile-head-summary">
											{renderHeaderLabel(mobileVisibleColumns.summary)}
										</Box>
									)}
									{hasActions && (
										<Box className="rb-resource-mobile-head-actions">
											<ActionsHeaderIcon />
										</Box>
									)}
								</Flex>
							</Box>
						</HStack>
					)}
					{showLoadingState
						? Array.from({ length: loadingRows }, (_, index) => (
								<Box className="rb-resource-card" key={`resource-skeleton-${index}`}>
									<SkeletonText noOfLines={1} w="50%" />
									<Skeleton h="3" w="80%" mt={3} />
									<Skeleton h="3" w="62%" mt={2} />
								</Box>
							))
						: rows.map((row) => {
								const original = row.original;
								const primary = mobileVisibleColumns.primary;
								const summary = mobileVisibleColumns.summary;
								const detailColumns = mobileVisibleColumns.rest;
								const resolvedRowActions = getResolvedRowActions(original);
								const isExpanded = Boolean(expandedMobileRows[row.id]);
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
									<Box
										key={row.id}
										className="rb-resource-card"
										data-expanded={isExpanded ? "true" : undefined}
										data-selected={row.getIsSelected() ? "true" : undefined}
										role={canExpand ? "button" : undefined}
										tabIndex={canExpand ? 0 : undefined}
										cursor={canExpand ? "pointer" : "default"}
										aria-expanded={canExpand ? isExpanded : undefined}
										onClick={toggleExpanded}
										onContextMenu={(event) => handleTableContextMenu(event, original)}
										onKeyDown={(event) => {
											if (!canExpand) return;
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											toggleExpanded();
										}}
									>
										<HStack
											align="center"
											className="rb-resource-card-main"
											spacing={2.5}
											minW={0}
										>
											{enableSelection && (
												<Box display="flex" alignItems="center" flexShrink={0}>
													<Checkbox
														isChecked={row.getIsSelected()}
														isDisabled={!row.getCanSelect()}
														onChange={row.getToggleSelectedHandler()}
														onClick={(event) => event.stopPropagation()}
													/>
												</Box>
											)}
											<Box minW={0} flex="1">
												<Flex align="center" justify="space-between" gap={2.5} minW={0}>
													<Box minW={0} flex="1" className="rb-resource-primary">
														{primary ? (
															<DataTableCell row={row} column={primary} />
														) : null}
													</Box>
													{summary && (
														<Box className="rb-resource-summary">
															<DataTableCell row={row} column={summary} />
														</Box>
													)}
													{hasActions && (
														<Box flexShrink={0} className="rb-mobile-actions">
															{resolvedRowActions.length > 0 ? (
																<RowActionsMenu actions={resolvedRowActions} />
															) : null}
														</Box>
													)}
												</Flex>
											</Box>
										</HStack>
										{isExpanded && (
											<Box className="rb-resource-expanded">
												<Box
													className="rb-resource-details"
													data-density={compactDetails ? "compact" : undefined}
												>
													{detailColumns.map((column) => (
														<Box
															key={`${row.id}-${column.id}`}
															className="rb-resource-meta"
														>
															<Text as="span" color="panel.textMuted" flexShrink={0}>
																{column.mobileMetaLabel ?? column.mobileLabel ?? column.header}
															</Text>
															<Box color="panel.text" minW={0} className="rb-resource-meta-value">
																<DataTableCell
																	row={row}
																	column={column}
																	variant="mobile-detail"
																/>
															</Box>
														</Box>
													))}
												</Box>
												{(resolvedRowActions.length > 0 || renderRowActions) && (
													<Flex
														className="rb-resource-expanded-actions"
														align="center"
														justify={dir === "rtl" ? "flex-start" : "flex-end"}
														gap={2}
													>
														<Box minW={0}>
															{resolvedRowActions.length > 0 ? (
																<InlineRowActions actions={resolvedRowActions} />
															) : renderRowActions ? (
																<Box
																	className="rb-inline-actions"
																	onClick={(event) => event.stopPropagation()}
																>
																	{renderRowActions(original)}
																</Box>
															) : null}
														</Box>
													</Flex>
												)}
											</Box>
										)}
									</Box>
								);
							})}
					{state}
				</VStack>
			) : (
				<Box className="rb-data-table-wrap">
					<Table
						size="sm"
						variant="simple"
						className={tableClassNameValue}
						aria-label={ariaLabel}
						{...resolvedTableProps}
					>
						<Thead className="rb-data-table-head">
							{table.getHeaderGroups().map((headerGroup) => (
								<Tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => {
										const config = header.column.columnDef.meta as
											| DataTableColumn<TData>
											| undefined;
										const isSelectColumn = header.column.id === "__select";
										const isActionsColumn = header.column.id === "__actions";
										const canSort = header.column.getCanSort();
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
											<Th
												key={header.id}
												className={[
													isSelectColumn ? "rb-select-cell" : "",
													isActionsColumn ? "rb-actions-cell" : "",
													config?.isPrimary ? "rb-primary-cell" : "",
												].filter(Boolean).join(" ")}
												w={
													isSelectColumn
														? selectionColumnWidth
														: isActionsColumn
															? actionsColumnWidth
															: columnWidth
												}
												minW={
													isSelectColumn
														? selectionColumnWidth
														: isActionsColumn
															? actionsColumnWidth
															: columnMinWidth
												}
												maxW={
													isSelectColumn
														? selectionColumnWidth
														: isActionsColumn
															? actionsColumnWidth
															: columnMaxWidth
												}
												textAlign={
													isActionsColumn
														? "right"
														: isSelectColumn
															? "center"
															: alignToTextAlign(headerAlign)
												}
												data-actions={isActionsColumn ? "true" : undefined}
												data-col={config?.id}
												data-center={
													isSelectColumn || headerAlign === "center"
														? "true"
														: undefined
												}
												cursor={canSort ? "pointer" : undefined}
												onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
												{...config?.headerProps}
											>
												<HStack
													spacing={1}
													w="full"
													pl={
														!isSelectColumn &&
														!isActionsColumn &&
														headerAlign === "start"
															? headerInset
															: undefined
													}
													pr={
														!isSelectColumn &&
														!isActionsColumn &&
														headerAlign === "end"
															? headerInset
															: undefined
													}
													justify={
														isActionsColumn
															? "flex-end"
															: isSelectColumn
																? "center"
																: alignToFlexJustify(headerAlign)
													}
												>
													<Box
														as="span"
														minW={0}
														maxW="full"
														overflow="hidden"
														textOverflow="ellipsis"
													>
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
													</Box>
													{sorted && (
														<Text as="span" fontSize="10px" color="panel.textMuted">
															{sorted === "desc" ? "↓" : "↑"}
														</Text>
													)}
												</HStack>
											</Th>
										);
									})}
								</Tr>
							))}
						</Thead>
						<Tbody>
							{showLoadingState
								? Array.from({ length: loadingRows }, (_, rowIndex) => (
										<Tr key={`resource-table-skeleton-${rowIndex}`}>
											{Array.from({ length: visibleColumnCount }, (_, cellIndex) => (
												<Td key={`resource-table-skeleton-${rowIndex}-${cellIndex}`}>
													<Skeleton h="4" />
												</Td>
											))}
										</Tr>
									))
								: rows.map((row) => (
										<Tr
											key={row.id}
											className="rb-data-table-row"
											data-selected={row.getIsSelected() ? "true" : undefined}
											onClick={() => onRowClick?.(row.original)}
											onContextMenu={(event) =>
												handleTableContextMenu(event, row.original)
											}
											cursor={onRowClick ? "pointer" : "default"}
										>
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
													<Td
														key={cell.id}
														className={[
															isSelectColumn ? "rb-select-cell" : "",
															isActionsColumn ? "rb-actions-cell" : "",
															config?.isPrimary ? "rb-primary-cell" : "",
															config?.isMeta ? "rb-meta-cell" : "",
														].filter(Boolean).join(" ")}
														textAlign={
															isActionsColumn
																? "right"
																: isSelectColumn
																	? "center"
																	: alignToTextAlign(cellAlign)
														}
														data-actions={isActionsColumn ? "true" : undefined}
														data-col={config?.id}
														data-center={
															isSelectColumn || cellAlign === "center"
																? "true"
																: undefined
														}
														w={
															isSelectColumn
																? selectionColumnWidth
																: isActionsColumn
																	? actionsColumnWidth
																	: columnWidth
														}
														minW={
															isSelectColumn
																? selectionColumnWidth
																: isActionsColumn
																	? actionsColumnWidth
																	: columnMinWidth
														}
														maxW={
															isSelectColumn
																? selectionColumnWidth
																: isActionsColumn
																	? actionsColumnWidth
																	: columnMaxWidth
														}
														{...config?.cellProps}
													>
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
													</Td>
												);
											})}
										</Tr>
									))}
							{state && !showLoadingState && (
								<Tr>
									<Td colSpan={visibleColumnCount}>{state}</Td>
								</Tr>
							)}
						</Tbody>
					</Table>
				</Box>
			)}
			{pagination ? <Box mt={3} className="rb-data-table-pagination">{pagination}</Box> : null}
			{bulkChildren && (
				<BulkActionBar
					selectedCount={selectedCount}
					onClear={clearSelection}
					selectedLabel={resolveSelectedLabel(selectedLabel, selectedCount)}
				>
					{Array.isArray(bulkChildren)
						? bulkChildren.map((child, index) => (
								<Fragment key={`bulk-action-${index}`}>{child}</Fragment>
							))
						: bulkChildren}
				</BulkActionBar>
			)}
			{contextMenu.row && contextMenuActions.length > 0 && (
				<Menu
					isOpen
					autoSelect={false}
					placement="bottom-start"
					strategy="fixed"
					onClose={closeContextMenu}
				>
					<MenuButton
						as={Box}
						position="fixed"
						top={`${contextMenu.y}px`}
						left={`${contextMenu.x}px`}
						w="1px"
						h="1px"
						opacity={0}
						pointerEvents="none"
					/>
					<Portal>
						<MenuList
							minW="220px"
							maxW="calc(100vw - 24px)"
							maxH="min(70vh, 420px)"
							overflowY="auto"
							zIndex={2500}
							onClick={(event) => event.stopPropagation()}
							onContextMenu={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
						>
							{orderRowActions(contextMenuActions).map((action) =>
								action.render ? (
									<Fragment key={action.id}>
										{action.render(closeContextMenu)}
									</Fragment>
								) : (
									<MenuItem
										key={action.id}
										icon={action.icon}
										isDisabled={action.isDisabled}
										color={
											action.color ??
											(action.isDanger ? "red.400" : undefined)
										}
										onClick={(event) => {
											event.stopPropagation();
											closeContextMenu();
											action.onClick?.();
										}}
									>
										{action.label}
									</MenuItem>
								),
							)}
						</MenuList>
					</Portal>
				</Menu>
			)}
		</Box>
	);
}
