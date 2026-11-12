import { useTranslation } from "react-i18next"

import { Num } from "@/components/num"
import { Progress } from "@/components/ui/progress"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"

type UsageMeterProps = {
  used: number
  limit: number | null
  className?: string
}

/**
 * Traffic cell: absolute usage on top, a fill bar underneath. The bar turns
 * amber near the cap and red at it, which is the one number an operator scans
 * first.
 */
export function UsageMeter({ used, limit, className }: UsageMeterProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const ratio = format.ratio(used, limit)
  // Colour the fill through the indicator's own slot, so the wrapper keeps the track.
  const tone =
    ratio === null
      ? "[&>[data-slot=progress-indicator]]:bg-primary/60"
      : ratio >= 1
        ? "[&>[data-slot=progress-indicator]]:bg-destructive"
        : ratio >= 0.85
          ? "[&>[data-slot=progress-indicator]]:bg-warning"
          : "[&>[data-slot=progress-indicator]]:bg-primary"

  return (
    <div className={cn("w-full max-w-[11rem] space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 leading-none">
        <Num className="text-[0.8125rem] font-medium">{format.bytes(used)}</Num>
        <span className="text-[0.6875rem] text-muted-foreground">
          {limit === null ? t("unlimited") : <Num>{format.bytes(limit)}</Num>}
        </span>
      </div>
      {ratio === null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-linear-to-r from-primary/25 via-primary/10 to-transparent" />
      ) : (
        <Progress
          value={ratio * 100}
          className={cn("h-1.5 bg-foreground/10", tone)}
        />
      )}
    </div>
  )
}
