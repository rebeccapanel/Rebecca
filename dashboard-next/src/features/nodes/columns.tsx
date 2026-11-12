import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, Info } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { NodeRowActions } from "@/features/nodes/nodes-row-actions"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"
import type { Node } from "@/types/api"

/** Wire status → tone; "none"/unknown falls back to muted. */
const STATUS_STYLE: Record<string, string> = {
  connected: "border-success/30 bg-success/10 text-success",
  connecting: "border-info/30 bg-info/10 text-info",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  disabled: "border-border bg-muted/60 text-muted-foreground",
  limited: "border-warning/35 bg-warning/10 text-warning",
}

const STATUS_DOT: Record<string, string> = {
  connected: "bg-success",
  connecting: "bg-info",
  error: "bg-destructive",
  disabled: "bg-muted-foreground/60",
  limited: "bg-warning",
}

/** Values offered by the toolbar's status filter. */
export const NODE_STATUS_FILTERS = [
  "connected",
  "connecting",
  "error",
  "disabled",
  "limited",
] as const

/** Wire status → translation key; shared with the toolbar filter. */
export function nodeStatusLabelKey(status: string): string {
  switch (status) {
    case "connected":
      return "status.connected"
    case "connecting":
      return "nodeModal.status.connecting"
    case "error":
      return "nodeModal.status.error"
    case "disabled":
      return "status.disabled"
    case "limited":
      return "status.limited"
    default:
      return "status.unknown"
  }
}

function NodeStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border px-2 py-0.5 text-[0.6875rem] font-medium",
        STATUS_STYLE[status] ??
          "border-border bg-muted/60 text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          STATUS_DOT[status] ?? "bg-muted-foreground/60"
        )}
      />
      {t(nodeStatusLabelKey(status))}
    </Badge>
  )
}

export function useNodeColumns(): ColumnDef<Node, unknown>[] {
  const { t } = useTranslation()
  const format = useFormat()

  return useMemo<ColumnDef<Node, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("next.nodes.columnNode"),
        size: 280,
        cell: ({ row }) => {
          const node = row.original
          return (
            <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[0.8125rem] font-medium">
                  {node.name}
                </span>
                {node.note ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("nodes.note")}
                        className="shrink-0 rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <Info className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      {node.note}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </span>
              <span
                dir="ltr"
                className="tabular truncate text-start text-[0.6875rem] text-muted-foreground"
              >
                {node.address}:{format.number(node.port)}
              </span>
            </div>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("next.nodes.columnStatus"),
        size: 120,
        cell: ({ row }) => <NodeStatusBadge status={row.original.status} />,
      },
      {
        id: "xray_version",
        accessorKey: "xray_version",
        header: t("next.nodes.columnVersion"),
        size: 120,
        cell: ({ row }) => (
          <span
            dir="ltr"
            className="block truncate text-start font-mono text-[0.75rem] text-muted-foreground"
          >
            {row.original.xray_version ?? "—"}
          </span>
        ),
      },
      {
        id: "cpu_usage_percent",
        accessorKey: "cpu_usage_percent",
        header: t("next.overview.cpu"),
        size: 140,
        cell: ({ row }) => {
          const percent = Math.min(
            100,
            Math.max(0, row.original.cpu_usage_percent)
          )
          // Colour the fill through the indicator's own slot, like UsageMeter does.
          const tone =
            percent >= 85
              ? "[&>[data-slot=progress-indicator]]:bg-destructive"
              : percent >= 65
                ? "[&>[data-slot=progress-indicator]]:bg-warning"
                : "[&>[data-slot=progress-indicator]]:bg-primary"
          return (
            <div className="flex w-full max-w-[8.5rem] flex-col gap-1.5">
              <span className="tabular text-[0.8125rem] font-medium">
                {format.percent(percent / 100, 1)}
              </span>
              <Progress
                value={percent}
                className={cn("h-1.5 bg-muted", tone)}
              />
            </div>
          )
        },
      },
      {
        id: "memory_usage_percent",
        accessorKey: "memory_usage_percent",
        header: t("next.overview.memory"),
        size: 170,
        cell: ({ row }) => {
          const node = row.original
          return (
            <div className="flex w-full max-w-[10rem] flex-col gap-0.5 leading-tight">
              <span className="tabular text-[0.8125rem]">
                {format.bytes(node.memory_used)}
                <span className="text-muted-foreground">
                  {" "}
                  / {format.bytes(node.memory_total)}
                </span>
              </span>
              <span className="tabular text-[0.6875rem] text-muted-foreground">
                {format.percent(node.memory_usage_percent / 100, 0)}
              </span>
            </div>
          )
        },
      },
      {
        id: "uptime_seconds",
        accessorKey: "uptime_seconds",
        header: t("next.overview.uptime"),
        size: 110,
        cell: ({ row }) => (
          <span className="tabular text-[0.75rem] text-muted-foreground">
            {format.duration(row.original.uptime_seconds)}
          </span>
        ),
      },
      {
        id: "traffic",
        accessorFn: (node) => node.uplink + node.downlink,
        header: t("next.nodes.columnTraffic"),
        size: 170,
        cell: ({ row }) => {
          const node = row.original
          return (
            <div className="flex flex-col gap-0.5 leading-tight">
              <span className="tabular text-[0.8125rem] font-medium">
                {format.bytes(node.uplink + node.downlink)}
              </span>
              <span className="tabular flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <span className="inline-flex items-center gap-0.5">
                  <ArrowUp className="size-3" />
                  {format.bytes(node.uplink)}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <ArrowDown className="size-3" />
                  {format.bytes(node.downlink)}
                </span>
              </span>
            </div>
          )
        },
      },
      {
        id: "actions",
        header: "",
        size: 44,
        enableSorting: false,
        cell: ({ row }) => <NodeRowActions node={row.original} />,
      },
    ],
    [t, format]
  )
}
