import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Isolates a left-to-right token (a number plus its Latin unit, a version, an
 * IP) from the surrounding bidirectional text. Without this, "23.5 GB" inside a
 * Persian sentence renders as "GB 23.5" with the unit on the wrong side.
 */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("tabular inline-block", className)}>
      {children}
    </span>
  )
}
