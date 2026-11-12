import type { LucideIcon } from "lucide-react"
import {
  Boxes,
  Gauge,
  Layers,
  Network,
  Plug,
  ServerCog,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react"

export type NavLink = {
  /** i18n key, resolved at render time so the label follows the language. */
  titleKey: string
  url: string
  icon?: LucideIcon
  /** Small trailing badge, already translated by the caller when rendered. */
  badgeKey?: string
  /** Marks a screen that is scheduled rather than shipped. */
  soon?: boolean
}

export type NavItem = NavLink & {
  items?: NavLink[]
}

export type NavGroupData = {
  titleKey: string
  items: NavItem[]
}

/**
 * Information architecture for the console. Parent items with children render
 * as collapsible groups (and as a flyout when the sidebar is an icon rail).
 */
export const NAV_GROUPS: NavGroupData[] = [
  {
    titleKey: "next.nav.group.overview",
    items: [
      { titleKey: "next.nav.dashboard", url: "/", icon: Gauge },
      { titleKey: "next.nav.users", url: "/users", icon: UsersRound },
    ],
  },
  {
    titleKey: "next.nav.group.access",
    items: [
      { titleKey: "next.nav.admins", url: "/admins", icon: ShieldCheck },
      { titleKey: "next.nav.hosts", url: "/hosts", icon: ServerCog },
      { titleKey: "next.nav.nodes", url: "/nodes", icon: Network },
      { titleKey: "next.nav.services", url: "/services", icon: Layers },
    ],
  },
  {
    titleKey: "next.nav.group.platform",
    items: [
      {
        titleKey: "next.nav.settings",
        url: "/settings",
        icon: Settings2,
        items: [
          { titleKey: "next.nav.core", url: "/settings/core", icon: Boxes, soon: true },
          { titleKey: "next.nav.integrations", url: "/settings/integrations", icon: Plug, soon: true },
          { titleKey: "next.nav.panel", url: "/settings", icon: Settings2, soon: true },
        ],
      },
    ],
  },
]

/** Flat list of every leaf route, used by the command palette. */
export const NAV_LEAVES: NavLink[] = NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((item) => (item.items ? item.items : [item])),
)
