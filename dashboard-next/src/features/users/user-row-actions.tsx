import {
  Ban,
  Pencil,
  CalendarPlus,
  CircleCheck,
  Copy,
  Link2Off,
  Loader2,
  MoreHorizontal,
  Network,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useResetUserUsage,
  useRevokeUserSubscription,
  useSetUserDataLimit,
  useSetUserExpiry,
  useSetUserStatus,
  useUserIps,
  type UserIPsResponse,
} from "@/features/users/api"
import { errorMessage } from "@/lib/api"
import { isNever } from "@/lib/format"
import type { UserListItem } from "@/types/api"

const TRAFFIC_STEPS_GB = [10, 20, 50] as const
const EXPIRY_STEPS_DAYS = [7, 30, 90] as const
const BYTES_PER_GB = 1024 ** 3
const SECONDS_PER_DAY = 86_400

/**
 * The contract answers `{username, ips: UserOnlineIPRecord[]}`; older builds
 * send bare address strings. Both shapes are flattened and deduplicated here so
 * the dialog only ever renders addresses.
 */
function ipAddresses(response: UserIPsResponse | undefined): string[] {
  const seen = new Set<string>()
  const addresses: string[] = []
  for (const entry of response?.ips ?? []) {
    const values =
      typeof entry === "string"
        ? [entry]
        : [entry.ip, entry.assigned_ip, ...(entry.assigned_ips ?? [])]
    for (const value of values) {
      const address = value?.trim()
      if (address && !seen.has(address)) {
        seen.add(address)
        addresses.push(address)
      }
    }
  }
  return addresses
}

export function UserRowActions({
  user,
  onEdit,
  onDelete,
}: {
  user: UserListItem
  onEdit: (user: UserListItem) => void
  onDelete: (user: UserListItem) => void
}) {
  const { t } = useTranslation()
  const reset = useResetUserUsage()
  const setStatus = useSetUserStatus()
  const setDataLimit = useSetUserDataLimit()
  const setExpiry = useSetUserExpiry()
  const revoke = useRevokeUserSubscription()

  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [ipsOpen, setIpsOpen] = useState(false)

  const ips = useUserIps(user.username, ipsOpen)
  const addresses = useMemo(() => ipAddresses(ips.data), [ips.data])

  const userDisabled = user.status === "disabled"
  // Unlimited users have no counter to raise, and "never" has no date to move.
  const trafficLocked = user.data_limit === null || user.data_limit === 0
  const expiryLocked = isNever(user.expire)

  const doneToast = (label: string) => toast.success(`${t("next.actions.done")} · ${label}`)
  const errorToast = (error: unknown) => toast.error(errorMessage(error))

  // Per-call `mutate` callbacks live on the observer, which React Query drops
  // when the owning cell unmounts. Awaiting `mutateAsync` keeps the toast tied
  // to the request instead of the mounted row, so it survives table refreshes.
  const run = (action: Promise<unknown>, label: string) => {
    void action.then(() => doneToast(label), errorToast)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t("next.toast.copied"))
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  const copySubscription = () => copyText(user.subscription_url)

  const copyAllAddresses = () => copyText(addresses.join("\n"))

  const toggleStatus = () => {
    const status = userDisabled ? "active" : "disabled"
    const label = userDisabled ? t("next.users.enable") : t("next.users.disable")
    run(setStatus.mutateAsync({ username: user.username, status }), label)
  }

  const resetUsage = () => {
    run(reset.mutateAsync(user.username), t("next.users.resetUsage"))
  }

  const revokeSubscription = () => {
    run(revoke.mutateAsync(user.username), t("next.actions.revokeSub"))
  }

  const addTraffic = (gigabytes: number) => {
    const label = `${t("next.actions.addTraffic")} +${t("next.actions.gbCount", { count: gigabytes })}`
    run(
      setDataLimit.mutateAsync({
        username: user.username,
        dataLimit: (user.data_limit ?? 0) + gigabytes * BYTES_PER_GB,
      }),
      label,
    )
  }

  const extendExpiry = (days: number) => {
    const label = `${t("next.actions.addDays")} +${t("next.actions.daysCount", { count: days })}`
    run(
      setExpiry.mutateAsync({
        username: user.username,
        expire: (user.expire ?? 0) + days * SECONDS_PER_DAY,
      }),
      label,
    )
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
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            disabled={!user.subscription_url}
            onSelect={() => void copySubscription()}
          >
            <Copy className="size-4" />
            {t("next.users.copySubscription")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIpsOpen(true)}>
            <Network className="size-4" />
            {t("next.actions.getIps")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem disabled={setStatus.isPending} onSelect={toggleStatus}>
            {setStatus.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : userDisabled ? (
              <CircleCheck className="size-4" />
            ) : (
              <Ban className="size-4" />
            )}
            {userDisabled ? t("next.users.enable") : t("next.users.disable")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={reset.isPending} onSelect={resetUsage}>
            {reset.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {t("next.users.resetUsage")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={revoke.isPending} onSelect={() => setConfirmRevoke(true)}>
            <Link2Off className="size-4" />
            {t("next.actions.revokeSub")}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={trafficLocked || setDataLimit.isPending}>
              <Plus className="size-4" />
              {t("next.actions.addTraffic")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TRAFFIC_STEPS_GB.map((gigabytes) => (
                <DropdownMenuItem
                  key={gigabytes}
                  disabled={setDataLimit.isPending}
                  onSelect={() => addTraffic(gigabytes)}
                >
                  <span dir="ltr" className="tabular">
                    +{t("next.actions.gbCount", { count: gigabytes })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={expiryLocked || setExpiry.isPending}>
              <CalendarPlus className="size-4" />
              {t("next.actions.addDays")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {EXPIRY_STEPS_DAYS.map((days) => (
                <DropdownMenuItem
                  key={days}
                  disabled={setExpiry.isPending}
                  onSelect={() => extendExpiry(days)}
                >
                  <span dir="ltr" className="tabular">
                    +{t("next.actions.daysCount", { count: days })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => onEdit(user)}>
            <Pencil className="size-4" />
            {t("userDialog.editUser")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(user)}>
            <Trash2 className="size-4" />
            {t("next.users.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={ipsOpen} onOpenChange={setIpsOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("next.actions.ipsTitle", { name: user.username })}</DialogTitle>
          </DialogHeader>

          {ips.isPending ? (
            <div className="flex flex-col gap-2" aria-label={t("loading")}>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : ips.isError ? (
            <p className="text-sm text-destructive">{errorMessage(ips.error)}</p>
          ) : addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("next.actions.ipsEmpty")}</p>
          ) : (
            <pre
              dir="ltr"
              className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
            >
              {addresses.join("\n")}
            </pre>
          )}

          <DialogFooter>
            {addresses.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => void copyAllAddresses()}>
                <Copy className="size-4" />
                {t("next.actions.ipsCopyAll")}
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t("close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("next.actions.revokeSub")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("next.actions.confirmRevoke", { name: user.username })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={revokeSubscription}>
              {revoke.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("next.actions.revokeSub")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
