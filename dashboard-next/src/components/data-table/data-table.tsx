import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox, RefreshCw } from "lucide-react"
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"

import type { RowAction } from "@/components/data-table/types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** The selection column is declared at 32px but needs room for the checkbox. */
const SELECT_COLUMN_MIN_WIDTH = 36
const INLINE_ACTIONS_COLUMN_ID = "__inline_actions"
const INLINE_ACTIONS_COLUMN_WIDTH = 40

/**
 * `columnDef.size` is applied as both `width` and `minWidth` on the header and
 * body cells. Without the floor, long values squeeze a column until its content
 * overlaps the next one; with it, the wrapper scrolls horizontally instead.
 */
function columnWidthStyle<TData>(column: Column<TData, unknown>): CSSProperties {
  const size = column.columnDef.size ?? column.getSize()
  const width = column.id === "select" ? Math.max(size, SELECT_COLUMN_MIN_WIDTH) : size
  return { width, minWidth: width }
}

type RowContextMenu<TData> = {
  row: TData
  x: number
  y: number
}

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[]
  data: TData[] | undefined
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  emptyTitle: string
  emptyBody?: string
  errorTitle?: string
  skeletonRows?: number
  rowCount?: number
  className?: string
  /** Server-side sorting state, when the table sorts through the API. */
  sorting?: SortingState
  onSortingChange?: (updater: Updater<SortingState>) => void
  getRowId?: (row: TData) => string
  /** Opt-in row selection; `rowSelection` is keyed by the row id from `getRowId`. */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  enableRowSelection?: boolean
  /**
   * Controlled column visibility. Optional so tables that never expose a
   * visibility menu keep letting TanStack own (and hide) the state internally.
   */
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  /**
   * Hands the table instance to the caller, because a menu such as
   * `ViewOptions` has to read and toggle columns from outside the table shell.
   * The v8 instance is stable for the component's lifetime, so this runs once.
   *
   * Chosen over exposing `columnVisibility` only: `ViewOptions` takes the table
   * instance itself, so the instance is the smaller addition — while the
   * controlled visibility props above keep the caller's menu in sync.
   */
  onTableReady?: (table: TableInstance<TData>) => void
  /**
   * Custom content for the desktop row context menu. Called on right-click at
   * the pointer; the menu only opens when this returns a node or
   * `getRowActions` is provided.
   */
  onRowContextMenu?: (row: TData) => ReactNode | null
  /**
   * The row's actions, rendered in the context menu exactly like a 3-dot menu
   * would render them. Tables that already expose row actions should return
   * the same list from both places.
   */
  getRowActions?: (row: TData) => RowAction[]
  /**
   * When provided, an extra trailing, non-hideable, non-sortable column renders
   * its node per row. The table's own trailing actions column is left intact,
   * so a table can show both inline buttons and its 3-dot menu.
   */
  renderInlineActions?: (row: TData) => ReactNode
}

/**
 * Table shell shared by every list screen: skeleton, empty and error states are
 * handled once so each page only describes its columns.
 */
