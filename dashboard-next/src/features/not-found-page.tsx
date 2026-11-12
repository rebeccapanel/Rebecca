import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="grid min-h-svh place-items-center bg-background px-6">
      <div className="space-y-3 text-center">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="text-[0.8125rem] text-muted-foreground">
          The link may be from the previous dashboard. Everything below is in the new console.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
