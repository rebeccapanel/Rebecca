import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"
import type { HostsByInbound } from "@/types/api"

export const hostsKeys = {
  all: ["hosts"] as const,
  list: () => [...hostsKeys.all, "list"] as const,
}

/** 403 (and 401) are settled answers, not transient failures: never retry them. */
export function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 401)
  )
}

/**
 * `GET /api/hosts` returns one object keyed by inbound tag — no envelope and no
 * pagination. The page flattens it into rows for the shared data table.
 */
export function useHosts() {
  return useQuery({
    queryKey: hostsKeys.list(),
    queryFn: ({ signal }) => api.get<HostsByInbound>("/hosts", { signal }),
    staleTime: 30_000,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  })
}

/**
 * `PUT /api/hosts/{id}/status` toggles one host. Deliberately not
 * `PUT /api/hosts`, which would replace the whole grouped inbound map.
 */
export function useSetHostStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isDisabled }: { id: number; isDisabled: boolean }) =>
      api.put<void>(`/hosts/${id}/status`, { is_disabled: isDisabled }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: hostsKeys.all }),
  })
}
