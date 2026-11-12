import { Ban, CircleCheck, Trash2, X } from "lucide-react"
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

/**
 * Bulk bar for the admins table, docked above the table in normal flow so the
 * pagination is never covered. The panel has no bulk admin endpoint, so the
 * page loops the per-admin calls behind these buttons.
 *
 * The delete prompt is an English literal: the locale files have no bulk
 * admins string, and this task may not add keys.
 */
const BULK_DELETE_PROMPT = "Delete the selected admins? This cannot be undone."

export function AdminsBulkActionBar({
  count,
  isPending,
  onClear,
  onEnable,
  onDisable,
  onDelete,
}: {
  count: number
  isPending: boolean
  onClear: () => void
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
}) {
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

      <Button variant="outline" size="sm" disabled={isPending} onClick={onEnable}>
        <CircleCheck />
        {t("next.actions.enable")}
      </Button>
      <Button variant="outline" size="sm" disabled={isPending} onClick={onDisable}>
        <Ban />
        {t("next.actions.disable")}
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
            <AlertDialogDescription>{BULK_DELETE_PROMPT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
