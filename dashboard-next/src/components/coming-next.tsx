import { Construction } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Link } from "react-router-dom"

type ComingNextProps = {
  titleKey: string
  descriptionKey: string
  /** What exists in the old dashboard today, shown as scope notes. */
  bullets?: string[]
  fileSize?: string
}

/**
 * Honest placeholder for the screens scheduled after the first slice. It tells
 * the operator exactly what is planned instead of pretending to be a settings
 * page that silently discards input.
 */
export function ComingNext({ titleKey, descriptionKey, bullets = [], fileSize }: ComingNextProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(titleKey)}
        description={t(descriptionKey)}
        actions={
          <Badge variant="outline" className="gap-1.5 border-warning/35 bg-warning/10 text-warning">
            <Construction className="size-3" />
            {t("next.soon.badge")}
          </Badge>
        }
      />

      <Card className="border-dashed bg-card/40">
        <CardContent className="flex flex-col items-start gap-4 py-8">
          <div className="space-y-1.5">
            <h2 className="text-[0.9375rem] font-medium">{t("next.soon.title")}</h2>
            <p className="max-w-xl text-[0.8125rem] leading-relaxed text-muted-foreground">
              {t("next.soon.body")}
            </p>
            {fileSize ? (
              <p className="text-[0.75rem] text-muted-foreground/80">
                {t("next.soon.currentSize", { size: fileSize })}
              </p>
            ) : null}
          </div>

          {bullets.length ? (
            <ul className="grid gap-1.5 text-[0.8125rem] text-muted-foreground">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  {bullet}
                </li>
              ))}
            </ul>
          ) : null}

          <Button asChild variant="outline" size="sm">
            <Link to="/users">{t("next.soon.goUsers")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
