import {
  ArrowDownToLine,
  Copy,
  MoreHorizontal,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react"
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
import {
  useDeleteNode,
  useReconnectNode,
  useRestartNodeCore,
  useSyncNodeConfig,
  useUpdateNodeXray,
} from "@/features/nodes/api"
import { errorMessage } from "@/lib/api"
import type { Node } from "@/types/api"

type ConfirmAction = "reconnect" | "restart" | "update" | "delete"

/**
 * Sudo-only node menu. Reconnect/restart/update/delete confirm first because
 * they interrupt live traffic or remove the node; sync applies silently.
 */
export function NodeRowActions({ node }: { node: Node }) {
  const { t } = useTranslation()
  const reconnect = useReconnectNode()
  const restart = useRestartNodeCore()
  const updateXray = useUpdateNodeXray()
  const sync = useSyncNodeConfig()
  const remove = useDeleteNode()
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const busy =
    reconnect.isPending ||
    restart.isPending ||
    updateXray.isPending ||
    sync.isPending ||
    remove.isPending

  // `mutateAsync` + a local catch keeps toasts reliable even when the row
  // remounts while the mutation is in flight (mutate() callbacks are dropped).
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      toast.success(t("next.actions.done"))
    } catch (error) {
      toast.error(t("next.actions.failed"), {
        description: errorMessage(error),
      })
    }
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(`${node.address}:${node.port}`)
      toast.success(t("next.toast.copied"))
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  const confirmCopy = (action: ConfirmAction) => {
    switch (action) {
      case "reconnect":
        return {
          title: t("next.actions.reconnect"),
          description: t("next.actions.confirmReconnect", { name: node.name }),
          label: t("next.actions.reconnect"),
          destructive: false,
        }
      case "restart":
        return {
          title: t("next.actions.restartCore"),
          description: t("next.actions.confirmRestart", { name: node.name }),
          label: t("next.actions.restartCore"),
          destructive: false,
        }
      case "update":
        return {
          title: t("next.actions.updateXray"),
          description: t("next.actions.confirmUpdateXray", { name: node.name }),
          label: t("next.actions.updateXray"),
          destructive: false,
        }
      case "delete":
        return {
          title: t("next.actions.deleteNode"),
          description: t("next.actions.confirmDelete", { name: node.name }),
          label: t("delete"),
          destructive: true,
        }
    }
  }

  const runConfirmed = () => {
    switch (confirm) {
      case "reconnect":
        void run(() => reconnect.mutateAsync(node.id))
        break
      case "restart":
        void run(() => restart.mutateAsync(node.id))
        break
      case "update":
        void run(() => updateXray.mutateAsync(node.id))
        break
      case "delete":
        void run(() => remove.mutateAsync(node.id))
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
            {busy ? (
              <Spinner className="size-4" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={busy} onSelect={() => void copyAddress()}>
            <Copy className="size-4" />
            {t("next.actions.copyAddress")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => setConfirm("reconnect")}
          >
            {reconnect.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t("next.actions.reconnect")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => setConfirm("restart")}
          >
            {restart.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {t("next.actions.restartCore")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => setConfirm("update")}
          >
            {updateXray.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <ArrowDownToLine className="size-4" />
            )}
            {t("next.actions.updateXray")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => void run(() => sync.mutateAsync(node.id))}
          >
            {sync.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            {t("next.actions.syncConfig")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={busy}
            onSelect={() => setConfirm("delete")}
          >
            {remove.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {t("next.actions.deleteNode")}
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
            <AlertDialogDescription>
              {dialog?.description}
            </AlertDialogDescription>
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
