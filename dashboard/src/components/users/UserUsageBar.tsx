import { cn } from "lib/cn";
import type { FC } from "react";
import { formatBytes } from "utils/formatByte";
import { getUsageTone, usageToneGradients } from "./userColors";

type UserUsageBarProps = {
	used: number;
	total: number | null;
	/**
	 * "compact" keeps the original single-block layout (bar, then a
	 * used/percent line) used for tight mobile cells. "detailed" is the
	 * desktop table layout: the bar and percentage share one row, and
	 * current usage (left) / lifetime usage (right) share a second row
	 * below it.
	 */
	variant?: "compact" | "detailed" | "stacked";
	lifetimeUsed?: number;
	lifetimeLabel?: string;
	resetLabel?: string;
};

// Fixed so the percent label never changes the bar's rendered width -
// "5%", "100%" and "∞" all sit in the same reserved slot.
const PERCENT_SLOT_WIDTH = "2.75em";

export const formatUsagePair = (used: number, total: number | null): string => {
	const [usedValue, usedUnit] = formatBytes(used, 2, true);
	if (total === 0 || total === null) return `${usedValue} ${usedUnit}/∞`;

	const [totalValue, totalUnit] = formatBytes(total, 2, true);
	if (usedUnit === totalUnit) return `${usedValue}/${totalValue} ${totalUnit}`;
	return `${usedValue} ${usedUnit}/${totalValue} ${totalUnit}`;
};

/**
 * Gradient usage meter for the Users list. The fill color shifts from green
 * through yellow to red as the consumed share grows; unlimited users get a
 * static blue bar instead of an indeterminate spinner.
 */
export const UserUsageBar: FC<UserUsageBarProps> = ({
	used,
	total,
	variant = "compact",
	lifetimeUsed,
	lifetimeLabel,
	resetLabel,
}) => {
	const isUnlimited = total === 0 || total === null;
	const percent = isUnlimited ? 0 : Math.min((used / (total || 1)) * 100, 100);
	const tone = getUsageTone(percent, isUnlimited);
	const fillWidth =
		used <= 0 ? "0%" : isUnlimited ? "100%" : `${Math.max(percent, 2)}%`;
	const percentLabel = isUnlimited ? "∞" : `${Math.round(percent)}%`;

	const track = (
		<div className="flex-[1_1_auto] min-w-0! rb-user-usage-track">
			<div style={{
					width: fillWidth,
					backgroundImage: usageToneGradients[tone],
				}} className="rb-user-usage-fill" />
		</div>
	);

	if (variant === "compact") {
		return (
			<div data-tone={tone} data-variant={variant} className="flex flex-col gap-1 w-full max-w-full justify-center overflow-hidden rb-user-usage">
				{track}
				<div dir="ltr" className="flex flex-row items-center justify-between gap-2 text-[0.75rem] w-full min-w-0! whitespace-nowrap">
					<p className="truncate min-w-0! [unicode-bidi:isolate] rb-user-usage-pair">
						{formatUsagePair(used, total)}
					</p>
					<p className="shrink-0 rb-user-usage-percent">
						{percentLabel}
					</p>
				</div>
			</div>
		);
	}

	if (variant === "stacked") {
		return (
			<div data-tone={tone} data-variant={variant} dir="ltr" className="flex flex-col gap-1 w-full min-w-0! rb-user-usage">
				{track}
				<div className="flex items-center justify-between gap-3 h-[16px] text-[0.75rem] whitespace-nowrap">
					<p className="truncate rb-user-usage-pair">
						{formatBytes(used)}
					</p>
					<p className={cn("text-panel-text-muted truncate", isUnlimited ? "text-[1rem]" : "", "rb-user-usage-pair")}>
						{isUnlimited ? "∞" : formatBytes(total)}
					</p>
				</div>
			</div>
		);
	}

	// Detailed (desktop table): row 1 is the bar with the percentage fixed to
	// its right in a constant-width slot, so the bar's rendered width only
	// ever depends on the (fixed) column width - never on the digits shown,
	// the username, or any other row's content. Row 2 holds current usage on
	// the left and lifetime usage on the right, wrapping gracefully if the
	// column gets too narrow to fit both on one line.
	return (
		<div data-tone={tone} data-variant={variant} className="flex flex-col gap-0.5 w-full max-w-full overflow-hidden rb-user-usage">
			<div className="flex items-center gap-0 w-full min-w-0!">
				{track}
				<p dir="ltr" style={{ flex: `0 0 ${PERCENT_SLOT_WIDTH}` }} className="text-start rb-user-usage-percent">
					{percentLabel}
				</p>
			</div>
			<div className="flex items-center w-full min-w-0! gap-2">
				<div dir="ltr" className="flex items-center flex-[1_1_auto] min-w-0! flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem]">
					<p className="truncate min-w-0! flex-[0_1_auto] text-start [unicode-bidi:isolate] rb-user-usage-pair">
						{formatUsagePair(used, total)}
						{resetLabel ? ` · ${resetLabel}` : ""}
					</p>
					{lifetimeUsed !== undefined && (
						<p className="text-panel-text-muted truncate shrink-0 ms-auto text-end [unicode-bidi:isolate]">
							{lifetimeLabel ? `${lifetimeLabel}: ` : ""}
							<span className="font-semibold text-panel-text-secondary">
								{formatBytes(lifetimeUsed)}
							</span>
						</p>
					)}
				</div>
				<div aria-hidden style={{ flex: `0 0 ${PERCENT_SLOT_WIDTH}` }} />
			</div>
		</div>
	);
};
