import type {
  OnChangeFn,
  RowSelectionState,
  SortingState,
  Table,
  VisibilityState,
} from "@tanstack/react-table"
import { Download, Link2, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Num } from "@/components/num"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SearchField } from "@/components/search-field"
import { DataTable } from "@/components/data-table/data-table"
import { TablePagination } from "@/components/data-table/table-pagination"
import { ViewOptions } from "@/components/data-table/view-options"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  useBulkUsersAction,
  useResetUsersUsage,
  useUserAdminOptions,
  useUserServiceOptions,
  useUsers,
  type BulkUsersAction,
} from "@/features/users/api"
import { BulkActionBar } from "@/features/users/bulk-action-bar"
import { UserEditDialog, type UserEditTarget } from "@/features/users/user-edit-dialog"
import { useDeleteUser, useResetUserUsage, useSetUserStatus } from "@/features/users/api"
import { useUserColumns } from "@/features/users/columns"
import { downloadUsersCsv } from "@/features/users/export-csv"
import {
  ActiveFilterChips,
  UsersFilters,
  type UserFilterDraft,
  type UserFilterKey,
} from "@/features/users/users-filters"
import { useCurrentAdmin } from "@/features/auth/api"
import { ApiError, errorMessage } from "@/lib/api"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"
import type { Admin, UserListItem } from "@/types/api"

const SORTABLE = new Set(["username", "used_traffic", "expire", "created_at"])
const STATUS_VALUES = new Set(["active", "disabled", "limited", "expired", "on_hold"])

function canViewAdmins(admin: Admin | null): boolean {
  if (!admin) return false
  if (admin.role === "full_access") return true
  const permissions = admin.permissions as
    | { admin_management?: { can_view?: boolean } }
    | undefined
  return permissions?.admin_management?.can_view === true
}

const BREAKDOWN_ORDER = ["active", "expired", "limited", "on_hold", "disabled"] as const
const BREAKDOWN_TONE: Record<string, string> = {
  active: "bg-success",
  expired: "bg-destructive",
  limited: "bg-warning",
  on_hold: "bg-info",
  disabled: "bg-muted-foreground/45",
}

