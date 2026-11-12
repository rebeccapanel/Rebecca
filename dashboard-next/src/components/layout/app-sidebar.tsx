import { useTranslation } from "react-i18next"

import { AppTitle } from "@/components/layout/app-title"
import { NavGroup } from "@/components/layout/nav-group"
import { NavUser } from "@/components/layout/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { NAV_GROUPS } from "@/config/nav"
import { useLayout } from "@/context/layout-provider"
import { useDirection } from "@/lib/use-direction"

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const direction = useDirection()
  const { t } = useTranslation()

  return (
    <Sidebar
      collapsible={collapsible}
      variant={variant}
      side={direction === "rtl" ? "right" : "left"}
      aria-label={t("next.nav.label")}
    >
      <SidebarHeader className="pb-1">
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <NavGroup key={group.titleKey} {...group} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