export function DataTable<TData>({
  columns,
  data,
  isLoading,
  isError,
  onRetry,
  emptyTitle,
  emptyBody,
  errorTitle,
  skeletonRows = 8,
  rowCount,
  className,
  sorting,
  onSortingChange,
  getRowId,
  rowSelection,
  onRowSelectionChange,
  enableRowSelection,
  columnVisibility,
  onColumnVisibilityChange,
  onTableReady,
  onRowContextMenu,
  getRowActions,
  renderInlineActions,
}: DataTableProps<TData>) {
  const { t } = useTranslation()
  const [contextMenu, setContextMenu] = useState<RowContextMenu<TData> | null>(null)

  // The optional inline-actions column is synthesized here so pages only pass a
  // renderer. It is appended, keeps no accessor, and is excluded from
  // `ViewOptions` by its accessor filter.
  const tableColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!renderInlineActions) return columns
    return [
      ...columns,
      {
        id: INLINE_ACTIONS_COLUMN_ID,
        header: "",
        size: INLINE_ACTIONS_COLUMN_WIDTH,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {renderInlineActions(row.original)}
          </div>
        ),
      },
    ]
  }, [columns, renderInlineActions])

  // Only include the state slices the caller actually controls, so a table that
  // never opts into row selection keeps its previous uncontrolled behaviour.
  const tableState: {
    sorting?: SortingState
    rowSelection?: RowSelectionState
    columnVisibility?: VisibilityState
  } = {}
  if (sorting) tableState.sorting = sorting
  if (rowSelection) tableState.rowSelection = rowSelection
  if (columnVisibility) tableState.columnVisibility = columnVisibility
  // TanStack Table v8 owns mutable table state internally; the React Compiler
  // cannot model that, so this hook legitimately opts out of memoisation.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data ?? [],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    // Server-sorted tables own the sort state; everything else sorts client-side.
    manualSorting: Boolean(onSortingChange),
    getSortedRowModel: onSortingChange ? undefined : getSortedRowModel(),
    onSortingChange,
    enableRowSelection: enableRowSelection ?? Boolean(onRowSelectionChange),
    onRowSelectionChange,
    onColumnVisibilityChange,
    state: Object.keys(tableState).length > 0 ? tableState : undefined,
  })

  // The instance is stable, so the caller learns about the table exactly once.
  useEffect(() => {
    onTableReady?.(table)
  }, [onTableReady, table])

  const rowActions = contextMenu && getRowActions ? getRowActions(contextMenu.row) : []
  const customRowMenu =
    contextMenu && onRowContextMenu ? onRowContextMenu(contextMenu.row) : null

  /** Right-click opens the row menu at the pointer; left click stays untouched. */
  const openRowContextMenu = (event: MouseEvent<HTMLTableRowElement>, row: TData) => {
    if (!onRowContextMenu && !getRowActions) return
    event.preventDefault()
    setContextMenu({ row, x: event.clientX, y: event.clientY })
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
          <RefreshCw className="size-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{errorTitle ?? t("next.table.error")}</p>
          <p className="text-xs text-muted-foreground">{t("next.table.retry")}</p>
        </div>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("next.table.retry")}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn(
      // This wrapper is the only scroll box; shadcn's inner table container must not
      // become a second one, or `position: sticky` on the header would resolve to it.
      "relative max-h-[min(56svh,42rem)] w-full overflow-auto [&>[data-slot=table-container]]:overflow-visible",
      className,
    )}>
      <span role="status" aria-live="polite" className="sr-only">
        {isLoading ? t("next.table.loading") : `${rowCount ?? table.getRowModel().rows.length}`}
      </span>
      <Table aria-busy={isLoading ? true : undefined}>
        <TableHeader className="bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-b border-border hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                    style={columnWidthStyle(header.column)}
                    className={cn(
                      // Sticky belongs on the cell: a sticky <thead> is unreliable in Chrome.
                      "sticky top-0 z-10 h-8 border-b border-border bg-card text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground",
                      canSort && "select-none",
                    )}
                  >
                    {header.isPlaceholder ? null : canSort &&
                      typeof header.column.columnDef.header === "string" ? (
                      // Plain string headers keep the lightweight inline sort toggle.
                      // A header that renders a component (e.g. ColumnHeader) owns its
                      // own sort affordance, so wrapping it would nest buttons.
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="-ms-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: skeletonRows }).map((_, index) => (
              <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                {table.getVisibleLeafColumns().map((column, columnIndex) => (
                  <TableCell
                    key={`skeleton-cell-${column.id}`}
                    style={columnWidthStyle(column)}
                    className="py-2"
                  >
                    <Skeleton className={cn("h-4 rounded-sm", columnIndex === 0 ? "w-32" : "w-16")} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={table.getVisibleLeafColumns().length} className="py-0">
                <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-14 text-center">
                  <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="size-4" />
                  </div>
                  <p className="text-sm font-medium">{emptyTitle}</p>
                  {emptyBody ? (
                    <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{emptyBody}</p>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className="group/row border-b border-border/70 transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/[0.06]"
                onContextMenu={(event) => openRowContextMenu(event, row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={columnWidthStyle(cell.column)}
                    className="py-2 align-middle"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {/* Right-click menu: a 1px virtual anchor at the pointer, so Radix's
          collision handling keeps the menu inside the viewport in both LTR and
          RTL, closes it on Escape/outside click, and returns focus to the page. */}
      {contextMenu !== null ? (
        <DropdownMenu
          open
          modal={false}
          onOpenChange={(open) => {
            if (!open) setContextMenu(null)
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed z-50 size-px"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={2}
            collisionPadding={8}
            className="min-w-44"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {rowActions.map((action) => {
              const Icon = action.icon
              return (
                <Fragment key={action.id}>
                  {action.separatorBefore ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    variant={action.destructive ? "destructive" : "default"}
                    disabled={action.disabled}
                    onSelect={() => action.onSelect()}
                  >
                    {Icon ? <Icon aria-hidden="true" /> : null}
                    {action.label}
                  </DropdownMenuItem>
                </Fragment>
              )
            })}
            {customRowMenu ? (
              <>
                {rowActions.length > 0 ? <DropdownMenuSeparator /> : null}
                {customRowMenu}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {typeof rowCount === "number" && !isLoading && !isError ? (
        <span className="sr-only">{rowCount}</span>
      ) : null}
    </div>
  )
}
