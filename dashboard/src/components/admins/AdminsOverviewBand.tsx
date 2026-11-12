import { useTranslation } from "react-i18next";
import { cn } from "lib/cn";
import { formatBytes } from "utils/formatByte";
import type { AdminsOverviewSelection, AdminsOverviewTarget } from "utils/adminsOverview";

type Count = number | null;

/** The admin holding the top value of one metric; null when nobody has a non-zero value. */
export type AdminLeader = { username: string; value: number } | null;

export type AdminsOverviewBandProps = {
	total: Count;
	topUsage: AdminLeader;
	topUsers: AdminLeader;
	topOnline: AdminLeader;
	active: Count;
	expired: Count;
	limited: Count;
	disabled: Count;
	fullAccess: Count;
	sudo: Count;
	reseller: Count;
	standard: Count;
	locale: string;
	selection: AdminsOverviewSelection;
	onSelect: (target: AdminsOverviewTarget) => void;
};

const formatCount = (value: Count, locale: string) =>
	value === null ? "-" : new Intl.NumberFormat(locale || "en").format(value);

const LINK_CLASS =
	"cursor-pointer text-start underline decoration-panel-text-muted/60 underline-offset-4 transition-colors hover:text-panel-accent hover:decoration-panel-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent rounded-sm";

/**
 * What an admin list needs to show at a glance: how many admins there are, which admin carries the most
 * traffic, users and online users, then the status and role split. Shaped for admins, not the users band.
 */
export const AdminsOverviewBand = ({
	total,
	topUsage,
	topUsers,
	topOnline,
	active,
	expired,
	limited,
	disabled,
	fullAccess,
	sudo,
	reseller,
	standard,
	locale,
	selection,
	onSelect,
}: AdminsOverviewBandProps) => {
	const { t } = useTranslation();

	const leaderTiles = [
		{
			key: "usage",
			label: t("admins.leaders.usage"),
			leader: topUsage,
			display: topUsage ? formatBytes(topUsage.value) : "-",
		},
		{
			key: "users",
			label: t("admins.leaders.users"),
			leader: topUsers,
			display: topUsers ? formatCount(topUsers.value, locale) : "-",
		},
		{
			key: "online",
			label: t("admins.leaders.online"),
			leader: topOnline,
			display: topOnline ? formatCount(topOnline.value, locale) : "-",
		},
	];

	const statuses = [
		{ key: "active" as const, label: t("status.active"), value: active, className: "bg-green-500" },
		{ key: "expired" as const, label: t("status.expired"), value: expired, className: "bg-orange-500" },
		{ key: "limited" as const, label: t("status.limited"), value: limited, className: "bg-red-500" },
		{ key: "disabled" as const, label: t("status.disabled"), value: disabled, className: "bg-gray-500" },
	];
	const statusSum = statuses.reduce((sum, item) => sum + (item.value ?? 0), 0);

	const roles = [
		{ key: "full_access" as const, label: t("admins.roles.fullAccess"), value: fullAccess },
		{ key: "sudo" as const, label: t("admins.roles.sudo"), value: sudo },
		{ key: "reseller" as const, label: t("admins.roles.reseller"), value: reseller },
		{ key: "standard" as const, label: t("admins.roles.standard"), value: standard },
	];

	return (
		<div className="flex flex-col">
			<div className="grid grid-cols-2 sm:grid-cols-4">
				<div className="flex flex-col gap-1 px-4 py-3">
					<span className="text-[0.7rem] font-medium uppercase tracking-wider text-panel-text-muted">{t("total")}</span>
					<button
						type="button"
						aria-label={t("total")}
						onClick={() => onSelect({ kind: "all" })}
						className={cn(LINK_CLASS, "text-xl font-semibold tabular-nums text-panel-text")}
					>
						{formatCount(total, locale)}
					</button>
					<span className="text-xs text-panel-text-muted">{t("admins")}</span>
				</div>
				{leaderTiles.map((tile) => (
					<div
						key={tile.key}
						className="flex min-w-0 flex-col gap-1 border-panel-border px-4 py-3 [&:not(:first-child)]:border-s max-sm:[&:nth-child(odd)]:border-s-0"
					>
						<span className="text-[0.7rem] font-medium uppercase tracking-wider text-panel-text-muted">{tile.label}</span>
						<span className="text-xl font-semibold tabular-nums text-panel-text">{tile.display}</span>
						<span
							dir="ltr"
							className={cn("truncate text-xs", tile.leader ? "font-medium text-panel-text" : "text-panel-text-muted")}
						>
							{tile.leader ? tile.leader.username : "-"}
						</span>
					</div>
				))}
			</div>

			<div className="flex flex-col gap-2 border-t border-panel-border px-4 py-3">
				<div className="flex h-1.5 w-full overflow-hidden rounded-full bg-whiteAlpha-100">
					{statusSum > 0
						? statuses.map((item) =>
								item.value ? (
									<span
										key={item.label}
										className={cn("h-full", item.className)}
										style={{ width: `${((item.value ?? 0) / statusSum) * 100}%` }}
									/>
								) : null,
							)
						: null}
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-panel-text-muted">
					{statuses.map((item) => (
						<button
							key={item.key}
							type="button"
							aria-label={item.label}
							aria-pressed={selection.status === item.key}
							onClick={() => onSelect({ kind: "status", status: item.key })}
							className={cn(
								"inline-flex items-center gap-1.5",
								LINK_CLASS,
								selection.status === item.key && "text-panel-accent decoration-panel-accent",
							)}
						>
							<span className={cn("size-2 rounded-full", item.className)} />
							{item.label}
							<span className="font-semibold tabular-nums text-panel-text">{formatCount(item.value, locale)}</span>
						</button>
					))}
				</div>
			</div>

			<div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-panel-border px-4 py-2 text-xs text-panel-text-muted">
				{roles.map((role) => (
					<button
						key={role.key}
						type="button"
						aria-label={role.label}
						aria-pressed={selection.role === role.key}
						onClick={() => onSelect({ kind: "role", role: role.key })}
						className={cn(
							"inline-flex items-center gap-1.5",
							LINK_CLASS,
							selection.role === role.key && "text-panel-accent decoration-panel-accent",
						)}
					>
						{role.label}
						<span className="font-semibold tabular-nums text-panel-text">{formatCount(role.value, locale)}</span>
					</button>
				))}
			</div>
		</div>
	);
};
