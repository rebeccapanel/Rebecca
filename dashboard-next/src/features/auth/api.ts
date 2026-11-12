import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { api, ApiError } from "@/lib/api"
import type { Session } from "@/types/api"

const SESSION_KEY = ["session"] as const

export const authApi = {
  session: () => api.get<Session>("/auth/session", { silentUnauthorized: true }),
  login: (username: string, password: string) =>
    api.post<Session>("/auth/login", { username, password }),
  logout: () => api.post<void>("/auth/logout"),
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: authApi.session,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // A 401 is a normal "not signed in" answer, never worth retrying.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false
      return failureCount < 2
    },
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_KEY, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(SESSION_KEY, null)
    },
  })
}

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: Session }

export function useAuth(): AuthState {
  const { data, isLoading, isError, error } = useSession()

  if (isLoading) return { status: "loading" }
  if (isError || !data) {
    if (error instanceof ApiError && error.status === 0) return { status: "anonymous" }
    return { status: "anonymous" }
  }
  if (data.state !== "active") return { status: "anonymous" }
  return { status: "authenticated", session: data }
}

/** Typed accessor for the signed-in admin, or `null`. */
export function useCurrentAdmin() {
  const { data } = useSession()
  return data?.state === "active" ? data.admin : null
}

export function useInvalidateSession() {
  const queryClient = useQueryClient()
  return useCallback(() => queryClient.invalidateQueries({ queryKey: SESSION_KEY }), [queryClient])
}
