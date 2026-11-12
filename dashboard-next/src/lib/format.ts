/**
 * Locale-aware formatters. Every helper takes the active BCP-47 locale so the
 * same call renders Latin digits in English and Persian digits (and the
 * Jalali calendar) in Farsi.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

/**
 * Wraps a number-plus-Latin-unit token in Unicode isolates (FSI/PDI). Without
 * them a string such as "23.5 GB" inside Persian text renders as "GB 23.5",
 * because the unit and the digits are separate bidirectional runs.
 */
export const isolate = (value: string) => `\u2068${value}\u2069`

export function formatBytes(
  bytes: number | null | undefined,
  locale = "en",
  options: { decimals?: number; unlimited?: string } = {},
): string {
  if (bytes === null || bytes === undefined) return options.unlimited ?? "—"
  if (bytes === 0) return "0 B"
  const exponent = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  const decimals = options.decimals ?? (value >= 100 ? 0 : value >= 10 ? 1 : 2)
  const rendered = new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(value)
  return isolate(`${rendered} ${BYTE_UNITS[exponent]}`)
}

export function formatNumber(value: number | null | undefined, locale = "en", options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat(locale, options).format(value)
}

/** `kbps` as stored by the panel → human readable rate. */
export function formatSpeed(kbps: number | null | undefined, locale = "en"): string {
  if (!kbps) return "—"
  return isolate(`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kbps / 8)} KB/s`)
}

/** Trailing `%` with locale digits. */
export function formatPercent(ratio: number, locale = "en", decimals = 0): string {
  return isolate(
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(ratio),
  )
}

function toDate(value: number | string | null | undefined, unit: "seconds" | "milliseconds"): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null
    return new Date(unit === "seconds" ? value * 1000 : value)
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric) && /^\d+$/.test(value)) {
    return new Date(unit === "seconds" ? numeric * 1000 : numeric)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(
  value: number | string | null | undefined,
  locale = "en",
  options: { style?: "date" | "datetime" | "time"; fallback?: string; unit?: "seconds" | "milliseconds" } = {},
): string {
  const date = toDate(value, options.unit ?? "seconds")
  if (!date) return options.fallback ?? "—"
  const style = options.style ?? "date"
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: style === "time" ? undefined : "medium",
    timeStyle: style === "date" ? undefined : "short",
  })
  return formatter.format(date)
}

export function formatRelative(
  value: number | string | null | undefined,
  locale = "en",
  options: { now?: number; unit?: "seconds" | "milliseconds" } = {},
): string {
  const date = toDate(value, options.unit ?? "seconds")
  if (!date) return "—"
  const now = options.now ?? Date.now()
  const deltaSeconds = Math.round((date.getTime() - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]
  let duration = deltaSeconds
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return formatter.format(Math.round(duration), unit)
    duration /= amount
  }
  return ""
}

/** `9223372036854775807`-style sentinels mean "no expiry". */
export function isNever(timestamp: number | null | undefined): boolean {
  if (timestamp === null || timestamp === undefined) return true
  if (timestamp <= 0) return true
  // Anything past year 3000 is the panel's "unlimited" sentinel.
  return timestamp > 32_503_680_000
}

export function formatExpiry(timestamp: number | null | undefined, locale = "en", unlimited = "Unlimited"): string {
  if (isNever(timestamp)) return unlimited
  return formatDate(timestamp, locale, { style: "date" })
}

/** Whole days left, negative when already expired. */
export function daysLeft(expire: number | null | undefined, now = Date.now()): number | null {
  if (isNever(expire)) return null
  return Math.ceil(((expire as number) * 1000 - now) / 86_400_000)
}

const DURATION_UNITS: Record<string, { day: string; hour: string; minute: string; second: string }> = {
  en: { day: "d", hour: "h", minute: "m", second: "s" },
  fa: { day: "روز", hour: "ساعت", minute: "دقیقه", second: "ثانیه" },
}

export function formatDuration(seconds: number | null | undefined, locale = "en"): string {
  if (!seconds || seconds <= 0) return "—"
  const short = locale.slice(0, 2)
  const units = DURATION_UNITS[short] ?? DURATION_UNITS.en
  const glue = short === "en" ? "" : " "
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days) parts.push(`${formatNumber(days, locale)}${glue}${units.day}`)
  if (hours) parts.push(`${formatNumber(hours, locale)}${glue}${units.hour}`)
  if (!days && minutes) parts.push(`${formatNumber(minutes, locale)}${glue}${units.minute}`)
  return parts.join(" ") || `${formatNumber(Math.floor(seconds), locale)}${glue}${units.second}`
}

/** Ratio of used traffic to the plan limit, clamped to 0..1. */
export function usageRatio(used: number, limit: number | null | undefined): number | null {
  if (!limit || limit <= 0) return null
  return Math.min(Math.max(used / limit, 0), 1)
}
