import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"

import { SUPPORTED_LOCALES } from "@/i18n"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = (i18n.language || "en").slice(0, 2)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <Languages className="size-4" />
          <span className="text-xs font-medium uppercase tabular">{current}</span>
          <span className="sr-only">{t("next.header.language")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("next.header.language")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => void i18n.changeLanguage(value)}>
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale.code} value={locale.code}>
              {locale.native}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
