import { Ban, CircleCheck, Copy, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeleteAdmin, useResetAdminUsage, useSetAdminStatus } from "@/features/admins/api"
import { useCurrentAdmin } from "@/features/auth/api"
import { errorMessage } from "@/lib/api"
import type { Admin } from "@/types/api"

export function AdminsRowActions({ admin }: { admin: Admin }) {
  const { t } = useTranslation()
  const currentAdmin = useCurrentAdmin()
  const reset = useResetAdminUsage()
  const setStatus = useSetAdminStatus()
  const remove = useDeleteAdmin()

  const [confirmDelete, setConfirmDelete] = useState(false)

  const disabled = admin.status === "disabled"
  const isSelf = currentAdmin !== null && currentAdmin.username === admin.username
  // The server rejects deleting a full-access admin for non-global callers and
  // self-deletion for everyone; hide the item instead of offering a 403.
  const canDelete =
    !isSelf && !(admin.role === "full_access" && currentAdmin?.role !== "full_access")

  const doneToast = (label: string) => toast.success(`${t("next.actions.done")} · ${label}`)
  const errorToast = (error: unknown) => toast.error(errorMessage(error))

  // Per-call `mutate` callbacks live on the observer, which React Query drops
  // when the owning cell unmounts. Awaiting `mutateAsync` keeps the toast tied
  // to the request instead of the mounted row, so it survives table refreshes.
  const run = (action: Promise<unknown>, label: string) => {
    void action.then(() => doneToast(label), errorToast)
  }

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(admin.username)
      toast.success(t("next.toast.copied"))
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  const resetUsage = () => {
    run(reset.mutateAsync(admin.username), t("next.actions.resetUsage"))
  }

  const toggleStatus = () => {
    const status = disabled ? "active" : "disabled"
    const label = disabled ? t("next.actions.enable") : t("next.actions.disable")
    run(setStatus.mutateAsync({ username: admin.username, status }), label)
  }

  const deleteAdmin = () => {
    run(remove.mutateAsync(admin.username), t("next.actions.deleteAdmin"))
  }

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground opacity-60 transition-opacity group-hover/row:opacity-100 data-[state=open]:opacity-100"
            aria-label={t("actions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void copyUsername()}>
            <Copy className="size-4" />
            {t("next.actions.copyUsername")}
            <span className="ms-auto max-w-24 truncate text-[0.6875rem] text-muted-foreground" dir="ltr">
              {admin.username}
            </span>
          </DropdownMenuItem>

          <DropdownMenuItem disabled={reset.isPending} onSelect={resetUsage}>
            {reset.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {t("next.actions.resetUsage")}
          </DropdownMenuItem>

          <DropdownMenuItem disabled={setStatus.isPending} onSelect={toggleStatus}>
            {setStatus.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : disabled ? (
              <CircleCheck className="size-4" />
            ) : (
              <Ban className="size-4" />
            )}
            {disabled ? t("next.actions.enable") : t("next.actions.disable")}
          </DropdownMenuItem>

          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
                {t("next.actions.deleteAdmin")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("next.actions.deleteAdmin")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("next.actions.confirmDelete", { name: admin.username })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteAdmin}>
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
