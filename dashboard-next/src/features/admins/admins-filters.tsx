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
import { cn } from "@/lib/utils"

const ROLE_FILTERS = ["standard", "reseller", "sudo", "full_access"] as const
const STATUS_FILTERS = ["active", "disabled", "expired", "limited"] as const

/** URL params a chip can remove. */
export type AdminFilterKey = "search" | "role" | "status"

/** Role and status are committed together when the operator presses Apply. */
export type AdminFilterDraft = {
  role: string
  status: string
}

const ROLE_DOT: Record<string, string> = {
  full_access: "bg-primary",
  sudo: "bg-info",
  reseller: "bg-warning",
  standard: "bg-muted-foreground/60",
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-success",
  disabled: "bg-muted-foreground/60",
  expired: "bg-destructive",
  limited: "bg-warning",
}

/**
 * Filter popover for the admins table. Mirrors the users table's control: role
 * and status are single-select pill lists (the list handler reads `role` and
 * `status` with `q.Get`, so repeated params would collapse to the first one),
 * and both are committed together on Apply so the table does not refetch on
 * every tick.
 */
export function AdminsFilters({
  draft,
  activeCount,
  onApply,
  onClear,
}: {
  draft: AdminFilterDraft
  activeCount: number
  onApply: (draft: AdminFilterDraft) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<AdminFilterDraft>(draft)

  const handleOpenChange = (next: boolean) => {
    // Reopening re-seeds the draft from the URL, so an abandoned edit is dropped.
    if (next) setPending(draft)
    setOpen(next)
  }

  const setField = (field: keyof AdminFilterDraft, value: string) => {
    setPending((current) => ({ ...current, [field]: value }))
  }

  const roleOptions = [
    { value: "", label: t("next.admins.allRoles") },
    ...ROLE_FILTERS.map((value) => ({ value, label: t(`next.role.${value}`) })),
  ]
  const statusOptions = [
    { value: "", label: t("next.users.allStatuses") },
    ...STATUS_FILTERS.map((value) => ({ value, label: t(`status.${value}`) })),
  ]

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
            {t("next.admins.columnRole")}
          </p>
          <div
            role="group"
            aria-label={t("next.admins.columnRole")}
            className="grid grid-cols-2 gap-1.5"
          >
            {roleOptions.map((option) => {
              const active = pending.role === option.value
              return (
                <button
                  key={option.value || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setField("role", option.value)}
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
                      option.value ? ROLE_DOT[option.value] : "bg-muted-foreground/50",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t("status")}
          </p>
          <div role="group" aria-label={t("status")} className="grid grid-cols-2 gap-1.5">
            {statusOptions.map((option) => {
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

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPending({ role: "", status: "" })
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

/** One removable chip per active filter, read straight from the URL. */
export function AdminFilterChips({
  search,
  role,
  status,
  onRemove,
  onClearAll,
}: {
  search: string
  role: string
  status: string
  onRemove: (key: AdminFilterKey) => void
  onClearAll: () => void
}) {
  const { t } = useTranslation()

  const chips: Array<{ key: AdminFilterKey; label: string }> = []
  if (search) chips.push({ key: "search", label: `${t("search")}: ${search}` })
  if (role) {
    chips.push({
      key: "role",
      label: `${t("next.admins.columnRole")}: ${t(`next.role.${role}`, { defaultValue: role })}`,
    })
  }
  if (status) chips.push({ key: "status", label: `${t("status")}: ${t(`status.${status}`)}` })

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
        <Button variant="ghost" size="sm" className="px-2 text-muted-foreground" onClick={onClearAll}>
          {t("filters.advancedClear")}
        </Button>
      ) : null}
    </div>
  )
}
