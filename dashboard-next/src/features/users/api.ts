import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type {
  Admin,
  AdminsResponse,
  Service,
  ServicesResponse,
  UserStatus,
  UsersResponse,
} from "@/types/api"

export type SortField = "username" | "used_traffic" | "data_limit" | "expire" | "created_at"

export type UsersQuery = {
  offset: number
  limit: number
  search?: string
  status?: string
  /** `field` ascending, `-field` descending — the API's own convention. */
  sort?: string | null
  admin?: string[]
  /** `service_id` on the wire; the list handler rejects non-numeric values. */
  serviceId?: number
  matchCase?: boolean
  matchWholeWord?: boolean
}

export const usersKeys = {
  all: ["users"] as const,
  list: (query: UsersQuery) => [...usersKeys.all, "list", query] as const,
}

export function useUsers(query: UsersQuery) {
  return useQuery({
    queryKey: usersKeys.list(query),
    queryFn: ({ signal }) =>
      api.get<UsersResponse>("/users", {
        signal,
        params: {
          offset: query.offset,
          limit: query.limit,
          search: query.search,
          status: query.status,
          sort: query.sort ?? undefined,
          admin: query.admin,
          service_id: query.serviceId,
          match_case: query.matchCase ? "1" : undefined,
          match_whole_word: query.matchWholeWord ? "1" : undefined,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

/** Filter-option queries live outside `usersKeys.all` so user mutations do not refetch them. */
const filterOptionsKeys = {
  admins: ["users-filter-options", "admins"] as const,
  services: ["users-filter-options", "services"] as const,
}

/**
 * Admins that can own users, for the owner filter. Callers pass `enabled` from
 * the session: `GET /admins` is 403 unless the caller is full_access or holds
 * `admin_management.can_view`.
 */
export function useUserAdminOptions(enabled: boolean) {
  return useQuery({
    queryKey: filterOptionsKeys.admins,
    queryFn: ({ signal }) =>
      api.get<AdminsResponse>("/admins", { params: { limit: 100 }, signal }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    select: (data): Admin[] => data.admins,
  })
}

/**
 * Services for the service filter; `limit=none` asks for the whole list. Gated
 * by the caller so the filter does not probe the API before a session exists.
 */
export function useUserServiceOptions(enabled: boolean) {
  return useQuery({
    queryKey: filterOptionsKeys.services,
    queryFn: ({ signal }) =>
      api.get<ServicesResponse>("/v2/services", { params: { limit: "none" }, signal }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    select: (data): Service[] => data.services,
  })
}

export type BulkUsersAction = "activate_users" | "disable_users" | "delete_users"

export type BulkUsersResponse = { detail: string; count: number }

/** `POST /users/actions` — the API's bulk endpoint for status and delete. */
export function useBulkUsersAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, usernames }: { action: BulkUsersAction; usernames: string[] }) =>
      api.post<BulkUsersResponse>("/users/actions", { action, usernames }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

/**
 * Reset is not one of the bulk actions in `POST /users/actions`, so it loops the
 * single-user endpoint once per selected username. The caller caps the list at
 * the current selection.
 */
export function useResetUsersUsage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (usernames: string[]) =>
      Promise.all(
        usernames.map((username) =>
          api.post<void>(`/user/${encodeURIComponent(username)}/reset`),
        ),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

export function useResetUserUsage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) => api.post<void>(`/user/${encodeURIComponent(username)}/reset`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

export function useSetUserStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, status }: { username: string; status: "active" | "disabled" }) =>
      api.put<void>(`/user/${encodeURIComponent(username)}`, { status }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

/**
 * `PUT /user/{username}` accepts a partial body, so data-limit and expiry
 * changes are their own mutations instead of a full user update.
 */
export function useSetUserDataLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, dataLimit }: { username: string; dataLimit: number }) =>
      api.put<void>(`/user/${encodeURIComponent(username)}`, { data_limit: dataLimit }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

export function useSetUserExpiry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, expire }: { username: string; expire: number }) =>
      api.put<void>(`/user/${encodeURIComponent(username)}`, { expire }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

/** `POST /user/{username}/revoke_sub` — rotates the subscription token. */
export function useRevokeUserSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) =>
      api.post<void>(`/user/${encodeURIComponent(username)}/revoke_sub`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) => api.delete<void>(`/user/${encodeURIComponent(username)}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

/**
 * Online IP record from `GET /user/{username}/ips`. The contract documents
 * `{username, ips: UserOnlineIPRecord[]}`, but older panel builds answer with a
 * bare list of address strings, so readers accept both shapes.
 */
export type UserOnlineIPRecord = {
  ip?: string
  assigned_ip?: string
  assigned_ips?: string[]
}

export type UserIPsResponse = {
  username?: string
  ips: Array<string | UserOnlineIPRecord>
}

const userIpsKeys = {
  all: ["users", "ips"] as const,
  one: (username: string) => [...userIpsKeys.all, username] as const,
}

/**
 * `GET /user/{username}/ips` — fetched only while the IPs dialog is open.
 * `staleTime: 0` makes every open a fresh read of the live connection list.
 */
export function useUserIps(username: string, enabled: boolean) {
  return useQuery({
    queryKey: userIpsKeys.one(username),
    queryFn: ({ signal }) =>
      api.get<UserIPsResponse>(`/user/${encodeURIComponent(username)}/ips`, { signal }),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 60_000,
  })
}

/** Human label for a wire status, translated by the caller. */
export function statusLabelKey(status: UserStatus | string): string {
  switch (status) {
    case "active":
    case "connected":
    case "connecting":
      return "status.active"
    case "disabled":
      return "status.disabled"
    case "expired":
      return "status.expired"
    case "limited":
      return "status.limited"
    case "on_hold":
      return "status.on_hold"
    default:
      return "status.unknown"
  }
}
