import { Suspense } from "react"
import { Outlet } from "react-router-dom"

import { CommandMenu } from "@/components/command-menu"
import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { PageFallback } from "@/components/layout/page-fallback"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

/**
 * Application shell. The sidebar shape comes from the persisted layout
 * preference (read by `AppSidebar`); only the page area scrolls, so tables keep
 * a stable header.
 */
export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden md:h-[calc(100svh-1rem)]">
        <AppHeader />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1680px] px-4 py-6 md:px-7 md:py-7">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  )
}
