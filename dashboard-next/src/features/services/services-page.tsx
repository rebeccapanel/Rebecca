import { RefreshCw, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { matchesSearch } from "@/lib/search"

import { DataTable } from "@/components/data-table/data-table"
import { TablePagination } from "@/components/data-table/table-pagination"
import { SearchField } from "@/components/search-field"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useServices } from "@/features/services/api"
import { useServiceColumns } from "@/features/services/columns"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"

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
    <div>
      <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
        )}
      </div>
      {hint ? <p className="mt-1 text-[0.6875rem] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function ServicesPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const columns = useServiceColumns()
  const [params, setParams] = useSearchParams()

  const search = params.get("search") ?? ""
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0)
  const size = [20, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 20

  const [searchInput, setSearchInput] = useState(search)
  // The services endpoint has no match_mode parameters, so the toggles refine
  // the rows the server already returned for this page.
  const [matchOptions, setMatchOptions] = useState<{ matchCase: boolean; matchWholeWord: boolean }>({
    matchCase: false,
    matchWholeWord: false,
  })
  const [syncedSearch, setSyncedSearch] = useState(search)

  // Adjust the input during render when the URL changes from elsewhere.
  if (search !== syncedSearch) {
    setSyncedSearch(search)
    setSearchInput(search)
  }

  const update = (next: Record<string, string | null>, resetPage = true) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key)
      else merged.set(key, value)
    }
    if (resetPage) merged.delete("page")
    setParams(merged, { replace: true })
  }

  // Debounce typing into the URL, which drives the server query.
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => update({ search: searchInput || null }), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const query = useServices({ offset: page * size, limit: size, name: search })
  const data = query.data

  // Refine the loaded page with the search-field toggles (the endpoint has no
  // match options); the summary band reflects the same rows.
  const visibleServices = useMemo(() => {
    const rows = data?.services ?? []
    if (!search || (!matchOptions.matchCase && !matchOptions.matchWholeWord)) return rows
    return rows.filter((service) => matchesSearch(service.name, search, matchOptions))
  }, [data, search, matchOptions])

  const summary = useMemo(() => {
    const services = visibleServices
    return {
      total: data?.total ?? 0,
      broken: services.filter((service) => service.broken).length,
      users: services.reduce((sum, service) => sum + service.user_count, 0),
      traffic: services.reduce((sum, service) => sum + service.used_traffic, 0),
    }
  }, [data, visibleServices])

  const total = data?.total ?? 0
  const hasFilters = Boolean(search)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("next.nav.services")}
        description={t("next.page.services.desc")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin")} />
            {t("refresh")}
          </Button>
        }
      />

      {/* Summary band: totals plus the page-scoped figures the backend does not aggregate. */}
      <Card className="overflow-hidden">
        <CardContent className="grid gap-5 p-4 sm:grid-cols-2 md:grid-cols-4 md:items-center md:gap-0 md:divide-x md:divide-border">
          <div className="md:pe-6">
            <SummaryStat
              label={t("next.services.total")}
              value={format.number(summary.total)}
              loading={query.isPending}
            />
          </div>
          <div className="md:px-6">
            <SummaryStat
              label={t("services.broken")}
              value={format.number(summary.broken)}
              hint={t("next.stat.thisPage")}
              loading={query.isPending}
            />
          </div>
          <div className="md:px-6">
            <SummaryStat
              label={t("users")}
              value={format.number(summary.users)}
              hint={t("next.stat.thisPage")}
              loading={query.isPending}
            />
          </div>
          <div className="md:ps-6">
            <SummaryStat
              label={t("next.stat.traffic")}
              value={format.bytes(summary.traffic)}
              hint={t("next.stat.thisPage")}
              loading={query.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t("next.services.searchPlaceholder")}
            matchCase={matchOptions.matchCase}
            matchWholeWord={matchOptions.matchWholeWord}
            onMatchChange={(next) => setMatchOptions((current) => ({ ...current, ...next }))}
          />

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-[0.75rem] text-muted-foreground"
              onClick={() => {
                setSearchInput("")
                setParams({}, { replace: true })
              }}
            >
              <X className="size-3.5" />
              {t("next.users.clear")}
            </Button>
          ) : null}

          <span className="ms-auto text-[0.6875rem] text-muted-foreground tabular">
            {data ? t("next.users.showing", {
              from: format.number(total === 0 ? 0 : page * size + 1),
              to: format.number(Math.min(total, (page + 1) * size)),
              total: format.number(total),
            }) : null}
          </span>
        </div>

        <DataTable
          columns={columns}
          data={visibleServices}
          isLoading={query.isPending}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyTitle={t("next.services.emptyTitle")}
          emptyBody={t("next.services.emptyBody")}
          errorTitle={t("next.table.error")}
          getRowId={(row) => String(row.id)}
          skeletonRows={size > 20 ? 12 : 8}
        />

        <TablePagination
          page={page}
          pageSize={size}
          total={total}
          disabled={query.isFetching}
          onPageChange={(next) => update({ page: String(Math.max(0, next)) }, false)}
          onPageSizeChange={(next) => {
            const merged = new URLSearchParams(params)
            merged.set("size", String(next))
            merged.delete("page")
            setParams(merged, { replace: true })
          }}
        />
      </Card>
    </div>
  )
}
