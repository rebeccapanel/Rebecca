import { ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"

import type { NavGroupData, NavItem, NavLink } from "@/config/nav"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

function SoonBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className="ms-auto rounded-full border-sidebar-border/80 px-1.5 py-0 text-[0.5625rem] font-medium uppercase tracking-wide text-muted-foreground/80"
    >
      {label}
    </Badge>
  )
}

function isActive(pathname: string, item: NavLink, parent = false): boolean {
  if (pathname === item.url) return true
  if (item.url !== "/" && pathname.startsWith(`${item.url}/`)) return true
  return parent && pathname.split("/")[1] !== "" && pathname.split("/")[1] === item.url.split("/")[1]
}

function SidebarMenuLink({ item }: { item: NavLink }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(pathname, item)} tooltip={t(item.titleKey)}>
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {Icon ? <Icon /> : null}
          <span>{t(item.titleKey)}</span>
          {item.soon ? <SoonBadge label={t("next.nav.soon")} /> : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsible({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const Icon = item.icon

  return (
    <Collapsible asChild defaultOpen={isActive(pathname, item, true)} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={t(item.titleKey)}>
            {Icon ? <Icon /> : null}
            <span>{t(item.titleKey)}</span>
            <ChevronRight className="ms-auto size-3.5 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180 rtl:group-data-[state=open]/collapsible:-rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items?.map((subItem) => (
              <SidebarMenuSubItem key={subItem.url}>
                <SidebarMenuSubButton asChild isActive={isActive(pathname, subItem)}>
                  <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                    <span>{t(subItem.titleKey)}</span>
                    {subItem.soon ? <SoonBadge label={t("next.nav.soon")} /> : null}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function SidebarMenuCollapsedDropdown({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={t(item.titleKey)} isActive={isActive(pathname, item, true)}>
            {item.icon ? <item.icon /> : null}
            <span>{t(item.titleKey)}</span>
            <ChevronRight className="ms-auto size-3.5" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4} className="min-w-48">
          <DropdownMenuLabel>{t(item.titleKey)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.items?.map((sub) => (
            <DropdownMenuItem key={sub.url} asChild>
              <Link to={sub.url} className={cn(isActive(pathname, sub) && "bg-accent")}>
                <span className="max-w-52 text-wrap">{t(sub.titleKey)}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

/**
 * One sidebar section: plain links, collapsible parents, and — when the sidebar
 * is collapsed to an icon rail — a flyout menu for parents with children.
 */
export function NavGroup({ titleKey, items }: NavGroupData) {
  const { t } = useTranslation()
  const { state, isMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[0.6875rem] uppercase tracking-[0.12em]">
        {t(titleKey)}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        {items.map((item) => {
          const key = `${item.titleKey}-${item.url}`
          if (!item.items) return <SidebarMenuLink key={key} item={item} />
          if (state === "collapsed" && !isMobile)
            return <SidebarMenuCollapsedDropdown key={key} item={item} />
          return <SidebarMenuCollapsible key={key} item={item} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
