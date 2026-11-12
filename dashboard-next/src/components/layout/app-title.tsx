import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { BrandMark } from "@/components/layout/brand-mark"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

/** Brand block at the top of the sidebar, with the rail toggle beside it. */
export function AppTitle() {
  const { t } = useTranslation()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="gap-2 py-0 hover:bg-transparent active:bg-transparent"
          asChild
        >
          <div>
            <Link
              to="/"
              onClick={() => setOpenMobile(false)}
              className="flex flex-1 items-center gap-2.5 text-start leading-tight"
            >
              <BrandMark className="size-8 shrink-0" />
              <span className="grid min-w-0">
                <span className="truncate text-[0.9375rem] font-semibold tracking-tight">Rebecca</span>
                <span className="truncate text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {t("next.brand.tagline")}
                </span>
              </span>
            </Link>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
