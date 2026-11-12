import { lazy } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"

import { AppLayout } from "@/components/layout/app-layout"
import { ComingNext } from "@/components/coming-next"
import { LoginPage } from "@/features/auth/login-page"
import { RequireAuth } from "@/features/auth/require-auth"
import { NotFoundPage } from "@/features/not-found-page"

// Route-level chunks: the shell paints first, each screen arrives on navigation.
const OverviewPage = lazy(() =>
  import("@/features/overview/overview-page").then((module) => ({ default: module.OverviewPage })),
)
const UsersPage = lazy(() =>
  import("@/features/users/users-page").then((module) => ({ default: module.UsersPage })),
)
const AdminsPage = lazy(() =>
  import("@/features/admins/admins-page").then((module) => ({ default: module.AdminsPage })),
)
const HostsPage = lazy(() =>
  import("@/features/hosts/hosts-page").then((module) => ({ default: module.HostsPage })),
)
const NodesPage = lazy(() =>
  import("@/features/nodes/nodes-page").then((module) => ({ default: module.NodesPage })),
)
const ServicesPage = lazy(() =>
  import("@/features/services/services-page").then((module) => ({ default: module.ServicesPage })),
)

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <OverviewPage />,
            handle: { titleKey: "next.nav.dashboard" },
          },
          {
            path: "users",
            element: <UsersPage />,
            handle: { titleKey: "next.nav.users" },
          },
          {
            path: "admins",
            element: <AdminsPage />,
            handle: { titleKey: "next.nav.admins" },
          },
          {
            path: "hosts",
            element: <HostsPage />,
            handle: { titleKey: "next.nav.hosts" },
          },
          {
            path: "nodes",
            element: <NodesPage />,
            handle: { titleKey: "next.nav.nodes" },
          },
          {
            path: "services",
            element: <ServicesPage />,
            handle: { titleKey: "next.nav.services" },
          },
          {
            path: "settings/core",
            element: (
              <ComingNext
                titleKey="next.nav.core"
                descriptionKey="next.page.core.desc"
                fileSize="6,232"
                bullets={[
                  "Core settings, quotas and Xray JSON editing.",
                  "Advanced routing, inbounds and outbounds.",
                  "Ships after the access pages are stable.",
                ]}
              />
            ),
            handle: { titleKey: "next.nav.core" },
          },
          {
            path: "settings/integrations",
            element: (
              <ComingNext
                titleKey="next.nav.integrations"
                descriptionKey="next.page.integrations.desc"
                fileSize="4,055"
                bullets={[
                  "Telegram bot, notifications and backups.",
                  "Webhooks and external systems.",
                  "Ships last, together with core settings.",
                ]}
              />
            ),
            handle: { titleKey: "next.nav.integrations" },
          },
          {
            path: "settings",
            element: (
              <ComingNext
                titleKey="next.nav.settings"
                descriptionKey="next.page.settings.desc"
                bullets={["Panel-wide defaults and maintenance actions."]}
              />
            ),
            handle: { titleKey: "next.nav.settings" },
          },
          { path: "settings/*", element: <Navigate to="/settings" replace /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
])
