import { Loader2, Search, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** When present, the Aa / ab toggles render inside the field. */
  matchCase?: boolean
  matchWholeWord?: boolean
  onMatchChange?: (next: { matchCase?: boolean; matchWholeWord?: boolean }) => void
  loading?: boolean
  className?: string
  inputClassName?: string
  "aria-label"?: string
}

/**
 * Search input with the legacy panel's inline matching toggles: "Aa" for
 * case-sensitive matching and an underlined "ab" for whole-word matching. The
 * toggles live inside the field so the option is never hidden in a menu.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  matchCase,
  matchWholeWord,
  onMatchChange,
  loading,
  className,
  inputClassName,
  "aria-label": ariaLabel,
}: SearchFieldProps) {
  const { t } = useTranslation()
  const showToggles = Boolean(onMatchChange)

  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-sm", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "h-8 pe-9 ps-8 text-[0.8125rem]",
          showToggles && "pe-[5.75rem]",
          inputClassName,
        )}
      />

      <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {loading ? <Loader2 className="me-1 size-3.5 animate-spin text-muted-foreground" /> : null}

        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded text-muted-foreground hover:text-foreground"
            onClick={() => onChange("")}
            aria-label={t("next.users.clear")}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}

        {showToggles ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={matchCase ? "secondary" : "ghost"}
                  size="icon"
                  aria-label={t("search.matchCase")}
                  aria-pressed={Boolean(matchCase)}
                  onClick={() => onMatchChange?.({ matchCase: !matchCase })}
                  className={cn(
                    "h-6 w-6 rounded text-[0.6875rem] font-semibold leading-none",
                    matchCase ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Aa
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("search.matchCase")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={matchWholeWord ? "secondary" : "ghost"}
                  size="icon"
                  aria-label={t("search.matchWholeWord")}
                  aria-pressed={Boolean(matchWholeWord)}
                  onClick={() => onMatchChange?.({ matchWholeWord: !matchWholeWord })}
                  className={cn(
                    "h-6 w-6 rounded text-[0.6875rem] font-medium leading-none underline decoration-1 underline-offset-2",
                    matchWholeWord ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  ab
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("search.matchWholeWord")}</TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </div>
    </div>
  )
}
