import { ArrowRight, Loader2, LockKeyhole, ShieldCheck, UserRound } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/layout/brand-mark"
import { LanguageSwitcher } from "@/components/layout/language-switcher"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLogin, useSession } from "@/features/auth/api"
import { errorMessage } from "@/lib/api"
import { SignalField } from "@/features/auth/signal-field"

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useLogin()
  const session = useSession()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  useEffect(() => {
    if (session.data?.state === "active") navigate("/", { replace: true })
  }, [session.data, navigate])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    login.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (result) => {
          if (result.state === "active") navigate("/", { replace: true })
        },
      },
    )
  }

  const needs2fa = login.data?.state === "pending_2fa"
  const blocked = login.data && (login.data.state === "disabled" || login.data.state === "setup_required")

  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex flex-col bg-background">
        <div className="flex items-center justify-between p-4 md:p-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-[0.9375rem] font-semibold tracking-tight">Rebecca</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-[23rem]">
            <div className="mb-7 space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <ShieldCheck className="size-3" />
                {t("next.login.badge")}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("next.login.title")}</h1>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{t("next.login.subtitle")}</p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-[0.8125rem]">
                  {t("next.login.username")}
                </Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    dir="ltr"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="admin"
                    className="h-10 ps-9 placeholder:text-muted-foreground/45"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[0.8125rem]">
                  {t("next.login.password")}
                </Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    dir="ltr"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="h-10 ps-9 placeholder:text-muted-foreground/45"
                  />
                </div>
              </div>

              {login.isError ? (
                <Alert variant="destructive" className="py-2.5">
                  <AlertTitle className="text-[0.8125rem]">{t("next.login.failedTitle")}</AlertTitle>
                  <AlertDescription className="text-xs">
                    {errorMessage(login.error) || t("next.login.failedBody")}
                  </AlertDescription>
                </Alert>
              ) : null}

              {blocked ? (
                <Alert variant="destructive" className="py-2.5">
                  <AlertTitle className="text-[0.8125rem]">{t("usersTable.adminDisabledTitle")}</AlertTitle>
                  <AlertDescription className="text-xs">{t("usersTable.adminDisabledDescription")}</AlertDescription>
                </Alert>
              ) : null}

              {needs2fa ? (
                <Alert className="py-2.5">
                  <AlertTitle className="text-[0.8125rem]">{t("next.login.twoFactorTitle")}</AlertTitle>
                  <AlertDescription className="text-xs">{t("next.login.twoFactorBody")}</AlertDescription>
                </Alert>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="h-10 w-full gap-2 text-[0.875rem] font-medium"
                disabled={login.isPending || !username.trim() || !password}
              >
                {login.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {login.isPending ? t("next.login.submitting") : t("next.login.submit")}
                {!login.isPending ? <ArrowRight className="size-4 rtl:rotate-180" /> : null}
              </Button>
            </form>

            <p className="mt-6 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-3 shrink-0" />
              {t("next.login.cookieNote")}
            </p>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-s border-border bg-[oklch(0.18_0.02_240)] lg:block">
        <SignalField />
      </div>
    </div>
  )
}
