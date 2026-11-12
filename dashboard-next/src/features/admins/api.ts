import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError, api } from "@/lib/api"
import type { AdminsResponse } from "@/types/api"

export type AdminsQuery = {
  offset: number
  limit: number
  /** Fuzzy match over the admin username. */
  username?: string
  /** `standard` | `reseller` | `sudo` | `full_access`. */
  role?: string
  /** `active` | `disabled`. */
  status?: string
  /** `field` ascending, `-field` descending — the API's own convention. */
  sort?: string | null
  /** Server-side matching options, mirrored from the search field toggles. */
  matchCase?: boolean
  matchWholeWord?: boolean
}

export const adminsKeys = {
  all: ["admins"] as const,
  list: (query: AdminsQuery) => [...adminsKeys.all, "list", query] as const,
}

export function useAdmins(query: AdminsQuery) {
  return useQuery({
    queryKey: adminsKeys.list(query),
    queryFn: ({ signal }) =>
      api.get<AdminsResponse>("/admins", {
        signal,
        params: {
          offset: query.offset,
          limit: query.limit,
          username: query.username,
          role: query.role,
          status: query.status,
          sort: query.sort ?? undefined,
          match_case: query.matchCase ? 1 : undefined,
          match_whole_word: query.matchWholeWord ? 1 : undefined,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    // A 403 is a stable permission outcome, not a transient failure: surface it
    // immediately so the page can render its friendly no-permission state.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 403) && failureCount < 2,
  })
}

/** True when the list failed because the signed-in admin may not view admins. */
export function isAdminsForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

/** Every admin mutation refetches the list so role/status cells stay in sync. */
const invalidateAdmins = (queryClient: ReturnType<typeof useQueryClient>) => () =>
  queryClient.invalidateQueries({ queryKey: adminsKeys.all })

/** `POST /admin/usage/reset/{username}` — zeros the admin's usage counter. */
export function useResetAdminUsage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) =>
      api.post<void>(`/admin/usage/reset/${encodeURIComponent(username)}`),
    onSettled: invalidateAdmins(queryClient),
  })
}

/** `POST /admin/{username}/enable|disable` — the status toggle endpoint. */
export function useSetAdminStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, status }: { username: string; status: "active" | "disabled" }) =>
      api.post<void>(`/admin/${encodeURIComponent(username)}/${status === "active" ? "enable" : "disable"}`),
    onSettled: invalidateAdmins(queryClient),
  })
}

/** `DELETE /admin/{username}` — soft-deletes the admin (and its records). */
export function useDeleteAdmin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) => api.delete<void>(`/admin/${encodeURIComponent(username)}`),
    onSettled: invalidateAdmins(queryClient),
  })
}

/**
 * Bulk enable/disable. The API has no bulk admin endpoint, so this loops the
 * single-admin calls; the page caps the list at the current page size.
 */
export function useBulkSetAdminStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ usernames, status }: { usernames: string[]; status: "active" | "disabled" }) =>
      Promise.all(
        usernames.map((username) =>
          api.post<void>(
            `/admin/${encodeURIComponent(username)}/${status === "active" ? "enable" : "disable"}`,
          ),
        ),
      ),
    onSettled: invalidateAdmins(queryClient),
  })
}

/** Bulk delete, likewise a loop over `DELETE /admin/{username}`. */
export function useBulkDeleteAdmins() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (usernames: string[]) =>
      Promise.all(
        usernames.map((username) =>
          api.delete<void>(`/admin/${encodeURIComponent(username)}`),
        ),
      ),
    onSettled: invalidateAdmins(queryClient),
  })
}
