import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { UserStatus } from "@/types/api"

const STATUS_STYLE: Record<string, string> = {
  active: "border-success/30 bg-success/10 text-success",
  connected: "border-success/30 bg-success/10 text-success",
  connecting: "border-info/30 bg-info/10 text-info",
  disabled: "border-border bg-muted/60 text-muted-foreground",
  expired: "border-destructive/30 bg-destructive/10 text-destructive",
  limited: "border-warning/35 bg-warning/10 text-warning",
  on_hold: "border-info/30 bg-info/10 text-info",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

const DOT_STYLE: Record<string, string> = {
  active: "bg-success",
  connected: "bg-success",
  connecting: "bg-info",
  disabled: "bg-muted-foreground/60",
  expired: "bg-destructive",
  limited: "bg-warning",
  on_hold: "bg-info",
  error: "bg-destructive",
}

function labelKey(status: string): string {
  switch (status) {
    case "active":
    case "connected":
    case "connecting":
      return "status.active"
    case "disabled":
      return "status.disabled"
    case "expired":
      return "status.expired"
    case "limited":
      return "status.limited"
    case "on_hold":
      return "status.on_hold"
    default:
      return "status.unknown"
  }
}

export function UserStatusBadge({ status, className }: { status: UserStatus | string; className?: string }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border px-2 py-0.5 text-[0.6875rem] font-medium",
        STATUS_STYLE[status] ?? "border-border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT_STYLE[status] ?? "bg-muted-foreground/60")} />
      {t(labelKey(status))}
    </Badge>
  )
}
