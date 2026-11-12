import { Search } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMatches } from "react-router-dom"

import { LanguageSwitcher } from "@/components/layout/language-switcher"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useSearch } from "@/context/search-provider"
import { cn } from "@/lib/utils"

type RouteHandle = { titleKey?: string }

/**
 * Sticky app header: sidebar toggle, breadcrumb and global actions. The surface
 * only gains its blur and hairline after the page scrolls, so the top of every
 * screen stays quiet.
 */
export function AppHeader() {
  const { t } = useTranslation()
  const matches = useMatches()
  const { setOpen } = useSearch()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const titleKey = [...matches].reverse().find((match) => (match.handle as RouteHandle)?.titleKey)
    ?.handle as RouteHandle | undefined

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 px-3 transition-colors md:px-4",
        scrolled &&
          "border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65",
      )}
    >
      <SidebarTrigger variant="outline" className="-ms-0.5 size-8 text-muted-foreground" />
      <Separator orientation="vertical" className="me-0.5 hidden h-5 sm:block" />

      <div className="flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
        <span className="hidden truncate text-muted-foreground sm:inline">Rebecca</span>
        <span className="hidden text-muted-foreground/40 sm:inline">/</span>
        <span className="truncate font-medium text-foreground/90">
          {titleKey?.titleKey ? t(titleKey.titleKey) : "Rebecca"}
        </span>
      </div>

      <div className="ms-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="hidden h-8 gap-2 pe-1.5 ps-2.5 text-[0.75rem] font-normal text-muted-foreground md:flex"
        >
          <Search className="size-3.5" />
          <span>{t("next.header.search")}</span>
          <kbd
            dir="ltr"
            className="pointer-events-none rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[0.625rem] leading-none"
          >
            Ctrl K
          </kbd>
        </Button>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  )
}
