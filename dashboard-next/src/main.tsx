import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"

import { installMockApi } from "@/dev/mock-api"

import "@/i18n"
import "./index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LayoutProvider } from "@/context/layout-provider"
import { SearchProvider } from "@/context/search-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UNAUTHORIZED_EVENT } from "@/lib/api"
import { router } from "@/router"

installMockApi()

// `?theme=light|dark` pins the palette for screenshots and design review.
const themeParam = new URLSearchParams(window.location.search).get("theme")
if (themeParam === "light" || themeParam === "dark") {
  window.localStorage.setItem("rebecca.theme", themeParam)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
})

// A 401 from any request means the session expired: drop the cached session so
// RequireAuth sends the operator back to the sign-in screen.
window.addEventListener(UNAUTHORIZED_EVENT, () => {
  queryClient.setQueryData(["session"], null)
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="rebecca.theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <LayoutProvider>
            <SearchProvider>
              <RouterProvider router={router} />
              <Toaster />
            </SearchProvider>
          </LayoutProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
