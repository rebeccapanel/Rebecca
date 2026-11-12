import { Ban, CircleCheck, RotateCcw, Trash2, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

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

type BulkActionBarProps = {
  count: number
  isPending: boolean
  onClear: () => void
  onResetUsage: () => void
  onActivate: () => void
  onDisable: () => void
  onDelete: () => void
}

/**
 * Docked above the table (in normal flow, so the pagination is never covered).
 * Delete is the only destructive action that asks for confirmation.
 */
export function BulkActionBar({
  count,
  isPending,
  onClear,
  onResetUsage,
  onActivate,
  onDisable,
  onDelete,
}: BulkActionBarProps) {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label={t("actions")}
      aria-busy={isPending || undefined}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-2"
    >
      <span className="text-xs font-medium tabular text-foreground">
        {t("usersTable.selectedCount", { count })}
      </span>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />

      <Button variant="outline" size="sm" disabled={isPending} onClick={onResetUsage}>
        <RotateCcw />
        {t("usersTable.resetUsage")}
      </Button>
      <Button variant="outline" size="sm" disabled={isPending} onClick={onActivate}>
        <CircleCheck />
        {t("usersTable.enableUser")}
      </Button>
      <Button variant="outline" size="sm" disabled={isPending} onClick={onDisable}>
        <Ban />
        {t("usersTable.disableUser")}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 />
        {t("delete")}
      </Button>

      <Button variant="ghost" size="sm" className="ms-auto" disabled={isPending} onClick={onClear}>
        <X />
        {t("clear")}
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("usersTable.bulkDeletePrompt")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
