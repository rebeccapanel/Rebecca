import { RefreshCw, ShieldAlert, SlidersHorizontal, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { DataTable } from "@/components/data-table/data-table"
import { SearchField } from "@/components/search-field"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { isForbidden, useNodes } from "@/features/nodes/api"
import {
  NODE_STATUS_FILTERS,
  nodeStatusLabelKey,
  useNodeColumns,
} from "@/features/nodes/columns"
import { matchesAny } from "@/lib/search"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"

/** One column of the summary band: uppercase label, headline value, quiet hint. */
function SummaryStat({
  label,
  value,
  hint,
  loading,
}: {
  label: string
  value: string
  hint?: string
  loading?: boolean
}) {
  return (
    <div className="min-w-0 md:px-5 md:first:ps-0 md:last:pe-0">
      <span className="text-[0.6875rem] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="mt-1.5">
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <span className="tabular text-2xl font-semibold tracking-tight">
            {value}
          </span>
        )}
      </div>
      {hint ? (
        <p className="tabular mt-1 truncate text-[0.6875rem] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Calm, informational replacement for the screen when the API answers 403. */
function PermissionNotice({ message }: { message: string }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
        <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <ShieldAlert className="size-4" />
        </div>
        <p className="max-w-sm text-[0.8125rem] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </CardContent>
    </Card>
  )
}

export function NodesPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const columns = useNodeColumns()
  const query = useNodes()

  const [search, setSearch] = useState("")
  const [matchOptions, setMatchOptions] = useState({ matchCase: false, matchWholeWord: false })
  const [status, setStatus] = useState("all")

  const nodes = useMemo(() => query.data ?? [], [query.data])
  const loading = query.isPending
  const failed = query.isError
  const forbidden = isForbidden(query.error)

  const total = nodes.length
  const connected = nodes.filter((node) => node.status === "connected").length
  const uploadSpeed = nodes.reduce(
    (sum, node) => sum + (node.upload_speed ?? 0),
    0
  )
  const downloadSpeed = nodes.reduce(
    (sum, node) => sum + (node.download_speed ?? 0),
    0
  )
  const uplink = nodes.reduce((sum, node) => sum + (node.uplink ?? 0), 0)
  const downlink = nodes.reduce((sum, node) => sum + (node.downlink ?? 0), 0)

  const filtered = useMemo(() => {
    return nodes.filter((node) => {
      if (status !== "all" && node.status !== status) return false
      return matchesAny([node.name, node.address], search, matchOptions)
    })
  }, [nodes, search, status, matchOptions])

  const hasFilters = search.trim().length > 0 || status !== "all"
  const empty = (value: string) => (failed ? "—" : value)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("next.nav.nodes")}
        description={t("next.page.nodes.desc")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={cn("size-3.5", query.isFetching && "animate-spin")}
            />
            {t("refresh")}
          </Button>
        }
      />

      {forbidden ? (
        <PermissionNotice message={t("nodes.noPermission")} />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardContent className="grid gap-5 p-4 sm:grid-cols-2 md:grid-cols-4 md:items-start md:gap-0 md:divide-x md:divide-border">
              <SummaryStat
                label={t("status.connected")}
                value={empty(format.number(connected))}
                hint={
                  failed
                    ? undefined
                    : `${format.percent(connected / Math.max(total, 1), 0)} ${t("next.common.of")} ${format.number(total)}`
                }
                loading={loading}
              />
              <SummaryStat
                label={t("nodes.bandwidthSpeed")}
                value={empty(`${format.bytes(uploadSpeed + downloadSpeed)}/s`)}
                hint={
                  failed
                    ? undefined
                    : `${format.bytes(uploadSpeed)} ↑ · ${format.bytes(downloadSpeed)} ↓`
                }
                loading={loading}
              />
              <SummaryStat
                label={t("next.nodes.columnTraffic")}
                value={empty(format.bytes(uplink + downlink))}
                hint={
                  failed
                    ? undefined
                    : `↑ ${format.bytes(uplink)} · ↓ ${format.bytes(downlink)}`
                }
                loading={loading}
              />
              <SummaryStat
                label={t("total")}
                value={empty(format.number(total))}
                hint={t("next.nav.nodes")}
                loading={loading}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder={t("next.nodes.searchPlaceholder")}
                matchCase={matchOptions.matchCase}
                matchWholeWord={matchOptions.matchWholeWord}
                onMatchChange={(next) => setMatchOptions((current) => ({ ...current, ...next }))}
              />

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-36 gap-1.5 text-[0.75rem]"
                >
                  <SlidersHorizontal className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder={t("next.users.allStatuses")} />
                </SelectTrigger>
                <SelectContent align="start">
                  <div className="px-2 pb-1 pt-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t("status")}</div>
                  <SelectItem value="all">
                    {t("next.users.allStatuses")}
                  </SelectItem>
                  {NODE_STATUS_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(nodeStatusLabelKey(value))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-[0.75rem] text-muted-foreground"
                  onClick={() => {
                    setSearch("")
                    setStatus("all")
                  }}
                >
                  <X className="size-3.5" />
                  {t("next.users.clear")}
                </Button>
              ) : null}

              {loading || failed ? null : (
                <span className="tabular ms-auto text-[0.6875rem] text-muted-foreground">
                  {format.number(filtered.length)} {t("next.common.of")}{" "}
                  {format.number(nodes.length)}
                </span>
              )}
            </div>

            <DataTable
              columns={columns}
              data={filtered}
              isLoading={loading}
              isError={failed}
              onRetry={() => query.refetch()}
              emptyTitle={t("next.nodes.emptyTitle")}
              emptyBody={t("next.nodes.emptyBody")}
              getRowId={(node) => String(node.id)}
            />
          </Card>
        </>
      )}
    </div>
  )
}
