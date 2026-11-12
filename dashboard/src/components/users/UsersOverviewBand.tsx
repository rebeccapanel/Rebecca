import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "lib/cn";
import { formatBytes } from "utils/formatByte";
import type { UsersOverviewSelection, UsersOverviewTarget } from "utils/usersOverview";

const count = (value: number | null | undefined, locale: string) =>
	value === null || value === undefined
		? "—"
		: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

const percent = (value: number, locale: string) =>
	new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

export type OverviewStatusKey =
	| "active"
	| "expired"
	| "limited"
	| "on_hold"
	| "disabled";

export type UsersOverviewBandProps = {
	total: number;
	usersLimit?: number | null;
	active: number;
	online: number;
	usage: number | null;
	usageLabel?: string;
	breakdown: Partial<Record<OverviewStatusKey, number>>;
	locale: string;
	/** Rendered inside a parent card: drops its own border and surface. */
	bare?: boolean;
	selection: UsersOverviewSelection;
	onSelect: (target: UsersOverviewTarget) => void;
};

const STATUS_ORDER: OverviewStatusKey[] = [
	"active",
	"expired",
	"limited",
	"on_hold",
	"disabled",
];

/* Same palette the old pills used (green/orange/yellow/red/teal). */
const STATUS_TONE: Record<OverviewStatusKey, string> = {
	active: "bg-panel-success",
	expired: "bg-panel-danger",
	limited: "bg-panel-warning",
	on_hold: "bg-panel-info",
	disabled: "bg-panel-text-muted/60",
};

/**
 * The users overview card, rebuilt with Tailwind on the panel's own tokens.
 *
 * This is the first screen of the Chakra → Tailwind migration: no Chakra
 * component, no `sx`, no emotion. Every colour comes from `--rb-panel-*`, so it
 * matches the rest of the dashboard exactly, and logical utilities keep RTL
 * identical to LTR.
 */
type OverviewLinkProps = {
	label: string;
	active?: boolean;
	onSelect: () => void;
	className?: string;
	children: ReactNode;
};

const OverviewLink = ({ label, active = false, onSelect, className, children }: OverviewLinkProps) => (
	<button
		type="button"
		aria-label={label}
		aria-pressed={active}
		title={label}
		onClick={onSelect}
		className={cn(
			"cursor-pointer text-start underline decoration-panel-text-muted/60 underline-offset-4 transition-colors hover:text-panel-accent hover:decoration-panel-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent rounded-sm",
			active && "text-panel-accent decoration-panel-accent",
			className,
		)}
	>
		{children}
	</button>
);

