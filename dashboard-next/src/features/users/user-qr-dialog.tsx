import { Check, Copy, QrCode } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { errorMessage } from "@/lib/api"

type UserQrDialogProps = {
  username: string
  /** The subscription URL; config links are offered as extra tabs when present. */
  subscriptionUrl: string
  links?: string[]
  /** Render as one of the inline row buttons. */
  compact?: boolean
}

function QrPanel({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t("next.toast.copied"))
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-border">
        <QRCodeSVG value={value} size={208} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0b0d10" />
      </div>
      <p dir="ltr" className="w-full truncate rounded-md bg-muted/50 px-2.5 py-1.5 text-center font-mono text-[0.6875rem] text-muted-foreground">
        {value}
      </p>
      <div className="flex w-full gap-2">
        <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {t("copy")}
        </Button>
      </div>
    </div>
  )
}

/**
 * QR dialog for a user's subscription link plus every config link the row
 * carries. Rendered inline in the table as one of the four quick actions.
 */
export function UserQrDialog({ username, subscriptionUrl, links = [], compact }: UserQrDialogProps) {
  const { t } = useTranslation()
  const values = [subscriptionUrl, ...links].filter(Boolean)
  const [active, setActive] = useState(0)

  const trigger = compact ? (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      aria-label={t("usersTable.qrCode")}
    >
      <QrCode className="size-3.5" />
    </Button>
  ) : (
    <Button variant="outline" size="sm" className="gap-1.5">
      <QrCode className="size-3.5" />
      {t("usersTable.qrCode")}
    </Button>
  )

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>{trigger}</DialogTrigger>
        </TooltipTrigger>
        {compact ? <TooltipContent side="top">{t("usersTable.qrCode")}</TooltipContent> : null}
      </Tooltip>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[0.9375rem]">
            <QrCode className="size-4 text-muted-foreground" />
            {t("usersTable.qrCode")} · {username}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {values.length > 1
              ? t("next.qr.multiple", { count: values.length })
              : t("next.qr.single")}
          </DialogDescription>
        </DialogHeader>

        {values.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {values.map((_, index) => (
              <Button
                key={index}
                size="sm"
                variant={active === index ? "secondary" : "outline"}
                className="h-7 text-[0.6875rem]"
                onClick={() => setActive(index)}
              >
                {index === 0 ? t("userDialog.links.subscription") : `#${index}`}
              </Button>
            ))}
          </div>
        ) : null}

        <QrPanel value={values[active] ?? ""} />

        <DialogFooter className="sm:justify-start">
          <p className="text-[0.6875rem] text-muted-foreground">{t("next.qr.hint")}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
