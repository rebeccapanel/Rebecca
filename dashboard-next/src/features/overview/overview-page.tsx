import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpToLine,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldHalf,
  UserRoundX,
  UsersRound,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/layout/page-header"
import { Num } from "@/components/num"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemStats } from "@/features/overview/api"
import { KpiCard, ResourceCard } from "@/features/overview/cards"
import { Sparkline } from "@/features/overview/sparkline"
import { useFormat } from "@/lib/use-format"
import { cn } from "@/lib/utils"
import type { HistoryPoint } from "@/types/api"

function average(points: HistoryPoint[]): number {
  if (!points.length) return 0
  return points.reduce((sum, point) => sum + point.value, 0) / points.length
}

function peak(points: HistoryPoint[]): number {
  if (!points.length) return 0
  return Math.max(...points.map((point) => point.value))
}

function SectionCard({
  title,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string
  icon: typeof Cpu
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/70 py-3">
        <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium">
          <span className="grid size-6 place-items-center rounded-md bg-muted/60 text-muted-foreground">
            <Icon className="size-3.5" />
          </span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className={cn("p-4", contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { data, isPending, isError, refetch, isFetching, dataUpdatedAt } = useSystemStats()

  const totalUsers = data?.total_user ?? 0
  const share = (value: number | undefined) => (totalUsers > 0 ? (value ?? 0) / totalUsers : 0)

  const kpis = [
    {
      key: "dashboard.users.total",
      value: totalUsers,
      icon: UsersRound,
      tone: "text-foreground",
      hint: `${format.number(data?.online_users)} ${t("next.users.online")}`,
    },
    {
      key: "dashboard.users.active",
      value: data?.users_active,
      icon: Activity,
      tone: "text-success",
      hint: t("next.stat.share", { percent: Math.round(share(data?.users_active) * 100) }),
    },
    {
      key: "dashboard.users.online",
      value: data?.online_users,
      icon: Gauge,
      tone: "text-primary",
      hint: t("next.stat.share", { percent: Math.round(share(data?.online_users) * 100) }),
    },
    {
      key: "dashboard.users.limited",
      value: data?.users_limited,
      icon: CircleAlert,
      tone: "text-warning",
      hint: t("next.stat.share", { percent: Math.round(share(data?.users_limited) * 100) }),
    },
    {
      key: "dashboard.users.expired",
      value: data?.users_expired,
      icon: UserRoundX,
      tone: "text-destructive",
      hint: t("next.stat.share", { percent: Math.round(share(data?.users_expired) * 100) }),
    },
    {
      key: "dashboard.users.onHold",
      value: data?.users_on_hold,
      icon: Clock3,
      tone: "text-info",
      hint: t("next.stat.share", { percent: Math.round(share(data?.users_on_hold) * 100) }),
    },
  ]

  const resources = [
    {
      label: t("dashboard.system.cpuUsage"),
      value: `${format.number(data?.cpu_usage, { maximumFractionDigits: 1 })}%`,
      detail: `${format.number(data?.cpu_threads)} ${t("next.overview.threads")}`,
      percent: data?.cpu_usage ?? 0,
      percentLabel: `${format.number(data?.cpu_usage, { maximumFractionDigits: 0 })}%`,
      points: data?.cpu_history ?? [],
    },
    {
      label: t("dashboard.system.memoryUsage"),
      value: format.bytes(data?.memory.current),
      detail: `/ ${format.bytes(data?.memory.total)}`,
      percent: data?.memory.percent ?? 0,
      percentLabel: `${format.number(data?.memory.percent, { maximumFractionDigits: 0 })}%`,
      points: data?.memory_history ?? [],
    },
    {
      label: t("dashboard.system.swapUsage"),
      value: format.bytes(data?.swap.current),
      detail: `/ ${format.bytes(data?.swap.total)}`,
      percent: data?.swap.percent ?? 0,
      percentLabel: `${format.number(data?.swap.percent, { maximumFractionDigits: 0 })}%`,
      points: [] as HistoryPoint[],
    },
    {
      label: t("dashboard.system.diskUsage"),
      value: format.bytes(data?.disk.current),
      detail: `/ ${format.bytes(data?.disk.total)}`,
      percent: data?.disk.percent ?? 0,
      percentLabel: `${format.number(data?.disk.percent, { maximumFractionDigits: 0 })}%`,
      points: [] as HistoryPoint[],
    },
  ]

  const admins = [
    { label: t("dashboard.admins.total"), value: data?.admin_overview?.total_admins },
    { label: t("dashboard.admins.sudo"), value: data?.admin_overview?.sudo_admins },
    { label: t("dashboard.admins.fullAccess"), value: data?.admin_overview?.full_access_admins },
    { label: t("dashboard.admins.standard"), value: data?.admin_overview?.standard_admins },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("next.nav.dashboard")}
        description={t("next.page.dashboard.desc")}
        actions={
          <>
            <Badge
              variant="outline"
              className={cn(
                "h-7 gap-1.5 border px-2 text-[0.6875rem] font-medium",
                data?.xray_running
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border bg-muted/50 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  data?.xray_running ? "animate-pulse bg-success" : "bg-muted-foreground/60",
                )}
              />
              {t("xrayStatus")} ·{" "}
              {data?.xray_running ? t("dashboard.system.statusRunning") : t("dashboard.system.statusStopped")}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
              {t("refresh")}
            </Button>
          </>
        }
      />

      {isError ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-[0.8125rem] text-muted-foreground">
            {t("next.overview.unavailable")}
          </CardContent>
        </Card>
      ) : null}

      {/* Row 1: six user counters sharing one scale. */}
      <div className="stagger-in grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.key}
            label={t(kpi.key)}
            value={format.number(kpi.value)}
            hint={kpi.hint}
            icon={kpi.icon}
            tone={kpi.tone}
            loading={isPending}
          />
        ))}
      </div>

      {/* Row 2: host resources. */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {resources.map((resource) => (
          <ResourceCard
            key={resource.label}
            label={resource.label}
            value={resource.value}
            detail={resource.detail}
            percent={resource.percent}
            percentLabel={resource.percentLabel}
            loading={isPending}
            footerLeft={
              resource.points.length
                ? `${t("dashboard.system.average")} ${format.number(average(resource.points), { maximumFractionDigits: 1 })}%`
                : undefined
            }
            footerRight={
              resource.points.length
                ? `${t("dashboard.system.peak")} ${format.number(peak(resource.points), { maximumFractionDigits: 1 })}%`
                : undefined
            }
          />
        ))}
      </div>

      {/* Row 3: bandwidth trend beside the rest of the system state. */}
      <div className="grid gap-2.5 lg:grid-cols-3">
        <SectionCard
          title={t("dashboard.system.bandwidthSpeed")}
          icon={Activity}
          className="lg:col-span-2"
          action={
            <div className="hidden items-center gap-3 text-[0.6875rem] sm:flex">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-chart-1" />
                {t("dashboard.system.networkIncoming")}
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-chart-3" />
                {t("dashboard.system.networkOutgoing")}
              </span>
            </div>
          }
          contentClassName="p-0"
        >
          <div className="grid grid-cols-2 divide-x divide-border/70 border-b border-border/70">
            <div className="flex items-center gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-chart-1/10 text-chart-1">
                <ArrowDownToLine className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[0.6875rem] text-muted-foreground">{t("dashboard.system.incomingSpeed")}</p>
                <Num className="text-[1.0625rem] font-semibold leading-tight">
                  {format.bytes(data?.incoming_bandwidth_speed)}
                  <span className="text-[0.6875rem] font-normal text-muted-foreground">/s</span>
                </Num>
              </div>
              <div className="ms-auto hidden text-end sm:block">
                <p className="text-[0.625rem] text-muted-foreground">{t("dashboard.system.networkIncoming")}</p>
                <Num className="text-[0.75rem] text-muted-foreground">{format.bytes(data?.incoming_bandwidth)}</Num>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-chart-3/10 text-chart-3">
                <ArrowUpToLine className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[0.6875rem] text-muted-foreground">{t("dashboard.system.outgoingSpeed")}</p>
                <Num className="text-[1.0625rem] font-semibold leading-tight">
                  {format.bytes(data?.outgoing_bandwidth_speed)}
                  <span className="text-[0.6875rem] font-normal text-muted-foreground">/s</span>
                </Num>
              </div>
              <div className="ms-auto hidden text-end sm:block">
                <p className="text-[0.625rem] text-muted-foreground">{t("dashboard.system.networkOutgoing")}</p>
                <Num className="text-[0.75rem] text-muted-foreground">{format.bytes(data?.outgoing_bandwidth)}</Num>
              </div>
            </div>
          </div>
          <div className="px-1 pb-1 pt-2 text-muted-foreground/60">
            <Sparkline
              series={[
                { values: (data?.network_history ?? []).map((point) => point.incoming), tone: "var(--chart-1)" },
                { values: (data?.network_history ?? []).map((point) => point.outgoing), tone: "var(--chart-3)" },
              ]}
              height={132}
              showGrid
              markLast
            />
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.system.overview")} icon={Server} contentClassName="space-y-3 p-4">
          <div className="space-y-2.5">
            {[
              { label: t("dashboard.system.systemUptime"), seconds: data?.uptime_seconds },
              { label: t("dashboard.system.panelUptime"), seconds: data?.panel_uptime_seconds },
              { label: t("xrayUptime"), seconds: data?.xray_uptime_seconds },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-[0.75rem] text-muted-foreground">{row.label}</span>
                <span className="text-[0.8125rem] font-medium tabular">{format.duration(row.seconds)}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-muted/25 p-2.5">
            <div>
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                {t("next.overview.version")}
              </p>
              <p className="text-[0.8125rem] font-medium tabular">{data?.version ?? "—"}</p>
            </div>
            <div>
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">Xray</p>
              <p className="flex items-center gap-1 text-[0.8125rem] font-medium">
                {data?.xray_running ? (
                  <CircleCheck className="size-3.5 text-success" />
                ) : (
                  <CircleAlert className="size-3.5 text-destructive" />
                )}
                {data?.xray_version ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{t("loadAverage")}</p>
              <Num className="text-[0.8125rem] font-medium">
                {(data?.load_avg ?? [])
                  .slice(0, 3)
                  .map((value) => value.toFixed(2))
                  .join(" · ") || "—"}
              </Num>
            </div>
            <div>
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                {t("dashboard.system.core")}
              </p>
              <Num className="text-[0.8125rem] font-medium">
                {format.number(data?.cpu_cores)} / {format.number(data?.cpu_threads)}
              </Num>
            </div>
          </div>

          {dataUpdatedAt ? (
            <p className="text-[0.625rem] text-muted-foreground">
              {t("next.overview.updated", { time: format.date(dataUpdatedAt / 1000, "time") })}
            </p>
          ) : null}
        </SectionCard>
      </div>

      {/* Row 4: admin headcount, quick jumps and the traffic split. */}
      <div className="grid gap-2.5 lg:grid-cols-3">
        <SectionCard title={t("dashboard.admins")} icon={ShieldCheck} contentClassName="p-4">
          <div className="grid grid-cols-2 gap-2.5">
            {admins.map((row) => (
              <div key={row.label} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <p className="truncate text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </p>
                {isPending ? (
                  <Skeleton className="mt-1 h-5 w-8" />
                ) : (
                  <p className="text-lg font-semibold leading-tight tabular">{format.number(row.value)}</p>
                )}
              </div>
            ))}
          </div>
          {data?.admin_overview?.top_admin_username ? (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
              <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                <ShieldHalf className="size-3.5" />
                {t("dashboard.admins.topAdmin")}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-[0.75rem] font-medium">{data.admin_overview.top_admin_username}</span>
                <Num className="text-[0.6875rem] text-muted-foreground">
                  {format.bytes(data.admin_overview.top_admin_usage)}
                </Num>
              </span>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title={t("next.overview.quick")} icon={ArrowUpRight} contentClassName="p-2">
          <div className="flex flex-col gap-0.5">
            {[
              { to: "/users", label: t("next.overview.quickUsers"), icon: UsersRound },
              { to: "/nodes", label: t("next.overview.quickNodes"), icon: Server },
              { to: "/services", label: t("next.overview.quickServices"), icon: HardDrive },
              { to: "/hosts", label: t("next.nav.hosts"), icon: MemoryStick },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-muted/50"
              >
                <item.icon className="size-4 text-muted-foreground" />
                <span className="flex-1">{item.label}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={t("next.stat.traffic")} icon={Cpu} contentClassName="p-4">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.75rem] text-muted-foreground">{t("total")}</span>
              <Num className="text-lg font-semibold">{format.bytes(data?.panel_total_bandwidth)}</Num>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
              <span
                className="h-full bg-chart-1"
                style={{
                  width: `${
                    data && data.panel_total_bandwidth > 0
                      ? (data.incoming_bandwidth / data.panel_total_bandwidth) * 100
                      : 50
                  }%`,
                }}
              />
              <span className="h-full flex-1 bg-chart-3/70" />
            </div>
            <div className="flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-chart-1" />
                <Num>{format.bytes(data?.incoming_bandwidth)}</Num>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-chart-3" />
                <Num>{format.bytes(data?.outgoing_bandwidth)}</Num>
              </span>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