export function UsersOverviewBand({
	total,
	usersLimit,
	active,
	online,
	usage,
	usageLabel,
	breakdown,
	locale,
	bare = false,
	selection,
	onSelect,
}: UsersOverviewBandProps) {
	const { t } = useTranslation();
	const totals = STATUS_ORDER.reduce((sum, key) => sum + (breakdown[key] ?? 0), 0);
	const share = (value: number, of: number) =>
		of > 0 ? (value / of) * 100 : 0;
	const limitPercent = usersLimit ? Math.min(100, share(total, usersLimit)) : null;

	return (
		<section
			className={
				bare
					? "grid grid-cols-2 gap-x-4 gap-y-4 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,13rem)] md:gap-0"
					: "grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-panel-border bg-panel-surface p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,13rem)] md:gap-0"
			}
			aria-label={t("usersStatusBreakdown")}
		>
			{/* Total, against the admin's user cap when the panel reports one. */}
			<div className="order-1 col-span-1 flex flex-col justify-between gap-2 md:pe-6">
				<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
					{t("usersTable.total")}
				</span>
				<div>
					<div className="flex items-baseline gap-2">
						<OverviewLink
							label={t("usersTable.total")}
							onSelect={() => onSelect({ kind: "all" })}
							className="rb-tabular text-[1.75rem] font-semibold leading-none tracking-tight text-panel-text"
						>
							{count(total, locale)}
						</OverviewLink>
						{usersLimit ? (
							<span className="rb-tabular text-xs text-panel-text-muted">
								/ {count(usersLimit, locale)}
							</span>
						) : null}
					</div>
					{limitPercent !== null ? (
						<div className="mt-2 space-y-1">
							<div className="h-1 overflow-hidden rounded-full bg-panel-border">
								<div
									className="h-full rounded-full bg-panel-accent transition-[width] duration-500"
									style={{ width: `${limitPercent}%` }}
								/>
							</div>
							<p className="rb-tabular flex items-baseline gap-1 text-[0.625rem] text-panel-text-muted">
								<span>{percent(limitPercent, locale)}%</span>
								<span>/</span>
								<span>{count(usersLimit, locale)}</span>
							</p>
						</div>
					) : (
						<p className="mt-2 text-[0.625rem] text-panel-text-muted">
							{t("users")}
						</p>
					)}
				</div>
			</div>

			{/* Live state. */}
			<div className="order-3 col-span-2 grid grid-cols-2 content-start gap-x-4 gap-y-3 border-t border-panel-border! pt-4 md:order-2 md:col-span-1 md:flex md:flex-col md:justify-between md:gap-3 md:border-s md:border-t-0 md:px-6 md:pt-0">
				{[
					{ key: "online", label: t("onlineStatus.online"), value: online, tone: "bg-panel-accent" },
					{ key: "active", label: t("status.active"), value: active, tone: "bg-panel-success" },
				].map((row) => (
					<OverviewLink
						key={row.key}
						label={row.label}
						active={row.key === "online" ? selection.online : selection.status === "active"}
						onSelect={() =>
							onSelect(row.key === "online" ? { kind: "online" } : { kind: "status", status: "active" })
						}
						className="block w-full"
					>
						<div className="flex items-center gap-1.5">
							<span className={`size-1.5 rounded-full ${row.tone}`} />
							<span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-panel-text-muted">
								{row.label}
							</span>
						</div>
						<div className="mt-1 flex items-baseline gap-2">
							<span className="rb-tabular text-lg font-semibold leading-none text-panel-text">
								{count(row.value, locale)}
							</span>
							<span className="rb-tabular flex items-baseline gap-1 text-[0.625rem] text-panel-text-muted">
								<span>{percent(share(row.value, totals || total || 1), locale)}%</span>
								<span>{t("users")}</span>
							</span>
						</div>
					</OverviewLink>
				))}
			</div>

			{/* Distribution across statuses. */}
			<div className="order-4 col-span-2 flex flex-col justify-center gap-2 border-t border-panel-border! pt-4 md:order-3 md:col-span-1 md:border-s md:border-t-0 md:px-6 md:pt-0">
				<div className="flex items-center justify-between">
					<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
						{t("usersStatusBreakdown")}
					</span>
					<span className="rb-tabular text-[0.6875rem] text-panel-text-muted">
						{count(totals, locale)}
					</span>
				</div>
				<div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-panel-border">
					{STATUS_ORDER.map((key) => {
						const value = breakdown[key] ?? 0;
						if (!value) return null;
						return (
							<span
								key={key}
								className={`h-full first:rounded-s-full last:rounded-e-full ${STATUS_TONE[key]}`}
								style={{ width: `${share(value, totals || 1)}%` }}
								title={`${t(`status.${key}`)}: ${value}`}
							/>
						);
					})}
				</div>
				<div className="grid grid-cols-2 gap-x-4 gap-y-1">
					{STATUS_ORDER.map((key) => (
						<OverviewLink
							key={key}
							label={t(`status.${key}`)}
							active={selection.status === key}
							onSelect={() => onSelect({ kind: "status", status: key })}
							className="flex items-center gap-1.5 text-[0.6875rem] text-panel-text-secondary"
						>
							<span className={`size-1.5 rounded-full ${STATUS_TONE[key]}`} />
							{t(`status.${key}`)}
							<span className="rb-tabular ms-auto font-medium text-panel-text">
								{count(breakdown[key] ?? 0, locale)}
							</span>
						</OverviewLink>
					))}
				</div>
			</div>

			{/* Traffic total plus the per-user average. */}
			<div className="order-2 col-span-1 flex flex-col justify-between gap-2 md:order-4 md:col-span-1 md:border-s md:border-panel-border md:ps-6">
				<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
					{usageLabel ?? t("usersTable.listUsage")}
				</span>
				<div>
					<OverviewLink
						label={usageLabel ?? t("usersTable.listUsage")}
						active={selection.usage}
						onSelect={() => onSelect({ kind: "usage" })}
						className="rb-tabular block w-full text-[1.75rem] font-semibold leading-none tracking-tight text-panel-text"
					>
						<span dir="ltr" style={{ unicodeBidi: "isolate" }}>
							{usage === null ? "—" : formatBytes(usage)}
						</span>
					</OverviewLink>
					<p className="mt-2 flex items-baseline gap-1 text-[0.625rem] text-panel-text-muted">
						{usage === null || total === 0 ? (
							<span>&nbsp;</span>
						) : (
							<>
								<span dir="ltr" style={{ unicodeBidi: "isolate" }}>
									{formatBytes(Math.round(usage / Math.max(1, total)))}
								</span>
								<span>/</span>
								<span>{t("user")}</span>
							</>
						)}
					</p>
				</div>
			</div>
		</section>
	);
}
