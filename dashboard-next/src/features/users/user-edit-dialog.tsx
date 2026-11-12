import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Loader2, Sparkles } from "lucide-react"
import { type FormEvent, type ReactNode, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useUserServiceOptions, usersKeys } from "@/features/users/api"
import { ApiError, api, errorMessage } from "@/lib/api"
import { useFormat } from "@/lib/use-format"

export type UserEditTarget = { username: string; mode: "create" | "edit" }

// ---------------------------------------------------------------------------
// Wire types — detail payload (`GET /api/user/{username}`), see
// docs/api-contract.md §2.6. Local to this dialog so it stays self-contained.
// ---------------------------------------------------------------------------

type UserNextPlan = {
  id?: number
  data_limit: number
  expire: number | null
  add_remaining_traffic: boolean
  fire_on_either: boolean
}

type UserLinkData = {
  uuid?: string
  password?: string
  password_b64?: string
  protocol: string
}

type UserDetail = {
  username: string
  status: string
  used_traffic?: number
  lifetime_used_traffic?: number
  created_at?: string
  expire: number | null
  data_limit: number | null
  data_limit_reset_strategy?: string
  flow?: string | null
  note?: string | null
  telegram_id?: string | null
  contact_number?: string | null
  on_hold_expire_duration?: number | null
  sub_updated_at?: string | null
  ip_limit?: number | null
  speed_limit_kbps?: number | null
  auto_delete_in_days?: number | null
  service_id?: number | null
  service_name?: string | null
  admin_username?: string | null
  credential_key?: string | null
  key_subscription_url?: string | null
  proxies?: Record<string, Record<string, unknown>>
  excluded_inbounds?: Record<string, string[]>
  inbounds?: Record<string, string[]>
  next_plans?: UserNextPlan[]
  links?: string[]
  link_data?: UserLinkData[]
  subscription_url?: string
  subscription_urls?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

const BYTES_PER_GB = 1_073_741_824
const SECONDS_PER_DAY = 86_400
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,32}$/
const NOTE_MAX_LENGTH = 500

const RESET_STRATEGIES = ["no_reset", "day", "week", "month", "year"] as const
const FLOWS = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"] as const
const EDIT_STATUSES = ["active", "disabled", "on_hold"] as const
const CREATE_STATUSES = ["active", "on_hold"] as const

type ExpiryMode = "relative" | "absolute" | "on_hold"

type UserFormState = {
  username: string
  status: string
  serviceId: string
  note: string
  telegramId: string
  contactNumber: string
  resetStrategy: string
  autoDeleteDays: string
  unlimitedData: boolean
  dataLimitGb: string
  expiryMode: ExpiryMode
  expiryDays: string
  absoluteExpiry: string
  onHoldDays: string
  ipLimit: string
  speedMbps: string
  flow: string
  nextPlanEnabled: boolean
  nextPlanDataLimitGb: string
  nextPlanExpireDays: string
  nextPlanAddRemaining: boolean
  nextPlanFireOnEither: boolean
}

type FieldKey =
  | "username"
  | "service"
  | "note"
  | "dataLimit"
  | "expiryDays"
  | "absoluteExpiry"
  | "onHoldDays"
  | "ipLimit"
  | "speedLimit"
  | "autoDelete"
  | "nextPlanDataLimit"
  | "nextPlanExpire"

const FIELD_IDS: Record<FieldKey, string> = {
  username: "user-edit-username",
  service: "user-edit-service",
  note: "user-edit-note",
  dataLimit: "user-edit-data-limit",
  expiryDays: "user-edit-expiry-days",
  absoluteExpiry: "user-edit-expiry-absolute",
  onHoldDays: "user-edit-onhold-days",
  ipLimit: "user-edit-ip-limit",
  speedLimit: "user-edit-speed-limit",
  autoDelete: "user-edit-auto-delete",
  nextPlanDataLimit: "user-edit-next-data-limit",
  nextPlanExpire: "user-edit-next-expire-days",
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

/** Accepts Persian/Arabic digits and commas, like the legacy editor did. */
function normalizeDecimalText(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[٫٬,]/g, ".")
    .trim()
}

