import { Navigate, Outlet, useLocation } from "react-router-dom"

import { BrandMark } from "@/components/layout/brand-mark"
import { useAuth } from "@/features/auth/api"

function BootScreen() {
  return (
    <div className="grid min-h-svh place-items-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="size-10 animate-pulse" />
        <span className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Rebecca
        </span>
      </div>
    </div>
  )
}

/** Gate for every signed-in route. */
export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === "loading") return <BootScreen />
  if (auth.status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
