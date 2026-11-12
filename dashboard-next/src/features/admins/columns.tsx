import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { ColumnHeader } from "@/components/data-table/column-header"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { AdminsRowActions } from "@/features/admins/admins-row-actions"
import { UsageMeter } from "@/features/users/usage-meter"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"
import type { Admin, AdminRole, AdminStatus } from "@/types/api"

const ROLE_STYLE: Record<string, string> = {
  full_access: "border-primary/35 bg-primary/10 text-primary",
  sudo: "border-info/35 bg-info/10 text-info",
  reseller: "border-warning/35 bg-warning/10 text-warning",
  standard: "border-border bg-muted/60 text-muted-foreground",
}

const STATUS_STYLE: Record<string, string> = {
  active: "border-success/30 bg-success/10 text-success",
  disabled: "border-border bg-muted/60 text-muted-foreground",
  deleted: "border-destructive/30 bg-destructive/10 text-destructive",
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-success",
  disabled: "bg-muted-foreground/60",
  deleted: "bg-destructive",
}

function initials(username: string): string {
  const clean = username.replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  if (!clean) return "?"
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function AdminRoleBadge({ role }: { role: AdminRole }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className={cn(
        "border px-2 py-0.5 text-[0.6875rem] font-medium",
        ROLE_STYLE[role] ?? "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      {t(`next.role.${role}`, { defaultValue: role })}
    </Badge>
  )
}

function AdminStatusBadge({ status }: { status: AdminStatus }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border px-2 py-0.5 text-[0.6875rem] font-medium",
        STATUS_STYLE[status] ?? "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-muted-foreground/60")} />
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  )
}

export function useAdminColumns(): ColumnDef<Admin, unknown>[] {
  const { t } = useTranslation()
  const format = useFormat()

  return useMemo<ColumnDef<Admin, unknown>[]>(
    () => [
      // Selection lives in TanStack Table's `rowSelection` state, owned by the
      // page. The header toggles every row currently loaded (this page's rows
      // only — the table never holds more than the server page).
      {
        id: "select",
        size: 36,
        enableSorting: false,
        enableHiding: false,
        meta: { label: t("next.users.selectColumn", { defaultValue: "Select" }) },
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
            aria-label={t("next.users.selectAll")}
            className="ms-0.5"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            aria-label={t("next.users.selectRow", { username: row.original.username })}
            className="ms-0.5"
          />
        ),
      },
      {
        id: "username",
        accessorKey: "username",
        header: t("next.admins.columnAdmin"),
        meta: { label: t("next.admins.columnAdmin") },
        size: 300,
        // `username` is not in the endpoint's sort whitelist.
        enableSorting: false,
        cell: ({ row }) => {
          const admin = row.original
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted/50 text-[0.6875rem] font-semibold uppercase text-muted-foreground">
                {initials(admin.username)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[0.8125rem] font-medium leading-tight">{admin.username}</span>
                <span className="truncate text-[0.6875rem] leading-tight text-muted-foreground tabular">
                  #{format.number(admin.id)}
                  {admin.created_by ? (
                    <>
                      <span className="mx-1 opacity-50">·</span>
                      {t("usersTable.by")} {admin.created_by}
                    </>
                  ) : null}
                </span>
              </span>
            </div>
          )
        },
      },
      {
        id: "role",
        accessorKey: "role",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.admins.columnRole")} />
        ),
        meta: { label: t("next.admins.columnRole") },
        size: 130,
        cell: ({ row }) => <AdminRoleBadge role={row.original.role} />,
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("status")} />
        ),
        meta: { label: t("status") },
        size: 120,
        cell: ({ row }) => <AdminStatusBadge status={row.original.status} />,
      },
      {
        id: "users_count",
        accessorKey: "users_count",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.admins.columnUsers")} />
        ),
        meta: { label: t("next.admins.columnUsers") },
        size: 130,
        cell: ({ row }) => {
          const admin = row.original
          return (
            <span className="inline-flex items-baseline gap-1 text-[0.8125rem] font-medium tabular">
              {format.number(admin.users_count ?? 0)}
              {admin.users_limit !== null ? (
                <span className="text-[0.6875rem] font-normal text-muted-foreground">
                  / {format.number(admin.users_limit)}
                </span>
              ) : null}
            </span>
          )
        },
      },
      {
        id: "users_usage",
        accessorKey: "users_usage",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("next.admins.columnTraffic")} />
        ),
        meta: { label: t("next.admins.columnTraffic") },
        size: 200,
        cell: ({ row }) => (
          <UsageMeter used={row.original.users_usage} limit={row.original.data_limit} />
        ),
      },
      {
        id: "expire",
        accessorKey: "expire",
        header: ({ column }) => (
          <ColumnHeader column={column} title={t("expire")} />
        ),
        meta: { label: t("expire") },
        size: 140,
        cell: ({ row }) => (
          <span className="text-[0.8125rem] tabular">
            {format.expiry(row.original.expire, t("unlimited"))}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        header: "",
        meta: { label: t("actions") },
        size: 44,
        enableSorting: false,
        cell: ({ row }) => <AdminsRowActions admin={row.original} />,
      },
    ],
    [t, format],
  )
}
