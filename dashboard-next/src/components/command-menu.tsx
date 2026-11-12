import { ArrowRight, Languages, Moon, Search, Sun } from "lucide-react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { NAV_GROUPS } from "@/config/nav"
import { useSearch } from "@/context/search-provider"
import { useTheme } from "@/components/theme-provider"
import { SUPPORTED_LOCALES } from "@/i18n"

/**
 * ⌘K palette: jump to any screen, search a username, or switch theme/language
 * without leaving the keyboard.
 */
export function CommandMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()

  const run = useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen],
  )

  const current = (i18n.language || "en").slice(0, 2)

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("next.command.title")}
      className="max-w-xl"
    >
      {/* The dialog is only the surface; cmdk's store lives in <Command>. */}
      <Command>
        <CommandInput placeholder={t("next.command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("next.command.empty")}</CommandEmpty>

        {NAV_GROUPS.map((group) => (
          <CommandGroup key={group.titleKey} heading={t(group.titleKey)}>
            {group.items.flatMap((item) =>
              item.items
                ? item.items.map((sub) => (
                    <CommandItem
                      key={sub.url}
                      value={`${t(item.titleKey)} ${t(sub.titleKey)}`}
                      onSelect={() => run(() => navigate(sub.url))}
                    >
                      <ArrowRight className="size-3 text-muted-foreground/70 rtl:-scale-x-100" />
                      {t(sub.titleKey)}
                    </CommandItem>
                  ))
                : [
                    <CommandItem
                      key={item.url}
                      value={t(item.titleKey)}
                      onSelect={() => run(() => navigate(item.url))}
                    >
                      <ArrowRight className="size-3 text-muted-foreground/70 rtl:-scale-x-100" />
                      {t(item.titleKey)}
                    </CommandItem>,
                  ],
            )}
          </CommandGroup>
        ))}

        <CommandSeparator />

        <CommandGroup heading={t("next.nav.users")}>
          <CommandItem
            value="__user-search__"
            onSelect={() => run(() => navigate("/users"))}
          >
            <Search className="size-3.5 text-muted-foreground" />
            {t("next.command.openUsers")}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("next.header.theme")}>
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun className="size-3.5" />
            {t("theme.light")}
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon className="size-3.5" />
            {t("theme.dark")}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={t("next.header.language")}>
          {SUPPORTED_LOCALES.map((locale) => (
            <CommandItem
              key={locale.code}
              value={`${t("next.header.language")} ${locale.native}`}
              onSelect={() => run(() => void i18n.changeLanguage(locale.code))}
            >
              <Languages className="size-3.5" />
              {locale.native}
              {locale.code === current ? (
                <span className="ms-auto text-[0.625rem] uppercase text-muted-foreground">
                  {t("next.command.current")}
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-[0.625rem] text-muted-foreground">
          <span>{t("next.command.hint")}</span>
          <kbd dir="ltr" className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono">
            Esc
          </kbd>
        </div>
      </Command>
    </CommandDialog>
  )
}
