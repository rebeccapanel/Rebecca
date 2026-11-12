import type { Table } from "@tanstack/react-table"
import { Columns3 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// `ColumnMeta.label` is declared once in `./types`, which `DataTable` imports, so
// the augmentation is part of every compilation that consumes these tables.
type ViewOptionsLabels = {
  /** Heading of the dropdown. */
  title: string
  /** Accessible name of the icon-only trigger. */
  toggle: string
}

/**
 * Column visibility menu for a TanStack table instance.
 *
 * `table` is passed in because the menu has to read and mutate the table's
 * column state; pages that do not own the instance get it through
 * `DataTable`'s `onTableReady` callback. Only data columns are listed, so
 * selection and actions columns never leak into the menu. Labels come from
 * `columnDef.meta.label` when a page translates them, and fall back to the
 * column id otherwise.
 */
export function ViewOptions<TData>({
  table,
  labels,
}: {
  table: Table<TData>
  labels?: ViewOptionsLabels
}) {
  const { t } = useTranslation()
  const title =
    labels?.title ??
    t("next.table.toggleColumns", { defaultValue: "Toggle columns" })
  const toggle = labels?.toggle ?? title

  const columns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== "undefined")

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={toggle}>
          <Columns3 className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            disabled={!column.getCanHide()}
            // Keep the menu open while the user toggles several columns.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
          >
            {column.columnDef.meta?.label ?? column.id}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
