import type { LucideIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type KpiCardProps = {
  label: string
  value: string
  hint?: string
  icon: LucideIcon
  tone: string
  loading?: boolean
}

/**
 * One number an operator scans: label, value, a hint and a thin share bar that
 * keeps six cards comparable at a glance without six donut charts.
 */
export function KpiCard({ label, value, hint, icon: Icon, tone, loading }: KpiCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border/80 hover:bg-card/80">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("size-3.5 shrink-0", tone)} strokeWidth={2} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span className="text-[1.375rem] font-semibold leading-none tracking-tight tabular">{value}</span>
        )}
      </div>
      {hint ? <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground tabular">{hint}</p> : null}
    </div>
  )
}

type ResourceCardProps = {
  label: string
  value: string
  detail?: string
  percent: number
  /** Pre-formatted percentage, so digits follow the active locale. */
  percentLabel: string
  footerLeft?: string
  footerRight?: string
  loading?: boolean
}

/** CPU / memory / swap / disk tile with a meter and average-peak footer. */
export function ResourceCard({
  label,
  value,
  detail,
  percent,
  percentLabel,
  footerLeft,
  footerRight,
  loading,
}: ResourceCardProps) {
  const tone = percent >= 90 ? "bg-destructive" : percent >= 75 ? "bg-warning" : "bg-primary"
  const textTone = percent >= 90 ? "text-destructive" : percent >= 75 ? "text-warning" : "text-foreground"

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <span className={cn("text-[0.6875rem] font-medium tabular", textTone)}>{percentLabel}</span>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        {loading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <span className={cn("text-lg font-semibold leading-none tracking-tight", textTone)}>{value}</span>
        )}
        {detail ? <span className="truncate text-[0.6875rem] text-muted-foreground">{detail}</span> : null}
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>

      {footerLeft || footerRight ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-[0.625rem] text-muted-foreground">
          <span className="truncate">{footerLeft}</span>
          <span className="truncate text-end">{footerRight}</span>
        </div>
      ) : null}
    </div>
  )
}
