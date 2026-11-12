import { SlidersHorizontal, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { Admin, Service } from "@/types/api"

const STATUS_FILTERS = ["active", "disabled", "limited", "expired", "on_hold"] as const

/** URL params that a chip can remove. */
export type UserFilterKey =
  | "search"
  | "status"
  | "admin"
  | "service"
  | "match_case"
  | "match_whole_word"

/** The three selects are committed together when the operator presses Apply. */
export type UserFilterDraft = {
  status: string
  admin: string
  service: string
}

type UsersFiltersProps = {
  draft: UserFilterDraft
  activeCount: number
  admins: Admin[]
  services: Service[]
  showAdmin: boolean
  showService: boolean
  onApply: (draft: UserFilterDraft) => void
  onClear: () => void
}

/**
 * Filter popover for the users table. The status control is intentionally a
 * single-select list and not toggles: the list handler reads `status` with
 * `q.Get("status")` (a single value), so repeated `status` params would be
 * silently collapsed to the first one. Match options apply immediately; the
 * selects wait for Apply so the table does not refetch on every tick.
 */
const STATUS_DOT: Record<string, string> = {
  active: "bg-success",
  disabled: "bg-muted-foreground/60",
  limited: "bg-warning",
  expired: "bg-destructive",
  on_hold: "bg-info",
}

export function UsersFilters({
  draft,
  activeCount,
  admins,
  services,
  showAdmin,
  showService,
  onApply,
  onClear,
}: UsersFiltersProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<UserFilterDraft>(draft)

  const handleOpenChange = (next: boolean) => {
    // Reopening re-seeds the draft from the URL, so an abandoned edit is dropped.
    if (next) setPending(draft)
    setOpen(next)
  }

  const setField = (field: keyof UserFilterDraft, value: string) => {
    setPending((current) => ({ ...current, [field]: value }))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <SlidersHorizontal className="size-3.5 text-muted-foreground" />
          {t("filters.advancedButton")}
          {activeCount > 0 ? (
            <Badge
              variant="secondary"
              className="h-4 min-w-4 justify-center rounded-full px-1 text-[0.625rem] tabular"
            >
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[21.5rem] gap-4" aria-label={t("filters.advancedTitle")}>
        <PopoverHeader>
          <PopoverTitle>{t("filters.advancedTitle")}</PopoverTitle>
        </PopoverHeader>

        <div className="space-y-2">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t("status")}
          </p>
          {/* Single-select by design — see the component comment above. */}
          <div role="group" aria-label={t("status")} className="grid grid-cols-2 gap-1.5">
            {[{ value: "", label: t("next.users.allStatuses") }, ...STATUS_FILTERS.map((value) => ({
              value,
              label: t(`status.${value}`),
            }))].map((option) => {
              const active = pending.status === option.value
              return (
                <button
                  key={option.value || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setField("status", option.value)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.75rem] transition-colors",
                    active
                      ? "border-primary/45 bg-primary/12 font-medium text-primary"
                      : "border-border bg-transparent text-foreground/80 hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      option.value ? STATUS_DOT[option.value] : "bg-muted-foreground/50",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {showAdmin ? (
          <div className="space-y-1.5">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t("filters.advanced.adminLabel")}
            </p>
            <Select
              value={pending.admin || "all"}
              onValueChange={(value) => setField("admin", value === "all" ? "" : value)}
              disabled={admins.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filters.advanced.adminAll")} />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">{t("filters.advanced.adminAll")}</SelectItem>
                {admins.map((admin) => (
                  <SelectItem key={admin.username} value={admin.username}>
                    {admin.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {showService ? (
          <div className="space-y-1.5">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t("filters.advanced.serviceLabel")}
            </p>
            <Select
              value={pending.service || "all"}
              onValueChange={(value) => setField("service", value === "all" ? "" : value)}
              disabled={services.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filters.advanced.serviceAll")} />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">{t("filters.advanced.serviceAll")}</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPending({ status: "", admin: "", service: "" })
              onClear()
              setOpen(false)
            }}
          >
            {t("filters.advancedClear")}
          </Button>
          <Button
            size="sm"
            className="min-w-20"
            onClick={() => {
              onApply(pending)
              setOpen(false)
            }}
          >
            {t("apply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type ActiveFilterChipsProps = {
  search: string
  status: string
  admin: string
  service: string
  serviceName: string | undefined
  onRemove: (key: UserFilterKey) => void
  onClearAll: () => void
}

/** One removable chip per active filter, read straight from the URL. */
export function ActiveFilterChips({
  search,
  status,
  admin,
  service,
  serviceName,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps) {
  const { t } = useTranslation()

  const chips: Array<{ key: UserFilterKey; label: string }> = []
  if (search) chips.push({ key: "search", label: `${t("search")}: ${search}` })
  if (status) chips.push({ key: "status", label: `${t("status")}: ${t(`status.${status}`)}` })
  if (admin) chips.push({ key: "admin", label: `${t("filters.advanced.adminLabel")}: ${admin}` })
  if (service) {
    chips.push({
      key: "service",
      label: t("filters.advanced.serviceTag", { name: serviceName ?? service }),
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-2">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="outline" className="h-6 gap-1 rounded-full ps-2.5 pe-1 font-normal">
          <span className="max-w-52 truncate text-[0.6875rem]">{chip.label}</span>
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            aria-label={`${t("clear")} ${chip.label}`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {chips.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          className="px-2 text-muted-foreground"
          onClick={onClearAll}
        >
          {t("filters.advancedClear")}
        </Button>
      ) : null}
    </div>
  )
}
