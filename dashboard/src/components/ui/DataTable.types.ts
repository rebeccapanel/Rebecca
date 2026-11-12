import type { SortingState } from "@tanstack/react-table";
import type { ComponentPropsWithoutRef } from "react";
import type { ReactElement, ReactNode } from "react";

export type DataTableColumnAlign = "start" | "center" | "end";
export type DataTableColumnSize =
	| string
	| number
	| Partial<Record<"base" | "sm" | "md" | "lg" | "xl", string | number>>;

export type DataTableSortType = "number" | "text" | "date" | "boolean";

export type DataTableColumn<TData> = {
	id: string;
	header: ReactNode;
	accessor?: keyof TData | ((row: TData) => unknown);
	cell?: (row: TData) => ReactNode;
	mobileDetailCell?: (row: TData) => ReactNode;
	sortValue?: (row: TData) => unknown;
	sortable?: boolean;
	sortType?: DataTableSortType;
	size?: DataTableColumnSize;
	minSize?: DataTableColumnSize;
	maxSize?: DataTableColumnSize;
	width?: DataTableColumnSize;
	minWidth?: DataTableColumnSize;
	maxWidth?: DataTableColumnSize;
	truncate?: boolean;
	tooltip?: boolean;
	multiline?: boolean;
	copyable?: boolean;
	priority?: "primary" | "high" | "medium" | "low";
	hideBelow?: "base" | "sm" | "md" | "lg" | "xl";
	showBelow?: "base" | "sm" | "md" | "lg" | "xl";
	mobileVisible?: boolean;
	desktopVisible?: boolean;
	collapseIntoMeta?: boolean;
	mobileMetaLabel?: string;
	mobileSummary?: boolean;
	align?: DataTableColumnAlign;
	headerAlign?: DataTableColumnAlign;
	cellAlign?: DataTableColumnAlign;
	headerInset?: string | number;
	hideOnMobile?: boolean;
	mobilePriority?: number;
	mobileLabel?: ReactNode;
	/** Human label for the column-visibility menu. */
	menuLabel?: string;
	isPrimary?: boolean;
	isMeta?: boolean;
	meta?: Record<string, unknown>;
	headerProps?: ComponentPropsWithoutRef<"th">;
	cellProps?: ComponentPropsWithoutRef<"td">;
};

export type DataTableRowAction<TData> = {
	id: string;
	label: ReactNode;
	icon?: ReactElement;
	onClick?: (row: TData) => void;
	disabled?: boolean | ((row: TData) => boolean);
	disabledReason?: string | ((row: TData) => string | undefined);
	isDanger?: boolean;
	color?: string;
	pinned?: boolean;
};

export type DataTableBulkAction<TData> = {
	id: string;
	label: ReactNode;
	icon?: ReactElement;
	onClick?: (rows: TData[], rowIds: string[]) => void;
	disabled?: boolean | ((rows: TData[], rowIds: string[]) => boolean);
	loading?: boolean;
	isDanger?: boolean;
	variant?: string;
};

export type DataTableProps<TData> = {
	data: TData[];
	columns: DataTableColumn<TData>[];
	getRowId: (row: TData, index: number) => string;
	loading?: boolean;
	loadingRows?: number;
	error?: ReactNode;
	emptyState?: ReactNode;
	enableSelection?: boolean;
	selectedRowIds?: string[];
	selectedRows?: TData[];
	selectedCount?: number;
	defaultSelectedRowIds?: string[];
	onSelectionChange?: (rowIds: string[], rows: TData[]) => void;
	getRowCanSelect?: (row: TData) => boolean;
	rowActions?: (row: TData) => DataTableRowAction<TData>[];
	renderRowActions?: (row: TData) => ReactNode;
	actionsDisplay?: "menu" | "inline" | "none";
	actionsPlacement?: "end";
	actionsColumnWidth?: string | number;
	showActionsOnHover?: boolean;
	actionsAlwaysVisible?: boolean;
	bulkActions?: DataTableBulkAction<TData>[];
	renderBulkActions?: (selectedRows: TData[], rowIds: string[]) => ReactNode;
	selectedLabel?: ReactNode | ((count: number) => ReactNode);
	onRowClick?: (row: TData) => void;
	isRowExpanded?: (row: TData) => boolean;
	renderExpandedRow?: (row: TData) => ReactNode;
	sorting?: SortingState;
	onSortingChange?: (sorting: SortingState) => void;
	manualSorting?: boolean;
	showSortMenu?: boolean;
	pagination?: ReactNode;
	dir?: "ltr" | "rtl";
	tableProps?: ComponentPropsWithoutRef<"table">;
	containerProps?: ComponentPropsWithoutRef<"div">;
	mobileBreakpoint?: "md" | "lg";
	ariaLabel?: string;
	/** `{ [columnId]: false }` hides a column. Columns default to visible. */
	columnVisibility?: Record<string, boolean>;
};
