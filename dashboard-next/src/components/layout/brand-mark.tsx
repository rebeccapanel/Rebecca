import { cn } from "@/lib/utils"

/**
 * The panel's own mark (a stylised bird) from the legacy dashboard's favicon
 * set. It is a raster asset, so it is served from `public/brand` instead of
 * being inlined into the bundle; the dark theme inverts it so the black bird
 * stays legible on the sidebar.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/rebecca-mark.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        "size-8 shrink-0 rounded-[0.55rem] object-contain p-0.5 ring-1 ring-inset ring-border/60 dark:invert",
        className,
      )}
    />
  )
}
