import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useFormat } from "@/lib/use-format"

type TablePaginationProps = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  disabled?: boolean
}

const PAGE_SIZES = [20, 50, 100]

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
}: TablePaginationProps) {
  const { t } = useTranslation()
  const format = useFormat()

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <p className="text-[0.75rem] text-muted-foreground tabular">
        {t("next.users.showing", {
          from: format.number(from),
          to: format.number(to),
          total: format.number(total),
        })}
      </p>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1.5 sm:flex">
          <span className="text-[0.75rem] text-muted-foreground">{t("next.users.rowsPerPage")}</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger size="sm" className="h-7 w-[4.5rem] text-[0.75rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="min-w-40">
              <div className="px-2 pb-1 pt-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t("next.users.rowsPerPage")}</div>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-[0.8125rem]">
                  {format.number(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-[0.75rem] text-muted-foreground tabular">
          {t("next.users.pageOf", { page: format.number(page + 1), count: format.number(pageCount) })}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || page === 0}
            aria-label={t("next.users.prev")}
          >
            <ChevronLeft className="size-3.5 rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || page + 1 >= pageCount}
            aria-label={t("next.users.next")}
          >
            <ChevronRight className="size-3.5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  )
}
