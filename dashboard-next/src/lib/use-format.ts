import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  daysLeft,
  formatBytes,
  formatDate,
  formatDuration,
  formatExpiry,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSpeed,
  usageRatio,
} from "@/lib/format"

/**
 * Formatters bound to the active locale. Components should use this instead of
 * importing the helpers directly, so switching language re-renders numbers,
 * dates and the calendar (Jalali for Farsi) everywhere at once.
 */
export function useFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.language || "en"

  const bytes = useCallback(
    (value: number | null | undefined, unlimited?: string) => formatBytes(value, locale, { unlimited }),
    [locale],
  )

  // One stable object per locale: column factories use it as a memo dependency,
  // and a fresh identity each render would rebuild every column and remount rows.
  return useMemo(
    () => ({
      locale,
      bytes,
    number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    speed: (value: number | null | undefined) => formatSpeed(value, locale),
    percent: (ratio: number, decimals = 0) => formatPercent(ratio, locale, decimals),
    date: (value: number | string | null | undefined, style: "date" | "datetime" | "time" = "date") =>
      formatDate(value, locale, { style }),
    relative: (value: number | string | null | undefined) => formatRelative(value, locale),
    expiry: (value: number | null | undefined, unlimited?: string) => formatExpiry(value, locale, unlimited),
    duration: (value: number | null | undefined) => formatDuration(value, locale),
    daysLeft: (value: number | null | undefined) => daysLeft(value),
      ratio: usageRatio,
    }),
    [locale, bytes],
  )
}
