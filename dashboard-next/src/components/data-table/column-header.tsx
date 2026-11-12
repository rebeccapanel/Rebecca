import type { Column } from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  EyeOff,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * Presentational header for a table column.
 *
 * A column that cannot sort renders its plain title. A sortable column renders
 * a ghost button that toggles the sort plus a second, icon-only button that
 * opens the ascending / descending / hide menu. The caller's `TableHead` owns
 * `aria-sort`, so this component stays presentational; the interactive elements
 * get accessible names that spell out the column title instead.
 *
 * RTL: every offset is logical (`ms-*`, `-ms-*`), and the sort arrows are
 * deliberately never mirrored — "ascending" is the up arrow in both directions.
 */
export function ColumnHeader<TData, TValue>({
  column,
  title,
}: {
  column: Column<TData, TValue>
  title: string
}) {
  const { t } = useTranslation()
  const sorted = column.getIsSorted()

  if (!column.getCanSort()) {
    return <span className="truncate">{title}</span>
  }

  const ascending = t("next.table.sortAscending", { defaultValue: "Ascending" })
  const descending = t("next.table.sortDescending", { defaultValue: "Descending" })
  const sortBy = t("next.table.sortBy", {
    column: title,
    defaultValue: "Sort by {{column}}",
  })
  const sortOptions = t("dataTable.sortOptions", { defaultValue: "Sort options" })

  return (
    <div className="flex min-w-0 items-center">
      <Button
        variant="ghost"
        size="xs"
        className={cn(
          "-ms-1.5 min-w-0 justify-start gap-1 px-1.5 text-[0.6875rem] font-medium",
          "text-muted-foreground hover:text-foreground",
        )}
        onClick={column.getToggleSortingHandler()}
        aria-label={sortBy}
      >
        <span className="truncate">{title}</span>
        <span className="shrink-0" aria-hidden="true">
          {sorted === "asc" ? (
            <ArrowUp className="size-3" />
          ) : sorted === "desc" ? (
            <ArrowDown className="size-3" />
          ) : (
            <ChevronsUpDown className="size-3 opacity-40" />
          )}
        </span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`${title} — ${sortOptions}`}
          >
            <ChevronDown className="size-3" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
            <ArrowUp className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
            {ascending}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
            <ArrowDown className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
            {descending}
          </DropdownMenuItem>
          {column.getCanHide() ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
                <EyeOff className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
                {t("hide", { defaultValue: "Hide" })}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
