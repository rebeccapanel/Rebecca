import type { UserListItem } from "@/types/api"

/**
 * CSV export for the users screen. Deliberately dependency-free and scoped to
 * the rows the table already has: exporting fetches nothing, so only the
 * current page can be serialised.
 */

type CsvColumn = {
  header: string
  value: (user: UserListItem) => string | number | null
}

const COLUMNS: CsvColumn[] = [
  { header: "username", value: (user) => user.username },
  { header: "status", value: (user) => user.status },
  { header: "user_id", value: (user) => user.id },
  { header: "service_id", value: (user) => user.service_id },
  { header: "service", value: (user) => user.service_name },
  { header: "owner", value: (user) => user.admin_username },
  { header: "used_traffic_bytes", value: (user) => user.used_traffic },
  { header: "data_limit_bytes", value: (user) => user.data_limit },
  { header: "expire", value: (user) => (user.expire === null ? "" : new Date(user.expire * 1000).toISOString()) },
  { header: "created_at", value: (user) => user.created_at },
  { header: "is_online", value: (user) => (user.is_online ? "true" : "false") },
]

/** RFC 4180 escaping: quote cells containing separators, quotes or newlines. */
function escapeCell(value: string | number | null): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toUsersCsv(users: UserListItem[]): string {
  const header = COLUMNS.map((column) => escapeCell(column.header)).join(",")
  const rows = users.map((user) => COLUMNS.map((column) => escapeCell(column.value(user))).join(","))
  return [header, ...rows].join("\r\n")
}

/**
 * Serialises the given rows and triggers a download through an `<a download>`
 * click — no library, no extra request, no server round trip.
 */
export function downloadUsersCsv(users: UserListItem[], filename = "users.csv"): void {
  // The BOM keeps Excel from mistaking UTF-8 usernames for a legacy encoding.
  const blob = new Blob(["\uFEFF", toUsersCsv(users)], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
