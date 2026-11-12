import { ChevronsUpDown, LogOut, MonitorCog, Moon, Sun, UserRound } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useCurrentAdmin, useLogout } from "@/features/auth/api"
import { useLayout } from "@/context/layout-provider"

function initials(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  if (!clean) return "?"
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const ROLE_KEY: Record<string, string> = {
  full_access: "next.role.full_access",
  sudo: "next.role.sudo",
  reseller: "next.role.reseller",
  standard: "next.role.standard",
}

/** Signed-in operator: identity, theme, layout and sign-out. */
export function NavUser() {
  const { t } = useTranslation()
  const admin = useCurrentAdmin()
  const logout = useLogout()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { setVariant, variant } = useLayout()
  const { isMobile } = useSidebar()

  if (!admin) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="h-12 animate-pulse rounded-lg bg-sidebar-accent/60" />
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const role = ROLE_KEY[admin.role] ? t(ROLE_KEY[admin.role]) : admin.role

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-12 gap-2.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-sidebar-primary/12 text-[0.7rem] font-semibold text-sidebar-primary">
                  {initials(admin.username)}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate text-[0.8125rem] font-medium">{admin.username}</span>
                <span className="truncate text-[0.6875rem] text-muted-foreground">{role}</span>
              </span>
              <ChevronsUpDown className="ms-auto size-3.5 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-60 rounded-xl"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={6}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-start">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/12 text-[0.7rem] font-semibold text-primary">
                    {initials(admin.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-[0.8125rem] font-medium">{admin.username}</span>
                  <span className="truncate text-[0.6875rem] text-muted-foreground">{role}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => navigate("/settings")}>
                <UserRound />
                {t("next.account.title")}
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {theme === "dark" ? <Moon /> : <Sun />}
                  {t("next.header.theme")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => setTheme("light")}>
                    <Sun />
                    {t("theme.light")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTheme("dark")}>
                    <Moon />
                    {t("theme.dark")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTheme("system")}>
                    <MonitorCog />
                    {t("next.header.themeSystem")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <MonitorCog />
                  {t("next.layout.title")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(["inset", "sidebar", "floating"] as const).map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onSelect={() => setVariant(option)}
                      className={variant === option ? "bg-accent" : undefined}
                    >
                      {t(`next.layout.${option}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={logout.isPending}
              onSelect={() => logout.mutate()}
            >
              <LogOut />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
