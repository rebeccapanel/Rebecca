import type {
  OnChangeFn,
  RowSelectionState,
  SortingState,
  Table,
  VisibilityState,
} from "@tanstack/react-table"
import { RefreshCw, ShieldAlert } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table/data-table"
import { TablePagination } from "@/components/data-table/table-pagination"
import { ViewOptions } from "@/components/data-table/view-options"
import { PageHeader } from "@/components/layout/page-header"
import { SearchField } from "@/components/search-field"
import { AdminsBulkActionBar } from "@/features/admins/admins-bulk-action-bar"
import {
  AdminFilterChips,
  AdminsFilters,
  type AdminFilterDraft,
  type AdminFilterKey,
} from "@/features/admins/admins-filters"
import {
  isAdminsForbidden,
  useAdmins,
  useBulkDeleteAdmins,
  useBulkSetAdminStatus,
} from "@/features/admins/api"
import { useAdminColumns } from "@/features/admins/columns"
import { useCurrentAdmin } from "@/features/auth/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"
import type { Admin } from "@/types/api"

const ROLE_VALUES = new Set(["standard", "reseller", "sudo", "full_access"])
const STATUS_VALUES = new Set(["active", "disabled", "expired", "limited"])
// The endpoint sorts server-side; `username` is not in its whitelist.
const SORTABLE = new Set(["role", "status", "users_count", "users_usage", "expire"])

/**
 * The locale files carry no bulk-admin strings and this task may not add keys,
 * so the bulk toasts use English literals.
 */
function bulkCountMessage(count: number, verb: "enabled" | "disabled" | "deleted"): string {
  return `${count} ${count === 1 ? "admin" : "admins"} ${verb}`
}
const SELF_SKIP_DESCRIPTION = "Your own account was skipped."

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

/** Friendly state for admins without permission to view the admin list (403). */
function NoPermissionState() {
  const { t } = useTranslation()
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-2.5 px-6 py-16 text-center">
        <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <ShieldAlert className="size-4" />
        </div>
        <p className="text-sm font-medium">{t("admins.noPermission")}</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{t("next.admins.emptyBody")}</p>
      </CardContent>
    </Card>
  )
}