export function UsersPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const [editTarget, setEditTarget] = useState<UserEditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null)
  const removeUser = useDeleteUser()
  const resetUsage = useResetUserUsage()
  const setStatus = useSetUserStatus()
  // Stable callbacks: the column factory memoises on them, and a new identity
  // per render would rebuild the columns (and remount every row).
  const handleEdit = useCallback(
    (user: UserListItem) => setEditTarget({ username: user.username, mode: "edit" }),
    [],
  )
  const handleDelete = useCallback((user: UserListItem) => setDeleteTarget(user), [])
  const columns = useUserColumns({ onEdit: handleEdit, onDelete: handleDelete })
  const [params, setParams] = useSearchParams()
  const currentAdmin = useCurrentAdmin()

  // The URL is the single source of truth for filters so a view is shareable:
  // `service` maps to the API's `service_id`, and the match options are stored
  // as `1` or absent. Selection is separate component state and never in the URL.
  const search = params.get("search") ?? ""
  const statusParam = params.get("status") ?? ""
  const status = STATUS_VALUES.has(statusParam) ? statusParam : ""
  const admin = params.get("admin") ?? ""
  const serviceParam = params.get("service") ?? ""
  const serviceNumber = Number(serviceParam)
  const service =
    serviceParam && Number.isInteger(serviceNumber) && serviceNumber > 0 ? serviceParam : ""
  const matchCase = params.get("match_case") === "1"
  const matchWholeWord = params.get("match_whole_word") === "1"
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0)
  const size = [20, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 20
  const sortParam = params.get("sort")

  const [searchInput, setSearchInput] = useState(search)
  const [syncedSearch, setSyncedSearch] = useState(search)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // The users page needs the table instance itself to render `ViewOptions`, so
  // DataTable hands it over once it exists. Visibility stays controlled here so
  // toggling a column re-renders the menu that opened it.
  const [table, setTable] = useState<Table<UserListItem> | null>(null)
  // The row actions must stay reachable without horizontal scrolling, so the two
  // least operational columns start hidden. Both are one click away in Columns.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ created_at: false, admin: false })

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

  // When the URL changes from elsewhere (the header search box), adopt it during
  // render — React's supported alternative to a synchronising effect.
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

  const sessionReady = Boolean(currentAdmin)
  const canFilterByAdmin = canViewAdmins(currentAdmin)
  const adminsQuery = useUserAdminOptions(sessionReady && canFilterByAdmin)
  const servicesQuery = useUserServiceOptions(sessionReady)
  const serviceOptions = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])
  const servicesForbidden =
    servicesQuery.error instanceof ApiError && servicesQuery.error.status === 403
  const showAdmin = canFilterByAdmin && !adminsQuery.isError
  const showService = !servicesForbidden

  const query = useUsers({
    offset: page * size,
    limit: size,
    search,
    status,
    sort: sortParam,
    admin: admin ? [admin] : undefined,
    serviceId: service ? serviceNumber : undefined,
    matchCase,
    matchWholeWord,
  })
  const data = query.data
  const rows = useMemo(() => data?.users ?? [], [data])

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
    status,
    admin,
    service,
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

  const selectedUsernames = useMemo(
    () =>
      rows
        .filter((user) => rowSelection[String(user.id)])
        .map((user) => user.username),
    [rows, rowSelection],
  )

  const bulkUsers = useBulkUsersAction()
  const resetUsers = useResetUsersUsage()
  const bulkPending = bulkUsers.isPending || resetUsers.isPending

  const runBulk = (action: BulkUsersAction) => {
    if (selectedUsernames.length === 0) return
    const usernames = [...selectedUsernames]
    bulkUsers.mutate(
      { action, usernames },
      {
        onSuccess: (result) => {
          toast.success(t("usersTable.bulkActionCount", { count: result?.count ?? usernames.length }))
          setRowSelection({})
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    )
  }

  const runBulkReset = () => {
    if (selectedUsernames.length === 0) return
    const usernames = [...selectedUsernames]
    resetUsers.mutate(usernames, {
      onSuccess: () => {
        toast.success(t("usersTable.bulkActionCount", { count: usernames.length }))
        setRowSelection({})
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  }

  const activeFilterCount =
    (status ? 1 : 0) + (admin ? 1 : 0) + (service ? 1 : 0) + (matchCase ? 1 : 0) + (matchWholeWord ? 1 : 0)
  const filterDraft: UserFilterDraft = { status, admin, service }

  const applyFilters = (draft: UserFilterDraft) => {
    update({ status: draft.status || null, admin: draft.admin || null, service: draft.service || null })
  }

  const onMatchChange = (key: "match_case" | "match_whole_word", value: boolean) => {
    update({ [key]: value ? "1" : null })
  }

  const removeFilter = (key: UserFilterKey) => {
    if (key === "search") setSearchInput("")
    update({ [key]: null })
  }

  const clearAllFilters = () => {
    setSearchInput("")
    update({
      search: null,
      status: null,
      admin: null,
      service: null,
      match_case: null,
      match_whole_word: null,
    })
  }

  const serviceName = useMemo(
    () => serviceOptions.find((option) => String(option.id) === service)?.name,
    [serviceOptions, service],
  )

  const breakdown = data?.status_breakdown ?? {}
  const total = data?.total ?? 0
  const breakdownTotal = BREAKDOWN_ORDER.reduce((sum, key) => sum + (breakdown[key] ?? 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("next.nav.users")}
        description={t("next.page.users.desc")}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setEditTarget({ username: "", mode: "create" })}
            >
              <Plus className="size-3.5" />
              {t("createUser")}
            </Button>
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
          </>
        }
      />

      {/* Summary band: totals, status distribution and traffic in one dense card. */}
      <Card className="overflow-hidden">
        <CardContent className="grid gap-5 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,13rem)] md:items-stretch md:divide-x md:divide-border">
          {/* Total, against the admin's user cap when the panel reports one. */}
          <div className="flex flex-col justify-between md:pe-6">
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {t("next.stat.total")}
            </span>
            <div>
              <div className="flex items-baseline gap-2">
                {query.isPending ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular">
                    {format.number(total)}
                  </span>
                )}
                {data?.users_limit ? (
                  <span className="text-[0.75rem] text-muted-foreground tabular">
                    / {format.number(data.users_limit)}
                  </span>
                ) : null}
              </div>
              {data?.users_limit ? (
                <div className="mt-2 space-y-1">
                  <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.min(100, (total / data.users_limit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[0.625rem] text-muted-foreground tabular">
                    {t("next.band.ofLimit", {
                      percent: format.number(Math.round((total / data.users_limit) * 100)),
                      limit: format.number(data.users_limit),
                    })}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[0.625rem] text-muted-foreground">
                  {t("next.band.users")}
                </p>
              )}
            </div>
          </div>

          {/* Live state: online now and active, each against the filtered set. */}
          <div className="flex flex-col justify-between gap-3 md:px-6">
            {[
              { key: "next.stat.online", value: data?.online_total ?? 0, tone: "bg-primary" },
              { key: "next.stat.active", value: breakdown.active ?? 0, tone: "bg-success" },
            ].map((row) => (
              <div key={row.key}>
                <div className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", row.tone)} />
                  <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {t(row.key)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-semibold leading-none tabular">{format.number(row.value)}</span>
                  <span className="text-[0.625rem] text-muted-foreground tabular">
                    {t("next.band.percentOfTotal", {
                      percent: format.number(Math.round((row.value / Math.max(breakdownTotal, 1)) * 100)),
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Distribution across statuses. */}
          <div className="flex flex-col justify-center md:px-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {t("usersStatusBreakdown")}
              </span>
              <span className="text-[0.6875rem] text-muted-foreground tabular">
                {format.number(breakdownTotal)}
              </span>
            </div>
            {query.isPending ? (
              <Skeleton className="h-1.5 w-full rounded-full" />
            ) : (
              <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted">
                {BREAKDOWN_ORDER.map((key) => {
                  const count = breakdown[key] ?? 0
                  if (!count) return null
                  return (
                    <span
                      key={key}
                      className={cn("h-full first:rounded-s-full last:rounded-e-full", BREAKDOWN_TONE[key])}
                      style={{ width: `${(count / Math.max(breakdownTotal, 1)) * 100}%` }}
                      title={`${t(`status.${key}`)}: ${count}`}
                    />
                  )
                })}
              </div>
            )}
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
              {BREAKDOWN_ORDER.map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", BREAKDOWN_TONE[key])} />
                  {t(`status.${key}`)}
                  <span className="ms-auto font-medium text-foreground tabular">
                    {format.number(breakdown[key] ?? 0)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Traffic: total plus the per-user average. */}
          <div className="flex flex-col justify-between md:ps-6">
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {t("next.stat.traffic")}
            </span>
            <div>
              {query.isPending ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <Num className="text-[1.75rem] font-semibold leading-none tracking-tight">
                  {format.bytes(data?.usage_total ?? 0)}
                </Num>
              )}
              <p className="mt-2 text-[0.625rem] text-muted-foreground">
                {t("next.band.avgTraffic", {
                  value: format.bytes(
                    (data?.usage_total ?? 0) / Math.max(1, data?.total ?? 1),
                  ),
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t("next.users.searchPlaceholder")}
            matchCase={matchCase}
            matchWholeWord={matchWholeWord}
            loading={query.isFetching && !query.isPending}
            onMatchChange={(next) => {
              if (next.matchCase !== undefined) onMatchChange("match_case", next.matchCase)
              if (next.matchWholeWord !== undefined) onMatchChange("match_whole_word", next.matchWholeWord)
            }}
          />

          <UsersFilters
            draft={filterDraft}
            activeCount={activeFilterCount}
            admins={adminsQuery.data ?? []}
            services={serviceOptions}
            showAdmin={showAdmin}
            showService={showService}
            onApply={applyFilters}
            onClear={clearAllFilters}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                disabled={rows.length === 0}
                onClick={() => downloadUsersCsv(rows, `users-page-${page + 1}.csv`)}
              >
                <Download className="size-3.5" />
                {t("next.users.exportCsv")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("next.users.exportCsvHint", { count: rows.length })}
            </TooltipContent>
          </Tooltip>

          {table ? (
            <ViewOptions
              table={table}
              labels={{
                title: t("next.users.toggleColumns"),
                toggle: t("next.users.toggleColumns"),
              }}
            />
          ) : null}
        </div>

        <ActiveFilterChips
          search={search}
          status={status}
          admin={admin}
          service={service}
          serviceName={serviceName}
          onRemove={removeFilter}
          onClearAll={clearAllFilters}
        />

        <BulkActionBar
          count={selectedUsernames.length}
          isPending={bulkPending}
          onClear={() => setRowSelection({})}
          onResetUsage={runBulkReset}
          onActivate={() => runBulk("activate_users")}
          onDisable={() => runBulk("disable_users")}
          onDelete={() => runBulk("delete_users")}
        />

        <DataTable
          columns={columns}
          data={data?.users}
          isLoading={query.isPending}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyTitle={t("next.users.emptyTitle")}
          emptyBody={t("next.users.emptyBody")}
          errorTitle={t("next.users.errorTitle")}
          sorting={sorting}
          onSortingChange={onSortingChange}
          getRowId={(row) => String(row.id)}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          enableRowSelection
          getRowActions={(user) => [
            {
              id: "copy",
              label: t("next.users.copySubscription"),
              icon: Link2,
              onSelect: () => {
                void navigator.clipboard
                  .writeText(user.subscription_url)
                  .then(() => toast.success(t("next.toast.copied")))
                  .catch(() => toast.error(t("next.toast.copyFailed")))
              },
            },
            {
              id: "edit",
              label: t("userDialog.editUser"),
              icon: Pencil,
              separatorBefore: true,
              onSelect: () => setEditTarget({ username: user.username, mode: "edit" }),
            },
            {
              id: "reset",
              label: t("next.users.resetUsage"),
              icon: RotateCcw,
              onSelect: () => {
                void resetUsage
                  .mutateAsync(user.username)
                  .then(() => toast.success(`${t("next.actions.done")} · ${t("next.users.resetUsage")}`))
                  .catch((error) => toast.error(errorMessage(error)))
              },
            },
            {
              id: "status",
              label: user.status === "disabled" ? t("next.users.enable") : t("next.users.disable"),
              onSelect: () => {
                void setStatus
                  .mutateAsync({
                    username: user.username,
                    status: user.status === "disabled" ? "active" : "disabled",
                  })
                  .catch((error) => toast.error(errorMessage(error)))
              },
            },
            {
              id: "delete",
              label: t("next.users.delete"),
              icon: Trash2,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleteTarget(user),
            },
          ]}
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

      <UserEditDialog
        target={editTarget}
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("next.actions.deleteUser")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("next.actions.confirmDelete", { name: deleteTarget?.username ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  removeUser.mutate(deleteTarget.username, {
                    onSuccess: () => toast.success(`${t("next.actions.done")} · ${t("next.users.delete")}`),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
                setDeleteTarget(null)
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
