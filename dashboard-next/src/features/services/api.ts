import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { ServicesResponse } from "@/types/api"

export type ServicesQuery = {
  offset: number
  limit: number
  /** Case-insensitive substring match on the service name. */
  name?: string
}

export const servicesKeys = {
  all: ["services"] as const,
  list: (query: ServicesQuery) => [...servicesKeys.all, "list", query] as const,
}

export function useServices(query: ServicesQuery) {
  return useQuery({
    queryKey: servicesKeys.list(query),
    queryFn: ({ signal }) =>
      // `GET /api/v2/services` — there is no `/api/services` (§6.1 of the contract).
      api.get<ServicesResponse>("/v2/services", {
        signal,
        params: {
          offset: query.offset,
          limit: query.limit,
          name: query.name,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

/** `POST /api/v2/services/{id}/reset-usage` — sudo-only, returns the service detail. */
export function useResetServiceUsage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/v2/services/${id}/reset-usage`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: servicesKeys.all }),
  })
}

/** `DELETE /api/v2/services/{id}` — sudo-only, 204 on success. */
export function useDeleteService() {
  const queryClient = useQueryClient()
  return useMutation({
    // `handleServiceDelete` decodes a body: without `unlink_admins` a linked
    // admin blocks the delete, and users can only be moved, never detached.
    mutationFn: (id: number) =>
      api.delete<void>(`/v2/services/${id}`, { unlink_admins: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: servicesKeys.all }),
  })
}