export function AdminsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const columns = useAdminColumns()
  const [params, setParams] = useSearchParams()
  const currentAdmin = useCurrentAdmin()

  const search = params.get("search") ?? ""
  const matchCase = params.get("match_case") === "1"
  const matchWholeWord = params.get("match_whole_word") === "1"
  // Ignore unrecognized URL values instead of sending them to the API, which
  // answers 400 for an invalid role or status.
  const roleParam = params.get("role") ?? ""
  const role = ROLE_VALUES.has(roleParam) ? roleParam : ""
  const statusParam = params.get("status") ?? ""
  const status = STATUS_VALUES.has(statusParam) ? statusParam : ""
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0)
  const size = [20, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 20
  const sortParam = params.get("sort")

  const [searchInput, setSearchInput] = useState(search)
  const [syncedSearch, setSyncedSearch] = useState(search)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // The page needs the table instance itself to render `ViewOptions`, so
  // DataTable hands it over once it exists. Visibility stays controlled here so
  // toggling a column re-renders the menu that opened it.
  const [table, setTable] = useState<Table<Admin> | null>(null)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // Visibility is owned here, but the menu renders above `DataTable` — the only
  // component that feeds new options to the instance — so a plain state update
  // would leave the open menu reading the previous visibility for one render.
  // Syncing the instance in the same handler keeps both views in lockstep.
  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnVisibility) : updater
    table?.setOptions((previous) => ({
      ...previous,
      state: { ...previous.state, columnVisibility: next },
    }))
    setColumnVisibility(next)
  }

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

  const query = useAdmins({
    offset: page * size,
    limit: size,
    username: search,
    role,
    status,
    sort: sortParam,
  })
  const data = query.data
  const rows = useMemo(() => data?.admins ?? [], [data])
  const forbidden = isAdminsForbidden(query.error)

  const sorting = useMemo<SortingState>(() => {
    if (!sortParam) return []
    const desc = sortParam.startsWith("-")
    const id = desc ? sortParam.slice(1) : sortParam
    return SORTABLE.has(id) ? [{ id, desc }] : []
  }, [sortParam])

  const onSortingChange = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof updater === "function" ? updater(sorting) : updater
    const first = next[0]
    update({ sort: first ? `${first.desc ? "-" : ""}${first.id}` : null })
  }

  // Selection is page-local: every query change drops it, and a page change is
  // part of the signature, so a selection can never leak across pages. The
  // signature is tracked as state and adjusted during render — the same React
  // pattern used above for the search box — instead of in an effect.
  const selectionSignature = [
    search,
    role,
    status,
    matchCase,
    matchWholeWord,
    page,
    size,
    sortParam ?? "",
  ].join("\u241f")
  const [syncedSelectionSignature, setSyncedSelectionSignature] = useState(selectionSignature)
  if (selectionSignature !== syncedSelectionSignature) {
    setSyncedSelectionSignature(selectionSignature)
    setRowSelection({})
  }

  const selectedAdmins = useMemo(
    () => rows.filter((admin) => rowSelection[String(admin.id)]),
    [rows, rowSelection],
  )
  const selfUsername = currentAdmin?.username ?? null

  const bulkStatus = useBulkSetAdminStatus()
  const bulkDelete = useBulkDeleteAdmins()
  const bulkPending = bulkStatus.isPending || bulkDelete.isPending

  const clearSelection = () => setRowSelection({})

  const runBulkStatus = (nextStatus: "active" | "disabled") => {
    const usernames = selectedAdmins.map((admin) => admin.username).slice(0, size)
    if (usernames.length === 0) return
    bulkStatus.mutate(
      { usernames, status: nextStatus },
      {
        onSuccess: () => {
          toast.success(
            bulkCountMessage(usernames.length, nextStatus === "active" ? "enabled" : "disabled"),
          )
          clearSelection()
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    )
  }

  const runBulkDelete = () => {
    // Never include the signed-in admin in a delete loop, and say so when the
    // selection had to drop that row.
    const usernames = selectedAdmins
      .filter((admin) => admin.username !== selfUsername)
      .map((admin) => admin.username)
      .slice(0, size)
    const skippedSelf = selectedAdmins.some((admin) => admin.username === selfUsername)
    if (usernames.length === 0) {
      toast.error(SELF_SKIP_DESCRIPTION)
      return
    }
    bulkDelete.mutate(usernames, {
      onSuccess: () => {
        const message = bulkCountMessage(usernames.length, "deleted")
        if (skippedSelf) toast.success(message, { description: SELF_SKIP_DESCRIPTION })
        else toast.success(message)
        clearSelection()
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  }

  const summary = useMemo(
    () => ({
      total: data?.total ?? 0,
      fullAccess: rows.filter((admin) => admin.role === "full_access").length,
      sudo: rows.filter((admin) => admin.role === "sudo").length,
      traffic: rows.reduce((sum, admin) => sum + admin.users_usage, 0),
    }),
    [data, rows],
  )

  const activeFilterCount =
    (role ? 1 : 0) + (status ? 1 : 0) + (matchCase ? 1 : 0) + (matchWholeWord ? 1 : 0)
  const filterDraft: AdminFilterDraft = { role, status }

  const applyFilters = (draft: AdminFilterDraft) => {
    update({ role: draft.role || null, status: draft.status || null })
  }

  const removeFilter = (key: AdminFilterKey) => {
    if (key === "search") setSearchInput("")
    update({ [key]: null })
  }

  const clearAllFilters = () => {
    setSearchInput("")
    update({ search: null, role: null, status: null, match_case: null, match_whole_word: null })
  }

  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("next.nav.admins")}
        description={t("next.page.admins.desc")}
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

      {forbidden ? (
        <NoPermissionState />
      ) : (
        <>
          {/* Summary band: totals plus role/traffic figures for the current page. */}
          <Card className="overflow-hidden">
            <CardContent className="grid gap-5 p-4 sm:grid-cols-2 md:grid-cols-4 md:items-center md:gap-0 md:divide-x md:divide-border">
              <div className="md:pe-6">
                <SummaryStat
                  label={t("next.admins.total")}
                  value={format.number(summary.total)}
                  loading={query.isPending}
                />
              </div>
              <div className="md:px-6">
                <SummaryStat
                  label={t("next.role.full_access")}
                  value={format.number(summary.fullAccess)}
                  hint={t("next.stat.thisPage")}
                  loading={query.isPending}
                />
              </div>
              <div className="md:px-6">
                <SummaryStat
                  label={t("next.role.sudo")}
                  value={format.number(summary.sudo)}
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
                placeholder={t("next.admins.searchPlaceholder")}
                matchCase={matchCase}
                matchWholeWord={matchWholeWord}
                loading={query.isFetching && !query.isPending}
                onMatchChange={(next) => {
                  if (next.matchCase !== undefined) update({ match_case: next.matchCase ? "1" : null })
                  if (next.matchWholeWord !== undefined)
                    update({ match_whole_word: next.matchWholeWord ? "1" : null })
                }}
              />

              <AdminsFilters
                draft={filterDraft}
                activeCount={activeFilterCount}
                onApply={applyFilters}
                onClear={clearAllFilters}
              />

              {table ? (
                <ViewOptions
                  table={table}
                  labels={{
                    title: t("next.users.toggleColumns"),
                    toggle: t("next.users.toggleColumns"),
                  }}
                />
              ) : null}

              <span className="ms-auto text-[0.6875rem] text-muted-foreground tabular">
                {data ? t("next.users.showing", {
                  from: format.number(total === 0 ? 0 : page * size + 1),
                  to: format.number(Math.min(total, (page + 1) * size)),
                  total: format.number(total),
                }) : null}
              </span>
            </div>

            <AdminFilterChips
              search={search}
              role={role}
              status={status}
              onRemove={removeFilter}
              onClearAll={clearAllFilters}
            />

            <AdminsBulkActionBar
              count={selectedAdmins.length}
              isPending={bulkPending}
              onClear={clearSelection}
              onEnable={() => runBulkStatus("active")}
              onDisable={() => runBulkStatus("disabled")}
              onDelete={runBulkDelete}
            />

            <DataTable
              columns={columns}
              data={data?.admins}
              isLoading={query.isPending}
              isError={query.isError}
              onRetry={() => query.refetch()}
              emptyTitle={t("next.admins.emptyTitle")}
              emptyBody={t("next.admins.emptyBody")}
              errorTitle={t("next.table.error")}
              sorting={sorting}
              onSortingChange={onSortingChange}
              getRowId={(row) => String(row.id)}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              enableRowSelection
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={onColumnVisibilityChange}
              onTableReady={setTable}
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
        </>
      )}
    </div>
  )
}
