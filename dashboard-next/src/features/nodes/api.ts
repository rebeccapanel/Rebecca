import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"
import type { Node } from "@/types/api"

export const nodesKeys = {
  all: ["nodes"] as const,
  list: () => [...nodesKeys.all, "list"] as const,
}

/** 403 (and 401) are settled answers, not transient failures: never retry them. */
export function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 401)
  )
}

/**
 * `GET /api/nodes` returns a bare array — no envelope, filters, sorting or
 * pagination — so health is polled on a short interval instead.
 */
export function useNodes() {
  return useQuery({
    queryKey: nodesKeys.list(),
    queryFn: ({ signal }) => api.get<Node[]>("/nodes", { signal }),
    refetchInterval: (query) =>
      isForbidden(query.state.error) ? false : 15_000,
    staleTime: 10_000,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  })
}

/** Sudo-only node operations; each refreshes the whole node list on settle. */
export function useReconnectNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/node/${id}/reconnect`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodesKeys.all }),
  })
}

export function useRestartNodeCore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/node/${id}/restart`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodesKeys.all }),
  })
}

export function useUpdateNodeXray() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/node/${id}/xray/update`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodesKeys.all }),
  })
}

export function useSyncNodeConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/node/${id}/sync`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodesKeys.all }),
  })
}

export function useDeleteNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/node/${id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodesKeys.all }),
  })
}
