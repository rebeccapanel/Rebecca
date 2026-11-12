/**
 * Thin, typed wrapper around the panel's JSON API.
 *
 * The panel authenticates with an HttpOnly session cookie, so every request is
 * sent with `credentials: "include"`. In development the request never leaves
 * the Vite origin: `/api/*` is proxied to the real panel by `vite.config.ts`.
 */

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api"

/** Dispatched on `window` when a request comes back 401. */
export const UNAUTHORIZED_EVENT = "rebecca:unauthorized"

export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>

export type QueryParams = Record<string, QueryValue>

/** Serialises query params, repeating keys for arrays (`?sort=name&sort=-used`). */
export function buildQuery(params?: QueryParams): string {
  if (!params) return ""
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue
        search.append(key, String(item))
      }
      continue
    }
    search.append(key, String(value))
  }
  const serialised = search.toString()
  return serialised ? `?${serialised}` : ""
}

function extractDetail(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim()
  if (Array.isArray(payload)) {
    const parts = payload.map((item) => extractDetail(item, "")).filter(Boolean)
    return parts.join(", ") || fallback
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    for (const key of ["detail", "msg", "error", "message"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
      if (value && typeof value === "object") {
        const nested = extractDetail(value, "")
        if (nested) return nested
      }
    }
    // Pydantic-style validation errors: { detail: [{ loc, msg }] }
    if (Array.isArray(record.detail)) {
      const parts = (record.detail as Array<Record<string, unknown>>)
        .map((item) => (typeof item?.msg === "string" ? item.msg : ""))
        .filter(Boolean)
      if (parts.length) return parts.join(", ")
    }
  }
  return fallback
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  params?: QueryParams
  body?: unknown
  signal?: AbortSignal
  /** Skip the global unauthorized handler (used by the session probe). */
  silentUnauthorized?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params, body, signal, silentUnauthorized } = options
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}${buildQuery(params)}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error
    throw new ApiError(0, "Network error: the panel is unreachable.")
  }

  if (response.status === 401 && !silentUnauthorized) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const payload = text ? safeJson(text) : undefined

  if (!response.ok) {
    throw new ApiError(response.status, extractDetail(payload, response.statusText || "Request failed"))
  }

  return payload as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE", body }),
}

/** Human-readable message for anything thrown by `request`. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  if (error instanceof Error) return error.message
  return String(error)
}
