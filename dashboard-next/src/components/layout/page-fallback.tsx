import { Skeleton } from "@/components/ui/skeleton"

/** Shown for the moment a route chunk is fetched. */
export function PageFallback() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-[104px] w-full rounded-xl" />
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  )
}
