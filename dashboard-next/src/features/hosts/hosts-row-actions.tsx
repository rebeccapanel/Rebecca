import { Ban, Check, Copy, MoreHorizontal } from "lucide-react"
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
import { useSetHostStatus } from "@/features/hosts/api"
import { errorMessage } from "@/lib/api"
import type { Host } from "@/types/api"

/**
 * Per-host menu. Address/SNI are copied from the row's own values; the
 * enable/disable switch goes through the single-host status endpoint so the
 * rest of the grouped map is never rewritten.
 */
export function HostRowActions({ host }: { host: Host }) {
  const { t } = useTranslation()
  const setStatus = useSetHostStatus()
  const [confirming, setConfirming] = useState(false)

  const pending = setStatus.isPending
  const willDisable = !host.is_disabled

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("next.toast.copied"))
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  // `mutateAsync` + a local catch keeps toasts reliable even when the row
  // remounts while the mutation is in flight (mutate() callbacks are dropped).
  const applyStatus = async () => {
    try {
      await setStatus.mutateAsync({ id: host.id, isDisabled: willDisable })
      toast.success(t("next.actions.done"))
    } catch (error) {
      toast.error(t("next.actions.failed"), {
        description: errorMessage(error),
      })
    }
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
            disabled={pending}
          >
            {pending ? (
              <Spinner className="size-4" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => void copy(host.address)}
          >
            <Copy className="size-4" />
            {t("next.actions.copyAddress")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending || !host.sni}
            onSelect={() => {
              if (host.sni) void copy(host.sni)
            }}
          >
            <Copy className="size-4" />
            {t("next.actions.copySni")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => setConfirming(true)}
          >
            {pending ? (
              <Spinner className="size-4" />
            ) : willDisable ? (
              <Ban className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {willDisable ? t("next.actions.disable") : t("next.actions.enable")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("next.actions.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                willDisable
                  ? "next.actions.confirmDisable"
                  : "next.actions.confirmEnable",
                { name: host.remark }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={willDisable ? "destructive" : "default"}
              onClick={applyStatus}
            >
              {willDisable
                ? t("next.actions.disable")
                : t("next.actions.enable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
