import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { HostRowActions } from "@/features/hosts/hosts-row-actions"
import { cn } from "@/lib/utils"
import type { Host } from "@/types/api"

/** One flattened row: the inbound tag owns the host, so both form the identity. */
export type HostRow = { inboundTag: string; host: Host }

const SECURITY_STYLE: Record<string, string> = {
  tls: "border-info/30 bg-info/10 text-info",
  reality: "border-success/30 bg-success/10 text-success",
  none: "border-border bg-muted/60 text-muted-foreground",
}

function HostSecurityBadge({ security }: { security: string }) {
  const value = security.trim().toLowerCase()
  if (!value)
    return <span className="text-[0.75rem] text-muted-foreground">—</span>
  return (
    <Badge
      variant="outline"
      className={cn(
        "border px-2 py-0.5 text-[0.6875rem] font-medium uppercase",
        SECURITY_STYLE[value] ?? "border-warning/35 bg-warning/10 text-warning"
      )}
    >
      {value}
    </Badge>
  )
}

function HostStatusBadge({ isDisabled }: { isDisabled: boolean }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border px-2 py-0.5 text-[0.6875rem] font-medium",
        isDisabled
          ? "border-border bg-muted/60 text-muted-foreground"
          : "border-success/30 bg-success/10 text-success"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isDisabled ? "bg-muted-foreground/60" : "bg-success"
        )}
      />
      {isDisabled ? t("status.disabled") : t("hostsPage.enabled")}
    </Badge>
  )
}

export function useHostColumns(): ColumnDef<HostRow, unknown>[] {
  const { t } = useTranslation()

  return useMemo<ColumnDef<HostRow, unknown>[]>(
    () => [
      {
        id: "inbound",
        accessorFn: (row) => row.inboundTag,
        header: t("inbound"),
        size: 150,
        cell: ({ row }) => (
          <span
            title={row.original.inboundTag}
            dir="ltr"
            className="block truncate text-start font-mono text-[0.75rem] text-muted-foreground"
          >
            {row.original.inboundTag}
          </span>
        ),
      },
      {
        id: "remark",
        accessorFn: (row) => row.host.remark,
        header: t("next.hosts.columnRemark"),
        size: 220,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
            <span className="truncate text-[0.8125rem] font-medium">
              {row.original.host.remark}
            </span>
            <span
              dir="ltr"
              className="tabular truncate text-start text-[0.6875rem] text-muted-foreground"
            >
              {row.original.host.address}
            </span>
          </div>
        ),
      },
      {
        id: "endpoint",
        accessorFn: (row) => {
          const hostname = row.host.host ?? row.host.address
          return row.host.port ? `${hostname}:${row.host.port}` : hostname
        },
        header: t("next.hosts.columnAddress"),
        size: 220,
        cell: ({ row }) => {
          const host = row.original.host
          const hostname = host.host ?? host.address
          const endpoint = host.port ? `${hostname}:${host.port}` : hostname
          return (
            <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
              <span
                dir="ltr"
                className="tabular truncate text-start text-[0.8125rem]"
              >
                {endpoint}
              </span>
              {host.path ? (
                <span
                  dir="ltr"
                  className="truncate text-start font-mono text-[0.6875rem] text-muted-foreground"
                >
                  {host.path}
                </span>
              ) : null}
            </div>
          )
        },
      },
      {
        id: "security",
        accessorFn: (row) => row.host.security,
        header: t("security"),
        size: 110,
        cell: ({ row }) => (
          <HostSecurityBadge security={row.original.host.security} />
        ),
      },
      {
        id: "sni",
        accessorFn: (row) => row.host.sni ?? "",
        header: t("hostsDialog.sni"),
        size: 170,
        cell: ({ row }) => {
          const sni = row.original.host.sni
          if (!sni)
            return (
              <span className="text-[0.75rem] text-muted-foreground">—</span>
            )
          return (
            <span
              dir="ltr"
              className="tabular block truncate text-start text-[0.75rem]"
            >
              {sni}
            </span>
          )
        },
      },
      {
        id: "status",
        accessorFn: (row) => (row.host.is_disabled ? "disabled" : "enabled"),
        header: t("next.hosts.columnStatus"),
        size: 110,
        cell: ({ row }) => (
          <HostStatusBadge isDisabled={row.original.host.is_disabled} />
        ),
      },
      {
        id: "actions",
        header: "",
        size: 44,
        enableSorting: false,
        cell: ({ row }) => <HostRowActions host={row.original.host} />,
      },
    ],
    [t]
  )
}
