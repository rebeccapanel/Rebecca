import { Copy, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react"
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
import { Spinner } from "@/components/ui/spinner"
import { useDeleteService, useResetServiceUsage } from "@/features/services/api"
import { errorMessage } from "@/lib/api"
import type { Service } from "@/types/api"

type ConfirmAction = "reset" | "delete"

/**
 * Per-service menu. Reset and delete confirm first: both are sudo-gated on the
 * server, so a 403 reaches the user through the shared error toast.
 */
export function ServiceRowActions({ service }: { service: Service }) {
  const { t } = useTranslation()
  const resetUsage = useResetServiceUsage()
  const remove = useDeleteService()
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const busy = resetUsage.isPending || remove.isPending
  const doneToast = (label: string) => toast.success(`${t("next.actions.done")} · ${label}`)
  const errorToast = (error: unknown) => toast.error(errorMessage(error))

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(service.name)
      toast.success(t("next.toast.copied"))
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  const confirmCopy = (action: ConfirmAction) => {
    switch (action) {
      case "reset":
        return {
          title: t("next.actions.resetUsage"),
          description: t("next.actions.confirmResetUsage", { name: service.name }),
          label: t("next.actions.resetUsage"),
          destructive: false,
        }
      case "delete":
        return {
          title: t("next.actions.deleteService"),
          description: (
            <>
              {t("next.actions.confirmDeleteService", { name: service.name })}
            </>
          ),
          label: t("delete"),
          destructive: true,
        }
    }
  }

  const runConfirmed = () => {
    switch (confirm) {
      case "reset":
        resetUsage.mutate(service.id, {
          onSuccess: () => doneToast(t("next.actions.resetUsage")),
          onError: errorToast,
        })
        break
      case "delete":
        remove.mutate(service.id, {
          onSuccess: () => doneToast(t("next.actions.deleteService")),
          onError: errorToast,
        })
        break
    }
  }

  const dialog = confirm ? confirmCopy(confirm) : null

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground opacity-60 transition-opacity group-hover/row:opacity-100 data-[state=open]:opacity-100"
            aria-label={t("actions")}
            disabled={busy}
          >
            {busy ? <Spinner className="size-4" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={busy} onSelect={() => void copyName()}>
            <Copy className="size-4" />
            {t("copy")}
            <span className="ms-auto max-w-24 truncate text-[0.6875rem] text-muted-foreground">
              {service.name}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={() => setConfirm("reset")}>
            {resetUsage.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {t("next.actions.resetUsage")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={busy}
            onSelect={() => setConfirm("delete")}
          >
            {remove.isPending ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
            {t("next.actions.deleteService")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={dialog?.destructive ? "destructive" : "default"}
              onClick={runConfirmed}
            >
              {dialog?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
