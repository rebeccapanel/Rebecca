import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { SystemStats } from "@/types/api"

export const systemKeys = { stats: ["system", "stats"] as const }

export function useSystemStats() {
  return useQuery({
    queryKey: systemKeys.stats,
    queryFn: () => api.get<SystemStats>("/system"),
    refetchInterval: 20_000,
    retry: 1,
  })
}