/** `null` = empty, `NaN` = invalid, otherwise a finite number. */
function parseDecimal(value: string): number | null {
  const normalized = normalizeDecimalText(value)
  if (!normalized) return null
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function toNonNegativeInteger(value: string): number | null {
  const parsed = parseDecimal(value)
  if (parsed === null || Number.isNaN(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function gigabytesToBytes(gigabytes: number): number {
  return Math.round(gigabytes * BYTES_PER_GB)
}

function bytesToGigabytes(bytes: number): string {
  return String(Number((bytes / BYTES_PER_GB).toFixed(5)))
}

function kbpsToMbps(kbps: number): string {
  return String(Number((kbps / 1000).toFixed(2)))
}

/** Expiry from "N days from now", matching the legacy end-of-day convention. */
function expireFromDays(days: number): number {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(23, 59, 59, 0)
  return Math.floor(date.getTime() / 1000)
}

function unixToDatetimeLocal(unix: number): string {
  const date = new Date(unix * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function datetimeLocalToUnix(value: string): number | null {
  if (!value) return null
  const parsed = new Date(value)
  const time = parsed.getTime()
  return Number.isNaN(time) ? null : Math.floor(time / 1000)
}

function daysFromNow(unix: number | null): string {
  if (!unix) return ""
  const days = Math.round((unix - Date.now() / 1000) / SECONDS_PER_DAY)
  return String(Math.max(0, days))
}

function isAllowedStatus(status: string): boolean {
  return (EDIT_STATUSES as readonly string[]).includes(status)
}

function isAllowedFlow(flow: string | null | undefined): string {
  return flow && (FLOWS as readonly string[]).includes(flow) ? flow : ""
}

function isAllowedResetStrategy(strategy: string | null | undefined): string {
  return strategy && (RESET_STRATEGIES as readonly string[]).includes(strategy)
    ? strategy
    : "no_reset"
}

function absoluteLink(link: string): string {
  return link.startsWith("/") ? `${window.location.origin}${link}` : link
}

function initialForm(mode: UserEditTarget["mode"], detail: UserDetail | undefined): UserFormState {
  const base: UserFormState = {
    username: "",
    status: "active",
    serviceId: "",
    note: "",
    telegramId: "",
    contactNumber: "",
    resetStrategy: "no_reset",
    autoDeleteDays: "",
    unlimitedData: true,
    dataLimitGb: "",
    expiryMode: "relative",
    expiryDays: "",
    absoluteExpiry: "",
    onHoldDays: "",
    ipLimit: "",
    speedMbps: "",
    flow: "",
    nextPlanEnabled: false,
    nextPlanDataLimitGb: "",
    nextPlanExpireDays: "",
    nextPlanAddRemaining: false,
    nextPlanFireOnEither: true,
  }
  if (mode === "create" || !detail) return base

  const nextPlan = detail.next_plans?.[0]
  let expiry: Pick<UserFormState, "expiryMode" | "expiryDays" | "absoluteExpiry" | "onHoldDays">
  if (detail.status === "on_hold" && detail.on_hold_expire_duration) {
    expiry = {
      expiryMode: "on_hold",
      expiryDays: "",
      absoluteExpiry: "",
      onHoldDays: String(Math.round(detail.on_hold_expire_duration / SECONDS_PER_DAY)),
    }
  } else if (detail.expire) {
    expiry = {
      expiryMode: "absolute",
      expiryDays: "",
      absoluteExpiry: unixToDatetimeLocal(detail.expire),
      onHoldDays: "",
    }
  } else {
    expiry = { expiryMode: "relative", expiryDays: "", absoluteExpiry: "", onHoldDays: "" }
  }

  return {
    username: detail.username,
    status: isAllowedStatus(detail.status) ? detail.status : "active",
    serviceId: detail.service_id ? String(detail.service_id) : "",
    note: detail.note ?? "",
    telegramId: detail.telegram_id ?? "",
    contactNumber: detail.contact_number ?? "",
    resetStrategy: isAllowedResetStrategy(detail.data_limit_reset_strategy),
    autoDeleteDays:
      detail.auto_delete_in_days === null || detail.auto_delete_in_days === undefined
        ? ""
        : String(detail.auto_delete_in_days),
    unlimitedData: !detail.data_limit || detail.data_limit <= 0,
    dataLimitGb:
      detail.data_limit && detail.data_limit > 0 ? bytesToGigabytes(detail.data_limit) : "",
    ...expiry,
    ipLimit: detail.ip_limit && detail.ip_limit > 0 ? String(detail.ip_limit) : "",
    speedMbps:
      detail.speed_limit_kbps && detail.speed_limit_kbps > 0
        ? kbpsToMbps(detail.speed_limit_kbps)
        : "",
    flow: isAllowedFlow(detail.flow),
    nextPlanEnabled: Boolean(nextPlan),
    nextPlanDataLimitGb:
      nextPlan && nextPlan.data_limit > 0 ? bytesToGigabytes(nextPlan.data_limit) : "",
    nextPlanExpireDays: nextPlan ? daysFromNow(nextPlan.expire) : "",
    nextPlanAddRemaining: nextPlan?.add_remaining_traffic ?? false,
    nextPlanFireOnEither: nextPlan?.fire_on_either ?? true,
  }
}

function resolveExpiry(form: UserFormState): { expire: number | null; onHoldSeconds: number | null } {
  if (form.expiryMode === "on_hold") {
    const days = parseDecimal(form.onHoldDays)
    return {
      expire: null,
      onHoldSeconds: days === null || Number.isNaN(days) ? null : Math.round(days * SECONDS_PER_DAY),
    }
  }
  if (form.expiryMode === "relative") {
    const days = parseDecimal(form.expiryDays)
    return {
      expire: days === null || Number.isNaN(days) ? null : expireFromDays(days),
      onHoldSeconds: null,
    }
  }
  return { expire: datetimeLocalToUnix(form.absoluteExpiry), onHoldSeconds: null }
}

function nextPlanPayload(form: UserFormState): Record<string, unknown> {
  const gigabytes = parseDecimal(form.nextPlanDataLimitGb)
  const days = parseDecimal(form.nextPlanExpireDays)
  return {
    data_limit:
      gigabytes === null || Number.isNaN(gigabytes) || gigabytes <= 0
        ? 0
        : gigabytesToBytes(gigabytes),
    expire: days === null || Number.isNaN(days) ? 0 : expireFromDays(days),
    add_remaining_traffic: form.nextPlanAddRemaining,
    fire_on_either: form.nextPlanFireOnEither,
  }
}

function buildCreatePayload(form: UserFormState): Record<string, unknown> {
  const expiry = resolveExpiry(form)
  const status = form.status === "on_hold" || form.expiryMode === "on_hold" ? "on_hold" : "active"
  const dataLimitGb = parseDecimal(form.dataLimitGb)
  const dataLimit = form.unlimitedData ? 0 : gigabytesToBytes(dataLimitGb ?? 0)
  const payload: Record<string, unknown> = {
    username: form.username.trim(),
    service_id: Number(form.serviceId),
    status,
    expire: expiry.expire,
    data_limit: dataLimit,
    data_limit_reset_strategy: dataLimit > 0 ? form.resetStrategy : "no_reset",
    on_hold_expire_duration: status === "on_hold" ? expiry.onHoldSeconds : null,
    note: form.note,
    telegram_id: form.telegramId,
    contact_number: form.contactNumber,
    ip_limit: toNonNegativeInteger(form.ipLimit) ?? 0,
    speed_limit_kbps: Math.round((parseDecimal(form.speedMbps) ?? 0) * 1000),
    auto_delete_in_days: toNonNegativeInteger(form.autoDeleteDays),
    flow: form.flow || null,
  }
  if (form.nextPlanEnabled) payload.next_plans = [nextPlanPayload(form)]
  return payload
}

/**
 * PUT applies only the fields present in the body (`docs/api-contract.md` §2.8),
 * so compare against the state the dialog opened with and send just the changes.
 */
function buildEditPayload(form: UserFormState, initial: UserFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const set = (key: string, value: unknown) => {
    payload[key] = value
  }

  if (form.status !== initial.status) set("status", form.status)
  if (form.serviceId !== initial.serviceId && form.serviceId) {
    set("service_id", Number(form.serviceId))
  }
  if (form.note !== initial.note) set("note", form.note)
  if (form.telegramId !== initial.telegramId) set("telegram_id", form.telegramId)
  if (form.contactNumber !== initial.contactNumber) set("contact_number", form.contactNumber)
  if (form.flow !== initial.flow) set("flow", form.flow || null)

  const dataLimitTouched =
    form.unlimitedData !== initial.unlimitedData || form.dataLimitGb !== initial.dataLimitGb
  if (dataLimitTouched) {
    set("data_limit", form.unlimitedData ? 0 : gigabytesToBytes(parseDecimal(form.dataLimitGb) ?? 0))
    set("data_limit_reset_strategy", form.unlimitedData ? "no_reset" : form.resetStrategy)
  } else if (form.resetStrategy !== initial.resetStrategy) {
    set("data_limit_reset_strategy", form.unlimitedData ? "no_reset" : form.resetStrategy)
  }

  const expiryTouched =
    form.expiryMode !== initial.expiryMode ||
    form.expiryDays !== initial.expiryDays ||
    form.absoluteExpiry !== initial.absoluteExpiry ||
    form.onHoldDays !== initial.onHoldDays
  if (expiryTouched || form.status !== initial.status) {
    const expiry = resolveExpiry(form)
    set("expire", expiry.expire)
    set("on_hold_expire_duration", form.expiryMode === "on_hold" ? expiry.onHoldSeconds : null)
  }

  if (form.ipLimit !== initial.ipLimit) set("ip_limit", toNonNegativeInteger(form.ipLimit) ?? 0)
  if (form.speedMbps !== initial.speedMbps) {
    set("speed_limit_kbps", Math.round((parseDecimal(form.speedMbps) ?? 0) * 1000))
  }
  if (form.autoDeleteDays !== initial.autoDeleteDays) {
    set("auto_delete_in_days", toNonNegativeInteger(form.autoDeleteDays))
  }

  const nextPlanTouched =
    form.nextPlanEnabled !== initial.nextPlanEnabled ||
    form.nextPlanDataLimitGb !== initial.nextPlanDataLimitGb ||
    form.nextPlanExpireDays !== initial.nextPlanExpireDays ||
    form.nextPlanAddRemaining !== initial.nextPlanAddRemaining ||
    form.nextPlanFireOnEither !== initial.nextPlanFireOnEither
  if (nextPlanTouched) {
    set("next_plans", form.nextPlanEnabled ? [nextPlanPayload(form)] : [])
  }

  return payload
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

export function UserEditDialog({
  target,
  open,
  onOpenChange,
}: {
  target: UserEditTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const isEdit = target?.mode === "edit"
  const username = target?.username ?? ""

  const detailQuery = useQuery({
    queryKey: ["user", "detail", username],
    queryFn: ({ signal }) =>
      api.get<UserDetail>(`/user/${encodeURIComponent(username)}`, { signal }),
    enabled: open && isEdit && username.length > 0,
    retry: false,
    staleTime: 0,
  })

  if (!target) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `${t("userDialog.editUserTitle")} — ${target.username}`
              : t("createNewUser")}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the account settings, limits and links for this user."
              : "Create a user, choose a service and set its limits."}
          </DialogDescription>
        </DialogHeader>

        {isEdit ? (
          detailQuery.isPending ? (
            <div role="status" aria-live="polite" className="space-y-3 py-2">
              <span className="sr-only">{t("loading")}</span>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailQuery.isError || !detailQuery.data ? (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertTitle>{t("next.users.errorTitle")}</AlertTitle>
                <AlertDescription>{errorMessage(detailQuery.error)}</AlertDescription>
              </Alert>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={() => void detailQuery.refetch()}>{t("refresh")}</Button>
              </div>
            </div>
          ) : (
            <UserEditForm
              key={`edit:${target.username}`}
              mode="edit"
              username={target.username}
              detail={detailQuery.data}
              onClose={() => onOpenChange(false)}
            />
          )
        ) : (
          <UserEditForm
            key={`create:${target.username}:${open ? "open" : "closed"}`}
            mode="create"
            username={target.username}
            detail={undefined}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function UserEditForm({
  mode,
  username,
  detail,
  onClose,
}: {
  mode: UserEditTarget["mode"]
  username: string
  detail: UserDetail | undefined
  onClose: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<UserFormState>(() => initialForm(mode, detail))
  const initial = useRef<UserFormState>(form)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // The dialog only (re)mounts once the app's session gate has resolved, so the
  // service list can be requested immediately.
  const servicesQuery = useUserServiceOptions(true)
  const services = servicesQuery.data ?? []
  const isEdit = mode === "edit"
  const isOnHold = form.expiryMode === "on_hold"
  const expiryFieldId = isOnHold
    ? FIELD_IDS.onHoldDays
    : form.expiryMode === "relative"
      ? FIELD_IDS.expiryDays
      : FIELD_IDS.absoluteExpiry

  const patch = (values: Partial<UserFormState>) => {
    setForm((current) => ({ ...current, ...values }))
  }

  const setStatus = (value: string) => {
    setForm((current) => ({
      ...current,
      status: value,
      expiryMode:
        value === "on_hold"
          ? "on_hold"
          : current.expiryMode === "on_hold"
            ? "relative"
            : current.expiryMode,
    }))
  }

  const setExpiryMode = (value: ExpiryMode) => {
    setForm((current) => ({
      ...current,
      expiryMode: value,
      status:
        value === "on_hold"
          ? "on_hold"
          : current.status === "on_hold"
            ? "active"
            : current.status,
    }))
  }

  const generateUsername = () => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let generated = ""
    for (let index = 0; index < 8; index += 1) {
      generated += characters.charAt(Math.floor(Math.random() * characters.length))
    }
    patch({ username: generated })
  }

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? api.put<UserDetail>(`/user/${encodeURIComponent(username)}`, payload)
        : api.post<UserDetail>("/user", payload),
    onSuccess: (_data, payload) => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all })
      const savedUsername = String(payload.username ?? username)
      toast.success(
        t(isEdit ? "userDialog.userEdited" : "userDialog.userCreated", {
          username: savedUsername,
        }),
      )
      onClose()
    },
    onError: (error) => {
      const message = errorMessage(error)
      setFormError(message)
      const lower = message.toLowerCase()
      if (error instanceof ApiError && error.status === 409) {
        setFieldErrors((current) => ({ ...current, username: message }))
      } else if (lower.includes("username")) {
        setFieldErrors((current) => ({ ...current, username: message }))
      } else if (lower.includes("service")) {
        setFieldErrors((current) => ({ ...current, service: message }))
      } else if (lower.includes("data limit")) {
        setFieldErrors((current) => ({ ...current, dataLimit: message }))
      }
    },
  })

  const validate = (): Partial<Record<FieldKey, string>> => {
    const errors: Partial<Record<FieldKey, string>> = {}
    if (!isEdit && !USERNAME_RE.test(form.username.trim())) {
      errors.username = t("userDialog.usernameInvalid")
    }
    if (!form.serviceId) errors.service = t("userDialog.selectService")
    if (form.note.length > NOTE_MAX_LENGTH) {
      errors.note = `Note must be ${NOTE_MAX_LENGTH} characters or fewer.`
    }

    if (!form.unlimitedData) {
      const gigabytes = parseDecimal(form.dataLimitGb)
      if (gigabytes === null) {
        errors.dataLimit = "Enter a data limit in GB or enable unlimited."
      } else if (Number.isNaN(gigabytes) || gigabytes < 0) {
        errors.dataLimit = "Enter a valid non-negative data limit."
      }
    }
    if (form.expiryMode === "relative" && form.expiryDays.trim()) {
      const days = parseDecimal(form.expiryDays)
      if (days === null || Number.isNaN(days) || days < 0) {
        errors.expiryDays = "Enter a valid non-negative number of days."
      }
    }
    if (form.expiryMode === "absolute" && form.absoluteExpiry) {
      if (datetimeLocalToUnix(form.absoluteExpiry) === null) {
        errors.absoluteExpiry = "Enter a valid date and time."
      }
    }
    if (form.expiryMode === "on_hold") {
      const days = parseDecimal(form.onHoldDays)
      if (days === null || Number.isNaN(days) || days <= 0) {
        errors.onHoldDays = t("userDialog.required")
      }
    }
    if (form.ipLimit.trim()) {
      const ipLimit = parseDecimal(form.ipLimit)
      if (ipLimit === null || Number.isNaN(ipLimit) || ipLimit < 0) {
        errors.ipLimit = t("userDialog.ipLimitValidation")
      }
    }
    if (form.speedMbps.trim()) {
      const speed = parseDecimal(form.speedMbps)
      if (speed === null || Number.isNaN(speed) || speed < 0) {
        errors.speedLimit = t("userDialog.speedLimitValidation")
      }
    }
    if (form.autoDeleteDays.trim()) {
      const autoDelete = parseDecimal(form.autoDeleteDays)
      if (autoDelete === null || Number.isNaN(autoDelete) || autoDelete < 0) {
        errors.autoDelete = "Enter a valid non-negative number of days."
      }
    }
    if (form.nextPlanEnabled) {
      if (form.nextPlanDataLimitGb.trim()) {
        const nextGigabytes = parseDecimal(form.nextPlanDataLimitGb)
        if (nextGigabytes === null || Number.isNaN(nextGigabytes) || nextGigabytes < 0) {
          errors.nextPlanDataLimit = "Enter a valid non-negative data limit."
        }
      }
      if (form.nextPlanExpireDays.trim()) {
        const nextDays = parseDecimal(form.nextPlanExpireDays)
        if (nextDays === null || Number.isNaN(nextDays) || nextDays < 0) {
          errors.nextPlanExpire = t("userDialog.autoRenewInvalidDays")
        }
      }
    }
    return errors
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const errors = validate()
    setFieldErrors(errors)
    const firstError = Object.keys(errors)[0] as FieldKey | undefined
    if (firstError) {
      window.setTimeout(() => document.getElementById(FIELD_IDS[firstError])?.focus(), 0)
      return
    }

    if (isEdit) {
      const payload = buildEditPayload(form, initial.current)
      if (Object.keys(payload).length === 0) {
        onClose()
        return
      }
      save.mutate(payload)
      return
    }
    save.mutate(buildCreatePayload(form))
  }

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      toast.success(t("copied"))
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200)
    } catch {
      toast.error(t("next.toast.copyFailed"))
    }
  }

  const fieldError = (key: FieldKey) => fieldErrors[key]
  const inputProps = (key: FieldKey) => ({
    id: FIELD_IDS[key],
    "aria-invalid": fieldError(key) ? true : undefined,
    "aria-describedby": fieldError(key) ? `${FIELD_IDS[key]}-error` : undefined,
  })

  const subscriptionRows: Array<{
    key: string
    label: string
    url: string
    recommended: boolean
  }> = []
  if (detail?.subscription_url) {
    subscriptionRows.push({
      key: "primary",
      label: t("userDialog.links.subscription"),
      url: absoluteLink(detail.subscription_url),
      recommended: false,
    })
  }
  for (const [key, value] of Object.entries(detail?.subscription_urls ?? {})) {
    const [baseKey, variant] = key.split("@", 2)
    const baseLabel =
      baseKey === "username-key"
        ? t("userDialog.links.subscriptionUsernameKey")
        : baseKey === "key"
          ? t("userDialog.links.subscriptionKey")
          : baseKey === "key-username"
            ? t("userDialog.links.subscriptionKeyUsername")
            : baseKey === "token"
              ? t("userDialog.links.subscriptionToken")
              : baseKey
    subscriptionRows.push({
      key,
      label: variant ? `${baseLabel} (${variant})` : baseLabel,
      url: absoluteLink(value),
      recommended: baseKey === "key",
    })
  }

  const linkData = detail?.link_data ?? []
  const configRows = (detail?.links ?? []).map((link, index) => {
    const protocol = linkData[index]?.protocol
    const fallback = t("userDialog.links.configFallback", { index: index + 1 })
    return {
      key: `config-${index}`,
      label: protocol ? `${protocol.toUpperCase()} · ${fallback}` : fallback,
      url: absoluteLink(link),
    }
  })

  const proxyRows = Object.entries(detail?.proxies ?? {}).map(([protocol, settings]) => {
    const parts: string[] = []
    if (typeof settings.id === "string") parts.push(`id: ${settings.id}`)
    if (typeof settings.password === "string") parts.push(`password: ${settings.password}`)
    if (typeof settings.method === "string") parts.push(`method: ${settings.method}`)
    return { protocol, value: parts.join(" · ") || "—" }
  })

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col gap-3">
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("error")}</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="general" className="min-h-0">
        <TabsList className="w-full">
          <TabsTrigger value="general">{t("next.userEdit.general")}</TabsTrigger>
          <TabsTrigger value="limits">{t("next.userEdit.limits")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("next.userEdit.advanced")}</TabsTrigger>
          {isEdit ? <TabsTrigger value="links">{t("userDialog.tabs.links")}</TabsTrigger> : null}
        </TabsList>

        {/* ------------------------------ General ------------------------------ */}
        <TabsContent value="general" className="max-h-[54vh] overflow-y-auto pe-1 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={FIELD_IDS.username}
              label={t("username")}
              error={fieldError("username")}
              hint={
                isEdit
                  ? "Usernames cannot be changed after creation."
                  : t("userDialog.usernameHint")
              }
              className={isEdit ? undefined : "sm:col-span-2"}
            >
              <InputGroup>
                <InputGroupInput
                  {...inputProps("username")}
                  value={form.username}
                  disabled={isEdit}
                  autoComplete="off"
                  maxLength={32}
                  onChange={(event) => patch({ username: event.target.value })}
                />
                {isEdit ? null : (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      aria-label={t("userDialog.generateUsername")}
                      title={t("userDialog.generateUsername")}
                      onClick={generateUsername}
                    >
                      <Sparkles />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </Field>

            <Field id={FIELD_IDS.service} label={t("userDialog.selectServiceLabel")} error={fieldError("service")}>
              <Select
                value={form.serviceId || undefined}
                onValueChange={(value) => patch({ serviceId: value })}
                disabled={servicesQuery.isPending}
              >
                <SelectTrigger {...inputProps("service")} className="w-full">
                  <SelectValue
                    placeholder={
                      servicesQuery.isPending
                        ? t("loading")
                        : t("userDialog.selectServiceLabel")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={String(service.id)}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field id="user-edit-status" label={t("status")}>
              <Select value={form.status} onValueChange={setStatus}>
                <SelectTrigger id="user-edit-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(isEdit ? EDIT_STATUSES : CREATE_STATUSES).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              id={FIELD_IDS.autoDelete}
              label={`${t("bulkActions.create.autoDelete")} (${t("userDialog.days")})`}
              error={fieldError("autoDelete")}
              hint={t("bulkActions.create.autoDeleteHelp")}
            >
              <Input
                {...inputProps("autoDelete")}
                type="text"
                inputMode="numeric"
                value={form.autoDeleteDays}
                placeholder="0"
                onChange={(event) => patch({ autoDeleteDays: event.target.value })}
              />
            </Field>

            <Field
              id="user-edit-reset-strategy"
              label={t("userDialog.periodicUsageReset")}
              className="sm:col-span-2"
            >
              <Select
                value={form.resetStrategy}
                onValueChange={(value) => patch({ resetStrategy: value })}
              >
                <SelectTrigger id="user-edit-reset-strategy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_reset">{t("userDialog.resetStrategyNo")}</SelectItem>
                  <SelectItem value="day">{t("userDialog.resetStrategyDaily")}</SelectItem>
                  <SelectItem value="week">{t("userDialog.resetStrategyWeekly")}</SelectItem>
                  <SelectItem value="month">{t("userDialog.resetStrategyMonthly")}</SelectItem>
                  <SelectItem value="year">{t("userDialog.resetStrategyAnnually")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              id="user-edit-telegram"
              label={t("fields.telegramId")}
              className="sm:col-span-2"
            >
              <Input
                id="user-edit-telegram"
                value={form.telegramId}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => patch({ telegramId: event.target.value })}
              />
            </Field>

            <Field
              id="user-edit-contact"
              label={t("fields.contactNumber")}
              className="sm:col-span-2"
            >
              <Input
                id="user-edit-contact"
                value={form.contactNumber}
                autoComplete="off"
                onChange={(event) => patch({ contactNumber: event.target.value })}
              />
            </Field>

            <Field id={FIELD_IDS.note} label={t("fields.note")} error={fieldError("note")} className="sm:col-span-2">
              <Textarea
                {...inputProps("note")}
                value={form.note}
                rows={3}
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => patch({ note: event.target.value })}
              />
            </Field>
          </div>
        </TabsContent>

        {/* ------------------------------- Limits ------------------------------ */}
        <TabsContent value="limits" className="max-h-[54vh] overflow-y-auto pe-1 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={FIELD_IDS.dataLimit}
              label={t("userDialog.dataLimit")}
              error={fieldError("dataLimit")}
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <InputGroup className="min-w-40 flex-1">
                  <InputGroupInput
                    {...inputProps("dataLimit")}
                    type="text"
                    inputMode="decimal"
                    value={form.unlimitedData ? "" : form.dataLimitGb}
                    placeholder="0"
                    disabled={form.unlimitedData}
                    onChange={(event) => patch({ dataLimitGb: event.target.value })}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>GB</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <div className="flex items-center gap-2">
                  <Switch
                    id="user-edit-unlimited"
                    checked={form.unlimitedData}
                    onCheckedChange={(checked) =>
                      patch({ unlimitedData: checked === true, dataLimitGb: checked ? "" : form.dataLimitGb })
                    }
                  />
                  <Label htmlFor="user-edit-unlimited">{t("unlimited")}</Label>
                </div>
              </div>
              {isEdit && detail ? (
                <p className="text-xs text-muted-foreground tabular">
                  {t("next.users.columnUsage")}: {format.bytes(detail.used_traffic ?? 0)}
                </p>
              ) : null}
            </Field>

            <Field
              id={expiryFieldId}
              label={t("userDialog.expiryDate")}
              error={
                isOnHold
                  ? fieldError("onHoldDays")
                  : form.expiryMode === "relative"
                    ? fieldError("expiryDays")
                    : fieldError("absoluteExpiry")
              }
              className="sm:col-span-2"
            >
              <div className="space-y-2">
                <div role="group" aria-label={t("userDialog.expiryDate")} className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={form.expiryMode === "relative" ? "secondary" : "outline"}
                    aria-pressed={form.expiryMode === "relative"}
                    onClick={() => setExpiryMode("relative")}
                  >
                    {t("userDialog.relative")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.expiryMode === "absolute" ? "secondary" : "outline"}
                    aria-pressed={form.expiryMode === "absolute"}
                    onClick={() => setExpiryMode("absolute")}
                  >
                    {t("userDialog.absolute")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={isOnHold ? "secondary" : "outline"}
                    aria-pressed={isOnHold}
                    onClick={() => setExpiryMode("on_hold")}
                  >
                    {t("userDialog.onHold")}
                  </Button>
                </div>

                {form.expiryMode === "relative" ? (
                  <InputGroup className="max-w-56">
                    <InputGroupInput
                      {...inputProps("expiryDays")}
                      type="text"
                      inputMode="decimal"
                      value={form.expiryDays}
                      placeholder={t("userDialog.expiryDaysPlaceholder")}
                      onChange={(event) => patch({ expiryDays: event.target.value })}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{t("userDialog.days")}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                ) : form.expiryMode === "absolute" ? (
                  <Input
                    {...inputProps("absoluteExpiry")}
                    type="datetime-local"
                    className="max-w-64"
                    value={form.absoluteExpiry}
                    onChange={(event) => patch({ absoluteExpiry: event.target.value })}
                  />
                ) : (
                  <div className="space-y-1.5">
                    <InputGroup className="max-w-56">
                      <InputGroupInput
                        {...inputProps("onHoldDays")}
                        type="text"
                        inputMode="decimal"
                        value={form.onHoldDays}
                        placeholder={t("userDialog.expiryDaysPlaceholder")}
                        onChange={(event) => patch({ onHoldDays: event.target.value })}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{t("userDialog.days")}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    <p className="text-xs text-muted-foreground">
                      {t("userDialog.onHoldExpireDuration")}
                    </p>
                  </div>
                )}
              </div>
            </Field>

            <Field
              id={FIELD_IDS.ipLimit}
              label={t("userDialog.ipLimitLabel")}
              error={fieldError("ipLimit")}
              hint={t("userDialog.ipLimitHint")}
            >
              <Input
                {...inputProps("ipLimit")}
                type="text"
                inputMode="numeric"
                value={form.ipLimit}
                placeholder={t("userDialog.ipLimitPlaceholder")}
                onChange={(event) => patch({ ipLimit: event.target.value })}
              />
            </Field>

            <Field
              id={FIELD_IDS.speedLimit}
              label={t("userDialog.speedLimitLabel")}
              error={fieldError("speedLimit")}
              hint={t("userDialog.speedLimitHint")}
            >
              <InputGroup>
                <InputGroupInput
                  {...inputProps("speedLimit")}
                  type="text"
                  inputMode="decimal"
                  value={form.speedMbps}
                  placeholder="0"
                  onChange={(event) => patch({ speedMbps: event.target.value })}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>Mbps</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </div>
        </TabsContent>

        {/* ------------------------------ Advanced ----------------------------- */}
        <TabsContent value="advanced" className="max-h-[54vh] overflow-y-auto pe-1 pt-2">
          <div className="space-y-4">
            <Field id="user-edit-flow" label={t("userDialog.flow.label")}>
              <Select value={form.flow || "none"} onValueChange={(value) => patch({ flow: value === "none" ? "" : value })}>
                <SelectTrigger id="user-edit-flow" className="w-full sm:max-w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("userDialog.flow.none")}</SelectItem>
                  <SelectItem value="xtls-rprx-vision">
                    {t("userDialog.flow.xtls_rprx_vision")}
                  </SelectItem>
                  <SelectItem value="xtls-rprx-vision-udp443">
                    {t("userDialog.flow.xtls_rprx_vision_udp443")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t("userDialog.nextPlanTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("userDialog.nextPlanDescription")}
                  </p>
                </div>
                <Switch
                  id="user-edit-next-plan"
                  checked={form.nextPlanEnabled}
                  onCheckedChange={(checked) => patch({ nextPlanEnabled: checked === true })}
                  aria-label={t("userDialog.nextPlanTitle")}
                />
              </div>

              {form.nextPlanEnabled ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={FIELD_IDS.nextPlanDataLimit}
                    label={t("userDialog.nextPlanDataLimit")}
                    error={fieldError("nextPlanDataLimit")}
                  >
                    <InputGroup>
                      <InputGroupInput
                        {...inputProps("nextPlanDataLimit")}
                        type="text"
                        inputMode="decimal"
                        value={form.nextPlanDataLimitGb}
                        placeholder="0"
                        onChange={(event) => patch({ nextPlanDataLimitGb: event.target.value })}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>GB</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>

                  <Field
                    id={FIELD_IDS.nextPlanExpire}
                    label={t("userDialog.nextPlanExpireDays")}
                    error={fieldError("nextPlanExpire")}
                  >
                    <InputGroup>
                      <InputGroupInput
                        {...inputProps("nextPlanExpire")}
                        type="text"
                        inputMode="decimal"
                        value={form.nextPlanExpireDays}
                        placeholder="0"
                        onChange={(event) => patch({ nextPlanExpireDays: event.target.value })}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{t("userDialog.days")}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>

                  <div className="flex items-center gap-2">
                    <Switch
                      id="user-edit-next-add-remaining"
                      checked={form.nextPlanAddRemaining}
                      onCheckedChange={(checked) => patch({ nextPlanAddRemaining: checked === true })}
                    />
                    <Label htmlFor="user-edit-next-add-remaining">
                      {t("userDialog.nextPlanAddRemainingTraffic")}
                    </Label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      id="user-edit-next-fire-either"
                      checked={form.nextPlanFireOnEither}
                      onCheckedChange={(checked) => patch({ nextPlanFireOnEither: checked === true })}
                    />
                    <Label htmlFor="user-edit-next-fire-either">
                      {t("userDialog.nextPlanFireOnEither")}
                    </Label>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </TabsContent>

        {/* ------------------------------- Links ------------------------------- */}
        {isEdit && detail ? (
          <TabsContent value="links" className="max-h-[54vh] overflow-y-auto pe-1 pt-2">
            <div className="space-y-4">
              <section className="space-y-2 rounded-lg border border-border p-3">
                <h3 className="text-sm font-medium">{t("userDialog.links.subscription")}</h3>
                {subscriptionRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("userDialog.links.noSubscription")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {subscriptionRows.map((row) => (
                      <li
                        key={row.key}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            {row.label}
                            {row.recommended ? (
                              <Badge variant="secondary">{t("userDialog.links.recommended")}</Badge>
                            ) : null}
                          </span>
                          <span dir="ltr" className="truncate text-[0.6875rem] text-muted-foreground">
                            {row.url}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("copy")} ${row.label}`}
                          title={t("copy")}
                          onClick={() => void copyText(row.key, row.url)}
                        >
                          {copiedKey === row.key ? <Check /> : <Copy />}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t("userDialog.links.configs")}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={configRows.length === 0}
                    onClick={() =>
                      void copyText("all-configs", configRows.map((row) => row.url).join("\n"))
                    }
                  >
                    {copiedKey === "all-configs" ? <Check /> : <Copy />}
                    {copiedKey === "all-configs"
                      ? t("copied")
                      : t("userDialog.links.copyAllConfigs")}
                  </Button>
                </div>
                {configRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("userDialog.links.noConfigs")}</p>
                ) : (
                  <ul className="space-y-2">
                    {configRows.map((row) => (
                      <li
                        key={row.key}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-xs font-medium">{row.label}</span>
                          <span dir="ltr" className="truncate text-[0.6875rem] text-muted-foreground">
                            {row.url}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("a11y.copyConfig")} ${row.label}`}
                          title={t("copy")}
                          onClick={() => void copyText(row.key, row.url)}
                        >
                          {copiedKey === row.key ? <Check /> : <Copy />}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2 rounded-lg border border-border p-3">
                <h3 className="text-sm font-medium">Read-only details</h3>
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">{t("userDialog.credentialKeyLabel")}</dt>
                    <dd dir="ltr" className="truncate font-mono">
                      {detail.credential_key ?? "—"}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">{t("userDialog.protocols")}</dt>
                    <dd className="space-y-0.5">
                      {proxyRows.length === 0
                        ? "—"
                        : proxyRows.map((row) => (
                            <span key={row.protocol} dir="ltr" className="block truncate font-mono">
                              {row.protocol}: {row.value}
                            </span>
                          ))}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">{t("inbound")}</dt>
                    <dd dir="ltr" className="truncate font-mono">
                      {Object.keys(detail.inbounds ?? {}).join(", ") || "—"}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">Excluded inbounds</dt>
                    <dd dir="ltr" className="truncate font-mono">
                      {Object.keys(detail.excluded_inbounds ?? {}).join(", ") || "—"}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {isEdit ? t("save") : t("createUser")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`grid content-start gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
