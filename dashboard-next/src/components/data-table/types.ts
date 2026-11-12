import type { RowData } from "@tanstack/react-table"
import type { LucideIcon } from "lucide-react"

/**
 * One entry in a row's action menu. Both the 3-dot button inside a table's
 * actions column and `DataTable`'s right-click menu render from this shape, so
 * a table only has to describe its row actions once.
 */
export type RowAction = {
  id: string
  label: string
  icon?: LucideIcon
  destructive?: boolean
  disabled?: boolean
  /** Draw a separator above this entry, to group destructive actions. */
  separatorBefore?: boolean
  onSelect: () => void
}

declare module "@tanstack/react-table" {
  // The unused type parameters are required to merge with TanStack's declaration.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human-readable column name, used by the column visibility menu. */
    label?: string
  }
}
