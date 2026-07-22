import type { SortingState } from "@tanstack/react-table";
import { Td, Th, type BoxProps, type TableProps } from "@chakra-ui/react";
import type { ReactElement, ReactNode } from "react";
import type { ComponentProps } from "react";

export type DataTableColumnAlign = "start" | "center" | "end";
export type DataTableColumnSize =
	| string
	| number
	| Partial<Record<"base" | "sm" | "md" | "lg" | "xl", string | number>>;

export type DataTableColumn<TData> = {
	id: string;
	header: ReactNode;
	accessor?: keyof TData | ((row: TData) => unknown);
	cell?: (row: TData) => ReactNode;
	mobileDetailCell?: (row: TData) => ReactNode;
	sortValue?: (row: TData) => unknown;
	sortable?: boolean;
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
	isPrimary?: boolean;
	isMeta?: boolean;
	meta?: Record<string, unknown>;
	headerProps?: ComponentProps<typeof Th>;
	cellProps?: ComponentProps<typeof Td>;
};

export type DataTableRowAction<TData> = {
	id: string;
	label: ReactNode;
	icon?: ReactElement;
	onClick?: (row: TData) => void;
	render?: (row: TData, onClose: () => void) => ReactNode;
	isDisabled?: boolean | ((row: TData) => boolean);
	isDanger?: boolean;
	color?: string;
};

export type DataTableBulkAction<TData> = {
	id: string;
	label: ReactNode;
	icon?: ReactElement;
	onClick?: (rows: TData[], rowIds: string[]) => void;
	isDisabled?: boolean | ((rows: TData[], rowIds: string[]) => boolean);
	isLoading?: boolean;
	isDanger?: boolean;
	variant?: string;
};

export type DataTableProps<TData> = {
	data: TData[];
	columns: DataTableColumn<TData>[];
	getRowId: (row: TData, index: number) => string;
	isLoading?: boolean;
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
	sorting?: SortingState;
	onSortingChange?: (sorting: SortingState) => void;
	manualSorting?: boolean;
	pagination?: ReactNode;
	dir?: "ltr" | "rtl";
	tableProps?: TableProps;
	containerProps?: BoxProps;
	mobileBreakpoint?: "md" | "lg";
	ariaLabel?: string;
};
