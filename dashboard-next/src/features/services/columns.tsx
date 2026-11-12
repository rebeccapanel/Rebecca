import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { ColumnHeader } from "@/components/data-table/column-header"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ServiceRowActions } from "@/features/services/services-row-actions"
import { useFormat } from "@/lib/use-format"
import type { Service } from "@/types/api"

/*
 * Cells are components so they resolve the locale formatters themselves. That
 * keeps the column definitions referentially stable across renders (only `t`
 * changes, i.e. on a language switch) — an unstable `columns` array makes the
 * table remount its rows on every render, which tears down row-level hooks such
 * as the mutation observers used by the actions menu.
 */

function NameCell({ service }: { service: Service }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="max-w-[20rem] truncate text-[0.8125rem] font-medium">{service.name}</span>
      {service.description ? (
        <span className="max-w-[20rem] truncate text-[0.6875rem] text-muted-foreground" title={service.description}>
          {service.description}
        </span>
      ) : null}
    </div>
  )
}

function HostsCell({ service }: { service: Service }) {
  const { t } = useTranslation()
  const format = useFormat()

  if (service.host_count === 0) {
    return (
      <Badge
        variant="outline"
        className="border-warning/35 bg-warning/10 px-2 py-0.5 text-[0.6875rem] font-medium text-warning"
      >
        {t("services.broken")}
      </Badge>
    )
  }
  return <span className="text-[0.8125rem] font-medium tabular">{format.number(service.host_count)}</span>
}

function UsersCell({ service }: { service: Service }) {
  const format = useFormat()
  return <span className="text-[0.8125rem] font-medium tabular">{format.number(service.user_count)}</span>
}

function UsageCell({ service }: { service: Service }) {
  const format = useFormat()
  const used = service.used_traffic
  const lifetime = service.lifetime_used_traffic
  const ratio = format.ratio(used, lifetime)

  return (
    <div className="flex w-full max-w-[11rem] flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 leading-none">
        <span className="text-[0.8125rem] font-medium tabular">{format.bytes(used)}</span>
        {lifetime > 0 ? (
          <span className="text-[0.6875rem] text-muted-foreground tabular">{format.bytes(lifetime)}</span>
        ) : null}
      </div>
      {ratio !== null ? <Progress value={ratio * 100} className="h-1.5 bg-muted" /> : null}
    </div>
  )
}

function CoefficientCell({ service }: { service: Service }) {
  const format = useFormat()
  const coefficient = service.usage_coefficient

  if (coefficient === 1) {
    return <span className="text-[0.75rem] text-muted-foreground">—</span>
  }
  return (
    <span className="inline-flex items-baseline gap-0.5 text-[0.75rem] font-medium tabular">
      <span className="text-muted-foreground">×</span>
      {format.number(coefficient, { maximumFractionDigits: 2 })}
    </span>
  )
}

export function useServiceColumns(): ColumnDef<Service, unknown>[] {
  const { t } = useTranslation()

  return useMemo<ColumnDef<Service, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.services.columnService")} />
        ),
        size: 340,
        // Services have a fixed server-side order (`created_at DESC, id DESC`).
        enableSorting: false,
        cell: ({ row }) => <NameCell service={row.original} />,
      },
      {
        id: "host_count",
        accessorKey: "host_count",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.services.columnHosts")} />
        ),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => <HostsCell service={row.original} />,
      },
      {
        id: "user_count",
        accessorKey: "user_count",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.services.columnUsers")} />
        ),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => <UsersCell service={row.original} />,
      },
      {
        id: "used_traffic",
        accessorKey: "used_traffic",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.services.columnUsage")} />
        ),
        size: 200,
        enableSorting: false,
        cell: ({ row }) => <UsageCell service={row.original} />,
      },
      {
        id: "usage_coefficient",
        accessorKey: "usage_coefficient",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.services.columnCoefficient")} />
        ),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => <CoefficientCell service={row.original} />,
      },
      {
        id: "actions",
        header: "",
        size: 44,
        enableSorting: false,
        cell: ({ row }) => <ServiceRowActions service={row.original} />,
      },
    ],
    [t],
  )
}
